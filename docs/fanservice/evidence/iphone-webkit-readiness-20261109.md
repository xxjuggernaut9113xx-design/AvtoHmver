# iPhone WebKit readiness check — 2026-11-09

## Automated evidence

- `tests/fanservice_iphone_emulation_smoke.cjs` passed in Playwright 1.64.1 / WebKit 27.2 with a 390 × 844 CSS-pixel viewport, device scale factor 3, and touch enabled. A real Playwright pointer hold canceled when the viewport rotated; the finish control remained visible in landscape; the next portrait hold completed Prejac. The UI Pause and Resume clicks called `FanserviceVoice.unlock` once on Resume.
- `tests/fanservice_iphone_edge_smoke.cjs` passed the Edge stages, Mercy choices, persisted hold reload and rollback, replay, and one winning settlement through 12 Edges.
- `tests/fanservice_item_reset_smoke.cjs` passed with `FANSERVICE_BROWSER_ENGINE=webkit`. Timer and Strokes scenarios exercised normal gameplay, the defensive item through its control, reload, one return-edge through its control, return to the same card and pool, restored item eligibility, and another item use.
- Retained machine-readable reports: [Edge](iphone-webkit-20261109/edge-browser.json) and [ordinary interruption and item reset](iphone-webkit-20261109/item-reset-browser.json).

These are reconstruction-runtime tests with synthetic neutral media and Server responses. The existing item-reset smoke seeds inventory through its grant API and advances time with Playwright's virtual clock; it does not inject gameplay metrics. Playwright WebKit emulation is not physical iOS Safari acceptance.

## Device status

Physical iPhone 17 Pro validation remains separate. The user withdrew the initial phone-test reports after discovering Tailscale was disconnected. After connecting Tailscale and refreshing, the user confirmed Safari loads `https://bougoisie.tail16554f.ts.net/fanservice/`. The iOS version has not been provided. Gameplay, rotation, interruption, voice, and offline checks on the physical phone remain pending; automated results above do not establish those device results.

## Audio test boundary

Playwright's own [capability tests](https://github.com/microsoft/playwright/blob/main/tests/library/capabilities.spec.ts) mark Windows WebKit audio playback as unsupported for their autoplay test and disable its audio playback test. Accordingly, a generated WAV that did not progress in this Windows WebKit harness is not claimed as an iPhone playback failure. Audible media and voice recovery still require the physical Safari check.
