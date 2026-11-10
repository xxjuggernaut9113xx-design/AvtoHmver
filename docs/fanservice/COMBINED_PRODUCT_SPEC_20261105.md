# Combined AvtoHmver and Fanservice product specification

## Problem Statement

Players and library owners need one complete product that manages and serves their media, integrates Fanservice into the original Cock Hero game on Windows, and provides faithful playable sessions through the Web app and Android app. Working components and dated test artifacts currently cover parts of this experience. Native live registration/streaming, complete gameplay fidelity, mobile interaction, combined installation and end-to-end acceptance still have gaps.

The product needs coherent connection, offline fallback, synchronization and update behavior across these experiences, while preserving library data, original game saves and phone-local content. Completion must satisfy one combined release gate.

## Solution

Retain the native Windows Host and standalone Server with shared library services. Host supplies built-in Server functionality while running, including tray operation. Offer separate Library and Game Launcher entry points, opt-in Windows startup and optional game-mod setup.

Provide native-style Fanservice browsing in the original game, immediate pack registration in original Unlocks, original-authority UP purchases and confirmed music delivery to original Playlist. Remember multiple Server connections with one active library. Windows playback uses downloaded snapshots before original-media fallback during outages, then returns to Fanservice at the next media change after reconnect.

Deliver recovered original gameplay through the Web app and Android app with the agreed portrait/landscape layouts, opposite-hand item placement, real return-edge rollback/replay, deliberate Finish, screen wakefulness and three-mode vibration. Verify original mechanics against the newest usable game with REA and build-bound evidence.

Combine the existing included AvtoHmver parity areas and all Fanservice deliverables into one acceptance checklist and reproducible release.

## User Stories

1. As a library owner, I want a native Windows Host with full library management and built-in Server functionality, so that my library is available to games and remote devices while Host runs.
2. As a library owner, I want a separate Server-only edition, so that I can host the same services without the desktop library manager.
3. As a Windows user, I want separate Library and Game Launcher entry points, so that I can manage media and start a game independently.
4. As a Host user, I want Server availability while Host runs in the tray, so that closing its main window does not interrupt connected clients.
5. As a Windows user, I want startup with Windows to stay opt-in, so that background startup follows my preference.
6. As a library owner, I want browsing, hierarchy, tags, ratings, imports, downloads, discovery and automation in the full management interface, so that my library remains manageable.
7. As a library owner, I want the included storage, settings, administration, diagnostics and classifier capabilities accepted across their intended editions, so that the combined release fulfills its existing parity scope.
8. As a remote player, I want connections to honor the negotiated library permissions, so that game browsing and playback respect the owner’s authority.
9. As a Windows player, I want Fanservice in the original main-menu list with native-style presentation, so that it fits the game’s normal navigation.
10. As a Windows player, I want original gameplay, packs, sounds, progression and saves usable through installation and removal, so that the integration is dependable.
11. As a Windows player, I want the newest usable game supported first, so that development follows the current game.
12. As a Windows player, I want a configured compatible older game offered if an update breaks the mod, so that I have a usable fallback.
13. As a player, I want Fanservice to remember several Server connections with one active Server, so that I can choose the library for my session.
14. As a local player, I want the local Host offered as the default Server when available, so that initial connection is straightforward.
15. As a player switching Servers, I want the corresponding library’s packs and saved data shown, so that each library keeps its own identity.
16. As a player, I want exactly Library and Organization as the Lite interface’s main tabs, so that game browsing stays focused.
17. As a player, I want previews, tags, ratings, search, filters, sorting and selection retention, so that I can build the pack I intend.
18. As a player, I want organization selections to browse existing sources, groups and tags, so that I can choose collections without changing the library.
19. As a pack creator, I want a name, optional description, cover and immediate or positive whole-number UP price, so that I can define how the pack appears and is obtained.
20. As a Windows pack creator, I want Save to register the pack immediately in original Unlocks and offer Open Unlocks, so that it becomes usable through the game’s normal controls.
21. As a Windows player, I want purchases and enablement in original Unlocks using native UP, so that the game remains the authority for its economy.
22. As a pack buyer, I want insufficient funds rejected and a successful purchase charged once across restarts, so that ownership is reliable.
23. As a pack owner, I want renaming, cover edits, rule edits and content refresh to preserve identity and ownership, so that maintenance does not make me buy the pack again.
24. As a pack creator, I want price changes to apply to future purchases, so that I can change availability while existing owners keep their packs.
25. As a pack owner, I want deleting a pack to preserve library media, so that deleting a definition does not delete its source content.
26. As a player, I want explicit media and live rules resolved as a deduplicated selection, so that pack contents match my selections.
27. As a player, I want the active session’s prepared membership frozen, so that live library changes apply predictably to later sessions.
28. As a player, I want effective metadata mapped into the game’s media pools, so that selected images and videos appear in the appropriate gameplay context.
29. As a player, I want empty, missing and unavailable content reported before purchase or session preparation, so that I understand what can play.
30. As a Windows player losing Server access, I want an explicitly downloaded snapshot used first with visible offline status, so that saved content remains playable.
31. As a Windows player without a usable snapshot, I want fallback to original game media, so that a Server outage does not interrupt available gameplay.
32. As a Windows player with original packs disabled, I want a default original pack available for outage fallback, so that gameplay still has fallback content.
33. As a Windows player reconnecting to the Server, I want Fanservice media restored at the next media change, so that recovery fits the session’s normal transitions.
34. As a player, I want explicit snapshot download and refresh with saved/live labels, so that I choose what is retained offline.
35. As a player, I want failed snapshot replacement to preserve the previous snapshot and active-session references, so that interrupted refresh does not destroy playable content.
36. As a player, I want supported music and its matching confirmed beatmap retained together offline, so that saved rhythm sessions remain aligned.
37. As a pack exporter, I want selection review and saved-pack export to produce exactly the resolved, deduplicated contents with compatible metadata and cover, so that the archive plays independently.
38. As a pack exporter, I want missing files, progress, cancellation and storage errors handled explicitly, so that an incomplete archive is not reported as complete.
39. As a phone user exporting local or mixed media, I want the archive assembled on-device, so that my private phone files stay local.
40. As a player, I want exported archives to import and play in the actual supported original game, Web app and Android app, so that transfers work across the intended experiences.
41. As a player with multiple devices, I want portable pack definitions synchronized through authorized profile connections, so that my definitions can travel between devices.
42. As a player resolving sync conflicts, I want per-pack differences and a choice of which version to keep before applying, so that concurrent edits receive deliberate review.
43. As a Windows player, I want native UP, ownership and enablement protected during synchronization, so that remote definitions cannot alter game progression authority.
44. As a phone user, I want device-local media and downloaded snapshots kept outside portable profile synchronization, so that local files retain their device-specific behavior.
45. As a library owner, I want recording analysis, beatmap editing and confirmation in full management, so that gameplay uses reviewed music data.
46. As a player, I want recording-bound maps checked against the exact audio, so that changed recordings do not silently reuse mismatched timing.
47. As a Windows music player, I want Use in game to add a confirmed song to the original Playlist library and offer Open Playlist, so that I use the game’s existing music session.
48. As a Windows player, I want refresh or restart instructions when the game cannot refresh its music library live, so that I know how to access delivered songs.
49. As a player, I want local voice packs, captions and explicit missing-recording status, so that supported voice presentation works consistently.
50. As a Host installer user, I want optional mod setup with detected game installations and a selectable folder, so that I can configure the existing game.
51. As a Host user without a game installed yet, I want Add game later in the launcher, so that I can install Host first.
52. As a user upgrading or removing components, I want tracked owned files and preserved library/profile/save data, so that maintenance is reversible and predictable.
53. As a release owner, I want current Server packages, Windows mod packages, combined Host installation, Web app and signed Android APK with reproducible instructions and checksums, so that the complete release can be installed and verified.
54. As a release owner, I want one combined acceptance checklist including the existing AvtoHmver parity areas, so that a partial Fanservice component does not define release completion.
55. As a Web app player, I want playable sessions in my phone browser, so that I can play on iPhone without a native port of the original game.
56. As an Android player, I want the same agreed gameplay in the installable app, so that I can use my phone's local media and saved profile.
57. As a player, I want rules recovered from the newest usable original game, so that the mobile experience follows the current game.
58. As a player, I want Classic objectives to follow recovered rules, so that their requirements and outcomes are familiar.
59. As a player, I want Tower rounds, choices, shops and rewards to follow recovered rules, so that multi-round progression stays consistent.
60. As a music player, I want beats and game events synchronized to actual playback, so that timing follows the recording.
61. As a player, I want card, inventory, Edge and progression interactions verified together, so that a complete session behaves consistently.
62. As a player, I want menus comfortable in portrait, so that browsing and setup fit normal phone use.
63. As a player, I want portrait gameplay to adapt the media-first session HUD with compact side controls and a transparent beatbar at the bottom, so that I can see and operate the session.
64. As a player, I want landscape gameplay to resemble the original desktop session with mobile controls: media covering most of the screen above a background image or video, a transparent bottom beatbar, and only Pause, equipped item slots, Edge and contextual actions overlaid. Session rules belong before Start, while secondary controls and adjustable display settings belong in the pause menu. Named presets can save pre-session choices on the device. This layout clarification was requested during physical iPhone testing on 2026-11-09.
65. As a player, I want rotation to preserve the active session, so that changing orientation does not restart or alter progress.
66. As a player, I want full media visible, so that the layout preserves the selected image or video.
    The 2026-11-10 physical review clarified that controls and the transparent beatbar overlay the visible media rectangle, including letterboxed content. Upcoming beat balls preview the actual pattern before the center. Media pools change automatically through gameplay events and weights; there is no manual speed-pool selector.
67. As a player, I want detailed statistics expandable, so that I can inspect them when needed.
68. As a player holding the phone in my left hand, I want item buttons on the right, so that their placement follows my selected holding hand.
69. As a player holding the phone in my right hand, I want item buttons on the left, so that the same placement rule works for either hand.
70. As a player, I want the holding-hand setting applied in both orientations, so that item controls stay predictable when rotating.
71. As a player, I want large ordinary tap targets for gameplay actions, so that touch input is practical on a phone.
72. As a player, I want Finish to require a one-second hold, so that an accidental tap does not finish my session.
73. As a player, I want a released or interrupted Finish hold to cancel, so that only a completed deliberate hold activates Finish.
74. As a player, I want phone locking and app switching to pause gameplay, so that unseen beats and timed actions do not pass.
75. As a returning player, I want an explicit Resume action, so that gameplay waits until I am ready.
76. As a returning player, I want a real gameplay edge before continuing, so that I regain focus through gameplay.
77. As a music player, I want the song paused throughout the return edge, so that its timeline waits for me.
78. As a music player, I want the song to continue from its saved position after the return edge, so that its beats and events remain aligned.
79. As a player interrupted during an edge, I want the current edge restarted from its beginning, so that returning gives me the complete edge again.
80. As a player with earlier completed edges, I want those edges retained when the current edge restarts, so that previous progress stays recorded.
81. As a player replaying an interrupted edge, I want that edge's meter, streak and reward changes undone before replay, so that replay begins from the correct state.
82. As a player interrupted repeatedly, I want the same rollback and restart behavior each time, so that interruptions cannot compound the current edge's effects.
83. As a player reopening after a reload or process restart, I want the interrupted edge restored consistently, so that persisted progress agrees with the replay rule.
84. As a player, I want my frozen session media selection retained through interruption and rotation, so that the session continues with its prepared content.
85. As a music player, I want seeking disabled during game sessions, so that the game follows its playback timeline.
86. As a player, I want active play to keep the screen awake where supported, so that normal screen timeout does not interrupt play.
87. As a player, I want a setting to disable keep-awake behavior, so that I can choose the phone's normal timeout behavior.
88. As a player, I want pausing and ending a session to release keep-awake behavior, so that it applies only while playing.
89. As a player, I want one vibration setting with Off, Before next event and Every beat modes, so that I can choose the feedback I need.
90. As a new player, I want Before next event selected by default, so that vibration warns me about upcoming gameplay changes.
91. As a player using Before next event, I want a warning three seconds before an edge, break or round transition, so that I can prepare.
92. As a player using Every beat, I want a vibration for each gameplay beat, so that the beat has tactile feedback.
93. As a player choosing Off, I want vibration stopped, so that gameplay respects that setting.
94. As a player on a device with limited vibration or screen-wake support, I want the gameplay controls to remain usable, so that platform differences do not prevent a session.
95. As a player using saved offline media and music, I want these phone-specific behaviors to work offline, so that downloaded sessions remain playable.
96. As a player upgrading the Android app, I want saved profiles, settings, media and snapshots preserved through the existing migration contract, so that phone-only data remains usable.
97. As a release owner, I want exact source, game and device identities recorded with acceptance, so that completion claims can be checked.
98. As a release owner, I want the mobile work included in the combined release checklist, so that a component test does not prematurely close the product release.

## Implementation Decisions

- Retain the native library-owning Host and headless Server with shared Rust services and the existing permission authority. Full management owns library mutation, administration, analysis and automation. Lite uses its scoped browse, playback, export and profile-sync contracts.
- Host includes continuously available Server functionality while running, including tray operation. Keep Windows startup opt-in. Library management and game launching have separate entry points.
- Retain one owner for a resolved data directory. Reuse existing backend lifecycle and lock behavior when composing Host, Server-only and launcher workflows.
- Support saved Server connections with one active Server, using the local Host as the default when available. Bind pack/profile/snapshot state to library identity and revoke stale work on connection or profile replacement.
- The Windows game mod uses the original main-menu list and native-style controls. Lite has Library and Organization as its two main tabs. Full management and automation stay in the library-owning interfaces.
- Saving a pack registers it immediately in original Unlocks, keeps the player in Fanservice and offers Open Unlocks. Native Unlocks owns purchasing and enablement. Bind definitions to the active game profile through the existing companion boundary.
- Preserve custom identity through edits and refresh. Prices are positive whole-number UP values or immediate availability. Future purchases use edited prices, existing ownership persists and changing to free creates no automatic refund.
- Resolve the union of explicit members and live rules with deduplication, native pool mapping and preflight validation. Preserve the existing contract limits of 500 explicit Server identities, 32 live rules and 10,000 resolved members. Freeze membership for the active session.
- For Windows Server-disconnect fallback, use an explicitly downloaded usable snapshot first and original game media second. A default original pack can supply fallback even when original packs are disabled. Keep this selection session-scoped. On reconnection, return to Fanservice media at the next media change and show connection status.
- Reconnection must respect the active session’s frozen membership, identity and generation guards. Resolve new live additions for subsequent sessions.
- Preserve explicit snapshot download and refresh, saved/live labeling, previous-snapshot retention after failed replacement, durable active pins and recording-bound offline music.
- Retain exact-selection archive export, compatible cover/metadata, progress/cancellation, explicit missing-file handling and the 512 MiB browser export limit. Assemble phone-local and mixed exports on-device. Keep credentials, Server URLs, live rules and ownership history outside exported archives.
- Use authorized, revision-checked portable synchronization. Review differences per conflicting pack and apply the selected versions against the reviewed revision. Native UP, ownership and enablement retain their existing authority boundary. Device-local media and snapshot bytes remain device-local.
- Keep original Playlist/Music sessions as the Windows music integration. Use in game delivers the confirmed Server recording and matching map into the original library and offers Open Playlist. Provide refresh or restart instructions when needed.
- Preserve local voice import, captions and accurate missing-recording reporting. Retain existing supported music connector boundaries.
- Make mod installation optional during Host setup. Detect existing games, allow explicit folder selection and offer Add game later. Support exact-build verification and offer a previously configured compatible older installation when an update breaks the newer adapter, with its blocker recorded.
- Preserve owned-file installation/update/removal and data retention. Deliver the required component packages and combined Host against the same release source, with artifact checksums, signing details and reproducible build instructions.

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

- Proposed primary seams are the existing user-facing workflows for library management and Server APIs, original-game mod controls and gameplay, and the shared Web app/Android gameplay screen. Reuse their current contract and integration harnesses before adding new test interfaces.
- Test observable outcomes through normal entry points. Component tests supplement the flows for exact timing, identity, persistence and failure boundaries. Scope original-game acceptance separately from synthetic heartbeat and decoder checks.
- Extend real Server scenarios for library capabilities, browse/resolve, exact export, recording/map identity, snapshot replacement and authorized synchronization. Verify permission rejection, revision conflicts and library/profile replacement.
- Exercise Save pack to original Unlocks, one-time purchase, insufficient funds, enablement, edit identity, restart and removal in an exact supported game installation.
- Exercise native live media, Server loss, saved-snapshot fallback, disabled-pack default-original fallback and reconnect at the next media transition. Verify active-session membership and generation consistency.
- Exercise confirmed song delivery through the embedded controls into original Playlist and its normal playback, pause, completion and progression paths. Verify the required original gameplay/session combinations against recovered evidence.
- Test separate Windows entry points, opt-in Windows startup, built-in Server tray continuity, single-library ownership, optional game setup and configured older-game fallback after a newer-version blocker.
- Verify archive metadata, cover, counts, pool tags, privacy, cancellation and errors through actual import/playback in the applicable original game, Web app and Android workflows.
- Verify install, upgrade and removal against owned-file manifests and protected data, then identify the built artifacts from the accepted source. Existing included parity gates remain required.

- For mobile, use the existing public playable-session UI with an isolated real Server and neutral media fixtures. Exercise normal entry, Start, touch actions, pause, return and completion with observable persistent outcomes.
- The user approved the full-product testing approach on 2026-11-05, covering real Library/Server workflows, original Windows game menus and sessions, Web app/Android gameplay, precise timing/persistence regressions and physical-phone acceptance.
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

- Shipping a separate reconstructed Windows game or distributing the original commercial game.
- An official mobile port of Cock Hero. The Web app and Android app implement the agreed gameplay for phones.
- Library administration or automation inside the Lite game-browsing interface.
- Remote definitions or sync data taking authority over native UP, ownership or enablement.
- Uploading phone-local media as a side effect of local selection, playback or mixed archive export.
- Seeking during mobile game sessions, or invented gameplay scoring thresholds without original evidence.
- Certifying an older game as the primary target merely because it is easier to develop against.
- Release exclusions already accepted in the combined ledger, such as Linux desktop acceptance, slideshow and VR, except where a later accepted scope decision explicitly supersedes an older exclusion.

## Further Notes

The accepted mobile and desktop workflow decisions were recorded on 2026-11-05. This combined specification supersedes the mobile-only working draft.

Original v0.05 components have scoped live acceptance for native Unlocks, image/video delivery, Playlist completion, restart persistence and owned installation/removal. The latest main-menu relocation still needs its actual-game visual/click check. Actual-game sync upload/review/apply, owned snapshot playback, live HTTP gameplay, full gameplay recovery and broader installed regression remain open.

The new REA attempt verified the selected original executable identity. Ghidra procedure search timed out after 300 seconds, and the alternate Rizin operation failed with ERR_REA_WINDOWS_NATIVE. Those attempts established no new gameplay rules. Retained reconstruction fixtures and synthetic tests need their existing provenance preserved.

The default-original fallback decisions supersede the older instruction against substituting original media for the agreed Windows disconnect scenario. Game support follows newest-version-first with recorded blockers before fallback. Original-game reconstructed Windows output remains reference material.

The user approved the full-product testing approach. Published as [GitHub issue #26](https://github.com/xxjuggernaut9113xx-design/AvtoHmver/issues/26) with the ready-for-agent label.
