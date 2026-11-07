# Configured-game launcher acceptance

Scope: [issue #55](https://github.com/xxjuggernaut9113xx-design/AvtoHmver/issues/55)
and ADR 0007. This checkpoint adds the normal native game entry point while
preserving the empty supported-build authority.

`AvtoHmver.exe --game-launcher` opens a dedicated Slint window before any Host
database initialization. Add game uses an explicit native folder chooser; the
same schema-1 path registry remains readable by the existing Python CLI.
Verification hashes the authority's exact game files on a background thread.
Windows verification retains read handles through process creation and denies
concurrent writes, replacements, directory renames, and reparse-point changes.
Launch uses the exact canonical executable observed while hashing. A failed
recheck clears the prior actionable selection instead of retaining stale support.
Missing games remain visible, as do recognized testing builds and their blockers.
The newest configured supported game is offered, including an older configured
fallback when the newest path fails verification. Rechecks retain the newer
path and append changed observations to an atomic, bounded investigation history.
Identical observations do not flood the log. The initial investigation and the
most recent recovery observations are preserved.

The production authority still has zero supported builds. No synthetic acceptance
fixture is added to it. Tests use a private in-memory authority to exercise older
fallback, recovery, and rejection of an executable changed after verification.
They never execute a fixture or game. A recognized candidate does not enable
Launch. Runtime installation and uninstallation continue to use the existing
experimental ownership-aware tools; no native mod setup completion is claimed.

Validation: `cargo check -p avtohmver-desktop --offline -j 2` passed. The scoped
`cargo test -p avtohmver-desktop --lib game_launcher --offline -j 1 -- --test-threads=1`
passed all five launcher tests, including the Windows file/directory sharing
guard and release checks. The existing Python configured-install suite
passed all five tests; `python mod/verify_compatibility.py` still reports
`supported_builds: []` and `shipping_ready: false`. An initial two-job test build
exhausted available system commit memory; the single-job retry passed. Cargo
artifacts and the native acceptance fixture use E:.

Native Windows UI acceptance used the compiled Host binary with
`--game-launcher` and an isolated registry at
`E:/avtohmver-build/tmp/game-launcher-20261107-0121/configured-games.json`.
The empty window offered Add game with Launch disabled. The explicit folder
chooser selected `E:/fanservice-mod-lab/isolated-d7-cover-test/game`; background
verification recognized `v0051-hotfix-public-a8f46896`, stored all four observed
hashes, displayed its authority blockers, and kept Launch disabled with an
explicit no-compatible-fallback message. Recheck temporarily disabled actions,
retained the configured folder, and left the history at two observations (empty
configuration followed by the recognized blocked game). No game was launched,
no mod was installed or removed, and the acceptance launcher was closed normally.
The final native binary rebuilt successfully after a compact-row layout fix;
reopening it restored the configured game and blocked state, with readable
64-pixel list rows. That second acceptance window was also closed normally.

Remaining issue #55 acceptance: integrated optional mod setup/update/removal,
installer entry-point coverage, and an actual certified compatible older-game
launch/recovery. These require completed original-game acceptance and cannot be
inferred from launcher fixtures or recognition of an executable.
