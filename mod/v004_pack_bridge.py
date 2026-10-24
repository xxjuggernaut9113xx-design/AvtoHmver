"""Deploy a validated fanservice archive through v0.04's native pack discovery.

This is a pack transport adapter, not the embedded Lite/UP/profile runtime adapter.
It never edits executable bytes, entitlement flags or game save files.
"""
import argparse
import ctypes
from ctypes import wintypes
from contextlib import contextmanager
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import stat
import tempfile
import uuid
import zipfile

from verify_compatibility import identify, validate_registry, REGISTRY

LIMIT = 512 * 1024 * 1024
MEDIA = {'.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.bmp': 'image',
         '.gif': 'image', '.webp': 'image', '.mp4': 'video', '.mov': 'video', '.webm': 'video'}
TARGET = 'v004-exclusive-c645757d'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_archive(path):
    if not path.is_file() or not 0 < path.stat().st_size <= LIMIT:
        raise ValueError('Choose a nonempty pack archive up to 512 MiB.')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= 10002 or sum(e.file_size for e in entries) > LIMIT:
            raise ValueError('Archive exceeds member or expanded-size limits.')
        seen = set()
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            if (not parts or name.startswith('/') or '\\' in name or ':' in name
                    or any(part in ('..', '.') for part in name.split('/'))
                    or any(ord(c) < 32 for c in name) or name.casefold() in seen
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or entry.file_size > 256 * 1024 * 1024):
                raise ValueError('Unsafe, duplicate or unsupported archive entry.')
            if any(part.rstrip(' .') != part or part.split('.')[0].upper() in
                   {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)),
                    *(f'LPT{i}' for i in range(1, 10))} for part in parts):
                raise ValueError('Archive contains a Windows-reserved filename.')
            seen.add(name.casefold())
            if name != 'manifest.json' and not (
                    len(parts) == 2 and parts[0] == 'media' and PurePosixPath(name).suffix.lower() in MEDIA
                    or len(parts) == 1 and name.startswith('preview.') and MEDIA.get(PurePosixPath(name).suffix.lower()) == 'image'):
                raise ValueError('Only manifest, media and preview files are accepted.')
        info = archive.getinfo('manifest.json')
        if info.file_size > 1024 * 1024:
            raise ValueError('Manifest exceeds 1 MiB.')
        manifest = json.loads(archive.read(info))
        if (not isinstance(manifest, dict) or not isinstance(manifest.get('name'), str) or not manifest['name'].strip()
                or len(manifest['name']) > 120 or type(manifest.get('unlock_cost')) is not int
                or not 0 <= manifest['unlock_cost'] <= 2147483647
                or not isinstance(manifest.get('description'), str)
                or len(manifest['description']) > 2000):
            raise ValueError('Invalid pack name, description or native UP price.')
        media = manifest.get('media')
        if not isinstance(media, list) or not 1 <= len(media) <= 10000:
            raise ValueError('A native pack requires 1–10000 media entries.')
        members = set()
        for item in media:
            name = item.get('file') if isinstance(item, dict) else None
            if (not isinstance(name, str) or PurePosixPath(name).name != name
                    or name.casefold() in members or 'media/' + name not in archive.namelist()
                    or MEDIA.get(PurePosixPath(name).suffix.lower()) != item.get('type')):
                raise ValueError('Missing, duplicate or incompatible media entry.')
            members.add(name.casefold())
        expected = {'manifest.json', *('media/' + item['file'] for item in media)}
        preview = manifest.get('preview')
        if preview is not None:
            if (not isinstance(preview, str) or not preview.startswith('preview.')
                    or PurePosixPath(preview).name != preview
                    or MEDIA.get(PurePosixPath(preview).suffix.lower()) != 'image'):
                raise ValueError('Invalid preview filename.')
            expected.add(preview)
        if expected != {e.filename for e in entries}:
            raise ValueError('Archive files do not exactly match its manifest.')
        for field, count in [('total_media', len(media)),
                             ('image_count', sum(i['type'] == 'image' for i in media)),
                             ('video_count', sum(i['type'] == 'video' for i in media))]:
            if manifest.get(field) != count:
                raise ValueError('Manifest media counts do not match the payload.')
        if archive.testzip() is not None:
            raise ValueError('Archive CRC verification failed.')
    return manifest


def _running_game(executable):
    if os.name != 'nt':
        return False
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class ProcessEntry(ctypes.Structure):
        _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                    ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_size_t),
                    ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                    ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
                    ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260)]
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        available = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        if not available and ctypes.get_last_error() != 18:
            raise ctypes.WinError(ctypes.get_last_error())
        while available:
            if entry.szExeFile.casefold() == executable.name.casefold():
                process = kernel.OpenProcess(0x1000, False, entry.th32ProcessID)
                if not process:
                    # An exited process is harmless; access denial is not evidence of closure.
                    if ctypes.get_last_error() != 87:
                        raise OSError('Cannot verify that CockHero is closed; close it before changing packs.')
                else:
                    try:
                        buffer = ctypes.create_unicode_buffer(32768)
                        size = wintypes.DWORD(len(buffer))
                        if not kernel.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
                            raise OSError('Cannot inspect CockHero process path; close it before changing packs.')
                        if Path(buffer.value).resolve() == executable.resolve():
                            return True
                    finally:
                        kernel.CloseHandle(process)
            available = kernel.Process32NextW(snapshot, ctypes.byref(entry))
        if ctypes.get_last_error() != 18:
            raise ctypes.WinError(ctypes.get_last_error())
        return False
    finally:
        kernel.CloseHandle(snapshot)


def _require_closed(pack_dir):
    if _running_game(pack_dir.parent / 'CockHero.exe'):
        raise ValueError('Close this CockHero installation before installing, updating or removing packs.')


def _pack_directory(game_root, *, mutation=True):
    root = game_root.resolve(strict=True)
    registry = validate_registry(json.loads(REGISTRY.read_text(encoding='utf-8')))
    build = identify(root, registry)
    if build['build_id'] != TARGET:
        raise ValueError('This pack bridge only accepts the identified v0.04 Exclusive build.')
    pack_dir = root / 'CockHero/Binaries/Win64/packs'
    if not pack_dir.resolve().is_relative_to(root):
        raise ValueError('Pack directory resolves outside the game installation.')
    for ancestor in (root / 'CockHero', root / 'CockHero/Binaries', pack_dir.parent, pack_dir):
        if (ancestor.exists() or ancestor.is_symlink()) and _reparse(ancestor):
            raise ValueError('Pack directory contains a Windows reparse point or symbolic link.')
    if mutation:
        _require_closed(pack_dir)
    pack_dir.mkdir(parents=True, exist_ok=True)
    return pack_dir


@contextmanager
def _locked(pack_dir):
    lock = pack_dir / '.fanservice-bridge.lock'
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.close(descriptor)
        yield
    finally:
        lock.unlink()


def _identity(value):
    if not isinstance(value, str) or not re.fullmatch(r'custom:[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('Pack identity must be custom: followed by 1–128 letters, digits, underscores or hyphens.')
    return value


def _ledger(pack_dir):
    path = pack_dir / '.fanservice-receipts.json'
    if (path.exists() or path.is_symlink()) and _reparse(path):
        raise ValueError('Receipt ledger must not be a symbolic link.')
    if not path.exists():
        return {}
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Receipt ledger exceeds its size limit.')
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('packs'), dict):
        raise ValueError('Invalid receipt ledger; no packs were changed.')
    filenames = set()
    for identity, receipt in data['packs'].items():
        _identity(identity)
        if not isinstance(receipt, dict):
            raise ValueError('Invalid receipt entry.')
        name = receipt.get('filename')
        if (not isinstance(name, str) or not re.fullmatch(r'fanservice-[a-z0-9-]+\.chpack', name)
                or name.casefold() in filenames or receipt.get('custom_id') != identity
                or receipt.get('build_id') != TARGET
                or not re.fullmatch(r'[a-f0-9]{64}', str(receipt.get('sha256', '')))):
            raise ValueError('Unsafe receipt entry; no packs were changed.')
        filenames.add(name.casefold())
    return data['packs']


def _write_ledger(pack_dir, records):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=pack_dir, prefix='.fanservice-ledger-', suffix='.tmp',
                                         mode='w', encoding='utf-8', delete=False) as output:
            temporary = Path(output.name)
            json.dump({'version': 1, 'packs': records}, output, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, pack_dir / '.fanservice-receipts.json')
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _owned_archive(pack_dir, receipt):
    destination = pack_dir / receipt['filename']
    if ((destination.exists() or destination.is_symlink()) and _reparse(destination)) or (destination.exists() and
            (not destination.is_file() or digest(destination) != receipt['sha256'])):
        raise ValueError('Owned archive is missing or changed; refusing to replace or remove it.')
    cache = _cache_path(pack_dir, receipt['filename'])
    if cache.exists() or cache.is_symlink():
        _verify_tree(cache, receipt.get('payload_hashes'))
    elif not destination.exists():
        raise ValueError('Owned archive is missing or changed and no verified extracted cache exists.')
    return destination


def _payload_hashes(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        result = {}
        for entry in archive.infolist():
            with archive.open(entry) as stream:
                result[entry.filename] = hashlib.file_digest(stream, 'sha256').hexdigest()
        return result


def _reparse(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & 0x400)


def _cache_path(pack_dir, filename):
    extracted = pack_dir.parent / 'Extracted'
    if (extracted.exists() or extracted.is_symlink()) and (_reparse(extracted) or not extracted.is_dir()):
        raise ValueError('Native extracted cache parent is unsafe; nothing was changed.')
    return extracted / Path(filename).stem


def _verify_tree(cache, expected):
    if not isinstance(expected, dict) or not expected:
        raise ValueError('Cache cannot be verified without recorded payload hashes.')
    if _reparse(cache) or not cache.is_dir():
        raise ValueError('Extracted cache contains an unsafe link or file.')
    expected_dirs = set()
    for name, value in expected.items():
        parts = PurePosixPath(name)
        if (not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value)
                or name.startswith('/') or '\\' in name or ':' in name
                or any(part in ('', '.', '..') for part in name.split('/'))):
            raise ValueError('Invalid recorded cache payload.')
        expected_dirs.update(str(parent) for parent in parts.parents if str(parent) != '.')
    files, directories = set(), set()
    pending = [cache]
    while pending:
        directory = pending.pop()
        for child in directory.iterdir():
            if _reparse(child):
                raise ValueError('Extracted cache contains an unsafe link.')
            name = child.relative_to(cache).as_posix()
            if child.is_dir():
                directories.add(name)
                pending.append(child)
            elif child.is_file() and name in expected and digest(child) == expected[name]:
                files.add(name)
            else:
                raise ValueError('Extracted cache contains unknown or changed files; nothing was changed.')
    if files != set(expected) or directories != expected_dirs:
        raise ValueError('Extracted cache is incomplete or contains unknown directories; nothing was changed.')


def _quarantine_cache(pack_dir, receipt):
    cache = _cache_path(pack_dir, receipt['filename'])
    if not cache.exists() and not cache.is_symlink():
        return None
    _verify_tree(cache, receipt.get('payload_hashes'))
    backup = pack_dir / ('.fanservice-cache-' + str(uuid.uuid4()))
    cache.rename(backup)
    return cache, backup


def _discard_cache(quarantine, expected):
    if quarantine is None:
        return None
    _, backup = quarantine
    try:
        _verify_tree(backup, expected)
        for name in expected:
            (backup / name).unlink()
        directories = {parent for name in expected for parent in (backup / name).parents
                       if parent != backup and parent.is_relative_to(backup)}
        for directory in sorted(directories, key=lambda path: len(path.parts), reverse=True):
            directory.rmdir()
        backup.rmdir()
        return None
    except (OSError, ValueError):
        # The committed receipt remains authoritative; never delete unknown leftovers.
        return str(backup)


def install(game_root, archive_path, custom_id=None):
    # Validate before creating a pack directory, including on unsupported builds.
    manifest = validate_archive(archive_path)
    source_digest = digest(archive_path)
    identity = _identity(custom_id) if custom_id is not None else 'custom:' + str(uuid.uuid4())
    pack_dir = _pack_directory(game_root)
    with _locked(pack_dir):
        return _install_locked(pack_dir, archive_path, manifest, source_digest, identity)


def _install_locked(pack_dir, archive_path, manifest, source_digest, identity):
    records = _ledger(pack_dir)
    previous = records.get(identity)
    label = re.sub(r'[^a-z0-9]+', '-', manifest['name'].lower()).strip('-')[:48] or 'pack'
    destination = (_owned_archive(pack_dir, previous) if previous else
                   pack_dir / ('fanservice-' + label + '-' + str(uuid.uuid4()) + '.chpack'))
    temporary = None
    backup = None
    quarantine = None
    changed = False
    committed = False
    rollback_complete = False
    try:
        with tempfile.NamedTemporaryFile(dir=pack_dir, prefix='.fanservice-', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            with archive_path.open('rb') as source:
                copied = 0
                while chunk := source.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > LIMIT:
                        raise ValueError('Archive grew beyond the size limit during staging.')
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if digest(temporary) != source_digest:
            raise ValueError('Archive changed during staging; nothing installed.')
        validate_archive(temporary)
        if destination.exists() and not previous:
            raise FileExistsError('Pack identity collision; existing files were retained.')
        if previous:
            _require_closed(pack_dir)
            _owned_archive(pack_dir, previous)
            quarantine = _quarantine_cache(pack_dir, previous)
            if destination.exists():
                backup = pack_dir / ('.fanservice-backup-' + str(uuid.uuid4()) + '.tmp')
                os.link(destination, backup)
            os.replace(temporary, destination)
        else:
            _require_closed(pack_dir)
            os.link(temporary, destination)
        changed = True
        receipt = {'custom_id': identity, 'build_id': TARGET,
                'archive': str(destination), 'sha256': source_digest,
                'name': manifest['name'], 'unlock_cost': manifest['unlock_cost'],
                'media_count': len(manifest['media']), 'restart_required': True,
                'payload_hashes': _payload_hashes(destination),
                'cache_invalidated': quarantine is not None,
                'native_runtime_adapter_supported': False}
        records[identity] = dict(receipt, filename=destination.name)
        _write_ledger(pack_dir, records)
        committed = True
        pending = _discard_cache(quarantine, previous.get('payload_hashes') if previous else None)
        if pending:
            receipt['cache_cleanup_pending'] = pending
        return receipt
    except BaseException:
        if not committed:
            if changed:
                if backup is not None:
                    os.replace(backup, destination)
                else:
                    destination.unlink()
            if quarantine is not None:
                quarantine[1].rename(quarantine[0])
            rollback_complete = True
        raise
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        if backup is not None and (committed or rollback_complete or not changed):
            backup.unlink(missing_ok=True)


def uninstall(game_root, custom_id):
    identity = _identity(custom_id)
    pack_dir = _pack_directory(game_root)
    with _locked(pack_dir):
        records = _ledger(pack_dir)
        if identity not in records:
            raise ValueError('No owned archive exists for this custom identity.')
        destination = _owned_archive(pack_dir, records[identity])
        previous = records[identity]
        _require_closed(pack_dir)
        quarantine = _quarantine_cache(pack_dir, previous)
        backup = None
        removed = False
        committed = False
        rollback_complete = False
        try:
            if destination.exists():
                backup = pack_dir / ('.fanservice-backup-' + str(uuid.uuid4()) + '.tmp')
                os.link(destination, backup)
                destination.unlink()
                removed = True
            del records[identity]
            _write_ledger(pack_dir, records)
            committed = True
        except BaseException:
            if removed:
                os.link(backup, destination)
            if quarantine is not None:
                quarantine[1].rename(quarantine[0])
            rollback_complete = True
            raise
        finally:
            if backup is not None and (committed or rollback_complete or not removed):
                backup.unlink(missing_ok=True)
        pending = _discard_cache(quarantine, previous.get('payload_hashes'))
        result = {'custom_id': identity, 'removed': str(destination), 'restart_required': True,
                  'cache_invalidated': quarantine is not None, 'native_saves_preserved': True}
        if pending:
            result['cache_cleanup_pending'] = pending
        return result


def list_installed(game_root):
    pack_dir = _pack_directory(game_root, mutation=False)
    with _locked(pack_dir):
        results = []
        for receipt in _ledger(pack_dir).values():
            archive = pack_dir / receipt['filename']
            source = 'archive' if archive.is_file() else 'extracted'
            try:
                _owned_archive(pack_dir, receipt)
                intact = True
            except (OSError, ValueError):
                intact = False
            results.append(dict(receipt, archive=str(archive), integrity_verified=intact,
                                source=source,
                                restart_required=True, native_runtime_adapter_supported=False))
        return sorted(results, key=lambda receipt: (receipt.get('name', '').casefold(), receipt['custom_id']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--archive', type=Path)
    operation.add_argument('--uninstall', metavar='CUSTOM_ID')
    operation.add_argument('--list', action='store_true', help='List bridge-owned archives and verify their hashes.')
    parser.add_argument('--custom-id', help='Stable custom: identity for installing or updating a pack.')
    args = parser.parse_args()
    try:
        if (args.uninstall or args.list) and args.custom_id:
            raise ValueError('--custom-id applies only to archive installation.')
        result = (list_installed(args.game_root) if args.list else
                  uninstall(args.game_root, args.uninstall) if args.uninstall else
                  install(args.game_root, args.archive, args.custom_id))
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, NotImplementedError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
