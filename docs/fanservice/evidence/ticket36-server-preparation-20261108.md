# Ticket 36: Server recording preparation acceptance

On November 8, the local Server owner workflow passed through real headless
Microsoft Edge controls at `/fanservice-music/`, using a new generated eight-second
120 BPM click recording. No personal media or existing game/Server data was used.

`tests/fanservice_music_preparation_smoke.cjs` imported the recording, analyzed an
initial proposal, played the audio preview and observed its clock advance, edited
individual accent/stroke/rest beats and a text event, saved an unconfirmed map,
then confirmed and saved it. Both analysis alone and an unconfirmed saved edit
were rejected by the delivery-manifest endpoint. Reloading the page returned the
same confirmed edit and recording identity. The current `deliverServerMusic`
worker produced byte-identical PCM WAV audio and the exact edited beats/events.
This export targeted a disposable evidence directory, not an original game library.

Private generated evidence is under
`E:/fanservice-mod-lab/ticket36-20261108-b/browser-acceptance-final/`:
`result.json`, `confirmed-server-recording.png`, and `native-pack/`.
The test uses a new recording identity on each invocation to preserve prior
confirmed recordings when the Server deduplicates imports.

The fixture was the retained October 28 `parity_acceptance.exe`, SHA-256
`3BF2C98714B9D96AFF6C95F80197FC180E7E6927079514930306DE95682C1040`,
started with `--server` on a randomly assigned loopback port. It served the current
working-tree static assets. Consequently this is real UI/Server integration
acceptance of the recording workflow, but does not certify a freshly rebuilt
November 8 Server executable. The current JavaScript music-delivery worker was
used for export.

The 35 tests in `mod/native/music-delivery.test.mjs`, `host.test.mjs` and
`v005-native-controls.test.mjs` passed outside the sandbox with disposable E:
temporary directories. They cover recording changes, confirmation changes during
delivery, profile/epoch/revision changes, exact native-library targeting, and
preservation of existing destinations. The first sandbox run encountered EPERM
on file links/renames; the unrestricted rerun passed all 35.

## Remaining acceptance

Ticket 36 remains incomplete. `runtime-v005/Scripts/native-controls.js` currently
provides textual `Start Game → Playlist → Manage` and refresh/restart directions;
it does not offer a working **Open Playlist** action. The pinned v0.05 native
music-manager inventory establishes delivery/scan/playback operations, but the
reviewed retained material does not establish the exact v0.05 Blueprint UI
navigation handlers needed to open its original Playlist safely. Retained v0.04
MainMenu handlers do not establish v0.05 compatibility. No guessed handler,
alternate playback UI, or synthetic success button was added.

Original Playlist playback of a delivered Server recording is retained separately
in `native-v005-combined-session-20261029.json`; this new check did not launch an
original game session or repeat that playback acceptance. A reflected, exact-build
original-menu navigation route and an actual-game click/refresh check are still
required for the Open Playlist criterion.
