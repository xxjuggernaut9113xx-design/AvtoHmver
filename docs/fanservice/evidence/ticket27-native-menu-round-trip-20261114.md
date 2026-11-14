# Ticket 27 native menu round trip

Verified November 14, 2026 in one isolated Windows game process with a disposable profile and a local Server seeded with generated color-bar media.

- Game build `v0051-hotfix-public-a8f46896`. Packaged executable SHA-256 `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`.
- UE4SS SHA-256 `ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290`. CEF readiness helper SHA-256 `278ba5379ecc43c41fe3142d629a0ade0e1f447d5f2a102bf4f9f89fa7a04c86`.
- Fanservice menu adapter commit `fd99eef5`, script SHA-256 `755e645b06dc38fd7ffb2fb7aec5aa915c85d36308845f874e586550e9e93397`.

The adapter waited while the startup confirmation was visible. After dismissal, the original menu displayed one Fanservice entry below Quit with the six original controls. The test then used the fitted game window on the secondary display.

1. Opened Fanservice from the native menu. Collections showed the fixture’s Parity Sources. Selecting Parity Source 001 switched back to Library, applied Source 1 scope and showed generated media thumbnails.
2. Fanservice Back restored the original menu and a single Fanservice entry. Original Unlocks opened at 5 UP and its Back control returned to the original menu.
3. Reopened Fanservice and confirmed Library populated with the fixture’s image and video entries. The second Fanservice Back again restored the original controls and one Fanservice row, with no stale panel or duplicate entry observed.

The original-game log records two panel openings and a fresh entry-document handshake after each return. The test exercised browsing and menu navigation. No pack, wallet or real profile was modified. The isolated game and local fixture Server were closed after verification.
