# #48: counting correction — types 4/6/7 increment metric 30, types 1/3/5 increment neither (2026-11-11)

Source build: **Cock Hero v0.05.1 Hotfix Public**, exe SHA-256
`a8f46896…040c10`, cooked packages unpacked with retoc v0.1.5
(`liboo2corelinux64.so.9` verified against retoc's pinned hash) and converted
with `retoc to-legacy --no-script-objects` (Paks-directory input).
Player change in this slice: `static/fanservice/economy.js` (`itemUsed`) +
`tests/fanservice_economy.test.js` (commit `a513b89`). Full suite after this
slice: Node **332 pass / 0 fail**, Python schema **12 pass**.
Mining tools (not in the repo): `~/workspace/rejoice-evidence/cockhero-itch/work/uasset.py`
(retoc legacy package reader), `kismet2.py` (Kismet bytecode parser),
`verify_um.py` (re-verification driver for the numbers below).

## 0. What was open

`ticket48-heat-spell-punishment-20261111.md` §2 (retained-AST caller census,
43 const `UpdateMetric` calls) established:

- metric 30 (`DefensiveItemsUsed`) only for types 10 (EscapeRope) and 13
  (ComboCruncher); metric 31 (`OffensiveItemsUsed`) only for types 9
  (ApexLure), 11 (LootRush), 12 (Bounty); metric 35 (`EscapeRopesUsed`)
  only type 10.
- The player's `economy.itemUsed` incremented 30 for every Defensive type
  and 31 for every Offensive type — over-counting for types 1, 3 (callees
  `UseReduceHeatItem` / `UseSlowdownItem` retained, call neither) and type 5
  (callee `UseBonerPill` retained, calls neither).
- Residual gap: types 4 (Break, non-Playlist), 6 (SuccuShield), 7
  (Resupply), whose callees were not retained in reJOIce.

This note closes that gap from the unpacked v0.05.1 cooked packages.

## 1. Where the callees live

Raw grep over the unpacked Zen `.uasset` files (26,987 files, 2.9 GB):

| callee | packages containing the name |
| --- | --- |
| `Use Break Item` | `CockHero/Content/Widgets/PG1TabbedInventory_Widget.uasset`, `CockHero/Content/Widgets/ModularInventoryHotbar_Widget.uasset`, `CockHero/Content/NewSetup/BP_CHGameInstance.uasset` |
| `ToggleSuccuShields` | `CockHero/Content/Widgets/PG2TabbedInventory_Widget.uasset`, `CockHero/Content/NewSetup/BP_CHGameInstance.uasset` |
| `TabbedInventoryResupplyTrigger` | `CockHero/Content/Widgets/PG2TabbedInventory_Widget.uasset`, `CockHero/Content/NewSetup/BP_CHGameInstance.uasset` |

`BP_CHGameInstance` only references the names (no target exports, 43 exports
total). The bodies live in the three widget packages, as 52-byte stub exports
that jump into each widget's `ExecuteUbergraph` (see §3).

## 2. Parser validation (triple-exact)

`kismet2.py` parses each widget's `ExecuteUbergraph` script token by token,
tracking both storage (on-disk) and iCode offsets. Key corrections vs the
first attempt, each verified against UAssetAPI source (atenfyr/UAssetAPI):

- `XFER_PROP_POINTER` in UE5 reads an **FFieldPath** (int32 count + count ×
  FName + FPackageIndex owner), not a bare int32.
- `EX_StructMemberContext` reads the property pointer **first**, then the
  struct expression.
- `EX_StringConst` is a null-terminated UTF-8 string with **no** length
  prefix; `EX_UnicodeStringConst` is null-terminated UTF-16.
- `EX_DoubleConst` = `0x37` (55); `EX_PrimitiveCast` (`0x38`) reads a 1-byte
  ECastToken then the target, with **no** ClassPtr.
- `EX_Context` = ObjectExpr + uint32 offset + FFieldPath + ContextExpr (no
  PropertyType byte in UE5); UE5 `EX_Let` has a leading Value property
  pointer.

Validation — each ubergraph runs to `EndOfScript` with
`max_icode + 1 == ScriptBytecodeSize` exactly:

| widget | ScriptBytecodeSize | storage bytes | statements |
| --- | --- | --- | --- |
| PG2TabbedInventory_Widget | 5715 | 7351 | 166 |
| PG1TabbedInventory_Widget | 7682 | 9730 | 199 |
| ModularInventoryHotbar_Widget | 9725 | 13149 | 259 |

This validates every token-size assumption. Ubergraph script starts
(export-data offsets): PG2 2809, PG1 2503, Hotbar 4018. ScriptBytecodeSize /
scriptStorageSize are the two int32s immediately before the script start.
Stub IntConsts are **iCode** offsets, not storage offsets (e.g. PG2's
ubergraph opens with `EX_PushExecutionFlow(5712)` + `EX_ComputedJump` — 5712
is 3 bytes before the iCode size 5715, not near the storage size 7351).

## 3. UpdateMetric calls found (all `UpdateMetric(metric, 1)`)

Call pattern: `EX_FinalFunction` (`0x1C`) + FPackageIndex of `UpdateMetric` +
`EX_ByteConst` (`0x24`) + metric id byte + `EX_IntConst` (`0x1D`) + amount
int32 + `EX_EndFunctionParms` (`0x16`).

| widget | UpdateMetric import | calls (iCode offset → metric) |
| --- | --- | --- |
| PG2TabbedInventory_Widget | −51 | 1627 → **30**, 3355 → **31**, 4710 → **30** |
| PG1TabbedInventory_Widget | −48 | 268 → **30**, 3281 → **30**, 3542 → **30**, 4724 → **30** |
| ModularInventoryHotbar_Widget | −61 | **none** |

(Storage offsets: PG2 2123/4203/6102; PG1 328/4149/4546/6088.)

Stub entries (52-byte exports; script at export offset 26, entry IntConst at
offset 32; all point at the widget's `ExecuteUbergraph`):

- PG2 (24 stubs): `Use Fap Fever Item` 15, SlowdownClick 453, CumChanceClick
  3243, hover handlers 3964/4012/4060/4108/4156/4204/4252/4300, `Construct`
  4442, EdgeClick 4599, BreakClick 5016, Break1Click 5021, `UseBonerPillItem`
  5080, `PlayUsedLastBonerPillItem` 5085, **`ToggleSuccuShields` 5133**,
  ShieldClick 5448, ShieldHover 5453/5501,
  **`TabbedInventoryResupplyTrigger` 5549**, `TriggerInventorySwitchAnimation`
  5554, `Use Apex Lure Item` 5602.
- PG1 (23 stubs): BreakClick 953, SlowdownClick 3303, DecreaseHeatClick 3916,
  EdgeClick 3959, CumChanceClick 4613, `Construct` 7062, hover handlers
  7067–7547, `UseCumChanceItem` 7606, `UseReduceHeatItem` 7611,
  `TabbedInventoryEdgeTrigger` 7616, `TriggerInventorySwitchAnimation` 7621,
  `UseSlowdownItem` 7669, **`Use Break Item` 7674**.
- Hotbar (23 stubs): `Construct` 215, EdgeClick 512, DecreaseHeatClick 1303,
  BreakClick 7108, SlowdownClick 7113, CumChanceClick 8192, hover handlers
  8973–9405, Break1Click 9547, `UseCumChanceItem` 9606, `UseReduceHeatItem`
  9611, `TabbedInventoryEdgeTrigger` 9616, `TriggerInventorySwitchAnimation`
  9621, `UseSlowdownItem` 9712, **`Use Break Item` 9717**.

(The `*Click` names above are the `BndEvt__…_OnButtonClickedEvent__DelegateSignature`
exports; the bare names are the named function stubs.)

## 4. Attribution — why "largest entry ≤ call" is wrong

The ubergraph does **not** lay function bodies out contiguously in entry
order — code blocks are shared across entries (e.g. PG2's "SlowdownClick"
range [453, 3243) contains Slowdown, SuccuShield-toggle **and** Break
animation calls). A naive BFS over-approximates (nearly every entry reaches
every UM call). The discriminating evidence is the short direct DFS trace
paths (both `JumpIfNot` branches, loop-protected) from each callee entry:

- PG1 `Use Break Item` (7674) → UM 268 (metric **30**) via
  `7674 → 953 → 991 → 1036 → 202 → 268` (single `JumpIfNot` at 991, a
  `StructMemberContext` usability check). **Break (type 4) increments 30.**
- PG2 `ToggleSuccuShields` (5133) → UM 1627 (metric **30**) via
  `5133 → 5178 → 5247 → 5290 → 5304 → 5349 → 2013 → 2042 → 2061 → 1141 → …
  → 1627` (`JumpIfNot` at 5349 → 2013 branch). **SuccuShield (type 6)
  increments 30.**
- PG2 `TabbedInventoryResupplyTrigger` (5549) → UM 4710 (metric **30**) via
  the direct path `5549 → 4599 → 4644 → 4710`. It also reaches UM 3355
  (metric 31) via a longer path through the CumChanceClick entry (3243) —
  the direct metric-30 path is the primary one; the metric-31 path is a
  different item's handler funneled through shared code. **Resupply (type 7)
  increments 30.**
- Hotbar `Use Break Item` (9717) → **no UM call** (12 nodes visited). The
  Hotbar use increments neither metric.

## 5. Settled mapping (implemented in commit `a513b89`)

| metric | types |
| --- | --- |
| 30 `DefensiveItemsUsed` | **4, 6, 7, 10, 13** |
| 31 `OffensiveItemsUsed` | **9, 11, 12** |
| neither 30 nor 31 | **1, 3, 5** |

Metric 8 (`ItemsUsed`) still increments on every item use
(`UpdateItemUses` calls `UpdateMetric(8, 1)`); specific metrics unchanged
(5→27 `BonerPillsUsed`, 10→35 `EscapeRopesUsed`, 11→34 `LootRushesUsed`,
13→39 `ComboCrunchersUsed`). The result is consistent with the items'
Defensive/Offensive classification in `static/fanservice/data/modes.json`
(Break, SuccuShield, Resupply are Defensive) and with the 10/13→30 pattern.

Player change (`static/fanservice/economy.js`, `itemUsed`): replaced the
classification-based line (`classification === 'Offensive' ? 31 : 30`) with
per-type sets (`[4,6,7,10,13] → 30; [9,11,12] → 31`). The `classification`
argument is now unused for the 30/31 decision (still part of the API). No
`play.js` / `items.js` change was needed: the wiring already routes 4/6/7 to
`economy.itemUsed` (type 4 via `result.consumed` in `play.js:595`; type 6 via
the `|| type === 6` special case there; type 7 via the direct
`hooks.itemUsed(type)` call in `items.js:60`, confirmed once-only by
`tests/fanservice_items.test.js:40`).

Test first (TDD): the economy test was updated before the fix — the Boner
Pill (type 5) assertion now asserts metric 31 is `undefined` (it previously
asserted 1, pinning the over-count) — and the pre-fix run failed as expected
(`1 !== undefined`), confirming the test reproduces the over-count. New
assertions cover types 4/6/7 (8 and 30, not 31) and types 1/3 (8 only).

## 6. Caveats

- The 4/6/7 traces go through `JumpIfNot` conditions and shared code blocks,
  so the attribution rests on the direct trace paths + Defensive
  classification, not on inline UM calls inside the callee bodies (the
  callees themselves contain no `UpdateMetric` call inline — the increments
  live in shared blocks they jump to).
- The Hotbar path increments nothing, so the metric increment is tied to the
  tabbed-inventory use path, not to every `Use Break Item` invocation.
- The metric-31 path reachable from `TabbedInventoryResupplyTrigger` via
  CumChanceClick (3243) is a different item's handler sharing code; it does
  not make Resupply increment 31.

## 7. What remains open on #48 after this slice

- The "Hot Hands Modifier" notification (presentation gap — see
  `ticket48-heat-spell-punishment-20261111.md`).
- `TauntCumAdd` value (UI_Manager CDO — not yet pinned; see §7 of the #44
  note / unpack work).
- Type-0 (CumChance) punishment roll — blocked, not wired: the player has no
  CumChance item/button/mechanic, and wiring it would require inventing them.
