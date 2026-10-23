"""Windows-friendly reader of the existing manifest and checksum lock.

Never creates or changes a pin. Verified downloads and extraction caches live
under the explicitly provided cache directory; no user library is opened.
"""
import argparse
import fnmatch
import hashlib
from pathlib import Path
import shutil
import subprocess
import tomllib
import urllib.request
import zipfile

parser=argparse.ArgumentParser()
parser.add_argument('output',type=Path)
parser.add_argument('--cache',type=Path,required=True)
args=parser.parse_args()
args.output.mkdir(parents=True,exist_ok=True)
args.cache.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parent
manifest=tomllib.loads((root/'manifest.toml').read_text(encoding='utf-8'))
pins=dict(line.split() for line in (root/'bundles.lock').read_text().splitlines() if line.strip())
for name,item in manifest.items():
    if 'url' not in item:continue
    expected=pins.get(name)
    if not expected or len(expected)!=64:raise RuntimeError(f'No SHA-256 pin for {name}')
    archive=args.cache/(name+'-'+expected[:12]+'.download')
    if not archive.is_file():urllib.request.urlretrieve(item['url'],archive)
    actual=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
    if actual!=expected:raise RuntimeError(f'Checksum mismatch for {name}; expected {expected}, received {actual}')
    extracted=args.cache/(name+'-'+expected[:12]+'-extracted')
    extracted.mkdir(exist_ok=True)
    if item['kind']=='zip':
        with zipfile.ZipFile(archive) as z:
            base=extracted.resolve()
            for entry in z.infolist():
                if not (base/entry.filename).resolve().is_relative_to(base):raise RuntimeError('Unsafe archive path')
            z.extractall(base)
    elif item['kind']=='7z':
        seven=shutil.which('7z') or shutil.which('7z.exe')
        if not seven:raise RuntimeError('7-Zip is required for the pinned mpv runtime')
        subprocess.run([seven,'x','-y','-o'+str(extracted.resolve()),str(archive.resolve())],check=True,stdout=subprocess.DEVNULL)
    elif item['kind']=='exe':shutil.copyfile(archive,extracted/(name+'.exe'))
    else:raise RuntimeError('Unknown archive type')
    for pattern in item['stage']:
        base=Path(pattern).name
        matches=[p for p in extracted.rglob('*') if p.is_file() and fnmatch.fnmatch(p.name,base)]
        if not matches:raise RuntimeError(f'{name}: missing staged pattern {pattern}')
        for source in matches:shutil.copyfile(source,args.output/source.name)
    print(f'Verified and staged {name} {item["version"]}',flush=True)
for name in ['ffmpeg.exe','ffprobe.exe','mpv.exe','gallery-dl.exe','libmpv-2.dll']:
    if not (args.output/name).is_file():raise RuntimeError('Incomplete helper runtime: '+name)
shutil.copyfile(root/'NOTICES.md',args.output/'THIRD-PARTY-NOTICES.md')
