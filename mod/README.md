# Cockhero mod compatibility gate

The Windows product now targets a mod of the original Cockhero game. The
reconstruction remains reference evidence. No original game files are bundled.

**There is no supported or distributable mod build yet.** The registry deliberately
contains no supported builds. Recognizing an executable is not proof that its
import UI, custom catalog, purchases, saves, or streaming hooks work.

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

Continue with an entitled current build and an allowed isolated runtime test.
Prove opening/closing Lite from the native Import action and registering a
synthetic pack in native Unlocks before implementing or packaging the adapter.
Then connect original UP/profile ownership, live/frozen membership, music, and
offline services. Keep original UI/media and profile fields intact.

Server/Lite `.chpack` export is independent of this gate. Its implementation and
tests live in the existing Server and shared frontend; browser export does not
claim that the original-game mod works.
