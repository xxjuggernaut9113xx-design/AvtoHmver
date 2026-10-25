# Mobile soundtrack and card delivery - October 25, 2026

This continuation fixes shared browser/PWA/Android music timeline behavior. It
is not a certification of complete original-game mobile parity.

## Changes

The scheduler interleaves events and beats by actual recording time. Events at
the same timestamp precede beats; source order is retained within each lane.
Persistent controls can therefore affect the matching beat instead of being
applied after all beats from a rendered frame.

The checkpointed clock now includes compact beat and one-shot-event high-water
cursors. Heard and skipped positions cannot award beat coins, meter/loot progress
or inventory grants a second time after backwards seek or reload. A forward seek
skips obsolete rewards and starts exactly at the requested boundary. Legacy
checkpoints initialize the ledger from their existing cursors; earlier history
which an old checkpoint did not retain cannot be recovered retrospectively.

Seek reconstructs the latest persistent media/text/background/release/break
controls without repeating item grants or dialogue. Release-start media effects
are preserved even when a later release-end only changes permission. Replayed
controls do not increment draw statistics or reset item-use flags. Previously
visited beats still pulse visually while their progression callbacks stay closed.

Soundtrack session and item timers advance from changes in actual audio position.
A frozen playback clock cannot accumulate active time from animation-frame wall
time. Explicit seeks and large discontinuities rebase instead of counting the
jump as played time. Classic sessions retain their active wall-time clock.
The player's resolved or restored music also passes the shared manifest validator
before assigning audio/map state.

## Verification

`node --test tests/fanservice_rules.test.js` passes 15 cases, including nine new
ordering/seek/replay/restore contracts. Existing XP, meter, coin and pool golden
fixtures remain passing. The run and economy suites also passed during this
continuation. `node --check` passes for play.js and the mobile browser smoke.

The real Server mobile smoke was extended to play an explicitly saved soundtrack
offline, seek backwards, assert unchanged stroke/coin rewards, checkpoint/reload
its delivery ledger and finish once. The main task runs it with the current
fresh Server fixture; code and syntax validation alone do not establish that pass.

## Bounded card and encounter continuation

The player now constructs bounded card queues from retained numeric pattern banks,
heat and difficulty data. Tests compare 128 Blueprint card-timing cases and every
field in 186 native beat-queue cases. Queues carry travel time, rest markers,
remaining stroke counts, fired/in-flight entries and once-only completion state.
Mid-card checkpoints preserve the queue and random cursor. Item speed/count
changes rebuild only future entries; patterns containing rests count actual
stroke entries, so doubling cannot leave a permanently unfinished card.

Sequence completion produces enemy/Succubus metrics and the source-derived run
currency, cooldown and equipped-item reward hooks. A media draw alone awards no
defeat. Tribute uses actual button events and records one event per press until
the source target is reached, preserving Devil-card restrictions and Tower reward
settlement. The real browser economy check completes five queues through Run.advance
using their calculated end timestamps and verifies their metric/currency producer;
it also completes a Tribute objective through two actual UI button events. This
is deterministic browser integration, not physical real-time encounter parity.

The full browser suite exercised mobile offline music, forward/backward seeking,
checkpoint/reload deduplication and natural completion; Tower flow, economy,
local-media readiness and durable pins also passed. A sync assertion initially
checked revision before its async UI handler finished; the check now awaits its
completion message and its focused rerun passed. No failures are relabeled passes.

## Remaining parity boundaries

The implemented queues and known golden fixtures are a verified subset. Legacy
Edge item type 2 is absent from the newer available item/catalog capacity model;
its old debug-default 99 charges are not a valid production grant. Full edge
production, all card/event interactions and whole-session parity remain open.
Accepted speed-change events also lack a source-established shared runtime effect;
caption-only edge handling is not full parity. These limits remain visible rather
than being filled with invented thresholds or progression.

Physical cloud providers, revoked access, eviction and full storage remain distinct
phone acceptance checks. The user's positive iPhone HTTPS offline restart/play/
seek result closes only that specific physical check. Android 0.3.10 is an updated
debug-signed test package, not a release signing or physical-provider certification.
