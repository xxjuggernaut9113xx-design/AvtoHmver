# Ticket 48 item source findings

## Pinned source

The Blueprint extracts below are from `xxjuggernaut9113xx-design/reJOIce` at commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff` (`newer-20261017`). Git blob IDs identify the exact paths; the ActivateItem and All-or-Nothing SHA-256 values are from the retained AST fixture.

| Source | Pinned path | Source identity |
| --- | --- | --- |
| Item activation and branch order | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_CHGameInstance/ActivateItem.json` | SHA-256 `1eeee4af08e2b7fb1d924a2f44f285cbe0345cc2f0a64ab155f867e9bf07fb58` |
| Succubus shield eligibility | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/SuccubusEligibilityCheck.json` | Git blob `151f6f5820aa0668087e62e73e7691245f5580d4` |
| Succubus spawn event | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/SpawnSuccubus.json` | Git blob `7ebfec5c76bfbabc82416cfc34ff91d3644db6cc` |
| Succubus stroke modifier | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/CalculateSuccubusStrokeModifier.json` | Git blob `945ef7942a40d317ee439c6b646e0b72394a26b8` |
| All-or-Nothing effect body | `Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/ApplyAllOrNothingModifierEffects_IfToggled.json` | SHA-256 `1b88ec6f37fa3f801efa79222819b2f17055cd8a478bf4a057fa5c300035f392` |

The complete `BP_GlobalManager` graph was retained as a 2,570-statement AST with SHA-256 `1479c660d9b40c6af7f5513ea61ff9bebf040d70cbb1c656e3c75c35a7705351`.

## Confirmed behavior and remaining integration

- ActivateItem calls the All-or-Nothing effect after successful uses of item types 1, 3, 4, 6, 7, and 10. The effect always zeros coins, then resets progress conditionally by `CurrentSessionObjective`: objective 0 zeros CumMeterPercentage; objective 1 zeros SessionLength; objective 2 calls `ResetSessionMetric(0)`; objective 3 calls `ResetSessionMetric(1)`; objective 7 calls `ResetSessionMetric(36)`; objective 8 calls `ResetSessionMetric(2)`. Other objective values do not match a reset branch in this AST. The pinned tree does not contain the `ResetSessionMetric` implementation, so the affected named metrics remain unknown. The local hook resets the selected objective baseline instead of these source fields. `Run.player.sessionLength` is derived from elapsed gameplay time, so parity needs settlement offsets or equivalent accounting without rewinding the gameplay clock.
- Shield eligibility checks for SuccuShield charges and the inventory toggle. Enhanced Plating (modifier 14) uses `ShieldBlockCount` to hold one block; the later block consumes a charge, writes the updated item state, and updates metric 8. With no charges, the source clears the toggle. The current mobile flow has explicit encounter-card draws but no shared eligibility result or established fallback behavior for a blocked draw, so shield consumption is not wired into gameplay yet.
- The Apex path sets `IsApexSuccubus`, calls `CalculateSuccubusStrokeModifier`, then passes its returned value as a double parameter to `SpawnCustomCardEvent` with the Succubus card pattern and timing inputs. It also selects Apex-specific encounter presentation. The separate native `ApplyStrokeCountModifier(int)` PDB label is not called in this Apex path. The recovered runtime reconstruction (`RecoveredNewerItemRuntime.cpp`, SHA-256 `06d9673188a2034d8f2d3cbb0a1417b5414c8d95ef266666b7605968dd640a2a`) applies a level-derived multiplier, but it is not the pinned Blueprint or original runtime. The `SpawnCustomCardEvent` count conversion and exact mobile queue equivalent remain unverified, so Apex stroke scaling is not implemented.

These gaps are intentionally left open; no fallback, metric mapping, or fractional rounding rule was inferred. The retained C++ helpers are secondary reconstruction material, not original-source authority.

## Work status

Commit `9d422bf` contains the bounded item fixes and focused coverage completed earlier. The parent reported 232 passing tests after that commit. This evidence note does not claim that Ticket 48 acceptance criteria are complete.
