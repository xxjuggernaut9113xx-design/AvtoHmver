# Native single-player instructor

The GOON desktop Start path now compiles a nonempty native configuration and
runs it through the shared Rust session service. Slint presents active tasks,
remaining active duration, instructions and tempo. Native libmpv handles media,
music and metronome clicks. Gameplay does not load a browser, JavaScript runtime,
WebView, or the reference service.

## Use

Open GOON, select the existing media/music preset, then select Steady, Intervals
or Progressive. Set duration in seconds (60–14400), tempo endpoints (20–240 BPM),
optional unsigned seed, metronome and cue volume. Start admits the configuration
before replacing the media draft. Changes apply to the next run. The generic
Start-session action also uses this compiler, rather than an empty Quick config.

Pause freezes the authoritative active clock, task deadlines, visual playback
and audio. Resume preserves them. Complete releases the selected task's resource
leases. Insert checkpoint queues a known configured task. Next media increments
an authoritative snapshot counter, so coalescing UI snapshots cannot lose the
request. End completes; Cancel cancels. Terminal transitions clear active tasks,
pending tasks, instructions and native audio. Recovery from a polling error
retains media ownership and surfaces the connection error.

Steady keeps the configured initial tempo. Intervals uses stepped tempo with a
recovery phase. Progressive uses an eased curve. The latter two include
double-tempo, acceleration and silent rest tasks. These modify actual native
metronome timing, with highest-priority tempo ownership. Task parameters and
wording are independent native presets, not imported reference scripts.
Intervals also compiles seeded cluster and alternating fast/slow beat programs.
The recovered eight-pattern numeric catalogue supports quarter notes, half
notes, eighth notes and silent rests, normalized to preserve average note BPM.

Import config loads a validated JSON `GameConfig`; Export config writes the
actual compiled configuration, including its resolved random seed. Use preset
returns to the form settings. Imported configurations use the media/music
selection in the desktop setup panel. Disabling rating-matched media allows a
script or metronome session without a populated library. A complete local
example is `docs/examples/native-instructor-script.json`: import it, start,
choose Start, then choose Finish at its checkpoint.

## Contracts

- `src/instructor.rs` compiles native options to a validated `GameConfig`.
- `src/session.rs` owns selection, active time, resource leases, execution order,
  task completion, tempo and lifecycle. A seeded hierarchical draw normalizes
  weights within each branch. Activation can depend on active time, progress or
  completed event IDs. Declarative weights interpolate between endpoints.
- Required and scheduled tasks obey resources but do not consume the ordinary
  concurrency admission limit. A blocked due task suppresses ordinary draws.
  Empty resource sets are background tasks; absent resources mean exclusive.
  Ordinary draws consume blocked attempts and stop after an occupying start.
  Background successes can extend the attempt budget once.
- Scheduled tasks and injections precede random draws. Queue capacity is 1024;
  graph capacity is 1024 nodes, depth 16; event capacity is 256. Missing IDs and
  invalid weights/times/volumes/tempos fail validation before session admission.
- `SessionControl::InjectEvent` and `CompleteEvent` receive timestamps from the
  service clock. `EventTempo` supports multiplier, fixed BPM and ramp. Rest
  supports zero target tempo. Fixed 50ms tempo integration retains the same
  result across regular, delayed and irregular caller ticks.
- Snapshots include concurrent events, completion history, pending tasks, audio
  settings and media skip revision. `current_event` is a compatibility projection.
  Old configuration fields retain serde defaults and legacy scheduling.
- `desktop/src/session_audio.rs` integrates the authoritative tempo and active
  clock into native click timing. It skips missed beats instead of replaying a
  burst; paused, terminal, muted and zero-target snapshots are silent. Audio
  failures are displayed in the playback status.
- `src/instructor_processor.rs` executes bounded typed scripts and per-task
  programs. Waits, blocking choices, nested sequences, concurrent forks and
  joins, sleep/wake, suspend/resume, reset, status effects, tempo/pattern changes,
  local audio cues, media changes and game-over are native operations. Program
  tasks hold resources until their program and child threads complete; manual
  completion cancels the thread tree and removes owned status effects.
  Thread-owned tempo/pattern overrides restore the previous owner when released.
  Snapshots retain 512 numbered outputs so adapters can suppress replay.
- Slint renders pending prompts and their choices, all concurrent task rows,
  persistent status effects and processor faults. The GOON panel scrolls to keep
  controls accessible on small windows. Audio cues use a separate native player;
  they accept existing local files, discard stale cues and emit at most one
  current cue per snapshot. They do not interpret URLs as audio sources.
- Configured native starts use the existing session permission boundary for
  Viewer and the shared maintenance/shutdown admission for Host.

## Reference boundary

The reference was inspected as inert public client scripts. No reference
gameplay or backend code was executed or recovered. The reverse-engineering
skill guided source selection, evidence retention and the distinction between
observed client logic and native design choices.

Original scheduler/processor evidence:
`ev_dcc56f7686dfb25f8bd0b8af8b27b63b4aac98a8f9dfb5689982fcb803c2eacf`.
Generator SHA256:
`fa573f81a9842351362ccdb11ffa64cb09721073ef442790c6452421180512ef`.
Observed generator byte ranges begin at 5876 (resource model), 6118 (hierarchical
draw), 6420 (due predicate), 6628 (dynamic weights), 6908 (task tracker) and 7666
(generation loop). Processor application code starts at 176319 for thread
control and 178510 for event dispatch; elapsed clock and injection operations
are at 212061 and 216254 respectively.

The missing builder, warmup and wait bundles were subsequently acquired as
inert files under the original handoff's sibling `work/fapinstructor-completion`
directory. Their REA analysis is
`ev_d5bfa5e8381968a6b316a8e2decc64f30c3661d07d415c73dae24f7cff2d967a`.
Builder SHA256:
`36ba06127300e6c6075ecd5d960844b3ba1420483d1661f7e640837493c37cfd`.
Builder byte positions 3366 and 10903 identify due startup/warmup tasks; 6499,
6747, 7060, 7256 and 9444 identify rhythm families. Graph construction starts
at 19571. API defaults are separately retained under
`ev_1d34f16f2f477cb8550e8d619a2e102765b7ed7f7bf4bd5800e98cffd34ace4f`.
These IDs are connection-local; local script files and digests remain the
portable record. Static analysis establishes source behavior, not executed
equivalence.

Measures and emitter evidence:
`ev_e9c84b3254e29cfa45abad339454ec09f21f8d7f0f96fe6ff41fc7ed4c50de3e`.
Measures SHA256:
`d0754324353b58c52d33e2df5ef39648380b0e5a235d6143ce3b9d553973d6ac`.
Emitter SHA256:
`0f51ce225e93ca792525dacca59688ac0b7d5e54eb1c1f82ac7dfb8592d331b5`.
For slots, zero is a quarter rest and positive values are quarter-unit note
durations. Unit duration is `60000 / BPM * note_count / total_slot_units`.
Notes sound at the end of their slot; rests advance silently. The native adapter
skips missed notes and does not reproduce the reference's animation-dependent
2.5-second desktop audio delay or its stale-slot catch-up bug.

This implementation intentionally uses active-time cooldowns and a bounded,
typed script format instead of arbitrary JavaScript callbacks/subscribers.
Native category weights interpolate between configured endpoints; interval
program parameters are sampled at compilation using the exported seed.
Reference cooldowns based on summed emitted event durations and its exact
Gaussian tempo policy are not represented as identical native behavior.
Original dialogue, voice assets, device integrations and multiplayer are not
included. No exact original-game or installed-application parity claim follows
from the native engine work.

Source changes preserve the preexisting dirty worktree. Source tests use
temporary data. The live `C:/Users/webma/Curator` database and installed
`C:/Program Files (x86)/AvtoHmver/AvtoHmver.exe` are not modified.

## Verification, 2026-10-21

- Backend library: 326 passed, 6 ignored, 0 failed.
- Final desktop library: 70 passed, 3 ignored, 0 failed. This includes native
  checkpoint choices, pause/terminal cleanup, fractional beat preservation,
  rhythm rests, local cue validation, and the existing size/theme render tests.
- Workspace Clippy, all targets and all features, with `-D warnings`: passed.
- Rustfmt check for modified Rust files: passed. Workspace-wide formatting
  still flags unrelated edits in `src/routes/mod.rs` and
  `src/services/library.rs`; those edits were preserved.
- Changed-file whitespace check: passed, with repository CRLF conversion
  notices. Native GOON rendering was visually inspected at 1200×800; running
  sessions collapse setup and keep the live checkpoint and controls visible.
  The PPM/PNG capture is retained in the original handoff's
  `outputs/native-instructor-validation` directory.

The first unrestricted parallel workspace run hit two existing subprocess
timeout tests; both passed when isolated, and the four-thread workspace rerun
passed. Installed-app replacement and real audio hardware playback were not
performed. These source checks do not establish exact reference-game parity.

`cargo build -p avtohmver-desktop --bin AvtoHmver --locked` passed. The resulting
debug executable is `target/debug/AvtoHmver.exe` (89,720,832 bytes). Its version
smoke prints `AvtoHmver Host 0.3.4`. SHA256:
`D80BAD6E76E02DF711D50A442977E15990CC926AB2875E60E0BEB9D1F9934200`.
The validation directory contains `validation.json` with source hashes and
check outcomes, plus `goon-native.png`. This is a source build, not an installer
upgrade or a replacement of the running installed application.
