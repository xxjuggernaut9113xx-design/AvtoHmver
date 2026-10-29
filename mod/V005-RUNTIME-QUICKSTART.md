# fanservice v0.05 independent menu

This experimental component adds a Fanservice button to the original main menu.
It opens the configured Server library, saves companion pack drafts and delivers
music into the original Playlist library. Purchases and Enable/Disable remain
in original Unlocks. The original Import entitlement check is preserved.

Requires Python 3.11+, Node.js 22+, the exact
`v0051-hotfix-public-a8f46896` game, and the existing pinned UE4SS development
loader recorded in `mod/compatibility.json`. The installer verifies that loader
against its archive; it does not install or replace it. No game or loader
binaries are bundled. AAC/MP3 conversion requires an explicit FFmpeg executable.

## Install and run

Close the game and stop any helper first. Set the game root, pinned loader ZIP
and Server origin to your installation. This concrete example uses the isolated
lab paths; adjust those arguments for another installation.

```powershell
python mod/v005_runtime_installer.py install --game-root E:/fanservice-mod-lab/game --loader-archive E:/fanservice-mod-lab/tools/UE4SS_v3.0.1-1181-g83330635.zip --server-origin http://127.0.0.1:42169
```

That command only reviews the target and file hashes. Add `--apply` to install.
Remote Server origins require HTTPS; plain HTTP is accepted only on loopback.
An existing unowned or modified component is preserved by refusing the change.
Other mods, loader configuration and game saves remain unchanged.

In the installed `CockHero/Binaries/Win64/ue4ss/Mods/FanserviceV005` folder,
run `Start-FanserviceNative.cmd`. It starts the profile-bound helper and game.
For soundtrack conversion, pass `-FFmpeg` with an absolute executable path.
The PowerShell launcher also supports `-CompanionDataRoot` for a separate
absolute storage directory and `-StartGame` to launch the game.

After handling the game's startup screen, click Fanservice. Expand
**Game music, saved packs and sync**, refresh the saved game profile and select
the Server soundtrack ID. **Deliver soundtrack to Playlist** writes a new
recording folder. Restart the game to discover a newly delivered recording if
the original library has already been scanned. Play through original
**Start Game → Playlist → Manage**. Media pack installation remains covered by
`V005-BRIDGE-QUICKSTART.md`.

## Upgrade and remove

Close the game and run `Stop-FanserviceNative.cmd`. Rerun install with `--apply`
to upgrade. The installer preserves bounded protocol state byte for byte.

```powershell
python mod/v005_runtime_installer.py remove --game-root E:/fanservice-mod-lab/game --loader-archive E:/fanservice-mod-lab/tools/UE4SS_v3.0.1-1181-g83330635.zip
```

Review the result, then add `--apply` to remove owned code and its enable marker.
When protocol data remains, removal retains it and a disabled ownership manifest.
Reinstall recognizes that state. External companion profiles, snapshots, game
saves, delivered music and installed media packs are retained. Unknown files or
active helper markers block changes; inspect or stop them rather than deleting
them blindly.

## Verified scope

The independent entry, configured Server page, profile RPC, neutral soundtrack
delivery, close/reopen, installed-helper startup and actual isolated
upgrade/remove/reinstall passed. Seven protected loader/settings/save files
retained identical hashes. 83 native/MCP tests, 24 v0.05 installer tests and
21 v0.04 installer tests pass. Full build certification, live panel snapshot/sync
acceptance and broader gameplay regression remain open.
