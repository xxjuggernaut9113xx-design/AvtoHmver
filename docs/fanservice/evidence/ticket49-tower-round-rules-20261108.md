# Ticket 49: Tower round rules

The Tower lifecycle was checked against the newer reference build at
`reJOIce` commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`.
The linked C files are retained static decompilations, not a live game capture.

## Source findings

- [`StartRoundSession`](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/native-round-runtime/0x148314ce0.c)
  stores configured total rounds and the endless flag, then resets current round
  to zero. In the recovered manager layout these fields are at `+0xbc`, `+0xc0`,
  and `+0xb8` respectively.
- [`CompleteRound`](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/native-round-runtime/0x1482db4d0.c)
  increments the failed-round count (`+0x174`) on failure. It sets the session
  win flag only when endless is false, current round is positive and at least the
  configured total, this round succeeded, and the failed-round count is zero.
- [`AdvanceRound`](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/native-round-runtime/0x1482d3e70.c)
  takes its end-session path only when endless is false and the configured
  positive round total has been reached. Endless runs therefore continue past
  the configured count rather than taking the finite end path.
- [`CalculateRecommendedShopInterval`](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/native-round-runtime/0x1482d8140.c)
  returns one for totals up to three; above three it rounds the square root and
  clamps the result to four. `Run.shopEvery` uses the same rule.

## Regression check

`tests/fanservice_run.test.js` now verifies that an endless run configured for
one round continues into round two after a failure, remains active, and does not
set a finite session win. The existing finite five-round lifecycle test verifies
that any failed round prevents the final overall win.

Focused command: `node --test tests/fanservice_tower.test.js tests/fanservice_run.test.js`
Result: 7 tests passed.

`tests/fanservice_tower_smoke.cjs` also passed in headless Microsoft Edge. It
used a synthetic neutral media route and accelerated only browser time while the
normal Tower UI, card queues, delivered beats, objective completion, and finish
controls drove a two-round finite win. The run bought one item, upgraded
another, paused and reloaded at the shop checkpoint, then verified the completed
round, wallet, purchased charges, and upgraded level carried into round two. The
final result settled once with `BestTowerWinRounds: 2`. The generated details
are in `evidence/ticket49-tower-run-20261108/tower-browser.json`.

This validates static source correspondence and the Web implementation. It does
not claim a live original-game Tower capture.
