# GitHub build workflow

`.github/workflows/desktop-release.yml` runs on pull requests, main/master pushes,
version tags and manual dispatch. Rust workspace checks, browser unit tests,
worker contracts and dependency security checks are retained.

The validation matrix now checks fanservice JavaScript syntax and the checksums
and license files for its bundled presentation assets. The additional
`fanservice-browser` job installs the exact Playwright dependency from
`tests/browser/package-lock.json`, installs Chromium, and runs
`python tests/run_fanservice_ci.py` against a temporary three-image Rust fixture
with a generated twelve-second AAC soundtrack and confirmed synthetic beatmap.
The fixture never opens an existing user library. Tests cover the two import
tabs, selection, custom pack creation and editing, ownership, enablement,
reload persistence, insufficient UP, and a narrow viewport. Mobile tests also
verify local-file privacy, pause, explicit offline snapshots, seeking without
awarding skipped beats, natural track completion, reward persistence, missing
cached files and unavailable cross-device phone media.
Voice checks import a synthetic local WAV, decode/play it through WebAudio,
verify captions/reload and reject malformed recordings without losing the
previous voice pack or uploading any files. Fixture logs and
screenshots are uploaded even when the job fails.

Windows build jobs and tagged draft releases require the browser check to pass.
Pull requests supersede earlier runs on the same ref; tag builds are not canceled.
Existing artifact filenames remain compatible with the installer scripts.
The Windows installer job additionally stages the fanservice Server with its
verified helper tools, portable ZIP, installer, licenses and SHA-256 checksums;
tagged draft releases include those separate fanservice artifacts.

The desktop workflow produces Server and legacy avto desktop packages. The
legacy Rust Viewer is separate from the planned original-game fanservice mod.

`fanservice-android.yml` builds the shared frontend into a Capacitor Android APK
using pinned npm dependencies, Java 21, SDK 36 and the checked-in Gradle wrapper.
It verifies the APK signature before uploading the debug artifact. Debug keys
are local to each runner: this is a test installation, not a store release or a
stable signing identity for upgrades. Physical device checks remain separate.

The Android shell registers `ArchiveSave` for on-device `.chpack` saving through
the system document picker. Shared export tests cover its chunk transport and
UI success/cancellation/failure paths using a mock bridge; APK compilation and
signature verification are additional checks. Destination-provider behavior,
storage exhaustion, and process interruption require physical-device validation.
See `EXECUTION_STATUS.md` for current evidence and the unresolved native mod gate.

The reJOIce repository retains a manual-only `fanservice-unreal.yml` for reference verification. It requires a
Windows self-hosted runner labelled `unreal-5.3` with `UE53_ROOT` set and Git LFS
content available. It builds Editor/Game, checks fresh recovery automation
results, and optionally cooks a reference archive, not a fanservice mod. It never runs pull-request
code automatically on the licensed host. Configure that runner before dispatch.

All referenced fanservice sources, tests, assets and lockfiles must be included
in the pushed revision. Editing this local workflow does not dispatch GitHub
Actions or publish a release.

## Original-game mod transition (2026-10-22)

Windows fanservice now targets a mod of Cockhero v0.05.1, preserving its original
UI/media. No supported mod adapter or Windows mod/Host installer exists yet.
`fanservice-mod.yml` validates build identities and the strict support gates,
runs portable archive tests, and publishes readiness diagnostics only. A known
executable hash is not sufficient to declare support. The public build requires
Patron+ for Import; the original access check is preserved.

The Server browser job also verifies selection and saved-pack `.chpack` exports,
ZIP contents/covers/prices, no purchase side effects, and phone-local exports
without uploads. The versioned export route permits Viewer downloads only; it
does not grant library writes.

`packaging/windows/build-fanservice.py --viewer ...` now fails before staging,
preventing accidental shipment of the reconstruction as the mod. The prior
builder remains `build-reconstruction-reference.py`. The reJOIce manual workflow
is labelled reference verification; its cooked archive is not a fanservice
Viewer release. Server and Android workflows remain active.
