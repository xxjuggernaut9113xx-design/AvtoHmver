# #48: Heat Spell on Escape Rope, UpdateMetric 30/31/35 names, types 1/3/6/7 hook correction — evidence and fixes (2026-11-11)

Source build: reJOIce `Analysis/ReferenceBuilds/newer-20261017/` (HEAD `1a18e9a8`).
All statement numbers below are from the retained function ASTs unless noted.
Player changes in this slice: `static/fanservice/economy.js` (item 1),
`static/fanservice/items.js` (item 3). Tests: `tests/fanservice_economy.test.js`,
`tests/fanservice_items.test.js`. Full suite after this slice: Node 291 pass /
0 fail, Python schema 12 pass.

## 0. GlobalManager ubergraph offset model (new tool)

`tools/gm_ubergraph_offsets.py` resolves ubergraph entry byte offsets to
statement indices. Sizes follow UAssetAPI's
`Analysis/bytecode-size-source/*.cs` Visit methods; the build uses UE5 large
world coordinates, so `EX_VectorConst`/`EX_RotationConst` are 25 bytes and
`EX_TransformConst` is 81 bytes (with 40-byte transforms only 92/299 jump
targets align). Validation on
`functions/BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json`: 2570
statements, 99921 bytes, **299/299 jump-target occurrences aligned (280
distinct), 0 context-offset mismatches**. The stmt-0 push address 99918 is
the epilogue Return (stmt 2568), not the script end (99918 + 2 + 1
EndOfScript = 99921), so the total is exact. This closes open item (4) of
`ticket48-activateitem-review-20261110.md` (the offset model for that file
was not built) and corrects its entry claim: **77093 resolves to stmt 1868,
not stmt 1440** (see §3). The same model independently reproduces the #44
loop anchors (73198 → 1776, 73997 → 1794, 72658 → 1758, 57837 → 1394).

## 1. Heat Spell on Escape Rope — established, fixed

`ActivateItem.json` (164 stmts) calls `ApplyHeatSpellEffect` at exactly six
sites, one per branch:

| stmt | branch | type |
| --- | --- | --- |
| 30 | UseCumChanceItem | 0 |
| 42 | UseReduceHeatItem | 1 |
| 53 | UseSlowdownItem | 3 |
| 74 | Use Break Item (non-Playlist path) | 4, mode != 2 |
| 91 | ToggleSuccuShields | 6 |
| 102 | TabbedInventoryResupplyTrigger | 7 |

The type-10 (EscapeRope) branch (stmts 120-130) calls `UseEscapeRopeItem`,
`UpdateMetric(35, 1)`, `UpdateMetric(30, 1)`, `PlayUseItemAnim`,
`PlayUsedLastItemAnim`, `BreakCombo`,
`DetermineShouldHotHandsModifierApply(10)` and
`ApplyAllOrNothingModifierEffects_IfToggled` — **no `ApplyHeatSpellEffect`**.
Types 5, 9, 11, 12, 13 also never call it.

`UseEscapeRopeItem.json` is a 3-statement stub delegating to
`ExecuteUbergraph_BP_GlobalManager` entry **71540**, which the offset model
resolves to stmt 1726. The flow (1726-1721, via Jump → 71421 → stmt 1720) is:

- 1726-1727: create widget, `AddToViewport(0)`;
- 1728: `PlayerVariablesStruct.CanUseItems = true`;
- 1720: `SlowStrokeEvent()`; 1721: `PopFlow`.

No heat manipulation of any kind: no `ApplyHeatSpellEffect` call and no
`Heat Level` write. A repo-wide grep confirms `ApplyHeatSpellEffect` is
mentioned in only two files (`ActivateItem.json` and its own definition) and
no statement anywhere in the GlobalManager ubergraph mentions it.

`ApplyHeatSpellEffect` itself: if `HasSuccuModifier(4)` (Heat Spell upgrade),
`Heat Level = clamp(Heat - 10, 0, 100)`, plus the "Heat Spell" /
"Defensive Item Used\r\nHeat has been reduced by 10%" notification.

**Fix (`economy.js` `itemUsed`):** the Heat Spell -10 was applied to every
Defensive item. It is now applied only to the types `ActivateItem` applies
it to: `[0, 1, 3, 6, 7]` plus type 4 when `run.config.mode !== 2`
(Playlist Break takes the `StartRhythmModeBreak` branch, stmts 62-71, which
has no Heat Spell call). Type 0 is in the set for completeness; the player
has no CumChance item. This also removes the over-application to Combo
Cruncher (13) and Playlist Break, which the same evidence establishes.
`tests/fanservice_economy.test.js` now asserts the full set (1/3/6/7 yes,
Break non-Playlist yes / Playlist no, 10/13/5/9/11/12 no) and the
Heat-Spell-before-Hot-Hands ordering under the Pot Lid cap. The pre-existing
Escape Rope expectation (heat 74) is corrected to 75: with no -10, Hot Hands
+10 from 74 is capped at 75 by Pot Lid.

## 2. UpdateMetric 30/31/35 names — resolved

`native-reflection-enums.json` gives the `EMetricType` enum with explicit
values, and the native `UpdateMetric` signature is
`UpdateMetric(EMetricType, int)` (`?UpdateMetric@UProgressionManager@@QEAAXW4EMetricType@@H@Z`,
0x148318bb0), so the byte IDs are the enum ordinals:

- **30 = `EMetricType::DefensiveItemsUsed`**
- **31 = `EMetricType::OffensiveItemsUsed`**
- **35 = `EMetricType::EscapeRopesUsed`**

Complete caller census across all retained function ASTs (43 const
`UpdateMetric` calls, 0 non-const first arguments — no computed IDs):

| metric | calls | callers (all in `ActivateItem.json`) |
| --- | --- | --- |
| 30 DefensiveItemsUsed | 2 | type 10 (EscapeRope), type 13 (ComboCruncher), each +1 |
| 31 OffensiveItemsUsed | 3 | type 9 (ApexLure), type 11 (LootRush), type 12 (Bounty), each +1 |
| 35 EscapeRopesUsed | 1 | type 10 (EscapeRope) only, +1 |

Cross-checks: 8 = `ItemsUsed` (`ModularInventoryHotbar_Widget/UpdateItemUses`
calls `UpdateMetric(8, 1)` on every item use); 39 = `ComboCrunchersUsed`
(`UseComboCruncherItem.json`, 256 stmts, calls `UpdateMetric(39, 1)`);
34 = `LootRushesUsed` (one call, in the GlobalManager ubergraph);
37 = `SuccuSlayerSessionsWon` and 41 = `SessionsWonAtMaxDifficulty` match
the #50 EndSession trace. 27 = `BonerPillsUsed` has **zero** retained call
sites (the enum and the challenge contract reference it, but no retained
function increments it — the increment site is not retained, cf. #50
producers). The native `UpdateMetric` routine (`0x148318bb0.c`) is a 14-line
stub tail-calling `FUN_148318be0` and carries no dispatch.

**Counting implication, recorded, NOT changed here:** the player
(`economy.js` `itemUsed`) increments `DefensiveItemsUsed` for every
Defensive type and `OffensiveItemsUsed` for every Offensive type, but the
retained evidence increments 30 only for types 10/13 and 31 only for types
9/11/12. Established as over-counting for types 1, 3 (their effect callees
`UseReduceHeatItem`, `UseSlowdownItem` are retained and call neither) and
type 5 (its callee `UseBonerPill` is retained and calls neither). Residual
gap for types 4 (non-Playlist), 6, 7: their effect callees (`Use Break
Item`, `ToggleSuccuShields`, `TabbedInventoryResupplyTrigger`) are **not
retained**, so a 30 increment inside one of them cannot be ruled out from
the ASTs alone. No counting code was changed in this slice; correcting the
classification counters is a follow-up slice once those three callees are
checked (or the pattern is confirmed another way). Note the challenge
contract references `OffensiveItemsUsed` once and `DefensiveItemsUsed`
never, so the practical effect today is limited to the Offensive counter.

**Side observation, NOT changed (out of scope, needs Kevin's decision):**
the non-Playlist Break branch (`ActivateItem` stmts 72-75) contains no
`ApplyAllOrNothingModifierEffects_IfToggled` call, while the Playlist branch
does (stmt 70). The player's `applyAllOrNothing` still applies to Break in
both modes; left untouched per the final-push scope.

## 3. Types 1/3/6/7 hook correction — established, fixed

`RollPunishmentChance` (`BP_GlobalManager/RollPunishmentChance.json`):
rate = `(TotalTauntsUsed / 5, integer division) * 20%`, rolled via
"Roll Chance (0-100%)", returns `WasPunishmentTriggered`; it also prints
"Risk of Punishment: {float}". `TotalTauntsUsed` is
`PlayerVariablesStruct.LegacyStats.TotalTauntsUsed`.

The hotbar ubergraph
(`ModularInventoryHotbar_Widget/ExecuteUbergraph_ModularInventoryHotbar_Widget.json`,
260 stmts, validated 54/54 by `tools/hotbar_ubergraph_offsets.py`) contains
exactly **five** `RollPunishmentChance` sites, all verified by reading the
flows (entries resolved with the hotbar offset model):

| stmt | flow | shape |
| --- | --- | --- |
| 32 | Edge button (entry 512 → 25) | roll after `ActivateItem(2)`; trigger spawns punishment and `PopFlow`s — the edge is blocked |
| 99 | DecreaseHeat (entry 1303 → 48) | AoN (97) → `UpdateItemUses` (98) → roll → trigger: spawn (101) + `PopFlow` (102), widget effect (103+) skipped; miss: jump 3952 → 103 |
| 167 | Break tail | roll in the widget tail; trigger spawns (169) and ends; trigger does not block anim/heat-spell |
| 183 | Slowdown (entry 7113 → 164) | AoN (181) → `UpdateItemUses` (182) → roll → trigger: spawn (185); the `ActivateItem(3)` continuation still runs |
| 203 | IncreaseCumMeter / type 0 (entry 8192 → 200) | roll → trigger: jump 8197 → 201 (unconditional spawn + `PopFlow`); miss: jump 8298 → 206 (effect continues) |

**Types 6 and 7 have no roll site anywhere** — the five sites above are
exhaustive. The type-0 roll has no player counterpart (the player has no
CumChance item); the Edge roll lives in the edge system, not `items.js`,
and was not touched.

Type 1, verified in detail: the button flow (stmts 48-50) calls
`ActivateItem(1)`; `ActivateItem`'s type-1 branch calls `UseReduceHeatItem`
(stmt 40), whose widget flow is AoN → `UpdateItemUses` → roll (97-99). The
widget effect (stmts 103-155) is the heat reduction itself
(`Heat Level -= 15/25/35/45/60` by upgrade level, stmts 118/128/135/142/149),
the cum-meter add (`AddToCumMeter(DecreaseHeatCumMeterAddAmount)`, 103),
and the count decrement — all skipped on trigger. The charge was already
consumed by `UseItem` (`ActivateItem` stmt 38, before the widget call), and
`ActivateItem` continues after the widget call (`PlayUseItemAnim`,
`ApplyHeatSpellEffect`, `PlayUsedLastItemAnim`,
`DetermineShouldHotHandsModifierApply`, AoN at stmts 41-45). The old
player behaviour (+15 heat and `fail('Punishment triggered')`, charge kept)
had no retained counterpart — the evidence note already flagged the +15 as
having none, and the fail contradicts the use succeeding with the charge
consumed.

**Fix (`items.js` `use`):**

- Type 1: removed from the pre-effect fail hook. The roll now happens in
  the type-1 branch: on trigger, spawn punishment (if the hook exists) and
  skip the heat reduction and cum-meter add only; the use returns
  `{ok:true, consumed:true}`. On miss the full effect applies. No heat
  change on trigger (the punishment event changes no heat, §3 below).
- Type 3: removed from the fail hook. The roll happens pre-effect; on
  trigger it spawns punishment and the effect proceeds unchanged (beat
  interval, `canUseSlowdown=false`, cum-meter add, consume).
- Types 6/7: removed from the punishment hook and from the
  `Punishment prerequisite unavailable` guard entirely — they never roll,
  so a missing punishment hook must not fail their use.
- The AoN/`UpdateItemUses`-before-roll ordering is preserved
  observationally: the roll outcome depends only on taunts, and the shared
  tail still runs AoN + `consume()` (with `play.js` calling `itemUsed`
  after a consumed use), so no reorder of `use()` was needed.
- The `'Punishment triggered'` failure reason is gone from the code (it
  survives only in the older evidence note describing the pre-slice code).

Tests (`tests/fanservice_items.test.js`): the old scope pin
("DecreaseHeat punishment still pre-empts the effect", heat 65, charge
kept) is replaced by the faithful trigger test (heat unchanged at 50,
cum-meter untouched, charge consumed, one spawn with type 1) plus a miss
test (heat 35, cum-meter +0.01, no spawn), a Slowdown trigger test
(effect applies, one spawn with type 3), and a 6/7 no-roll test (the
punishment hook is never called for either type). The Break tests
(`d78cb78`) are untouched and still pass.

**Punishment event content (corrected attribution).**
`SpawnPunishmentEvent.json` calls `ExecuteUbergraph_BP_GlobalManager`
entry **77093 → stmt 1868** (not 1440): if `AutoBMToggledSuccubusEvent` is
off, jump to 60263 → stmt 1443; if `IsBrainMelterEnabled?` is off, jump to
77170 → stmt 1871 (`IsBrainMelterEnabled? = true`, then jump 60136 →
stmt 1440). The spawn flow (stmts 1440-1460) is: create/add-to-viewport the
Brain Melter toggle widget and `PlayBMToggleAnim(true)` (1440-1442, BM path
only), create/add-to-viewport a second widget (1443-1444), clear the idle
timer (1445), `SpawnCustomCardEvent(SuccubusCards, 30, 50, 0.28, 0.33,
byte(3), 1.0, Stroke Count Multiplier, ...)` (1446), random
`SuccubusBeatPattern` + `CheckIntervalMultipliers` +
`StartPatternWithMediaSync(..., 1.5)` (1447-1449),
`PlayerEdgedLastDraw? = false`, `IsSpecialEvent? = false`,
`CurrentCardTypeEnum = byte(3)` (1450-1452), `PlayAnimation(FastPaceAnim)`
(1453), `CanUseItems = false` (1454), `FindSpecialEventDialogueStructs(1)`
+ `Set Dialogue and Play Voiceline` (1455-1456), `Change Beat Background(8)`
(1457), notification "Punishment" / "Your boasts have consequences."
(1458), `PlayMusic(3)` (1459), `PopFlow` (1460). No heat change, no second
roll. This confirms the earlier "succubus card event" attribution and the
reason `play.js` punishment wiring stays unwired: the event is a custom
card event with fixed parameters (30-50 strokes, 0.28-0.33 interval,
`FastPaceAnim`, `CanUseItems=false`, dialogue struct 1, background 8,
music 3), not a plain `draw('succubus')` — mapping `spawnPunishment` onto
it would conflate it with ApexLure's `spawnSuccubus`.

## Still open (not in this slice)

- #48 `play.js` punishment wiring content (see §3 above) and the taunt-count
  input (`TimesTaunted` exists only as a tower metric, so the
  `(taunts/5)*20%` rate has no player input) — untouched.
- #48 All-or-Nothing scope for non-Playlist Break — see §2 side
  observation; needs Kevin's decision.
- #48 Defensive/Offensive `ItemsUsed` counting correction — see §2; needs
  the three non-retained callees checked first.
- #48 `DetermineShouldHotHandsModifierApply` internals (the player excludes
  type 1 from Hot Hands, but `ActivateItem` calls it for type 1 at stmt 44)
  — not investigated; the Hot Hands line was not touched.
- Type-0 (CumChance) punishment roll — no player item; nothing to wire.
- Edge punishment roll (hotbar stmt 32) — lives in the edge system, not
  `items.js`; not touched in this slice.
