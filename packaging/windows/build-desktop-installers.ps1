# Builds the Curator Host and Curator Viewer NSIS installers (current-user
# and all-users) from already-compiled binaries. Optionally stages a
# pre-fetched tools directory (ffmpeg, ffprobe, mpv, gallery-dl) into the
# Host installer; see packaging/bundles/fetch-tools.ps1.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$HostBinary,

    [Parameter(Mandatory = $true)]
    [string]$ViewerBinary,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$ToolsDirectory,

    [string]$Version
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $scriptRoot)

foreach ($binary in @($HostBinary, $ViewerBinary)) {
    $resolved = (Resolve-Path -LiteralPath $binary -ErrorAction SilentlyContinue)
    if (-not $resolved) { throw "Curator executable was not found: $binary" }
}

function Find-MakeNSIS {
    foreach ($name in @('makensis.exe', 'makensis')) {
        $command = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($command) { return $command.Source }
    }
    $programFilesRoots = @(
        [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86),
        [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    ) | Where-Object { $_ }
    foreach ($root in $programFilesRoots) {
        $candidate = Join-Path $root 'NSIS\makensis.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

$nsis = Find-MakeNSIS
if (-not $nsis) {
    throw 'makensis is required to build Curator desktop installers. Install NSIS or add makensis.exe to PATH.'
}

if (-not $Version) {
    $cargo = Get-Content -LiteralPath (Join-Path $repositoryRoot 'Cargo.toml') -Raw
    $match = [regex]::Match($cargo, '(?ms)^\[workspace\.package\].*?^version\s*=\s*"([^"]+)"')
    if (-not $match.Success) { throw 'Could not read the workspace version from Cargo.toml.' }
    $Version = $match.Groups[1].Value
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("curator-desktop-nsis-" + [guid]::NewGuid().ToString('N'))

$editions = @(
    @{ Name = 'host'; Binary = $HostBinary; Exe = 'Curator.exe'; Nsi = 'curator-host.nsi'; BundleTools = $true },
    @{ Name = 'viewer'; Binary = $ViewerBinary; Exe = 'curator-viewer.exe'; Nsi = 'curator-viewer.nsi'; BundleTools = $false }
)

try {
    foreach ($edition in $editions) {
        foreach ($scope in @('current-user', 'all-users')) {
            $stage = Join-Path $stageRoot "$($edition.Name)-$scope"
            New-Item -ItemType Directory -Force -Path $stage | Out-Null
            Copy-Item -LiteralPath (Resolve-Path -LiteralPath $edition.Binary).Path `
                -Destination (Join-Path $stage $edition.Exe)
            Copy-Item -LiteralPath (Join-Path $repositoryRoot 'desktop\icons\icon.ico') `
                -Destination $stage
            if ($edition.BundleTools -and $ToolsDirectory -and (Test-Path -LiteralPath $ToolsDirectory)) {
                Copy-Item -Path (Join-Path $ToolsDirectory '*') `
                    -Destination (Join-Path $stage 'tools') -Recurse -Force
            }

            $installer = Join-Path $resolvedOutput ("curator-$($edition.Name)-$Version-windows-$scope-setup.exe")
            $arguments = @(
                "/DCURATOR_STAGE=$stage",
                "/DPRODUCT_VERSION=$Version",
                "/DOUTPUT_FILE=$installer"
            )
            if ($scope -eq 'all-users') { $arguments += '/DALL_USERS' }
            & $nsis @arguments (Join-Path $scriptRoot $edition.Nsi)
            if ($LASTEXITCODE -ne 0) { throw "makensis failed for the $($edition.Name) $scope installer." }
        }
    }
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
