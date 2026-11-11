# #48 ActivateItem branch review against the shared player (static, 2026-11-10)

Source: `reJOIce` commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`, `Analysis/ReferenceBuilds/newer-20261017/functions/BP_CHGameInstance/ActivateItem.json` (SHA-256 `1eeee4af08e2b7fb1d924a2f44f285cbe0345cc2f0a64ab155f867e9bf07fb58`, matches the earlier #48 source note). This is a static reading of retained bytecode. No original game was run, and the shared player was not changed.

## Per-item success branches (statement indices of the 164-statement AST)

| Type | Success-branch effects after `UseItem` |
| --- | --- |
| 0 IncreaseCumMeter (26-37) | widget use, anim, `ApplyHeatSpellEffect`, `BreakCombo`, Hot Hands check, All-or-Nothing. Not in the shared `modes.json` catalog, so not playable here. |
| 1 DecreaseHeat | widget use, anim, `ApplyHeatSpellEffect`, Hot Hands check (`ItemType==1` is excluded inside it), All-or-Nothing |
| 3 Slowdown | same shape as type 1 |
| 4 Break, Playlist mode (`GameModeSelection==2`) | `StartRhythmModeBreak`, anim, used-last anim, Hot Hands check, All-or-Nothing. No `ApplyHeatSpellEffect`. |
| 4 Break, other modes (statements 72-75) | widget `Use Break Item`, anim, `ApplyHeatSpellEffect`, end. **No All-or-Nothing, no Hot Hands check, no used-last anim.** |
| 5 BonerPill | widget use, anim, used-last anim, Hot Hands check. No All-or-Nothing. |
| 6 SuccuShield | toggle, anim, `ApplyHeatSpellEffect`, used-last anim, Hot Hands check, All-or-Nothing |
| 7 Resupply | widget trigger, anim, `ApplyHeatSpellEffect`, `BreakCombo`, Hot Hands check, All-or-Nothing |
| 9 ApexLure | widget use, `UpdateMetric(31,1)`, anim, Hot Hands check |
| 10 EscapeRope | `UseEscapeRopeItem`, `UpdateMetric(35,1)`, `UpdateMetric(30,1)`, anim, `BreakCombo`, Hot Hands check, All-or-Nothing |
| 11 LootRush / 12 Bounty | effect call, `UpdateMetric(31,1)`, anim, Hot Hands check |
| 13 ComboCruncher | effect call, `UpdateMetric(30,1)`, anim, Hot Hands check |

Types 2 and 8 have no branch. All-or-Nothing is therefore reachable from 0, 1, 3, 4 (Playlist only), 6, 7 and 10.

## Candidate discrepancy (not applied)

`static/fanservice/items.js` applies All-or-Nothing to Break in every mode (`[1,3,4,6,7,10]`), and `economy.itemUsed` applies Hot Hands to every item except type 1, including Break in Classic and Tower. The AST above shows neither on the non-Playlist Break path. `tests/fanservice_item_interactions.test.js` already pins All-or-Nothing at statement 70, which is the Playlist branch, so the test fixture and implementation disagree about mode scope.

Why this is not changed yet:

- The non-Playlist path calls widget function `Use Break Item`, which is a stub that calls `ExecuteUbergraph_ModularInventoryHotbar_Widget(9717)`. That ubergraph contains four `ApplyAllOrNothingModifierEffects_IfToggled` calls (statements 97, 175, 181, 212), all in legacy slot-handler flows. Statement 258 is the final `RETURN`, and 9717 is consistent with that tail if the preceding jumps are five bytes each. The AST JSON has no per-statement byte offsets, so this is an inference.
- Resolve it by computing statement byte offsets for the hotbar ubergraph (the same method used for the GlobalManager map) and confirming 9717 lands on a statement with no All-or-Nothing or Hot Hands call. Then add a fixture-based test for non-Playlist Break and change `items.js` and `economy.itemUsed` together.

## Other items noticed, also unresolved

- Resupply: `ActivateItem` applies All-or-Nothing and the Hot Hands check at activation. The player applies All-or-Nothing at activation but runs `economy.itemUsed` (metrics, Hot Hands) when the store opens about two seconds later.
- `ApplyHeatSpellEffect` is called by the AST for types 0, 1, 3, 4 (non-Playlist), 6 and 7 only. `economy.itemUsed` applies Heat Spell to every Defensive item, including Escape Rope (type 10), which the AST branch does not call. `UseEscapeRopeItem` may apply it internally; unchecked.
- `UpdateMetric` ids 30, 31 and 35 are called only for some types; the player counts `ItemsUsed` for all. Names for 30, 31 and 35 were not resolved here.
