# #48 ActivateItem branch review against the shared player (static, 2026-11-10)

Source: `reJOIce` commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`, `Analysis/ReferenceBuilds/newer-20261017/functions/BP_CHGameInstance/ActivateItem.json` (SHA-256 `1eeee4af08e2b7fb1d924a2f44f285cbe0345cc2f0a64ab155f867e9bf07fb58`, matches the earlier #48 source note). This is a static reading of retained bytecode. No original game was run, and the shared player was not changed.

## Per-item success branches (statement indices of the 164-statement AST)

| Type | Success-branch effects after `UseItem` |
| --- | --- |
| 0 IncreaseCumMeter (26-37) | widget use, anim, `ApplyHeatSpellEffect`, `BreakCombo`, Hot Hands check, All-or-Nothing. Not in the shared `modes.json` catalog, so not playable here. |
| 1 DecreaseHeat | widget use, anim, `ApplyHeatSpellEffect`, Hot Hands check (`ItemType==1` is excluded inside it), All-or-Nothing |
| 3 Slowdown | same shape as type 1 |
| 4 Break, Playlist mode (`GameModeSelection==2`) | `StartRhythmModeBreak`, anim, used-last anim, Hot Hands check, All-or-Nothing. No `ApplyHeatSpellEffect`. |
| 4 Break, other modes (statements 72-75) | widget `Use Break Item`, anim, `ApplyHeatSpellEffect`, end. **No Hot Hands check and no used-last anim in `ActivateItem`.** The widget path applies All-or-Nothing conditionally; see the resolution section below. |
| 5 BonerPill | widget use, anim, used-last anim, Hot Hands check. No All-or-Nothing. |
| 6 SuccuShield | toggle, anim, `ApplyHeatSpellEffect`, used-last anim, Hot Hands check, All-or-Nothing |
| 7 Resupply | widget trigger, anim, `ApplyHeatSpellEffect`, `BreakCombo`, Hot Hands check, All-or-Nothing |
| 9 ApexLure | widget use, `UpdateMetric(31,1)`, anim, Hot Hands check |
| 10 EscapeRope | `UseEscapeRopeItem`, `UpdateMetric(35,1)`, `UpdateMetric(30,1)`, anim, `BreakCombo`, Hot Hands check, All-or-Nothing |
| 11 LootRush / 12 Bounty | effect call, `UpdateMetric(31,1)`, anim, Hot Hands check |
| 13 ComboCruncher | effect call, `UpdateMetric(30,1)`, anim, Hot Hands check |

Types 2 and 8 have no branch. All-or-Nothing is reachable from 0, 1, 3, 4 (Playlist branch directly; other modes through the widget path below), 6, 7 and 10.

## Candidate discrepancy (not applied)

`static/fanservice/items.js` applies All-or-Nothing to Break in every mode (`[1,3,4,6,7,10]`), and `economy.itemUsed` applies Hot Hands to every item except type 1, including Break in Classic and Tower. The AST above shows neither on the non-Playlist Break path. `tests/fanservice_item_interactions.test.js` already pins All-or-Nothing at statement 70, which is the Playlist branch, so the test fixture and implementation disagree about mode scope.

Why this is not changed yet:

- The non-Playlist path calls widget function `Use Break Item`, which is a stub that calls `ExecuteUbergraph_ModularInventoryHotbar_Widget(9717)`. That ubergraph contains four `ApplyAllOrNothingModifierEffects_IfToggled` calls (statements 97, 175, 181, 212), all in legacy slot-handler flows. Statement 258 is the final `RETURN`, and 9717 is consistent with that tail if the preceding jumps are five bytes each. The AST JSON has no per-statement byte offsets, so this is an inference.
- Resolve it by computing statement byte offsets for the hotbar ubergraph (the same method used for the GlobalManager map) and confirming 9717 lands on a statement with no All-or-Nothing or Hot Hands call. Then add a fixture-based test for non-Playlist Break and change `items.js` and `economy.itemUsed` together.

## Other items noticed, also unresolved

- Resupply: `ActivateItem` applies All-or-Nothing and the Hot Hands check at activation. The player applies All-or-Nothing at activation but runs `economy.itemUsed` (metrics, Hot Hands) when the store opens about two seconds later.
- `ApplyHeatSpellEffect` is called by the AST for types 0, 1, 3, 4 (non-Playlist), 6 and 7 only. `economy.itemUsed` applies Heat Spell to every Defensive item, including Escape Rope (type 10), which the AST branch does not call. `UseEscapeRopeItem` may apply it internally; unchecked.
- `UpdateMetric` ids 30, 31 and 35 are called only for some types; the player counts `ItemsUsed` for all. Names for 30, 31 and 35 were not resolved here.

## Resolution of the widget `Use Break Item` path (static, same day, supersedes the inference above)

Method: `tools/hotbar_ubergraph_offsets.py` computes statement byte offsets for the retained `ExecuteUbergraph_ModularInventoryHotbar_Widget` AST (260 statements, 9725 bytes). Internal consistency checks all pass: 54 of 54 jump/push targets land on statement starts and 111 of 111 `EX_Context` `Offset` fields equal the computed context size. This is not a comparison with the engine's own serialized offsets.

- Entry 9717 is statement 257, an `EX_Jump` to offset 7261 (statement 171). The earlier inference that 9717 lands near a plain return tail was wrong.
- From there: `PlaySpecialEventDialogue(12)`; exit if `LegacyStats.CanUseItems?` is false; exit if `PlayerItemCounts.BreakAvailable <= 0`; `ApplyAllOrNothingModifierEffects_IfToggled`; `UpdateItemUses`; then `RollPunishmentChance` and, on success, `SpawnPunishmentEvent`.
- So non-Playlist Break does apply All-or-Nothing, but only when items are usable and `BreakAvailable` is above zero at that point. The player applies it unconditionally, so it may differ on the last Break charge. The `BreakAvailable` question is answered in the next section. The player's All-or-Nothing scope is unchanged.
- The widget tail also rolls a punishment. Whether this duplicates the player's pre-effect punishment hook for Break is resolved in the section below ("Resolution of the duplicate-punishment-roll question", 2026-11-11): it does not duplicate it.
- Hot Hands: `DetermineShouldHotHandsModifierApply` is called only from `ActivateItem`, with item types 0, 1, 3, 4, 5, 6, 7, 9, 10, 11, 12 and 13. The type 4 call is on the Playlist branch (statement 69). Neither statements 72-75 nor the widget tail call it. `economy.itemUsed` now applies Hot Hands to Break only in Playlist mode (mode 2).

## What `PlayerItemCounts.BreakAvailable` is (static, same day)

- Retained writers of `PlayerItemCounts.BreakAvailable` (searched by member name across all retained function ASTs): only `RollAndGiveLootDrops` (statement 38) and `RollAndGiveLootDropsV2` (statements 70-71), both increments. In V2, when `BreakAvailable >= MaxBreakItemCount` the roll awards 50 coins instead (statements 65-69). No retained function decrements it.
- `UseItem` removes charges through the `OwnedItems` map (`.Charges`), not `PlayerItemCounts`. The widget's `UpdateItemUses` only calls `UpdateMetric(8, 1)`. `GiveEdge` and `GetEdgeAvailableText` use the same struct for Edge counts.
- Reading: the check in the widget's Break tail tests a legacy loot-grant tally that use does not reduce, so it does not mean "a Break charge remains". Statically, All-or-Nothing on non-Playlist Break would apply only after at least one Break was awarded through those loot functions (and `CanUseItems?` is true), including when the Break came from the store instead.
- Not established: whether those two loot functions are the live loot path in the selected build, whether any non-function graph (event graphs, struct defaults) writes the member, and whether the tail runs in practice. The player's `economy.loot` follows the V2 source name but grants through inventory charges and does not model this tally, so no player change was made. Deciding whether to model the tally needs original-run evidence of a store-bought Break in Classic with All-or-Nothing active.

## Resolution of the duplicate-punishment-roll question (static, 2026-11-11)

Short answer: **no duplication.** The original rolls punishment exactly once per non-Playlist Break use, after the effect path's All-or-Nothing and `UpdateItemUses`, and a trigger spawns the punishment event without failing the use. The player's pre-effect hook (when wired) is a different roll: before the effect, trigger fails the use. In live play the player's hook never fires at all — `play.js` never sets `punishmentEnabled` and never provides `hooks.punishment` — so the live player rolls 0 times for every type.

### The roll itself

`RollPunishmentChance` (`BP_GlobalManager`, 24 statements): chance percent = `(TotalTauntsUsed / 5, integer division) * 20`, as a double (stmts 16-18); `Roll Chance (0-100%)` with that value (stmt 19); returns `WasPunishmentTriggered` (stmts 20-21). So 0-4 taunts is 0%, 5-9 is 20%, 10-14 is 40%, and so on. It also debug-prints `Risk of Punishment: {float}` (stmts 5-15). There is no boolean "punishment enabled" gate in the original: the roll always runs in the widget flows below, and the chance is 0% below 5 taunts. `TotalTauntsUsed` is incremented in the GlobalManager ubergraph (stmts 2091-2093, +1); the UI_Manager ubergraph carries the matching notification "Tempting Fate" / "Your taunts drew her ire. Items may trigger punishment."

### Every punishment roll in the retained ASTs

The only caller of `RollPunishmentChance` and the only caller of `SpawnPunishmentEvent` in all retained functions is `ExecuteUbergraph_ModularInventoryHotbar_Widget` (260 statements). `ActivateItem`, `UseItem`, and every other retained function roll no punishment. Entry offsets below were resolved with `tools/hotbar_ubergraph_offsets.py` plus the entry values in the widget's `BndEvt__*` click handlers and `Use*Item` functions.

| Site | Flow (entry) | Order | On trigger |
| --- | --- | --- | --- |
| Stmt 32 | Edge trigger: EdgeItemButton click entry 512 (stmt 25); also `TabbedInventoryEdgeTrigger` entry 9616 (stmt 251 -> 194 -> 30) | After `ActivateItem(2)`; if `CurrentCardTypeEnum==5` and `EdgeAvailable>0`: roll | `SpawnPunishmentEvent` (34), then Pop: `TriggerEdgeV2` is skipped |
| Stmt 99 | DecreaseHeat / type 1: `UseReduceHeatItem` entry 9611 (stmt 250 -> 245 -> 156-159 -> 97) | `ApplyAllOrNothing` (97), `UpdateItemUses` (98), roll (99) — before the heat effect (103+) | `SpawnPunishmentEvent` (101), Pop (102): heat effect skipped |
| Stmt 167 | Break tail / type 4 non-Playlist: `Use_Break_Item` entry 9717 (stmt 257 -> 171-177 -> 167) | `PlaySpecialEventDialogue(12)` (171), gates `CanUseItems?` / `BreakAvailable>0` (172-174), AoN (175), `UpdateItemUses` (176), roll (167) | `SpawnPunishmentEvent` (169), Pop (170); `ActivateItem` then continues to anim (73) and `ApplyHeatSpellEffect` (74) — the use is NOT failed |
| Stmt 183 | Slowdown / type 3: `UseSlowdownItem` entry 9712 (stmt 256 -> 254 -> 191-193 -> 178-182) | Dialogue (254), gates (191-193, 178-180), AoN (181), `UpdateItemUses` (182), roll (183) | `SpawnPunishmentEvent` (185), Pop (186); miss also pops (184). Either way the widget returns and `ActivateItem` continues (anim, heat spell, used-last anim, Hot Hands, AoN, stmts 52-56) — the roll cannot block the effect |
| Stmt 203 | IncreaseCumMeter / type 0: `UseCumChanceItem` entry 9606 (stmt 249 -> 221 -> 210-217 -> 203) | Gates (221, 210), AoN (212), `TotalDefenseItemUses+1` (213-215), `UpdateItemUses` (216), roll (203) — before the cum effect (51+ branches) | `SpawnPunishmentEvent` (201), Pop (202): cum effect skipped |

Types 6 (SuccuShield) and 7 (Resupply): **zero rolls** in retained evidence. Their `ActivateItem` branches call `ToggleSuccuShields` (stmt 89) and `TabbedInventoryResupplyTrigger` (stmt 100), neither of which is the hotbar ubergraph, and no retained function calls `RollPunishmentChance` for them. (The PG2 tabbed-inventory widget ubergraph is not retained; this is a within-retained-ASTs statement.) Playlist Break (`ActivateItem` stmts 62-71, `StartRhythmModeBreak`) never reaches the widget tail: **zero rolls**.

### What the punishment event does

`SpawnPunishmentEvent` calls `ExecuteUbergraph_BP_GlobalManager(77093)`. Attributed by the unique "Punishment" string to the flow at GlobalManager ubergraph stmts 1440-1460: create/add-to-viewport, clear idle timer, `SpawnCustomCardEvent` (SuccubusCards, 30, 50...), `Array_Random` SuccubusBeatPatterns, `CheckIntervalMultipliers`, `StartPatternWithMediaSync`, `CurrentCardTypeEnum=3`, `FastPaceAnim`, `FindSpecialEventDialogueStructs(1)`, `Set Dialogue and Play Voiceline`, `Change Beat Background(8)`, notification "Punishment" / "Your boasts have consequences.", `PlayMusic(3)`. No heat change and no second roll. Caveat: byte-offset confirmation of entry 77093 against stmt 1440 was not computed — the offset model for the GlobalManager ubergraph would need `EX_SetArray` / `EX_TextConst` / `EX_VectorConst` / delegate sizes; the attribution rests on the unique string plus the sole caller path.

### The player side

`static/fanservice/items.js` lines 34-35 (before this slice): pre-effect hook for types `[1,3,4,6,7]` when `context.punishmentEnabled`; on trigger, +15 heat for type 1 and `fail('Punishment triggered')` — the effect never happens and the charge is not consumed. The hook arrived wholesale in import commit `5fb3437` ("Add original v0.05 music pack export bridge"), with no evidence citation. `play.js` `itemContext()` returns no `punishmentEnabled` and `itemDependencies()` provides no `punishment` hook; nothing in `run.js` or `economy.js` mentions punishment; no punishment tests existed; the COMBINED spec has no punishment section. So in live play the hook is dead code: 0 rolls for all types. The type-1 +15 heat on trigger has no retained counterpart — the original just skips the heat reduction.

### Fix applied in this slice (Break only)

`static/fanservice/items.js`: type 4 removed from the two pre-effect hook lines (now `[1,3,6,7]`); a post-effect roll was added after `applyAllOrNothing()` + `consume()` in the shared tail, gated to `type===4 && context.mode!==2 && context.punishmentEnabled && hooks.punishment` exists; on trigger it calls the new optional `hooks.spawnPunishment(type, state)` seam (mirrors `SpawnPunishmentEvent`) and the use still returns `{ok:true, consumed:true}`. Playlist (mode 2) never rolls. `play.js` is not wired: no taunt state and no established spawn-event mapping (see open items), so live behavior is unchanged — the fix corrects the seam for a future wiring.

Tests (5 new in `tests/fanservice_items.test.js`, red-first — 3 failed before the fix, all pass after): Break roll-after-effect with spawn call and order `['break','roll']`; Break roll miss still applies the effect and spawns nothing; Playlist Break never rolls; Break without a punishment hook still applies the effect; DecreaseHeat pre-effect behavior pinned unchanged (scope pin).

### Per-type faithful shapes, recorded for a future slice

- Type 0: roll after AoN/`UpdateItemUses`, before the widget effect; trigger skips the widget effect only.
- Type 1: same shape as type 0.
- Type 3: roll after AoN/`UpdateItemUses`, before the `ActivateItem` continuation; trigger does NOT block the continuation.
- Type 4 non-Playlist: roll after AoN/`UpdateItemUses` in the widget tail; trigger does NOT block anim/heat-spell. Type 4 Playlist: no roll.
- Types 6/7: no roll.
- Edge trigger: roll after `ActivateItem(2)`, before `TriggerEdgeV2`; trigger blocks the edge.

### Still open (exact missing pieces for a complete faithful punishment implementation)

1. `play.js` wiring: a `punishmentEnabled` source and a `hooks.punishment` implementation driven by a taunt count — the player tracks no taunt count for items (`TimesTaunted` exists only as a tower metric), so the `(taunts/5)*20%` rate has no player input.
2. `hooks.spawnPunishment` content in `play.js`: the original event is a succubus card event with fast pace + dialogue + notification + music (GlobalManager stmts 1440-1460); mapping it onto a player draw/spawn call (e.g. `draw('succubus')`) would conflate it with ApexLure's `spawnSuccubus` — not established, so left unwired.
3. Types 1/3/6/7 hook correction: type 1's faithful shape needs AoN/`UpdateItemUses` before the roll and the roll before the effect (a reorder of `use()`, not minimal); type 3's trigger must not fail the use; types 6/7 have no original roll at all. Separate slice; not guessed here.
4. GlobalManager ubergraph byte-offset confirmation of entry 77093 -> stmt 1440 (offset model for that file not built).
