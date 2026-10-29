[CmdletBinding()]
param([switch]$StartGame, [switch]$Stop, [string]$CompanionDataRoot, [string]$FFmpeg)
$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath($PSScriptRoot)
$runtimeParent=Get-Item -LiteralPath $runtime
while ($runtimeParent) {
    if ($runtimeParent -isnot [IO.DirectoryInfo] -or ($runtimeParent.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Native companion runtime directory must not contain linked path components.' }
    $runtimeParent=$runtimeParent.Parent
}
$gameRoot = [IO.Path]::GetFullPath((Join-Path $runtime '../../../../../..'))
$hostFile = Join-Path $runtime 'Native/host.mjs'
if (!(Test-Path -LiteralPath $hostFile -PathType Leaf)) { throw 'Native companion files are missing. Install the complete runtime component.' }
if (!(Test-Path -LiteralPath (Join-Path $gameRoot 'CockHero/Binaries/Win64/CockHero.exe') -PathType Leaf)) { throw 'This launcher must remain inside its installed Fanservice mod directory.' }
function Read-CompanionToken([string]$Path) {
    $stream = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($stream.Length -ne 32) { throw 'The helper ownership token is invalid and was retained.' }
        $bytes=New-Object byte[] 32
        $count=$stream.Read($bytes,0,32)
        $value=[Text.Encoding]::ASCII.GetString($bytes)
        if ($count -ne 32 -or $value -notmatch '^[a-f0-9]{32}$') { throw 'The helper ownership token changed or is invalid.' }
        return $value
    } finally { $stream.Dispose() }
}
function Archive-StaleCompanion {
    $lockPath=Join-Path $runtime '.fanservice-companion.host.lock'
    if (!(Test-Path -LiteralPath $lockPath -PathType Leaf)) { return $false }
    $streams=[Collections.Generic.List[IO.FileStream]]::new()
    $paths=[Collections.Generic.List[string]]::new()
    try {
        try { $stream=[IO.File]::Open($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Delete) }
        catch [IO.IOException] {
            $code=$_.Exception.HResult -band 65535
            if ($code -eq 32 -or $code -eq 33) { return $false }
            throw
        }
        $streams.Add($stream)
        if ((Get-Item -LiteralPath $lockPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked helper ownership files were retained.' }
        if ($stream.Length -ne 32) { throw 'The stale helper ownership token is invalid and was retained.' }
        $bytes=New-Object byte[] 32
        if ($stream.Read($bytes,0,32) -ne 32) { throw 'The stale helper ownership token changed.' }
        $owner=[Text.Encoding]::ASCII.GetString($bytes)
        if ($owner -notmatch '^[a-f0-9]{32}$') { throw 'The stale helper ownership token is invalid and was retained.' }
        foreach ($name in @('.fanservice-companion.ready','.fanservice-companion.shutdown')) {
            $path=Join-Path $runtime $name
            if (!(Test-Path -LiteralPath $path)) { continue }
            if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked helper ownership files were retained.' }
            $file=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Delete)
            $streams.Add($file)
            $expected=if ($name -eq '.fanservice-companion.ready') { $owner } else { "FANSERVICE_COMPANION_STOP_1`n$owner" }
            $expectedBytes=[Text.Encoding]::UTF8.GetBytes($expected)
            if ($file.Length -ne $expectedBytes.Length) { throw 'Foreign helper readiness or shutdown data was retained.' }
            $content=New-Object byte[] $expectedBytes.Length
            if ($file.Read($content,0,$content.Length) -ne $content.Length -or [Text.Encoding]::UTF8.GetString($content) -cne $expected) { throw 'Foreign helper readiness or shutdown data was retained.' }
            $paths.Add($path)
        }
        $paths.Add($lockPath)
        $archiveRoot=Join-Path $runtime '.fanservice-stale-helper'
        if (Test-Path -LiteralPath $archiveRoot) {
            $item=Get-Item -LiteralPath $archiveRoot
            if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The helper recovery directory is not an ordinary owned directory.' }
        } else { New-Item -ItemType Directory -Path $archiveRoot | Out-Null }
        $archive=Join-Path $archiveRoot ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $archive | Out-Null
        foreach ($path in $paths) { [IO.File]::Move($path,(Join-Path $archive ([IO.Path]::GetFileName($path)))) }
        $script:staleArchive=$archive
        return $true
    } finally { foreach ($stream in $streams) { $stream.Dispose() } }
}
if (Archive-StaleCompanion) {
    Write-Output "Stale helper ownership files were preserved in $script:staleArchive. Profiles and snapshots were retained."
    if ($Stop) { return }
}
if ($Stop) {
    $lock = Join-Path $runtime '.fanservice-companion.host.lock'
    if (!(Test-Path -LiteralPath $lock -PathType Leaf)) { Write-Output 'Native companion is not running.'; return }
    $lockStream = [IO.File]::Open($lock, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($lockStream.Length -ne 32) { throw 'The helper lock is invalid and was retained for inspection.' }
        $lockBytes = New-Object byte[] 32
        $read = 0
        while ($read -lt 32) {
            $count = $lockStream.Read($lockBytes, $read, 32 - $read)
            if ($count -eq 0) { throw 'The helper lock changed during inspection.' }
            $read += $count
        }
        $owner = [Text.Encoding]::ASCII.GetString($lockBytes)
    } finally { $lockStream.Dispose() }
    if ($owner -notmatch '^[a-f0-9]{32}$') { throw 'The helper lock is invalid and was retained for inspection.' }
    $shutdown = Join-Path $runtime '.fanservice-companion.shutdown'
    $shutdownTemporary = $shutdown + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $temporaryCreated = $false
    try {
        $stream = [IO.File]::Open($shutdownTemporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $temporaryCreated = $true
        try { $bytes=[Text.Encoding]::UTF8.GetBytes("FANSERVICE_COMPANION_STOP_1`n$owner");$stream.Write($bytes,0,$bytes.Length);$stream.Flush() } finally { $stream.Dispose() }
        [IO.File]::Move($shutdownTemporary,$shutdown)
    } finally {
        if ($temporaryCreated -and (Test-Path -LiteralPath $shutdownTemporary -PathType Leaf)) { Remove-Item -LiteralPath $shutdownTemporary }
    }
    for ($attempt=0;$attempt -lt 100;$attempt++) { if (!(Test-Path -LiteralPath $lock)) { Write-Output 'Native companion stopped. Companion profiles and snapshots were retained.';return };Start-Sleep -Milliseconds 100 }
    throw 'The helper has not stopped yet. Its lock and companion data were retained; inspect its diagnostics before modifying the runtime.'
}
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$version = & $node --version
if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Install Node.js 22 or newer before starting the native companion.' }
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.ExecutablePath -eq $node -and $_.CommandLine -match [regex]::Escape($hostFile) -and $_.CommandLine -match [regex]::Escape($runtime)
}
if ($existing -and $CompanionDataRoot -and $existing.CommandLine -notmatch [regex]::Escape($CompanionDataRoot)) { throw 'A companion with a different data root is running. Stop it before switching profile storage.' }
if ($existing -and @($existing).Count -ne 1) { throw 'Multiple native helpers match this installation. Retain their files and inspect the running processes.' }
if (!$env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required for profile-bound companion storage.' }
$logs = Join-Path $env:LOCALAPPDATA 'fanservice/native/logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = [Guid]::NewGuid().ToString('N')
$outLog = Join-Path $logs ($stamp + '.out.log')
$errLog = Join-Path $logs ($stamp + '.err.log')
$arguments = @(('"' + $hostFile + '"'), '--runtime-dir', ('"' + $runtime + '"'), '--game-root', ('"' + $gameRoot + '"'), '--build-id', 'v0051-hotfix-public-a8f46896')
if ($FFmpeg) {
    if (![IO.Path]::IsPathRooted($FFmpeg)) { throw 'FFmpeg must be an absolute executable file path.' }
    $ffmpegItem = Get-Item -LiteralPath $FFmpeg -ErrorAction Stop
    if ($ffmpegItem -isnot [IO.FileInfo] -or ($ffmpegItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'FFmpeg must be an ordinary executable file.' }
    $arguments += @('--ffmpeg', ('"' + $ffmpegItem.FullName + '"'))
}
if ($CompanionDataRoot) {
    if (![IO.Path]::IsPathRooted($CompanionDataRoot)) { throw 'CompanionDataRoot must be an absolute directory.' }
    $arguments += @('--store-root', ('"' + $CompanionDataRoot + '"'))
}
if (!$existing) {
$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
} else { $process=Get-Process -Id $existing.ProcessId -ErrorAction Stop }
$readyPath=Join-Path $runtime '.fanservice-companion.ready'
$lockPath=Join-Path $runtime '.fanservice-companion.host.lock'
$ready=$false
for ($attempt=0;$attempt -lt 150;$attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw "Native companion exited before readiness (exit $($process.ExitCode)). Inspect $errLog. No game was started." }
    if ((Test-Path -LiteralPath $readyPath -PathType Leaf) -and (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        if ((Read-CompanionToken $readyPath) -ceq (Read-CompanionToken $lockPath)) { $ready=$true;break }
        throw 'Native companion readiness belongs to another ownership token. Files were retained.'
    }
    Start-Sleep -Milliseconds 100
}
if (!$ready) { throw "Native companion did not publish readiness. Its process and files were retained; inspect $errLog." }
Write-Output "Native companion ready. Process: $($process.Id)."
Write-Output 'Start the game normally. The companion does not open menus, change saves or operate age confirmation.'
if (!$existing) { Write-Output "Diagnostics: $errLog" }
if ($StartGame) {
    $gameExe = Join-Path $gameRoot 'CockHero/Binaries/Win64/CockHero.exe'
    $running = Get-CimInstance Win32_Process -Filter "Name='CockHero.exe'" | Where-Object { $_.ExecutablePath -eq $gameExe }
    if ($running) { Write-Output 'The game is already running. Updated Lua loads on its next normal launch.' }
    else { Start-Process -FilePath $gameExe -WorkingDirectory (Split-Path $gameExe) -WindowStyle Normal }
}
