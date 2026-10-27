# Native seek and reconnect — October 27, 2026

This continues NATIVE_SESSION_20261026.md. The full plan remains unfinished and the supported-build registry remains empty.

## Isolated live result

The fixed local neutral AAC diagnostic passed in the selected v0.04 runtime. It retired the first positively owned bare native widget before seeking forward, created a replacement at the confirmed decoder position, reconnected without losing its bound position, accepted one native center-hit completion, retired that widget, then sought backwards and replayed beyond the hit without a second completion. Both retired widgets remained out of the viewport and stopped. Its own manager queue was emptied and its root lease released.

Final positions: forward seek 1.5325169563293 seconds; reconnect 2.0433559417725; backward seek 1.0216779708862; replay completed at decoder position 3.5062131881714. CompletedBeats remained 1 and CurrentBeatIndex remained 1, leaving the second future event untouched. Maximum sampled pre-correction clock difference was 0.04643988609314 seconds; immediately after correction it was 0.001189798116684 seconds. This is sampled diagnostic evidence, not a bound on every native tick.

`native_probe_audio_reconciliation` takes no caller parameters and uses only the already owned/enabled synthetic fixture and fixed local recording. It does not adopt original managers, remove foreign widgets, clear original delegates or award original progression. Full neutral observations are in evidence/native-reconciliation-20261027.json.

The Lua probe tests now cover retirement, asynchronous resume, forward seek, reconnect, backward replay, changed bindings/profile/world, decoder failure, discontinuities, expired seeks, incorrect reconnect positions and reactivated retired widgets. Ambiguous/shared ownership retains uncertain resources and reports cleanup failure rather than deleting foreign state.

## Original session boundary

Exact retained evidence identifies BP_GlobalManager.BeatSpawnerManagerCPP and its Outer. Original hit delivery binds BeatCompleteBind to OnBeatHitCenter; sequence delivery binds BeatSequenceEnd to OnSequenceEnd. BeatComplete mutates lifetime strokes, coins, heat, loot and metrics. Native OnBeatReachedCenter has no event-ID deduplication and accepts each running/valid-world callback.

The final native sequence callback uses a local, unretained 0.05-second world timer whose lambda directly calls native StopSequence. Hit-widget retirement uses a local, unretained 0.2-second timer that directly calls ReturnToPool. No reflected timer-handle field exists on the manager. ProcessEvent hooks do not intercept those direct native calls. They must not be treated as cancelled merely because a reflected getter or UFunction was hooked.

The installed SDK supports a data-based ProcessEvent pre-hook with PreventOriginalFunctionCall. The fresh-owned-manager reflected callback guard has now passed live: one natural widget hit accepted, one exact duplicate suppressed, one changed-identity duplicate suppressed, zero malformed events, and native CompletedBeats retained at one through backward replay. The root and guard were released after cleanup. Evidence: evidence/native-guard-20261027.json. V6 helper SHA256: cbf487db05dfa83b067df42fa1e21f3a278fa156d9d0a2aa4caecea4f5868341. This guard covers only its own fresh root leases, never original managers. Adoption of an original session also needs an explicit quiescent boundary based on progressing world timer time, exact session/epoch and menu/decision state, and once-only original reward/end delivery. Wall time in a paused world cannot establish timer drainage.

The original settings overlay changes visibility without pausing native beats. Production pause detection must inspect the exact UIManager.PauseMenuMasterBorder and native decision/session state as well as the manager clock.

Evidence sources: retained exact executable/PDB; C:/Users/webma/analysis/cockhero-v004/ghidra-native/integration-decompiled.c (NativeTick/retirement near 38028–38151, native hit/final timer near 55175–55326); blueprint-functions/BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json (statements 65–81, 662, 816–820); pinned SDK Hooks.hpp and CallbackIterationData.hpp. Recovered source is reference material, not original-runtime acceptance.

## Native finalization and audio lifetime

The corrected owned diagnostic passed live through native finalization. It observed exactly one guarded hit; native stop left an empty queue, running=false, CurrentBeatIndex=0 and TotalStrokes=1. It then observed 0.25909790024161 seconds of advancing world time before retiring its own widget and releasing its manager root. The audio player also closed and released its root, with no cleanup error. Evidence: evidence/native-finalization-20261027.json.

Earlier probe assumptions about which native counter resets were incorrect. Failed attempts and raw native counter reports remain in the local evidence directory. They are not accepted results. An initially retained failed root was cleared by a normal quit/restart; one later retained failed test root was cleared by the final normal process exit. The corrected successful probe released its own lease before exit. Raw runtime fields take precedence over ambiguous decompiler field labeling.

A clean restart also exposed a real audio lifetime bug: Unreal collected the unrooted MediaPlayer while its owner and MediaSoundComponent remained valid. V7 adds fixed fresh MediaPlayer root leases, validates exact actor/class/outer ownership, and requires an empty URL plus not-ready/not-preparing state before release. Tokens are separate from scratch rhythm leases. Stop retains a refused lease for retry and replacement is blocked until it is released. Partial construction also closes and releases its own player. Production playback now requires this matching helper instead of silently using an unrooted player.

V7 helper SHA256: 9b8db2234d0671718647771cac5c1574e5e46c013ff4c564490cbcbcd09bc8b0. Build output: C:/Users/webma/AppData/Local/fanservice/native-builds/delegate-reader-v7/. No private SDK headers or original-game files are distributed in the repository.

Seek/reconnect/backward replay passed again with V7: one accepted hit, two suppressed duplicate/changed hits, two retired widgets, released rhythm root, released audio root and no cleanup errors. Evidence: evidence/native-reconciliation-v7-20261027.json. The game stayed on the user's left display and was closed through its original Quit menu after testing.

Validation: 51 native/MCP top-level cases pass, including 19 queue/inspection, 29 owned-clock and 57 audio transport contracts. Native C++ contracts pass 37 delegate, 49 lease and 25 guard checks. Read-only original-session observations confirm exact callbacks, known pause/menu/decision state, advancing world time and ordinary native beat completion while the owned-only guard is installed. The original settings overlay still permits native beats to advance.

## Companion launcher lifecycle

The lab had stale helper ownership/readiness files with no matching worker process; prior launches had reported a process start even though the worker exited on that old lock. The launcher now verifies that the process remains alive and that readiness matches its ownership token before reporting ready. A live held lock is left alone. A valid abandoned lock and matching readiness/shutdown files are moved byte-for-byte to a fresh recovery directory while exclusive handles prevent a new worker claiming the old paths. Invalid, linked or mismatched files are retained and rejected. Profiles, snapshots and pending application data are not removed.

All 21 Windows installer/launcher tests pass, including live ownership, forced atomic-publication races, foreign data retention, stale-file preservation and immediate startup failure. In the actual isolated lab, stale files were preserved in .fanservice-stale-helper/831a8dd841884550859abfced96714bd; a new helper published verified readiness and then stopped normally. No isolated game or matching companion process remained after cleanup.

These changes close the owned diagnostic lifecycle. They do not activate an original-session soundtrack adapter or settle original game rewards. Original-session adoption, full beatmap/event wiring, buffering/reconnect integration, original reward/end delivery and supported mod/Host acceptance remain open.
