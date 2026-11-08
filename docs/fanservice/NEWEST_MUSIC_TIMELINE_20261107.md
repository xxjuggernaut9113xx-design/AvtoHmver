# Newest-game recording timeline — ticket #51

The shared player now drains beats and events from actual recording samples, including a long rendering stall and the final recording boundary. A fresh song has a two-second preparation lead-in. Pause, buffering and preparation do not advance the recording-bound session clock; preparation survives checkpoint/reload. Natural completion requires the confirmed duration and both timeline lanes to be drained before settlement. The existing high-water ledger prevents repeated beats or grants after a seek/reload.

The player test exposed two real bugs: the old greater-than-one-second delta heuristic treated a stalled frame as a seek and discarded intermediate beats; the native `ended` handler settled before processing the last beat/events. It also exposed an initialization `seeked` callback skipping the zero-time beat after the short muted audio unlock. Initialization seeks now leave the saved cursor intact.

## Original-build evidence

The selected newest build is `v0051-hotfix-public-a8f46896`, executable SHA256 `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`. The matching original package hashes remain in `mod/native/game-identity.mjs`. This is distinct from the v0.04 executable `c645757d…`, whose retained recovery lives at `C:/Users/webma/analysis/cockhero-v004`.

- [Retained original v0.05 session](evidence/native-v005-music-session-20261027.json) records a two-second lead-in, anchoring by the first audio playback callback, three recorded strokes, and stopping at precisely 12.000 seconds. This is original runtime evidence, collected earlier; no new original game run is claimed here.
- [Exact newest static evidence](evidence/newest-music-static-20261107.json) contains bounded, hashed instruction ranges for seven `UMusicModeManager` methods. `GetCurrentAudioTime` at `0x1482e9b40` returns a stored position while paused. `PausePlayback` at `0x148303850` captures that position and calls the audio component's pause and the beat spawner's `PauseSequence`. `ResumePlayback` at `0x14830cbd0` adjusts accumulated pause time, resumes the audio component/spawner, and can reschedule the remaining deferred audio start. `HandleSongComplete` at `0x1482f9c00` calls next-round preparation or playback stop along its observed paths. These are static deductions from the exact build, with range limits retained in the evidence.
- The shared REA session successfully bound that exact executable. Its initial Ghidra deep-analysis request timed out after 300 seconds. The matched retained PDB and Capstone reader supplied the focused static evidence; it does not imply a successful REA decompilation or new runtime acceptance.
- The [reJOIce clock reference](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/GetMasterTimelinePosition-beat.c) was checked alongside the local retained recovery. That older clock freezes its stored position during pause and otherwise uses elapsed counter time plus a stored offset. It is historical evidence, not proof of newest music layouts or semantics.

## Offset and event scope

The Server already validates `time + submitted offset` and publishes those absolute recording timestamps with `beatmap.meta.offset = 0`; the original submitted offset stays in the manifest for editing. The client consumes this normalized timeline once. The two-second lead-in is preparation before playback, not another timestamp offset. Nonzero native offset behavior has not been established end to end and is not inferred from the older game.

The scheduler preserves control-before-beat ordering at equal timestamps and advances session time to each event/beat boundary, even after a rendering stall. Existing supported control effects remain in the player. The focused player fixture exercises disable/restore-break and text controls through natural completion; the pure tests also cover grants and rest/accent beats. It does not establish every native control's original effect. `speed_change` still fails closed at validation because its native semantics are unverified. Native event durations, custom events, complete break/edge behavior, playlist progression beyond one song and physical phone audio acceptance remain open gates for #51.

## Verification

`node --test tests/fanservice_music_timeline.test.js tests/fanservice_rules.test.js` passes 20 tests. These include sparse callbacks, timestamp ordering, pause/buffer holds, rest beats, explicit seek/reload high-water behavior and refusal of premature completion.

`tests/fanservice_music_timeline_smoke.cjs` passes with installed Chrome and the existing Playwright module. It runs the real player scripts against an isolated synthetic four-second PCM WAV and mocked library responses: preparation pause/checkpoint/reload, playback pause, buffering, a 4.3-second blocked rendering thread, all five beats including the duration-boundary beat, final text control, and exactly one progression settlement. It is registered in `tests/run_fanservice_ci.py`. This establishes shared-player behavior, not original-runtime or real-device equivalence.
