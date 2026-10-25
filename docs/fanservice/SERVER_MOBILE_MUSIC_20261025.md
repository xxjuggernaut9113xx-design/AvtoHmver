# Server, mobile and music checkpoint - October 25, 2026

This continuation follows 47bdccbf. It fixes concrete API, mobile sequence and
music transport defects and rebuilds the Server and Android test packages.
It does not certify the complete original-game mod or full mobile parity.

## Server

The documented GET /api/fanservice/v1/music/{id}/beatmap now returns the editable
recording-bound map, with unshifted times and its offset. Playback manifests apply
that offset exactly once. Missing, invalid or replaced recordings cannot supply
a stale map. Supported control values are bounded primitives across clients;
null/structured/nonfinite values are rejected. Accent beats are accepted consistently.
Profile documents and credential errors use Cache-Control: no-store.

The real HTTP Viewer-only gateway regression covers capabilities, authorized
profile PUT/GET, revision conflicts, no-store and forwarded-header edit rejection.
[Deployment instructions](SERVER_DEPLOYMENT.md) distinguish the Server API from
static HTTPS/Python hosting without modifying any live Tailnet or user library.

Fresh Rust validation: 334 library tests passed, seven opt-in cases ignored by
the ordinary run. Three relevant opt-ins separately passed with real FFmpeg/
FFprobe: browser/native conversion cache and range streaming, stable beat-rescan
identity, and editable-map/offset/changed-recording roundtrip. All-feature library
Clippy with warnings denied and workspace rustfmt checks passed. The optimized
Server binary was rebuilt from the changed Rust source, not reused from an older
checkpoint.

## Shared browser, PWA and mobile

The timeline merges controls and beats chronologically, with controls before
simultaneous beats. Checkpointed high-water cursors prevent heard or skipped
positions from granting rewards again after backward seeks or reload. Persistent
controls reconcile separately from one-shot inventory/dialogue events. Session
and item time follows observed audio position, including buffering and seek holds.

Confirmed soundtrack identity, library/track, stream paths, recording duration,
BPM, sorted beat/control bounds and primitive values are validated before playback
or snapshot staging. A mismatched map cannot replace a working offline snapshot.
The PWA uses shell v14, searches only its current shell offline, and retires only
its older shell caches; it does not delete IndexedDB media or unrelated caches.

Bounded card queues use retained numeric pattern banks and match 128 card-timing
and 186 native queue fixtures. Checkpoints preserve fired/in-flight entries and
random state. Rest markers are not counted as reward strokes when rebuilding a
queue. Real sequence completion produces enemy/Succubus metrics and supported
run-currency/cooldown/item hooks. Tribute records actual button presses until its
source target, including its media restriction and Tower settlement behavior.
See [the mobile timeline report](MOBILE_MUSIC_TIMELINE_20261025.md).

119 shared unit tests passed. The complete ten-check real-Server/browser fixture
suite passed: library, export, mobile offline music/seek/reload, Tower flow,
economy/encounters/Tribute, local media, durable snapshot pins, sync, native
companion boundaries and voices. Encounter boundary integration advances the
actual queue to its calculated end timestamps; it is not a physical real-time
native parity test. Failed earlier runs remain retained: a sync assertion raced
its completion message and an economy timeout assumed old unbounded-card timing.
The final checks await completion and use a fixed seed/appropriate pool deadline.

Android 0.3.10/versionCode 310 built, its v2 signature verified, and all 102 prepared
assets plus 22 shared JavaScript files matched the APK. An in-place upgrade of the
isolated fanservice-test AVD passed copied-video SHA-256 retention, force-stop/
relaunch, 64x64 decode and advancing playback without clearing app data or losing
preexisting files. The local debug signer remains a test distribution identity.

## Native Windows audio transport

The pinned UE4SS 8333063595fa3c49ad307f3b0f732accbb760d25 direct-struct conversion
enumerates reflected/custom fields. FTimespan's unreflected tick field was lost,
so GetTime/GetDuration/FromSeconds roundtrips became zero. A scoped Int64 custom
property at the exact Timespan tick offset restores conversion. A 0.25-second
roundtrip must pass before constructing audio objects. Original native clocks
and beat queues are not patched, and no wall-time audio clock is substituted.

FANSERVICE_MUSIC_2 carries the confirmed duration into native playback. Decoder
metadata must match within 0.35 seconds. Windows file URLs are decoded once and
opened through OpenFile; HTTP uses OpenUrl. Muted preroll permits WMF preparation
and paused seeks, while bounded actual-clock observation handles frame rounding.
The actual reported seek position is preserved, never replaced by the target.

Fixed neutral AAC probes in the exact isolated v0.04 game passed streamed and
local-file pause, seek, resume and reconnect. WmfMedia reported duration 11.999s;
the final streamed seek reached 4.040s and reconnect advanced to 4.319s; the local-file seek
reached 4.040s and reconnect advanced to 4.342s. The native balance remained 4 UP.
No age confirmation, gameplay start or reward operation was automated. All
restarts and cleanup were confined to the known isolated test executable/profile.
Backups of every replaced lab script were retained.

The sampler/menu polling uses persistent loader-owned game-thread loops, avoiding
per-tick async callback registration and lost queued-work flags. Catalog text is copied before later native invocations can invalidate
borrowed result storage. Native model/filesystem contracts and three Lua parsers
pass; the Lua audio suite includes 54 lifecycle cases. Fixed MCP tools take no
caller URL/path or generic game-input arguments. These are transport/model scopes,
not full native gameplay or physical speaker-audibility acceptance.

## Remaining completion gates

- Native original-session ownership, audio-driven beat/control dispatch, owned
  widget-clock rebasing, seek/reward deduplication and full-session regression.
  The working Import preview/diagnostics do not implement that adapter. Live
  Server membership insertion and real snapshot-menu acceptance remain separate.
- Full mobile edge production and every card/item/event interaction. Legacy Edge
  type 2 is absent from the newer available-item/capacity model; its debug-default
  99 charges must not be imported as production entitlement. Speed-change events
  still need source-established runtime semantics. Known fixtures are a subset.
- Physical cloud-only Files/Photos providers, revocation, exhaustion/eviction and
  Android providers. The user-confirmed iPhone HTTPS offline close/reopen/play/seek
  check is accepted only for that specific physical behavior.
- Actual production HTTPS/API deployment combinations and release signing remain
  separate from isolated gateway checks and the debug APK. No live configuration
  was changed and no release was published.

supported_builds remains empty and shipping_ready remains false. Source, logs,
updated packages and checksums are staged under
D:/reJOIce/Deliverables/fanservice-completion-20261025/.

## Package lifecycle verification

The rebuilt Server installer and portable ZIP passed isolated installation,
upgrade and uninstall: 221 owned files verified/removed, all five synthetic
library/config/profile/user sentinels preserved, and all 123 packaged static
source files matched current source. No Server was launched against user data.

The final native transport report compares all three staged Lua modules with
source byte-for-byte and verifies unchanged 4 UP after both tests. The owned
isolated game and helper were stopped after validation; profiles and rollback
files remain. Earlier failed codec/queue probes remain in the local evidence.

Server installer SHA-256:
c798fcdd19abf118e72adf116977ec6680a13636a01a25f95eea3586c557f794.
Server ZIP SHA-256:
9e3365b2f43324dbde43a85debcb3504a8f29c61bad3c78303c7a23002fbd613.
Android 0.3.10 debug APK SHA-256:
710c7139b38a6547dbd7226604396f18d86bcab14974b7d302cf57d7a7d349c9.
