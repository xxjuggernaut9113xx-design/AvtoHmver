# Mobile Edge and challenge evidence

## Changes checked

- `static/fanservice/edge.js:19-20,29` preserves the original post-break base across a continuing Edge streak, including after a perfect Edge, and initializes the truncated hold count from the derived duration.
- `static/fanservice/edge.js:45-50` starts the hold timer one second after handoff and consumes one hold tick at each timer boundary.
- `static/fanservice/play.js:123` estimates the handoff completion using the full `holdRemaining` count, so its timer hint matches the first tick boundary.
- `static/fanservice/progression.js:24-27` adds claimed XP to the profile and updates `TotalXPEarned` challenge progress once while the claim guard prevents a second grant.

## Verification

- `node --test tests/fanservice_edge.test.js tests/fanservice_progression.test.js` — 26 passed, 0 failed.
- `tests/fanservice_edge_smoke.cjs` — passed in desktop Edge with the mobile viewport, shared player controls, virtual browser time, and synthetic neutral media/server routes. Covered normal and perfect Edges, hold persistence and replay, Mercy choices and payout, fixed-base continuation, and one winning session settlement. The run report is [edge-browser.json](mobile-20261108/edge-browser.json).
- `tests/fanservice_challenges_smoke.cjs` — passed in desktop Edge with a playable browser UI and virtual time. Covered claim XP counting once, challenge claim persistence, modifier conflict rejection, and profile preservation. The run report is [challenges-browser.json](mobile-20261108/challenges-browser.json).

## Provenance and limits

Edge timing decisions are based on the retained v0.04 decoded Blueprint artifacts under `C:\Users\webma\analysis\cockhero-v004\blueprint-functions\BP_EdgeManager`. `AdjustPostEdgeBreakDelay.json` shows `PostEdgeBreakDuration + FTrunc(EdgeStreak / 5)`, clamped to 1–8. `CountdownEdgeHold.json` dispatches to `ExecuteUbergraph_BP_EdgeManager` entry 9207; the retained summary lists its timer and hold-related calls. These are local decoded artifacts, not an upstream repository URL or source commit: no pinned source URL/revision is recorded in this workspace.

For the XP claim path, `C:\Users\webma\analysis\cockhero-v004\UnrealReconstruction\Source\CockHeroRecovered\RecoveredRewards.cpp::URecoveredRewardLibrary::GrantRecoveredRewards` routes XP rewards into `URecoveredProgressionManager::AddXP`; `RecoveredProgression.cpp::AddXP` increments `TotalXPEarned` and broadcasts `OnMetricUpdateRequested(TotalXPEarned, Amount)`. This recovered adapter evidence supports the behavior being mirrored in `progression.js`.

The local smoke validates the implementation through this player, not by executing the original game. The browser checks use synthetic media and routed server responses. They do not establish acceptance on the newest runtime or a physical mobile device. Keep newest-runtime acceptance outstanding before treating the Edge timing as final evidence for closing related tickets.

## Source hashes

SHA-256 at smoke run time:

- `static/fanservice/edge.js` — `3b3eaf1f66095b74b300ae33cc72f5e8b8beab0edc30d39dfa324870124daf1c`
- `static/fanservice/progression.js` — `e1bb8bc947717d3494ae0817004c745ec9572e4cb27b466eb8d3a3f60dbcaa8a`
- `static/fanservice/play.js` — `22f58064855efc3fd489a703ce7b8de5e374dd8400e502c0acbaa1b26e0c25b0`

Supporting artifact SHA-256:

- `blueprint-functions/BP_EdgeManager/AdjustPostEdgeBreakDelay.json` — `35997f683e14362fddd0a2687b8e3cd97182e5885b2a1c6721122b52f3c40b51`
- `blueprint-functions/BP_EdgeManager/CountdownEdgeHold.json` — `bbba91133054e5aca73243211d70f9f8eb006b37d2ac2ac52a6dd36a7d7c8d76`
- `UnrealReconstruction/Source/CockHeroRecovered/RecoveredProgression.cpp` — `d751a30db7eec715a66a88260968ab2e34741849070d31360559c8b5b6ed9978`
- `UnrealReconstruction/Source/CockHeroRecovered/RecoveredRewards.cpp` — `5ee5b602e7125701bac86a637550247519174484a4b4797c989d8ada4d8b39f0`
