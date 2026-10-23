# Windows mod transition — 2026-10-22

The required first Windows target remains Cockhero v0.05.1. The user explicitly
declined making the available v0.04 Exclusive build the first supported target.
The original game's media, UI, sounds, gameplay, progression, and saves must stay
intact. Reconstruction sources and presentation work are retained as reference.

## Completed in this change

- Added Export .chpack to Lite selection review and saved custom-pack actions.
- Added the Viewer-authorized, library-read-only POST
  `/api/fanservice/v1/export/chpack` endpoint. It accepts a library identity,
  frozen media IDs, name/author/description/price, and an optional selected cover.
  It deduplicates IDs, rejects missing members and wrong libraries, stages the
  exact media, and returns a portable ZIP without profile or library writes.
- Reused the existing archive writer, preserving multiple explicit gameplay-pool
  tags and cover/count/price metadata. Missing files now fail instead of silently
  producing an incomplete archive. No ownership or credentials are exported.
- Implemented on-device ZIP export for phone-local or mixed selections. Local
  media is read through device blob URLs and is never uploaded. Browser exports
  are limited to 512 MiB to bound memory. Android saving was subsequently added
  through the native document picker; see `EXECUTION_STATUS.md` for its limits.
- Added progress/cancellation and an explicit Download link. Preparing an export
  does not save a pack, buy it, or change live rules. Exported contents are frozen.
- Added standard ZIP-reader tests, browser download/privacy tests, exact Server
  selection tests, compatibility registry checks, and CI coverage.
- Disabled reconstructed Viewer input in the active Windows product packager.
  Preserved its previous implementation as `build-reconstruction-reference.py`.
  The reJOIce manual workflow is now labelled reference verification.

## Native mod gate: blocked, not complete

The official page lists v0.05.1 Public and requires Patron+ for custom import:
https://cockherogame.itch.io/cock-hero . The local inspected installation displays
`V0.05.1 Hotfix Public Build`. Its executable and content hashes are recorded in
`mod/compatibility.json`; the read-only checker independently matches all four.
Matching the version label does not authenticate the local archive's origin.

An isolated copy and separate save folders were used. UE4SS stable 3.0.1 failed
its GMalloc scan. Pinned development commit 83330635 starts and exposes the
original import widget, WebView, and native pack store. The normal Import action
opens the developer access page. No entitlement state was changed.

A direct synthetic widget-construction probe succeeded once, then a later probe
crashed. No working embedded Lite menu, original-menu return path, custom native
Unlocks entry, native purchase, streaming adapter, or uninstall regression has
been established. Automatic approval review rejected the next isolated-game
probe with `blocked by policy`, without a more specific reason. That probe was
not executed. Sanitized diagnostic excerpts are retained under `mod/evidence`.

There is no supported mod build, mod installer, or combined mod Host release.
The registry remains empty of supported builds and rejects unknown/unverified
installations. Server archive validity is tested independently; importing and
playing these exports in the newest original game remains unverified.

## Next work after the gate can be tested

Use an entitled v0.05.1 build and an allowed isolated runtime test. Prove native
Import → Lite → return, then a synthetic native Unlocks entry. Only then wire
profile-bound native UP purchases, live rules/session freezing, remote playback,
music, offline snapshots, synchronization, and mod/Host installers. Do not
replace the original game or bypass its access check to make the gate pass.

Retain mobile gameplay and complete its remaining parity separately. Physical
iPhone/Android checks, iCloud/Hidden Photos access, physical Android archive saving, and
full mobile gameplay parity remain open. No native iPhone companion requirement
has been established. Do not mark these tasks complete from headless tests.

## Local verification

- Server library: 331 passed, zero failures, six existing opt-in tests ignored.
- Clippy with warnings denied and Rust formatting checks passed.
- Shared gameplay/export unit tests: 17 passed, including 4200 XP, 256 Tower
  draft, 216 Tower reward, and 32 media-pool golden cases.
- Compatibility and packaging gate tests: five passed.
- Lite, export, mobile offline/music, and voice browser smoke tests passed using
  Chrome and synthetic media. Export checks include cancellation, exact selection
  and saved-pack downloads, no purchase side effects, phone-local privacy, and
  visible Android-shell saving limitations.
- Changed workflow YAML parsed successfully; 63 asset/license checks passed.
- No GitHub Actions run, commit, push, release, native mod package, or new APK
  was produced by this change. Original-game export import/playback and physical
  device checks remain unperformed.
