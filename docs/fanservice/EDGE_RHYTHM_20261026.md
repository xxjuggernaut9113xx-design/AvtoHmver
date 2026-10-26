# Edge, music controls and native queue checkpoint

This extends SERVER_MOBILE_MUSIC_20261025.md. It does not establish full game support.

## Implemented and verified

- Browser Edge/E and Continue/G controls, first-edge rest, subsequent streak and bank handling, Mercy choices, bounded extended card windows, and checkpoint restoration. The newer recovered direct Edge action is separate from the legacy inventory item; no inventory or UP is granted.
- Actual browser controls complete an Edge objective and settle once after a paused reload. All ten isolated real-Server browser checks pass, including music snapshots, offline seeking, profile sync and native companion transport.
- Six observed named music backgrounds select labeled procedural gradients. These are not original imagery. Numeric hue controls remain supported.
- Maps containing speed_change remain editable and saveable; playback rejects them clearly before starting audio because the shipped dispatch semantics remain unestablished.
- The isolated v0.04 native POD probe passed three complete beat-row writes, append retention, native readback, stopped clock 2.5 and cleanup of its own queue. It does not start gameplay or mutate the original manager.
- Shared JavaScript: 138 tests passed. Native/MCP: 49 top-level tests passed, including 12 nested rhythm cases. Runtime installer: 12 passed on repeat; the first parallel run hit the helper shutdown timeout and retained its data safely.

## Remaining acceptance boundaries

Active native music/rhythm integration still requires positive original manager/widget ownership, timer retirement, tick ordering, pause and seek reconciliation, and once-only progression delivery. The stopped queue probe does not close these gates. See mod/native/RHYTHM_ADAPTER.md.

Full gameplay parity, unresolved speed_change semantics, physical cloud-provider/revocation/eviction checks, production deployment combinations, and release signing remain open. The previously user-confirmed iPhone HTTPS offline reopen/play/seek result remains accepted for that specific behavior. supported_builds remains empty; shipping_ready remains false.

Android 0.3.11 debug APK passed in-place emulator upgrade, copied neutral video SHA-256, cold restart, advancing playback clock and preservation of existing media. All 104 prepared APK assets matched. Server package results are recorded alongside this checkpoint in D:/reJOIce/Deliverables/fanservice-edge-rhythm-20261025/ after build verification. No original media is included.
