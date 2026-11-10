# Media-first mobile session HUD — 2026-11-09

The physical iPhone tester requested a session view with media above a background image/video, compact mobile actions, a transparent bottom beatbar, and settings before Start or in Pause. The combined product spec now records that direction. This is a user-directed mobile adaptation; no recovered desktop screenshot was used to claim identical original geometry.

During play the media surface fills the viewport, with contained foreground media and a blurred, dimmed copy behind it. Pause, Edge, contextual Finish and five inventory slots overlay the scene. Slots sit opposite the selected holding hand. Secondary actions and adjustable display settings move into the pause menu; rules are locked for the active session. Up to eight named, validated device-local presets can be saved and applied before starting a new session. Restored sessions cannot have their rules replaced by a preset.

The pause menu holds the actual session clock, video and soundtrack, keeps Resume at the top, and returns to the same media. Interruption recovery still requires the real return Edge. Decoder details and detailed statistics are available in the pause menu rather than over the media. The offline shell includes the preset module in cache v33.

## Validation

- All 261 Node tests pass, including preset validation and post-Mercy streak regression cases.
- `fanservice_session_hud_smoke.cjs` passes in installed Edge and Playwright WebKit 27.2 with touch-enabled 390×844 and 844×390 viewports. It checks setup/preset application, full viewport media surface, transparent bottom beatbar, 44-pixel primary targets, both opposite-hand slot layouts, paused clock, menu actions and rotation continuity.
- `fanservice_media_resume_smoke.cjs` passes Edge actual H.264 playback/seek and WebKit image identity through the pause menu, pagehide/refocus and reload.
- The recording interruption and music timeline smokes pass in Edge; the iPhone-shaped hold/rotation/voice-resume smoke passes in WebKit.
- The ordinary Timer/Strokes item-slot and return-Edge smoke passes in WebKit. Its virtual clock is paused between explicit advances so browser action latency cannot add a beat between reset snapshots; timing assertions remain unchanged.
- The complete WebKit Edge sequence passes: normal/perfect paths, both Mercy choices, persisted hold replay, 510-point bank, next streak reset to one and one winning settlement. [Retained report](session-hud-20261109/edge-browser.json).
- Screenshots with neutral synthetic artwork: [landscape](session-hud-20261109/landscape.png), [portrait](session-hud-20261109/portrait.png), [pause menu](session-hud-20261109/pause.png). These were visually reviewed for clipping, readability and layering. The test artwork is not player content.

Physical iPhone 17 Pro Safari confirmation of this redesigned HUD remains pending. Earlier physical reports confirm connected loading, pack creation, media/beat playback, the old portrait/landscape fit, and same-file return after the preceding resume fix; they do not establish this new layout's device acceptance. iOS version, exact physical video offset, offline/provider transfers and supported wake/vibration observations remain unverified.
