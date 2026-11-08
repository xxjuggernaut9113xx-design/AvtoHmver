# Inventory browser acceptance (#47)

The checked-out Web app passed a scoped inventory transaction scenario in
headless installed Chrome at a 390 × 844 viewport on 2026-11-07. The scenario is
`tests/fanservice_inventory_smoke.cjs`; it loads checked-out assets over the local
synthetic fixture server instead of relying on its embedded build.

The test uses synthetic local media and explicitly sets a shop phase and a
1,000-coin session wallet. It then uses the player's inventory buttons to:

- Reject purchase and upgrade with an empty wallet without changing inventory.
- Upgrade DecreaseHeat from level 1 to 2 for 100 coins, buy three level 2 charges
  for 150 coins each, and reject the fourth charge at its three-charge capacity.
  Final wallet: 450 coins; MoneySpent: 550.
- Upgrade SuccuShield from level 1 to 2 for 100 coins and buy a single charge
  for 125 coins. Final wallet including the prior transactions: 225 coins;
  MoneySpent: 775.
- Move the equipped item from slot 3 to slot 5 without duplicating it.
- Reload and resume the active session with the same inventory, charges, level,
  wallet and spending metric.
- Settle and restore the loadout from the persistent profile, while starting the
  next session at level 1 and zero charges. Empty slots normalize from the
  recovered moved-slot value 0 to the standard empty value 8 on a new session.
- Select Tower and verify two initial unlocked items with an empty hotbar, then
  select Soundtrack and verify a single zero-charge Break in slot 1. Synthetic
  music metadata establishes the last initialization precondition; this does
  not test soundtrack playback.

Original bytecode exposed a real shield purchase discrepancy. The Web app granted
four charges for a level 2 purchase, while the original StoreWidget explicitly
passes `Count=1` to GrantItem for every item. The browser regression failed with
`4 !== 1` before the fix. `items.purchase` now grants one charge at every level.
Arbitrary direct grants retain the original ability to overfill when the starting
charge count is below capacity.

The evidence directory
from this run is `E:/avtohmver-build/inventory47`, containing
`inventory-acceptance.json` and `inventory-purchased.png`. Chrome temporary files
were directed to `E:/avtohmver-build/tmp`.

Run with `FANSERVICE_BROWSER_EXECUTABLE` pointing to an installed Chromium/Chrome,
`FANSERVICE_FIXTURE_ORIGIN` pointing to a synthetic fixture server (default
`http://127.0.0.1:42169`), and optionally `FANSERVICE_SMOKE_OUTPUT` for evidence:

```text
node tests/fanservice_inventory_smoke.cjs
```

The price authority is `static/fanservice/data/modes.json`, which records its
byte-roundtripped table origin. The transaction authority is retained original
Blueprint bytecode, pinned to reJOIce commit
`1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff` in
`tests/fixtures/fanservice/original-inventory-purchase.json`. The fixture preserves
selected original AST statements, their zero-based ordinals and full retained
file hashes. The complete source extraction is retained in the evidence
directory's `original` folder.

Original [StoreWidget bytecode](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/functions/StoreWidget/ExecuteUbergraph_StoreWidget.json)
statements 162–167 gate upgrade on affordability and UpgradeItem success before
SpendCoins. Statements 179–185 gate purchase on affordability, call
`GrantItem(ItemType,1,Success)`, then gate SpendCoins on success.
Original [GrantItem bytecode](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/functions/BP_CHGameInstance/GrantItem.json)
compares existing charges with GetMaxCharges before adding Count.
Original [SpendCoins bytecode](https://github.com/xxjuggernaut9113xx-design/reJOIce/blob/1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff/Analysis/ReferenceBuilds/newer-20261017/functions/BP_CHGameInstance/SpendCoins.json)
subtracts Cost and records metric 16 with that amount. The observed representative
browser transactions match these complete original control-flow sequences.

The 18 item/run/Tower regression tests also pass. This is an original static
bytecode comparison plus actual Web app transaction evidence; an original-game
live transaction capture and an Android emulator result are separate scopes and
are not implied by this result.
