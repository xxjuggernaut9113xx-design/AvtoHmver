# Original v0.05 media-pack bridge

## Restart and owned uninstall

A fresh process using the same isolated profile reported `owned=true enabled=true up=62` through the original store's reflected read-only `IsPackUnlocked`, `IsPackEnabled` and `GetUnlockPoints` methods. This query used the existing lab diagnostic channel and the exact installed fixture name after initialization. It did not submit the startup age screen or invoke purchase, enable or save operations. The original store also logged the persisted enabled pack name. The balance includes the original game's intervening completed-session rewards; the purchase itself was independently observed at 20 to 19.

The diagnostic instance was closed normally. The production bridge uninstall then accepted the verified native extracted tree, cleared its receipt and removed that tree. All three original `.sav` files matched their pre-uninstall SHA256 hashes afterward. The source fixture archive and delivered music files were retained. This closes the actual owned-cache uninstall check, including the native extractor consuming the source `.chpack` after successful extraction.

A further process launch after removal initialized successfully, loaded twelve valid music entries and scanned zero `.chpack` files. It reached the normal startup screen and was closed through the standard application-close shortcut without submitting age confirmation. This checks post-uninstall initialization; a new full gameplay regression after removal was not performed. No game process or temporary Server fixture was intentionally left running.

## Original-menu and combined-session acceptance

The original Unlocks purchase deducted exactly one UP (20 to 19), unlocked the neutral pack and enabled it. Its original control then disabled and re-enabled the pack. Both media files passed native filtering. The original Playlist selected the confirmed Server-delivered soundtrack and completed a twelve-second recording plus its two-second lead-in. Two observed Victory summaries showed 24 strokes and highest combo 24. The neutral green image was visible during a progressing native music session.

A further confirmed Server map added `cycle_media` events at four and eight seconds using the supplied example's `true` value. Source identity and PCM conversion were revalidated by the actual Server delivery worker; the changed, bridge-owned test map was staged only while its original session was stopped, retaining the previous map. Native `LoadBeatmap` read the new four-event map on the next run. Logs show cycle delivery at beats 9 and 17, prepared video texture used by `StartNativeStreamedPlayback`, and native warm-player promotion of the color-bar MP4. The song completed at `12.000s`. This is direct native activation evidence, although a screenshot of the video itself was not captured.

Evidence: `evidence/native-v005-unlocks-20261029.json` and `evidence/native-v005-combined-session-20261029.json`. Combined delivered playback works locally with the temporary Server stopped. It is not proof of live HTTP media streaming or of the complete embedded mod. Original v0.04/v0.05 transport regression suites run 57 cases: 55 pass and two environment-dependent cases skip.

The capture issue was resolved by fitting the game and then selecting 1280x720 windowed in its original settings. No security/privacy settings were changed. The original Quit control closed the session normally before process-restart testing. Earlier pending-menu/session statements below describe the previous checkpoint.

`mod/v005_pack_bridge.py` adapts the existing validated archive transport to the exact v0.05.1 Hotfix Public candidate `v0051-hotfix-public-a8f46896`. It verifies all candidate build hashes, rejects other builds and refuses installation/update/removal while that game's native process is running. The v0.04 adapter is unchanged.

The original game log establishes active pack discovery at `CockHero/packs`. Native extraction uses `CockHero/Extracted/<archive-stem>` and skips extraction when a cached manifest exists. The bridge preserves payload hashes, receipt ownership, atomic replacement/rollback and verified-cache invalidation. It never changes game currency, ownership arrays, saves, access flags or executable bytes. Purchases and enable/disable remain original Unlocks operations; the Public Import access check remains intact.

```powershell
python mod/v005_pack_bridge.py --game-root 'E:/fanservice-mod-lab/game' --archive 'E:/fanservice-mod-lab/v004-native/input/native-panel-one.chpack' --custom-id custom:native-panel-one-v005
```

Thirty transport tests run: 29 pass and one environment-dependent case is skipped. They cover active paths, exact-build rejection, process detection, original-byte preservation, archive/cache tampering, rollback and owned uninstall. Native runtime support remains false pending broader acceptance.

## Isolated native discovery

On October 29 the bridge installed the fixed neutral one-UP image/color-bar-video pack into the isolated v0.05 build. Startup discovered its `.chpack` and the original 7-Zip extraction completed successfully under `CockHero/Extracted`. Startup also loaded the real Server-delivered `synthetic-tone.m4a` beatmap with 24 beats and `Audio: OK`; the stored recording is its validated PCM WAV conversion.

Evidence log: `E:/fanservice-mod-lab/v005-music-export/native-media-20261029.log`. Bridge receipt: `game/CockHero/packs/.fanservice-receipts.json`. The game uses the separate `E:/fanservice-mod-lab/v005-music-profile` and opens on the user's left display.

Original-menu purchase, enable/disable, combined media/music playback, restart persistence and native uninstall/regression remain pending. The startup age screen was left to the user because the computer-use guidance prohibits submitting it. No compatibility registry entry has been promoted to supported.

After the user cleared the age screen, native extracted-cache verification passed through the bridge's read-only list operation. The source archive had been consumed by the native extractor; the complete extracted tree still matched every recorded payload hash. UI capture then intermittently returned Codex rather than the selected game and a coordinate action entered the game-mode menu instead of Unlocks. Further input was stopped. The user was asked to leave a normal non-maximized game window on the left display so capture can be re-established before purchasing or toggling anything.

Portable source bundle: `E:/fanservice-mod-lab/deliverables/fanservice-v005-bridge-20261029.zip`, SHA256 `33bf112a8f8aca62306a1b87cd7d7dab1a3104a64d69e0cf9ac67f8992c9d2a0`. It contains only the exact-build transport, compatibility verifier/registry, music delivery/export modules and quickstart. Its Python help entry point and Node syntax checks pass. No game files, user media, SDK files or credentials are included.
