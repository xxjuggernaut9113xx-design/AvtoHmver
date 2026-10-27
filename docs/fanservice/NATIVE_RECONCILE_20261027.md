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

The installed SDK supports a data-based ProcessEvent pre-hook with PreventOriginalFunctionCall. A fresh-owned-manager callback guard is the next bounded proof. Adoption of an original session also needs an explicit quiescent boundary based on progressing world timer time, exact session/epoch and menu/decision state, and once-only original reward/end delivery. Wall time in a paused world cannot establish timer drainage.

The original settings overlay changes visibility without pausing native beats. Production pause detection must inspect the exact UIManager.PauseMenuMasterBorder and native decision/session state as well as the manager clock.

Evidence sources: retained exact executable/PDB; C:/Users/webma/analysis/cockhero-v004/ghidra-native/integration-decompiled.c (NativeTick/retirement near 38028–38151, native hit/final timer near 55175–55326); blueprint-functions/BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json (statements 65–81, 662, 816–820); pinned SDK Hooks.hpp and CallbackIterationData.hpp. Recovered source is reference material, not original-runtime acceptance.
