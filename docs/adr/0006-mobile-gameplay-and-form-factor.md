---
status: accepted
---

# Preserve original gameplay with mobile-specific presentation

The Web app and Android app implement playable sessions for phones. Gameplay fidelity is established against the newest usable original game through REA and version-bound evidence. Mobile-specific interaction and presentation decisions are resolved with the user.

Menus work in portrait. Gameplay supports portrait and landscape, with the layout rearranging on rotation while retaining the active session. Phone locking, app switching and interruptions pause gameplay. Returning requires explicit Resume.

On return, Resume enters a real gameplay edge as the refocus phase. A countdown may accompany the flow. During a music session, the song stays paused while the return edge is completed, then resumes from its saved position. If an edge was already active when interrupted, returning restarts that edge. Restart only the current edge, retaining earlier completed edges in the streak. Undo the current edge's meter, streak and reward changes before replaying it fully. The same rollback rule applies after repeated interruptions. Persist an edge-start checkpoint and its associated effects so restoring a session can perform the rollback consistently.

On phones, Finish requires holding the media for one second while eligible, with a progress ring at the touch point. A short media tap opens Pause. These media gestures replace the visible Pause and Finish buttons by the user's 2026-11-10 decision. Controls follow device orientation rather than the contained media rectangle. Other gameplay actions use ordinary taps. Active play keeps the screen awake where supported, with a setting to disable that behavior. Pausing or ending the session releases the keep-awake request.

Portrait gameplay places media above the beat indicator and large touch controls. Landscape gives media most of the screen with compact controls along the bottom. Full media remains visible and detailed statistics can be expanded. A handedness setting identifies the hand holding the phone. Item buttons sit on the opposite side in both orientations, with left-hand holding placing them on the right and right-hand holding placing them on the left.

Mobile vibration uses one setting with exactly three modes, Off, Before next event and Every beat. Vibration starts enabled on supported devices. Before next event is selected by default and gives a warning pulse three seconds before a gameplay change such as an edge, break or round transition. Every beat provides a pulse for each gameplay beat.

Seeking is disabled during game sessions. Playback inspection outside a game session is a separate workflow.
