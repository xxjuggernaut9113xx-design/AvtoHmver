# Original v0.05 music-session integration

The user selected the original v0.05 Music session instead of a replacement v0.04 card scheduler. This supersedes the unresolved card-versus-full-song design choice. The full integration remains unfinished.

## Selected local build

Read-only SHA256 checks distinguish the two installations:

- `cock-hero-windows/Windows`: executable `a99dc13d2e396adab1da3614253bf114e3aaf986ad55dc9c3385e62f5af99b98`.
- `cock-hero-windows (1)/Windows`: executable `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`, matching the existing v0.05.1 Public candidate.

The second build contains native `UMusicModeManager`, `UBeatmapLibraryManager`, and `UBeatSpawnerManager.StartFromBeatmap` / `StartFromBeatmapWithMediaSync`. These specific symbols were absent from the bounded first-build search. This is static evidence, not a live music-session acceptance result.

The native `LoadBeatmap(JsonFilePath)` reads a file and calls `ParseBeatmapJson`. The parser recognizes `meta`, `beats`, and `events`; metadata includes `title`, `artist`, `author`, `audioFile`, `duration`, `bpm`, and `offset`. Beat/event entries include `time`, `type`, and optional `duration`; events additionally carry `value`. `StartPlayback` calls `LoadAudioFromDisk`, creates its original Quartz clock and sound component, and starts the original beatmap spawner. This provides an actual native integration path rather than a substitute scheduling policy.

Private analysis remains outside the repository at `E:/fanservice-mod-lab/v005-music-analysis/`, including matching symbol, reflected-property and focused call inventories. Original executables, PDBs, audio and private SDK files are not redistributed.

## Export bridge

`mod/native/music-pack.mjs` exports an already confirmed Server music manifest and its exact recording into a new original-format folder: `beatmap.json` and a relative `song` audio filename. It checks recording SHA1, ordered bounded timestamps, event types and durations, zero exported offset, source sizes and destination ownership. Numeric/boolean event values become strings for the native JSON representation. It preserves the confirmed absolute timestamps and refuses an existing output directory.

Run with Node.js 22 or newer:

```powershell
node mod/native/music-pack.mjs ABSOLUTE_MANIFEST_JSON ABSOLUTE_ORIGINAL_RECORDING NEW_ABSOLUTE_PACK_DIRECTORY
```

The input must be the confirmed `/api/fanservice/v1/music/{id}` manifest and the exact original recording identified by its `recording_id`; a transcoded stream has different bytes and is rejected. The tool does not install a mod or operate game menus. Its result explicitly reports `native_acceptance: pending`. The library validator lists WAV/Ogg/MP3, but the actual music decoder rejects non-WAV files. This exporter accepts only standard mono/stereo 16-bit PCM WAV and validates its chunks and duration. Odd-sized chunks before the data payload are rejected because the native scanner does not account for padding. Non-WAV Server recordings still need an explicit conversion step.

Seven contract tests pass with `node --test mod/native/music-pack.test.mjs`, covering the original layout, duration preservation, recording mismatch, invalid maps and preservation of an existing destination. A real neutral 44.1 kHz stereo PCM WAV pack was exported to `E:/fanservice-mod-lab/v005-music-export/neutral-pack/`. It contains three synthetic beats, no gameplay events, and has not yet been imported or played in v0.05.

The user's local Blow example passed read-only export-schema validation: 581 beats, 139 events, 219.97333333333333 seconds and 119.95 BPM. Its audio was not copied or committed. A local validation report is retained beside the neutral export evidence.

## Remaining acceptance

The native packaged-root resolver first honors a normalized project directory containing `CockHero.uproject`. Otherwise, it resolves the executable's `BaseDir/../..`, requires `Binaries` and `Content` there and `Engine` in its parent, and returns that parent. The default beatmap folder appends `beatmaps`. A configured library root can override this. For the existing isolated stock-layout v0.05 copy, the default is `E:/fanservice-mod-lab/game/beatmaps`, not `game/CockHero/beatmaps`.

A fresh neutral folder was staged at `E:/fanservice-mod-lab/game/beatmaps/fanservice-neutral-20261027`, with a SHA256 ownership receipt at `E:/fanservice-mod-lab/v005-music-export/staged-receipt.json`. No stock files were changed. Both the user's WAV example and the generated neutral WAV pass the native-safe PCM validation. Nonzero native offset semantics remain unverified; the exporter requires the Server's already-normalized zero-offset map.

Connect the Server selection/export to that original library, and validate the original Music menu, playback, pause/seek/end behavior, media selection, profile ownership, offline operation and uninstall in an isolated v0.05 installation. Preserve existing Import entitlement checks. The v0.04 helper and its exact-build hashes are not reusable as v0.05 support. `supported_builds` stays empty until the required native acceptance passes.

Seven export tests and thirteen existing host tests pass together. A fresh Computer Use retry still failed before initialization with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. The user was asked to check the staged neutral item through the original Music menu; that result is pending. No new game launch or menu action was performed during this export work.
