# Official RGB checkpoint identity

Measured on 2026-11-07 from the official P-HAR release asset, as permitted by
ADR 0002 and ADR 0004. This is a repository pin of downloaded bytes, not a
publisher checksum or a claim of classifier accuracy.

- Source repository: https://github.com/rlleshi/phar
- Source revision: `94adf9900cd36360795709d920b44404f29bad3e`
- Release: https://github.com/rlleshi/phar/releases/tag/v1.0.0
- Release ID: `68089736`
- Asset ID: `68193860`
- Asset: https://github.com/rlleshi/phar/releases/download/v1.0.0/timeSformer.pth
- Exact length: `970440477` bytes
- Measured SHA-256: `184163c9c527113432dc6bfb639e1e604614186d243a6006016772455024378f`
- Measurement: `Get-FileHash -Algorithm SHA256` after a successful HTTPS
  download using `curl.exe -L --fail --retry 2`.
- Official release API still reports `digest: null`; size and asset identity
  were checked against https://api.github.com/repos/rlleshi/phar/releases/tags/v1.0.0.
- License reference: https://github.com/rlleshi/phar/blob/94adf9900cd36360795709d920b44404f29bad3e/LICENSE
  (Apache-2.0).

The checkpoint is held only in local E: acceptance scratch and is not tracked,
packaged or bundled. Production obtains it only after explicit opt-in. The
manifest now contains only RGB TimeSformer: audio, skeleton, detector and pose
checkpoints are not prerequisites for the initial RGB runtime.

Install streams into `phar.staging/timeSformer.pth.part`, enforces the exact
size and SHA-256, syncs the completed file and moves it to
`phar/checkpoints/timeSformer.pth`. Interrupted and failed transfers never
replace the installed file. Retry restarts an incomplete transfer; Repair
first rehashes an existing installed checkpoint, reuses matching bytes and
replaces mismatches only after a verified download. Cancellation polls during
connection and streaming waits every 200 ms, with 20-second connection,
60-second response-header/body idle and two-hour total transfer bounds. The
web Admin Install / resume control explicitly resumes a cancelled setup;
automatic startup continues to respect a saved cancellation.
The cancellation marker is authoritative over late progress/completion
snapshots and survives restart. Only explicit resume holding the setup lock
may clear it. Saved disable also overrides late worker snapshots.

`assets_ready` is a durable successful **asset installation** state. It does
not set the inference `ready` flag or write `runtime.json`. The existing
multimodal adapter still requires its managed interpreter, dependencies and
upstream demo; it is not launched by the new RGB asset state. An old runtime
marker also needs the pinned RGB hash and installed size before it can claim
runtime readiness. Runtime provisioning, switching that adapter to RGB,
CPU/GPU measurements and successful real inference remain separate acceptance
work. Self-test rehashes the asset and reports this distinction; missing or
corrupt assets require Repair. Existing cancellation, configuration and
next-launch disable controls retain their saved state.

Verification commands (build and temporary output on E:):

```
cargo test -p avtohmver --lib phar::tests --offline
cargo test -p avtohmver --lib phar::tests::official_rgb_asset_matches_measured_pin --offline -- --ignored
```

2026-11-07 final result: `phar::tests --include-ignored` passed all 11 tests,
including the real official-byte control acceptance and cancellation races.
The same freshly built test binary also passed the classifier service control
test (1) and Admin permission tests (2). Final changed-file diff checks passed.

The ignored check requires `CURATOR_PHAR_ACCEPTANCE_ASSET` pointing at the
locally held official asset. It verifies those exact bytes, then uses a
same-volume hard link to exercise Admin install/resume, Repair, Self-test,
durable status and next-launch disable with the actual pinned checkpoint.
The transport regression uses neutral fixture bytes to cover install, offline
reuse, wrong bytes, partial responses, repair, header/body stalls and bounded
cancellation; it makes no inference claim.
