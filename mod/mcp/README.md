# Packaged-game runtime MCP

This local stdio MCP server connects to the Fanservice UE4SS mod in the exact
v004-exclusive-c645757d game. It is separate from EngineWire's editor connection.
The native mod must implement the matching file-IPC poller and be loaded.

```powershell
npm ci --prefix mod/mcp
node mod/mcp/server.mjs --runtime-dir 'E:/fanservice-mod-lab/v004-native/game/CockHero/Binaries/Win64/ue4ss/Mods/Fanservice'
```

Alternatively set FANSERVICE_RUNTIME_DIR to that absolute mod directory. The
server exposes native_status, native_catalog and native_profile as read-only
diagnostics. Two explicitly requested test actions are also available:
native_enable_fixture enables only the fixed already-owned synthetic pack named
by local mcp-test-pack.txt, using the original native backend; native_probe_video
starts a fixed localhost video on a separate native decoder object. These tools
take no arguments and are marked as mutations. The enable operation is idempotent;
starting a new decoder probe is not. The native mod validates the exact test
identity and owned state. No UP purchase or grant is performed.

There are no generic game-input, arbitrary-code, purchase/toggle, save-editing,
caller-selected URL or filesystem-path tools. Original Unlocks remains
authoritative for normal pack controls.

Requests use a fixed ASCII packet with protocol marker, a random 32-hex nonce,
Unix timestamp and one allowlisted action. An exclusive lock serializes clients.
Replies must identify the nonce, protocol and exact build; they are bounded to
4 MiB and must be regular files. Links and linked runtime directories are refused.
The default request deadline is 15 seconds. Cancellation releases owned IPC files.

Unrelated or stale lock/request files are never removed automatically. Foreign,
malformed or oversized reply files are retained for inspection. A killed native
process may leave a late reply; it cannot satisfy a later request with a different
nonce. Inspect stale IPC files while no client is running before removing them.
The transport assumes the runtime directory belongs to the current local user;
it is not an authorization boundary against another process with the same write
access. No listener is exposed to the network.

Run npm test --prefix mod/mcp for filesystem/protocol and real stdio MCP tests.
