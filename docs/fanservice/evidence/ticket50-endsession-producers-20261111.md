# Ticket 50 EndSession producer trace

Date: 2026-11-11. Branch: `spec/avtohmver-open-tickets`.
Slice: trace the native EndSession metric producers for the two derived
session metrics. Docs-only: no player predicate was changed, because no
contradiction is established by the retained evidence (see verdicts).

## Pinned sources

All newer-build sources are from `xxjuggernaut9113xx-design/reJOIce`
commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff` (`newer-20261017`),
under `~/workspace/reJOIce/Analysis/ReferenceBuilds/newer-20261017/`.

| Source | Path |
| --- | --- |
| Challenge rows | `DT_Challenges.json` (retained as `static/fanservice/data/native-contract.json`) |
| Metric enum | `native-reflection-enums.json` |
| Session-stats schema | `native-reflection-schemas.json` (`FSessionStats`) |
| Metric ID audit | `PROGRESSION_RUNTIME_COMPATIBILITY.md`, `progression-runtime-compatibility.json` |
| Record metric routine | `native-progression-runtime/0x1483070c0.c` (`RecordSessionMetric`, 0x1483070c0) |
| Set metric routine | `native-progression-runtime/0x148312540.c` (`SetSessionMetric`, 0x148312540) |
| Update challenge progress routine | `native-progression-runtime/0x148318270.c` (`UpdateChallengeProgress`, 0x148318270) |
| EndSession routine | `native-round-runtime/0x1482ddd60.c` (`EndSession_UProgressionManager`, 0x1482ddd60) |
| Blueprint EndSession | `functions/BP_GlobalManager/EndSession.json` |
| Difficulty remapping note | `modes-runtime-contract.md` |
| Player predicate | `static/fanservice/progression.js:15` (`sessionMetrics`) |

## What the retained routines establish

### Metric IDs and session-stats fields (both metrics)

- `native-reflection-enums.json`, `EMetricType`:
  `SuccuSlayerSessionsWon` = 37 (0x25), `SessionsWonAtMaxDifficulty` = 41 (0x29).
  The audit assigns the same IDs (`PROGRESSION_RUNTIME_COMPATIBILITY.md:13,17`;
  `progression-runtime-compatibility.json`, `native_metric_additions`).
- `native-reflection-schemas.json`, `FSessionStats` property params:
  `SuccuSlayerSessionsWon` offset 156 (0x9c), `SessionsWonAtMaxDifficulty`
  offset 168 (0xa8). The manager embeds the session stats at base 0x230, so
  the manager fields are 0x230 + 0x9c = **0x2cc** and 0x230 + 0xa8 = **0x2d8**.
  Cross-check: `SessionsWon` offset 48 (0x30) gives manager field 0x260, which
  is exactly the field the record routine's case 0xe writes.
- Record routine `0x1483070c0.c`: case `0x25` does
  `*(int *)(param_1 + 0x2cc) = *(int *)(param_1 + 0x2cc) + param_3` (additive);
  case `0x29` does the same at `0x2d8`. Both are plain accumulations, no
  condition inside the routine.
- Set routine `0x148312540.c`: case `0x25` assigns `0x2cc = param_3`;
  case `0x29` assigns `0x2d8 = param_3`.
- `0x148318270.c` (`UpdateChallengeProgress`): case `'%'` (0x25) reads the
  current value from `*(int *)(param_1 + 0x2cc)`; case `')'` (0x29) reads it
  from `*(int *)(param_1 + 0x2d8)`. This is a second, independent confirmation
  of the metric-to-field mapping.

### EndSession flush (0x1482ddd60.c)

`EndSession_UProgressionManager` does **not** increment either field. It
flushes the already-populated session fields into challenge progress and into
lifetime totals, unconditionally (no won / difficulty / mode / objective test
at the flush site):

- Line 204: `FUN_148318970(param_1,0x29,(int)param_1[0x5b])` — metric 41 from
  field 0x2d8 (`param_1[0x5b]` is byte offset 0x5b * 8 = 0x2d8).
- Line 208: `FUN_148318970(param_1,0x25,*(undefined4 *)((longlong)param_1 + 0x2cc))`
  — metric 37 from field 0x2cc.
- Lifetime accumulation: `*(int *)(param_1 + 0x73) += (int)param_1[0x5b]`
  (metric 41 into manager+0x398) and
  `*(int *)((longlong)param_1 + 0x38c) += *(int *)((longlong)param_1 + 0x2cc)`
  (metric 37 into manager+0x38c).

The same flush block (lines 180-215) forwards every metric 0..46 the same
way, so the flush establishes nothing specific to 41/37 beyond the mapping.

Other EndSession metric writes, for completeness:

- Lines 174 / 309-315: when the session XP computed by `FUN_1482d90e0` is
  positive, `FUN_148318be0(param_1,0xf,iVar4,…)` records metric 15
  (`TotalXPEarned`).
- Lines ~300-317: the win/loss branch reads the session `bWon` flag
  (`*(char *)((longlong)param_1 + 0x25c)` — `FSessionStats` offset 44, between
  `SessionDuration` at 40 and `SessionsWon` at 48) together with the session
  `SessionsWon` field (`(int)param_1[0x4c]`, byte 0x260). If not won and
  `SessionsWon < 1` it records metric 0x15 (21, `TimesLost`); otherwise it
  increments the lifetime win counter (`param_1[100]`) and records metric 0xe
  (14, `SessionsWon`). This is the only won-gating visible in EndSession, and
  it applies to metrics 14/21, not to 41/37.
- Lines 321-329: `FUN_148318be0(param_1,0x2a,…)` / `(…,0x2b,…)` record metrics
  42/43 (`BestMusicModeWinRounds` / `BestTowerWinRounds`) only when the
  session value is positive.
- Near the end: `FUN_148318be0(param_1,0xd,1,…)` records metric 13
  (`SessionsCompleted`) unconditionally.

### Blueprint EndSession

`functions/BP_GlobalManager/EndSession.json` records no metric at all. Its
statements only pause the beat sequence, create/add a widget, append the
current combo to `LegacyStats.BrokenComboArray`, and reset `EdgeStreak` and
`CurrentComboCount`. The UI-side caller is
`functions/UI_Manager/ExecuteUbergraph_UI_Manager.json` line 15869
(`StackNode: EndSession` on `ProgressionManager`), which invokes the native
routine above and records nothing itself.

### Challenge text (descriptions, not producers)

From `native-contract.json` (`DT_Challenges.json`):

- `built_different` — "Win a session on insane difficulty.",
  `EMetricType::SessionsWonAtMaxDifficulty`, target 1, scope Lifetime.
- `speed_freak` — "Win 5x Sessions on Insane Difficulty.",
  `EMetricType::SessionsWonAtMaxDifficulty`, target 5, scope Lifetime.
- `public_safety` — "Win 10 SuccuSlayer sessions in classic mode.",
  `EMetricType::SuccuSlayerSessionsWon`, target 10, scope Lifetime.

## Per-metric verdict

### SessionsWonAtMaxDifficulty (41) — PRODUCER FOUND 2026-11-12

- Confirmed: metric ID 41, session field 0x2d8, additive record semantics,
  EndSession flush + lifetime accumulation, Lifetime scope, "win on Insane"
  description.
- **Producer found:** `BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json`
  stmts 2475–2479 — gated ONLY on `CurrentDifficulty == 2`
  (`EqualEqual_ByteByte`, `CurrentDifficulty` vs byte 2), then
  `UpdateMetric(41, 1)`, then `UpdateObjectiveTitleVictoryStart`, then
  `UpdateMetric(14, 1)` (SessionsWon). It sits in a victory path, and the
  `GameModeSelection == 1` check (stmt 2480) comes AFTER the 41 call, so
  the call is NOT mode-gated: a win at Insane counts in any mode. A
  whole-`.text` call scan of the v0.05.1 exe confirms no native code path
  records 41 (the 17 `UpdateMetricWithConditions` call sites are the six
  producers, `UpdateMetric`, the `exec` wrapper, `SetStrokeCombo` (4, 5),
  `AddXP` (15), and `EndSession` (15, 21, 14, 42, 43, 13)) — the producer
  is Blueprint-only, and this is it.
- Difficulty value settled: the compared value is 2, the Blueprint
  `DifficultySelections_ENUM` InsaneMode — NOT native `EDifficultyTier` 3.
  The player's `difficulty===2` (three-tier selector, `play.html:6`,
  validated `[0,1,2]` in `run.js:10`) is exactly the native comparison,
  and the player's predicate puts no mode condition on metric 41, matching
  the ubergraph order. The earlier "authored-description interpretation"
  label in `ticket50-session-metrics-20261108.md` is superseded for this
  metric. Pinned by a regression test (`tests/fanservice_progression.test.js`:
  Insane wins in modes 1 and 2 also record metric 41).
- Won-only gating is established by the call site: the 41 call sits in the
  victory path next to the SessionsWon (14) record and the victory-title
  update.

### SuccuSlayerSessionsWon (37) — PRODUCER FOUND 2026-11-12 (one residual)

- Confirmed: metric ID 37, session field 0x2cc, additive record semantics,
  EndSession flush + lifetime accumulation, Lifetime scope, "Win 10
  SuccuSlayer sessions in classic mode" description.
- Confirmed: objective value 8. Native `ESessionObjective::SuccuSlayer` = 8
  (`native-reflection-enums.json`), and the player uses objective 8 for
  "Succu Slayer" (`static/fanservice/objectives.js:10`). This part of the
  player predicate (`objective===8`) matches the retained native enum.
- **Producer found:** `BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json`
  stmts 777–779 — gated ONLY on
  `GameInstance.CurrentSessionObjective == 8` (`EqualEqual_ByteByte` vs
  byte 8), inside the successful-cum chain (stmt 770 `Change Beat
  Background` 5, stmt 771 `SuccessfulCumBackgroundOverride = true`,
  stmt 772 `PrintString "Cumming on Time!! Good job!!!!!"`, stmt 780
  `Delay` 10.0 s), then `UpdateMetric(37, 1)`. No native call site
  records 37 (same whole-`.text` census as metric 41), and no other
  `UpdateMetric(37, …)` call exists anywhere in the retained Blueprint
  set — this is the only producer.
- Mode value, residual: the call site itself checks no mode — the only
  gate at the site is the objective. The retained ubergraph JSON carries
  no per-statement bytecode offsets, so the chain's entry point (and
  with it a direct mode gate at entry) was not resolved from this file.
  The player's `mode===0` (Classic) gate rests on the challenge text
  ("Win 10 SuccuSlayer sessions in classic mode"), on the chain being
  the session-level successful-cum celebration rather than a Tower round
  flow (Tower round wins are recorded separately as metric 43, rounds —
  not sessions), and on the native `GameModeSelection` values (0 Classic,
  1 Tower, 2 Playlist) established by the `SetCumMeterDifficultyModifier`
  decode. `mode===0` for Classic is the player's own scale
  (`play.js:21`: 0 Classic, 1 Tower, 2 Soundtrack); no native game-mode
  enum is retained (`native-reflection-enums.json` has no `EGameMode`).
- Won-only gating is established by the call site: the 37 call sits in
  the successful-cum (win) chain.
- Player predicate (`won && mode===0 && objective===8`) is the
  best-supported reading of the retained evidence; the chain-entry mode
  gating is the one explicitly recorded residual for this metric. It does
  not change the player's behavior: in the player a Tower SuccuSlayer
  round win never sets a session `won` (Tower rounds complete via
  `completeRound`; only a full Tower victory sets `won`, and it carries
  no single session objective), so the `mode===0` gate is unreachable
  either way in the current player flow.

## What would unblock it

Resolved 2026-11-12 (see the per-metric verdicts above):

1. The routine that writes manager+0x2d8 / +0x2cc — FOUND, in Blueprint,
   not native code: the GM ubergraph calls `UpdateMetric(41, 1)` gated
   on `CurrentDifficulty == 2` (stmts 2475–2479, victory path, no mode
   gate) and `UpdateMetric(37, 1)` gated on
   `CurrentSessionObjective == 8` (stmts 777–779, successful-cum
   chain). A whole-`.text` call scan proves no native code records
   either metric.
2. The difficulty mapping — SETTLED: the native comparison is the
   Blueprint enum value 2 (InsaneMode), matching the player's
   three-tier selector 1:1; no remapping to native `EDifficultyTier` 3.
3. The Classic mode value — PARTIALLY SETTLED: native
   `GameModeSelection` 0 = Classic is established by the
   `SetCumMeterDifficultyModifier` decode (outer switch on
   `GameModeSelection`, 0 = Classic); the 37 chain's entry-point mode
   gating was not resolved from the retained ubergraph JSON (no
   per-statement bytecode offsets), so the player's `mode===0` gate
   rests on the challenge text and the session-level chain, as recorded
   in the 37 verdict above.

## Regression / test status

No player code was changed, so no new regression case was added. Existing
coverage in `tests/fanservice_progression.test.js` lines 19-26 encodes the
current predicates (win/loss, difficulty 1 vs 2, modes 0/1/2, objectives 8
vs 2); those tests still pass and still encode the authored-description
interpretation, not a native-producer observation. Do not cite them as native
confirmation.
