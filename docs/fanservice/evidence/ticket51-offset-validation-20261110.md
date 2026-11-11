# Ticket #51: native nonzero-offset semantics trace (2026-11-10)

## Result

No concrete discrepancy between the original build and the player was established,
so no code was changed. The native trace below is complete for every retained
routine that could read the beatmap offset field — and it ends at one unrecovered
body. Ticket #51 remains blocked on exactly that missing evidence.

## What the native code establishes

### (1) The field

- `FBeatmapMeta.Offset`: double (`FDoubleProperty`, reflection kind 11), struct
  offset `0x60` (96). Reflection symbol
  `?NewProp_Offset@Z_Construct_UScriptStruct_FBeatmapMeta_Statics@@2UFGenericPropertyParams@UECodeGen_Private@@B`
  at `0x14d1aaa50`, in
  `~/workspace/reJOIce/Analysis/ReferenceBuilds/newer-20261017/native-reflection-schemas.json`
  (`BeatmapMeta[7]`). Full layout: Title `0x00`, Artist `0x10`, Author `0x20`,
  Difficulty `0x30`, AudioFile `0x40`, Duration `0x50`, BPM `0x58`, Offset `0x60`.
  Units are seconds, on the same scale as Duration and beat/event times
  (`beatmap-contract.md` BM-02: metadata duration matches WAV data size / byte
  rate, so times are seconds).
- Exactly one retained routine reads the JSON key: `ParseBeatmapJson_UMusicModeManager`
  (`0x148302440`) in
  `native-music-helpers/0x148302440.c`, line ~300:
  `*(undefined8 *)(param_3 + 0x60) = uVar8;` where `uVar8` comes from
  `FUN_14147a330` (GetDoubleField) on the `offset` key, guarded by a
  `FUN_145e5b470` presence check — i.e. the key is optional; when absent the
  field keeps whatever the output struct held before the call. The retained
  `LoadBeatmap` body (`native-focused/0x1482fdff0.c`, call at line 108) does not
  show the output struct being zero-initialised, so a default for a missing key
  is **not** established by the retained bodies. All ten shipped beatmaps carry
  the key, so this is moot for the corpus.
- Shipped values (`beatmap-contract.md` BM-06): Instructions Unclear `+0.004`,
  Lil Brat `-0.013`, Pleasure Place `+0.016`, the other seven `0`. Instructions
  Unclear's first beat (`0.003999948501586914`) and first event already
  approximate `+0.004`, which is consistent with the authoring tool having
  baked the offset into the timestamps — but that is a corpus observation, not
  a runtime proof.

### (2) The parser does NOT apply the offset to timestamps

In `ParseBeatmapJson` (`0x148302440.c`): beat `time` is read into a local
(`uStack_220`) and copied verbatim into the `LoadedBeatmap.Beats` array
(`param_3 + 0x68`, record size `0x18`); event `time` is read into a local
(`uStack_268`) and copied verbatim into `LoadedBeatmap.Events`
(`param_3 + 0x78`, record size `0x28`). No arithmetic involving `param_3 + 0x60`
(Meta.Offset) occurs anywhere in the 874-line body. The only post-processing is
the two sorts at the end: `FUN_1482cbab0` (beats, by time) and `FUN_1482cbdc0`
(events, comparator `0x1482d2c40`, time then type priority within 0.0001 s).
This confirms the `native-music-contract.md` statement: "It copies metadata
Offset without modifying beat/event times."

### (3) No retained runtime body reads Meta.Offset

`LoadedBeatmap.Meta` sits at music-manager UObject `+0x238`, so Meta.Offset is
UObject `+0x298` (Tick secondary-base `+0x270`). A grep for `0x298` / `0x270`
over every retained `.c` body under `native-focused/`, `native-music-helpers/`,
`native-music-constructor/`, `native-music-break/`, `native-parser-array-helpers/`,
`native-event-comparator/`, `native-round-runtime/`, `native-loot/`,
`native-reward-helpers/`, `native-round-adaptive/`, `native-round-constructor/`,
`native-round-filters/` and `native-progression-runtime/` finds **no**
music-manager read of that field. The only `+0x270`/`+0x298` hits are
`CalculateRewardsForRound_URoundManager` (`native-round-runtime/0x1482d8190.c`,
reward-tier fields on `URoundManager`) and integer fields in
`native-progression-runtime/` — different objects, ruled out.

Per-body, what the retained code does instead of reading the offset:

- `Tick` (`native-focused/0x148315ac0.c`): beat enqueue eligibility is
  `beat.Time <= audioTime + LookaheadWindow` (UObject `+0x6b8`), using authored
  Time; `FBeatEvent.TargetHitTime = beat.Time + profileAdjustmentSeconds`
  (profile/latency quantity, music UObject `+0x6c8`, stored in seconds after a
  `×0.001` conversion — explicitly a separate quantity from metadata Offset per
  `native-music-contract.md`); event dispatch eligibility is
  `event.Time <= audioTime` with no adjustment; completion is
  `audioTime >= LoadedBeatmap.Meta.Duration` (Tick `+0x260`). No `+0x270` read.
- `StartPlayback` (`native-focused/0x148314390.c`): lead-in is
  `leadIn = max(IntroLeadInSeconds, 0)` from reflected property `+0x40`, whose
  constructor default is 2.0 s (`native-music-constructor/0x1482ce640.c` line 31:
  `param_1[8] = 0x4000000000000000`). The lead-in is an intro pre-roll, not an
  offset shift. No Meta.Offset read.
- `GetCurrentAudioTime` (`native-focused/0x1482e9b40.c`), `PausePlayback`
  (`0x148303850`), `ResumePlayback` (`0x14830cbd0`), `StopPlayback`
  (`0x148315400`), `HandleSongComplete` (`native-music-helpers/0x1482f9c00.c`),
  `OnAudioPlaybackPercent` (`0x1483020e0`), `OnQuartzPlaybackStarted`
  (`0x148302240`), `ScheduleDeferredAudioStart` (`0x14830f660`), `LoadBeatmap`
  (`0x1482fdff0.c`): none reads UObject `+0x298`. `LoadBeatmap`'s success log
  prints Duration (`+0x288`) and BPM (`+0x290`) and the beat/event counts, but
  not Offset.

### (4) Events and progression: still nothing establishes an offset effect

The retained native runtime log
(`~/workspace/AvtoHmver/docs/fanservice/evidence/native-v005-music-session-20261027.json`,
source log `E:/fanservice-mod-lab/v005-music-export/native-import-next.log`,
build SHA-256 `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`)
ran a **zero-offset** map ("fanservice neutral import", 3 beats, **0 events**,
12.0 s): "Audible playback started after 2.000s lead-in", "Song complete.
Duration: 12.0s", "Stopping playback at audio time: 12.000s". It verifies the
2.000 s `IntroLeadInSeconds` pre-roll and natural stop at audio duration, and
says nothing about nonzero offset, events, or progression under an offset.

## The precise missing piece (why #51 is still blocked)

The only routine that could still consume `LoadedBeatmap.Meta.Offset` is the
beat-spawner initialisation, and its body is **not retained** in the reference
build:

- `UBeatSpawnerManager::StartFromBeatmap` (`0x148321290`) and
  `UBeatSpawnerManager::StartFromBeatmapWithMediaSync` (`0x1483213f0`) exist
  only as PDB symbol addresses in `native-symbol-addresses.json` (entries
  `?StartFromBeatmap@UBeatSpawnerManager@@QEAAXPEAVUMusicModeManager@@N@Z` and
  `?StartFromBeatmapWithMediaSync@UBeatSpawnerManager@@QEAAXPEAVUMusicModeManager@@NPEAVUMediaPlaybackController@@@Z`)
  plus `exec` wrappers; no `.c` body exists anywhere under
  `Analysis/ReferenceBuilds/newer-20261017/`. `StartPlayback` calls them
  (`native-focused/0x148314390.c` references `0x148321290`), so the call edge is
  established but the callee is opaque.
- Related loose end, also unresolved: `UBeatSpawnerManager::TimelineOffset`
  (double, kind 11, UObject `+0x138`, reflection symbol
  `?NewProp_TimelineOffset@Z_Construct_UClass_UBeatSpawnerManager_Statics...`
  at `0x14d1cfc20`) has no retained reader or writer; the spawner constructor
  (`native-music-constructor/0x1482d21a0.c`, 64 lines) writes no `+0x138`, so its
  default is 0.0 by UObject zero-initialisation only. Nothing ties it to
  `Meta.Offset`. (`BeatSpawnOffsetPercent`, float at `+0x15c`, is likewise
  unconnected in retained code.)

Until one of these is obtained, the original's nonzero-offset semantics are
unestablished: a decompilation of `StartFromBeatmap` / `StartFromBeatmapWithMediaSync`
(`0x148321290` / `0x1483213f0`) from the hash-verified executable, or a native
runtime run with a nonzero-offset map that has events (e.g. a shipped
`+0.004`/`-0.013`/`+0.016` map, or a synthetic map with a large offset and
events), observing first-beat fire time, event dispatch times and completion.

## Comparison with the player (no discrepancy established)

The player's Rust route (`src/routes/fanservice_music.rs`) applies an
**editable** offset — a user-supplied correction at confirm time, validated
finite and `|offset| <= 60` (lines 56-57), with shifted times required to stay
in `[0, duration]` (lines 98-99) — as `t + offset` to beats and events in the
confirmed manifest (shift closure line 199; `beatmap.meta.offset: 0`, line 203),
and the player consumes those timestamps directly (`static/fanservice/store.js`
line 52 rejects `meta.offset !== 0`; `static/fanservice/play.js` projects
`music.beatmap` times against `audio.currentTime` with no re-application).
That is a reconstruction-side confirm-time normalisation, not a claim about the
native file field: the native parser demonstrably does **not** bake the file's
`meta.offset` into timestamps, and no retained native body applies it at
runtime, so the player's "bake once, zero the field, consume directly" contract
is consistent with everything the native trace establishes. It is **not** proven
equivalent to the original for a nonzero file offset, because the one routine
that could apply it (`StartFromBeatmap*`) is unrecovered. No code change was
made on the basis of an unproven equivalence.

## Environment notes for this slice

- `cargo`/`rustc` are absent in this VM, so the existing Rust offset roundtrip
  test (`beatmap_get_roundtrips_editable_offsets_and_rejects_replaced_recordings`,
  `src/routes/fanservice_music.rs` ~line 288; ignored without FFprobe) could not
  be re-run here. The TDD skill at
  `/tmp/mattpocock-skills/skills/engineering/tdd/SKILL.md` does not exist in
  this VM; red-first discipline was followed in spirit (trace first, no code
  written because no discrepancy was established).
- Node suite and Python schema tests re-run after this docs-only change; counts
  in the run log.
