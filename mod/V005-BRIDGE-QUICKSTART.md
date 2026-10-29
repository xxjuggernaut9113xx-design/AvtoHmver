# fanservice v0.05 music and media bridge

This bridge uses the original v0.05.1 Hotfix Public Playlist and Unlocks menus.
It is a transport checkpoint; the embedded fanservice menu is not complete.
It preserves the game's Import access check.

## Media packs

Requires Python 3.11 or newer and the exact game build recorded in
`mod/compatibility.json` as `v0051-hotfix-public-a8f46896`.

1. Export a saved media pack from fanservice.
2. Close the selected game normally.
3. Run from this bundle's root, replacing both paths with your actual paths:

```powershell
python mod/v005_pack_bridge.py --game-root 'E:/fanservice-mod-lab/game' --archive 'C:/YOUR_EXPORT.chpack.zip' --custom-id custom:my-pack
```

4. Start that game and open its original Unlocks menu.
5. Purchase the pack with the original game currency, then enable it there.
6. Start an original session. The pack's enabled media supplies the native pools.

Use the same `custom:` identity when updating a pack. The bridge verifies its
receipt and extracted files before replacing anything. An unknown or changed
file causes rejection. Keep the printed receipt.

```powershell
python mod/v005_pack_bridge.py --game-root 'E:/fanservice-mod-lab/game' --list
python mod/v005_pack_bridge.py --game-root 'E:/fanservice-mod-lab/game' --uninstall custom:my-pack
```

Close the game before removal. Removal affects only hash-verified bridge-owned
files and retains original saves and progression.

## Server music

Requires Node.js 22 or newer. For recordings needing conversion, supply the
absolute path to an existing FFmpeg executable. Prepare and confirm the track's
beatmap in fanservice first; the number below is its Server track ID.

```powershell
node mod/native/music-delivery.mjs 'http://127.0.0.1:8000' 1 'E:/fanservice-mod-lab/game/CockHero/beatmaps/my-new-track' 'C:/PATH/ffmpeg.exe'
```

Use your real Server origin and a new folder in the game's active beatmap
library. Remote Servers require HTTPS; HTTP is restricted to loopback.
The confirmed recording is hash-verified before conversion, and the confirmation
is checked again before publication. Existing destinations are retained.

Restart or rescan the game, then choose **Start Game → Playlist → Manage**, add
the track, click Done and start the run. Enabled media packs remain selected
through the original Unlocks controls. Music can play without a running Server
after delivery because its recording and beatmap are stored locally.

## Validation boundary

Original Unlocks purchase and enable/disable passed. Server AAC delivery and WAV
conversion reached the original Playlist, completed 24 beats and showed Victory.
The enabled test image was visible; explicit media-cycle events activated the
native video player. Ownership and enablement survived a process restart.
Owned-cache uninstall preserved all three original save files byte for byte,
and the game initialized normally afterward with zero remaining test packs.
The temporary Server was stopped during native playback.

Embedded v0.05 UI/companion integration, live HTTP media streaming and broader
session controls remain unfinished. Do not treat this bundle as full mod certification.
