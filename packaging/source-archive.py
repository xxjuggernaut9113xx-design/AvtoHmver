"""Archive current editable sources, including uncommitted work, without .git/caches."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--unreal', type=Path)
parser.add_argument('--server-only', action='store_true', help='Archive active product sources without the reconstruction reference')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
server = Path(__file__).resolve().parents[1]
if args.server_only == bool(args.unreal):
    parser.error('Choose --server-only or --unreal <reference-project>, exclusively')
unreal = args.unreal.resolve() if args.unreal else None
if unreal is not None and not (unreal / 'CockHeroRecovered.uproject').is_file():
    raise RuntimeError('Expected the active editable Unreal reconstruction')
if args.output.exists():
    raise RuntimeError('Source output already exists; choose a new archive filename')
args.output.parent.mkdir(parents=True, exist_ok=True)
files = []
listed = subprocess.check_output(['git', '-C', str(server), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'])
for raw in listed.split(b'\0'):
    if not raw:
        continue
    relative = Path(raw.decode('utf-8'))
    if relative.parts[0] in {'fanservice-baselines', 'fanservice-ci-results'}:
        continue
    path = server / relative
    if path.is_file():
        files.append((path, Path('fanservice-server') / relative))
for top in ([] if unreal is None else ['Source', 'Config', 'Content', 'Scripts', 'Build', 'Plugins', 'RecoveryEvidence']):
    for path in (unreal / top).rglob('*'):
        if path.is_file() and not any(p in {'__pycache__', 'Binaries', 'Intermediate', '.git'} for p in path.relative_to(unreal).parts):
            files.append((path, Path('reJOIce/UnrealReconstruction') / path.relative_to(unreal)))
for path in ([] if unreal is None else unreal.iterdir()):
    if path.is_file() and (path.suffix.lower() in {'.uproject', '.md', '.json'} or path.name in {'.gitignore', '.gitattributes', 'LICENSE'}):
        files.append((path, Path('reJOIce/UnrealReconstruction') / path.name))
for name in ([] if unreal is None else ['LICENSE', '.gitattributes', '.gitignore']):
    path = unreal.parent / name
    if path.is_file():
        files.append((path, Path('reJOIce') / name))
for path in ([] if unreal is None else (unreal.parent / '.github').rglob('*')):
    if path.is_file():
        files.append((path, Path('reJOIce/.github') / path.relative_to(unreal.parent / '.github')))
manifest = []
with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
    for path, name in sorted(files, key=lambda entry: entry[1].as_posix()):
        info = zipfile.ZipInfo(name.as_posix(), (2026, 10, 22, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        digest = hashlib.sha256()
        with path.open('rb') as source, archive.open(info, 'w', force_zip64=True) as target:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                target.write(chunk)
        manifest.append({'file': name.as_posix(), 'sha256': digest.hexdigest()})
    archive.writestr('source-manifest.json', json.dumps(manifest, indent=2))
print(f'Archived {len(manifest)} current source files: {args.output}')
