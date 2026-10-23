# fanservice integration checkpoint

## Current product direction — October 22

The Windows product is a mod of the original Cockhero v0.05.1. The active
Server/shared frontend sources are in this repository. `E:/reJOIce` is retained
as a reconstruction reference; its native smoke results below do not establish
original-game mod compatibility. See `MOD_TRANSITION.md`, `EXECUTION_STATUS.md`,
and `../../mod/compatibility.json` for current acceptance and blockers.

The October 21 entries below are historical reconstruction checkpoints. Their
outstanding-feature lists and claims about the active Windows game are superseded
by the consolidated plan and current status. Preserve those sources and evidence.

## October 21 implementation continuation

### Native Viewer verification follow-up

The isolated native Editor/game-mode smoke passed embedded CEF loading and
bridge calls, UP rejection/purchase/idempotency, live resolution, Server PNG
decoding, selected cover loading in native Unlocks, accurate UP display and
profile disk reload. The temporary profile was removed. Initial failures exposed
and led to fixes for missing explicit WebBrowser-module initialization and a
stale designer balance label. Native custom covers now display selected Server
thumbnails rather than only the generated default.

The new full recovery regression run passed 119 tests, zero failures/test
warnings/skips. The final balance-label correction then passed a stricter native
smoke and visual inspection. Final Game rebuild passed. Reproduction and
retained evidence are in the game's `FANSERVICE_NATIVE_SMOKE.md` and
`RecoveryEvidence/fanservice-native-20261021-*`. Prior native-unverified and
default-cover-only notes below describe the earlier foundation checkpoint.

This does not verify native video playback, complete custom-pack sessions,
profile switches with in-flight requests, remote authorization or mobile.
One parallel Editor startup failed for insufficient virtual memory; the serial
regression rerun passed. Keep Unreal validation serial on this machine.

The earlier feature ledger below is historical. Current changes add the read-only
v1 Lite adapter, two-tab Kenney-based import UI, live-rule pack creation/editing,
and native Unreal profile/UP/Unlocks integration. See `LITE_PROTOCOL_V1.md` for
endpoints, lifecycle and reproducible browser checks. The active game remains
`E:/reJOIce`; existing avtoHMVer working changes remain uncommitted and preserved.

Verified this continuation:

- Server library suite: 325 passed, zero failed, six optional/interactive tests
  ignored. Real FFmpeg music-conversion and beat-rescan tests then both passed.
- JavaScript custom-pack model: six tests passed.
- Isolated headless Edge smoke: two tabs, organization-to-library selection,
  live creation, rule edits preserving identity/ownership/enablement, reload,
  insufficient UP, and 390-pixel layout passed. This is not physical-mobile or
  embedded-CEF verification.
- Latest Game and Editor Development builds passed with final profile guards;
  full recovery automation passed 119 tests, zero failures/test warnings, none skipped.
- All seven existing newer-content contract tests passed.

Native custom packs resolve on Unlocks view and session preparation. Their
resolved session list is detached from subsequent library changes. Remote image
loading and HTTP video playback are implemented. Native saves use actual game UP
and pack ledgers; standalone browser profiles start with zero UP. Profiles that
use custom definitions refuse empty/unavailable selections instead of
substituting original media. Corrupt/unsupported custom data rejects mutation
and playback while retaining saved content.

Not complete: embedded-browser/native streaming GUI validation, offline
snapshots, Server profile synchronization, phone-local pack membership, mobile
gameplay/parity, self-hosted music transport wired into the game clock, Android
APK, combined Host/Viewer installers, remaining presentation replacement,
full-session/restart acceptance and release verification. The historical October
20 package is not an updated fanservice package. Native custom covers currently
use a generated default; chosen thumbnails appear in browser Unlocks.

Physical iPhone checks remain pending. No conclusion about Hidden Photos or a
native companion has been reached. No iPhone companion has been started.

## Historical baseline

Implementation begins with preservation and physical iPhone feasibility. The existing library, game, original media, saves and evidence are retained.

## Baselines

- avtoHMVer HEAD: addd9634946a76ae03b58fcee469ae6906e3637b. Existing tracked and untracked work copied into fanservice-baselines/20261020-191025 before implementation. This is a working-change snapshot, not a full repository backup.
- Active game repository: E:/reJOIce, HEAD ff208850d4168b786054c6d69764c459691672af. Read-only inspection reports a clean working tree. D: references are historical.
- Latest recorded game evidence: UnrealReconstruction/RecoveryEvidence/integrated-20261020-delivery.json, 115 passing tests and packaged smoke. No fresh game test run in this milestone. Final Editor presentation changes need rebuilding; Game changes were packaged. Physical devices, clean machine and original-runtime parity remain unverified.

## Feasibility procedure

Serve static/media-probe/ using the existing Server at /media-probe/. Use the same authorized HTTPS origin throughout; browser storage belongs to that origin. The existing Server's remote access authorization remains required. Do not expose a separate unauthenticated media server.

On an actual iPhone, record OS/browser versions and test each picker with a local file and cloud-only selection. Explicitly inspect whether Hidden Photos can be selected. The page cannot determine the source album or whether a file was cloud-only: record the actual observation manually. Do not infer success from API presence.

Play, activate audio, seek, lock/unlock, switch apps and resume. Save a browser copy, reopen it, cache the test page, then test offline. Fully close the browser, restart on the same address, reopen saved media and repeat playback. Export diagnostics explicitly; the page uploads nothing and omits filenames. Export contains device browser details and observations. Quota errors are surfaced; missing storage cannot distinguish removal from eviction.

If Hidden Photos is unavailable and requires a native companion, stop that feature and ask the user to drop it or change course. Do not build an iPhone companion or substitute unhiding/exporting. Android APK remains required.

## Feature ledger

- PRESERVE-01: working-change snapshot created; no original game or media changes.
- IPHONE-01: functional local-only picker/playback/storage probe implemented. Physical verification pending; no feasibility claim.
- GAME-01: updated recovery evidence reviewed; remaining gaps must be audited against current code rather than historical 90-test TODOs.
- SERVER-01: versioned manifests, permissions and profile synchronization pending.
- VIEWER-01: Unreal Server adapter and Host integration pending.
- MOBILE-01: parity frontend, golden fixtures and Android APK pending.
- RELEASE-01: migration, distribution rights review, signing, packaging and complete acceptance journeys pending.

Continue broader implementation after the early physical-device milestone. No reconstruction-completion claim is made by this ledger.
