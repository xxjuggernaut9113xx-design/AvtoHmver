# Current GameInstance class defaults

Bounded static evidence for #45. The extracted current GameInstance class exposes 49 local fields. The old mapping exposed only 16. `tools/recover_game_instance_schema.py` replaces only that class schema using its extracted `LoadedProperties`; negative type references resolve through `Imports[-index-1]`. The existing six-field engine `GameInstance` schema, enum records and all other schemas remain unchanged. Field type IDs were checked against the bundled API's `UAssetAPI.Unversioned.EPropertyType`.

The resulting class-default-object decode completes without an exception. Property reading ends at 29,120 for a 566-byte export starting at 28,558; four zero bytes remain as recorded `Extras`. This is not an exact-consumption claim. Source and dependency hashes, values and limits are recorded in [the JSON evidence](game-instance-current-defaults-20261110.json).

The CDO serializes Timer=10 seconds, Strokes=500, Edges=500, Prejac=5 seconds, Succubus=1, Ruins=5 and Tributes=5. The missed-window reset flag is true. These are class initialization values. They do not establish the normal selection UI's defaults, slider bounds, remembered preferences or values assigned when starting gameplay. In particular, this does not justify replacing the Web app's 300-second selected Timer default with 10 seconds. `CurrentSessionObjective` is absent from the decoded property list; this report does not infer an objective enum value.

## Reproduction

Run from the repository root with the existing local extracted artifacts. Choose a new output path: the patcher rejects an existing output and preserves the original mapping and metadata.

```powershell
python tools/recover_game_instance_schema.py .test-tmp/current-fixed.usmap .test-tmp/current-game-instance-converted.json .test-tmp/game-instance-current-49-recheck.usmap
./tools/decode_game_instance_defaults.ps1 -ApiDirectory "$PWD/.test-tmp" -Mapping "$PWD/.test-tmp/game-instance-current-49-recheck.usmap" -AssetPath "$PWD/.test-tmp/current-game-instance-extract/CockHero/Content/NewSetup/BP_CHGameInstance.uasset"
```

The decoder uses UAssetAPI with `VER_UE5_3` and combines the `.uasset` and `.uexp` via `PathToReader(path,true)`. It fails on unexpected trailing data or a decode exception. The generated mapping's expected SHA-256 is `643F52A32A475B89797EB13956F9D62D30C3528D9A83497339711D4FB6F935A2`.

No original game was executed. The extracted asset has not been cryptographically linked to an executable in this pass. Selection limits, full clock accounting, release-window duration, rewards and normal-flow objective acceptance remain open under #45.
