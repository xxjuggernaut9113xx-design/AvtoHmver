# Original v0.05 music-session integration

Latest acceptance: [October 29 combined media/music lifecycle](NATIVE_MEDIA_V005_20261029.md) records real Server conversion/delivery reaching a 24-beat original Playlist run, native video promotion through cycle events, original Unlocks purchase/toggles, process-restart persistence and owned-cache uninstall. This document retains the preceding implementation checkpoints.

## Server delivery implemented

`mod/native/music-delivery.mjs` fetches the selected track's confirmed `/api/fanservice/v1/music/{id}/manifest` and original recording from one configured Server origin. It verifies the original SHA1 before conversion, converts unsupported source audio to native-compatible 44.1 kHz stereo PCM16 WAV with an explicitly selected FFmpeg executable, validates the resulting WAV and duration, and re-fetches the confirmed manifest before publishing. A changed recording or confirmation, failed conversion, oversized response or existing output folder is rejected. Original and converted recording identities remain distinct in the result.

```powershell
node mod/native/music-delivery.mjs 'http://127.0.0.1:42169' 1 'E:/fanservice-mod-lab/game/CockHero/beatmaps/NEW_PACK_DIRECTORY' 'C:/Users/webma/scoop/shims/ffmpeg.exe'
```

The destination must be a new folder under the library actually scanned by the selected game. The worker does not purchase/enable media, alter the game or bypass Import access. The game must refresh/rescan its library or restart before a newly delivered track can be selected. Automatic music delivery is implemented as an explicit CLI operation; a Server selection button, native refresh integration and ownership-aware media delivery are still pending.

All 25 combined export/delivery/host tests pass. The real Rust Server fixture also passed AAC-to-WAV delivery, including source recording identity, three confirmed beats, conversion, WAV bounds and output validation. The repeatable `tests/fanservice_native_music_delivery.cjs` is wired into `tests/run_fanservice_ci.py`; the runner's fresh isolated Server test passed and cleaned up its own process. Local output is retained at `E:/fanservice-mod-lab/v005-server-delivery-ci/`. No user library or music was used.

## Original session acceptance passed

After the user cleared startup age confirmation, Computer Use navigated the original `Start Game > Playlist > Manage` controls, found and selected `fanservice neutral import`, chose one round, and started the run. The isolated profile had no enabled media, so the game continued with blank media for this audio-only test.

The native log confirms the configured library root `game/CockHero/beatmaps`, the three-beat map, a 44.1 kHz stereo 12-second WAV, the two-second intro lead-in, the first audio-clock callback, song completion and playback stopping at exactly `12.000s`. The original Victory summary showed three strokes, highest combo three and a fourteen-second run including lead-in. The game was returned through its original Return to Menu control and remains open on the left screen.

Evidence: `evidence/native-v005-music-session-20261027.json`. This proves the exported neutral recording enters the original v0.05 Music session through its normal selection flow and reaches its native end/summary. It does not prove pause/seek/reconnect behavior, automatic Server delivery, fanservice media selection or full mod compatibility. Earlier pending-playback statements below describe the preceding checkpoint.

## Runtime correction: active scan path

The first staging used the native default-root helper without checking the actual menu/library initialization path. That was insufficient. The real v0.05 startup log explicitly scans `E:/fanservice-mod-lab/game/CockHero/beatmaps`. After adding the neutral pack there, a fresh exact-build launch found eleven JSON files, loaded `fanservice neutral import` with three beats and `Audio: OK`, and reported eleven valid beatmaps. This is verified native library import; audible playback and session behavior remain pending. Retained evidence: `evidence/native-v005-library-import-20261027.json`.

The user also had the separate v0.04 test process open when asked to check the v0.05 music menu. It is no longer running; the correct isolated v0.05 game has been launched on the left screen with a separate music-test profile. The updated Computer Use runtime initializes successfully. Its startup age confirmation is left to the user under the computer-use guidance.

Future automatic library integration must use the actual configured/scanned library path. The statically derived fallback helper described below does not establish the root selected by the original menu or caller.

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

The input must be the confirmed `/api/fanservice/v1/music/{id}/manifest` manifest and the exact original recording identified by its `recording_id`; a transcoded stream has different bytes and is rejected. The tool does not install a mod or operate game menus. Its result explicitly reports `native_acceptance: pending`. The library validator lists WAV/Ogg/MP3, but the actual music decoder rejects non-WAV files. This exporter accepts only standard mono/stereo 16-bit PCM WAV and validates its chunks and duration. Odd-sized chunks before the data payload are rejected because the native scanner does not account for padding. Non-WAV Server recordings still need an explicit conversion step.

Seven contract tests pass with `node --test mod/native/music-pack.test.mjs`, covering the original layout, duration preservation, recording mismatch, invalid maps and preservation of an existing destination. A real neutral 44.1 kHz stereo PCM WAV pack was exported to `E:/fanservice-mod-lab/v005-music-export/neutral-pack/`. It contains three synthetic beats, no gameplay events, and has not yet been imported or played in v0.05.

The user's local Blow example passed read-only export-schema validation: 581 beats, 139 events, 219.97333333333333 seconds and 119.95 BPM. Its audio was not copied or committed. A local validation report is retained beside the neutral export evidence.

## Remaining acceptance

The native packaged-root resolver first honors a normalized project directory containing `CockHero.uproject`. Otherwise, it resolves the executable's `BaseDir/../..`, requires `Binaries` and `Content` there and `Engine` in its parent, and returns that parent. The default beatmap folder appends `beatmaps`. A configured library root can override this. For the existing isolated stock-layout v0.05 copy, the default is `E:/fanservice-mod-lab/game/beatmaps`, not `game/CockHero/beatmaps`.

A fresh neutral folder was staged at `E:/fanservice-mod-lab/game/beatmaps/fanservice-neutral-20261027`, with a SHA256 ownership receipt at `E:/fanservice-mod-lab/v005-music-export/staged-receipt.json`. No stock files were changed. Both the user's WAV example and the generated neutral WAV pass the native-safe PCM validation. Nonzero native offset semantics remain unverified; the exporter requires the Server's already-normalized zero-offset map.

Connect the Server selection/export to that original library, and validate the original Music menu, playback, pause/seek/end behavior, media selection, profile ownership, offline operation and uninstall in an isolated v0.05 installation. Preserve existing Import entitlement checks. The v0.04 helper and its exact-build hashes are not reusable as v0.05 support. `supported_builds` stays empty until the required native acceptance passes.

Seven export tests and thirteen existing host tests pass together. A fresh Computer Use retry still failed before initialization with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. The user was asked to check the staged neutral item through the original Music menu; that result is pending. No new game launch or menu action was performed during this export work.
