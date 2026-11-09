# Tickets 52 and 53: interrupted edges and music returns

On November 8, the shared Web app player passed a headless Microsoft Edge check
using current working-tree assets and a synthetic four-second PCM WAV recording.
No personal media or original game executable was used.

`tests/fanservice_interruption_smoke.cjs` starts actual HTML audio, dispatches
`pagehide`, and observes gameplay pause. Clicking Resume begins a real edge card:
its queued beats advance on active gameplay time while the audio stays paused at
the exact saved position and the recording's beat/event cursors remain unchanged.
The test interrupts the edge after its Edge action, reloads the page, and explicitly
starts the restored session. It verifies rollback of the interrupted edge metric,
the same saved audio position and event cursors, a single replayed edge, subsequent
audio playback, the final recording event, and once-only session/win settlement.
Its Classic continuation activates Loot Rush and Resupply through the real item
controls after seeding starting inventory through the public inventory API. Loot
Rush decreases on active return time, and delayed Resupply opens its store and
consumes its charge. Two repeated interruptions restore that charge, its usage
metrics and both starting timers before replay. The run regression independently
verifies rollback of the edge's recorded metric and pending reward bank.

Run from the repository with:

```powershell
$env:FANSERVICE_BROWSER_EXECUTABLE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node tests/fanservice_interruption_smoke.cjs
node tests/fanservice_music_timeline_smoke.cjs
```

Both checks passed. The existing full `fanservice_mobile_smoke.cjs` also passed
against an isolated Rust fixture after adding the required real return edge to its
reload flow. That fixture run used the retained
`E:/avtohmver-build/debug/deps/avtohmver-1baa406af9fd30a7.exe` and current static
assets, with generated audio and disposable output under
`E:/avtohmver-test-results/mobile-return-20261108/`. This particular run does not
certify a freshly compiled Server executable.

After the fixture bind became configurable, a fresh current test executable was
compiled with `CARGO_TARGET_DIR=E:/avtohmver-build` and
`cargo test -p avtohmver --lib --locked --no-run -j 1`. The same mobile check and
both recording checks passed together on the isolated `127.0.0.1:42173` fixture:

```powershell
$env:FANSERVICE_BROWSER_EXECUTABLE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:FANSERVICE_TEST_BINARY='E:/avtohmver-build/debug/deps/avtohmver-1baa406af9fd30a7.exe'
$env:FANSERVICE_FIXTURE_ORIGIN='http://127.0.0.1:42173'
$env:FANSERVICE_SMOKE_OUTPUT='E:/avtohmver-test-results/mobile-return-20261108-unique'
python tests/run_fanservice_ci.py fanservice_mobile_smoke.cjs fanservice_interruption_smoke.cjs fanservice_music_timeline_smoke.cjs
```

The fixture log records its unique address and the runner terminated its own
fixture process after all three checks passed.

## State and timing

`Run.interrupt()` persists the need for an explicit return action. Visibility loss
and page hiding pause audio, video and gameplay; becoming visible does not resume
them. Restored sessions require the existing explicit Start action. Ordinary
manual Pause/Resume remains an ordinary pause.

Each new edge sequence stores an edge-start run snapshot before delivering beats.
The first direct Edge action also stores its entry state before recording its
effects. Replaying restores that snapshot, including state, inventory, objective,
Tower state and random cursor. Earlier completed edges remain in the snapshot;
the current edge's beats, meter, streak and pending rewards are undone. Completing
or canceling an edge discards the old snapshot, so subsequent interruptions cannot
restore a prior completed objective or Tower round. Snapshots exclude their own
previous snapshot, keeping repeated checkpoint serialization bounded.

The return uses the actual edge-card queue and Edge action, followed by its
handoff/hold boundary. Music mode permits this edge only during a return. Its
recording sampler is held throughout the return while the gameplay clock runs;
completion resumes audio without moving the saved recording/event cursors.
Existing active item effects tick on that same gameplay time and are included in
the edge-start snapshot; their delayed consumption and metrics roll back with it.
Reload seeking does not reconcile or replay already delivered recording events.
Frozen media membership and pinned session packs remain in the session envelope.

`tests/fanservice_interruption.test.js` covers current-edge rollback, repeated
interruption/reload, preservation of completed edges, cancellation after objective
completion, and legacy checkpoint migration. These regressions were observed
failing before their fixes and passing afterward. The targeted run/edge/card/item/
mobile-settlement suite passed 55 tests after the migration regression was added.

## Compatibility and acceptance limits

The saved-session format remains version 1 with optional new fields. Older saved
sessions do not contain an edge-start snapshot. Their authoritative saved counters
and inventory are retained, and the first return starts a fresh edge with a new
snapshot. Effects earned before that legacy save cannot be reconstructed or
retroactively rolled back. Subsequent interruptions use the new rollback rule.

The browser checks simulate lifecycle events and use a range-capable synthetic
recording endpoint. They establish browser player behavior, not physical phone
locking, OS process death, Safari behavior, Android WebView behavior, or newest
original-game runtime parity. Those device/runtime acceptance checks remain
separate from this evidence.
