# Original Unlocks owns pack controls

The user clarified on 2026-10-24 that packs must be purchased and enabled/disabled
in the original game's menu. The injected Game packs panel was therefore removed.
Its previous positive purchase test remains historical evidence, not the current
interface. Both JavaScript and Lua now reject purchase/enable/disable RPCs.
Only read-only native catalog queries remain.

Native pack discovery and the original Unlocks menu already passed synthetic
free unlock, priced purchase, insufficient funds, enablement and ownership after
restart checks. No original menu controls were replaced. The original native
Back control returns from Import to that menu.

Embedded Lite's saved definitions are labeled Pack drafts. They retain export,
edit and delete controls, while browser ownership, playback and profile-wallet
sync controls are excluded in native mode. A guard blocks portable purchase,
enable and wallet-import mutations while the native transport is present.
Standalone browser/mobile ownership behavior remains unchanged.

The experimental runtime file lifecycle passed install, update, integrity query
and removal on the exact game's four hash-verified build files in a separate
temporary lab. Those build files and preservation sentinels were unchanged.
The game was not executed in that file-lifecycle test; it does not establish
post-install game regression acceptance. Report:
E:/fanservice-mod-lab/v004-native/runtime-file-lifecycle-acceptance.json.

Automated checks for this revision: eleven read-only transport tests, three
ownership-boundary tests, eleven shared archive tests, nine installer tests and
five compatibility tests passed. Native in-game visual acceptance of the revised
draft-only menu is pending; Computer Use access to CockHero remains denied.
