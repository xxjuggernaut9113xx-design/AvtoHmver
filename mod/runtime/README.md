# v0.04 embedded adapter candidate

This module attaches the shared Lite frontend inside the ordinary native Import
menu. It uses reflected UGameplayStatics::SpawnObject, allowing the game to build
the browser with its own construction parameters. It does not invoke the direct
UE4SS StaticConstructObject wrapper that crashed in development.

The original Import access flow and Back control remain intact. Attachments are
scoped to the visible Import menu. Closing that menu, changing its owning widget
or native store, or reloading the native save revokes queued bridge requests.
The configured origin must use HTTPS unless it is localhost/127.0.0.1.

Scripts/bridge.js provides the injected native pack panel. It can query, purchase
and enable/disable native fanservice-prefixed packs through CHPackStoreController.
The game remains authoritative for UP and ownership. No JavaScript wallet or
direct save editor implements these operations. This panel does not yet register
new live definitions or stream Server media into native gameplay.

The candidate targets only the exact v004-exclusive-c645757d identity. Loader
startup, automatic browser attachment, Lite interaction and native Back passed in
the isolated game. The Game packs panel queried the native three-UP balance,
disabled and re-enabled an owned pack, and rejected a 999-UP purchase without
changing the balance. Closing and reopening Import revoked the old bridge and
created a fresh browser generation. A successful new purchase through this
panel, live streaming and full installer/regression acceptance remain pending.
The full-mod supported-build registry remains empty.

Development layout: install this directory as ue4ss/Mods/Fanservice with only
Fanservice enabled in mods.txt. Set server-origin.txt to the Server origin. The
pinned development loader is recorded in ../compatibility.json. No commercial
game files are included or replaced by these source files.
