# Browser smoke sweep — 2026-11-11

- **Branch:** `spec/avtohmver-open-tickets`
- **HEAD:** `d78cb78` — "Move Break punishment roll after the effect instead of pre-empting it (#48)"
- **Run:** 2026-11-11 ~05:00–06:00 UTC, sequential, one script at a time, `timeout 300 node tests/<script>.cjs`
- **Environment:** Playwright 1.64.1 (`tests/browser/node_modules/playwright`, gitignored); Chromium 1248 headless (`~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`); WebKit 2370 (Playwright WebKit 27.2) under `xvfb-run -a`; Node v24.22.1; Linux VM (Ubuntu 24.04.5 LTS). `FANSERVICE_BROWSER_EXECUTABLE` pointed at the Chromium binary; `FANSERVICE_SMOKE_OUTPUT` pointed at per-script dirs under `/tmp/smoke-sweep-20261110/`.
- **Machine-readable companion:** `browser-smoke-sweep-20261110.json` (same directory).

## Scope — read this first

These are **reconstruction-runtime browser checks only**. They do not certify the original game, the physical iPhone, or iOS Safari. WebKit runs are Playwright emulation (iPhone-shaped context where the script sets one), not the physical iPhone (#58). Two scripts in the task's "Chromium" list (`fanservice_beat_pattern_smoke.cjs`, `fanservice_shield_draw_smoke.cjs`) are in fact WebKit-only (`webkit.launch`) and were run as WebKit.

## Totals (31 scripts run, 14 skipped without running)

| Outcome | Count |
|---|---|
| Pass, first run | 11 |
| Pass on re-run (flaky first failure, or runner-env error) | 3 |
| Flaky intermittent (passes sometimes, mechanism known) | 1 |
| Fail — smoke stale vs the player (smoke needs updating) | 2 |
| Fail — player regression (UI reachability) | 1 |
| Fail — environment (missing fixture server / required env) | 13 |
| Timeout (300 s) | 0 |

No script hit the 300 s timeout. All failures were fast (≤44 s) or 30 s Playwright action timeouts inside the script.

## Results

| Script | Engine | Exit | Result | One-line reason |
|---|---|---|---|---|
| fanservice_objectives_smoke.cjs | Chromium | 0 | pass | All seven objective selections reach finish eligibility; one winning settlement. |
| fanservice_classic_smoke.cjs | Chromium | 0 | pass | Exact due beats, one pulse per stroke, 100-stroke objective, one win. Ran with `serverReady=false` (no fixture server); local-file path only. |
| fanservice_edge_smoke.cjs | Chromium | 1 | pass on re-run (flaky) | First run: mercy-deadline window `(59.9, 60]` missed after Accept Mercy (line 54). Re-run passed; WebKit iphone_edge run passed the same flow. |
| fanservice_economy_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169 — needs the Rust fixture server. |
| fanservice_inventory_smoke.cjs | Chromium | 0 | pass | Equip, purchase, upgrade, insufficient-funds, capacity, checkpoint/reload, loadout, mode controls. |
| fanservice_tower_smoke.cjs | Chromium | 1 | fail, smoke stale | (1) Deterministic: 'Inventory / loadout' click times out — button lives in the closed pause dialog since d146862; see below. (2) Nondeterministic: round-1 `failed=1` once in 4 runs (objective 8, Succu Slayer ×12, 'All or Nothing', 1061 s) when the meter filled first; random option draw, smoke asserts `failed==0` unconditionally. |
| fanservice_challenges_smoke.cjs | Chromium | 1 | **fail, player regression (REG-1)** | Post-settlement 'Challenges / modifiers' is unreachable — see Regression section. |
| fanservice_browser_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169 — server-seeded media. |
| fanservice_flow_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169. |
| fanservice_media_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169. |
| fanservice_apex_lure_smoke.cjs | Chromium | 0 | pass | Exact seeded additive count, charge/reload persistence, edge-phase rejection without charge loss. |
| fanservice_interruption_smoke.cjs | Chromium | 1 | fail, smoke stale | Line 44 `audio.paused` race (asserts before the async Start handler settles; proven paused at +200 ms) and line 65 stale `effects.items+1` expectation vs the #48 activation-counting fix (coordinator-confirmed; see below). |
| fanservice_music_timeline_smoke.cjs | Chromium | 1 | pass on re-run (flaky) | First run: same `audio.paused` Start-handler race as interruption line 44. Re-run passed. |
| fanservice_music_preparation_smoke.cjs | Chromium | 1 | fail, environment | Asserts `FANSERVICE_FIXTURE_ORIGIN` set; unset — needs the Rust fixture server. |
| fanservice_voice_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169. |
| fanservice_import_smoke.cjs | Chromium | 1 | fail, environment | Navigates to `undefined/fanservice/` — `FANSERVICE_HTTPS_ORIGIN` and `FANSERVICE_TEST_PACK` unset. |
| fanservice_export_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169. |
| fanservice_sync_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169. |
| fanservice_mobile_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169 via `tests/run_fanservice_ci.py`; cargo/rustc absent. Environment-skipped per coordinator, not a product verdict. Do not install Rust for it. |
| browser_admin_smoke.cjs | Chromium | 1 | fail, environment | Asserts `AVTOHMVER_ADMIN_FIXTURE_ORIGIN` set; unset. |
| browser_theme_smoke.cjs | Chromium | 1 | fail, environment | Asserts `AVTOHMVER_THEME_FIXTURE_ORIGIN` set; unset. |
| served_library_smoke.cjs | Chromium | 1 | fail, environment | `ERR_CONNECTION_REFUSED` at 127.0.0.1:42169. |
| fanservice_item_reset_smoke.cjs | Chromium | 0 | pass | Re-run at HEAD. All-or-Nothing browser behaviour. |
| fanservice_resupply_smoke.cjs | Chromium | 0 | pass | Re-run at HEAD. Activation applies `economy.itemUsed` at once; charge consumed only at store open; no second count; reload persistence. |
| fanservice_session_hud_smoke.cjs | Chromium+WebKit | 0 | pass | Passed in both engines. Proves the current HUD contract: no direct Pause button, stage tap opens the pause menu, Inventory/Challenges live in the pause menu. |
| fanservice_media_resume_smoke.cjs | Chromium+WebKit | 0 | pass | Media resume identity and MP4 position (Chromium) and image identity (WebKit). |
| fanservice_beat_pattern_smoke.cjs | WebKit | 0 | pass | Patterned hits, rest filtering, pause/resume projection. |
| fanservice_shield_draw_smoke.cjs | WebKit | 0 | pass | Shield automatic-draw. |
| fanservice_auto_media_smoke.cjs | WebKit | 0 | pass | Public Start, natural card completion, heat-based pool progression. |
| fanservice_iphone_edge_smoke.cjs | WebKit | 1* | pass on re-run | *First run failed only because the sweep runner exported `FANSERVICE_BROWSER_EXECUTABLE`=Chromium and this script passes that var as `webkit.launch` executablePath. Correct re-run (var unset, xvfb-run) passed: 12 edges, 510 bank, one winning settlement. |
| fanservice_iphone_emulation_smoke.cjs | WebKit | 1 | flaky intermittent | Original script, correct env: 1 pass / 5 runs. Fails at line 24 col 250, `waitForFunction(()=>finished)` after the portrait finish hold. The hold is a 1000 ms `setTimeout` (play.js `beginFinishHold`) cancelled on pointerup — the test holds 1100 ms, leaving 100 ms of margin, and WebKit-under-xvfb scheduling jitter eats it. The hold path itself works: an instrumented copy passed with `finished=true` immediately after mouse.up. Emulation only. |

## Regression found — REG-1: post-settlement Challenges unreachable

- **Script:** `tests/fanservice_challenges_smoke.cjs:38` — `page.getByRole('button',{name:'Challenges / modifiers',exact:true}).click()` — `TimeoutError`, 30 s, in both sweep runs.
- **Introduced by:** `d146862` (2026-11-09, "Give mobile sessions a media-first HUD and pause menu"), which moved the Inventory/Challenges actions into the pause menu (`play.js` `renderSessionShell()` moves them into `#pause-menu-body` on first render after Start) without providing a post-finish path.
- **Evidence (instrumented run):** after settlement, `document.body.dataset.sessionState='finished'`, `#pause-menu` open=false, both buttons 0×0 rect inside `DIALOG#pause-menu[open=false]`; `play.js` `end()` (line 437) disables Pause after finish; `renderSessionShell()` only opens the pause menu when `started && paused && !finished`; `static/fanservice/app.js` (library page) has no challenges entry point. The post-settlement claim flow the smoke exercises (Claim Intermediate/Master Edger, Master of Control, Reach Level 5) is unreachable by any UI path at HEAD. Before d146862 the button lived in `#controls` and was always visible.
- **Fix scope:** separate slice. Not fixed in this sweep. A fix must either restore a post-finish challenges entry point or deliberately move claiming to pre-finish only (product call) and update the smoke.

## Stale smoke expectations (smoke needs updating, not the player)

- **Tower (`fanservice_tower_smoke.cjs`).** Deterministic part: after round 1 reaches shop phase, the direct 'Inventory / loadout' click times out because the button is inside the closed pause dialog; `#controls #pause` is `display:none` (`play.css:18`), so the smoke cannot reach it the old way. The flow is still reachable by a human via media-tap → pause menu (the session_hud smoke proves that path). The smoke needs a stage-tap pause first. Nondeterministic part: round-1 `failed` depends on the random option draw — objective 8 (Succu Slayer ×12, tier 4, 'All or Nothing') failed once in 4 runs after 1061 s when the meter filled before 12 succubi; objectives 2 (Strokes) passed in the other 3. The round-failure path itself behaved as designed (phase advanced to shop, `failed` counted); the smoke's unconditional `failed==0` assertion does not fit a random draw.
- **Interruption (`fanservice_interruption_smoke.cjs`).** (1) Line 44: `assert(audio.paused==true)` right after the reload-leg Start races the async Start handler — `run.returnEdge` is already true from the restored checkpoint, so `waitForFunction` returns immediately while the handler is still awaiting `audio.play()`; a probe showed `paused=false` at +0 ms and `paused=true` at +200 ms (`finally{audio.pause()}` runs), currentTime frozen at the held position. (2) Line 65: `assert(state.ItemsUsed==effects.items+1)` fails `2 !== 3` — **known stale expectation, coordinator-confirmed**: the #48 fix (commit `6ebc552`) moved Resupply's `economy.itemUsed` to activation (`items.js` type 7 calls `hooks.itemUsed`), so the count is already inside `effects.items` (captured after both uses) and the store-open path only consumes the charge; the resupply smoke pins exactly this no-second-count behaviour. Fix is `effects.items+1` → `effects.items` in both loop attempts; the `state.metrics.itemsUsed == effects.used` rollback assertions need no change since consume still happens at store-open. The coordinator will make that edit after this sweep; this script must not be re-run after that edit as part of this sweep.
- **Music timeline (`fanservice_music_timeline_smoke.cjs:32`).** Same `audio.paused` Start-handler race as interruption line 44; passed on re-run.
- **Edge (`fanservice_edge_smoke.cjs:54`).** The mercy-deadline window `(59.9, 60]` is timing-tight under virtual-clock + real-click interleaving; failed once, passed on re-run and in the WebKit iphone_edge run.

## Environment failures (not product verdicts)

Nine scripts fail with `ERR_CONNECTION_REFUSED` at `http://127.0.0.1:42169/fanservice/` (economy, browser, flow, media, voice, export, sync, mobile, served_library): they need the Rust fixture server — the ignored test `routes::fanservice::tests::lite_browser_fixture` (`cargo test -p avtohmver --lib routes::`, port 42169), which serves the isolated sample library (`sample1.png` etc.) and the `/api/fanservice/v1/capabilities` identity the app's `serverReady` promise awaits. No server was listening, cargo/rustc are absent in this VM, and no prebuilt server binary exists here. `fanservice_classic_smoke.cjs` passed without the server because it uses only local files (`serverReady` resolves false and the smoke proceeds). Four more need env-provided origins that were not set: music_preparation (`FANSERVICE_FIXTURE_ORIGIN`), import (`FANSERVICE_HTTPS_ORIGIN` + `FANSERVICE_TEST_PACK`), admin (`AVTOHMVER_ADMIN_FIXTURE_ORIGIN`), theme (`AVTOHMVER_THEME_FIXTURE_ORIGIN`). `fanservice_mobile_smoke.cjs` is environment-skipped per coordinator instruction (needs the Rust server via `tests/run_fanservice_ci.py`); Rust must not be installed for it.

## Skipped without running (14)

Physical device / adb: `fanservice_android_acceptance.cjs`, `fanservice_android_storage.cjs`, `fanservice_private_archive_android.cjs`. Native companion/host binaries: `fanservice_native_companion_smoke.cjs`, `fanservice_archive_native_acceptance.cjs`, `fanservice_native_music_delivery.cjs`, `fanservice-native-bridge.test.cjs`, `fanservice-native-ownership.test.cjs`, `fanservice_snapshot_pins.test.cjs`, `fanservice_sync_review.test.cjs`. Header-checked, needs external fixture infra: `linked_packages_smoke.cjs` (requires `AVTOHMVER_LINKED_FIXTURE` seeded fixture; does not run standalone), `fanservice_https_smoke.cjs` (HTTPS/Tailscale), `fanservice_saved_server_regression.cjs` (asserts `FANSERVICE_SERVER_A_ORIGIN` and `FANSERVICE_SERVER_B_ORIGIN`; two live servers), `fanservice_private_archive_smoke.cjs` (needs the 42169 fixture server, spawns bare `python` — absent here, python3 only — and defaults to a Windows Edge path).

## Other test counts at HEAD

- Full Node suite (`node --test tests/*.test.js`, python→python3 shim in `/tmp`): **287 pass / 0 fail** — matches the d78cb78 baseline (287/0).
- Python schema tests (`python3 tests/recover_game_instance_schema_test.py`): **12 pass**.

## Notes

- No regression fix was made in this sweep, per the task. The one player regression (REG-1) and the stale smoke expectations are recorded here for separate slices.
- The session_hud smoke wrote screenshots to `.test-tmp/session-hud/` (1.3 M, untracked); removed after the sweep to restore a clean tree. Diagnosis used temporary `tests/zz-*-debug.cjs` copies, deleted after use; the tree contains only this report and its JSON from the sweep.
- Previously verified, not re-run in this sweep: the parent's patch-0006 draw-hook / release-window check in Chromium 1248 (`~/workspace/avtohmver-exploration/cum-override-chromium-check.cjs`).
