# Mobile gameplay plan

User decisions accepted on 2026-11-05. The combined release includes gameplay in the Windows game mod, Web app and Android app. The mobile experiences implement the original gameplay for their form factor.

## Agreed behavior

- Menus work in portrait. Gameplay supports portrait and landscape. Rotation rearranges the screen while preserving the active session.
- Portrait places media above the beat indicator and large touch controls. Landscape gives media most of the screen with compact bottom controls. Media remains fully visible. Detailed statistics expand on demand.
- The Holding hand setting places item buttons opposite the hand holding the phone in both orientations. Left holding places items on the right. Right holding places items on the left.
- Finish requires a one-second hold. Other gameplay actions use ordinary taps.
- Active play requests screen wakefulness where supported. A setting disables this behavior. Pause and session end release the request.
- Locking the phone, switching apps or interruption pauses gameplay. Returning requires Resume and a real gameplay edge to regain focus.
- In music sessions, the song remains paused during the return edge. It resumes from its saved position when that edge completes.
- An interrupted active edge restarts from its beginning. Earlier completed edges remain recorded. Undo the current edge's meter, streak and reward changes before replaying it fully, including after repeated interruptions.
- Seeking is disabled during game sessions.
- Vibration has exactly three modes. Off disables cues. Before next event is the default and warns three seconds before gameplay changes such as an edge, break or round transition. Every beat vibrates for each gameplay beat on supported devices.

## Gameplay evidence

Recover behavior through REA against the newest usable original game. Bind findings and test fixtures to exact game identity. Investigate and record a newer-version blocker before using an older version, including the path to resume on the newer version.

The current selected executable is v0.05.1 Hotfix Public with SHA-256 a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10. Retained original Playlist acceptance records a 12-second recording, 1.75-second beat travel time, 2-second intro lead-in and completion. Source evidence is linked from NATIVE_MUSIC_V005_20261027.md and evidence/native-v005-music-session-20261027.json.

The existing Web app includes Classic, Tower, soundtrack timing, direct Edge, objectives, inventory, progression and durable session checkpoints. Its native-contract.json identifies reconstruction-derived rules. Those rules require comparison with the selected original build for gameplay fidelity acceptance.

The new REA attempt opened the selected executable and verified its identity. The Ghidra procedure search timed out after 300 seconds. The alternate Rizin operation failed with ERR_REA_WINDOWS_NATIVE. No new native gameplay conclusions were established by these failed operations. Focused recovery remains work to complete. Known targets include UMusicModeManager::RecordBeatHit, PausePlayback, ResumePlayback and GetCurrentAudioTime, plus UBeatSpawnerManager::Tick.

## Implementation order

1. Recover the selected game's remaining gameplay behavior and link each recovered rule to build-specific evidence. Prioritize beat completion, scoring, card transitions, Edge, music events, breaks, pause behavior and progression.
2. Reconcile recovered rules with the shared gameplay engine and fixtures. Keep original mechanics and accepted mobile-specific behavior separately identifiable in the specification.
3. Implement durable current-edge rollback and replay with an edge-start checkpoint. Preserve prior completed edges and frozen media membership. Handle repeated interruptions and reload consistently.
4. Add the paused-song return-edge flow. Verify song position, event delivery and rewards across interruption, edge replay and resume.
5. Implement portrait/landscape layouts, holding-hand placement, hold-to-Finish, session seek restrictions, wakefulness and three-mode vibration.
6. Verify browser and Android behavior, then physical iPhone and Android acceptance. Rebuild the deliverables from the accepted source and record their checksums.

## Acceptance

The combined release ledger is ../parity/STATUS.md. Required mobile checks include rotation during active play, either holding hand, interrupted and reloaded edge rollback, repeated interruptions without duplicated rewards, song-position retention, one-second Finish holds, disabled session seeking, wakefulness release and each vibration mode. Physical-device checks cover backgrounding, screen locking, provider access and offline saved media. Each result records its source revision, platform and tested game-rule identity.

The interview establishes the design. Implementation and original-game parity acceptance remain tracked work.
