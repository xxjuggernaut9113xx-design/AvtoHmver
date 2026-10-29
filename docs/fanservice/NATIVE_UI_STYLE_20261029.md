# In-game presentation — 2026-10-29

The v0.05 independent menu now uses black panels, white square borders,
uppercase display headings, flat buttons and high-contrast hover/selection
states, following the original game's menu treatment. Its main-menu entry is
wider and monochrome; opening the panel changes that control to Back.

The game-only view removes Lite branding, connection diagnostics and decorative
web icons. Library and Collections tabs lead the layout. Local PC media and pack
archive import remain available in expandable drawers beneath the library.
Pack creation, music/sync controls and file selectors use the same visual rules.
Keyboard focus remains visible and reduced-motion preferences are respected.
The existing web display font is used; no extracted original-game font or other
private game asset is distributed.

These rules activate only when the v0.05 native bridge is present. Standalone
browser/mobile presentation is unchanged. No purchase, entitlement, playback or
profile logic was changed.

Validation: all 83 native/MCP tests pass. Neutral headless-browser previews
covered the library, expanded music controls and pack-creation dialog. Layouts
at 1200, 900 and 640 pixels had no horizontal overflow, and an independent
standalone page did not receive the game presentation class. Lua syntax checks
pass. Previews are retained in
`E:/fanservice-mod-lab/v005-ui-20261029/native-theme-*.png`.

Original-game acceptance now passes after the user applied the prepared update
and opened the isolated game. Installed `main.lua` and `native-controls.js`
hashes match the source revision. At 1920 × 1080, the monochrome entry, framed
library, hover state, selected-media outline, keyboard focus, local-media drawer
and pack-creation dialog rendered in the actual WebView. Keyboard selection,
Create Pack, Cancel, local-drawer open/close, Back to the original main menu and
reopening Fanservice were exercised. No test pack was saved or purchased.

Read-only acceptance logs are retained at
`E:/fanservice-mod-lab/v005-ui-20261029/native-style-acceptance-ue4ss.log`.
The capture occasionally omits text on an intermediate frame; refreshed
observations showed the complete controls. This is a presentation acceptance
checkpoint, not a new full-gameplay or native sync certification.
