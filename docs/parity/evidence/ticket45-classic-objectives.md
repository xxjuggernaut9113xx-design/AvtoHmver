# Ticket 45: Classic objective evidence

The browser smoke exercises all seven supported Classic selections through the mobile player's selection, ordinary card/Edge/Tribute actions, hold-to-finish control, and one winning progression settlement. The Succu Slayer case selects Insane through the UI and verifies the persisted max-difficulty and Classic SuccuSlayer metrics, including Built Different completion and one step of Public Safety progress. The report also checkpoints and reloads the Timer case, confirms its target and progress survive resume, attempts the finish key again after settlement, then reloads and verifies the completed-session count remains one with no resumable checkpoint: [browser report](classic-objectives-browser.json).

## Source boundary

- The pinned newer [original BP_GlobalManager graph](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/ExecuteUbergraph_BP_GlobalManager.json) references objective target fields including `Objective_EdgesRequired`, `Objective_TributesRequired`, and `Objective_PrejacTimeRequired_Seconds`. The [mobile gameplay spec](../../fanservice/MOBILE_GAMEPLAY_SPEC_20261105.md#L24) records the parity requirement.
- The retained static `AddtoCumMeteronBeatComplete` traces document meter gain inputs and branches; the fixture explicitly says the original game was not executed: [session-rule traces](../../../tests/fixtures/fanservice/session-rule-traces.json#L1). Treat these as recovered static evidence, not live acceptance.
- The current executable rule model and tests cover objective enum selection, per-session baselines, completion thresholds, release-window expiry/reset, Prejac timing, and Tribute completion: [objectives.js](../../../static/fanservice/objectives.js), [objective tests](../../../tests/fanservice_objectives.test.js), and [card/Tribute tests](../../../tests/fanservice_cards.test.js). These verify the reconstruction; they do not turn the browser fixture into original-game execution evidence.

## Current UI bounds

These are the checked-in reconstruction defaults and input bounds from `objectives.js`; the selector in `play.js` applies each range and step to the numeric input. The cited original Blueprint records establish target fields and rule flow, but the retained excerpts do not establish the original UI slider minima or maxima.

| Classic objective | Default | UI minimum | UI maximum | Step |
| --- | ---: | ---: | ---: | ---: |
| Cum meter | 1 (fixed) | 1 | 1 | 1 |
| Timer | 300 | 300 | 10,800 | 300 |
| Strokes | 1,000 | 100 | 20,000 | 50 |
| Edges | 2 | 2 | 100 | 1 |
| Prejac | 60 | 30 | 600 | 30 |
| Tribute | 2 | 2 | 20 | 1 |
| Succu Slayer | 5 | 5 | 100 | 5 |

The acceptance smoke uses each configurable objective's UI minimum (and the fixed Cum meter target). The current defaults differ from the UI minimum for Strokes (1,000 vs. 100) and Prejac (60 vs. 30); these are current implementation values, not proven original slider bounds. The media and Server responses in the browser run are synthetic neutral fixtures.

## Rewards — SETTLED (v0.05.1 native, implemented 2026-11-11)

Session XP is awarded by `UProgressionManager::PrepareSessionRewards` (0x1483046c0, display breakdown) and `UProgressionManager::CalculateSessionXP` (0x1482d90e0, actually granted via `EndSession` 0x1482ddd60), both disassembled from the hash-verified v0.05.1 exe. Both use the identical formula (f32):

- Win multiplier `winMult = 1.0` won / `0.5` lost, applied per source and floored per source. Win test on merged stats: byte `+0x2C == 0` AND int `+0x30 <= 0` → lost.
- TIME: `floor(floor(SessionLengthSeconds / 60) * 10.0 * winMult)` — whole minutes only; detail `'%d MIN'`.
- STROKES: `floor(min(strokes * 0.18, 360) * winMult)`.
- ENEMIES: `floor(min(enemiesTotal, 60) * winMult)`, enemiesTotal = stats `+0x8 + +0xC`.
- EDGES: `floor(edges * 15.0 * winMult)`.
- VICTORY BONUS: `+60` iff won, NOT multiplied by winMult.
- MODIFIER BONUS: multiplier starts 1.0; `'ironman'` → 1.2, `'hardcore'` → += 0.15 (additive, each at most once). TotalXP = `floor(baseXP * mult)` where baseXP is the sum of the floored per-source amounts (including the win bonus).
- UP sources (all `floor(... * winMult)`, appended only if > 0): strokes/300, max combo/400, edges/2, minutes/3, max-heat draws/10, victory +5 (`'CAME ON TIME'`), purist +5/`floor(5*winMult)` iff items-used count (`+0x1C`) == 0.
- Level-ups loop while level < 20: threshold = `GetLevelDataForLevel(level)->+0xC` if > 0 else `GetFallbackUpgradeValueForLevel(level)`; each level-up appends a UP source (`'LEVEL UP'`, `'LVL %d'`, amount = levelData `+0x10` = UnlockPointsReward, only if > 0).

Player fix (commit `a9d83cc`): `rules.js xp()` now implements the native formula. The player previously over-awarded 2x on every loss (no 0.5 multiplier) and used fractional minutes (`floor(seconds/6)` instead of `floor(seconds/60)*10`). The 4200-row `native-xp-traces` fixture (`original_game_executed: false`) encoded the old formula and was wrong on 2510 rows; its `expected_xp` values were regenerated from the disassembled formula (f32 arithmetic, cross-checked in Python) and the correction recorded in the fixture's limitations. New test `XP matches disassembled v0.05.1 PrepareSessionRewards/CalculateSessionXP` pins the native values. `progression.js sessionUP` already matched the native UP formula exactly; no change needed there.

Level thresholds VERIFIED (2026-11-11): `DT_LevelData` decoded from the legacy-converted v0.05.1 table (20 rows, 38-byte stride) — XP thresholds `[100, 120, 145, 175, 210, 250, 300, 360, 430, 515, 620, 750, 910, 1100, 1330, 1600, 1920, 2300, 2750, 3300]` and UnlockPointsReward `[5, 5, 6, 7, 8, 8, 9, 10, 10, 12, 12, 12, 13, 13, 14, 14, 14, 15, 15, 16]` with matching level titles — identical to the player's `level_thresholds` and contract `DT_LevelData`. No code change needed. `EndSession` also clears the session timer, broadcasts `OnXPGained`, calls `CheckLevelUp`, `UpdateMetricWithConditions`, `SaveProgress`, and ~23 `UpdateLifetimeBest` calls. No coins in PrepareSessionRewards or EndSession's visible calls — the session-end coin award path is not verified (player adds `stats.coins`; `rules.coinAward` not verified in this pass).

## Clock accounting — SETTLED (native), two separate counters

- **GM-side counter** (`BP_GlobalManager` ubergraph, 2569 stmts): a 1 s repeating timer (`SetSessionDurationHandle`) increments `PlayerVariablesStruct.SessionLength` by 1 per tick. Guard: if `'Deal with the Devil'` is active, the tick counts ONLY when `CurrentCardTypeEnum == 3`; otherwise it always counts. On Prejac expiry (`CurrentSessionObjective == 6` and `SessionLength >= Objective_PrejacTimeRequired_Seconds`) both the session-duration and format-text timer handles are cleared (clock stops). Each tick also updates PercentAtHighHeat (`SetSessionMetric(24, FTrunc(TimeAtHighHeat / SessionLength * 100))`; `UpdateMetric(23, 1)` if `Heat Level >= 70.0` — the gate is on Heat Level, not on the percent ratio; corrected 2026-11-12 from the cooked `SetSessionDuration` export, stmts 15–16: `GreaterEqual_DoubleDouble(Heat Level, 70.0)`).
- **PM-side counter** (`UProgressionManager`): `StartNewSession` (0x148313cd0) records session start world time (`this+0x3b0`) and starts a separate 1 s repeating timer; `EndSession` reconciles `elapsed = floor(UWorld+0x740 - SessionStartTime)` and takes `max(stored, elapsed)` (same max adjustment in PrepareSessionRewards on merged stats `+0x28`, only when `this+0x3b0 > 0`). The PM-side clock is NOT Devil-guarded and NOT stopped at Prejac expiry (its timer is cleared only at EndSession).
- **Implemented in the player (2026-11-12):** a separate GM-side objective clock (`Objectives.Runtime.gmSeconds` / `gmStopped`, driven by `tickSecond` from `Run.advance()` once per whole session second crossed; Devil guard, Timer completion, and Prejac stop per the decoded `SetSessionDuration` / format-tick handlers). Full decode + implementation map: `docs/parity/evidence/ticket45-objective-clock-20261112.md`. The PM-side rewards clock (`player.sessionLength` / `state.seconds`) is untouched — only `PercentAtHighHeat` uses the GM reading, because `SetSessionDuration` computes it from the GM counter. Still unresolved: the PM 1 s tick function at 0x1482d2840 (via thunk 0x1482d9450) has no PDB symbol, so the exact PM-side per-second accounting is not fully settled; `UWorld+0x740` field name unresolved; EndSession's single `UpdateMetricWithConditions` call arguments not decoded.

## UI bounds — NO original selection UI exists in v0.05.1 (blocked)

Exhaustive hunt (2026-11-11): the only SpinBox in the cooked packages is in the debug `AudioSyncCalibration` widget. `UI_Manager` has only two Sliders (FavoritesFrequency, MetronomeVolume) and only READS the `Objective_*` fields for display; `MainMenu`, `DifficultySelectScreen_Widget`, the gamemode buttons, and the difficulty buttons contain no objective/slider references and never write `Objective_*` fields. There is no Classic objective-target selection UI in v0.05.1 — the targets are the GameInstance class defaults (Timer 10 s, Strokes 500, Edges 500, Prejac 5 s, Succubus 1, Ruins 5, Tributes 5), not UI bounds. The player's per-objective min/max/step table therefore has no original counterpart to match; the table above stays reconstruction defaults. The prior decision to keep the player's 300 s Timer default unchanged stands.

## Remaining acceptance

This evidence does not close ticket #45. Original-derived target defaults and ranges, exact finish eligibility, and resulting rewards still need comparison against build-bound original evidence across every supported Classic objective. The browser report verifies only the checked-out reconstruction's normal UI flow, checkpoint behavior, and one-time settlement; original-runtime parity and original reward amounts remain unresolved.
