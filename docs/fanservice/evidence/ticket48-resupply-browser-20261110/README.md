# Ticket 48 Resupply hotbar + reload browser evidence

Date: 2026-11-10

Run: `node tests/fanservice_resupply_smoke.cjs` in this VM's Chromium (Playwright 1.64.1), through the page's own hotbar control, with virtual time and a synthetic neutral media/Server route. Hot Hands and the Resupply hotbar slot were seeded through the starting profile; the single Resupply charge was seeded through the public grant API. Combo and heat were built by delivered beats; no gameplay metrics were injected. This validates the reconstruction browser runtime, not execution in the original game or on a physical iPhone.

This covers the gap the #48 code review flagged: the Resupply timing fix (commits `6ebc552` + `f89e44d`) had previously been verified only at the Node `items.use`/`tick` seam, with the `play.js` hotbar path (`useItem` → `itemDependencies` wiring) and checkpoint/reload persistence verified by inspection only. All four cases below were driven through the real hotbar button (`#item-controls`, aria-label `Use Resupply · 1 charges` → `useItem(7)`) during an active Classic round, and all assertions read `run.state` / `state`, not HUD text.

## Results (all four cases passed, twice in a row)

Seeded round before activation: 12s, 6 strokes, combo 6, heat 1.2, 1 charge, ItemsUsed 0, Hot Hands enabled, Heat Spell not owned (so nothing masks the Hot Hands step).

1. **Activation applies `economy.itemUsed` at once.** Immediately after the hotbar click, before the 2s store delay elapsed and before the store opened: ItemsUsed 1, DefensiveItemsUsed 1, heat 11.2 (exactly +10, cap 100), combo 0, `resupplyRemaining` 2, store dialog closed.
2. **Charge survives the delay.** Charge still 1 immediately after activation and after 1s of the delay (`resupplyRemaining` 1, ItemsUsed still 1, store still closed); it becomes 0 only when the store opens.
3. **No second count at store open.** After the delay elapsed and the store dialog opened: charge 0, ItemsUsed still 1, DefensiveItemsUsed still 1.
4. **Reload persistence.** The saved checkpoint carried ItemsUsed 1, DefensiveItemsUsed 1, charge 0, `resupplyRemaining` 0; after `page.reload()` and checkpoint restore the same values were read back unchanged (ItemsUsed 1, charge 0, delay elapsed). The checkpoint/restore flow was driven end to end through the page's own `checkpoint(true)` and reload, not faked.

Full measurements and source hashes: [ticket48-resupply-browser.json](ticket48-resupply-browser.json).

## What was not covered

- Only Chromium was run here; the script supports WebKit via `FANSERVICE_BROWSER_ENGINE=webkit` (needs `xvfb-run -a`) but that engine was not exercised in this slice.
- Only the Classic-mode Resupply path was driven; other items' hotbar paths and Tower mode were not re-checked here.
- No original-game or physical-iPhone acceptance is claimed anywhere in this note.
