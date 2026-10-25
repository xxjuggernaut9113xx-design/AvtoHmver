# Native companion live continuation — October 25, 2026

This follows commit 3e9fff21. Exact v0.04 Exclusive build only. Full mod support
and original rhythm-session integration remain incomplete.

## Observed in the original runtime

The previously running game had exited before this continuation. A normal launch
of the existing isolated executable used the established lab profile arguments.
No age confirmation, menu input, hot reload, gameplay start or reward call was
performed. The game was left running for the user.

The pinned UE4SS log reports the revised main.lua and its Init/ReloadSave hooks
loaded. The fixed native status query returned PlayerSave/user 0, a valid native
save/store, and 4 UP. The owned synthetic pack remained enabled.

The fixed neutral AAC probe constructed native media objects and made HTTP GETs
to localhost:42170/synthetic-tone.m4a. The subsequent native status reported
`Native soundtrack clock is invalid` at music.lua:156. Position remained zero;
there is no accepted playback, audible-output or seek result. The old diagnostic
did not include the actual rejected duration/position, so the precise invalid
value is unknown. Zero metadata is a candidate, not an established root cause.
A later UE4SS callback also logged a missing-userdata error; it is unresolved.

A production worker launched directly, verified all four original build hashes,
and accepted a direct companionread IPC packet bound to the real native heartbeat.
The reply had schema 1, PlayerSave/user 0, revision 0 and no imported definitions,
snapshots or sync. The native balance was still 4 UP. This proves the worker /
real-heartbeat profile boundary, not embedded browser invocation or native sync.
The test removed only its matching request/reply. Companion profiles were retained.

## Windows launcher correction and acceptance

The isolated staged launcher predated the already committed argument-parenthesis
fix; it passed an invalid storage-root value. The known old file was backed up
and replaced with the current launcher, preserving all other lab files.

The live shutdown attempt exposed a separate FileShare conflict: .NET ReadAllText
could not open the lock while Node held its writable handle. The launcher now
uses a bounded 32-byte FileStream read with ReadWrite/Delete sharing, validates
the owner token, and uses the existing nonce-bound graceful shutdown protocol.
It does not kill the worker or unrelated processes.

With the corrected launcher and explicit isolated companion-data root, actual
hidden worker startup, production build verification/readiness and graceful
shutdown all passed. Its profile data remained. The worker was stopped after
validation; the game was left running. An added Windows process test holds a real
Node lock and checks shutdown and retention of a profile sentinel.

## Decoder recovery changes

The source now treats a ready decoder's zero duration as pending metadata, with
a 120-second deadline and no original-audio suppression before usable metadata.
Invalid clocks include observed values in diagnostics. Lost decoder readiness
gets a new bounded opening window. Buffering is bounded to 120 seconds; an
unmoving playback clock reports stalled after 2 seconds and fails after 30,
closing owned objects and restoring only original audio it paused. Intentional
pause has no stall timeout. Observed progress, seek and reconnect rebase monitoring;
unrequested backwards clock movement fails instead of replaying timeline events.

These final decoder changes are source/model verified. They were not hot-reloaded
into the game. The earlier watchdog revision loaded on the normal launch; the
metadata change requires the next normal load.

Validation: 35 top-level native tests pass, including 30 nested Lua audio cases;
12 installer/launcher tests pass, including actual hidden Node startup argument
validation and live-lock Windows shutdown. Lua parses for all three runtime
modules. No runtime audio acceptance flag or supported-build entry was enabled.

## Rhythm seam and unresolved ownership

Retained exact-build evidence at C:/Users/webma/analysis/cockhero-v004 includes
matching PDB GUID/age, native-reflection-schemas.json, native-symbol-addresses.tsv,
GetMasterTimelinePosition-beat.c, PauseSequence-beat.c and the BP_GlobalManager
ExecuteUbergraph / BeatComplete function JSON. The decompiled PauseSequence body
has a truncated-control-flow warning; it cannot establish all side effects.

The direct C++ clock reads reflected MasterTimeReference and TimelineOffset.
Rebasing those fields on the game thread is a candidate clock seam. Precise beat
widgets maintain independent timing fields, so manager-only rebasing is insufficient.
BP_GlobalManager creates BeatSpawnerManagerCPP and binds hit/sequence delegates.
BeatComplete updates lifetime strokes and rewards. Backwards seek must not replay
past hit delegates. Existing cleanup globally enumerates widgets and must not be
copied for an ownership-scoped adapter.

Still required: an owned session/beat/widget lifecycle; safe FBeatEvent array
construction; game-thread tick ordering and pause behavior; deduplicated seek
rebasing; actual audio-clock/decode/seek acceptance; native stream/offline/sync
and full-session regression/removal acceptance. The supported-build list stays empty.

Local live-profile evidence and rollback files are under
D:/reJOIce/Deliverables/fanservice-native-companion-20261025/ and
E:/fanservice-mod-lab/v004-native/backups/audio-watchdog-20261025-131330/.
