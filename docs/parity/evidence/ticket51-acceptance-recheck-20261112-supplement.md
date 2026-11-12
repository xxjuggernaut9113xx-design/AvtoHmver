# #51 — Acceptance re-check supplement — 2026-11-12

Supersedes the offset and dispatcher rows of
`docs/parity/evidence/ticket51-acceptance-recheck-20261112.md` §4.
Work done on branch `spec/avtohmver-open-tickets` starting at HEAD
`85a486c` (local commits only). Ticket body (GitHub issue #51,
"[Fanservice] Newest-game music timeline and completion"): *"Recover
and implement recording-clock beats, breaks and event effects through
a complete playable song, including buffering and progression."*

## Correction: the 2026-11-12 re-check missed the StartFromBeatmap disassembly

The re-check's criterion-2 "missing piece" was that
`StartFromBeatmap` (0x148321290) / `StartFromBeatmapWithMediaSync`
(0x1483213f0) were "unrecovered, so a nonzero offset could still be
applied at spawner init". That was already wrong when written:
`docs/parity/evidence/ticket51-startfrombeatmap-disassembly-20261111.md`
exists (under `docs/parity/evidence/`, not
`docs/fanservice/evidence/` — the re-check looked in the wrong
directory, and `store.js` cites it without a directory). The
disassembly was **independently reproduced from the exe with
objdump this session, line-for-line**, and extended (see below).

## Offset settlement (criterion 2 blocker — closed)

- `StartFromBeatmap` (0x148321290, 342 bytes, ret 0x1483213e6) and
  `StartFromBeatmapWithMediaSync` (0x1483213f0): both store the
  double at spawner+0x1c8 (`CurrentBeatTravelTime`, reflection offset
  456), zero `TimelineOffset` (+0x138), anchor +0x130 from QPC
  cycles×scale + const (0x14bf2ec28), clear the queue at +0x148
  (stride 0x48), zero +0x180/+0x190/+0x174, set +0x170/+0x178=1,
  store mgr at +0x168. WithMediaSync additionally stores the media
  controller at +0x80, calls `SetBeatInterval(float)`
  (0x1482aa250) with travel time as float,
  `SetSyncStartTime(anchor, 0.0)` (0x1482af730), `SyncToBeat`
  (0x1482ba220). **Neither reads manager `LoadedBeatmap` (+0x238)
  or `Meta.Offset` (+0x298)**; the manager pointer is never
  dereferenced after the null check/store.
- **New finding beyond the 2026-11-11 note: the double is
  StartPlayback's `InBeatTravelTime` parameter.** StartPlayback PDB
  signature:
  `?StartPlayback@UMusicModeManager@@QEAAXPEAVUBeatSpawnerManager@@PEAVALatencyCompensationManager@@PEAVUMediaPlaybackController@@N_N@Z`
  (spawner, latency mgr, media controller, double, bool); UFunction
  reflection has `NewProp_InBeatTravelTime`. StartPlayback.c
  (`0x148314390.c` line 90) assigns param_5 → `param_1[0xd8]`
  (+0x6c0). Call sites at 0x148314a30 (WithMediaSync, when
  manager+0x4c0 media controller non-null) / 0x148314a37
  (StartFromBeatmap); the two direct call sites of StartFromBeatmap
  in .text are 0x14823c759 (exec wrapper) and 0x148314a37 (verified
  by byte scan for E8 rel32). Constructor (`UMusicModeManager`
  0x1482ce640, verified in exe) sets +0x6c0 = 2.0, +0x6b8
  LookaheadWindow = 4.0, +0x6c8 = 0, +0x6d0 = 0.05. StartPlayback
  never reads +0x298.
- **Conclusion: `FBeatmapMeta.Offset` is inert at runtime** — parsed
  once by `ParseBeatmapJson` (0x148302440) into +0x298, never read by
  any routine including both spawner inits. The player's `store.js`
  already accepts finite nonzero `meta.offset` and ignores it
  (commit `aad41fa`, 2026-11-11; three shipped maps: Instructions
  Unclear +0.004, Lil Brat −0.013, Pleasure Place +0.016 play at
  authored times), pinned by
  `tests/fanservice_soundtrack.test.js` ('nonzero beatmap offsets
  from the official maps are accepted and ignored, never applied').
  The Rust confirm-time editable offset is a user-correction
  feature, not an original-behavior claim.

## Acceptance verdicts (updated)

| Criterion | Verdict | Evidence / exact missing piece |
|---|---|---|
| Recover the newest game's music clock, beat completion, breaks and supported event semantics through REA | **Partially met** | Music clock, beat completion, breaks, and the timeline event semantics in the shipped maps were already decoded. The dispatcher core is now recovered too: `CheckEventConditions&ReturnArray` eligible set, Temptation/Mercy/Store gates, `AdjustStoreWeight`, the heat/combo weight pipeline (`clamp(clamp(base+heat)+combo)` — exactly the player's `weightedEvents`), `ChooseWeightedEventFromArray`, `TriggerSelectedEvent` routing, and the Temptation/Store/Mercy handler skeletons (widget classes, store 180 s cooldown, Mercy-never-drawn quirk) — full decode in `docs/parity/evidence/ticket51-event-dispatcher-20261112.md`, implemented as `media_selection.eligibleSpecialEvents` + wired into `play.js automaticMediaPool()` with 6 new tests. **Missing:** the widget trigger paths — `TemptationEventWidget` accept/decline effects and its cooldown duration, and the `StoreWidget` open/close flow. Both widget packages are absent from the legacy cooked tree and from reJOIce (see the dispatcher note §6); the temptation/store cooldown and shop counters are also not modeled in the player yet. |
| Drive a complete playable song from actual recording position with correct offset and lead-in behavior | **Met** | Lead-in met (2.0 s `IntroLeadInSeconds`, constructor default + native runtime log); the player drives a song from `audio.currentTime` with the confirmed-manifest contract; **the offset blocker is closed** (see above — `Meta.Offset` is inert at runtime; nonzero offsets accepted-and-ignored, test-pinned). |
| Pause and buffering cannot advance the recording-bound timeline or duplicate beat rewards | **Met** | Unchanged from the 2026-11-12 re-check (`tests/fanservice_music_timeline.test.js`; `play.js` gates the recording sample on `!paused && !musicBuffering && !audio.paused && !audio.seeking && readyState >= 3`). |
| Verify event effects, natural completion and progression through the player with exact original-build provenance | **Partially met** | Event effects verified through the player (music-timeline unit tests; cum-override browser evidence; new dispatcher tests); natural completion modeled; progression settled (#45 XP/UP, 4200-row fixture). Provenance is the v0.05.1 build (SHA-256 `a8f46896…`) throughout. The offset sub-gap is gone. **Missing:** verification of the non-media dispatcher widget events (same piece as criterion 1). |

**Overall: #51 stays OPEN.** Criterion 2 now meets; criteria 1 and 4
remain partial on the same single piece: the Temptation/Store
widget trigger paths (widget packages absent from all available
evidence) plus modeling the temptation/store cooldown and shop
counters in the player. That piece needs original-side evidence (the
missing widget packages or a native runtime run), not more player
code against the current evidence.

## Test runs

- `node --test tests/*.test.js` (with the `python`→`python3` shim):
  **424 pass / 0 fail** (baseline 418 at HEAD `85a486c`; +6 new
  dispatcher tests).
- `python3 tests/recover_game_instance_schema_test.py`: **12 pass**.
