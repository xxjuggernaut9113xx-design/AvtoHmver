# Native menu and companion continuation — 2026-11-04

Fanservice now attaches to the original Start Game button's VerticalBox as an equally sized final row, after Quit. Original controls are retained, including Import entitlement and native Unlocks purchases/toggles. When the panel opens, its entry moves to the top-right as Back; closing returns it to the shared list. Reparenting reloads the entry document, resets the click sequence and requires its existing title handshake before accepting input.

## Evidence and checks

- Read-only diagnostics in the exact v0.05.1 Hotfix Public test game established all six visible main-menu controls share `VerticalBox_128`. Their slots use Fill with weight 1 and zero padding. This is live hierarchy evidence, not a completed visual acceptance of the new entry.
- The placement regression runs production Lua functions with native widget mocks and verifies Open → Back → Open, browser document/counter resets and invalid-parent rejection. The existing 20 age/menu guard cases also pass.
- Native companion tests: 75 passed. MCP client tests: 10 passed. v0.05 installer tests: 24 passed. Lua syntax and git whitespace checks passed.
- Actual isolated Rust Server integration passed for both registered v0.04 and v0.05 companion configurations: snapshot data, ownership denial, pins, two-profile sync, browser controls and sealed sync credentials. These checks use synthetic native heartbeats; they do not establish original-game UI or playback acceptance.
- Mobile browser smoke passed local storage, explicit music snapshot, offline playback/seek and session accounting. Real Server two-client sync passed revisions/conflict handling. This run is browser automation, not a new physical-device check.
- Real Server confirmed AAC-to-PCM WAV music delivery passed. The first attempt ran out of space on E:; rerunning only that check with an output folder on C: passed. No unrelated user files were deleted.
- Installer applied the final source revision to the isolated game and every installed owned file matches its recorded SHA-256. Existing profiles, snapshot state, loader and game saves were retained.

## Companion corrections included

The all-library selection `{ids:[],rules:[{}]}` now persists. Unsupported-only rules still fail instead of silently broadening a selection. This fixes the live UI's default selection, which previously saved a browser draft but failed saving its native companion definition.

The helper's bounded readiness wait is now 120 seconds rather than 15 seconds. The previous timeout could report failure during an observed 17-second startup.

## Remaining acceptance

The user is away from the PC. The test game was closed normally to apply the final change. The menu entry's appearance, click target, panel opening, Back and original controls still need checking in the actual game after the user clears its age screen. No age confirmation was submitted automatically.

The previously approved disposable localhost sync connection was created and the neutral draft was saved in the actual game during the prior checkpoint. Actual-game upload → review → apply and native owned snapshot playback remain pending. Automated two-profile tests do not close those gates. Full-plan support remains unclaimed; compatibility.supported_builds stays empty.
