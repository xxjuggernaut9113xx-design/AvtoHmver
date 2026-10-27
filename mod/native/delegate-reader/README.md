# Exact v0.04 checked-delegate reader

This separately owned Windows x64 Lua module reads the original game's checked
delegate layout. It does not modify original delegates, saves, controls, media,
or progression. Its optional scratch factory creates and roots only its own new
native managers. It is diagnostic infrastructure, not an active rhythm adapter.

The exact original PDB establishes an inline multicast invocation-list header at
delegate offset 8. The checked outer container stores an array of **unchecked**
elements: stride 16, weak object at entry offset 0, and FName at entry offset 8.
The pinned UE4SS SDK uses the incompatible outer unchecked layout.
This module uses only explicit copied layout fields and the normal SDK weak
reference and name operations, never the SDK delegate containers.

`native-layout.json` records the exact original PDB type chain. InvocationList
type 0x7d3b resolves to full array type 0x15155, whose element is unchecked
TScriptDelegate full type 0x10d3d. The separate checked TScriptDelegate type
0xb9b5 is 24 bytes but is **not** this array's element type. Earlier V1/V2 builds
used that incorrect element stride; those failed read-only probes are retained
as evidence and are superseded by V3.

The only accepted game SHA-256 is
`c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f`.
The only accepted UE4SS SHA-256 is
`ce5e3c46a920cc00b2817ac61e438c9162830290379d0b5b9c4dfc2b29459290`.
The game and loader are hashed before registration. Each callback also requires
the game thread. This is deliberately not a general memory API or a security
boundary against other trusted native/Lua mods.

## Lua interface

`package.loadlib(absoluteDllPath, "luaopen_fanservice_delegate_reader")` returns
the initialization function. Call it once in an existing UE4SS-owned Lua state.
On successful registration it returns no results; on a caught initialization
error it returns the error string. Check that the expected global exists.

`FanserviceReadCheckedBindings(addressInteger, kindInteger, indexInteger)` returns
three primitive values: count, resolved object address, copied UTF-8 function
name. Index 0 reads only the count and returns zero/empty for the other values.
Indexes 1 through count read individual bindings. Expired weak references return
zero/empty. Invalid inputs or unstable/unreadable data raise an error through
UE4SS's normal registered callback error handling.

Fixed kinds:

- 0: PreciseBeatWidget.OnBeatReachedCenter, delegate offset 792.
- 1: BeatSpawnerManager.OnBeatSpeedChanged, offset 56.
- 2: BeatSpawnerManager.OnSequencePaused, offset 80.
- 3: BeatSpawnerManager.OnBeatFired, offset 120.
- 4: BeatSpawnerManager.OnBeatHitCenter, offset 144.
- 5: BeatSpawnerManager.OnSequenceEnd, offset 168.

The Lua caller must establish valid exact classes, current profile and manager
generation before passing an address. Read count, then each entry, then count
again. Reject changes and reread the full bindings immediately before any later
ownership-sensitive action. A matching count alone does not establish stable
membership. Addresses are process-local observations, not durable identities.

Counts and capacities above 64 are refused. Pointer addition, alignment,
VirtualQuery page readability and exact ReadProcessMemory byte counts are
checked. Each selected weak/name entry and its header are read again to reject
changes. Normal SDK FWeakObjectPtr.Get validates object index/serial and liveness.
Separate SEH leaves guard weak resolution and name conversion. These defenses
do not establish atomic snapshots against arbitrary concurrent memory edits.

The native DLL is pinned until process exit because UE4SS retains callback
function pointers. It must not be unloaded or overwritten for hot reload. Use
a normal game restart for binary updates. The temporary LuaMadeSimple wrapper
does not own or close the Lua state; registered dispatch uses UE4SS's existing
state owner. No raw Lua C API is linked.

## Owned scratch root leases

`FanserviceCreateScratchRoot(gameInstanceAddress)` returns a positive monotonic
lease token and the newly created manager address. It validates the input by
matching a live exact `BP_CHGameInstance_C` instance from the normal SDK object
inventory, then constructs the exact native BeatSpawnerManager with that outer,
transient flags and an automatically unique name. Caller-supplied managers are
never adopted. Weak manager/outer/class identities are retained with the token.

Construction uses the game's reflected `GameplayStatics.SpawnObject` through
`ProcessEvent`, after validating its three pointer parameters and return layout.
The V4 direct SDK `StaticConstructObject` factory crashed before returning: the
installed loader converted `SubobjectOverrides` to offset 0x80 while the exact
game's constructor requires 0x90. That factory is removed. Successful V5 runtime
creation establishes only the reflected factory path, not original-session adoption.

Each newly rooted lease automatically receives a scoped ProcessEvent pre-hook
guard for the native `OnBeatReachedCenter` UFunction. The function, its single
40-byte `BeatEvent` parameter, and all six numeric field types/offsets/sizes are
validated before the guard becomes active. Only the exact weak manager/class/outer
identity and monotonic lease generation are eligible. No external manager can be
registered. Releasing a stopped, empty lease removes only its own scope; the pinned
global callback remains inert for every untracked object.

`FanserviceScratchGuardStatus(token)` returns seven integers: admitted events,
suppressed events, malformed events, changed identities, generation, and bypassed
calls, followed by decoder-clock deferrals. Admission means permission to execute the native function, not proof of its
gameplay completion. Previously prevented or stopped-manager calls bypass the
ledger. Only game-thread calls are considered. A later event with the same ordinal
must retain all five other semantic fields; padding is ignored. Identical repeats,
changed identities, nonfinite/malformed values, and ordinals outside 1..4096 are
suppressed through the supported `PreventOriginalFunctionCall` API. Time is bounded
to one day, pattern indexes to 0..4095, and nonnegative multipliers to 1000.
Fresh leases get fresh ledgers. Native direct calls and delayed native lambdas are
outside this reflected proof; this API does not authorize original-session takeover.

`FanserviceSetScratchClock(token,position,playing)` returns true after updating
only that live owned lease's guard on the game thread. Position must be finite
within 0..86400 seconds; backwards updates support explicit seeks. Clock gating
starts disabled for each fresh lease and becomes enabled on its first update.
While paused or before an event's target reaches the last observed decoder time,
an unseen reflected callback is deferred without consuming its beat identity. Deferrals
increment only the seventh status counter. Event validity is checked first, so
malformed events still increment malformed/suppressed. Already admitted ordinals
are classified as duplicates or changed identities before clock gating, including
while paused or after a backwards seek; the existing ledger prevents replay rewards.
The caller must explicitly redeliver eligible deferred events; the helper does
not retain a callback queue, extrapolate time, or operate original managers.

## Owned audio player leases

`FanserviceCreateAudioRoot(actorAddress)` creates and roots a fresh exact native
`/Script/MediaAssets.MediaPlayer`, returning its opaque positive token and address.
The actor must match the live SDK inventory and be either the exact
`BP_GlobalManager_C` or a `PlayerController` subclass. The same reflected factory
and pre-existing-object exclusion used for scratch managers applies. Existing
players are never adopted. The actor, player, and exact native class are tracked
with weak identities. The audio table holds at most eight leases and its token
range starts at 4294967296.

Acquisition and release require the player to be closed: reflected `GetUrl` returns
an empty `FString`, and both `IsReady` and `IsPreparing` return false. Each native
query validates its exact MediaPlayer owner, native instance-function flags,
single return parameter, offset, size, property type, and return flags before
dispatch. Bool byte storage is also validated. No guessed MediaPlayer field
offsets are read. The root protects the player across Lua wrapper collection;
the live actor remains the caller's ownership boundary.

Call the player's normal `Close()` first, then
`FanserviceReleaseAudioRoot(token)`. Unknown/already-released audio tokens return
false; tokens below the audio range are rejected. Changed identities, changed
root flags, nonempty URLs, ready players, or preparing players retain the lease
and raise an error. The caller must retain the token and retry cleanup rather
than discard a failed release. Releasing clears only this fresh player's root;
it does not close players or alter any original game player. Audio leases do not
install beat guards.

The lease table allocates its slot before setting the root flag. Acquisition
requires an initially unrooted, stopped manager with an empty queue. Root flag
readback is checked. Failed acquisition rolls back only a verified flag set by
that acquisition; uncertain state retains the lease and reports its token.

`FanserviceReleaseScratchRoot(token)` returns true once, false for an unknown or
already released token. It rejects changed weak/class/outer identities or changed
root state, and requires the running bit at manager offset 264 to be clear and
the queue count at offset 232 to be zero. It clears only that lease's root flag
through normal SDK APIs and verifies readback. Failures retain the lease.

Stop and clean all owned probe widgets/timers/queue before release. This module
does not stop sequences or clean widgets. After release the manager may be
collected; do not reuse its wrapper or address. Active leases survive Lua reload
because the DLL is pinned, so callers must retain their tokens and release in a
finally path before hot reload. At most eight leases are allowed per module.
No manager or root from another module, the original session, or a previous
untracked object is accepted.

## Build

Dependencies stay outside the repository. Obtain authorized UEPseudo headers at
`fbb4fdd3fffc59d5b5268b23a643f500f702115e` and public RE-UE4SS headers at
`8333063595fa3c49ad307f3b0f732accbb760d25`. The external dependency root contains
`UEPseudo`, `RE-UE4SS`, `fmt`, `zydis`, and `zycore`. Required header versions are
fmt 11.0.2, Zydis 4.1.1, and Zycore 1.5.2; they supply compile-time header
dependencies and are not separately linked into the module.

Run Python 3.11+ `build.py` with `--dependencies`, `--loader`, and `--output`,
each an absolute path. `--vcvars` can select the VS 2022 x64 environment script.
The script verifies the loader, extracts its actual exports into an import
library, compiles with MSVC `/MD`, runs both standalone contract suites, and writes
`build.log` and `build-manifest.json`. The manifest records source/header hashes
and the DLL digest. C++23 preview is required by the pinned headers' `#elifdef`
directives. Build does not install anything or start the game.

Contract tests cover fixed offsets, exact stride/field positions, invalid kinds
and indexes, alignment, count/capacity bounds, overflow, and header changes.
The shared production argument reader consumes LuaMadeSimple integer arguments
in reverse stack order because `get_integer(position)` removes that element.
Consumptive mock-stack cases verify distinct object/kind/index inputs and the
exact 3, 2, 1 access order, including count-only and individual-entry requests.
The lease suite shares the production lease table with a fake native backend.
It covers fresh creation, foreign roots, weak/outer changes, stopped/empty release
guards, duplicate release, simulated collection, rollback and retained retries.
They do not replace original-game acceptance of live binding reads, callback
lifetime, stale objects, or subsequent rhythm integration.
