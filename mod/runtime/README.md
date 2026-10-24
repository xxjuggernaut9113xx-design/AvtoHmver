# v0.04 embedded adapter candidate

This module attaches the shared Lite frontend inside the ordinary native Import
menu. It uses reflected UGameplayStatics::SpawnObject, allowing the game to build
the browser with its own construction parameters. It does not invoke the direct
UE4SS StaticConstructObject wrapper that crashed in development.

The original Import access flow and Back control remain intact. Attachments are
scoped to the visible Import menu. Closing that menu, changing its owning widget
or native store, or reloading the native save revokes queued bridge requests.
The configured origin must use HTTPS unless it is localhost/127.0.0.1.

Purchases and enable/disable controls stay in the original game's Unlocks menu.
Scripts/bridge.js provides only a read-only native catalog transport. The former
injected Game packs panel and its mutation commands were removed at the user's
request. Embedded Lite labels its saved definitions Pack drafts, offering export,
edit and delete without a browser UP wallet or ownership controls. The game stays
authoritative for purchases and ownership. This component does not yet register
new live definitions or stream Server media into native gameplay.

The candidate targets only the exact v004-exclusive-c645757d identity. Loader
startup, automatic browser attachment, Lite interaction and native Back passed in
the isolated game. The Game packs panel queried the native three-UP balance,
disabled and re-enabled an owned pack, and rejected a 999-UP purchase without
changing the balance. Closing and reopening Import revoked the old bridge and
created a fresh browser generation. On 2026-10-24 the user purchased the synthetic
one-UP pack through this panel, observed the balance change from three to two UP
and confirmed Owned. The native log independently confirms successful unlock and
enablement. Live streaming and full installer/regression acceptance remain pending.
The full-mod supported-build registry remains empty.

Development layout: install this directory as ue4ss/Mods/Fanservice with only
Fanservice enabled in mods.txt. Set server-origin.txt to the Server origin. The
pinned development loader is recorded in ../compatibility.json. No commercial
game files are included or replaced by these source files.

Inspect installation ownership without changing files or closing the game:

```powershell
python mod/v004_runtime_installer.py status --game-root 'C:/Games/CockHero/Windows'
```

The report distinguishes an intact owned runtime, missing/changed owned files
and pre-existing unowned loader files. A manually installed development loader
is reported as unowned and is never overwritten or adopted automatically.
This read-only report does not declare full-mod compatibility.

The experimental component installer now passes its read-only catalog acceptance gate for
the exact recorded v0.04 build. With the game closed, use the pinned loader ZIP
identified in ../compatibility.json:

```powershell
python mod/v004_runtime_installer.py install --game-root 'C:/Games/CockHero/Windows' --loader-archive 'C:/Downloads/UE4SS_v3.0.1-1181-g83330635.zip' --server-origin 'https://your-server.example'
python mod/v004_runtime_installer.py remove --game-root 'C:/Games/CockHero/Windows'
```

Existing unowned loaders are rejected. Installation does not grant full-mod
support or provide native live streaming, music or profile synchronization.
