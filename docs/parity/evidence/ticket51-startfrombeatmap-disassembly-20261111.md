# Ticket #51: StartFromBeatmap disassembly from the v0.05.1 Hotfix build (2026-11-11)

## Result

**The nonzero-offset question is settled: the original does NOT apply
`FBeatmapMeta.Offset` to beat times or event times.** The field is parsed and
stored, then never read by any routine — including the two spawner entry
points, whose bodies were the one missing piece and are now disassembled from
the hash-verified executable. No player code change follows: the player's
confirmed-manifest contract (offset 0, times baked once, consumed directly) is
consistent with the original's runtime behaviour for file offsets. Ticket #51
stays **open**: its acceptance criteria also cover event/progression
correspondence and weighting for supported MEDIA events, which this
disassembly does not resolve.

## Build provenance

- Executable: `~/workspace/rejoice-evidence/cockhero-itch/Windows/CockHero/Binaries/Win64/CockHero.exe`
  (262,483,456 bytes), SHA-256
  `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10` — matches
  the selected original build exactly.
- PDB: `CockHero.pdb` in the same directory (341,020,672 bytes), public
  symbol stream 10, 630,923 `S_PUB32` records extracted with an adaptation of
  the repo's `Analysis/read_pdb_symbols.py` approach
  (`~/workspace/rejoice-evidence/cockhero-itch/work/sym_scan_v051.py`,
  `all_pub.json`).
- **All addresses below come from this build's own PDB**, not from the
  newer-20261017 reference build. They happen to be identical to the
  reference build's (`native-symbol-addresses.json`), which is why the
  retained Ghidra decompilations of the same addresses apply here; the
  identity was verified, not assumed.

## Symbol addresses (this build's PDB)

| Symbol | VA | File offset |
| --- | --- | --- |
| `UBeatSpawnerManager::StartFromBeatmap` | `0x148321290` | 137496720 |
| `UBeatSpawnerManager::StartFromBeatmapWithMediaSync` | `0x1483213f0` | 137497072 |
| `UMusicModeManager::ParseBeatmapJson` | `0x148302440` | 137370176 |
| `UMusicModeManager::StartPlayback` | `0x148314390` | — |
| `UMusicModeManager::Tick` | `0x148315ac0` | — |
| `execStartFromBeatmap` / `execStartFromBeatmapWithMediaSync` | `0x14823c6a0` / `0x14823c780` | — |
| `UMediaPlaybackController::SetBeatInterval(float)` | `0x1482aa250` | — |
| `UMediaPlaybackController::SetSyncStartTime(double, double)` | `0x1482af730` | — |
| `UMediaPlaybackController::SyncToBeat(double, double, double)` | `0x1482ba220` | — |
| `UBeatSpawnerManager::StopSequence` | `0x148321e70` | — |

Full disassemblies:
`~/workspace/rejoice-evidence/cockhero-itch/work/StartFromBeatmap.asm`,
`StartFromBeatmapWithMediaSync.asm`, `StartPlayback.asm`,
`ParseBeatmapJson.asm` (objdump 2.42, `.text` VMA `0x140001000`, file
offset `0x600`, image base `0x140000000`).

## StartFromBeatmap (0x148321290) — what it does

Signature from the PDB mangling:
`void UBeatSpawnerManager::StartFromBeatmap(UMusicModeManager*, double)`.
`this` in `rcx`, manager in `rdx`, the double in `xmm2`.

1. Null-checks the manager; if null, logs and returns.
2. If already running (`this+0x178` set), calls `StopSequence`
   (`0x148321e70`).
3. Sets `this+0x170 = 1` (running flag), stores the manager pointer at
   `this+0x168` (`MusicModeManagerRef`, reflection offset 360), and stores the
   double at `this+0x1c8` (`CurrentBeatTravelTime`, reflection offset 456).
4. Clears the beat-event queue array at `this+0x148` (stride `0x48` per
   element, `FMemory::Free` per live element, then
   `TArray<FBeatEvent>::ResizeTo` to 0), zeroes counters at `+0x180`,
   `+0x190`, `+0x174`.
5. Computes a start timestamp at `this+0x130` (`MasterTimeReference`,
   reflection offset 304) from the platform clock — `QPC * scale + epoch`,
   the same formula `StartPlayback` uses. No lead-in is added here.
6. **Writes `0.0` to `this+0x138` (`TimelineOffset`, reflection offset 312,
   double).** It does not set it from anything.
7. Sets `this+0x178 = 1` and broadcasts `OnSequenceStarted`
   (`FOnSequenceStarted_DelegateWrapper`, `0x1482187a0`).

**The manager pointer is never dereferenced.** After the null check and the
store to `+0x168`, the register is reused as the queue-loop pointer. The
function never reads `LoadedBeatmap` (`+0x238`) or `Meta.Offset`
(`+0x298`). No arithmetic involving `Meta.Offset` exists anywhere in the
body.

## StartFromBeatmapWithMediaSync (0x1483213f0) — same, plus media

Signature: `void StartFromBeatmapWithMediaSync(UMusicModeManager*, double,
UMediaPlaybackController*)`. Steps 1–7 are identical, plus:

- Stores the media controller at `this+0x80` (`LinkedMediaController`,
  reflection offset 128).
- If a controller is present, converts the double to float and calls
  `UMediaPlaybackController::SetBeatInterval(float)` with it.
- Calls `SetSyncStartTime(startTime=+0x130, timelineOffset=+0x138)` — the
  second argument is the just-zeroed `TimelineOffset` (0.0).
- Calls `SyncToBeat(doubleArg, startTime=+0x130, 0.0)`.

Again: no read of the manager's `LoadedBeatmap` / `Meta.Offset`, and
`TimelineOffset` is zeroed before being handed to the controller.

## The double argument is not the offset

`StartPlayback` (`0x148314390`, disassembled from this build) calls the
spawner at `0x148314a30` / `0x148314a37`:

```
mov  0x4c0(%rbx),%r9    ; media controller (manager+0x4c0)
mov  0x4b0(%rbx),%rcx   ; spawner (manager+0x4b0) — callee "this"
movsd 0x6c0(%rbx),%xmm2 ; DOUBLE at manager+0x6c0
mov  %rbx,%rdx          ; manager
test %r9,%r9
je   StartFromBeatmap
call StartFromBeatmapWithMediaSync
```

The double is `UMusicModeManager+0x6c0`, loaded with `movsd`. (The retained
Ghidra rendering `(int)param_1[0xd8]` is a mis-decompilation; the machine
code loads a double.) `+0x6c0` is a separate, unreflected double field
immediately after `LookaheadWindow` (`+0x6b8`, reflected). Its consumers all
treat it as a seconds-per-beat quantity:

- `SetBeatInterval(float)` / `SyncToBeat` on the media controller;
- `UMusicModeManager::Tick` (`0x148315ac0`): passed to event-processing
  helpers and used in beat/event dispatch;
- `EndBreak` (`0x1482dda70`): `currentAudioTime + *(double *)(manager+0x6c0)`
  as the skip-ahead threshold for beats.

Its writer is not in any retained `.c` body (only three reads exist in the
retained set); the exact derivation — presumably `60 / BPM` — is an open
loose end, but it does not affect the offset question: `+0x6c0` is not
`Meta.Offset` (`+0x298`), and the two fields are 0x428 bytes apart on
different objects' layouts.

## ParseBeatmapJson spot-check (this build)

Disassembled `ParseBeatmapJson` (`0x148302440`, 1,328 lines) from this
build's exe. The only store to struct offset `0x60` is a single
`movsd %xmm0,0x60(%r13)` — the parsed `offset` value written verbatim into
`Meta.Offset`. No arithmetic on `+0x60` occurs anywhere in the body, and no
other instruction touches that slot. This corroborates the retained
874-line decompilation: the parser copies the offset without modifying
beat/event times.

## Conclusion for the offset question

- `FBeatmapMeta.Offset` is read from JSON exactly once, stored at
  `LoadedBeatmap.Meta.Offset` (music-manager `+0x298`), and **never read by
  any routine**: not by the parser, not by either `StartFromBeatmap`
  function (the last unrecovered candidates), not by `Tick`, `EndBreak`,
  `StartPlayback`, or any other retained body. The grep for `+0x298` /
  `+0x270` over the retained bodies in
  `docs/fanservice/evidence/ticket51-offset-validation-20261110.md` had one
  gap — the two spawner bodies — and this disassembly closes it.
- `TimelineOffset` (spawner `+0x138`) is explicitly zeroed at sequence
  start in both functions, not set from `Meta.Offset`.
- Beats and events therefore fire at their **authored times**: `Tick`
  enqueues beats with `beat.Time <= audioTime + LookaheadWindow` and
  dispatches events with `event.Time <= audioTime`, with only the separate
  profile/latency adjustment (`profileAdjustmentSeconds`) added to
  `TargetHitTime`. Completion is `audioTime >= Meta.Duration`.
- The three shipped maps with nonzero offsets (Instructions Unclear `+0.004`,
  Lil Brat `-0.013`, Pleasure Place `+0.016`) play at authored times in the
  original; their first beats/events already approximate the offset, which
  is consistent with the authoring tool having baked it into the
  timestamps — and with the runtime ignoring the field.

## Comparison with the player (no discrepancy, no code change)

- The player's confirmed-manifest contract — bake the user-supplied
  correction into times once at confirm time, store `meta.offset: 0`, consume
  times directly (`src/routes/fanservice_music.rs` shift closure;
  `static/fanservice/store.js` line 52) — is consistent with the original
  for file offsets: the original ignores the file field and plays authored
  times. The player's `store.js` rejection of `meta.offset !== 0` is a
  tamper guard on the player's own confirmed format (the Rust route always
  writes `offset: 0`), not a claim about the file field, and the Rust
  editable offset is a deliberate user-correction feature, not an
  original-behaviour claim. Shipped `beatmap.json` files are never fed
  through the player's proposal/confirm route, so the file field never
  enters the player's flow.
- No player change was made on this evidence. Nothing in the disassembly
  contradicts current player behaviour.

## What remains open on #51

The offset half of #51's acceptance criteria ("native nonzero-offset …")
is settled. Still open:

- **Event/progression correspondence**: how beatmap events map to
  progression/upgrades — the retained runtime log ran a zero-offset map with
  0 events, and this disassembly covers sequence start, not event effects.
- **Weighting only for supported MEDIA events**: the player's event
  weighting covers only supported MEDIA events; original-side confirmation
  of which events carry weight is still missing.
- Loose end: the writer of music-manager `+0x6c0` (presumed `60 / BPM`)
  is not in any retained body.

## Adjacent findings from this session (details in the run log)

- **Oodle / cooked packages — plan B is dead.** A whole-tree search of the
  extracted build found no `oo2core_9_win64.dll` or any Oodle library (33
  DLLs total, none Oodle). The v0.05.1 PDB contains 2,566 Oodle/`oo2`
  symbols (`Kraken_Decode_Headerless` at `0x14b118480`,
  `FOodleDataCompressionFormat::Compress`, etc.): Oodle is statically
  linked into `CockHero.exe`. Windows retoc under Wine has no DLL to load,
  and no DLL will be downloaded from a random site. Remaining options:
  lift the statically-linked Kraken decoder out of the exe (large RE job),
  unpack on a Windows machine with a GPU where the game itself mounts the
  containers, or obtain a legitimately licensed Oodle library (UE engine
  install / RAD SDK) — none present in this VM.
- **Wine launch:** the game launches under Wine 9.0 + Xvfb, mounts its
  IoStore containers (`global.utoc`, `CockHero-Windows.utoc/.pak`), then
  dies at D3D11 RHI init — assertion `CanFormatBeDisplayed(this,
  CandidateFormat)` (`D3D11Device.cpp:754`), exit code 3, ~68 s, 1,324 log
  lines. No GPU in this VM, so no native runtime run is possible here; the
  disassembly route above is what settles the offset question instead.
