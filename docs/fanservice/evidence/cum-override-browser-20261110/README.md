# #44 cum override: real-browser check of the play.js draw hook (2026-11-10)

Environment: Linux sandbox, Chromium 1243 (headless, `--no-sandbox`), Python Playwright, `python3 -m http.server 8765` in `static/`, service workers blocked. Code under test: commit `87a0919` (CumEventOverride draw hook) on top of `5cdfd3c`. This is an emulated desktop browser, not the original game and not the physical iPhone (#58); it does not accept #44.

Seeding: the scripts import seven generated PNGs (one per pool: slow, medium, fast, succubus, cum, ass, boobs) into the device-local store through `FanserviceStore.importFiles`, create and enable a local pack with `FanserviceModel`, write the profile to localStorage, open `/fanservice/play.html`, click Start (Classic, mode 0) and then drive the page's own `draw`, `objectiveEvents` and `run.advance` functions.

## Results

`draw_hook_check.py` (automatic draw, explicit draw, Edge precedence):
- `run.cumOverrideDue()` false by default; true when `isAllowedToCum`; false while an Edge stage is active.
- automatic draw with `isAllowedToCum`: pool `cum`, travel 1.75, 29 strokes, pattern from the five-row cum bank; 30 of 30 repeated automatic draws used a cum-bank pattern.
- explicit `draw('cum')` (the 100 percent path): travel 1.5, 61 strokes, Fast-bank pattern (unchanged).
- automatic draw with `isAllowedToCum` false: ordinary pool (`slow`), travel 1.75.

`release_window_flow_check.py` (real event flow): `release-window-opened` starts the 100 percent card (travel 1.5, 68 strokes); each following card completion draws an override card (travel 1.75, 26-32 strokes, pattern lengths 1, 10, 9, 4, all cum-bank rows); after the window is closed the next draw is an ordinary pool (`fast`).

Only console errors: `/favicon.ico` and `/api/fanservice/v1/capabilities` return 404 from the plain static server.
