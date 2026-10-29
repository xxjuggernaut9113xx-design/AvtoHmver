# Original v0.05 media-pack bridge

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
