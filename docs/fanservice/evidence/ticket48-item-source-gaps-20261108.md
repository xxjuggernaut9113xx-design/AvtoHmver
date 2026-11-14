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

## Original findings (2026-11-08; some status claims superseded below)

- ActivateItem calls the All-or-Nothing effect after successful uses of item types 1, 3, 4, 6, 7, and 10. The effect always zeros coins, then resets progress conditionally by `CurrentSessionObjective`: objective 0 zeros CumMeterPercentage; objective 1 zeros SessionLength; objective 2 calls `ResetSessionMetric(0)`; objective 3 calls `ResetSessionMetric(1)`; objective 7 calls `ResetSessionMetric(36)`; objective 8 calls `ResetSessionMetric(2)`. Other objective values do not match a reset branch in this AST. The pinned tree did not contain the native helper; its implementation was subsequently decoded in the v0.05.1 native analysis linked below. The local hook uses effective-stat offsets rather than zeroing raw run counters.
- Shield eligibility checks for SuccuShield charges and the inventory toggle. Enhanced Plating (modifier 14) uses `ShieldBlockCount` to hold one block; the later block consumes a charge, writes the updated item state, and updates metric 8. With no charges, the source clears the toggle. At the time of this note the shared spawn gate was not wired; current wiring and automatic-draw evidence are recorded below.
- The pinned `CalculateSuccubusStrokeModifier` AST adds the Apex level value to the existing modifier (it does not multiply the whole modifier). Its levels contribute +2, +1.5, +1, +0.5, and +0. `SpawnCustomCardEvent` multiplies the randomized stroke count by that modifier and truncates with `FTrunc` before queue creation. Mobile now passes the level bonus as an addend after its existing succubus modifiers and uses the unchanged count timing/truncation path. Same-seed tests cover all levels and a Hivemind + Infernal Clause + Double Devil combination. `tests/fanservice_apex_lure_smoke.cjs` compares the real hotbar result with a same-state cloned Run using the same random stream, and confirms it differs from the ordinary count. It seeds inventory through grant/upgrade/equip methods, verifies the actual Edge control blocks Apex use without consuming the charge, then checks one successful charge use and exact card-flow restoration after reload. The separate native `ApplyStrokeCountModifier(int)` label is not called in this Apex path. Apex-specific encounter presentation remains outside this integration.

The remaining gaps listed here were based on the then-retained Blueprint AST and are superseded by the evidence below. No blocked-draw fallback was inferred. The retained C++ helpers are secondary reconstruction material, not original-source authority.

## Superseding evidence and acceptance audit (2026-11-14)

### ResetSessionMetric is resolved by native research

The earlier note that the `ResetSessionMetric` implementation was unavailable is stale. The v0.05.1 native analysis in [`ticket50-producers-native-20261111.md`](../../parity/evidence/ticket50-producers-native-20261111.md) §4 and §7 item 3 decodes `ResetSessionMetric` (`0x14830a2a0`) and its setter (`0x148311f70`). The function sets the selected writable `FSessionStats` metric to zero, then refreshes in-progress challenge progress with the new value and broadcasts a challenge-progress update. The metric table pins the All-or-Nothing objectives: Strokes=0, Edges=1, SuccubiDefeated=2, and MilkingCount=36. The other explicit branches set CumMeterPercentage=0 and SessionLength=0.

The player represents these resets with `state.metricResetOffsets`: the raw run counters remain monotonic, while `effectiveStats()` subtracts the saved offset and returns zero for the selected session metric. The objective baseline is reset at the same time. This gives the relevant HUD, objective, and settlement consumers the same zeroed value while preserving the absolute gameplay clock and counters. `tests/fanservice_session_metrics.test.js` checks every source-mapped objective, unrelated metric preservation, post-reset progress, checkpoint serialization, and settlement. `tests/fanservice_item_reset_smoke.cjs` exercises Timer and Strokes through the real item control, including repeated use, reload, and resumed play.

The remaining implementation difference is internal and narrowly defined: raw counters are retained behind offsets, and challenge-progress refresh is deferred to the player's settlement path instead of broadcasting immediately at item use. Ticket #48 requires original-derived effects and persisted resulting state, but does not require raw internal counters to be zeroed or an immediate challenge-progress notification. The current projection and persistence assertions cover those stated acceptance requirements.

### Playable hotbar coverage

The six-flow hotbar acceptance run in `tests/fanservice_items_hotbar_acceptance.cjs` covers Slowdown (3), Break (4), Boner Pill (5), Escape Rope (10), Bounty (12), and Combo Cruncher (13), including source effects, rejected-use charge retention, and checkpoint reload. Existing player-control evidence covers DecreaseHeat (1) in `ticket48-item-reset-browser-20261109.md`, SuccuShield (6) in `tests/fanservice_shield_draw_smoke.cjs`, Resupply (7) and LootRush (11) in `tests/fanservice_interruption_smoke.cjs`, and ApexLure (9) in `tests/fanservice_apex_lure_smoke.cjs`. These flows collectively cover every item currently present in `modes.json` and mapped by `items.js`.

Source type 0, IncreaseCumMeter, has an `ActivateItem` branch but no row in the playable item catalog and no player hotbar mapping; types 2 and 8 have no `ActivateItem` branch. They are not omitted supported hotbar items. Hot Hands notification behavior is covered by `tests/fanservice_economy.test.js`; the separately pinned `TauntCumAdd` value and taunt behavior are recorded in [`ticket48-taunt-cumadd-20261111.md`](../../parity/evidence/ticket48-taunt-cumadd-20261111.md).

### Acceptance decision

The documented All-or-Nothing metric uncertainty is resolved by the newer native analysis, and the player-control plus unit evidence covers every supported item and its applicable persistence behavior. The remaining raw-counter representation and deferred challenge notification are implementation details outside #48's written acceptance criteria. On that evidence, #48's criteria are met by the reconstruction; this audit does not update or close the GitHub issue.

## Work status

Historical status as of 2026-11-08: commit `9d422bf` contained the bounded item fixes; the later Apex, shield, reset, and hotbar evidence above supersedes the earlier open-gap list. This document records an acceptance audit and does not change GitHub issue state.
