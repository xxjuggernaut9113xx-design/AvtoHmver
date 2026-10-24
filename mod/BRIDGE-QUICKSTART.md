# fanservice v0.04 pack bridge

This checkpoint delivers exported fanservice media into original v0.04 gameplay
through the game's own pack system. It is not the complete embedded mod.

1. Install Python 3.11 or newer with tkinter, if it is not already available.
2. Export your chosen media from fanservice as a saved pack.
3. Close CockHero. Extract this bridge ZIP into its own folder.
4. Open mod/v004_pack_bridge_ui.pyw with Python.
5. Choose the game's Windows folder containing CockHero and your exported pack.
6. Click Install pack for next game launch. Keep the displayed receipt.
7. Start the game. Open Unlocks, choose the pack, unlock and enable it, then play.

For a terminal instead, from the extracted folder run:

```powershell
python mod/v004_pack_bridge.py --game-root 'E:/fanservice-mod-lab/v004-native/game' --archive 'samples/fanservice-native-validation.chpack'
```

Replace the example game folder with your installation's Windows folder.
The bridge accepts .chpack and .chpack.zip inputs, requires the exact identified
v0.04 Exclusive build and rejects changed/unknown builds. Limits are 512 MiB per
archive compressed/expanded, 256 MiB per media file, and 10000 media entries.
The sample pack contains a synthetic interface button and color-bar test video.

Native validation passed: ordinary Import and preset save; native pack discovery;
free unlock; original image/video gameplay; two-UP purchase (five to three UP);
insufficient funds rejection; free ownership after restart. Startup logs also
confirm the purchased pack remains unlocked and enabled after restart. The
three-UP balance was verified through the real store after that restart.

The GUI starts and compiles, but its full file-picker interaction acceptance is
pending. The CLI transport has been run successfully against the isolated actual
build. Current checks pass 26 transport tests (one platform-dependent test is
skipped), seven runtime installer tests and eleven JavaScript bridge tests.
No game files are included in this ZIP.

The bridge creates a unique archive when no custom identity is supplied. Use
--custom-id custom:your-pack to install or update a stable native identity.
The game consumes the archive after extraction. The bridge records payload
hashes and verifies the extracted tree when that archive is gone. With the game
closed, --list inspects owned packs and --uninstall custom:your-pack removes an
owned pack. Updates and removal invalidate only its exact verified owned cache.
Changed or unknown files cause refusal. Saves and unrelated packs are retained.

Embedded Lite entry/return and native catalog query/enablement have passed.
Remaining work: live membership/streaming, profile
synchronization, music integration, full GUI acceptance and complete mod
regression/uninstall acceptance. The supported full-mod build registry remains
empty. Do not treat the local transport as those completed integrations.
