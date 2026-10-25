[CmdletBinding()]
param([switch]$StartGame, [switch]$Stop, [string]$CompanionDataRoot)
$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath($PSScriptRoot)
$gameRoot = [IO.Path]::GetFullPath((Join-Path $runtime '../../../../../..'))
$hostFile = Join-Path $runtime 'Native/host.mjs'
if (!(Test-Path -LiteralPath $hostFile -PathType Leaf)) { throw 'Native companion files are missing. Install the complete runtime component.' }
if (!(Test-Path -LiteralPath (Join-Path $gameRoot 'CockHero/Binaries/Win64/CockHero.exe') -PathType Leaf)) { throw 'This launcher must remain inside its installed Fanservice mod directory.' }
if ($Stop) {
    $lock = Join-Path $runtime '.fanservice-companion.host.lock'
    if (!(Test-Path -LiteralPath $lock -PathType Leaf)) { Write-Output 'Native companion is not running.'; return }
    $owner = [IO.File]::ReadAllText($lock)
    if ($owner -notmatch '^[a-f0-9]{32}$') { throw 'The helper lock is invalid and was retained for inspection.' }
    $shutdown = Join-Path $runtime '.fanservice-companion.shutdown'
    $stream = [IO.File]::Open($shutdown,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes=[Text.Encoding]::UTF8.GetBytes("FANSERVICE_COMPANION_STOP_1`n$owner");$stream.Write($bytes,0,$bytes.Length);$stream.Flush() } finally { $stream.Dispose() }
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
if ($existing) { Write-Output 'The native companion is already running for this installation.' }
if (!$env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required for profile-bound companion storage.' }
$logs = Join-Path $env:LOCALAPPDATA 'fanservice/native/logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = [Guid]::NewGuid().ToString('N')
$outLog = Join-Path $logs ($stamp + '.out.log')
$errLog = Join-Path $logs ($stamp + '.err.log')
$arguments = @(('"' + $hostFile + '"'), '--runtime-dir', ('"' + $runtime + '"'), '--game-root', ('"' + $gameRoot + '"'))
if ($CompanionDataRoot) {
    if (![IO.Path]::IsPathRooted($CompanionDataRoot)) { throw 'CompanionDataRoot must be an absolute directory.' }
    $arguments += @('--store-root', ('"' + $CompanionDataRoot + '"'))
}
if (!$existing) {
$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Write-Output "Native companion started. Process: $($process.Id)."
Write-Output 'Start the game normally. The companion does not open menus, change saves or operate age confirmation.'
Write-Output "Diagnostics: $errLog"
}
if ($StartGame) {
    $gameExe = Join-Path $gameRoot 'CockHero/Binaries/Win64/CockHero.exe'
    $running = Get-CimInstance Win32_Process -Filter "Name='CockHero.exe'" | Where-Object { $_.ExecutablePath -eq $gameExe }
    if ($running) { Write-Output 'The game is already running. Updated Lua loads on its next normal launch.' }
    else { Start-Process -FilePath $gameExe -WorkingDirectory (Split-Path $gameExe) -WindowStyle Normal }
}
