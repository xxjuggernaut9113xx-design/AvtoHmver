# Runs on an ephemeral Windows CI runner after the current-user NSIS installers
# are built. A unique user-data sentinel proves uninstall leaves the library.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallerDirectory)

$ErrorActionPreference = 'Stop'
$installers = (Resolve-Path -LiteralPath $InstallerDirectory).Path
$data = Join-Path $env:LOCALAPPDATA 'Curator'
New-Item -ItemType Directory -Force -Path $data | Out-Null
$sentinel = Join-Path $data ("ci-preserve-" + [guid]::NewGuid().ToString('N') + '.txt')
Set-Content -LiteralPath $sentinel -Value 'preserve on uninstall'

function Invoke-NSIS([string]$Executable) {
    $process = Start-Process -FilePath $Executable -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "NSIS failed with exit code $($process.ExitCode): $Executable" }
}

try {
    foreach ($edition in @(
        @{ Name = 'host'; Exe = 'Curator.exe'; Folder = 'Curator'; Tool = 'ffmpeg.exe' },
        @{ Name = 'viewer'; Exe = 'curator-viewer.exe'; Folder = 'Curator Viewer'; Tool = 'libmpv-2.dll' }
    )) {
        $installer = Get-ChildItem -LiteralPath $installers -Filter "curator-$($edition.Name)-*-windows-current-user-setup.exe" -File |
            Select-Object -First 1
        if (-not $installer) { throw "Missing $($edition.Name) current-user installer" }
        $installed = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $edition.Folder
        Invoke-NSIS $installer.FullName
        foreach ($required in @($edition.Exe, 'LICENSE', "tools\$($edition.Tool)", "Uninstall Curator $($edition.Name.Substring(0,1).ToUpper() + $edition.Name.Substring(1)).exe")) {
            if (-not (Test-Path -LiteralPath (Join-Path $installed $required) -PathType Leaf)) {
                throw "Missing installed $($edition.Name) file: $required"
            }
        }
        Invoke-NSIS $installer.FullName # same-version in-place upgrade
        if (-not (Test-Path -LiteralPath (Join-Path $installed $edition.Exe) -PathType Leaf)) {
            throw "$($edition.Name) upgrade removed its executable"
        }
        $uninstaller = Join-Path $installed ("Uninstall Curator " + $edition.Name.Substring(0,1).ToUpper() + $edition.Name.Substring(1) + '.exe')
        Invoke-NSIS $uninstaller
        if (Test-Path -LiteralPath (Join-Path $installed $edition.Exe)) {
            throw "$($edition.Name) uninstall left its executable"
        }
        if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
            throw "$($edition.Name) uninstall removed the user data sentinel"
        }
    }
} finally {
    Remove-Item -LiteralPath $sentinel -ErrorAction SilentlyContinue
}
