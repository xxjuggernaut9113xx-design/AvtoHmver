# Independent fanservice menu for Windows

Run Open-fanservice.cmd. Select **fanservice menu**, or press **F8**, to open
fanservice Lite in its own Edge app window. The menu has Library and Organization,
selection review, pack creation, Unlocks, saved archive import/export and local
session playback. **Return to game** focuses the one running CockHero window.
Close the small companion window to exit and release F8. If another application
owns F8, use the button; no existing shortcut is overwritten.

This is an independent companion, not an embedded game mod or a replacement for
the restricted original-game importer. It does not install a loader, inject a
widget, change game files, open game saves or use native UP. Unlocks, progression
and media here belong to fanservice. The native supported-build registry remains
unchanged. Windows borderless/windowed mode makes switching between windows easier.

The default menu uses the user's existing private Tailscale HTTPS address;
Tailscale and that PC must be available for the first load. For another running
fanservice Server, run Start-FanserviceMenu.ps1 with `-MenuUrl
https://your-server/fanservice/` (or http://localhost:PORT/fanservice/).
This launcher does not start a Server or open a network listener. Static-only
hosting supports local files; Server browsing/music/sync needs its API backend.

The companion has its own persistent Edge profile under
`%LOCALAPPDATA%/fanservice/CompanionMenuBrowser`. Existing browser or iPhone packs
are not shared automatically: export a .chpack and import it in this menu. Files
stay in that profile; closing/upgrading the companion preserves them. No profile
or game files are deleted by this launcher. Back up packs before clearing browser
storage or moving to another origin. The process-scoped execution policy in the
CMD launcher does not change the Windows machine's execution policy.

Check paths and configuration without opening a window:
`powershell.exe -NoProfile -File Start-FanserviceMenu.ps1 -Check`.
Live game focus and global F8 acceptance still require an interactive Windows
session; syntax/configuration checks alone do not establish in-game integration.
