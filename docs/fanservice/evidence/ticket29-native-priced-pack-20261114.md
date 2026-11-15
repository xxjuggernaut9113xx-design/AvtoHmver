# Ticket 29 native priced-pack acceptance

Tested November 14, 2026 on isolated `v0051-hotfix-public-a8f46896`, executable SHA-256 `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`, with two disposable profiles and generated color-bar images.

- Original Unlocks displayed 50 UP for the unaffordable pack. Attempting the unlock left the pack locked and the buyer at 5 UP. Unlocking the 1 UP pack charged once, left 4 UP, and enabled the pack.
- With the game closed, the bridge installed an edited archive with a new name, cover, and 3 UP price under the same native ID. On restart, native store logs reported the original owner's pack as owned and enabled, with 4 UP. The extracted cover matched the new fixture image.
- A fresh buyer's native catalog showed the updated title and price for the same ID. Original Unlocks displayed the revised cover and 3 UP price and charged 5→2 UP when the buyer unlocked the pack. The store heading continued to display the stable native pack identifier.
- The closed-game bridge removed the two test deployments and their extracted caches. Its final inventory was empty. The source archives matched their installation hashes afterward. Both disposable profiles' save files were present after removal, but the pre-removal hash capture failed, so this run did not independently verify byte-for-byte save retention. The pack bridge test covers save-byte preservation during replacement and removal.

The isolated Server's profile API separately verified the same `custom:ticket29-live` definition through revisions 1–3. Changing the live rule from `Parity portrait` to `Parity playback` changed resolved IDs from `1, 2, 111` to `111, 112`, while the edited title, cover ID and 3 UP price round-tripped under the same pack ID. Removing the definition left both rules resolvable and all four affected media URLs returned the same SHA-256 hashes as before deletion.

The Server profile test and native archive test exercised separate paths. A Server profile edit does not automatically refresh the installed native archive. No real saves were used. All test game windows were closed and the local fixture Server was stopped.
