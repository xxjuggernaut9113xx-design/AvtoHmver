"""Verify an explicitly isolated fanservice Server installer and ZIP."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--lab', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    lab = args.lab.resolve()
    allowed = Path('E:/fanservice-mod-lab').resolve()
    if lab.parent != allowed or not lab.name.startswith('server-acceptance-'):
        parser.error('Lab must be a new server-acceptance-* child of E:/fanservice-mod-lab')
    lab.mkdir(exist_ok=False)
    release = args.release.resolve()
    stage = release / 'fanservice-server'
    installer = release / 'fanservice-server-setup.exe'
    script = (release / 'fanservice-server.nsi').read_text(encoding='utf-8-sig')
    if '$SMPROGRAMS' in script or 'CreateShortcut' in script:
        raise RuntimeError('Use build-fanservice.py --no-shortcuts for isolated acceptance')
    forbidden = ['WriteReg', 'DeleteReg', 'Exec ', 'ExecWait ', 'RMDir /r', 'Delete /REBOOTOK']
    if any(command in script for command in forbidden):
        raise RuntimeError('Installer has global or unbounded actions outside isolated acceptance scope')
    owned = {path.relative_to(stage).as_posix(): digest(path) for path in stage.rglob('*') if path.is_file()}
    source_files = [path for path in (args.source / 'static').rglob('*') if path.is_file()]
    for path in source_files:
        assert digest(path) == digest(stage / 'Server/static' / path.relative_to(args.source / 'static')), 'Stale packaged static file: ' + str(path)
    with zipfile.ZipFile(release / 'fanservice-server.zip') as archive:
        assert set(archive.namelist()) == set(owned), 'ZIP file ownership manifest differs'
        for name, sha in owned.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == sha, name
    install = lab / 'install'
    install.mkdir()
    sentinels = ['Saved/Recovery.sav', 'Server/data/library/sample.txt', 'Server/data/profiles/profile.json', 'Server/config.json', 'user-notes.txt']
    sentinel_hashes = {}
    for name in sentinels:
        path = install / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('synthetic preservation sentinel: ' + name, encoding='utf-8')
        sentinel_hashes[name] = digest(path)
    checks = []
    installer_env = dict(os.environ, TEMP=str(lab), TMP=str(lab))
    for phase in ['install', 'upgrade']:
        subprocess.run([str(installer), '/S', '/D=' + str(install)], check=True, timeout=180, env=installer_env)
        for name, sha in owned.items():
            assert digest(install / name) == sha, phase + ': ' + name
        for name, sha in sentinel_hashes.items():
            assert digest(install / name) == sha, phase + ' modified ' + name
        checks.append({'phase': phase, 'owned_files_verified': len(owned), 'sentinels_preserved': len(sentinels)})
    uninstaller = lab / 'isolated-uninstall.exe'
    shutil.copy2(install / 'Uninstall.exe', uninstaller)
    subprocess.run([str(uninstaller), '/S', '_?=' + str(install)], check=True, timeout=180, env=installer_env)
    remaining_owned = [name for name in owned if (install / name).exists()]
    assert not remaining_owned, remaining_owned
    for name, sha in sentinel_hashes.items():
        assert digest(install / name) == sha, 'Uninstall modified ' + name
    checks.append({'phase': 'uninstall', 'owned_files_removed': len(owned), 'sentinels_preserved': len(sentinels)})
    report = {'release': str(release), 'lab': str(lab), 'checks': checks, 'static_source_files_verified': len(source_files), 'owned_files': owned, 'sha256': {path.name: digest(path) for path in [installer, release / 'fanservice-server.zip']}, 'source': 'Isolated installer built with --no-shortcuts. No Server launched; no live data opened.'}
    (lab / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'owned_files'}, indent=2))


if __name__ == '__main__':
    main()
