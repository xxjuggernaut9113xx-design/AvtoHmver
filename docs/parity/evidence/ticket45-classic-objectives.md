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

## Remaining acceptance

This evidence does not close ticket #45. Original-derived target defaults and ranges, exact finish eligibility, and resulting rewards still need comparison against build-bound original evidence across every supported Classic objective. The browser report verifies only the checked-out reconstruction's normal UI flow, checkpoint behavior, and one-time settlement; original-runtime parity and original reward amounts remain unresolved.
