# v0.04 native rhythm adapter boundary

Investigation checkpoint, October 25, 2026. Exact `v004-exclusive-c645757d` only.
This is a construction/ownership specification, not an activated adapter or
original-game gameplay acceptance. No target input or gameplay was performed.

## Corroborated sources

The retained original-build evidence is under
`C:/Users/webma/analysis/cockhero-v004/`. `pdb-match.json` reports matching GUID
and age. `native-reflection-schemas.json`, `widget-default-reflection-schemas.json`
and `native-symbol-addresses.tsv` establish native field and method identities.
`ghidra-native/integration-decompiled.c` contains original native bodies. Some
bodies have truncated-control-flow warnings; those limitations remain material.
The reconstruction's `RecoveredBeatTimeline` is useful reference code, but is
not proof of original-game behavior or an interchangeable class.

Pinned loader source is commit `8333063595fa3c49ad307f3b0f732accbb760d25`:
[LuaTArray.cpp](https://github.com/UE4SS-RE/RE-UE4SS/blob/8333063595fa3c49ad307f3b0f732accbb760d25/UE4SS/src/LuaType/LuaTArray.cpp),
[LuaUObject.cpp](https://github.com/UE4SS-RE/RE-UE4SS/blob/8333063595fa3c49ad307f3b0f732accbb760d25/UE4SS/src/LuaType/LuaUObject.cpp),
and [LuaXDelegateProperty.cpp](https://github.com/UE4SS-RE/RE-UE4SS/blob/8333063595fa3c49ad307f3b0f732accbb760d25/UE4SS/src/LuaType/LuaXDelegateProperty.cpp).

## Event representation and array construction

`FBeatEvent` occupies 40 bytes. All six fields are reflected numeric values:

- `AbsoluteFireTime`: double at offset 0.
- `TargetHitTime`: double at offset 8.
- `PatternIndex`: int32 at offset 16.
- `Interval`: double at offset 24.
- `BeatNumber`: int32 at offset 32.
- `CustomMultiplier`: float at offset 36.

`UBeatSpawnerManager.BeatQueue` is the reflected array at offset 232. Its native
`CurrentBeatIndex` is zero-based; Lua array access is one-based. The native queue
builder starts BeatNumber at 1 and increments it for every entry, including rest
entries. Native Tick advances past negative CustomMultiplier entries without
creating widgets. The queue builder counts only nonnegative multiplier entries
toward requested stroke count; a rest must not increase TotalStrokes.

The pinned Lua array setter appends via AddZeroed, then dispatches the inner
struct converter. A complete ordinary Lua table is the candidate safe input for
this numeric-only struct. Append contiguous indexes only, reacquire elements
after any append, and fill every field. Do not retain borrowed element wrappers
across reallocations. Do not replace the entire queue with a Lua table: the
pinned converter placement-constructs an array without freeing existing storage,
and table traversal is not a numeric-order guarantee. Do not assign a live
TArray back to itself: whole-array assignment can empty its source before copying.
The pinned element handler can also grow an array on an out-of-range read; never
probe nonexistent elements. Its empty-array sparse-index branch allocates only
one element, so the first assignment must be index 1. FBeatEvent does not have the
string/container lifetime concerns of FCHPackMediaEntry.

The isolated construction proof below passed: construct a temporary manager with no delegate
bindings, leave it stopped, append two complete event tables, read every field
back, append a third to exercise reallocation, then verify previous values and
empty only that temporary queue. This was executed in the isolated original
runtime. Do not use the original live manager as the construction scratchpad.

## Exact widget ownership is available

Original `CreateTestBeatWidget` at 0x1481d0c70 constructs the configured widget
class, binds its OnBeatReachedCenter delegate to that exact manager's
OnBeatReachedCenter function, and starts synchronized movement. The pinned
multicast wrapper's `GetBindings()` returns object/function-name pairs.

A widget belongs to a manager only when its live OnBeatReachedCenter binding
contains that exact valid manager object address and the function name
`OnBeatReachedCenter`. Class name, screen position, visible state, matching event
number, or enumeration membership alone does not establish ownership. Recheck
profile/session generation, current manager identity, widget validity and the
binding immediately before a write. Object address alone is not a durable ID.

Enumeration may discover candidates; only positively matched widgets can be
frozen, rebased, retired or removed. Preserve foreign and ambiguous widgets.
The corrected V3 reader passed original-runtime ownership inspection on October 26. The checked multicast has its array header at +8; its stored delegates are unchecked 16-byte elements, not the separate 24-byte checked single-delegate type. See NATIVE_SESSION_20261026.md for evidence. Mutation, retirement and clock integration still need isolated runtime acceptance.
Do not clear an entire delegate list; any eventual binding change must preserve
unknown listeners and restore only bindings owned by the adapter.

## Two clocks, not one reflected getter

The original manager getter at 0x1481d12e0 uses platform time minus
MasterTimeReference plus TimelineOffset while running, and TimelineOffset while
stopped. Those reflected doubles are at offsets 208 and 216. Original Tick calls
this getter directly in C++; a UFunction getter hook is insufficient.

Each precise widget separately uses reflected MasterTimeReference (824),
TimelineOffset (832), bIsMoving, and CurrentBeatEvent (848). Its NativeTick reads
those values directly and emits the center-hit delegate when its target is
reached. Rebase both the manager and positively owned moving widgets to the
observed audio clock. Freeze both during pause/buffering/seeking. A manager-only
freeze can allow visible widgets to award hits while audio is paused.

The manager and widget clocks need not share reference values; preserve each
object's clock equation. The candidate running correction is
`new_reference = old_reference + observed_native_time - observed_audio_time`.
Never replace the audio clock with elapsed wall time. Game-thread callback order
relative to native Tick and widget NativeTick must be measured before activation.

## Cleanup, seek and settlement hazards

Original `StopSequence` at 0x1481d2bf0 clears queue/index/running state and
broadcasts OnSequenceEnd. It is not harmless cleanup on the original bound
manager. `StartPattern` calls StopSequence first. Calling either against a live
original session can trigger premature session completion. Their decompiled
bodies include warnings, so undocumented side effects cannot be excluded.

Original `ReturnToPool` at 0x1481affa0 sets bIsMoving false and resets visual
state; it does not show a center-hit broadcast in the retained body. It has a
truncated-control-flow warning. Treat it as a retirement candidate requiring
acceptance, not proven side-effect-free cleanup. The existing global widget
cleanup in StartPatternWithMediaSync must not be copied.

BP_GlobalManager creates BeatSpawnerManagerCPP and binds hit/sequence callbacks.
BeatComplete updates lifetime strokes, rewards and metrics. Native center-hit
handling also increments CompletedBeats and may schedule delayed completion.
Widget completion uses delayed cleanup too. Reusing a manager/widget without
accounting for old timer callbacks risks completing or retiring a newer session.

A seek must retire only positively owned old-generation widgets without hit
callbacks, rebuild/rebase future entries, and retain a delivered-event set keyed
by immutable recording/session and beat identity. Forward seeks must not award
skipped events. Backward seeks must not repeat rewards. Sequence-end delivery
must be at most once and bound to the same generation. A fresh queue index alone
cannot provide these guarantees.

Before activation, prove manager lifetime/root ownership, scoped delegate
ownership, array construction/readback, widget retirement, pending timer
invalidation, tick ordering, pause behavior and seek deduplication. Existing
stream/local audio transport acceptance does not close these native gameplay
integration gates.

## Isolated native probe result

The fixed probebeatqueue action passed in the exact isolated v0.04 runtime: three complete rows, retained values after append, stopped TimelineOffset/readback 2.5, and cleanup of its own empty-delegate manager. Native UP remained 4. Evidence: D:/reJOIce/Deliverables/fanservice-edge-rhythm-20261025/native-pod-queue.json. This closes only POD construction/readback and stopped-clock gates, not the active-session gates above.

## Live original-session inspection, October 26

The read-only rhythmstate MCP action now inspects original manager ownership, queue counters, clock and widget candidates. Actual UI testing resumed after Computer Use permission was restored. The lab launched with its explicit -UserDir profile; the human handled age confirmation. The neutral color-bar fixture appeared during a normal original session. Native UP was 4 before and after the observed sessions; the inspector does not grant or settle rewards.

The original manager GetOuter matched BP_GlobalManager. Three samples taken with the original pause overlay visible advanced position 7.444940 to 9.998726 to 12.528505 and CompletedBeats 2 to 3 to 5. The overlay does not establish a paused beat clock in this tested build. This is observation of the unchanged native behavior, not an adapter fix.

Delegate ownership is **not established**. Live moving widgets returned empty GetBindings lists or `Array failed invariants check, ArrayNum exceeds ArrayMax`. The inspector keeps these unknown and reports binding_reader_verified=false. Do not use its counts as permission to mutate widgets.

Exact PDB TPI records explain a candidate ABI mismatch: TMulticastScriptDelegate<FNotThreadSafeDelegateMode> type 0x2612d has size24 and InvocationList at8; TScriptDelegate<FNotThreadSafeDelegateMode> type0xb9b5 has size24, weak Object at8 and FunctionName at16. The unchecked sibling is a different16-byte type. A Guid16 overlay is incorrect. The supported Lua custom-array registration cannot attach the required UScriptStruct metadata, so no Vector24 overlay was installed. A corrected native delegate reader or native helper remains required before widget ownership acceptance.

Raw PDB records, live-manager.json, pause-samples.json, menu-after.json and bounded custom-property feasibility evidence are retained under D:/reJOice/Deliverables/fanservice-native-session-20261026/. No original live manager, queue, delegate, widget clock or timer was written by this inspector.
