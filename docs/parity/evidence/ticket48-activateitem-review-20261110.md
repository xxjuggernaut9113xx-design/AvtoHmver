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
- So non-Playlist Break does apply All-or-Nothing, but only when items are usable and `BreakAvailable` is above zero at that point. The player applies it unconditionally, so it may differ on the last Break charge. Unresolved: whether `PlayerItemCounts.BreakAvailable` is already decremented when this check runs (by name, only `RollAndGiveLootDrops` and `RollAndGiveLootDropsV2` write it; `UseItem` updates `.Charges`). The player's All-or-Nothing scope is therefore unchanged.
- The widget tail also rolls a punishment. Whether this duplicates the player's pre-effect punishment hook for Break is unresolved.
- Hot Hands: `DetermineShouldHotHandsModifierApply` is called only from `ActivateItem`, with item types 0, 1, 3, 4, 5, 6, 7, 9, 10, 11, 12 and 13. The type 4 call is on the Playlist branch (statement 69). Neither statements 72-75 nor the widget tail call it. `economy.itemUsed` now applies Hot Hands to Break only in Playlist mode (mode 2).
