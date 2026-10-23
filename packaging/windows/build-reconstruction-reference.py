"""Stage fanservice Server, Unreal Viewer and combined Host without touching saves.

Run after cargo release and Unreal BuildCookRun. Each output directory must be
new; installer uninstall lists contain only the files staged by this script.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--tools', type=Path, required=True)
parser.add_argument('--viewer', type=Path, help='Cooked Windows directory containing CockHeroRecovered.exe')
parser.add_argument('--makensis', type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

def copy_tree(source, target):
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if any(part in {'Saved', '.git', 'Intermediate', '__pycache__'} for part in relative.parts):
            continue
        if path.is_file():
            dest = target / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)

def nsis_string(value):
    return str(value).replace('$', '$$').replace('"', '$\\"')

for edition in (['Server', 'Viewer', 'Host'] if args.viewer else ['Server']):
    stage = args.output / ('fanservice-' + edition.lower())
    stage.mkdir()  # Never overwrite or recursively clear an existing installation.
    if edition in {'Server', 'Host'}:
        server = stage / 'Server'
        server.mkdir()
        shutil.copy2(ROOT / 'target/release/avtohmver-server.exe', server)
        copy_tree(ROOT / 'static', server / 'static')
        copy_tree(args.tools, server / 'tools')
    if edition in {'Viewer', 'Host'}:
        if not (args.viewer / 'CockHeroRecovered.exe').is_file():
            raise RuntimeError('Viewer must be a cooked Windows directory with CockHeroRecovered.exe')
        copy_tree(args.viewer, stage / 'Viewer')
    shutil.copy2(ROOT / 'LICENSE', stage / 'LICENSE')
    copy_tree(ROOT / 'static/fanservice/assets', stage / 'PresentationSources')
    copy_tree(ROOT / 'docs/fanservice', stage / 'Documentation')
    launcher = """param([string]$Server='http://127.0.0.1:42168',[string]$VoicePack='',[switch]$Library)
$ErrorActionPreference='Stop'
$root=Split-Path $MyInvocation.MyCommand.Path -Parent
$uri=[Uri]$Server
if($uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment){throw 'Enter an HTTP(S) Server origin'}
$Server=$uri.GetLeftPart([UriPartial]::Authority)
"""
    if edition in {'Server', 'Host'}:
        launcher += """$serverPath=Join-Path $root 'Server/avtohmver-server.exe'
$running=Get-Process avtohmver-server -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $serverPath}
if(!$running){Start-Process -FilePath $serverPath -WorkingDirectory (Split-Path $serverPath) -WindowStyle Hidden}
if(([Uri]$Server).IsLoopback){
    $ready=$false
    for($attempt=0;$attempt -lt 60;$attempt++){
        try{$response=Invoke-WebRequest ($Server.TrimEnd('/')+'/api/fanservice/v1/capabilities') -UseBasicParsing -TimeoutSec 1;if($response.StatusCode -eq 200){$ready=$true;break}}catch{}
        Start-Sleep -Milliseconds 500
    }
    if(!$ready){throw 'Local fanservice Server did not become ready. Check its startup log and existing Server installations.'}
}
if($Library){Start-Process ($Server.TrimEnd('/')+'/');return}
"""
    if edition in {'Viewer', 'Host'}:
        launcher += """$uri=[Uri]$Server
if($uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment){throw 'Enter an HTTP(S) Server origin'}
$viewerPath=Join-Path $root 'Viewer/CockHeroRecovered.exe'
$media=Join-Path $env:LOCALAPPDATA 'fanservice/UserMedia'
$viewerArgs=@('-FanserviceViewer',('-FanserviceServer='+$uri.GetLeftPart([UriPartial]::Authority)),('-RecoveredSourceRoot="'+$media+'"'))
if(!$VoicePack){$VoicePack=Join-Path $env:LOCALAPPDATA 'fanservice/VoicePacks/active'}
if(Test-Path -LiteralPath (Join-Path $VoicePack 'manifest.json')){$viewerArgs+=('-FanserviceVoicePack="'+[IO.Path]::GetFullPath($VoicePack)+'"')}
Start-Process -FilePath $viewerPath -WorkingDirectory (Split-Path $viewerPath) -ArgumentList $viewerArgs
"""
    else:
        launcher += "Start-Process ($Server.TrimEnd('/')+'/')\n"
    (stage / 'Start fanservice.ps1').write_text(launcher, encoding='utf-8')
    (stage / 'Start fanservice.cmd').write_text('@echo off\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start fanservice.ps1" %*\r\n')
    (stage / 'README.txt').write_text(
        f'fanservice {edition}\nStart with Start fanservice.cmd. Viewer accepts -Server https://your-server-origin.\n'
        'Existing AvtoHmver configuration/library locations and Unreal save identity are retained.\n'
        'Uninstall removes packaged files only; library data, profiles and downloaded snapshots are retained.\n'
        'Android/PWA parity and physical device checks are documented separately; this package does not certify them.\n')
    files = sorted(p for p in stage.rglob('*') if p.is_file())
    with zipfile.ZipFile(stage.with_suffix('.zip'), 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(stage).as_posix(), (2026, 10, 22, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    if args.makensis:
        installer = args.output / f'fanservice-{edition.lower()}-setup.exe'
        lines = ['Unicode true', 'RequestExecutionLevel user', 'SetCompressor /SOLID lzma',
                 f'Name "fanservice {edition}"', f'OutFile "{nsis_string(installer.resolve())}"',
                 f'InstallDir "$LOCALAPPDATA\\fanservice {edition}"', 'Page directory', 'Page instfiles',
                 'UninstPage uninstConfirm', 'UninstPage instfiles', 'Section', 'SetOutPath "$INSTDIR"',
                 f'File /r "{nsis_string(stage.resolve())}\\*"',
                 'WriteUninstaller "$INSTDIR\\Uninstall.exe"',
                 f'CreateShortcut "$SMPROGRAMS\\fanservice {edition}.lnk" "$INSTDIR\\Start fanservice.cmd" "" "$INSTDIR\\PresentationSources\\fanservice.ico"',
                 'SectionEnd', 'Section "Uninstall"']
        if edition == 'Host':
            lines.insert(lines.index('SectionEnd'), 'CreateShortcut "$SMPROGRAMS\\fanservice Library.lnk" "$INSTDIR\\Start fanservice.cmd" "-Library" "$INSTDIR\\PresentationSources\\fanservice.ico"')
            lines.append('Delete "$SMPROGRAMS\\fanservice Library.lnk"')
        for path in files:
            lines.append('Delete "$INSTDIR\\' + nsis_string(path.relative_to(stage)).replace('/', '\\') + '"')
        lines += [f'Delete "$SMPROGRAMS\\fanservice {edition}.lnk"', 'Delete "$INSTDIR\\Uninstall.exe"']
        directories = sorted((p for p in stage.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True)
        for directory in directories:
            lines.append('RMDir "$INSTDIR\\' + nsis_string(directory.relative_to(stage)).replace('/', '\\') + '"')
        lines += ['RMDir "$INSTDIR"', 'SectionEnd']
        script = args.output / f'fanservice-{edition.lower()}.nsi'
        script.write_text('\n'.join(lines), encoding='utf-8')
        nsis_env = dict(os.environ, NSISDIR=str(args.makensis.resolve().parent))
        subprocess.run([str(args.makensis.resolve()), str(script.resolve())], check=True, env=nsis_env)
artifacts = sorted(p for p in args.output.iterdir() if p.is_file() and p.suffix in {'.zip', '.exe', '.apk'})
(args.output / 'SHA256SUMS.txt').write_text(''.join(hashlib.file_digest(p.open('rb'), 'sha256').hexdigest() + '  ' + p.name + '\n' for p in artifacts))
