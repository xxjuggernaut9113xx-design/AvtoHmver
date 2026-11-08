# Mobile-only working draft — superseded scope

The user requested further grilling of the complete plan before rebuilding a combined implementation spec. Retain this draft as input to that synthesis. Publication and testing-seam approval are on hold.

# Original-gameplay mobile sessions with phone-specific controls

## Problem Statement

Players need Fanservice gameplay in the Web app and Android app that follows the original game's mechanics and works comfortably on a phone. The original game has no mobile port. The current mobile screen has playable systems, but its stacked layout and desktop-style controls do not deliver the agreed portrait, landscape and interruption experience. Some gameplay rules still derive from a reconstruction and require verification against the newest usable original game.

Phone interruptions also need a deliberate return to gameplay. A player returning from another app or a locked screen should complete a real edge before the paused session continues. Repeated interruptions must restart the current edge consistently, including its meter, streak and reward effects.

## Solution

Deliver the original-gameplay experience through the shared Web app and Android app, with responsive layouts, opposite-hand item controls and a durable return-edge flow. Preserve session state when rotating. Pause on interruption and resume through a real gameplay edge. Keep music paused through that edge and continue from the saved song position afterward.

Use REA and exact game identities to establish original mechanics. Prioritize the newest usable original game and investigate its failures before using an older fallback. Acceptance contributes to one combined AvtoHmver and Fanservice release checklist covering Server, Windows game mod, combined Host, Web app and Android app.

## User Stories

1. As a Web app player, I want playable sessions in my phone browser, so that I can play on iPhone without a native port of the original game.
2. As an Android player, I want the same agreed gameplay in the installable app, so that I can use my phone's local media and saved profile.
3. As a player, I want rules recovered from the newest usable original game, so that the mobile experience follows the current game.
4. As a player, I want Classic objectives to follow recovered rules, so that their requirements and outcomes are familiar.
5. As a player, I want Tower rounds, choices, shops and rewards to follow recovered rules, so that multi-round progression stays consistent.
6. As a music player, I want beats and game events synchronized to actual playback, so that timing follows the recording.
7. As a player, I want card, inventory, Edge and progression interactions verified together, so that a complete session behaves consistently.
8. As a player, I want menus comfortable in portrait, so that browsing and setup fit normal phone use.
9. As a player, I want portrait gameplay to show media above the beat indicator and large touch controls, so that I can see and operate the session.
10. As a player, I want landscape gameplay to give media most of the screen with compact bottom controls, so that sideways play makes good use of the display.
11. As a player, I want rotation to preserve the active session, so that changing orientation does not restart or alter progress.
12. As a player, I want full media visible, so that the layout preserves the selected image or video.
13. As a player, I want detailed statistics expandable, so that I can inspect them when needed.
14. As a player holding the phone in my left hand, I want item buttons on the right, so that their placement follows my selected holding hand.
15. As a player holding the phone in my right hand, I want item buttons on the left, so that the same placement rule works for either hand.
16. As a player, I want the holding-hand setting applied in both orientations, so that item controls stay predictable when rotating.
17. As a player, I want large ordinary tap targets for gameplay actions, so that touch input is practical on a phone.
18. As a player, I want Finish to require a one-second hold, so that an accidental tap does not finish my session.
19. As a player, I want a released or interrupted Finish hold to cancel, so that only a completed deliberate hold activates Finish.
20. As a player, I want phone locking and app switching to pause gameplay, so that unseen beats and timed actions do not pass.
21. As a returning player, I want an explicit Resume action, so that gameplay waits until I am ready.
22. As a returning player, I want a real gameplay edge before continuing, so that I regain focus through gameplay.
23. As a music player, I want the song paused throughout the return edge, so that its timeline waits for me.
24. As a music player, I want the song to continue from its saved position after the return edge, so that its beats and events remain aligned.
25. As a player interrupted during an edge, I want the current edge restarted from its beginning, so that returning gives me the complete edge again.
26. As a player with earlier completed edges, I want those edges retained when the current edge restarts, so that previous progress stays recorded.
27. As a player replaying an interrupted edge, I want that edge's meter, streak and reward changes undone before replay, so that replay begins from the correct state.
28. As a player interrupted repeatedly, I want the same rollback and restart behavior each time, so that interruptions cannot compound the current edge's effects.
29. As a player reopening after a reload or process restart, I want the interrupted edge restored consistently, so that persisted progress agrees with the replay rule.
30. As a player, I want my frozen session media selection retained through interruption and rotation, so that the session continues with its prepared content.
31. As a music player, I want seeking disabled during game sessions, so that the game follows its playback timeline.
32. As a player, I want active play to keep the screen awake where supported, so that normal screen timeout does not interrupt play.
33. As a player, I want a setting to disable keep-awake behavior, so that I can choose the phone's normal timeout behavior.
34. As a player, I want pausing and ending a session to release keep-awake behavior, so that it applies only while playing.
35. As a player, I want one vibration setting with Off, Before next event and Every beat modes, so that I can choose the feedback I need.
36. As a new player, I want Before next event selected by default, so that vibration warns me about upcoming gameplay changes.
37. As a player using Before next event, I want a warning three seconds before an edge, break or round transition, so that I can prepare.
38. As a player using Every beat, I want a vibration for each gameplay beat, so that the beat has tactile feedback.
39. As a player choosing Off, I want vibration stopped, so that gameplay respects that setting.
40. As a player on a device with limited vibration or screen-wake support, I want the gameplay controls to remain usable, so that platform differences do not prevent a session.
41. As a player using saved offline media and music, I want these phone-specific behaviors to work offline, so that downloaded sessions remain playable.
42. As a player upgrading the Android app, I want saved profiles, settings, media and snapshots preserved through the existing migration contract, so that phone-only data remains usable.
43. As a release owner, I want exact source, game and device identities recorded with acceptance, so that completion claims can be checked.
44. As a release owner, I want the mobile work included in the combined release checklist, so that a component test does not prematurely close the product release.

## Implementation Decisions

- Extend the shared playable session experience used by the Web app and Android app. Reuse its run, Edge, card, objective, inventory, progression, media, soundtrack and persistence boundaries.
- Preserve the glossary's distinction between the Web app, Android app and Windows game mod. Holding hand identifies the hand holding the phone, with item controls placed on the opposite side.
- Recover original gameplay through REA with build-specific provenance. The current selected original executable is v0.05.1 Hotfix Public, identified by SHA-256 a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10. Reassess available newer versions before implementation.
- Investigate a failure on the newer game before fallback. Record the blocker, exact tested identity and path to resume newer-version work.
- Separate evidence-backed original mechanics from the accepted phone-specific presentation and interruption behavior. Verify reconstructed rule tables before treating them as current original-game behavior.
- Add orientation-specific layout around the existing session. Rotation changes presentation while preserving run identity, playback position, queued events and frozen membership.
- Add a holding-hand preference and opposite-side item placement in both layouts. Keep detailed statistics expandable and media fully visible.
- Implement one-second hold-to-Finish as a touch interaction that honors the existing gameplay eligibility rules. Cancel an incomplete hold when input ends or the session is interrupted.
- Extend session interruption and persistence with a real return-edge phase. Resume explicitly starts this phase after an interruption.
- Capture the current edge's baseline and associated effects so restarting it can undo its meter, streak and reward changes. Rollback is scoped to that edge. Retain earlier completed edges and replay the current edge fully.
- Persist enough information for consistent rollback after reload, process loss and repeated interruptions. Apply rollback and checkpoint updates consistently so retry does not duplicate or lose edge effects.
- During a return edge in music mode, retain the saved soundtrack position and freeze its beat/event timeline. Advance the return edge on its own active gameplay timing, then resume the soundtrack from the retained position.
- Integrate the return edge with existing mode eligibility, objective and completion rules using recovered evidence. The current direct Edge implementation excludes music mode, so this flow requires deliberate mode integration.
- Disable session seeking through the gameplay UI and supported media-control entry points. Existing seek controls and tests need revision to match the new contract.
- Add keep-awake behavior during active play with an opt-out preference, releasing it on pause and end. Handle platform availability through the existing browser and native platform boundaries.
- Add exactly three vibration modes. Before next event is the default and warns three seconds before qualifying gameplay changes. Every beat follows delivered gameplay beats. Off stops vibration.
- Schedule vibration from active gameplay timelines so pause, song buffering, restart and session replacement cannot deliver stale cues. Verify native and browser capability behavior on their supported platforms.
- Preserve the existing private local-media, explicit offline-snapshot, reviewed-sync and Android upgrade-data contracts while extending session state.
- Treat this work as part of the combined release gate. Retain separate evidence for original-game behavior, browser integration, Android integration and physical-device acceptance.

## Testing Decisions

- Primary proposed seam is the existing public playable-session UI, driven through the established mobile browser integration harness against an isolated real Server and neutral media fixtures. Exercise normal entry, Start, touch actions, pause, return and completion with persistent outcomes observed through the UI and saved-session behavior.
- Seam approval is pending the to-spec skill's required user check. Prefer this existing seam before introducing additional test interfaces.
- Good tests assert externally observable behavior, session continuity and resulting progression. They avoid private widget structure and internal helper call counts as correctness criteria.
- Extend existing mobile session tests for both orientations, holding-hand placement, full media visibility, usable controls and hold-to-Finish cancellation and completion.
- Exercise interruption during ordinary play, during a return edge and after current-edge effects have been applied. Repeat the interruption, reload the session and verify full rollback/replay while earlier completed edges remain recorded.
- Use the same flows to verify song-position retention, no beat/event advancement while the song is paused, and correct continuation after the return edge.
- Verify game-session seeking is unavailable through supported controls and that session completion still settles its resulting progression consistently.
- Use controlled platform capabilities at the session boundary to observe vibration and keep-awake requests. Check all vibration modes, three-second warnings, pause/restart cancellation and wakefulness release. Physical devices establish hardware behavior.
- Reuse the existing deterministic Edge, card-queue, objective, economy, music-timeline and checkpoint tests for focused regressions that need precise boundaries. Add only the cases needed to verify newly recovered rules and current-edge rollback.
- Revise existing tests that assume a normal Finish tap or allow seeking during game sessions. Those expectations are superseded by the agreed behavior.
- Use original-game traces tied to an exact build as the comparison authority for recovered rules. Preserve the distinction between reconstruction fixtures, synthetic native heartbeat tests and observed original sessions.
- Complete physical iPhone Web app and Android acceptance for rotation, real interruptions, process restoration, offline media, vibration capability and wakefulness. Browser emulation alone cannot establish those outcomes.
- Rebuild the Web app and Android deliverables from the accepted source, verify current artifact identity and run applicable upgrade-data preservation checks before closing the combined release gate.

## Out of Scope

- Shipping a separate reconstructed Windows game or an official mobile port of Cock Hero.
- Changing Windows game purchase, entitlement or original Unlocks behavior as part of this mobile feature.
- Redesigning Server library management, downloads, administration or reviewed synchronization.
- A separate mobile-only release checklist that bypasses the combined product gate.
- Adding touch-accuracy rhythm scoring or inventing gameplay thresholds without recovered original evidence.
- Seeking during game sessions.
- Claiming platform support for vibration or keep-awake behavior before capability and physical-device checks.

## Further Notes

The user's mobile interaction decisions were accepted on 2026-11-05 and are recorded in the current glossary, combined-release decision, mobile-form-factor decision and mobile gameplay plan.

The existing player already provides substantial gameplay and persistence. The requested layouts, holding-hand control placement, interruption rollback flow and platform cues require implementation and acceptance.

REA verified the selected executable's identity, but its new Ghidra procedure search timed out after 300 seconds. The alternate Rizin operation failed with ERR_REA_WINDOWS_NATIVE. Focused recovery of original scoring, Edge interactions and music events remains necessary.

Publishing is pending project tracker setup and approval of the proposed testing seam. The discovered GitHub repository currently lacks the ready-for-agent label. The to-spec skill directs the user to run /setup-matt-pocock-skills when tracker and triage configuration are missing. Apply ready-for-agent when the spec is published to the configured tracker.
