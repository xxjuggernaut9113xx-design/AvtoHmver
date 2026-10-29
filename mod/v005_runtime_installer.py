"""Review/install only the hash-owned v0.05 runtime; an existing pinned loader is required.

Stop the native helper normally before --apply; both .host.lock and .ready must
be absent. Known bounded IPC state and music-session registries are preserved
byte-for-byte on upgrade/removal. Removal retains a disabled ownership manifest
when protocol data exists; reinstall accepts that manifest. External profile/cache
storage is never inspected or removed. Unknown files still block changes.

Retained data: companion state (4 MiB), request (64 KiB), shutdown (128 bytes),
music-session registry (64 KiB), nonce-scoped responses/music commands (4 MiB),
their interrupted .tmp files, and GUID-scoped .fanservice-stale-helper archives.
Limits: 256 retained entries and 64 MiB total. No retained bytes are rewritten.
Run Stop-FanserviceNative.cmd before applying; Start-FanserviceNative.ps1 -Stop
also preserves and archives verified stale helper tokens when appropriate.
"""
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

import v005_pack_bridge as packs
from verify_compatibility import REGISTRY, identify, validate_registry
from v004_runtime_installer import validate_origin

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'runtime-v005'
SHARED = ROOT / 'runtime'
NATIVE_SOURCE = ROOT / 'native'
COMPONENT = 'FanserviceV005'
MANIFEST = '.fanservice-v005-runtime.json'
RUNTIME_FILES = ('Scripts/main.lua', 'Scripts/menu_guard.lua', 'Scripts/native-controls.js',
                 'Start-FanserviceNative.ps1', 'Start-FanserviceNative.cmd', 'Stop-FanserviceNative.cmd')
SHARED_FILES = ('Scripts/bridge.js', 'Scripts/companion.lua')
NATIVE_FILES = ('host.mjs', 'companion-store.mjs', 'game-identity.mjs', 'music-delivery.mjs', 'music-pack.mjs')
LOADER_FILES = ('dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/LICENSE')
OWNED = frozenset((*RUNTIME_FILES, *SHARED_FILES, *('Native/' + n for n in NATIVE_FILES),
                   'server-origin.txt', 'build-id.txt', 'enabled.txt'))


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _unlinked(path):
    for current in (path, *path.parents):
        if (current.exists() or current.is_symlink()) and packs._reparse(current):
            raise ValueError('Runtime path contains a reparse point or symbolic link.')


def _directory(game_root):
    root = Path(game_root).absolute()
    _unlinked(root)
    root = root.resolve(strict=True)
    registry = validate_registry(json.loads(REGISTRY.read_text(encoding='utf-8')))
    if identify(root, registry).get('build_id') != packs.TARGET:
        raise ValueError('Runtime requires the exact pinned v0.05.1 Hotfix Public build.')
    binary = root / 'CockHero/Binaries/Win64'
    component = binary / 'ue4ss/Mods' / COMPONENT
    _unlinked(component)
    if not binary.is_dir():
        raise ValueError('Game binary directory is missing.')
    return root, binary, component, registry


def _loader(binary, archive_path, registry):
    archive_path = Path(archive_path)
    _unlinked(archive_path)
    if not archive_path.is_file() or not 0 < archive_path.stat().st_size <= 256 * 1024 * 1024:
        raise ValueError('Choose the pinned loader archive, up to 256 MiB.')
    data = archive_path.read_bytes()
    if _hash(data) != registry['loader_probe']['sha256']:
        raise ValueError('Loader archive SHA-256 does not match the compatibility registry.')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in LOADER_FILES:
            entries = [entry for entry in archive.infolist() if entry.filename == name]
            target = binary / name
            _unlinked(target)
            if (len(entries) != 1 or not 0 < entries[0].file_size <= 128 * 1024 * 1024
                    or not target.is_file() or packs.digest(target) != _hash(archive.read(entries[0]))):
                raise ValueError('Existing loader files must exactly match the pinned archive; loader is never installed or replaced.')


def _safe(component, name):
    if name not in OWNED and name != MANIFEST:
        raise ValueError('Manifest contains an unowned runtime path.')
    target = component / name
    _unlinked(target)
    return target


PROTOCOL_LIMITS = {
    '.fanservice-companion.state': 4 * 1024 * 1024,
    '.fanservice-companion.request': 65536,
    '.fanservice-companion.shutdown': 128,
    '.fanservice-companion.host.lock': 32,
    '.fanservice-companion.ready': 32,
    '.fanservice-music-sessions.json': 65536,
}
ACTIVE_FILES = ('.fanservice-companion.host.lock', '.fanservice-companion.ready')


def _protocol_limit(name):
    if name.endswith('.tmp'):
        name = name[:-4]
    if name in PROTOCOL_LIMITS:
        return PROTOCOL_LIMITS[name]
    if re.fullmatch(r'\.fanservice-(?:companion\.response\.|music-command\.)(?=[0-9-]*[0-9])[0-9-]{1,160}', name):
        return 4 * 1024 * 1024
    return None


def _retained(component):
    result, total = [], 0
    if not component.exists():
        return result
    for target in component.rglob('*'):
        relative = target.relative_to(component).as_posix()
        parts = relative.split('/')
        archived = parts[0] == '.fanservice-stale-helper'
        if archived:
            if len(parts) == 1 or (len(parts) == 2 and re.fullmatch('[0-9a-f]{32}', parts[1])):
                _unlinked(target)
                if not target.is_dir():
                    raise ValueError('Invalid retained helper archive directory.')
                result.append(relative)
                continue
            if (len(parts) != 3 or not re.fullmatch('[0-9a-f]{32}', parts[1])
                    or parts[2] not in (*ACTIVE_FILES, '.fanservice-companion.shutdown')):
                raise ValueError('Helper archive contains unowned files; no files changed.')
            maximum = PROTOCOL_LIMITS[parts[2]]
        else:
            maximum = _protocol_limit(relative)
        if maximum is None:
            continue
        _unlinked(target)
        info = target.stat()
        if not target.is_file() or info.st_nlink != 1 or info.st_size > maximum:
            raise ValueError('Known runtime protocol state is linked, non-regular or oversized; no files changed.')
        total += info.st_size
        result.append(relative)
        if len(result) > 256 or total > 64 * 1024 * 1024:
            raise ValueError('Retained runtime protocol state exceeds its count or total-size limit.')
    if len(result) > 256:
        raise ValueError('Retained runtime protocol state exceeds its count limit.')
    return sorted(result)


def _require_helper_stopped(component):
    if any((component / name).exists() or (component / name).is_symlink() for name in ACTIVE_FILES):
        raise ValueError('Stop the native helper normally before changing runtime; host.lock and ready markers must be absent. Stale markers are retained.')


def _record(component):
    manifest = _safe(component, MANIFEST)
    if not manifest.exists():
        if component.exists():
            raise ValueError('Existing runtime component is unowned; no files changed.')
        return None
    if not manifest.is_file() or manifest.stat().st_size > 65536:
        raise ValueError('Invalid runtime ownership manifest.')
    record = json.loads(manifest.read_text(encoding='utf-8'))
    files = record.get('files') if isinstance(record, dict) else None
    if (not isinstance(record, dict) or record.get('version') != 1 or record.get('build_id') != packs.TARGET
            or record.get('component') != COMPONENT or not isinstance(files, dict)
            or (set(files) != OWNED if record.get('status', 'installed') == 'installed' else
                not (record.get('status') == 'disabled' and files == {})) or any(not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value)
                                         for value in files.values())):
        raise ValueError('Invalid runtime ownership manifest.')
    for name, expected in files.items():
        target = _safe(component, name)
        if not target.is_file() or packs.digest(target) != expected:
            raise ValueError('Owned runtime file is missing or modified; no files changed.')
    retained = set(_retained(component))
    for target in component.rglob('*'):
        _unlinked(target)
        if ((target.is_file() and target.relative_to(component).as_posix() not in set(files) | {MANIFEST} | retained)
                or (target.is_dir() and target.relative_to(component).as_posix() not in {'Scripts', 'Native'} | retained)):
            raise ValueError('Runtime contains unowned files; preserve or relocate them before changing the component.')
    return record


def _payload(origin):
    result = {}
    for source, names, prefix in ((SOURCE, RUNTIME_FILES, ''), (SHARED, SHARED_FILES, ''),
                                  (NATIVE_SOURCE, NATIVE_FILES, 'Native/')):
        for name in names:
            path = source / name
            _unlinked(path)
            if not path.is_file() or not 0 < path.stat().st_size <= 1024 * 1024:
                raise ValueError('Runtime source is missing or exceeds its size limit.')
            result[prefix + name] = path.read_bytes()
    result['server-origin.txt'] = (validate_origin(origin) + '\n').encode()
    result['build-id.txt'] = (packs.TARGET + '\n').encode()
    result['enabled.txt'] = b''
    return result


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.fanservice-v005-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _transaction(component, changes):
    previous, written = {}, []
    try:
        for name, data in changes.items():
            path = _safe(component, name)
            previous[name] = path.read_bytes() if path.exists() else None
            written.append(name)
            if data is None:
                path.unlink(missing_ok=True)
            else:
                _write(path, data)
    except BaseException:
        for name in reversed(written):
            path = _safe(component, name)
            if previous[name] is None:
                path.unlink(missing_ok=True)
            else:
                _write(path, previous[name])
        _prune(component)
        raise


def _prune(component):
    if component.is_dir():
        for path in sorted(component.rglob('*'), key=lambda p: len(p.parts), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
        if not any(component.iterdir()):
            component.rmdir()


@contextmanager
def _lock(component):
    parent = component.parent
    parent.mkdir(parents=True, exist_ok=True)
    lock = parent / '.fanservice-v005-runtime.lock'
    _unlinked(lock)
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        yield
    finally:
        lock.unlink()


def install(game_root, loader_archive, *, origin, apply=False):
    root, binary, component, registry = _directory(game_root)
    _loader(binary, loader_archive, registry)
    _record(component)
    payload = _payload(origin)
    record = dict(version=1, component=COMPONENT, build_id=packs.TARGET, status='installed', full_mod_supported=False,
                  files={name: _hash(data) for name, data in payload.items()})
    if not apply:
        return dict(applied=False, action='install', target=str(component), retained_files=_retained(component), **record)
    _require_helper_stopped(component)
    packs._require_closed(root / 'CockHero/packs')
    with _lock(component):
        _require_helper_stopped(component)
        _loader(binary, loader_archive, registry)
        packs._require_closed(root / 'CockHero/packs')
        _record(component)
        changes = {**payload, MANIFEST: (json.dumps(record, indent=2) + '\n').encode()}
        _transaction(component, changes)
    return dict(applied=True, retained_files=_retained(component), **record)


def remove(game_root, loader_archive, *, apply=False):
    root, binary, component, registry = _directory(game_root)
    _loader(binary, loader_archive, registry)
    record = _record(component)
    if record is None:
        return dict(applied=False, removed=False)
    if not apply:
        retained = _retained(component)
        return dict(applied=False, action='remove', target=str(component), files=sorted(record['files']),
                    retained_files=retained, status='disabled' if retained else 'removed')
    _require_helper_stopped(component)
    packs._require_closed(root / 'CockHero/packs')
    with _lock(component):
        _require_helper_stopped(component)
        _loader(binary, loader_archive, registry)
        packs._require_closed(root / 'CockHero/packs')
        record = _record(component)
        if record is None:
            raise ValueError('Runtime ownership changed before removal.')
        retained = _retained(component)
        disabled = dict(version=1, component=COMPONENT, build_id=packs.TARGET,
                        status='disabled', full_mod_supported=False, files={})
        manifest = (json.dumps(disabled, indent=2) + '\n').encode() if retained else None
        _transaction(component, {**{name: None for name in record['files']}, MANIFEST: manifest})
        _prune(component)
    return dict(applied=True, removed=True, saves_preserved=True, loader_preserved=True, retained_files=retained, status='disabled' if retained else 'removed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('install', 'remove'))
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--loader-archive', type=Path, required=True)
    parser.add_argument('--server-origin')
    parser.add_argument('--apply', action='store_true', help='Apply the reviewed change; default only reviews.')
    args = parser.parse_args()
    try:
        if args.action == 'install':
            if args.server_origin is None:
                parser.error('--server-origin is required for install')
            result = install(args.game_root, args.loader_archive, origin=args.server_origin, apply=args.apply)
        else:
            result = remove(args.game_root, args.loader_archive, apply=args.apply)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
