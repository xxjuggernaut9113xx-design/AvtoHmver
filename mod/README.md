# Cockhero mod compatibility gate

The Windows product now targets a mod of the original Cockhero game. The
reconstruction remains reference evidence. No original game files are bundled.

Current development target: the user selected the supplied **v0.04 Exclusive**
installation. Its isolated unmodified startup passed and its hashes are recorded
as `v004-exclusive-c645757d`. Normal Import, native pack discovery, free unlock,
and original-game image/video playback passed with synthetic media.
See [the current startup evidence](evidence/v004-native-startup.md). The v0.05.1
public-build findings below are historical and do not block testing the separately
supplied older target. No v0.04 save is migrated into v0.05.1.

**There is no supported or distributable mod build yet.** The registry deliberately
contains no supported builds. Recognizing an executable is not proof that its
import UI, custom catalog, purchases, saves, or streaming hooks work.

An [independent Windows companion menu](companion/README.md) is available alongside
the game. Its button/F8 shortcut opens the shared Lite interface in a separate
window with its own persistent profile. It does not provide native game Unlocks,
native UP or an embedded original-game menu, and does not change mod support.

The inspected installation displays `V0.05.1 Hotfix Public Build`, uses UE 5.3.2,
and matches the newest public version listed on the official distribution page
on 2026-10-22. Its native Import click opens the developer access page. The
official page requires Patron+ for custom importing. That check was not changed.

UE4SS stable 3.0.1 failed its GMalloc scan. The pinned development candidate in
the registry starts and enumerates the original import, WebView, and pack-store
classes. One isolated synthetic import-widget construction returned successfully;
a subsequent direct construction crashed. Lite embedding and a custom native
Unlocks entry have **not** passed their acceptance gate. Automatic approval review
rejected the next runtime probe with `blocked by policy`, with no detailed reason.

Use `python mod/verify_compatibility.py --game-root <Windows-folder> --inspect`
for read-only identification. Without `--inspect`, unsupported installations
exit with code 2. The checker never starts the game, injects code, installs files,
opens saves, or modifies entitlement state.

The v0.04 native UP purchase and ownership-after-restart checks passed. Automatic
embedded Lite and native catalog query/enablement also passed. Live membership, streaming, music,
profile synchronization and complete regression/uninstall acceptance remain.
Keep original UI/media and profile fields intact.

## v0.04 local pack bridge

`v004_pack_bridge.py` provides a working local archive transport for this exact
identified build. Export a pack from fanservice, close the game, then run with
Python 3.11 or newer from the repository root:

For a file-selection window, open `mod/v004_pack_bridge_ui.pyw` with Python.
Choose the Windows folder containing CockHero, choose the exported pack, and
click Install pack for next game launch. The window displays an installation
receipt and the next steps. Python must include tkinter (standard Windows
Python installations do). The window is a local pack installer; it is not an
embedded game menu.

```powershell
python mod/v004_pack_bridge.py --game-root 'E:/fanservice-mod-lab/v004-native/game' --archive 'E:/fanservice-mod-lab/v004-native/input/native-up-two.chpack'
```

Those are the isolated acceptance paths. Supply your own Windows game folder
containing CockHero/ and your exported archive for normal use. Both .chpack and
.chpack.zip inputs work. The bridge checks all four build hashes, validates the
archive and copies its exact bytes under a unique readable name into the native
packs directory. Start the game, open Unlocks, unlock/enable the pack through the
ordinary game controls, then start gameplay. The game performs its own extraction
and uses its own UP and ownership state. Large packs are limited to 512 MiB
compressed/expanded and 256 MiB per media file.

This transport is separate from the embedded runtime and does not provide
streaming. Supply --custom-id custom:your-pack to update the same native pack
identity; omitting it creates an independent pack. The ownership ledger records
payload hashes even after the game consumes an archive. With the game closed,
use --list to inspect owned packs and --uninstall custom:your-pack to remove one.
Updates and removals invalidate only verified owned caches. Unknown or changed
files cause refusal. Game binaries, original packs and saves are retained.
See [the embedded runtime status](runtime/README.md) for its separate acceptance.

Server/Lite `.chpack` export is independent of this gate. Its implementation and
tests live in the existing Server and shared frontend; browser export does not
claim that the original-game mod works.
