# Exercises only the current-user Server installer on an ephemeral Windows
# runner. The Server registers and starts a scheduled task during install, so
# refuse to run if any existing AvtoHmver/Curator installation could be touched.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallerDirectory)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'The Server installer smoke may run only on an ephemeral GitHub-hosted Actions runner.'
}
$installerRoot = (Resolve-Path -LiteralPath $InstallerDirectory).Path
$installerMatches = @(Get-ChildItem -LiteralPath $installerRoot -Filter 'avtohmver-server-*-windows-current-user-setup.exe' -File)
if ($installerMatches.Count -ne 1) {
    throw "Expected exactly one current-user AvtoHmver Server installer; found $($installerMatches.Count)."
}
$installer = $installerMatches[0].FullName

$taskName = 'AvtoHmver Server (Current User)'
$legacyTaskName = 'Curator Server (Current User)'
$localRoot = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
$serverData = [System.IO.Path]::GetFullPath((Join-Path $localRoot 'AvtoHmver'))
$legacyData = [System.IO.Path]::GetFullPath((Join-Path $localRoot 'Curator'))
$installPath = [System.IO.Path]::GetFullPath((Join-Path $localRoot 'AvtoHmver Server'))
$legacyInstallPath = [System.IO.Path]::GetFullPath((Join-Path $localRoot 'Curator Server'))
$sentinel = Join-Path $serverData 'ci-server-preserve.txt'
$installOwnerMarker = Join-Path $installPath '.ci-server-installer-smoke-owner'
$fixtureToken = [guid]::NewGuid().ToString('N')
$port = 42168
$unregisterScript = Join-Path $PSScriptRoot 'Unregister-AvtoHmverServer.ps1'
$registrationCreated = $false
$dataCreated = $false
$installStarted = $false

function Get-Task([string]$Name) {
    Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
}

function Test-LocalPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    $pending = $null
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(600)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch {
        return $false
    } finally {
        if ($pending) { $pending.AsyncWaitHandle.Dispose() }
        $client.Dispose()
    }
}

function Assert-TaskTarget([string]$ExpectedExecutable) {
    $task = Get-Task $taskName
    if (-not $task) { throw 'The current-user Server scheduled task was not registered.' }
    $actual = [System.IO.Path]::GetFullPath($task.Actions[0].Execute)
    if (-not [string]::Equals($actual, $ExpectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The Server scheduled task targets an unexpected executable: $actual"
    }
}

function Get-SmokeServerProcesses([string]$ExpectedExecutable) {
    @(Get-Process -Name 'avtohmver-server' -ErrorAction SilentlyContinue | Where-Object {
        try { [string]::Equals([System.IO.Path]::GetFullPath($_.Path), $ExpectedExecutable, [StringComparison]::OrdinalIgnoreCase) }
        catch { $false }
    })
}

function Stop-SmokeServerProcesses([string]$ExpectedExecutable) {
    foreach ($process in (Get-SmokeServerProcesses $ExpectedExecutable)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ServerReady([string]$ExpectedExecutable) {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Assert-TaskTarget $ExpectedExecutable
        $task = Get-Task $taskName
        if ($task.State -eq 'Running' -and (Test-LocalPort $port)) {
            try {
                $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$port/api/system/info"
                $info = $response.Content | ConvertFrom-Json
                if ($response.StatusCode -eq 200 -and $info.edition -eq 'server') { return }
            } catch {
                # Startup is asynchronous; continue polling until the deadline.
            }
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The installed Server task did not expose its loopback system-info endpoint within 45 seconds.'
}

function Wait-ServerStopped([string]$ExpectedExecutable) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $serverProcesses = Get-SmokeServerProcesses $ExpectedExecutable
        if (-not (Test-LocalPort $port) -and $serverProcesses.Count -eq 0) { return }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The Server kept its loopback listener after the task was stopped or uninstalled.'
}

function Invoke-Installer([string]$Executable) {
    $process = Start-Process -FilePath $Executable -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Server NSIS installer failed with exit code $($process.ExitCode)." }
}

function Assert-DataSentinel {
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf) -or (Get-Content -LiteralPath $sentinel -Raw) -ne $fixtureToken) {
        throw 'Server install, upgrade, or uninstall removed the current-user data sentinel.'
    }
}

# Do not replace/remove any registration, data, install, or listener that may
# belong to an existing user installation. These guards are required because
# the production current-user registration script replaces its named task.
foreach ($environmentName in @(
    'CURATOR_CONFIG_DIR', 'CURATOR_DATA_DIR', 'CURATOR_INSTALL_SCOPE',
    'AVTOHMVER_CONFIG_DIR', 'AVTOHMVER_DATA_DIR', 'AVTOHMVER_INSTALL_SCOPE'
)) {
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($environmentName))) {
        throw "Refusing the Server installer smoke because $environmentName changes the data or install scope."
    }
}
if (Get-Task $taskName) { throw "Refusing to replace existing task '$taskName'." }
if (Get-Task $legacyTaskName) { throw "Refusing to replace existing task '$legacyTaskName'." }
foreach ($serviceName in @('AvtoHmverServer', 'CuratorServer')) {
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
        throw "Refusing the current-user smoke while service '$serviceName' exists."
    }
}
if (Test-Path -LiteralPath $installPath) { throw "Refusing to use existing install directory '$installPath'." }
if (Test-Path -LiteralPath $legacyInstallPath) { throw "Refusing to run beside legacy install directory '$legacyInstallPath'." }
if (Test-Path -LiteralPath $serverData) { throw "Refusing to use existing user data directory '$serverData'." }
if (Test-Path -LiteralPath $legacyData) { throw "Refusing to use legacy user data directory '$legacyData'." }
if (Test-LocalPort $port) { throw "Refusing to start the smoke Server because loopback port $port is already occupied." }

try {
    New-Item -ItemType Directory -Path $serverData | Out-Null
    $dataCreated = $true
    Set-Content -LiteralPath $sentinel -Value $fixtureToken -NoNewline

    $installStarted = $true
    Invoke-Installer $installer
    $serverExecutable = Join-Path $installPath 'avtohmver-server.exe'
    foreach ($required in @(
        $serverExecutable,
        (Join-Path $installPath 'static\index.html'),
        (Join-Path $installPath 'Uninstall AvtoHmver Server.exe')
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Server install is missing required file '$required'."
        }
    }
    Set-Content -LiteralPath $installOwnerMarker -Value $fixtureToken -NoNewline
    $registrationCreated = $true
    Wait-ServerReady $serverExecutable
    Assert-DataSentinel

    # Stop the smoke-owned instance before replacing its executable. The
    # current-user task is ours because preflight required it to be absent.
    Stop-ScheduledTask -TaskName $taskName
    Wait-ServerStopped $serverExecutable
    Invoke-Installer $installer
    Wait-ServerReady $serverExecutable
    Assert-DataSentinel

    $uninstaller = Join-Path $installPath 'Uninstall AvtoHmver Server.exe'
    Invoke-Installer $uninstaller
    Wait-ServerStopped $serverExecutable
    if (Get-Task $taskName) { throw 'Server uninstall left its scheduled task registered.' }
    if (Test-Path -LiteralPath $serverExecutable) { throw 'Server uninstall left its executable installed.' }
    Assert-DataSentinel
    if (-not (Test-Path -LiteralPath $installOwnerMarker -PathType Leaf) -or (Get-Content -LiteralPath $installOwnerMarker -Raw) -ne $fixtureToken) {
        throw 'The Server installer smoke lost its install ownership marker.'
    }
    $leftoverFiles = @(Get-ChildItem -LiteralPath $installPath -Force | Where-Object { $_.FullName -ne $installOwnerMarker })
    if ($leftoverFiles.Count -ne 0) { throw 'Server uninstall left files in the install directory.' }
    Remove-Item -LiteralPath $installOwnerMarker
    Remove-Item -LiteralPath $installPath
} finally {
    if ($registrationCreated -or (Get-Task $taskName)) {
        $installedUnregister = Join-Path $installPath 'Unregister-AvtoHmverServer.ps1'
        $cleanupRegistration = if (Test-Path -LiteralPath $installedUnregister -PathType Leaf) { $installedUnregister } else { $unregisterScript }
        if (Test-Path -LiteralPath $cleanupRegistration -PathType Leaf) {
            try {
                & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File $cleanupRegistration -Scope CurrentUser
            } catch {
                Write-Warning "Could not clean the smoke-owned Server task: $($_.Exception.Message)"
            }
        }
        try { Wait-ServerStopped (Join-Path $installPath 'avtohmver-server.exe') } catch { Write-Warning $_.Exception.Message }
    }

    # Both paths were required to be absent before the smoke. Preserve them if
    # registration cleanup did not stop the Server or if either path became
    # a reparse point unexpectedly.
    if ($installStarted -and (Test-Path -LiteralPath $installPath)) {
        $uninstaller = Join-Path $installPath 'Uninstall AvtoHmver Server.exe'
        if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
            try { Invoke-Installer $uninstaller } catch { Write-Warning "Could not finish smoke uninstallation: $($_.Exception.Message)" }
        }
    }
    Stop-SmokeServerProcesses (Join-Path $installPath 'avtohmver-server.exe')
    try { Wait-ServerStopped (Join-Path $installPath 'avtohmver-server.exe') } catch { Write-Warning $_.Exception.Message }
    if (Test-Path -LiteralPath $installPath) {
        $item = Get-Item -LiteralPath $installPath -Force
        $isDirectChild = [string]::Equals([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($installPath)), $localRoot, [StringComparison]::OrdinalIgnoreCase)
        $smokeProcesses = Get-SmokeServerProcesses (Join-Path $installPath 'avtohmver-server.exe')
        $ownerMatches = Test-Path -LiteralPath $installOwnerMarker -PathType Leaf
        if ($ownerMatches) { $ownerMatches = (Get-Content -LiteralPath $installOwnerMarker -Raw) -eq $fixtureToken }
        if ($isDirectChild -and $ownerMatches -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and -not (Get-Task $taskName) -and -not (Test-LocalPort $port) -and $smokeProcesses.Count -eq 0) {
            $leftoverFiles = @(Get-ChildItem -LiteralPath $installPath -Force | Where-Object { $_.FullName -ne $installOwnerMarker })
            if ($leftoverFiles.Count -eq 0) {
                Remove-Item -LiteralPath $installOwnerMarker -Force
                try { Remove-Item -LiteralPath $installPath -Force } catch { Write-Warning 'Kept the Server install directory because it was not empty.' }
            } else {
                Write-Warning 'Kept the Server install directory because files remained after the uninstaller.'
            }
        } else {
            Write-Warning 'Kept the Server install directory because cleanup could not prove it was safe to remove.'
        }
    }
    if ($dataCreated -and (Test-Path -LiteralPath $serverData)) {
        $item = Get-Item -LiteralPath $serverData -Force
        $isDirectChild = [string]::Equals([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($serverData)), $localRoot, [StringComparison]::OrdinalIgnoreCase)
        $smokeProcesses = Get-SmokeServerProcesses (Join-Path $installPath 'avtohmver-server.exe')
        $ownerMatches = Test-Path -LiteralPath $sentinel -PathType Leaf
        if ($ownerMatches) { $ownerMatches = (Get-Content -LiteralPath $sentinel -Raw) -eq $fixtureToken }
        if ($isDirectChild -and $ownerMatches -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and -not (Get-Task $taskName) -and -not (Test-LocalPort $port) -and $smokeProcesses.Count -eq 0) {
            Remove-Item -LiteralPath $serverData -Recurse -Force
        } else {
            Write-Warning 'Kept the smoke-owned data directory because cleanup could not prove it was safe to remove.'
        }
    }
}
