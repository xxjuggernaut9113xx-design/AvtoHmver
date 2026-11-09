# Ticket 48 All-or-Nothing item reset browser evidence

Date: 2026-11-09

Run: `node tests/fanservice_item_reset_smoke.cjs` in installed Microsoft Edge with Playwright 1.64.1, using normal player controls, virtual time, and a synthetic neutral media/Server route. The inventory charge and enabled modifier were seeded through the public grant API and starting profile. No gameplay metrics were injected. This validates the reconstruction browser runtime, not execution in the original game.

Both timer and stroke objectives passed through delivered gameplay, a defensive item reset, checkpoint reload, the one-Edge return flow, and a second defensive item reset. Each use set coins to zero and reset only the selected effective metric while preserving the absolute clock and unrelated counters. After reload, both metric offsets and remaining item charges survived. The return flow restored card 0 / `slow`, returned the Edge phase to `idle`, and restored item eligibility.

Representative second-reset results:

- Timer: raw seconds 17.406, effective seconds 0.014, zero coins, HUD showed `0 seconds`.
- Strokes: raw strokes 8, effective strokes 0, zero coins, HUD showed `0 beats`.

Full measurements and source hashes: [ticket48-item-reset-browser.json](ticket48-item-reset-browser.json).
