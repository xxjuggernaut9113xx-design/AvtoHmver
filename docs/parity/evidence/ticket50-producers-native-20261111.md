# #50 — Producers: native UProgressionManager disassembly (v0.05.1)

Date: 2026-11-11. Source build: Cock Hero v0.05.1 Hotfix Public,
`CockHero.exe` SHA-256 `a8f46896…040c10` (verified), PDB with 630,923 public
symbols. All addresses are RVAs in that exe (image base `0x140000000`).
Disassembly via `objdump` from the build's own PDB. Nothing here is
guessed: every claim cites an address, a PDB symbol, or a decoded jump
table.

## Verdict up front

**What each producer records is SETTLED.** All six `Record*` producers
are 48-byte wrappers around `UpdateMetricWithConditions` with a constant
metric id, a value of 1 (or the rounds won), and a **zeroed conditions
struct** (no conditions). The metric ids and application semantics
(add vs max vs set vs no-op) are read off the `RecordSessionMetric`
jump table, decoded entry by entry (see §3). The two "Best*" metrics
(42, 43) are **max** metrics — the producer only fires when rounds > 0,
and the stored value is the maximum rounds won.

**The difficulty-tier mapping is NOT settled by the natives.** The
native side has `GetLevelDataForLevel` (reads the Level Data Table by
level number) and the container holds `DifficultyTiers_DT`,
`ObjectiveParamTable_DT`, and `ProgressionUpgradeDataTable`, but the
tier rows' contents decide the 4-tier → 3-tier mapping, and those contents
were not read here. The tables are present in the container (paths in
§6) and now unpackable (Oodle resolved 2026-11-11; `retoc manifest`
works, 16,302 entries); their contents are being mined separately.

## 1. The producers — metric, value, conditions

All six call `UpdateMetricWithConditions` (`0x148318be0`) as
`(this, MetricType=dl, Value=r8d, Conditions=r9=&zeroed-16-bytes)`.
`UpdateMetric` (`0x148318bb0`, 48 bytes) is the same call with a
zeroed conditions struct — i.e. `UpdateMetric(metric, value)` is
`UpdateMetricWithConditions(metric, value, no conditions)`.

| producer | address | metric id | metric name | value | guard |
|---|---|---|---|---|---|
| `RecordComboCruncherUsed` | `0x148307000` | 39 (`0x27`) | ComboCrunchersUsed | 1 | none |
| `RecordMusicBreakUsed` | `0x148307060` | 44 (`0x2c`) | MusicBreaksUsed | 1 | none |
| `RecordBountyCollectionFailure` | `0x148306fd0` | 46 (`0x2e`) | BountyCollectionFailures | 1 | none |
| `RecordDisabledBreakSectionFailure` | `0x148307030` | 45 (`0x2d`) | DisabledBreakSectionFailures | 1 | none |
| `RecordTowerWinRounds` | `0x148307370` | 43 (`0x2b`) | BestTowerWinRounds | `edx` (rounds won) | only if `edx > 0` |
| `RecordMusicModeWinRounds` | `0x148307090` | 42 (`0x2a`) | BestMusicModeWinRounds | `edx` (rounds won) | only if `edx > 0` |

Metric names from `Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json`
(47-value `EMetricType`, 0–46). The conditions struct is 16 bytes of
zeros in every producer — there are no per-producer conditions; the
"conditions" in `UpdateMetricWithConditions` are the challenge
conditions evaluated in its second half (§4), not producer arguments.

Note the names: 42 and 43 are `Best*` — they are best (max) values, not
cumulative counts. A 0-round win records nothing (the `edx > 0` guard),
and a smaller rounds value than the stored best leaves the best
unchanged (§3).

## 2. `UpdateMetricWithConditions` — what happens per record

`0x148318be0` (688 bytes), read in full. Three phases:

1. **Session record.** Calls `RecordSessionMetric(this, metric, value)`
   (`0x1483070c0`) — the raw session value (§3).
2. **Per-metric switch (metrics 39–46 only).** A jump table on
   `(metric - 39)`, 8 entries, decoded from the exe:
   metrics 39, 42, 43, 44, 45, 46 share case `0x148318c43`;
   metrics 40 (SuccuCoinsSpent) and 41 (SessionsWonAtMaxDifficulty)
   jump straight to the post-switch code (no special handling). The
   shared case calls the `0x1482f4540` getter — `GetSessionMetricValue`
   (decoded 2026-11-12, see §7 item 2) — with
   `(sessionStats=this+0x230, strokeComboLive=this+0x98, metric, &bool)`
   — no public symbol exists at that address (nearest public symbol is
   `URoundManager::GetPurchaseCostForLevel` at `0x1482f4420`; the
   helper is a static/local function). Its bool result feeds a log
   line (metric name via `StaticEnum<EMetricType>() 0x1481e2a90` +
   value, `BasicLog 0x140f252a0`). The bool is the getter's success:
   false for 9/15/20/21 and out-of-range metrics (none of which occur
   for 39/42–46, so the log line always fires for these producers). It
   is called only for metrics 39/42–46.
3. **Challenge progress.** `TMultiMap<EMetricType, FName>::MultiFind`
   (`0x1482cce40`) on the multimap at `this+0x1e0` gives every challenge
   `FName` keyed by this metric. For each: `UDataTable::FindRow<FChallengeData>`
   (`0x1482c8730`) on the Challenge Data Table at `this+0x60`;
   `CheckChallengeConditions` (`0x1482d96a0`) on the row; if it passes,
   `UpdateChallengeProgress` (`0x148318270`) with the challenge name,
   metric, and value. Epilogue broadcasts
   `FOnChallengeProgressUpdate_DelegateWrapper` (`0x1481e86d0`) on the
   delegate at `this+0x28`.

So a producer record fans out to (a) the session stat, (b) the
39/42–46 special case (log + the `0x1482f4540` getter, §7 item 2), and
(c) every challenge tracking that metric.

## 3. `RecordSessionMetric` — how each value is applied

`0x1483070c0` (688 bytes), read in full. A jump table over the metric
id (0–46; out-of-range returns), decoded entry by entry from the exe.
Each metric maps to one `int32` field in the `FSessionStats` struct
starting at `this+0x230`. Application modes:

- **Add** (accumulate): most metrics — `field += value`.
- **Max**: 4 (MaxCombo, `+0x240`), 17 (EdgeStreak, `+0x280`),
  18 (ConsecutiveSuccubiSurvived, `+0x284`), **42
  (BestMusicModeWinRounds, `+0x2dc`)**, **43 (BestTowerWinRounds,
  `+0x2e0`)** — `field = max(field, value)`, then tail-call
  `UpdateLifetimeBest` (`0x148318970`, `UpdateLifetimeBest(EMetricType, int)`).
- **Set** (assign): 24 (PercentAtHighHeat, `+0x28c`) — `field = value`
  (a percentage snapshot, not a count).
- **No-op**: 5 (StrokeCombo), 9 (AvgStrokesPerEdge), 15 (TotalXPEarned),
  20 (PerfectRounds), 21 (TimesLost) — `RecordSessionMetric` does
  nothing for these; they are live counters, derived values, or handled
  by another system. Do not wire producers to them expecting a session
  increment.

Full table (metric → field offset from `this`, mode):

| metric | field | mode | metric | field | mode |
|---|---|---|---|---|---|
| 0 Strokes | +0x230 | add | 24 PercentAtHighHeat | +0x28c | **set** |
| 1 Edges | +0x234 | add | 25 GamesWithSexToy | +0x29c | add |
| 2 SuccubiDefeated | +0x238 | add | 26 PerfectEdges | +0x2a0 | add |
| 3 EnemiesDefeated | +0x23c | add | 27 BonerPillsUsed | +0x2a4 | add |
| 4 MaxCombo | +0x240 | **max** | 28 AcceptedTemptation | +0x2a8 | add |
| 5 StrokeCombo | — | **no-op** | 29 CameDuringTaunt | +0x2ac | add |
| 6 MissedCumWindows | +0x244 | add | 30 DefensiveItemsUsed | +0x2b0 | add |
| 7 TimesTaunted | +0x248 | add | 31 OffensiveItemsUsed | +0x2b4 | add |
| 8 ItemsUsed | +0x24c | add | 32 DeclinedTemptation | +0x2b8 | add |
| 9 AvgStrokesPerEdge | — | **no-op** | 33 BountiesCollected | +0x2bc | add |
| 10 DrawsAtMaxHeat | +0x250 | add | 34 LootRushesUsed | +0x2c0 | add |
| 11 EarlyClimax | +0x254 | add | 35 EscapeRopesUsed | +0x2c4 | add |
| 12 SessionDuration | +0x258 | add | 36 MilkingCount | +0x2c8 | add |
| 13 SessionsCompleted | +0x264 | add | 37 SuccuSlayerSessionsWon | +0x2cc | add |
| 14 SessionsWon | +0x260 | add | 38 EdgeSessionsWon | +0x2d0 | add |
| 15 TotalXPEarned | — | **no-op** | 39 ComboCrunchersUsed | +0x2d4 | add |
| 16 MoneySpent | +0x294 | add | 40 SuccuCoinsSpent | +0x298 | add |
| 17 EdgeStreak | +0x280 | **max** | 41 SessionsWonAtMaxDifficulty | +0x2d8 | add |
| 18 ConsecutiveSuccubiSurvived | +0x284 | **max** | 42 BestMusicModeWinRounds | +0x2dc | **max** |
| 19 CumWindowsHit | +0x290 | add | 43 BestTowerWinRounds | +0x2e0 | **max** |
| 20 PerfectRounds | — | **no-op** | 44 MusicBreaksUsed | +0x2e4 | add |
| 21 TimesLost | — | **no-op** | 45 DisabledBreakSectionFailures | +0x2e8 | add |
| 22 LostToSuccubus | +0x268 | add | 46 BountyCollectionFailures | +0x2ec | add |
| 23 TimeAtHighHeat | +0x288 | add | | | |

(Fields are not in metric order — e.g. 13/14 are at +0x264/+0x260,
40 at +0x298 — the layout is the `FSessionStats` struct's own order,
not the enum's. The struct is 0xc0 / 192 bytes per
`CombineSessionStatsArray`.)

## 4. The rest of the `UProgressionManager` API

| function | address | semantics established |
|---|---|---|
| `ResetSessionMetric` | `0x14830a2a0` (496 bytes) | **SETTLED 2026-11-12 (decoded, see §7 item 3).** Calls the `0x148311f70` setter with `(&liveCombo, &liveEdgeStreak, &liveConsec, metric, value=0, &out)`; if the setter returns false, logs a warning (metric name via `StaticEnum<EMetricType>` + `BasicLog` `0x140f252a0`) and returns. Otherwise calls `RefreshIncompleteSessionChallengeMetric` with the **NEW zeroed value** (`*out` = 0 — this corrects the earlier "with the current value" reading), logs (verbosity >= 6), and broadcasts the challenge-progress-update delegate (`this+0x28`). The zeroing IS done by the setter (explicit store of the clamped value into the stats field and `*out`). |
| `SubtractSessionMetric` | `0x148315720` (864 bytes) | **SETTLED 2026-11-12 (decoded, see §7 items 2–3).** Clamps the amount to >= 0 (`cmovs`); amount <= 0 logs a warning and returns. Calls the `0x1482f4540` getter with the session stats, `this+0x98`, and the metric; if it returns false, logs a warning and returns. Otherwise computes `newValue = current - amount` and calls the `0x148311f70` setter with that **absolute new value** (the setter clamps it at >= 0 — this corrects the earlier "applies the delta `-amount`" reading); if the setter returns false, logs a warning and returns. Then calls `RefreshIncompleteSessionChallengeMetric` with `*out` (the new value), logs (metric name + old + amount + new), and broadcasts the delegate (`this+0x28`). |
| `RefreshIncompleteSessionChallengeMetric` | `0x148307760` (720 bytes) | **SETTLED 2026-11-12 (decoded line by line from the v0.05.1 exe; see §7 item 4).** Signature `(this, EMetricType metric /*dl*/, int32 value /*r8d*/)`. `MultiFind` on the `this+0x1e0` multimap for the metric's challenge names, deduped within the call by a stack-local set (a name already refreshed this call is skipped); for each, `GetChallengeDataPtr` (`0x1482e71e0`); skips challenges whose `+0x68` byte is set (complete). Then looks the name up in the in-progress map at `this+0xf0` (TMap, 64-byte elements: FName key + value struct); skips if absent, and skips if the value's byte at `+0x18` is nonzero. In the value's metric-progress array (16-byte entries: byte metric at `+0`, int32 value at `+0xc`), finds the entry whose byte equals the metric arg and **assigns** `entry+0xc = value` — an absolute set of the new value, not an add. If any entry was updated, the name joins the dedup set and the `FOnChallengeProgressUpdate` delegate (`this+0x28`) is broadcast with the challenge name. Only callers in the exe: `ResetSessionMetric` and `SubtractSessionMetric` (verified by a whole-`.text` call scan: 2 call sites, `0x14830a3b4` / `0x148315997`), which both pass `*out` — the NEW absolute metric value. In the player the Refresh + broadcast steps ride the settlement path (`settleSession` → `updateChallenges`), which assigns Session-scope requirements to the metric value — the same absolute-set semantics — and reset/subtract have no other callers in the player, so no live in-progress display needs an immediate refresh. |
| `CombineSessionStatsArray` | `0x1482da9c0` (472 lines) | **SETTLED 2026-11-12 (decoded in full from the v0.05.1 exe; see §7 item 5).** `FSessionStats CombineSessionStatsArray(const TArray<FSessionStats>&, int)`. The int parameter is the **Required won Tower rounds** — proven by the native log line at the end of the function: `"[Progression] Combined %d Tower rounds stats: WonRounds=%d Required=%d TowerWon=%s Strokes=%d Edges=%d Duration=%d"` (format at `0x14d212358`, "Yes"/"No" at `0x14bf4e298`/`0x14bf4e28c`), with args (array count, wins, Required, TowerWon, Strokes, Edges, SessionDuration). Zeroes a 192-byte output struct, then per input: additive sums for most int fields; max-merge for MaxCombo (`+0x10`), EdgeStreak (`+0x50`), ConsecutiveSuccubiSurvived (`+0x54`), BestMusicModeWinRounds (`+0xac`), BestTowerWinRounds (`+0xb0`) — **and GamesWithSexToy (`+0x6c`, max despite the RecordSessionMetric add mode)**; OR-merge for the bLostToSuccubus bool (`+0x2d`); concatenate the ActiveModifiers TArray (`+0x40`, 16-byte elements) without dedup. Not summed: SessionsWon (`+0x30`), SessionsCompleted (`+0x34`), PercentAtHighHeat (`+0x5c`), bWon (`+0x2c`); metrics 5/9/15/20/21 have no session field and are never touched. A round counts as won when its bWon bool (`+0x2c`) is set OR its SessionsWon > 0. PercentAtHighHeat is DERIVED: if summed SessionDuration <= 0 it is 0, else `clamp(((int)(TimeAtHighHeat / SessionDuration * 200.0f - 0.5f)) >> 1, 0, 100)` in float32 (constants `K1 = 100.0f` at `0x14bf56a6c`, `K2 = 0.5f` at `0x14bf3cd28`) — i.e. `floor(percent - 0.25)` clamped, so a full high-heat session reads 99, not 100. SessionsCompleted is always 1; bWon / SessionsWon are 1/true iff WonRounds >= Required **and** Required > 0 (an empty array never wins: the count-default path exits early when the count is <= 0); when won, BestTowerWinRounds is max-merged with Required itself, not with WonRounds. The int defaults to the array count when <= 0. The native's only caller is its `exec` wrapper (`UProgressionManager::execCombineSessionStatsArray`, `0x1481ec480` — verified by a whole-`.text` call scan: 1 call site), i.e. it is Blueprint-callable API, not wired into the session flow. Player: `economy.js combineSessionStatsArray` (commit `5be8ebe`, tested) mirrors all of the above; the native struct field at `+0x5c` is named `PercentTimeAtHighHeat` in the reflection schema, the player keeps its `PercentAtHighHeat` field name. |
| `GetLevelDataForLevel` | `0x1482f1610` | `const FLevelData* GetLevelDataForLevel(int Level) const`. Reads the Level Data Table pointer at `this+0x68`; returns null if null; otherwise iterates the table's rows and returns the row matching the level number. The row contents (the tier parameters) live in `DT_LevelData` (§6). |

`UProgressionManager` member offsets used above: `+0x28` challenge-progress
delegate, `+0x60` Challenge Data Table (`UDataTable*`), `+0x68` Level
Data Table (`UDataTable*`), `+0x94` live ConsecutiveSuccubiSurvived,
`+0x98` live StrokeCombo counter (established via `GetStatValueText`
`0x1482f7cb0`, which reads `[rbx+0x98]` for metric 5's session path and
passes it as the live combo — this corrects the earlier "plausibly the
current level" reading), `+0x9c` live EdgeStreak (confirmed by
Reset/Subtract passing `lea this+0x94 → r9`, `lea this+0x98 → rdx`,
`lea this+0x9c → r8`), `+0x1e0`
`TMultiMap<EMetricType, FName>` (metric → challenge names), `+0x230`
`FSessionStats` (session metric fields).

## 5. Difficulty tiers — what the natives do and do not say

- `GetLevelDataForLevel(int)` is the native accessor: level number in,
  `FLevelData` row out, from the Level Data Table (`DT_LevelData`).
  Nothing in the native code maps a 4-tier enum to the player's 3-tier
  scale; the mapping lives in the table rows.
- The player's current 3-tier scale (Insane = 2) vs the native 4-tier
  (Insane = 3, from the survey's `TowerDifficultyStars/*`
  Baseline/Boss/Easy/Hard/Insane/Medium package names and the
  4-value difficulty references) is **not resolved by disassembly**.
  The `DifficultyTiers_DT` rows are the authority.
  — SUPERSEDED 2026-11-11 by the data-tables note §6: the two scales are
  independent axes (session difficulty is the Blueprint
  `DifficultySelections_ENUM` 0/1/2; the 4-tier values belong to the
  Tower/objective axis), so there is no mapping to resolve.
- No native game-mode enum was found by name (survey: 412
  `GameInstance` symbol hits, all engine `UGameInstance` — no
  game-mode enum constructor surfaced). The mode distinction the
  player needs (Classic/Tower/Playlist/Music Mode) is a Blueprint-side
  `GameModeSelection` value (BP_CHGameInstance CDO has
  `GameModeSelection = 1`); do not invent a native enum.

## 6. Data tables — present in the container, contents not yet read

Verified in the v0.05.1 container (`v0051-paths.txt`, mount
`../../../CockHero/Content/`):

- `Data/Rounds/DifficultyTiers_DT.uasset` — the tier rows for §5.
- `Data/Rounds/ObjectiveParamTable_DT.uasset` — objective parameters.
- `Data/MusicMode/ProgressionUpgradeDataTable.uasset` — Music Mode upgrades.
- `Data/Progression/DT_Challenges.uasset` — the Challenge Data Table
  (`this+0x60`, `FChallengeData` rows, keyed by `FName`).
- `Data/Progression/DT_LevelData.uasset` — the Level Data Table
  (`this+0x68`, `FLevelData` rows, keyed by level).

All five are reachable now that Oodle is resolved (`retoc manifest` on
the v0.05.1 utoc: 16,302 entries). Their row contents are being mined
separately; this note records only their paths and which native
accessor reads each.

## 7. Still missing (exact)

1. **Difficulty-tier mapping — SETTLED in the data-tables note §6
   (2026-11-11).** There is no session-difficulty → native-tier mapping:
   session difficulty is the 3-value Blueprint enum
   `DifficultySelections_ENUM` (Easy/Normal/Insane 0/1/2), an independent
   axis from the Tower/objective tiers. The "not resolved by
   disassembly" reading in §5 is superseded — the settlement came from
   the Blueprint side, not from the `DifficultyTiers_DT` rows.
2. **`0x1482f4540` helper — SETTLED 2026-11-12 (decoded from the
   v0.05.1 exe; jump table at `0x1482f4714`, 47 entries, bounds
   `0x1482f4540`–`0x1482f47e0`).**
   `bool GetSessionMetricValue(const FSessionStats* stats /*rcx*/, int32
   strokeComboLive /*edx*/, EMetricType metric /*r8b*/, int32* out
   /*r9*/)`. Returns false for metrics 9 (AvgStrokesPerEdge), 15
   (TotalXPEarned), 20 (PerfectRounds), 21 (TimesLost) and for metric >
   46. Metric 5 (StrokeCombo) → `*out = edx` (the live value), returns
   true. All other metrics → `*out = stats->field`, returns true. All 47
   table entries verified against the §3 field table (e.g. 0→+0x00,
   12→+0x34, 13→+0x30, 16→+0x64, 17→+0x50, 18→+0x54, 40→+0x68,
   41→+0xa8, 42→+0xac, 43→+0xb0, 44→+0xb4, 45→+0xb8, 46→+0xbc).
   Callers: `UpdateMetricWithConditions` (`0x148318be0`, RVA
   `0x8318c5d`), `SubtractSessionMetric` (RVA `0x8315808`), and
   `UProgressionManager::GetStatValueText` (`0x1482f7cb0`, RVAs
   `0x82f7e0a` and `0x82f7f4d` — a NEW caller, not in the earlier survey).
   `GetStatValueText(EMetricType, bool bLifetime)` (944 bytes) reads the
   session stats at `this+0x230` or lifetime stats at `this+0x2f0`
   (`+0xc0`) when `bLifetime`; the session path passes `edx =
   [this+0x98]`, the lifetime path passes `edx = 0` — which is what
   proves `+0x98` is the live StrokeCombo counter. Player:
   `economy.js getSessionMetricValue` (commit `edab506`, tested in
   `tests/fanservice_producers.test.js`).
3. **`0x148311f70` helper — SETTLED 2026-11-12 (decoded from the
   v0.05.1 exe; jump table at `0x14831232c`, 47 entries, bounds
   `0x148311f70`–`0x1483123f0`).**
   `bool SetSessionMetricValue(FSessionStats* stats /*rcx*/, int32*
   strokeComboLive /*rdx*/, int32* edgeStreakLive /*r8*/, int32*
   consecSuccubiLive /*r9*/, EMetricType metric /*stack5*/, int32 value
   /*stack6, clamped to >= 0 via cmovs*/, int32* out /*stack7*/)`.
   Returns false for metrics 9/15/20/21 and metric > 46. Every case
   sets the stats field to the (clamped) value AND `*out = value`,
   returns true. Extra writes: metric 5 → `*rdx = value` (no stats
   field); metric 17 (EdgeStreak, +0x50) → also `*r8 = value`; metric
   18 (ConsecutiveSuccubiSurvived, +0x54) → also `*r9 = value`; metric
   14 (SessionsWon, +0x30) → also bool `stats+0x2c = (value > 0)`;
   metric 22 (LostToSuccubus, +0x38) → also bool `stats+0x2d =
   (value > 0)`. Callers: ONLY `ResetSessionMetric` (RVA `0x830a2ec`)
   and `SubtractSessionMetric` (RVA `0x83158e2`) — there is no combine
   path through this helper. Player: `economy.js setSessionMetricValue`
   / `resetSessionMetric` / `subtractSessionMetric` (commit `edab506`,
   tested); the Refresh + broadcast steps ride the existing settlement
   path (`settleSession` → `updateChallenges`), as for the six
   producers.
4. **`RefreshIncompleteSessionChallengeMetric` write arithmetic —
   SETTLED 2026-11-12 (decoded line by line from the v0.05.1 exe,
   `RefreshIncompleteSessionChallengeMetric.asm`).** Signature
   `(this, EMetricType metric /*dl*/, int32 value /*r8d*/)`. The write is
   an **absolute assignment**: in the in-progress challenge's
   metric-progress array (16-byte entries: byte metric at `+0`, int32 value
   at `+0xc`), the entry whose byte equals the metric arg gets
   `entry+0xc = value` — the NEW absolute metric value passed in (both
   native callers, Reset and Subtract, pass `*out`, the post-set value).
   Full gate chain, in order: MultiFind on the `this+0x1e0` multimap for
   the metric's challenge names; skip names already refreshed in this call
   (stack-local dedup set); `GetChallengeDataPtr`; skip if null or if the
   `FChallengeData` byte at `+0x68` is set (complete); look the name up in
   the in-progress TMap at `this+0xf0` (64-byte elements) and skip if
   absent; skip if the value's byte at `+0x18` is nonzero; after a
   successful update, add the name to the dedup set and broadcast
   `FOnChallengeProgressUpdate` (`this+0x28`) with the challenge name.
   Whole-`.text` call scan confirms the only callers are
   `ResetSessionMetric` (`0x14830a3b4`) and `SubtractSessionMetric`
   (`0x148315997`). Player: the Refresh + broadcast steps ride the
   settlement path (`settleSession` → `updateChallenges`), which assigns
   Session-scope requirements to the metric value — the same absolute-set
   semantics; reset/subtract have no other callers in the player, so no
   live in-progress display needs an immediate refresh.
5. **`CombineSessionStatsArray` int parameter and max-field handling —
   SETTLED 2026-11-12 (decoded in full from the v0.05.1 exe,
   `CombineSessionStatsArray.asm`; see §4).** The int parameter is the
   **Required won Tower rounds** (native log string
   `"[Progression] Combined %d Tower rounds stats: WonRounds=%d
   Required=%d TowerWon=%s Strokes=%d Edges=%d Duration=%d"`; it defaults
   to the array count when <= 0). Max-merge fields: MaxCombo (`+0x10`),
   EdgeStreak (`+0x50`), ConsecutiveSuccubiSurvived (`+0x54`),
   BestMusicModeWinRounds (`+0xac`), BestTowerWinRounds (`+0xb0`), and
   GamesWithSexToy (`+0x6c` — max, despite the RecordSessionMetric add
   mode; offset confirmed by `native-reflection-schemas.json`,
   `FSessionStats.GamesWithSexToy` at 108). The `+0x40` array is
   `ActiveModifiers` (TArray, concatenated without dedup); the `+0x2d`
   bool (`bLostToSuccubus`) is OR-merged. PercentAtHighHeat is derived
   (`clamp(((int)(TimeAtHighHeat / SessionDuration * 200.0f - 0.5f)) >> 1,
   0, 100)` in float32, 0 when duration <= 0). SessionsWon / bWon are
   1/true iff WonRounds >= Required and Required > 0; when won,
   BestTowerWinRounds is max-merged with Required itself. The native's
   only caller is the `exec` wrapper `0x1481ec480`
   (`UProgressionManager::execCombineSessionStatsArray`, whole-`.text`
   call scan: 1 call site). Player: `economy.js
   combineSessionStatsArray` (commit `5be8ebe`, tested in
   `tests/fanservice_producers.test.js`).
6. **Blueprint callers of the six producers — PARTIALLY SETTLED
   2026-11-12 (whole-`.text` call scan + retained Blueprint set).** The
   four +1 producers have ZERO native call sites; the two Rounds
   producers have exactly one each, both their `exec` wrappers
   (`execRecordTowerWinRounds` `0x1481f03de`,
   `execRecordMusicModeWinRounds` `0x1481f027e`) — i.e. all six are
   Blueprint-callable API, and no native code calls them. No retained
   Blueprint calls any of the six `Record*` functions by name, but the
   retained set records the SAME metric/value through direct
   `UpdateMetric` calls: `UseComboCruncherItem.json` calls
   `UpdateMetric(39, 1)`; `ExecuteUbergraph_BP_GlobalManager.json`
   calls `UpdateMetric(44, 1)` (music break), `UpdateMetric(45, 1)`
   (disabled-break failure) and `UpdateMetric(46, 1)` twice (bounty
   failure). Which Blueprint flow invokes the two Rounds `exec`
   wrappers — and with what rounds argument — is not in the retained
   set; the player's wiring (`run.js` Tower completion →
   `recordTowerWinRounds(completed)` when the run is won,
   `play.js` soundtrack end → `recordMusicModeWinRounds(run, 1)`)
   stands on the direct-call evidence above plus the producer guards
   (§1). The 41/37 producers are covered separately in §9.

## 8. Implementation plan for the player

The player's metrics are already wired and tested (per the #50 status
before this run); the producers were the blocked part. Wire them now,
test-first, in this order:

1. **Session stat application — mirror §3 exactly.** For each metric
   the player records, apply the value by the mode in the §3 table:
   add for most, max for 4/17/18/42/43 (and call the lifetime-best
   update for those five), set for 24, and **no-op** for 5/9/15/20/21
   (do not invent a session increment for them). The player's
   `economy.js` `metricIds` already pins 8/27/30/31/34/35/39; extend
   it with 42/43/44/45/46 (and the rest of the 47-value enum where the
   player already tracks them).
2. **The six producers — mirror §1.** Add a producer call at each
   player event, with the exact metric/value/guard:
   - combo cruncher used → 39, +1.
   - music break used → 44, +1.
   - bounty collection failed → 46, +1.
   - disabled break section failed → 45, +1.
   - tower run won with R rounds → 43, max(R), only if R > 0.
   - music-mode run won with R rounds → 42, max(R), only if R > 0.
   Each producer record also fans out to challenge progress (§2 phase
   3): look up challenges by metric id and update the ones whose
   conditions pass. The §2 phase-2 special case (the `0x1482f4540`
   getter, §7 item 2) is implemented as `getSessionMetricValue`
   (commit `edab506`); its bool is the getter's success, which is true
   for every producer metric (39/42–46).
3. **Reset / subtract — mirror §4 (SETTLED 2026-11-12, commit
   `edab506`).** `resetSessionMetric(metric)` calls the §7-item-3 setter
   with value 0 (false for 9/15/20/21 and out-of-range); the setter
   zeroes the field and the live counterparts. `subtractSessionMetric
   (metric, amount)`: clamp amount >= 0, return `{ok:false}` if amount
   is 0 or the getter refuses, otherwise set the metric to
   `max(current - amount, 0)` via the setter. Both ride the settlement
   path for the Refresh + broadcast steps. No combine helper exists —
   the setter's only callers are Reset and Subtract. The Refresh write itself is now decoded (§7 item 4): an absolute assignment of the new metric value into the in-progress challenge entry.
4. **Combine — mirror §4 (SETTLED 2026-11-12, commit `5be8ebe`).**
   `combineSessionStatsArray(statsArray, requiredWins)`: field-wise sum of
   the additive metrics; max-merge for the six max metrics (4/17/18/42/43
   **and 25 GamesWithSexToy**); OR-merge for the bLostToSuccubus bool;
   concatenate ActiveModifiers; derive PercentAtHighHeat by the native
   float32 formula (a full high-heat session reads 99); SessionsWon / bWon
   from WonRounds >= Required (Required defaults to the array count when
   <= 0; an empty array never wins); when won, BestTowerWinRounds is
   max-merged with Required itself; SessionsCompleted is always 1;
   5/9/15/20/21 are never summed. The native's only caller is its `exec`
   wrapper, so this is a tested utility, not wired into the session flow
   (the player keeps no per-round FSessionStats array to combine).
5. **Difficulty tiers — settled in the data-tables note §6.** There is
   no session-difficulty → native-tier mapping; the player's 3-tier
   scale is unchanged.

### Acceptance criteria (#50, producers part)

- Each of the six producers records exactly the metric/value/guard in
  §1, and the session stat is applied by the §3 mode (add / max / set /
  no-op) — verifiable by unit tests over the metric table.
- Challenge progress fans out by metric id through the challenge table
  (§2 phase 3); the phase-2 helpers (§7 items 2–3) are decoded and
  implemented as `getSessionMetricValue` / `setSessionMetricValue` /
  `resetSessionMetric` / `subtractSessionMetric`, with the Refresh +
  broadcast steps riding settlement.
- The difficulty-tier mapping is decided by the data-tables note §6, not
  by this note; the player's 3-tier scale is unchanged.
- Refresh (§7 item 4) and Combine (§7 item 5) are decoded and implemented
  as above: Refresh is an absolute assignment of the new metric value
  into the in-progress challenge entry, riding settlement in the player;
  Combine is `combineSessionStatsArray(statsArray, requiredWins)` with
  the Required-won-rounds semantics, tested.

## 9. The EndSession producers for metrics 41/37 — FOUND in the GM ubergraph (2026-11-12)

The earlier verdict ("STILL BLOCKED — no retained `.c` file calls
`RecordSessionMetric`") is superseded: the producers are Blueprint
calls in `BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json`
(retained, `newer-20261017`), not native code. A whole-`.text` call
scan of the v0.05.1 exe confirms the native side has no 41/37 producer
at all — the complete census of `UpdateMetricWithConditions` call sites
(17) is: the six producers, `UpdateMetric`, the `exec` wrapper,
`SetStrokeCombo` (metrics 4, 5), `AddXP` (metric 15), and `EndSession`
(metrics 15, 21, 14, 42, 43, 13 — all six already documented in the
EndSession note). Neither 41 nor 37 appears in any native call site.

- **Metric 41 (`SessionsWonAtMaxDifficulty`), ubergraph stmts
  2475–2479:** gated ONLY on `CurrentDifficulty == 2`
  (`EqualEqual_ByteByte`, `CurrentDifficulty` vs byte 2), then
  `UpdateMetric(41, 1)`, then `UpdateObjectiveTitleVictoryStart`, then
  `UpdateMetric(14, 1)` (SessionsWon) — i.e. in a victory path, with the
  `GameModeSelection == 1` check (stmt 2480) coming AFTER the 41 call, so
  the call is NOT mode-gated: a win at Insane counts in any mode. This
  confirms the player's predicate (`won && difficulty===2`, no mode
  condition) exactly, including the value 2 — the Blueprint
  `DifficultySelections_ENUM` InsaneMode, not native `EDifficultyTier` 3.
  Pinned by a regression test (`tests/fanservice_progression.test.js`:
  Insane wins in modes 1 and 2 also record metric 41).
- **Metric 37 (`SuccuSlayerSessionsWon`), ubergraph stmts 777–779:**
  gated ONLY on `GameInstance.CurrentSessionObjective == 8`
  (`EqualEqual_ByteByte` vs byte 8, `ESessionObjective::SuccuSlayer`),
  inside the successful-cum chain (stmt 770 `Change Beat Background` 5,
  stmt 771 `SuccessfulCumBackgroundOverride = true`, stmt 772
  `PrintString "Cumming on Time!! Good job!!!!!"`, stmt 780 `Delay`
  10.0 s) — i.e. a successful cum (win) with a SuccuSlayer objective.
  The retained ubergraph JSON carries no per-statement bytecode offsets,
  so the chain's entry point — and with it a direct mode gate at entry —
  was not resolved from this file; the player's `mode===0` (Classic)
  gate rests on the challenge text ("Win 10 SuccuSlayer sessions in
  classic mode") and on the chain being the session-level successful-cum
  celebration rather than a Tower round flow (Tower round wins are
  recorded separately as metric 43, rounds — not sessions). No
  `UpdateMetric(37, …)` call exists anywhere else in the retained
  Blueprint set, and no native call site records 37. The player's
  predicate (`won && mode===0 && objective===8`) is therefore the
  best-supported reading of the retained evidence, with the
  chain-entry mode gating as the one explicitly recorded residual (see
  the EndSession producers note, updated 2026-11-12).


## 10. Disassembly artifacts

Work files (not committed): `~/workspace/rejoice-evidence/cockhero-itch/work/`
`RecordComboCruncherUsed.asm`, `RecordMusicBreakUsed.asm`,
`RecordBountyCollectionFailure.asm`, `RecordDisabledBreakSectionFailure.asm`,
`RecordTowerWinRounds.asm`, `RecordMusicModeWinRounds.asm`,
`RecordSessionMetric.asm`, `UpdateMetric.asm`,
`UpdateMetricWithConditions.asm`, `ResetSessionMetric.asm`,
`SubtractSessionMetric.asm`, `RefreshIncompleteSessionChallengeMetric.asm`,
`CombineSessionStatsArray.asm`, `GetLevelDataForLevel.asm`.
Manifest check: `retoc manifest` on the v0.05.1 utoc (16,302 entries;
`pakstore.json` in the retoc tools dir).
