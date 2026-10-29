# v0.05 companion continuation — 2026-10-29

The original music and media acceptance remains recorded in
[native media acceptance](NATIVE_MEDIA_V005_20261029.md). This continuation ports
the companion to the exact v0.05.1 Public executable without replacing the
original Import entitlement check, purchase controls or enable/disable controls.

## Verified backend

- Both native builds have explicit immutable identity configurations. v0.04
  remains the default. Profile bindings and persisted sessions include build
  identity, preventing cross-build reuse.
- The v0.05 helper accepted the isolated game's actual profile heartbeat,
  returned its companion state and delivered a neutral Server recording into
  `CockHero/beatmaps/fanservice-1-eef41b5cb952e373cb62`.
- That live delivery converted the 12-second neutral recording into PCM WAV
  with 24 stroke beats. Its returned title was `synthetic-tone.m4a`.
- Delivery checks profile, epoch and revision before publication. Invalidation
  during download/publication preserves the previous library and removes only
  the new output. The browser cannot supply destination paths or wallet writes.
- The v0.04 installer includes the music worker's static module dependencies.

Private live evidence is retained under
`E:/fanservice-mod-lab/v005-ui-20261029/live-host-result.json`. No private game
binaries, account data, recordings or extracted assets are included here.

## Experimental in-game entry

`mod/runtime-v005/Scripts/` contains an independent main-menu adapter, an
age-dismissal guard and bounded companion controls. It uses the build's actual
`/Script/WebView.WebViewWidget`, not the absent standard WebBrowser widget.
The original Unlocks menu remains authoritative. Music delivery targets the
original Playlist library; no alternative playback engine is claimed.

The guard passed its live denied-before-dismissal and allowed-after-dismissal
checks. Reflected widget construction and native browser sizing were observed.
The first browser-loading attempt did **not** return its document-title
handshake and was removed after 30 seconds. Static inspection found both
unavailable-window discards and reversed argument semantics in this shipped
plugin's `LoadString` backend. The adapter sets `urlInitial` before normal UMG
attachment and uses `LoadURL` for retries.

That correction passed live acceptance: the independent Fanservice button
rendered, its title handshake completed, and clicking it opened the configured
Server library. The native controls returned the saved profile and delivered
track 1 through the browser/Lua/helper/Server path. The UI confirmed the saved
title and the new original-library directory was
`CockHero/beatmaps/fanservice-1-bed20393d4650d646078`. Closing the panel restored
the original menu and advanced the companion generation from 3 to 4.
The original Playlist manager remained accessible. Returning through its Back
control restored the entry, and the configured Server panel opened again.

The [v0.05 runtime installer and launchers](../../mod/V005-RUNTIME-QUICKSTART.md)
now install this component against an existing pinned loader. Actual isolated
install, helper readiness, game heartbeat, upgrade, remove and reinstall pass.
Removal retains protocol bytes and a disabled manifest; reinstall restores the
code without discarding that data. Seven loader/settings/save files remained
byte-identical. The restarted native library discovered all 14 beatmaps after
the panel's new delivery. See [installer evidence](evidence/native-v005-runtime-installer-20261029.json).
This remains an experimental component, not full-mod certification.

## Validation and remaining work

83 native/MCP tests, 24 v0.05 installer tests and 21 v0.04 installer tests passed.
These include the Lua menu-guard cases, v0.05 control tests, cross-build
identity separation, music publication and stale-context cancellation.

Remaining: snapshot/sync acceptance through the panel, profile switching and
broader original-session regression. Full supported-build certification remains
open. Broader mobile/provider and full-session parity gates are unchanged.
