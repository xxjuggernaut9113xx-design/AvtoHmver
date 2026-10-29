"""Install/remove the experimental v0.04 runtime component without editing game saves."""
import argparse
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

import v004_pack_bridge as packs
from verify_compatibility import identify, validate_registry, REGISTRY

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'runtime'
NATIVE_SOURCE = ROOT / 'native'
RUNTIME_FILES = ('Scripts/main.lua', 'Scripts/bridge.js', 'Scripts/music.lua', 'Scripts/companion.lua', 'Scripts/rhythm.lua', 'Scripts/rhythm_probe.lua', 'Scripts/native-controls.js', 'Start-FanserviceNative.ps1', 'Start-FanserviceNative.cmd', 'Stop-FanserviceNative.cmd')
NATIVE_FILES = ('host.mjs', 'companion-store.mjs', 'game-identity.mjs', 'music-delivery.mjs', 'music-pack.mjs')
MANIFEST = '.fanservice-runtime.json'
GATES = ('loader_startup', 'lite_open_and_return_from_original_import', 'native_catalog_query')
LOADER_FILES = ('dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/LICENSE')
PREFIX = 'ue4ss/Mods/Fanservice/'
OWNED = frozenset((*LOADER_FILES, 'ue4ss/UE4SS-settings.ini', 'ue4ss/Mods/mods.txt',
                   *(PREFIX + name for name in RUNTIME_FILES),
                   *(PREFIX + 'Native/' + name for name in NATIVE_FILES), PREFIX + 'server-origin.txt'))
REQUIRED_CORE = frozenset((*LOADER_FILES, 'ue4ss/UE4SS-settings.ini', 'ue4ss/Mods/mods.txt',
                           PREFIX + 'Scripts/main.lua', PREFIX + 'Scripts/bridge.js',
                           PREFIX + 'server-origin.txt'))
SETTINGS = b'''[General]
EnableHotReloadSystem = 0
EnableAutoReloadingLuaMods = 0
UseCache = 0
bUseUObjectArrayCache = false
[Debug]
ConsoleEnabled = 0
GuiConsoleEnabled = 0
GuiConsoleVisible = 0
'''


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def validate_origin(value):
    if not isinstance(value, str) or len(value) > 2048 or any(c.isspace() for c in value):
        raise ValueError('Server origin must be a single HTTP loopback or HTTPS origin.')
    match = re.fullmatch(r'(https?)://([A-Za-z0-9.\-]+)(?::([0-9]+))?', value)
    if match is None:
        raise ValueError('Server origin must be HTTP 127.0.0.1/localhost or HTTPS with an ASCII hostname and optional port.')
    scheme, host, port = match.groups()
    if ('..' in host or (port is not None and not 1 <= int(port) <= 65535)
            or (scheme == 'http' and host not in ('127.0.0.1', 'localhost'))):
        raise ValueError('Server origin requires HTTPS remotely; port must be 1–65535 and hostname cannot contain consecutive dots.')
    return value


def _directory(game_root, *, require_gates, mutation=True):
    root = Path(game_root).absolute()
    if packs._reparse(root):
        raise ValueError('Game root must not be a symbolic link or reparse point.')
    root = root.resolve(strict=True)
    registry = validate_registry(json.loads(REGISTRY.read_text(encoding='utf-8')))
    match = identify(root, registry)
    if match.get('build_id') != packs.TARGET:
        raise ValueError('Runtime component requires the exact identified v0.04 Exclusive build.')
    candidate = next(item for item in registry['candidates'] if item['id'] == packs.TARGET)
    if require_gates and not all(candidate.get('verified', {}).get(key) is True for key in GATES):
        raise ValueError('Experimental runtime acceptance gates have not passed; no component was installed.')
    directory = root / 'CockHero/Binaries/Win64'
    for path in (root / 'CockHero', root / 'CockHero/Binaries', directory):
        if path.exists() and packs._reparse(path):
            raise ValueError('Game directory contains a symbolic link or reparse point.')
    if not directory.is_dir():
        raise ValueError('Game binary directory is missing.')
    if mutation:
        packs._require_closed(directory / 'packs')
        helper_lock = directory / PREFIX / '.fanservice-companion.host.lock'
        if helper_lock.exists() or helper_lock.is_symlink():
            raise ValueError('A native companion host lock exists. Stop the helper before changing runtime; stale locks are retained.')
    return directory, registry


def _safe(directory, relative):
    if relative not in OWNED and relative != MANIFEST:
        raise ValueError('Manifest contains an unowned file path.')
    target = directory / relative
    for path in (target, *target.parents):
        if path == directory:
            break
        if (path.exists() or path.is_symlink()) and packs._reparse(path):
            raise ValueError('Runtime target contains a symbolic link or reparse point.')
    if not target.resolve().is_relative_to(directory):
        raise ValueError('Runtime target resolves outside the game directory.')
    return target


def _read_manifest(directory):
    path = _safe(directory, MANIFEST)
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('Invalid runtime ownership manifest.')
    record = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(record, dict) or record.get('version') != 1 or record.get('build_id') != packs.TARGET
            or record.get('component') != 'experimental-runtime'
            or not isinstance(record.get('files'), dict)
            or not REQUIRED_CORE.issubset(record['files']) or not set(record['files']).issubset(OWNED)
            or any(not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value)
                   for value in record['files'].values())):
        raise ValueError('Invalid runtime ownership manifest.')
    return record


def _verify_owned(directory, record):
    for relative in OWNED:
        path = _safe(directory, relative)
        if record is None or relative not in record['files']:
            if path.exists():
                raise ValueError('Existing runtime files are not owned by this installer; no files changed.')
        elif not path.is_file() or packs.digest(path) != record['files'][relative]:
            raise ValueError('Owned runtime file is missing or changed; refusing modification.')


@contextmanager
def _lock(directory):
    path = directory / '.fanservice-runtime.lock'
    handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(handle)
    try:
        yield
    finally:
        path.unlink()


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.fanservice-runtime-', delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _transaction(directory, changes):
    originals = {}
    written = []
    try:
        for relative, data in changes.items():
            path = _safe(directory, relative)
            originals[relative] = path.read_bytes() if path.exists() else None
            written.append(relative)
            if data is None:
                path.unlink(missing_ok=True)
            else:
                _write(path, data)
    except BaseException:
        for relative in reversed(written):
            path = _safe(directory, relative)
            original = originals[relative]
            if original is None:
                path.unlink(missing_ok=True)
            elif not path.is_file() or path.read_bytes() != original:
                _write(path, original)
        raise


def install(game_root, loader_archive, *, origin=None):
    directory, registry = _directory(game_root, require_gates=True)
    archive_path = Path(loader_archive)
    if not archive_path.is_file() or archive_path.stat().st_size > 256 * 1024 * 1024:
        raise ValueError('Choose the pinned UE4SS loader archive, up to 256 MiB.')
    expected = registry['loader_probe']['sha256']
    with archive_path.open('rb') as source_archive:
        archive_bytes = source_archive.read(256 * 1024 * 1024 + 1)
    if len(archive_bytes) > 256 * 1024 * 1024 or _hash(archive_bytes) != expected:
        raise ValueError('Loader archive SHA-256 does not match the compatibility registry.')
    contents = {}
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        for relative in LOADER_FILES:
            matches = [item for item in archive.infolist() if item.filename == relative]
            if len(matches) != 1 or not 0 < matches[0].file_size <= 128 * 1024 * 1024:
                raise ValueError('Pinned loader archive has invalid required members.')
            contents[relative] = archive.read(matches[0])
    if packs._reparse(SOURCE) or packs._reparse(SOURCE / 'Scripts') or packs._reparse(NATIVE_SOURCE):
        raise ValueError('Runtime source directory must not be linked.')
    sources = [(name, SOURCE / name) for name in RUNTIME_FILES]
    sources.extend(('Native/' + name, NATIVE_SOURCE / name) for name in NATIVE_FILES)
    for relative, path in sources:
        if not path.is_file() or packs._reparse(path) or not 0 < path.stat().st_size <= 256 * 1024:
            raise ValueError('Runtime source is missing, linked or exceeds its size limit.')
        contents[PREFIX + relative] = path.read_bytes()
    if origin is None:
        origin_file = SOURCE / 'server-origin.txt'
        if not origin_file.is_file() or packs._reparse(origin_file) or origin_file.stat().st_size > 2048:
            raise ValueError('Runtime server origin is missing, linked or exceeds its size limit.')
        origin = origin_file.read_text().strip()
    configured = validate_origin(origin)
    contents[PREFIX + 'server-origin.txt'] = (configured + '\n').encode()
    contents['ue4ss/UE4SS-settings.ini'] = SETTINGS
    contents['ue4ss/Mods/mods.txt'] = b'Fanservice : 1\n'
    record = dict(version=1, build_id=packs.TARGET, component='experimental-runtime',
                  full_mod_supported=False, loader_archive_sha256=expected,
                  files={relative: _hash(data) for relative, data in contents.items()})
    with _lock(directory):
        packs._require_closed(directory / 'packs')
        prior = _read_manifest(directory)
        _verify_owned(directory, prior)
        changes = dict(contents)
        changes[MANIFEST] = (json.dumps(record, indent=2) + '\n').encode()
        _transaction(directory, changes)
    return record


def remove(game_root):
    directory, _ = _directory(game_root, require_gates=False)
    with _lock(directory):
        packs._require_closed(directory / 'packs')
        record = _read_manifest(directory)
        if record is None:
            return dict(removed=False, reason='No owned runtime component is installed.')
        _verify_owned(directory, record)
        _transaction(directory, {**{relative: None for relative in sorted(record['files'])}, MANIFEST: None})
    return dict(removed=True, files=len(record['files']), saves_preserved=True)


def status(game_root):
    directory, _ = _directory(game_root, require_gates=False, mutation=False)
    record = _read_manifest(directory)
    if record is None:
        conflicts = [relative for relative in sorted(OWNED)
                     if _safe(directory, relative).exists()]
        return dict(installed=False, full_mod_supported=False,
                    unowned_files=conflicts, installation_blocked=bool(conflicts))
    missing, changed = [], []
    for relative, expected in sorted(record['files'].items()):
        path = _safe(directory, relative)
        if not path.is_file():
            missing.append(relative)
        elif packs.digest(path) != expected:
            changed.append(relative)
    pending = sorted(OWNED - set(record['files']))
    conflicts = [relative for relative in pending if _safe(directory, relative).exists()]
    return dict(installed=True, component=record['component'],
                build_id=packs.TARGET, full_mod_supported=False,
                integrity_verified=not missing and not changed,
                missing_files=missing, changed_files=changed,
                pending_files=pending, upgrade_available=bool(pending),
                unowned_files=conflicts, installation_blocked=bool(conflicts or missing or changed))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('install', 'remove', 'status'))
    parser.add_argument('--game-root', required=True, type=Path)
    parser.add_argument('--loader-archive', type=Path)
    parser.add_argument('--server-origin')
    args = parser.parse_args()
    try:
        if args.action == 'install':
            if args.loader_archive is None:
                parser.error('install requires --loader-archive')
            result = install(args.game_root, args.loader_archive, origin=args.server_origin)
        elif args.action == 'remove':
            result = remove(args.game_root)
        else:
            result = status(args.game_root)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
