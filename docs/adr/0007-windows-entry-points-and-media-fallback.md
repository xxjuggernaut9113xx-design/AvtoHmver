---
status: accepted
---

# Separate Windows entry points and use original-media fallback

Library management and game launching have separate entry points in the combined Windows installation. Host includes continuously available Server functionality. A separate Server-only edition is also provided. Windows sign-in startup stays opt-in. Host keeps its built-in Server available while running in the tray.

If the Server disconnects during a Windows game session and selected Fanservice media becomes unavailable, gameplay falls back to original Cock Hero media. This supersedes the earlier full-plan requirement to avoid original-media substitution for this disconnect scenario. When the Server reconnects, return automatically to Fanservice media at the next media change with a brief connection-status notice. If all original packs are disabled, use a default original pack as session-scoped fallback.

Saving a pack in the Windows game mod immediately registers it in the original Unlocks menu. The player stays in Fanservice and is offered an Open Unlocks action. Purchasing and enablement use the original Unlocks controls.

For a Windows pack with an explicitly downloaded snapshot, Server-disconnect fallback uses that saved snapshot first with an Offline snapshot status. Original media is the next fallback. Reconnection returns to Fanservice media at the next media change.

Fanservice remembers multiple Server connections with one active Server at a time. Default to the local Host when available. Switching the active Server displays the packs and saved data belonging to that Server's library.

Synchronization conflicts are reviewed per pack. Show the differences and let the user choose which conflicting pack version to keep before applying the reviewed result.

Use in game for a confirmed Server song adds it to the original game's Playlist library and offers Open Playlist. If the game cannot refresh its library while running, provide the required refresh or restart instruction.

Pack prices remain editable for future purchases. Profiles that already own the pack retain ownership. Changing a priced pack to free does not automatically refund UP.

If an update makes the newest configured game incompatible with the mod, the launcher offers a previously configured compatible older game. Record the newer-version blocker and retain the path to return to that version.

Host setup makes mod installation optional, detects existing Cock Hero installations and lets the user choose the game folder. The separate launcher offers Add game later, allowing Host installation before a game is available.
