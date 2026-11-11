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

### SessionsWonAtMaxDifficulty (41) — STILL BLOCKED

- Confirmed: metric ID 41, session field 0x2d8, additive record semantics,
  EndSession flush + lifetime accumulation, Lifetime scope, "win on Insane"
  description.
- Not established: the producer. No retained `.c` file anywhere under
  `newer-20261017` calls `RecordSessionMetric` (`FUN_1483070c0`), and no
  retained Blueprint function calls `RecordSessionMetric` either (the only
  retained `SetSessionMetric` call is
  `functions/BP_GlobalManager/SetSessionDuration.json` line 431, metric 24,
  `SessionDuration`). The routine that increments 0x2d8 — and the difficulty
  value it compares — is not in the retained evidence.
- Difficulty value gap, not a contradiction: the native enum
  `EDifficultyTier` is four-tier — Easy 0, Medium 1, Hard 2, Insane 3
  (`native-reflection-enums.json`). The player uses a three-tier selector —
  Easy 0, Normal 1, Insane 2 (`static/fanservice/play.html:6`, validated to
  `[0,1,2]` in `static/fanservice/run.js:10`). On the native scale, value 2 is
  Hard; on the player scale, value 2 is Insane. The retained evidence contains
  no mapping between the player's three-tier difficulty and the native
  four-tier `EDifficultyTier`, and `modes-runtime-contract.md` states
  explicitly that "unsupported numeric difficulty remapping into the older
  three-difficulty gameplay configuration is not silently asserted." Changing
  the player predicate to `difficulty===3` would invent that mapping and
  would be unreachable (the player rejects difficulty outside `[0,1,2]`), so
  no fix was made. The player's `difficulty===2` remains an
  authored-description interpretation, exactly as recorded in
  `ticket50-session-metrics-20261108.md`.
- Won-only gating is consistent with the challenge text and with EndSession's
  `bWon`-gated metrics 14/21 branch, but the 41 field itself is flushed
  unconditionally, so won-gating for this field must live in the missing
  producer and is not directly established.

### SuccuSlayerSessionsWon (37) — STILL BLOCKED

- Confirmed: metric ID 37, session field 0x2cc, additive record semantics,
  EndSession flush + lifetime accumulation, Lifetime scope, "Win 10
  SuccuSlayer sessions in classic mode" description.
- Confirmed: objective value 8. Native `ESessionObjective::SuccuSlayer` = 8
  (`native-reflection-enums.json`), and the player uses objective 8 for
  "Succu Slayer" (`static/fanservice/objectives.js:10`). This part of the
  player predicate (`objective===8`) matches the retained native enum.
- Not established: the producer. Same missing call site as metric 41 — no
  retained `RecordSessionMetric(0x25, …)` call, so the exact conditions (won
  only? which mode value means Classic?) are not in the retained evidence.
- Mode value gap: no game-mode enum is retained at all
  (`native-reflection-enums.json` has no `EGameMode` / session-mode enum, and
  no enumerator named Classic). The player's `mode===0` for Classic is the
  player's own scale (`static/fanservice/play.js:21`: 0 Classic, 1 Tower,
  2 Soundtrack) with no native-enum support in the retained evidence.
- Won-only gating: same position as metric 41 — consistent with the text, not
  directly established for this field.

## What would unblock it

1. The retained body of the routine that writes manager+0x2d8 / +0x2cc — i.e.
   a `RecordSessionMetric(0x29 / 0x25, …)` call site or a direct field write —
   most plausibly in the round/session-completion path that feeds
   `EndSession_UProgressionManager` (0x1482ddd60), showing the exact
   comparison for each field: the difficulty value or enum compared, the mode
   value compared, the objective value compared, and whether the write is
   gated on the session `bWon` flag.
2. A retained mapping between the player's three-tier difficulty selector
   (Easy 0 / Normal 1 / Insane 2) and the native four-tier `EDifficultyTier`
   (Easy 0 / Medium 1 / Hard 2 / Insane 3), to settle whether the native
   producer's "max difficulty" comparison corresponds to the player's value 2.
3. A retained native game-mode enum (or the session's stored mode field)
   establishing which value means Classic, to settle `mode===0`.

## Regression / test status

No player code was changed, so no new regression case was added. Existing
coverage in `tests/fanservice_progression.test.js` lines 19-26 encodes the
current predicates (win/loss, difficulty 1 vs 2, modes 0/1/2, objectives 8
vs 2); those tests still pass and still encode the authored-description
interpretation, not a native-producer observation. Do not cite them as native
confirmation.
