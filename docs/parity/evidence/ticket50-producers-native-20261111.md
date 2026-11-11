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
   shared case calls an unidentified helper at `0x1482f4540` with
   `(sessionStats=this+0x230, level=this+0x98, metric, &bool)` — no
   public symbol exists at that address (nearest public symbol is
   `URoundManager::GetPurchaseCostForLevel` at `0x1482f4420`; the
   helper is a static/local function). Its bool result feeds a log
   line (metric name via `StaticEnum<EMetricType>() 0x1481e2a90` +
   value, `BasicLog 0x140f252a0`). Its exact name and return meaning
   are **not** established; it is called only for metrics 39/42–46.
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
39/42–46 special case (log + unidentified helper), and (c) every
challenge tracking that metric.

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
| `ResetSessionMetric` | `0x14830a2a0` (496 bytes) | Reads the metric's current session value via the unidentified static helper `0x148311f70` (not in the public PDB); if the metric has no value, logs a warning (metric name) and returns. Otherwise calls `RefreshIncompleteSessionChallengeMetric` with the current value, logs (verbosity >= 6), and broadcasts the challenge-progress-update delegate (`this+0x28`). The actual zeroing of the session field is done by the helper/caller path, not by an explicit store visible in this body — do not describe it as "sets the field to 0" without the helper's name. |
| `SubtractSessionMetric` | `0x148315720` (864 bytes) | Clamps the amount to >= 0 (`cmovs`); amount <= 0 logs a warning and returns. Calls the `0x1482f4540` helper with the session stats, `this+0x98`, and the metric; if it returns false, logs a warning and returns. Otherwise applies the delta `-amount` through `0x148311f70` (same helper as Reset) and logs. |
| `RefreshIncompleteSessionChallengeMetric` | `0x148307760` (720 bytes) | `MultiFind` on the `this+0x1e0` multimap for the metric's challenge names; for each, `GetChallengeDataPtr` (`0x1482e71e0`); skips challenges whose `+0x68` byte is set (complete); otherwise updates the in-progress session challenge value for that challenge in the maps at `this+0xf0`/`+0x128`. (Body partially read — the exact progress-write arithmetic was not decoded line by line.) |
| `CombineSessionStatsArray` | `0x1482da9c0` (472 lines) | `FSessionStats CombineSessionStatsArray(const TArray<FSessionStats>&, int)`. Zeroes a 192-byte output struct, then field-wise **adds** the additive metrics across every input struct (element stride 0xc0). The max/best fields are handled separately in the remainder of the function (not fully read). The int parameter's role was not established from the partial read — do not guess it. |
| `GetLevelDataForLevel` | `0x1482f1610` | `const FLevelData* GetLevelDataForLevel(int Level) const`. Reads the Level Data Table pointer at `this+0x68`; returns null if null; otherwise iterates the table's rows and returns the row matching the level number. The row contents (the tier parameters) live in `DT_LevelData` (§6). |

`UProgressionManager` member offsets used above: `+0x28` challenge-progress
delegate, `+0x60` Challenge Data Table (`UDataTable*`), `+0x68` Level
Data Table (`UDataTable*`), `+0x98` int (passed to the `0x1482f4540`
helper — plausibly the current level), `+0x1e0`
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

1. **Difficulty-tier mapping.** Needs the `DifficultyTiers_DT` row
   contents (tier count, names, and the parameters per tier) — see §5.
   Until those rows are read, do not map native Insane=3 to player
   Insane=2 by assumption.
2. **`0x1482f4540` helper.** Unnamed in the public PDB; called by
   `UpdateMetricWithConditions` (metrics 39/42–46) and by
   `SubtractSessionMetric`, with `(sessionStats, this+0x98, metric,
   &bool)`. Its name and the meaning of its bool are not established.
3. **`0x148311f70` helper.** Unnamed in the public PDB; shared by
   `ResetSessionMetric` and `SubtractSessionMetric`. Its exact
   signature and the zeroing step of Reset are not established.
4. **`RefreshIncompleteSessionChallengeMetric` write arithmetic.**
   The loop structure and the skip-if-complete check (`+0x68` byte)
   are established; the exact progress-write arithmetic in the tail
   was not decoded line by line.
5. **`CombineSessionStatsArray` int parameter and max-field handling.**
   The additive field-wise sum is established; the int argument's role
   and the max-field merge in the function's remainder were not read.
6. **Blueprint callers of the six producers.** Which Blueprint flows
   call `RecordComboCruncherUsed` / `RecordMusicBreakUsed` /
   `RecordTowerWinRounds` / `RecordMusicModeWinRounds` /
   `RecordBountyCollectionFailure` /
   `RecordDisabledBreakSectionFailure` (and with what arguments for
   the two Rounds producers) is not established by native disassembly;
   the cooked packages are being mined separately.

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
   conditions pass. Do not add the §2 phase-2 special case (the
   `0x1482f4540` helper) until §7 item 2 is identified.
3. **Reset / subtract — mirror §4.** `resetSessionMetric(metric)`:
   read the current value, refresh incomplete session challenges with
   it, broadcast the progress update. `subtractSessionMetric(metric,
   amount)`: clamp amount >= 0, return early (with the warning) if
   amount is 0 or the helper refuses, otherwise apply `-amount`.
   Both need the `0x148311f70` helper's semantics before the zeroing /
   delta step can be implemented faithfully — record that gap in the
   code, don't guess it.
4. **Combine — mirror §4.** `combineSessionStatsArray(statsArray)`:
   field-wise sum of the additive metrics; max-merge for the five max
   metrics (4/17/18/42/43); set-copy for 24. Leave the int parameter's
   role open until §7 item 5 is read.
5. **Difficulty tiers — blocked on §7 item 1.** Do not change the
   player's 3-tier scale until the `DifficultyTiers_DT` rows are read.
   When they land, the mapping (and any 4th tier the player must add)
   follows from the rows, not from this note.

### Acceptance criteria (#50, producers part)

- Each of the six producers records exactly the metric/value/guard in
  §1, and the session stat is applied by the §3 mode (add / max / set /
  no-op) — verifiable by unit tests over the metric table.
- Challenge progress fans out by metric id through the challenge table
  (§2 phase 3); the phase-2 helper and the reset/subtract zeroing step
  remain explicitly open (§7 items 2–3) and are not guessed.
- The difficulty-tier mapping is decided by the `DifficultyTiers_DT`
  rows, not by this note; until they are read, the player's 3-tier
  scale is unchanged.

## 9. Disassembly artifacts

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
