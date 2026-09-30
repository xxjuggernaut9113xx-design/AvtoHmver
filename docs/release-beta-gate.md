# Curator 0.4 beta gate

The following parity records must have current evidence before a beta tag is
published. Record results in the linked evidence files and change status only
in [the status table](parity/STATUS.md).

1. A-01: Host and Server use the same typed operations for core library,
   source, download, settings, and player state, with HTTP contract tests.
2. A-04: role, library-lock, maintenance, and shutdown denials are exercised.
3. L-01/L-02: populated Windows Host grid and table browsing, source tree,
   filters, selection, and pagination work with a disposable library.
4. L-03: automatic and human rating provenance, approve, skip, and undo work.
5. P-01/P-02: installed Windows Host plays images, videos, and audio, including
   rapid switching, seek, speed, volume, and shutdown.
6. M-03/M-04: download status and pause/resume plus source-list import/export
   work through the native Host.
7. C-03/V-02: signed or unsigned release artifacts install and upgrade;
   uninstall preserves the data directory; CI and package checks pass.
8. D-01/D-02: Host tray operation and a real two-device tailnet run pass.

## Two-device tailnet release check

Use a disposable Host library and a second device signed into the intended
tailnet. Record software versions, both device names, listener port, and the
Host instance ID in private release evidence. Do not publish tokens or IPs.

1. Launch Host and confirm localhost, LAN (when enabled), and Tailscale/MagicDNS
   addresses in Remote Access settings. Confirm the configured port.
2. Connect the second device through the Tailscale address, then MagicDNS.
   Check `/api/system/info` and browse/stream media from the phone client.
3. Close the Host window to tray. Confirm the same remote stream and library
   request still work. Restore Host from tray.
4. Connect Viewer to the same Host. Attempt a permitted read and every denied
   Host-only operation in [the permission matrix](permissions.md); confirm
   server-side denial, not only a disabled control.
5. Move the Host to another tailnet address or simulate the peer inventory
   change with the checked-in [fixture](../tests/fixtures/tailscale-peer-inventory.json).
   Confirm Viewer rediscovers only the same
   instance ID and renegotiates permissions. A changed instance ID must fail.
6. Quit Host and confirm the listener and workers stop. Relaunch; the data lock
   should permit the new process and reject a concurrent second opener.

The real two-device run is a manual release gate. Automated fake peer inventory
tests cover the identity and rediscovery logic but cannot prove real tailnet
reachability.
