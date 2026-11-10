# iPhone WebKit readiness check — 2026-11-09

## Automated evidence

- `tests/fanservice_iphone_emulation_smoke.cjs` passed in Playwright 1.64.1 / WebKit 27.2 with a 390 × 844 CSS-pixel viewport, device scale factor 3, and touch enabled. A real Playwright pointer hold canceled when the viewport rotated; the finish control remained visible in landscape; the next portrait hold completed Prejac. The UI Pause and Resume clicks called `FanserviceVoice.unlock` once on Resume.
- `tests/fanservice_iphone_edge_smoke.cjs` passed the Edge stages, Mercy choices, persisted hold reload and rollback, replay, and one winning settlement through 12 Edges.
- `tests/fanservice_item_reset_smoke.cjs` passed with `FANSERVICE_BROWSER_ENGINE=webkit`. Timer and Strokes scenarios exercised normal gameplay, the defensive item through its control, reload, one return-edge through its control, return to the same card and pool, restored item eligibility, and another item use.
- Retained machine-readable reports: [Edge](iphone-webkit-20261109/edge-browser.json) and [ordinary interruption and item reset](iphone-webkit-20261109/item-reset-browser.json).

These are reconstruction-runtime tests with synthetic neutral media and Server responses. The existing item-reset smoke seeds inventory through its grant API and advances time with Playwright's virtual clock; it does not inject gameplay metrics. Playwright WebKit emulation is not physical iOS Safari acceptance.

## Device status

Physical iPhone 17 Pro validation remains separate. The user withdrew the initial phone-test reports after discovering Tailscale was disconnected. After connecting Tailscale and refreshing, the user confirmed Safari loads `https://bougoisie.tail16554f.ts.net/fanservice/`, local media can be saved into an enabled pack, Start displays media with a moving beat indicator, and portrait/landscape show the media and controls without clipping. The iOS version has not been provided. The phone-lock test exposed a media change on Resume; its fix is awaiting a physical retest. Further device checks remain pending. See [the manual observations](iphone17pro-manual-20261109.json).

## Media resume regression

The phone-lock report exposed fresh random media draws on refocus and checkpoint restore. `play.js` now checkpoints the displayed frozen-member ID and video position, restores the ID through the frozen selection rather than a saved URL, and preserves it through the refocus Edge. Paused decoder updates cannot replace the held video position. Explicit Next still restarts a single-file video. The offline shell cache advances to v31.

`tests/fanservice_media_resume_smoke.cjs` passed independently in installed Microsoft Edge and Playwright WebKit 27.2. Three neutral images retain identity through pagehide/refocus, reload preview, Start, and Edge replay. Edge plays a synthetic H.264 MP4: explicit Next restarts it, Resume restores its held position after a simulated decoder reset, and pagehide/reload/Start restores its position. The fixture serves byte ranges so seek behavior is exercised. Video decoder reset is a controlled browser test, not an observed Safari implementation detail. All 254 Node tests pass. Physical Safari verification remains separate.

The physical retest reported that Resume changes its label to Pause but gameplay looks frozen. The return-Edge animation branch was skipping the moving indicator, and its UI lacked an instruction explaining the required Edge action. The player now animates against the return card's actual queued hit times (using the session clock while soundtrack playback is held) and explains the Edge action. Shell cache v32 delivers the update offline. The expanded smoke uses a 390 × 844 touch context, confirms paused/unpaused state and advancing gameplay time, observes indicator movement, presses the real Edge control, waits for the return task to finish, and checks retained media identity in both engines. This passes alongside the MP4 regression and all 254 Node tests. Physical confirmation of the updated presentation remains pending.

## Audio test boundary

Playwright's own [capability tests](https://github.com/microsoft/playwright/blob/main/tests/library/capabilities.spec.ts) mark Windows WebKit audio playback as unsupported for their autoplay test and disable its audio playback test. Accordingly, a generated WAV that did not progress in this Windows WebKit harness is not claimed as an iPhone playback failure. Audible media and voice recovery still require the physical Safari check.
