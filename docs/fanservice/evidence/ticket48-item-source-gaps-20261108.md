# Ticket 48 item source findings

## Pinned source

The Blueprint extracts below are from `xxjuggernaut9113xx-design/reJOIce` at commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff` (`newer-20261017`). Git blob IDs identify the exact paths; the ActivateItem and All-or-Nothing SHA-256 values are from the retained AST fixture.

| Source | Pinned path | Source identity |
| --- | --- | --- |
| Item activation and branch order | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_CHGameInstance/ActivateItem.json` | SHA-256 `1eeee4af08e2b7fb1d924a2f44f285cbe0345cc2f0a64ab155f867e9bf07fb58` |
| Succubus shield eligibility | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/SuccubusEligibilityCheck.json` | Git blob `151f6f5820aa0668087e62e73e7691245f5580d4` |
| Succubus spawn event | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/SpawnSuccubus.json` | Git blob `7ebfec5c76bfbabc82416cfc34ff91d3644db6cc` |
| Succubus stroke modifier | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/CalculateSuccubusStrokeModifier.json` | Git blob `945ef7942a40d317ee439c6b646e0b72394a26b8` |
| Succubus pattern/count dispatch | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_DrawManager/SpawnCustomCardEvent.json` | Git blob `ff0ae8109168e7bb4692f4248536cea5615a8a18` |
| Session metric enum names | `Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json` | Git blob `4d3aa7cf09061465f9e8877c453948a241eade16` |
| All-or-Nothing effect body | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/ApplyAllOrNothingModifierEffects_IfToggled.json` | SHA-256 `1b88ec6f37fa3f801efa79222819b2f17055cd8a478bf4a057fa5c300035f392` |

The complete `BP_GlobalManager` graph was retained as a 2,570-statement AST with SHA-256 `1479c660d9b40c6af7f5513ea61ff9bebf040d70cbb1c656e3c75c35a7705351`.

## Confirmed behavior and remaining integration

- ActivateItem calls the All-or-Nothing effect after successful uses of item types 1, 3, 4, 6, 7, and 10. The effect always zeros coins, then resets progress conditionally by `CurrentSessionObjective`: objective 0 zeros CumMeterPercentage; objective 1 zeros SessionLength; objective 2 calls `ResetSessionMetric(0)`; objective 3 calls `ResetSessionMetric(1)`; objective 7 calls `ResetSessionMetric(36)`; objective 8 calls `ResetSessionMetric(2)`. Other objective values do not match a reset branch in this AST. The pinned tree does not contain the `ResetSessionMetric` implementation. The pinned reflection enum maps 0 to Strokes, 1 to Edges, 36 to MilkingCount, and 2 to SuccubiDefeated. The local hook resets the selected objective baseline instead of these source fields. `Run.player.sessionLength` is derived from elapsed gameplay time, so parity needs settlement offsets or equivalent accounting without rewinding the gameplay clock.
- Shield eligibility checks for SuccuShield charges and the inventory toggle. Enhanced Plating (modifier 14) uses `ShieldBlockCount` to hold one block; the later block consumes a charge, writes the updated item state, and updates metric 8. With no charges, the source clears the toggle. The current mobile flow has explicit encounter-card draws but no shared eligibility result or established fallback behavior for a blocked draw, so shield consumption is not wired into gameplay yet.
- The pinned `CalculateSuccubusStrokeModifier` AST adds the Apex level value to the existing modifier (it does not multiply the whole modifier). Its levels contribute +2, +1.5, +1, +0.5, and +0. `SpawnCustomCardEvent` multiplies the randomized stroke count by that modifier and truncates with `FTrunc` before queue creation. Mobile now passes the level bonus as an addend after its existing succubus modifiers and uses the unchanged count timing/truncation path. Same-seed tests cover all levels and a Hivemind + Infernal Clause + Double Devil combination. `tests/fanservice_apex_lure_smoke.cjs` compares the real hotbar result with a same-state cloned Run using the same random stream, and confirms it differs from the ordinary count. It seeds inventory through grant/upgrade/equip methods, verifies the actual Edge control blocks Apex use without consuming the charge, then checks one successful charge use and exact card-flow restoration after reload. The separate native `ApplyStrokeCountModifier(int)` label is not called in this Apex path. Apex-specific encounter presentation remains outside this integration.

The remaining gaps are shield encounter gating/consumption and source-faithful All-or-Nothing session metric settlement. No blocked-draw fallback was inferred. The retained C++ helpers are secondary reconstruction material, not original-source authority.

## Work status

Commit `9d422bf` contains the bounded item fixes and focused coverage completed earlier. The parent reported 232 passing tests after that commit. The Apex integration is an uncommitted follow-up with focused source-derived tests; Ticket 48 remains open for the shield and metric-settlement gaps.
