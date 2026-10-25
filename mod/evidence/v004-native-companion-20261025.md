# Native companion checkpoint — 2026-10-25

## Verdict

Profile-bound storage, snapshot/sync worker, embedded controls and a native audio
preview transport are implemented and packaged as a development candidate.
**Full original-game music/rhythm integration is not complete.** This revision
has not been loaded and accepted in the running original game.

## Implemented

- Exact production hash verification for executable, PAK, UTOC and UCAS. The
  read-only verifier passed against the isolated v004-exclusive-c645757d files.
- Companion storage bound to canonical installation/build/save slot/user index,
  with an explicit separate root for custom UserDir lab launches. No original
  saves, native wallet, native ownership or progression imports.
- Atomic definitions and immutable snapshot generations, bounded downloads,
  checksums, failure rollback, durable session pins and verified owned cleanup.
- Native ownership/enablement authorization using the actual native catalog and
  the existing custom-ID archive receipt ledger. No duplicate purchase controls.
- Revision-checked, previewed sync through real Server endpoints. Native profiles
  use a labelled companion wire document with a neutral zero wallet placeholder;
  remote native progression and purchase history are ignored.
- A one-use P-256/SHA-256/AES-256-GCM connection exchange. Plaintext keys are
  rejected by the browser bridge before entering page titles. Handshakes are
  bound to the native generation/menu/Server and have an expiry.
- Ordered frames for definition documents up to 2 MiB while keeping each IPC
  command bounded. Existing 500-ID/32-rule/10,000-member limits remain.
- Native MediaPlayer/MediaSoundComponent lifecycle with GetTime observation,
  pause/buffering/seek/reconnect/deadlines/completion and owned audio restoration.
  It is exposed as an Import-menu preview and stops when Import closes.
- Normal-launch and graceful-stop helpers. The helper verifies the game before
  advertising readiness. Runtime install/update/removal refuses its host lock.
  Launcher quoting was tested with a real hidden Node helper and paths containing
  spaces; the test never executed its synthetic game file.

## Verification

- 35 native-companion Node tests passed. The audio test runs 19 nested Lua
  lifecycle cases in Fengari; these are models, not native decoder proof.
- 17 embedded transport/ownership tests passed.
- 10 MCP protocol/stdio tests passed, including the new fixed neutral audio probe.
- 11 runtime installer tests passed on Windows, including the helper lock and
  actual quoted-path helper launch checks.
- Existing archive bridge tests: 26 passed and one platform skip. Five build
  identification/compatibility tests passed. shipping_ready remains false.
- Real Server/browser integration passed: actual media and native AAC snapshot,
  matching beatmap command, pinned delete/release, two-profile sync, real WebCrypto
  configuration/export, key exclusion from page titles, and control revocation.
  That integration deliberately uses synthetic native heartbeats and temporary
  companion storage. It does not establish original-game audio output.
- Current sources are staged in the isolated mod directory for the next normal
  launch. The original game process was neither reloaded nor controlled through
  another UI path after Computer Use denied access.

Local logs/artifacts: D:/reJOIce/Deliverables/fanservice-native-companion-20261025/.
The isolated launcher preserves the known -UserDir lab profile and uses a separate
companion-data directory. It leaves an already-running game alone. The agent did
not execute that launcher.

## Evidence boundaries and remaining work

The original executable's reflected MediaPlayer, MediaSoundComponent and actor
component methods were corroborated against retained PDB/reflection artifacts.
UE5.3 headers provide signatures; the pinned UE4SS struct conversion source was
checked. These do not substitute for original-runtime playback acceptance.

The retained native Tick-beat/GetMasterTimelinePosition analysis shows direct
C++ elapsed-platform-time clock reads. A reflected getter hook alone would not
replace that clock. StartPattern builds interval queues, not an accepted arbitrary
absolute-time beatmap transport. The new audio preview deliberately does not
invoke StartGameButton, StartSongSync, native progression or beat-queue mutations.
The worker supplies a validated beatmap command; dispatch into the original
rhythm session is still unimplemented.

Required next: identify and validate native music-session ownership, integrate
actual audio position and beat/control dispatch, handle seek queue rebasing and
completion without duplicate rewards, then perform actual stream/offline/sync
and full-session/regression/removal acceptance after a permitted normal launch.
The supported-build registry stays empty until those gates pass.

User-reported physical iPhone HTTPS offline restart/play/seek was confirmed in
this continuation and is recorded in the parts 1/4/5 checkpoint. Cloud-only,
revocation, eviction, exhaustion and physical Android checks remain separate.

Later: [normal-launch and Windows worker findings](v004-native-companion-live-20261025.md)
record new evidence and decoder changes without closing audio/rhythm acceptance.
