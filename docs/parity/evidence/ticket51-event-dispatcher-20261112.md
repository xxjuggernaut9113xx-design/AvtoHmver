# #51 — The original special-event dispatcher — 2026-11-12

Work done on branch `spec/avtohmver-open-tickets` starting at HEAD
`85a486c` (local commits only). All decodes are from the cooked
v0.05.1 package (`BP_GlobalManager.uasset`,
`BP_DrawManager.uasset`) and reJOIce
(`~/workspace/reJOIce/Analysis/ReferenceBuilds/newer-20261017/`),
parsed with the repo tools (`tools/evidence/kismet2.py`,
`uasset.py`). This note settles the "non-media special-event
handlers / full original event dispatcher" gap that
`docs/parity/evidence/ticket51-acceptance-recheck-20261112.md` §4
left open under #51 — the dispatcher core (eligible set, gates,
weights, routing, handler skeletons) is now recovered; the widget
trigger paths are the remaining piece (see §6).

## 1. The draw pipeline

`DetermineCardV2` (BP_DrawManager, 73 stmts), stmts 63–67 — the
ordinary (non-edge, non-cum-override) draw path:

1. `CheckEventConditions&ReturnArray` → eligible rows, in
   data-table order.
2. `AdjustHeatLevelWeights` → per-row `BaseWeight = FClamp(BaseWeight
   + heatMod[band], 0, 100)`.
3. `AdjustComboLevelWeights` → per-row `BaseWeight =
   FClamp(BaseWeight + comboMod[tier], 0, 100)`.
4. `ChooseWeightedEventFromArray` → weighted pick over the
   `BaseWeight` sums.
5. `TriggerSelectedEvent` → route to the event function.

So the native weight is `clamp(clamp(base + heat) + combo, 0, 100)`
— exactly the player's `weightedEvents` formula
(`static/fanservice/media_selection.js`). `weightMultiplier` is NOT
used anywhere in the draw (it appears only in
`UpdateFastHeatMultipliers` / `UpdateSlowHeatMultipliers`, which
update the multiplier field itself); the Favorite Frenzy row's 0.0
multiplier does **not** zero its draw weight.

## 2. CheckEventConditions&ReturnArray — the eligible set

`BP_GlobalManager` export 60, **88 stmts, max_icode 2526, 0
errors**. Clears `EligibleSpecialEvents`, loops
`AllSpecialEventsArray` in data-table order, switches on the row's
event-code byte (`PopExecutionFlowIfNot` pops the case block when its
condition is false; a constant `True` means the case always appends):

| Code | Row | Append condition |
| ---: | --- | --- |
| 0 | SlowStrokeEvent | always |
| 1 | MediumStrokeEvent | always |
| 2 | FastStrokeEvent | always |
| 4 | TemptationEvent | `TemptationEligibilityCheck` |
| 5 | SuccubusEvent | `SuccubusEligibilityCheck` |
| 6 | MercyEvent | **never** (see below) |
| 7 | AssFrenzyEvent | `AssFrenzyEligibilityCheck` |
| 8 | BoobFrenzyEvent | `BoobFrenzyEligibilityCheck` |
| 11 | StoreEvent | `StoreEventCheck`; the appended row is the `AdjustStoreWeight` output, not the raw row |
| 12 | NewRow (FavoriteFrenzyEvent) | `FavoriteFrenzyEligibilityCheck` |
| 3, 9, 10 | CoinFlipEvent, FeetFrenzyEvent, BossSpawnEvent | **no switch case — never appended** |

### The Mercy quirk

Case 6 calls `MercyEligibilityCheck` and then
`PopExecutionFlowIfNot(EX_False)` — a **constant false** — so the
branch always pops before the append. The check runs (it prints
`"Mercy Event is Eligible."` / `"Mercy Event Ineligible, it's on
cooldown."`) but its result is discarded. **The Mercy row can never
be drawn.** Confirmed in both the cooked parse (stmt 62, ip 1718)
and the reJOIce AST. The player must NOT add Mercy to the draw.

## 3. The eligibility checks

All cooked-parsed with 0 errors; jump targets resolved from the
cooked offsets, not just the ASTs.

- **TemptationEligibilityCheck** (export 235, 13 stmts):
  eligible = `TotalDrawCount > 1` AND `!IsTemptationOnCooldown`
  AND `Heat Level <= 35.0`. Jump resolution: `@82` → stmt 4
  (False); `@117` → stmt 7 (heat check); `@185` → stmt 11 (False);
  `@93` → return.
- **MercyEligibilityCheck** (export 140, 10 stmts): eligible =
  `!IsMercyonCooldown?` (with the debug prints above). Its result is
  discarded by the caller (§2).
- **StoreEventCheck** (export 227, 19 stmts): `GameModeSelection ==
  0` (Classic) → `!IsStoreOnCooldown` AND `PlayerCoins >= 200`;
  `== 1` (Tower) → False; other modes → return with the out param
  unset (False). `GameModeSelection_ENUM`: 0 Classic, 1 Tower, 2
  Playlist (`decoded-blueprint-enums.json`). **The store event is
  Classic-only.**

## 4. AdjustStoreWeight

17 stmts (reJOIce AST):

```
adjusted BaseWeight = (BaseWeight + 1)
  * FClamp(StoreChanceMultiplier
    + FClamp(TimeSinceLastShop / 60.0 * 0.04, 0, 2)
    + floor(PlayerCoins / 250) * 0.08, 1, 5)
```

At CheckEventConditions time the row's `BaseWeight` is still the raw
table base (0.0 — heat/combo are applied later, §1), so the appended
store row's base is the multiplier itself, in [1, 5].
`Debug_LastStoreWeightOnEventCheck` records the row weight.
`TimeSinceLastShop` is incremented +1.0 per GM 1 s tick only when
NOT `IsStoreOnCooldown` (see
`ticket45-objective-clock-20261112.md`); no reset site for it was
found in the GM. `StoreChanceMultiplier` is modified by
`AddStoreChanceMultiplier` and reset by
`Reset_Store_Chance_Multiplier_Variables` — callers not traced in
this pass.

## 5. Weighted pick and trigger routing

- **ChooseWeightedEventFromArray** (DrawManager, 32 stmts):
  `AddWeightsFromSpecialEvents` sums `BaseWeight`;
  `RandomFloatInRange(0, TotalWeight)`; the first row whose
  cumulative sum exceeds the roll wins.
- **TriggerSelectedEvent** (DrawManager, 66 stmts): modifier
  overrides first — Succufrenzy → `SpawnSuccubus`; Slow and Steady
  → 1/3 Medium (`RandomIntegerInRange(0, 2) == 0`), 2/3 Slow; Double
  Time → 1/5 `SpawnSuccubus` (`RandomIntegerInRange(0, 4) == 0`),
  4/5 Fast. Then `K2_ClearAndInvalidateTimerHandle(IdleTimerHandle)`;
  switch on the row's event code: 0 Slow, 1 Medium, 2 Fast, 4
  TemptationEvent, 5 SpawnSuccubus, 6 MercyEvent, 7 AssFrenzyEvent, 8
  BoobFrenzyEvent, 11 SpawnStoreEvent, 12 FavoriteFrenzyEvent — each
  call prints its `"… Event Triggered"` debug string. (The player's
  `modifiers.js dispatchEvent` already maps these trigger codes.)

## 6. Handler skeletons (GM ubergraph)

`ExecuteUbergraph_BP_GlobalManager`, parsed from the cooked package:
**2569 stmts, max_icode 99920, 0 errors**. The three event
functions are stubs that jump into the ubergraph.

- **SpawnStoreEvent** (entry 65615):
  `ApplyVolumeScalar(0.5, SFXVolume)` →
  `SpawnSound2D(winner-bell-game-show-91932, vol, 1.0, 0.0)` →
  `BeatSpawnerManagerCPP.PauseSequence()` → `IsStoreOnCooldown =
  True` → `ClearAndInvalidateTimerHandle(IdleTimerHandle)` →
  `CreateWidget(StoreWidget_C, /Game/Widgets/StoreWidget)` +
  `AddToViewport(0)` → `CurrentCardTypeEnum = 4` →
  `BindDelegate(CompleteStoreCooldown)` →
  `K2_SetTimerDelegate(delegate, 180.0, False, 0.0, 0.0)` →
  `Change Beat Background(1)`. **The store cooldown is 180 s.**
- **CompleteStoreCooldown** (entry 66628): `IsStoreOnCooldown =
  False` → `CreateNotificationBox(...)`.
- **TemptationEvent** (entry 87348 → 87022):
  `BeatSpawnerManagerCPP.PauseSequence()` → `IsTemptationOnCooldown
  = True` → `bStopSequence = True` →
  `ClearAndInvalidateTimerHandle(IdleTimerHandle)` →
  `CreateWidget(TemptationEventWidget_C,
  /Game/Widgets/EventSpawns/TemptationEventWidget)` +
  `AddToViewport(0)` → `ActiveDecisionWidget = widget` →
  `CurrentCardTypeEnum = 4` → `PrintString('Temptation Event
  Triggered')` → Jump @57716.
- **CompleteTemptationCooldown** (entry 87343 → 87331):
  `IsTemptationOnCooldown = False`.
- **MercyEvent** (entry 88491 → 87822): `PauseSequence` →
  `bStopSequence = True` → clear idle timer → `CreateWidget` (mercy
  widget) + `AddToViewport` → `ActiveDecisionWidget` →
  `CurrentCardTypeEnum = 5` → `PrintString` → `Change Beat
  Background` → Jump @87771. `MercyCooldownCompleted` (entry 88444 →
  88412): `IsMercyonCooldown? = False`. A separate region sets `Heat
  Level = 0.0` (ip 88454) and `IsMercyonCooldown? = True` (ip 88296).
  The mercy flow shares the break setup at 87353 (`Set Break
  Duration from Item State` → `CreateWidget` → `AddToViewport` →
  `BreakCombo`).

### Exact missing piece: the temptation cooldown duration

`IsTemptationOnCooldown` is set True only in `TemptationEvent` and
False only in `CompleteTemptationCooldown`; **no GM timer calls the
latter** — the timer lives in `TemptationEventWidget` (its
accept/decline buttons), whose package
(`/Game/Widgets/EventSpawns/TemptationEventWidget`) is **not in the
legacy cooked tree** (only 6 widget packages are present:
`AllowedToCumOverlayLoop_Widget`,
`PG1/PG2TabbedInventory_Widget`, `ModularInventoryHotbar_Widget`)
and not in reJOIce. The same holds for `StoreWidget`. The widget
accept/decline effects and the temptation cooldown duration are
therefore **not recoverable from any evidence in this VM**. A native
runtime run, or the missing widget packages, would be needed.

## 7. Implementation map

- `static/fanservice/media_selection.js`: new
  `eligibleSpecialEvents(rows, state)` mirroring
  `CheckEventConditions&ReturnArray` — native data-table order, the
  §3 gates, the §4 store weight adjustment, Mercy never appended,
  no-case codes never appended. `state.totalDraws` is the native
  `TotalDrawCount` at check time (already incremented for this draw).
  Caller-supplied gates cover the checks this module cannot see
  (Succubus / frenzy / favorite eligibility); cooldown and shop
  counters default to the native initial state (not on cooldown,
  zero).
- `static/fanservice/play.js` `automaticMediaPool()`: the eligible
  set now comes from `eligibleSpecialEvents`, then the existing
  deck-availability filter. Temptation (4) and Store (11) have no
  media pool, so the deck filter drops them — their native trigger
  paths spawn widgets instead of drawing a media card, and those
  widget flows are not modeled yet (§6). `totalDraws` is passed as
  draws-so-far + 1: the native increments `TotalDrawCount` before
  the check, the player increments it in `Economy.draw` after the
  selection. Behavior for all media rows is unchanged.
- Tests (test-first; red confirmed — `eligibleSpecialEvents is not a
  function` before implementation): 6 appended to
  `tests/fanservice_media_selection.test.js` (native order + always/
  never sets; Mercy-never quirk; Temptation gate boundaries
  draws/heat/cooldown; Store Classic-only + coins + cooldown; store
  weight adjustment cases incl. clamps and no mutation of the source
  row; eligible store row feeding the weighted pick end-to-end).
- Full suite after implementation: Node 424 pass / 0 fail (baseline
  418 + 6 new), Python schema 12 pass.
