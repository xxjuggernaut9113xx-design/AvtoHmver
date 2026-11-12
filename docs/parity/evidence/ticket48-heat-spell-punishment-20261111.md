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

**Side observation — decided from the evidence and fixed (2026-11-11):**
the non-Playlist Break branch (`ActivateItem` stmts 72-75) contains no
`ApplyAllOrNothingModifierEffects_IfToggled` call, while the Playlist branch
does (stmt 70). The player's `applyAllOrNothing` used to apply to Break in
both modes; it now applies to Break only in Playlist mode (mode 2) — see
the All-or-Nothing follow-up at the end of this note. Kevin directed
(2026-11-11) that this scope be decided from the evidence rather than
waiting on him, and the evidence is unambiguous: the two branches differ
only in the modifier calls, and the same branch split already governs
Hot Hands and Heat Spell for Break in the player.

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
| 32 | Edge button (entry 512 → 25) | roll after `ActivateItem(2)`; trigger spawns punishment and `PopFlow`s — the edge is blocked. **Wired in this slice** (see follow-up below): `play.js` `triggerEdge()` rolls when the current card is an edge card (byte 5) and blocks the edge on trigger. |
| 99 | DecreaseHeat (entry 1303 → 48) | AoN (97) → `UpdateItemUses` (98) → roll → trigger: spawn (101) + `PopFlow` (102), widget effect (103+) skipped; miss: jump 3952 → 103 |
| 167 | Break tail | roll in the widget tail; trigger spawns (169) and ends; trigger does not block anim/heat-spell |
| 183 | Slowdown (entry 7113 → 164) | AoN (181) → `UpdateItemUses` (182) → roll → trigger: spawn (185); the `ActivateItem(3)` continuation still runs |
| 203 | IncreaseCumMeter / type 0 (entry 8192 → 200) | roll → trigger: jump 8197 → 201 (unconditional spawn + `PopFlow`); miss: jump 8298 → 206 (effect continues) |

**Types 6 and 7 have no roll site anywhere** — the five sites above are
exhaustive. The type-0 roll has no player counterpart (the player has no
CumChance item); see the type-0 survey in the follow-up at the end of this
note — it is recorded as blocked, not wired. The Edge roll is wired in
`play.js` `triggerEdge()` (see the same follow-up).

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
  `(taunts/5)*20%` rate has no player input) — the spawn is wired (e5fb511)
  and the taunt-count input is wired (edec337, 6f27747); the Edge roll is
  wired in this follow-up; the type-0 roll is blocked (no player
  counterpart), see below.
- #48 All-or-Nothing scope for non-Playlist Break — **decided and
  implemented** (see the All-or-Nothing follow-up at the end of this note):
  Break gets All-or-Nothing only in Playlist mode.
- #48 Defensive/Offensive `ItemsUsed` counting correction — see §2; needs
  the three non-retained callees checked first.
- #48 `DetermineShouldHotHandsModifierApply` internals — surveyed in this
  follow-up: fully determinable from the retained ASTs, and the player's
  existing check already matches them exactly (no correction); the
  notification is the only unmodeled piece, shared with Heat Spell.
- Type-0 (CumChance) punishment roll — no player item; blocked, see below.
- Edge punishment roll (hotbar stmt 32) — wired in this follow-up.

## Follow-up: enum file pinned by test; v004 native slice confirms Blueprint bodies are not native (2026-11-11)

### UpdateMetric names — pinned by test, with the file citation
The §2 resolution is now pinned in the repo, not just recorded here:
`static/fanservice/economy.js` exports `metricIds`
(`{8:'ItemsUsed', 27:'BonerPillsUsed', 30:'DefensiveItemsUsed',
31:'OffensiveItemsUsed', 34:'LootRushesUsed', 35:'EscapeRopesUsed',
39:'ComboCrunchersUsed'}`), and
`tests/fanservice_economy.test.js` ("item-use counters use the native
EMetricType names for ordinals 30/31/35") asserts the 30/31/35 entries and
drives `economy.itemUsed` for types 10/13/5/11/9/12, asserting the counters
incremented are exactly the resolved names. Correction to the §2 framing:
the names were found in
`Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json`,
whose `EMetricType` has **47** values — verified directly (entries 30/31/35
read back as `DefensiveItemsUsed`/`OffensiveItemsUsed`/`EscapeRopesUsed`
with matching `value` fields). The reason they looked unresolved earlier is
the older `Analysis/native-reflection-enums.json`, whose `EMetricType` has
only **30** values (0–29, last `CameDuringTaunt`), so 30/31/35 are absent
there. Both files were re-read to confirm this; the newer file is the
authority for ordinals ≥ 30.

### reJOIce materials-v004: Blueprint functions are not in the native PDB
The v004 release assets at `~/workspace/rejoice-evidence/materials-v004/`
were checked: `completed-native-slice-v004.zip` (Ghidra project, extracted
to `slice/`) and `shipping-native-v004.zip` (v004 shipping `CockHero.exe`
259 MB + `CockHero.pdb` 310 MB, extracted to
`shipping/CockHero/Binaries/Win64/`). The repo's PDB-scan approach (adapted
copy at `work/sym_scan.py`) was run against the v004 PDB: its public-symbol
stream (43 hits) has **zero** symbols for `StartFromBeatmap`,
`UseEscapeRope`, `Favorite`, `RollFavorites`, `AllowedtoCum`, or
`CumButtonFlash` — those are Blueprint functions, not native C++ exports,
so their bodies are **not** in the exe. Present as native exports:
`UpdateMetric` (2 hits, incl. `UpdateMetricWithConditions`) and
`RecordSessionMetric` (1 hit) on `UProgressionManager` — consistent with
the #50 trace (the native routines exist; the in-session producer call
bodies are Blueprint/not retained). Consequence for the blocked items:
- #51 (offset): the blocker is unchanged — `StartFromBeatmap` /
  `StartFromBeatmapWithMediaSync` bodies are not in the native slice and
  were never going to be; they live in the cooked Blueprint packages.
- #44 favorites: unchanged — no retained caller for
  `AddFavoriteCardToArray` in the retained ASTs, and the PDB confirms the
  favorites functions are not native exports either.
- #44 loops/overlay (widget animations, CumButtonFlash loops): unchanged —
  no widget animation data in the retained ASTs, and the PDB has no
  `CumButtonFlash` symbol; the animations live in the cooked packages.
- Do **not** install Ghidra/Java for the slice project unless the cooked
  packages fail to answer a question — the slice is native-only and will
  not contain Blueprint bodies.

### Cooked packages — now present, not yet read
`original-cooked-packages-v004.zip` (863 MB) is downloaded and extracted to
`cooked/CockHero/Content/Paks/` (IoStore format:
`CockHero-Windows.pak` 19 MB + `CockHero-Windows.ucas` 801 MB +
`CockHero-Windows.utoc` 2.4 MB, plus `global.ucas`/`global.utoc`). The
packages have **not** been unpacked or parsed, so no new Blueprint
conclusion is drawn from them here. They are the named next evidence source
for #51's `StartFromBeatmap` bodies and #44's widget animations — both stay
blocked until the relevant Blueprint function/animation data is read out of
them. Note the build difference: the cooked packages are v004, while the
reference-build ASTs/enums used elsewhere in this note are
newer-20261017 — any evidence taken from v004 needs its build
correspondence stated, as was done for the card-rules hash.

## Follow-up: taunt counting traced and implemented; play.js Taunt button wired (2026-11-11)

### Taunt trace (reJOIce newer-20261017, UI_Manager + GM ubergraphs, offset model)

Correction to the slice brief: taunts are a **player action** (a Taunt
button), not succubus taunt events. The punishment roll's input
`TotalTauntsUsed` (`PlayerVariablesStruct.LegacyStats.TotalTauntsUsed`)
is incremented only by the player pressing Taunt.

UI_Manager TauntButton click handler (entry 21921 -> stmt 609, resolved
with the offset model; `tools/gm_ubergraph_offsets.py` now also handles
`EX_InterfaceContext` — UI_Manager validates 705 stmts / 25010 bytes / 0
unaligned targets, GM unchanged 2570 stmts / 299/299). Guards in order:
CurrentCardTypeEnum == 6 (cum) -> "Cannot Taunt" / "Cannot taunt during
cum events."; == 5 (edge) -> "Cannot Taunt" / "Cannot taunt during edging
events."; `IsTauntOnCooldown?` -> "Taunt on Cooldown" / "Try again in
{seconds} seconds." (FTrunc of remaining duration); `HasTaunted?` ->
"Already Taunted" / "Wait until the next task to taunt."; then
PlayAnimation(TauntButtonKeyPress). Then: card == 3 (succubus) ->
"Succubus Taunt!" / "Succubi Spawn Chance Permanently Increased. " +
`AddPermanentSuccubusWeight()` -> falls through to `Taunt()`; else if
`HasSuccuModifier(15)` (Firemouth) -> "Firemouth Taunt!" / "Your Trash
Talk has Summoned a Succubus!" + `Firemouth Taunt()` -> StartTauntCooldown
-> AddToCumMeter(TauntCumAdd) -> Tempting Fate check; else normal ->
"Taunt!" / "Increased Stroke Speed & Count" -> `Taunt()` ->
StartTauntCooldown -> AddToCumMeter(TauntCumAdd) -> if TotalTauntsUsed ==
5 -> "Tempting Fate" / "Your taunts drew her ire. Items may trigger
punishment." Tooltip: "Taunt" / "Draws a tougher challenge."

GM `Taunt()` (entry 86586 -> stmt 2144 -> Jump 86220 -> stmt 2130
`UpdateMetric(7,1)` -> Jump 85713 -> stmt 2114): IsTauntOnCooldown?=true;
HasTaunted?=true if not set; if card == 3 -> `ApplyStrokeCountModifier(4)`
+ `ApplySpeedModifier(5.0)` then PopFlow (nothing else); else clear
IdleTimer, `AddHeat(TauntHeatAddAmount = 25.0, false)`, GetDataTableRow
"HighHeat" -> `SpawnCustomCardEvent(FastCards, HighHeat.MinStrokeCount,
HighHeat.MaxStrokeCount, 0.18, 0.23, byte(2), 0.5, Stroke Count
Multiplier, SlateBrush, StrokeInterval)`, then Array_Random
(FrenzyBeatPatterns) -> CheckIntervalMultipliers ->
StartPatternWithMediaSync(..., 1.0, 0, Beat Travel Time), print "Taunt
Event", TotalTauntsUsed += 1, CurrentCardTypeEnum = 2 (fast),
CardManager.CheckAndReplaceEmptyDecks(),
FindSpecialEventDialogueStructs(1) + voiceline, Change Beat
Background(8).

GM `Firemouth_Taunt()` (entry 85708 -> stmt 2113 -> stmt 2111
`UpdateMetric(7,1)` -> stmt 2100): IsTauntOnCooldown?=true;
HasTaunted?=true if not set; if card == 3 -> modifiers only, PopFlow;
else clear IdleTimer, AddHeat(50.0, false), SpawnSuccubus(false).
Firemouth does NOT increment TotalTauntsUsed.

Cooldown: StartTauntCooldown (entry 86419 -> stmt 2136 -> Jump 86286 ->
stmt 2132): print "Taunt Cooldown Started.", IsTauntOnCooldown?=true,
TauntCooldownTimerDuration = 5.0, K2_SetTimerDelegate(TauntCooldown,
interval 1.0s, looping=true). TauntCooldown (entry 86424 -> stmt 2137):
each 1s tick, if duration <= 0 -> IsTauntOnCooldown?=false + clear timer,
else duration -= 1.0. Class defaults: TauntHeatAddAmount = 25.0,
TauntCooldownTimerDuration = 5.0.

`HasTaunted?` reset: `DetermineCardV2` stmt 15 sets HasTaunted?=false
when !HasCame? — i.e. on each new card determination unless the player
has already came. No `HasTaunted? = false` write exists anywhere else in
the retained ASTs.

Two counters, distinct: `EMetricType::TimesTaunted` (7) is incremented by
BOTH taunt paths (GM stmts 2130 and 2111 — verified: exactly two
`UpdateMetric(7,1)` calls in the GM ubergraph) and is the challenge metric
(native contract: TimesTaunted >= 3 and >= 50) and the tower-history
input. `TotalTauntsUsed` (LegacyStats) is incremented by normal taunts
only and is the `RollPunishmentChance` input. They must be tracked
separately in the player.

### Implemented (commits d7f34af, edec337, 6f27747, 8065ed4)

- `static/fanservice/taunts.js` (`FanserviceTaunts`: cooldownSeconds=5,
  heatAdd=25, firemouthHeatAdd=50, temptingFateAt=5, spawnParams
  {pool:'fast', cardType:2, minInterval:0.18, maxInterval:0.23,
  background:'tauntbackground'}, guard(), taunt(), isFiremouth(),
  cooldownRemaining()). `run.js` loads it, state init gains
  TimesTaunted:0, TotalTauntsUsed:0, hasTaunted:false,
  tauntCooldownUntil:0, `startCard()` resets hasTaunted for ordinary
  draws only (not edge/cum/taunt/punishment, not after `player.hasCame`),
  new `run.taunt()` method. `cards.js` loads Taunts; fast cards with
  `options.taunt===true` roll interval [0.18,0.23] (HighHeat 20-30 strokes
  already matched the fast branch); cardFlow stamped `taunt:true`.
  `tests/fanservice_taunts.test.js` (9 tests, TDD red-first). Note: the
  traced [0.18,0.23] roll lands below the player's existing 0.28 interval
  floor in `timing()`, so the delivered interval is exactly 0.28 at seed
  137 (pinned by test); the assigned count is the HighHeat 20-30 roll
  times the tier-0 count multiplier (0.8), so 16-24 at tier 0.
- `play.js` Taunt button (next to Edge, hidden outside active card play
  and in Soundtrack mode, where the taunt's card spawn has no
  counterpart) with `triggerTaunt()`: media availability first, then
  `run.taunt()`, then the branch media, the tauntbackground switch on the
  normal branch only, and the traced notification strings. `play.html`
  loads `taunts.js` (after `economy.js` — the first placement before it
  broke the browser load, because the top-level `load()` runs at script
  evaluation and `FanserviceEconomy` was not defined yet; the failure
  surfaced as status "Cannot read properties of undefined (reading
  'has')").
- Correction to the previous slice's wiring: the punishment hook read
  `s.TimesTaunted`, the EMetricType challenge metric. The roll reads
  `TotalTauntsUsed` — Firemouth taunts increment the metric but not the
  count — so the hook now reads `s.TotalTauntsUsed`, and the items-test
  stubs and punishment smoke use that field.
- `tests/fanservice_taunt_smoke.cjs` (new, Chromium 1248): Start, click
  Taunt, fast card 2 with taunt stamp, interval in [0.28, 0.322],
  assigned the HighHeat roll times the live combo multiplier, heat +25,
  TimesTaunted 1, TotalTauntsUsed 1, background 'taunt', status
  'Taunt!'; second click -> 'Taunt on Cooldown'; fast-forward 5s + new
  card -> taunt allowed again (counters 2). Also fixes a pre-existing
  flake in the punishment smoke found while re-running it: the
  assigned-count assertion assumed a 1.0 combo multiplier, but assigned
  is the 30-50 roll times the combo count multiplier (0.8 at tier 0), so
  a 27 could fail it. Both smokes now capture the live multiplier and
  assert the scaled range; each passes 3/3 runs. Tower and Challenges
  smokes still pass.

### Still not modeled (taunt)

- TauntCumAdd value (field exists in UI_Manager; no default in
  `blueprint-class-defaults.json` — the UI_Manager CDO lives in the
  cooked packages).
- `ApplyStrokeCountModifier(4)` / `ApplySpeedModifier(5.0)` semantics
  (native BeatSpawnerManagerCPP, no retained body — add-vs-set-vs-multiply
  unknown); the player applies the traced heat/spawn instead.
- `AddPermanentSuccubusWeight` (no player counterpart).
- Dialogue-struct-1 voiceline lines (cooked data tables).
- SpawnCustomCardEvent 7th parameter (0.5 taunt / 1.0 punishment —
  parameter names not retained in `SpawnCustomCardEvent.json`).
- T-key shortcut (InpActEvt_T entry 8529 -> UI stmt 236, a widget-create
  flow, NOT established as the taunt handler — no T shortcut implemented).

## Follow-up: Edge punishment roll wired; type-0 roll blocked; Hot Hands internals surveyed (2026-11-11)

### Edge roll (hotbar stmt 32) — wired in `play.js` `triggerEdge()`

Full flow re-read from the hotbar ubergraph (offsets resolved with
`tools/hotbar_ubergraph_offsets.py`, 260 stmts / 9725 bytes, 54/54 targets
aligned): entry 512 → stmt 25 `CheckForRhythmMode()` → stmt 26
`ActivateItem(2)` → stmt 27 `PopExecutionFlow` → stmt 28
`CurrentCardTypeEnum == 5` (JumpIfNot → 810 = stmt 36, flow ends) → stmt 30
`PlayerItemCounts.EdgeAvailable > 0` (JumpIfNot → 810, flow ends) → stmt 32
`RollPunishmentChance()` → stmt 33 JumpIfNot → 941 = stmt 39 (miss) →
stmt 34 `SpawnPunishmentEvent()` → stmt 35 `PopFlow` (trigger: the edge is
blocked). On a miss the flow continues at stmt 39-40 to
`TriggerEdgeV2()` — the edge starts.

Two corrections to the earlier framing of this site:

- **`ActivateItem(2)` is a no-op.** The `ActivateItem` switch compares
  against `[0, 1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13]` — types 2 and 8 have
  no case, so a call with 2 falls through all comparisons to stmt 25
  (`EX_Jump` → 4193, the end). The Edge button's `ActivateItem(2)` call
  therefore does nothing; the roll is the button's own behaviour, not
  something that happens "after an item use".
- **`EdgeAvailable` is a loot-granted count.** `BP_EdgeManager/GiveEdge`
  does `EdgeAvailable += 1` plus the `ReceiveEdgeItem` animation; the
  count is read in `RollAndGiveLootDrops(V2)` and in the hotbar
  `GetEdgeAvailableText`. The player has no such inventory — edges are
  always available when `FanserviceEdge.allowed(run)` — so `allowed()` is
  the availability gate in the wiring, and the missing count is recorded
  here rather than invented.

Wiring (`play.js` `triggerEdge()`, after the `allowed()` check): if the
current card is an edge card (`run.state.card === 5`) and the roll
triggers, call the existing `spawnPunishment()` (reused, not rebuilt) and
return without `run.edge()`; otherwise proceed exactly as before. The
direct edge (any other card) has no roll site — it is the session
widget's E direct action, not the hotbar button — so the `card === 5`
gate is the faithful boundary. The roll reads `TotalTauntsUsed`, the same
input as the item sites.

**Rate-0 gate (found live).** The roll is skipped when
`FanservicePunishment.rate(taunts)` is 0 (fewer than 5 taunts): the
outcome is predetermined, and `roll()` draws `random.fraction()` even at
a 0% rate, which perturbs the shared random stream. The edge smoke
caught it: with the unconditional draw it failed 1 of 2 repeats at the
Mercy deadline window (`deadline - seconds` in `(59.9, 60]`), while the
baseline passed; with the gate it passes 3/3. The items.js sites still
draw unconditionally at 0% (pre-existing, tested behaviour — not changed
here).

Tests: new `tests/fanservice_edge_punishment_smoke.cjs` (Chromium 1248,
TDD red-first — the trigger case failed with card 5 instead of 3 before
the fix), 4/4 runs: guard case (direct edge at 100% rate starts an edge,
no punishment), trigger case (edge card at 100% rate spawns the
punishment with the traced parameters — card 3, succubus pool, punishment
stamp, interval [0.28, 0.33], assigned [30, 50] × live count multiplier,
items locked, "Punishment" status, taunt background — and the edge does
not record, phase stays `sequence`), miss case (edge card at 0% rate
records the edge, no punishment). The punishment smoke and the edge
smoke also pass (edge smoke 3/3 with the gate).

### Type-0 roll (hotbar stmt 203) — blocked, no player counterpart

Full flow traced (same offset model): the IncreaseCumChance button, entry
8192 → stmt 200 (Jump → 8140 = stmt 196) `ActivateItem(0)` →
`UseCumChanceItem` (a thunk to hotbar entry 9606 → stmt 249 → 221/222) →
stmt 210 `IncreaseCumChanceAvailable > 0` → stmt 212
`ApplyAllOrNothingModifierEffects_IfToggled` → stmts 213-215
`TotalDefenseItemUses += 1` → stmt 216 `UpdateItemUses` → stmt 217
(Jump → 8234 = stmt 203) `RollPunishmentChance()` → stmt 204 JumpIfNot →
8298 = stmt 206 (miss: `LastDefensiveItemUsageTime = SessionLength`,
`Slot1KeyPress` animation at 208, then the shared widget tail at stmt 51)
→ stmt 205 Jump → 8197 = stmt 201 `SpawnPunishmentEvent()` → stmt 202
`PopFlow` (trigger: the button effect is blocked).

The player has no CumChance item (type 0), no IncreaseCumChance button,
no `IncreaseCumChanceAvailable` count, and no cum-chance mechanic of any
kind (zero references in `static/fanservice/` or `tests/`). Wiring the
roll would require inventing the button, the item, and the mechanic, so
this site is recorded as blocked, not wired. Exact missing pieces: a
player counterpart for the IncreaseCumChance button/action, and the
`UseCumChanceItem` effect beyond the roll (its body is only the hotbar
entry above; the shared widget tail after stmt 209 jumps to stmt 51,
whose tier switch is on `IncreaseCumChanceUpgradeLevel`).

#### Re-verification (2026-11-12) — prior finding holds, no faithful mechanic

Re-checked from the primary sources rather than the note above:

- `RollPunishmentChance` re-read (`functions/BP_GlobalManager/
  RollPunishmentChance.json`): rate is `(TotalTauntsUsed / 5, integer
  division) * 20` percent, from
  `PlayerVariablesStruct.LegacyStats.TotalTauntsUsed`, rolled via "Roll
  Chance (0-100%)". The roll itself is fully understood; only its
  trigger is missing.
- `UseCumChanceItem` re-read (`functions/ModularInventoryHotbar_Widget/
  UseCumChanceItem.json`): 3 statements, a pure thunk to hotbar entry
  9606 — no effect body of its own. There is no "increase cum chance"
  effect to wire the roll to; the miss-path effect lives in the shared
  widget tail's tier switch on `IncreaseCumChanceUpgradeLevel`, whose
  per-tier effects are not decoded.
- The game's own item data (`static/fanservice/data/modes.json`, 11
  items) contains **no CumChance item**; the player's type map
  (`items.js`: 1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13) covers exactly
  those 11. Type 0 cannot appear in the catalog, so no item use can
  carry the roll.
- The player has no "cum chance" variable or mechanic at all: the cum
  meter fills deterministically from strokes/edges/objectives, and
  climax is decided by the trigger/window logic, never by a chance roll.
  Nothing exists for a CumChance effect to increase.
- The roll cannot be re-homed onto an existing action: the other four
  roll sites are each tied to their own action (Edge button, DecreaseHeat,
  Slowdown, Break tail — all wired). Attaching this roll to e.g. taunt
  use would invent a punishment trigger the original does not have.

Conclusion: the type-0 roll stays blocked. The four wired sites cover
every punishment roll the player has an action for; the fifth site has
no action, no item, and no mechanic in the player. Do not wire it
without a decoded `IncreaseCumChance` effect and a player counterpart
for the button — both are missing, and inventing either is out of scope.

### `DetermineShouldHotHandsModifierApply` internals — surveyed, no correction

The function is fully retained
(`functions/BP_CHGameInstance/DetermineShouldHotHandsModifierApply.json`,
8 statements, legible in full):

1. `IsModifierActive?("Hot Hands")` — if not active, return (nothing
   happens).
2. `ItemType == 1` — if true, return (no heat, no notification). The
   type-1 exclusion lives INSIDE this function.
3. Otherwise: `CreateNotificationBox("Hot Hands Modifier", "Item usage
   adds heat.\r\n+10% Heat Added", ...)` then `AddHeat(10.0, true)`.

`AddHeat` is also fully retained
(`functions/BP_GlobalManager/AddHeat.json`): `MaxHeat` is 100, or 75
when `HasSuccuModifier(0)` (Pot Lid); the second parameter is
`IgnoreHeatMultiplier?`, and Hot Hands passes `true`, so the +10 is raw
— no difficulty multiplier, no Lube halving (modifier 2) — clamped to
`MaxHeat`.

The player's existing line (`economy.js` `itemUsed`) already matches
all of this exactly: `type !== 1` excluded, Break excluded outside
Playlist mode (the original calls Hot Hands for Break only on the
Playlist branch, `ActivateItem` stmt 69; the non-Playlist branch,
stmts 72-75, has no call), `+10` clamped at `heatCap` (75 with Pot Lid,
100 otherwise), no Lube/difficulty scaling. The existing tests already
pin it (`tests/fanservice_economy.test.js`: types 3/5/6/7/9/10/11/12/13
+10, type 1 none, Break Playlist-only; `tests/fanservice_item_interactions.test.js`:
Break Hot Hands belongs to the Playlist branch). **No code change was
made for Hot Hands.**

The one unmodeled piece is the notification: the original shows "Hot
Hands Modifier" / "Item usage adds heat.\r\n+10% Heat Added" on every
qualifying use, and the player shows no modifier notification for any
item use (no "Hot Hands" or "Heat Spell" string anywhere in
`static/fanservice/` outside `economy.js`/`modifiers.js`). Adding it
would need a notification channel through `itemUsed` for both modifiers
alike; that is a presentation gap, not a Hot Hands correction, and it is
recorded here rather than implemented.

## Follow-up: All-or-Nothing scope for Break decided from the evidence — Playlist only (2026-11-11)

**Decision.** All-or-Nothing applies to Break only in Playlist mode
(mode 2), not in Classic or Tower. Kevin directed on 2026-11-11 that this
be decided from the evidence (he has everything he needs and wants only
the final patch, no more questions) instead of waiting on his earlier
parked decision — and the evidence decides it on its own.

**Evidence.** `ActivateItem` has two Break branches, split on the same
`IsRhythmMode?` test that splits Hot Hands and Heat Spell:

- Playlist branch (stmts 62-71): `StartRhythmModeBreak` (66),
  `DetermineShouldHotHandsModifierApply` (69),
  `ApplyAllOrNothingModifierEffects_IfToggled` (70).
- Non-Playlist branch (stmts 72-75): `Use Break Item` (72),
  `PlayUseItemAnim` (73), `ApplyHeatSpellEffect` (74), `EX_Jump` (75) —
  no All-or-Nothing call, no Hot Hands call.

The retained call sites for All-or-Nothing are exactly [45, 56, 70, 94,
106, 129] (types 1, 3, 4-Playlist, 6, 7, 10); no other type's branch
calls it (types 5, 9, 11, 12, 13 have a Hot Hands call but no
All-or-Nothing call). The three Break modifiers are now symmetric in the
player with their branch: Heat Spell non-Playlist only (stmt 74), Hot
Hands Playlist only (stmt 69), All-or-Nothing Playlist only (stmt 70).
The alternative reading — All-or-Nothing applying to Break in all modes
— would require the non-Playlist branch to call it, and it does not.

**Change.** One line in `items.js` `applyAllOrNothing`: type 4 is now
gated on `context.mode === 2`; the other types in the set are unchanged.
`play.js` `itemContext()` already passes `mode: run.config.mode`
(0 Classic, 1 Tower, 2 Playlist), so no plumbing was needed. The change
is small and reversible (revert the one condition).

**Tests (TDD red-first).** `tests/fanservice_item_interactions.test.js`
gained two tests: a fixture-level pin mirroring the Hot Hands test
("retained ActivateItem applies All or Nothing to Break only on the
Playlist branch" — AoN call 70 between `StartRhythmModeBreak` (66) and
`Use Break Item` (72), and stmts 72-75 contain no AoN call), and a
behaviour test ("All or Nothing applies to Break only in Playlist mode"
— Break in modes 0 and 1 keeps coins and the +0.01 cum-meter add; Break
in mode 2 zeroes coins and the cum meter). The red run failed exactly on
"Break in mode 0 must not wipe coins: 0 !== 75". The pre-existing
mode-less AoN loop test dropped type 4 (Break is now covered by the
mode test, not that loop). Full suite 310/310; Python schema 12 pass;
punishment and edge-punishment smokes pass.
