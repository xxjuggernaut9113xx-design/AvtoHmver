# Native profile sync acceptance

Observed 2026-11-07 in the disposable v0.05.1 game clone on the secondary monitor.
Implementation commits are 4b7a778c and c8012c50.

The actual embedded panel created an authorized connection, uploaded drafts,
reviewed a remote pack, and applied the selected downloaded version. A synthetic
counterpart then removed that definition. The user approved its removal through
the game review panel. The downloaded snapshot remained available after removal,
another Save Server pack drafts action, and Back followed by panel reopen.

Final companion state was local revision 4, sync revision 3, zero pack definitions
and one retained snapshot. SHA-256 comparisons of two downloaded PNGs, manifest,
and soundtrack were unchanged. All three native save files were unchanged.
Native UP remained 29 with two owned packs and one enabled pack. No sync key is
included in this evidence.

Shared-client browser tests and native host/panel tests separately cover concurrent
edits, stale remote and local revision rejection, required per-pack choices, and
exclusion of native progression and device-local bytes from portable authority.

## Startup limitation

Earlier automatic CEF attachment crashed. This acceptance run used a clone-only
75-second attachment delay and observed one successful delayed startup plus a
successful panel reopen. That diagnostic is not a production startup fix.
The original-game startup regression remains unresolved.

Sanitized raw observations are retained locally at
`.test-tmp/native-sync-evidence/live-acceptance.json`.
