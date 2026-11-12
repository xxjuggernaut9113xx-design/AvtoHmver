# #50: data tables — DifficultyTiers_DT, ObjectiveParamTable_DT, ProgressionUpgradeDataTable (2026-11-11)

Source build: **Cock Hero v0.05.1 Hotfix Public**, exe SHA-256
`a8f46896…040c10`, cooked packages unpacked with retoc v0.1.5 and converted
with `retoc to-legacy --no-script-objects` (Paks-directory input).
No player code change in this slice — evidence only.
Mining tools (not in the repo):
`~/workspace/rejoice-evidence/cockhero-itch/work/uasset.py` (retoc legacy
package reader), `tables3.py` / `tables4.py` / `tables5.py` (table decoders
and the `modes.json` comparison driver).

## 0. Headline: independent decode confirms the player's tables exactly

The three tables were decoded from the v0.05.1 cooked packages and compared
field-by-field against the player's `static/fanservice/data/modes.json`
(source: `table-values.json`):

| table | rows | mismatches vs `modes.json` |
| --- | --- | --- |
| `DifficultyTiers_DT` | 6 | **0** |
| `ObjectiveParamTable_DT` | 42 | **0** |
| `ProgressionUpgradeDataTable` | 3 | **0** |

The data side of #50 is therefore settled and already in the player
(`modes.json`, consumed by Tower via `catalog.tiers` / `catalog.objectives`
and by Music Mode via `catalog.music_upgrades`). What remains is the
difficulty-scale decision in §5, not the table contents.

Package paths (legacy, under
`~/workspace/rejoice-evidence/cockhero-itch/legacy/CockHero/Content/`):

- `Data/Rounds/DifficultyTiers_DT.uasset` (+ `.uexp`, export 1922 bytes)
- `Data/Rounds/ObjectiveParamTable_DT.uasset` (+ `.uexp`, export 980 bytes)
- `Data/MusicMode/ProgressionUpgradeDataTable.uasset` (+ `.uexp`, export 167 bytes)

Row struct imports (all FPackageIndex −5 in each table): `DifficultyTierData`,
`ObjectiveParamData`, `MusicModeProgressionUpgradeRow` respectively.

## 1. Serialization finding — zero-valued fields are omitted

DataTable rows in this build are serialized in a compact form in which
**zero-valued (default) fields are skipped**. Evidence, all three tables:

- `DifficultyTiers_DT`: `MinModifiers` / `MaxModifiers` appear in the byte
  stream only when nonzero, in order (Min then Max). Tier1/2 (0, 0): no
  ints; Tier3 (0, 1): `[1]`; Tier4 (0, 2): `[2]`; Tier5 (1, 3): `[1, 3]`;
  Tier6 (3, 3): `[3, 3]`. `ModifierWeight` = 100.0 (float32, always present);
  `NoModifierWeight` = 0 is skipped.
- `DifficultyTiers_DT` Tier6 (Boss): the tail is only 6 int32s
  `[10, -1, -1, -1, -1, 0]` because `BaseSuccuCoins` = 0 is skipped — the
  tail is `[BaseCoins=10, MinBaseCoins=-1, MaxBaseCoins=-1,
  MinBaseSuccuCoins=-1, MaxBaseSuccuCoins=-1, count=0]`, i.e. 5 scalars +
  an empty `UnlockableSuccuModifiers` array. Tiers 1–5 have 6 scalars +
  count + count × FName (see §2).
- Row prefixes (`DifficultyTiers_DT` `80 1d 2c 00` / `80 1d 24 00` /
  `80 1d 20 00` / `80 1d 20 01`; `ObjectiveParamTable_DT` `[00][09]`;
  `ProgressionUpgradeDataTable` `80 0d 01` / `00 0d 01` / `00 0d 02`) vary
  with the row's present-field set and are recorded verbatim; their exact
  semantics (likely a present-field bitmask) are not established. Do not
  treat them as data.

## 2. DifficultyTiers_DT — 6 rows, fully decoded

Field order in the byte stream (after the 4-byte prefix and the tier int32):
10 constant bytes `00 00 00 00 00 01 00 00 00 00`, FString GUID (33 bytes:
32 hex chars + null), FString display name, `MinModifiers` / `MaxModifiers`
(int32s, only when nonzero), float32 `ModifierWeight` = 100.0, int32 modifier
count + that many FString `EligibleModifierTitles`, then the tail: int32s
`BaseCoins, BaseSuccuCoins, MinBaseCoins, MaxBaseCoins, MinBaseSuccuCoins,
MaxBaseSuccuCoins`, int32 count + that many FName
`UnlockableSuccuModifiers` (values are `ESuccuShopModifier::…` enum names;
the name map holds indices 0–18).

| Tier | Display | Min/Max Mod | Eligible modifier titles | BaseCoins | BaseSuccu | Min/Max Coins | Min/Max SuccuCoins | UnlockableSuccuModifiers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Very Easy | 0/0 | Demon Proof, Prize Machine, Slow and Steady | 25 | 1 | 25/50 | 1/1 | PassiveCooling |
| 2 | Easy | 0/0 | + Greed Machine, Jackpot Drops, Bad RNG, Overencumbered, Fap Tax, Mr. Money Bandz | 50 | 1 | 50/75 | 1/2 | PassiveCooling, BankingError |
| 3 | Medium | 0/1 | Prize Machine, Greed Machine, Jackpot Drops, Bad RNG, Overencumbered, Fap Tax, Mr. Money Bandz, Pheromones, Hot Hands | 150 | 2 | 100/200 | 1/3 | GoonTycoon, EnhancedPlating, BankingError, PassiveCooling, GoldenShower, HellMagnet, PotLid |
| 4 | Hard | 0/2 | Pheromones, Hungry Succubi, Hivemind, Deal With The Devil, Double Time, All or Nothing, Those Are Mine, Dry Spell, Panic Button, Hot Hands, Avarice | 250 | 3 | 200/400 | 3/5 | PotLid, GoldenShower, DevilCoin, HeatSpell, BurningProfits, InfernalClause, Exorcist, StockholmCuffs, BiggerPockets, EnhancedPlating, Recycler, GoonTycoon |
| 5 | Insane | 1/3 | Pheromones, Hungry Succubi, Succufrenzy, Raw Dog, All or Nothing, Hivemind, Deal With The Devil, Double Time, Dry Spell, Double Devil, Panic Button, Hot Hands, Those Are Mine, Avarice | 300 | 5 | 400/750 | −1/5 | Recycler, SpoilsOfSin, Molasses, HeatSpell, InfernalClause, EnhancedPlating, HellMagnet, DevilCoin, FlameHarness, Coinverter |
| 6 | Boss | 3/3 | Pheromones, Hungry Succubi, Succufrenzy, Raw Dog, All or Nothing, Hivemind, Deal With The Devil, Double Time, Double Devil, Panic Button, Hot Hands, Those Are Mine, Avarice | 10 | 0 | −1/−1 | −1/−1 | (none) |

GUIDs: Tier1 `5F3FAF5F4B5B2CD2D2B899B7259073C`, Tier2
`950571244D41221290AB79A77D198634`, Tier3 `E745C8A84AD4B06226043985D90BCA5`,
Tier4 `D465F5744B18B7762D62A7838C79034C`, Tier5
`4FDA6D09E24BB7F7793CFB82CAD53F7`, Tier6 `E0CDDDE4287DADDD2E3FB96F6BD819`.

Notes: `BankingError` is enum index 0 and appears in Tier2 (2nd) and Tier3
(3rd) — it may be a default/None placeholder rather than a real unlockable
modifier; record it verbatim. `MinBaseSuccuCoins` = −1 on Tier5 and every
−1 on Tier6 are the raw values (unset/disabled sentinels). The
`EligibleModifierTitles` are FStrings (display names); the
`UnlockableSuccuModifiers` are FName enum values — two different lists, do
not conflate them.

## 3. ObjectiveParamTable_DT — 42 rows, fully decoded

Export layout: 10-byte prefix (`00 03 fb ff ff ff 00 00 00 00` — `fb ff ff
ff` = −5, the RowStruct FPackageIndex) + int32 row count (42) + per-row
FName key (8 bytes) + 15 bytes of data. Fixed 23-byte stride; 14 + 42×23 =
980 = export size exactly. Row data: `[00][09][Group][Diff][00 00 00]
[A int32][B int32]`.

Groups (byte): 01 Timer, 02 Strokes, 03 Edges, 05 Ruiner, 06 Prejac,
07 Tribute, 08 SuccuSlayer (04 missing). Difficulty byte: 01 VeryEasy,
02 Easy, 03 Medium, 04 Hard, 05 VeryHard/Insane, 06 Boss — byte 05 is shared:
Timer/Strokes rows name it "Insane", Edges/Ruiner/Prejac/Tribute/SuccuSlayer
rows name it "VeryHard". The tier byte, not the row-name suffix, is the
difficulty.

| Group | VeryEasy (1) | Easy (2) | Medium (3) | Hard (4) | VeryHard/Insane (5) | Boss (6) |
| --- | --- | --- | --- | --- | --- | --- |
| Timer | (45, 75) | (75, 100) | (120, 150) | (160, 210) | (200, 320) | (360, 420) |
| Strokes | (40, 70) | (75, 100) | (175, 350) | (350, 500) | (500, 750) | (750, 1000) |
| Edges | (1, 1) | (1, 2) | (2, 4) | (4, 6) | (6, 12) | (15, 25) |
| Ruiner | (1, 2) | (1, 3) | (2, 5) | (3, 7) | (5, 10) | (8, 14) |
| Prejac | (360, 480) | (240, 360) | (150, 240) | (90, 150) | (45, 90) | (30, 90) |
| Tribute | (1, 1) | (1, 1) | (1, 2) | (2, 3) | (3, 4) | (3, 5) |
| SuccuSlayer | (1, 3) | (5, 4) | (5, 7) | (8, 12) | (12, 16) | (16, 26) |

Caveat: SuccuSlayer_Easy is (5, 4) — A > B — so the pair is not strictly a
min/max range for every parameter; treat (A, B) as the raw ordered pair from
the table (the player already stores them as MinValue/MaxValue in that
order). Prejac values decrease as difficulty rises (a countdown, not a
target count).

## 4. ProgressionUpgradeDataTable — 3 rows, fully decoded

Export layout: 10-byte prefix + int32 row count (3) + per-row FName key
(`NewRow`, number 0/1/2) + 43 bytes of data. Row data: 3-byte prefix + 5
float64 values (levels L1–L5). 14 + 3×51 = 167 = export size exactly.

| Row (key) | UpgradeType | L1 | L2 | L3 | L4 | L5 |
| --- | --- | --- | --- | --- | --- | --- |
| NewRow (0) | `EMusicModeProgressionUpgrade::IncreaseBreakDuration` | 5.0 | 8.0 | 12.0 | 15.0 | 18.0 |
| NewRow_0 (1) | `EMusicModeProgressionUpgrade::IncreaseTotalBreaks` | 1.0 | 2.0 | 3.0 | 4.0 | 5.0 |
| NewRow_1 (2) | `EMusicModeProgressionUpgrade::DecreaseStrokesToGrantBreak` | 500.0 | 400.0 | 300.0 | 250.0 | 180.0 |

The `UpgradeType` enum values come from `modes.json` (the row keys in the
cooked package are all `NewRow` with numbers 0–2; the enum is not stored in
the row data itself). `DecreaseStrokesToGrantBreak` decreases with level
(500 → 180 strokes), as its name implies. The player already consumes these
via `catalog.music_upgrades` (e.g. `play.js:261` reads
`music_upgrades[1]` for max breaks).

## 5. The remaining #50 question: difficulty-scale mapping (not settled by the tables)

Native enums (from
`Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json`,
build-exact for v0.05.1):

- `EDifficultyTier`: Easy = 0, Medium = 1, Hard = 2, Insane = 3.
- `EMusicModeDifficultyTier`: Easy = 0, Medium = 1, Hard = 2, Insane = 3.

Native tables: 6 tiers (Very Easy 1 … Boss 6); objective difficulty byte
1–6. The player's Tower already consumes the 6-tier catalog
(`tower.js` tiers 1–6, `catalog.tiers` / `catalog.objectives`).

The player's **session** difficulty is a separate, coarser 3-value scale:
`play.html` select — Easy (0), Normal (1), Insane (2); validated 0–2 in
`run.js:10` and `session_presets.js:12`; beat intervals `[.7, .5, .35]`
indexed by it (`play.js:543, 570`); `SessionsWonAtMaxDifficulty` fires when
a session is won at difficulty 2 (`progression.js:15`).

So the open decision is: does player difficulty 2 ("Insane") correspond to
native Insane (3) — the player's scale skipping native Hard (2) — or should
the player add native Hard as a 4th session tier (shifting Insane to 3,
which would change the beat-interval table, the 0–2 validation, the preset
schema, and the `SessionsWonAtMaxDifficulty` gate)? The tables above do not
settle that by themselves; the natural reading of the table row names is
player Easy → native Easy, player Normal/Medium → native Medium, player
Insane → native Insane (Tier5), with native Hard (Tier4) and Very Easy /
Boss (Tiers 1, 6) having no session-scale counterpart. Do **not** change the
player's 3-tier scale on assumption — this needs a product decision, and the
#50 acceptance criteria should name which mapping they require.

Related but not in these tables: the four difficulty multipliers named in
the usmap (`DifficultyCoinEarnMultiplier`, `DifficultyStrokeCounterMultiplier`,
`DifficultyStrokeSpeedMultiplier`, `DifficultyHeatGainMultiplier`,
`~/workspace/reJOIce/Materials/Mappings/CockHeroProgression.usmap`) — their
owning struct and values were not located in this pass; they are not fields
of `DifficultyTierData` (its numeric fields are the integers in §2).

## 6. Tier-mapping assessment — SETTLED 2026-11-11 (supersedes the open assessment below)

**Decision: there is no session-difficulty → native-tier mapping, because
the two scales are independent axes. No mapping change in the player.**

- **Session difficulty is a 3-value Blueprint enum, not `EDifficultyTier`.**
  `DifficultySelections_ENUM` (unpacked
  `Widgets/DifficultySelections_ENUM.uasset`, name table):
  `NewEnumerator0 = EasyMode`, `NewEnumerator1 = NormalMode`,
  `NewEnumerator2 = InsaneMode`. `BP_GlobalManager.CurrentDifficulty` is
  that enum (proven by `GetEnumeratorUserFriendlyName` on object −4140 =
  `DifficultySelections_ENUM` in every setter). The
  `DifficultySelectScreen_Widget` has `Easy/Normal/InsaneDifficultyButton`
  with `ClickEasy/Normal/InsaneButton` functions, a `CurrentDifficulty`
  reference, a `K2Node_DynamicCast_AsBP_Global_Manager`, and a call to
  `InitializeDifficultyVariables`. The player's session scale (Easy 0 /
  Normal 1 / Insane 2, validated 0–2 in `run.js:10` and
  `session_presets.js:12`) is already that enum, 1:1.
- **The "natural reading" in §5 is rejected.** Player Insane does NOT map
  to native Tier5, and native Hard (Tier4) is not a missing session tier:
  Tier5/Tier4 belong to the Tower/objective axis, not the session axis.
  Do not add a 4th session tier or shift Insane to 3.
- **§6 item (a) — the session-mode objective reader: none exists.**
  `ObjectiveParamTable_DT` is read only by Tower:
  `URoundManager::RollObjectiveParam(ESessionObjective, int)`
  (`0x14830da40`) — sole call site `0x1482e2993`, inside
  `URoundManager::GenerateRoundOptions` (`0x1482e1440`) — and
  `GetOpeningCalibrationTier` (`0x1482f3bf0`, call sites `0x1482e1f05`,
  `0x1482e2719`, also inside `GenerateRoundOptions`). `RollObjectiveParam`
  scans the table's row map for the row whose `+0x8` byte is the objective
  group and whose `+0xc` byte is the tier, and returns a uniform random
  int in [`[+0x10]`, `[+0x14]`]. `BP_CHGameInstance` only hands the tables
  to the RoundManager (`SetDifficultyDataTable` /
  `SetObjectiveParamTable` in its ubergraph) and `SetCurrentSessionObjective`
  is a bare assignment. Session (Classic) objectives never index the table.
- **§6 item (b) — the four `Difficulty*Multiplier` values and owners:
  settled.** Owners are `BP_GlobalManager` instance variables, set by the
  five functions called from `InitializeDifficultyVariables` (8 stmts),
  each switching on `CurrentDifficulty` with exactly 3 cases (0/1/2):

  | variable | Easy (0) | Normal (1) | Insane (2) | consumer (evidence) |
  | --- | --- | --- | --- | --- |
  | `DifficultyCoinEarnMultiplier` | 2.0 | 1.0 | 0.5 | **none** — set and printed only; the name occurs in no other v0.05.1 package (legacy + Zen `.uasset` grep), so beat coins do not scale with difficulty |
  | `DifficultyHeatGainMultiplier` | 0.75 | 1.0 | 2.0 | `AddHeat`: `HeatToAdd = HeatAdd * DifficultyHeatGainMultiplier` (unless `IgnoreHeatMultiplier?`), then Lube ×0.5, clamp to MaxHeat 100 (75 with Pot Lid) |
  | `DifficultyStrokeCounterMultiplier` | 1.0 | 1.0 | 2.0 | `BP_DrawManager` — `Determine Time and Stroke Multiplier Basedon Combo` (8 reads) |
  | `DifficultyStrokeSpeedMultiplier` | 1.25 | 1.0 | 0.6 | same `BP_DrawManager` function (7 reads) |

  Player corrections, commit `cca2241` (tests first, new
  `tests/fanservice_difficulty.test.js`): `card-rules.json`
  `difficulty_count` 0.5 → 1.0 (Easy) and `difficulty_speed` 1.85 → 1.25
  (Easy); `economy.js` `addHeat` `[.5,1,3]` → `[.75,1,2]`. The player's
  `addHeat` shape already matched native (amount × Lube-halving ×
  difficulty table); only the table values were wrong. Coin: no change —
  the player already leaves beat coins unscaled by difficulty, matching
  the original's observable behavior.
- **§6 item (c) — native `EDifficultyTier` consumers: settled, Tower /
  beatmap-library only.** `UBeatmapLibraryManager::GetEntriesByDifficulty`
  / `TierToString` / `CalculateDifficulty` (beatmap difficulty info);
  `URoundManager::RollAdaptiveDifficultyTier` (`0x14830cdb0`, 5-weight
  roll returning 0–4) and `GetDifficultyForRound` (`0x1482ef920`, called
  only from its Blueprint `exec` wrapper). No session-mode consumer.

Still open (recorded, not guessed):
- `DifficultySelectScreen_Widget` bytecode: Zen-only, not legacy-converted,
  so the button → enum-value assignment is inferred from the button /
  function / enum names, not parsed.
- Producers-note §7 items 4–5 (`RefreshIncompleteSessionChallengeMetric`
  write arithmetic, `CombineSessionStatsArray` int parameter) — SETTLED
  2026-11-12, see the producers note §7 items 4–5 and §4: Refresh is an
  absolute assignment of the new metric value into the in-progress
  challenge entry; Combine's int parameter is the Required won Tower
  rounds (player: `economy.js combineSessionStatsArray`, commit
  `5be8ebe`, tested).

Settled 2026-11-12 (commits `b20890d`, `96ae5e3`, `3539be3`, `edab506`;
tests in `tests/fanservice_difficulty.test.js` and
`tests/fanservice_producers.test.js`; suite 387 pass):
- `SetCumMeterDifficultyModifier` (72 stmts, per-case block walk with
  exact `EX_Jump`/`EX_JumpIfNot` CodeOffsets resolved via the re-parsed
  legacy `BP_GlobalManager.uasset` script): the outer switch is on
  `GameModeSelection` (0=Classic, 1=Tower, 2=Playlist), NOT on difficulty.
  Classic switches on `CurrentDifficulty` 0/1/2 → `CumMeterMultiplier`
  8.0 / 1.0 / 0.5 and NEVER sets `BaseCumGain` (stays the CDO 0.00025).
  Tower switches on the selected option's `DifficultyTier` 0–6 →
  (`CumMeterMultiplier`, `BaseCumGain`): 0/1 → (10.0, 0.01), 2 → (8.5,
  0.006667), 3 → (5.0, 0.004), 4 → (4.0, 0.002857), 5 → (3.0, 0.002),
  6 → (2.0, 0.001111); out-of-range tier changes nothing. Playlist
  returns without touching either value. Player: `economy.js`
  `cumMeterDifficulty` / `towerCumMeterDifficulty`, Classic applied at
  session start (`Economy.initialize`), Tower applied once on the first
  Tower `select()` (native runs the setter once per GM lifetime at
  BeginPlay reading the then-current `SelectedOption`; no per-round
  caller exists), stored in `state.sessionMeterMultiplier` so `draw()`
  restores it instead of 1 (native has no per-draw reset; the old
  `draw()` reset clobbered a difficulty value every draw). Money Bandz ×
  tier-gain interaction — SETTLED 2026-11-12 (see the bullet below):
  the native `AddtoCumMeteronBeatComplete` (stmts 15–17 + 22) OVERWRITES
  `BaseCumGain` to 0.000125 whenever Mr. Money Bandz is active, so a
  Tower tier gain is clobbered to 0.000125 and the tier multiplier still
  applies on top; the player's `beat()` overwrite + `meter()` 0.000125
  already did exactly this, now pinned by a Tower regression test
  (`tests/fanservice_difficulty.test.js`, commit `5be8ebe`).
- `SetItemSpawnRatesBasedOnDifficulty` (94 stmts): per `CurrentDifficulty`
  0/1/2 → (CumIncrease, DecreaseHeat, Edge, Break, Slowdown, BonerPill,
  SuccuShield): Easy (20, 40, 45, 35, 40, 75, 20), Normal (8, 25, 15, 15,
  15, 50, 10), Insane (3, 10, 5, 5, 10, 35, 5). Player:
  `economy.itemSpawnChances(difficulty)` (tested). Its ONLY consumer,
  `RollAndGiveLootDrops` (102 stmts), is dead in this build — no Blueprint
  caller, no delegate binding in the GM ubergraph, no `exec*` symbol in
  the public PDB, name absent from the exe strings — so the player's
  `Modifiers.rollLoot` (live V3/native-Roll weighted pick) is NOT
  re-weighted. V1's mechanics, decoded for the record: per item, if
  `Available < Max*ItemCount` (CDO caps 1/3/10/3/2/5/15 for
  CumIncrease/DecreaseHeat/Edge/Slowdown/Break/BonerPill/SuccuShield), an
  independent Roll Chance (0-100%) grants +1 — except the Slowdown roll
  grants Break and the Break roll grants Slowdown (native copy-paste
  swap, confirmed by exact statement offsets), and a shield grant is
  [10,15,20,25,35] by `SuccubusShieldsUpgradeLevel` 0–4 (confirmed by
  jump-target → statement-ip mapping). The live loot path is
  `RollAndGiveLootDropsV3` (called by `Beat_Complete_Add_Lootbar_Reward`,
  itself with no Blueprint caller) + native `RollLootDrop`.
- `SetEdgingPaceModifier` (21 stmts): switches on the SAVE setting
  `GameInstance.CurrentSave.EdgePacingMultiplierEnum` 0–4 →
  `EdgePacingMultiplier` 1.0/2.0/3.0/4.0/8.0 (MultiplierEnum 1x/2x/3x/4x/
  8x); out-of-range changes nothing. Corroborated by the
  `state-rule-traces.json` traces (enums 0–5, 17.0 sentinel). Player:
  `economy.multiplierEnumValue` + `Run` constructor mapping of
  `edgePacingMultiplierEnum` onto `config.edgePacingMultiplier` (already
  consumed by `cards.js:61`). The consumer ranges in `cards.js:61`
  (stroke +.05–.08, interval −.03–.05, counts [3,50]/[3,60] in native
  `DetermineEdgeStroke_SpeedCount`) are NOT the player's
  (+.1–.25, −.01–.02, [15,60]) and were left untouched — they come from
  a different native source (BP_EdgeManager), not from this setter.
- `SetUserStrokeMultiplier` (21 stmts): switches on the SAVE setting
  `GameInstance.CurrentSave.StrokeMultiplierEnum` 0–4 →
  `UserStrokeCountMultiplier` 1.0/2.0/3.0/4.0/8.0 (same MultiplierEnum);
  out-of-range changes nothing. Corroborated by the
  `state-rule-traces.json` traces (enums 0–5 and 255). Player: same
  `multiplierEnumValue`, mapped onto `config.userCountMultiplier`
  (already consumed by `cards.js` `timing()`). The settings UI offers
  both enums (`VideoSettingsMenuV2` `EdgePacingMultiplier` /
  `StrokeCountMultiplier` combos, initialized from the save); both save
  enums default to 0 (byte default) → 1.0.
- Producers-note §7 items 2–3 (`0x1482f4540` / `0x148311f70` helpers)
  settled — see that note §4/§7 and commit `edab506`.
- Money Bandz × tier gain — SETTLED 2026-11-12
  (`AddtoCumMeteronBeatComplete.json`, retained `newer-20261017`,
  stmts 15–17 + 22): if `IsModifierActive?("Mr. Money Bandz")` then
  `BaseCumGain = 0.000125` — a constant assignment that overwrites
  whatever `SetCumMeterDifficultyModifier` set, including a Tower tier
  value (0.01 / 0.006667 / 0.004 / 0.002857 / 0.002 / 0.001111); it is
  NOT a halving of the current value. The gain applied that beat is
  then `BaseCumGain × CumMeterMultiplier` (stmt 22), so the tier
  multiplier still applies on top of 0.000125. (The Devil check at
  stmts 18–21 returns early with no gain when Deal With The Devil is
  active and the card is not a Succubus card.) The assignment persists
  in the instance variable — the setter runs once per GM lifetime, so a
  clobbered tier gain is not restored. The player already matched this
  exactly (`economy.beat()` overwrites `state.baseGain` to 0.000125;
  `rules.meter()` uses 0.000125 × `meterMultiplier`); the Tower
  regression test in `tests/fanservice_difficulty.test.js` (commit
  `5be8ebe`) pins tier-gain + Money Bandz → 0.000125 × tier multiplier
  and tier-gain alone → tier gain × tier multiplier.

### The earlier open assessment (superseded — kept for the record)

What is already aligned:
- The table contents are identical to the player's `modes.json`
  (0 mismatches across all three tables, §0).
- Tower consumes the 6-tier catalog natively: `tower.js:26` looks up
  `catalog.objectives` and `catalog.tiers` by `Tier` 1–6 (final round = 6,
  Boss), so Tower's tier mapping is the native one by construction.
- Music Mode consumes `catalog.music_upgrades` (the 3 decoded rows).

What does not exist anywhere in the player:
- Any mapping from the **session** difficulty scale (0/1/2 — Easy/Normal/
  Insane, `play.html` select) to a native tier. Session difficulty is used
  only for the beat-interval table `[.7, .5, .35]` (`play.js`), the 0–2
  validation (`run.js:10`, `session_presets.js:12`), and the
  `SessionsWonAtMaxDifficulty` gate at difficulty 2 (`progression.js:15`).
  It never indexes the tier tables or the objectives table.
- Any session-scale field in the native tables themselves — the tables are
  keyed by tier 1–6 (and the objective difficulty byte 1–6), not by a
  3-value session scale.

The open decision, unchanged from §5: the "natural reading" (player Easy →
native Easy, player Normal/Medium → native Medium, player Insane → native
Insane/Tier5, with native Hard/Tier4, Very Easy/Tier1 and Boss/Tier6 having
no session-scale counterpart) is an interpretation, not evidence. The
player's 3-tier session scale is left unchanged; do not add a 4th session
tier or shift Insane to 3 on assumption — that would change the
beat-interval table, the 0–2 validation, the preset schema, and the
`SessionsWonAtMaxDifficulty` gate.

What would settle it:
- (a) The session-mode objective reader: which `ObjectiveParamTable_DT`
  rows session mode reads for a given `EDifficultyTier` (0–3), i.e. how
  the native session difficulty byte relates to the table's 1–6 bytes.
- (b) The four `Difficulty*Multiplier` values and their owning struct
  (usmap-named, not located — see above).
- (c) Any native `EDifficultyTier` → session-parameter consumer found by
  disassembly (the #50 producers work in
  `ticket50-producers-native-20261111.md` covers the record functions, not
  this mapping).
