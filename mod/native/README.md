# Native Windows companion candidate

The v0.04 companion now implements profile-bound definitions, snapshot storage,
reviewed synchronization and a native audio transport. **Original rhythm-session
integration and in-game acceptance of this revision are not complete.** The
transport is exposed as an Import-menu audio preview and stops when Import closes.
It does not start a game, award progression, replace native beat queues or claim
full music-mode support.

## Installation and normal launch

Use the existing exact-build runtime installer with the pinned loader ZIP and a
real fanservice Server origin. Stop the game and companion before updating or
removing the runtime. The installer refuses a retained companion host lock.

The runtime installer includes the Lua modules, embedded controls, Node worker
and launchers. Node.js 22 or newer is required on the Windows machine. There are
no npm runtime dependencies; Fengari is used only by the development tests.

Run `Start-FanserviceNative.cmd` inside the installed Fanservice mod directory.
It starts the background worker and launches the original game if that exact
executable is not already running. It does not reload an existing process or
operate menus or age confirmation. Updated Lua loads on the next normal launch.
`Stop-FanserviceNative.cmd` requests a nonce-bound graceful worker shutdown without
killing unrelated Node processes. It retains profiles and snapshots.

The worker hashes all four original build files before accepting requests. Wait
for verification before using the embedded controls. An existing foreign or stale
lock is retained for inspection rather than stolen.

The launcher also supports `-CompanionDataRoot <absolute directory>` when called
as PowerShell. Use a separate data root when the same game tree is deliberately
launched with a different `-UserDir`, including the isolated acceptance lab. Save
slot and user index changes within one configured installation remain separate
profiles automatically. Automatic discovery of custom `-UserDir` paths is not
implemented.

## What is wired

- Lua reads the actual native build, save slot/user, save/store objects and pack
  catalog. A profile generation and per-load epoch reject stale work.
- The worker binds storage to canonical installation/build/slot/user identity
  under `%LOCALAPPDATA%/fanservice/native/`, or an explicit isolated data root.
- Definitions retain portable Server selections. Native UP, ownership,
  enablement, progression, local files and paths are not imported or exported.
- Native purchases and Enable/Disable remain exclusively in original Unlocks.
  Snapshot authorization maps a custom ID through the pack bridge receipt ledger
  and rechecks actual native ownership. Soundtrack activation also requires an
  enabled owned fanservice pack.
- Immutable snapshots stage bounded downloads, verify length and SHA-256, publish
  atomically and preserve the previous generation on failure. Session pins survive
  worker restart; native stop acknowledgements release the corresponding pins
  even after a profile change. Uncertain crash leftovers remain visible as pins
  that the user can explicitly release once stopped.
- Server profile sync uses revision checks and an explicit download preview/apply
  step. Connections are profile- and Server-bound. Sync keys cross the page-title
  bridge only inside a one-use P-256/SHA-256/AES-256-GCM exchange. Native progress
  remains unchanged; the existing Server wire format receives a neutral zero
  wallet placeholder with `kind=fanservice-native-companion`.
- The audio module uses the shipped MediaPlayer/MediaSoundComponent APIs. It reads
  `GetTime`, handles pause, buffering, seek observation, reconnect and completion,
  and restores only original audio it paused. Opening/seek operations have
  deadlines. Frozen playback clocks and buffering are bounded; a missing duration
  waits for metadata before muting original audio. The original game's elapsed-time clock is not treated as audio time.
- IPC has no network listener or generic code/path execution command. JSON
  commands are bounded to 64 KiB; larger definition documents transfer in ordered
  bounded frames up to 2 MiB. Selection limits remain 500 IDs, 32 rules and 10,000
  resolved members. Snapshots allow 256 MiB/item and 2 GiB total.

In Import, expand **Native music, offline storage and sync**. Read the companion
profile, save Server pack drafts, explicitly download snapshots, or configure a
companion sync connection. The helper's fixed Server origin must match the
library connection. A static-file server does not provide the required APIs.

For snapshot ownership mapping, install an exported archive through the pack
bridge with the same `--custom-id` displayed for its definition, then purchase
and enable it through original Unlocks. No native ownership is fabricated from a
browser wallet.

## Validation and remaining gates

Run `npm ci --prefix mod/native` and `npm test --prefix mod/native` for real
filesystem/HTTP contracts and Lua lifecycle models. The Lua model runner uses
[Fengari](https://github.com/fengari-lua/fengari), Lua 5.3 semantics; it does not
prove the pinned UE4SS loader's Lua 5.4 marshaling, decoder operation or audible output in the game.

The real Server/browser smoke exercises actual media/AAC downloads, pinned
snapshot retirement, two-profile sync and WebCrypto controls with synthetic
native heartbeats. Production hash verification separately passed against the
exact isolated original build. These are distinct evidence scopes.

The current game process was not reloaded. Computer Use access was denied, and
the user requested an alternative to manual reload. No alternate UI injection or
game-control path was used. The candidate is staged for its next normal launch.

The original BeatSpawnerManager Tick calls its elapsed-time getter directly.
`StartPattern` builds an interval queue; it is not a verified arbitrary beatmap
feed. Session ownership, audio-driven native beat/control dispatch and seeking
past queued events still need an accepted adapter and original-game tests. The
supported-build registry therefore remains empty.

## Later normal-launch checkpoint

[The live continuation](../evidence/v004-native-companion-live-20261025.md) records
successful Lua loading, a real native profile read through the production worker,
and actual Windows launcher start/readiness/shutdown. The neutral AAC URL was
requested by the game, but the initial clock check failed. Later metadata and
stall handling has model coverage and still needs another normal-load runtime
check. This is not audio playback acceptance or full music-mode integration.
