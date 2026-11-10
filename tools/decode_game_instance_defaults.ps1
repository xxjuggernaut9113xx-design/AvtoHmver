param(
    [Parameter(Mandatory)] [string] $ApiDirectory,
    [Parameter(Mandatory)] [string] $Mapping,
    [Parameter(Mandatory)] [string] $AssetPath
)
$ErrorActionPreference = 'Stop'
$assembly = [Reflection.Assembly]::LoadFrom((Join-Path $ApiDirectory 'UAssetAPI-bundled.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $ApiDirectory 'ZstdSharp-bundled.dll'))
$map = [Activator]::CreateInstance($assembly.GetType('UAssetAPI.Unversioned.Usmap'), @($Mapping))
$version = [Enum]::Parse($assembly.GetType('UAssetAPI.UnrealTypes.EngineVersion'), 'VER_UE5_3')
$flags = [Enum]::ToObject($assembly.GetType('UAssetAPI.CustomSerializationFlags'), 0)
$asset = [Activator]::CreateInstance($assembly.GetType('UAssetAPI.UAsset'), @($AssetPath, $version, $map, $flags))
$reader = $asset.PathToReader($AssetPath, $true)
try {
    $index = 0
    while ($index -lt $asset.Exports.Count -and $asset.Exports[$index].ObjectName.ToString() -ne 'Default__BP_CHGameInstance_C') { $index++ }
    if ($index -eq $asset.Exports.Count) { throw 'GameInstance CDO not found' }
    $asset.ConvertExportToChildExportAndRead($reader, $index, $false)
    $reader.BaseStream.Position = $asset.Exports[$index].SerialOffset
    $asset.Exports[$index].Read($reader, $index)
    $decoded = $asset.SerializeJson($true) | ConvertFrom-Json
    $cdo = $decoded.Exports | Where-Object ObjectName -eq 'Default__BP_CHGameInstance_C'
    $remaining = $cdo.SerialOffset + $cdo.SerialSize - $reader.BaseStream.Position
    if ($remaining -ne 4 -or $cdo.Extras -ne 'AAAAAA==') { throw 'Unexpected CDO trailing bytes' }
    [ordered]@{
        evidence_kind = 'static class-default-object decode; no runtime acceptance'
        asset_sha256 = (Get-FileHash -LiteralPath $AssetPath -Algorithm SHA256).Hash
        uexp_sha256 = (Get-FileHash -LiteralPath ([IO.Path]::ChangeExtension($AssetPath, '.uexp')) -Algorithm SHA256).Hash
        mapping_sha256 = (Get-FileHash -LiteralPath $Mapping -Algorithm SHA256).Hash
        api_sha256 = (Get-FileHash -LiteralPath (Join-Path $ApiDirectory 'UAssetAPI-bundled.dll') -Algorithm SHA256).Hash
        serial_offset = $cdo.SerialOffset
        serial_size = $cdo.SerialSize
        final_reader_position = $reader.BaseStream.Position
        trailing_bytes_base64 = $cdo.Extras
        properties = @($cdo.Data | Where-Object { $_.Name -like 'Objective_*' -or $_.Name -in @('DoesNotCummingInWindowResetObjective?', 'GameModeSelection') } | Select-Object Name, Value, IsZero)
    } | ConvertTo-Json -Depth 8
}
finally { $reader.Dispose() }
