# #51 — Trigger gate / Timer override / 100%-meter card verification and acceptance re-check — 2026-11-12

Work done on branch `spec/avtohmver-open-tickets` starting at HEAD
`ac7a11f` (local commits only, tree verified clean before starting).
This note records an independent re-verification of the three remaining implementation items
from `docs/parity/evidence/ticket51-queue-consumer-20261111.md` and the
acceptance-criteria re-check against the #51 ticket body (GitHub issue
#51, fetched live 2026-11-12) that
`docs/fanservice/evidence/ticket60-25-gates-20261111.md` explicitly left
undone. No ticket is marked met: the verdict is **OPEN** (see §4).

## 1. Objective-0 card-type gate — verified, no code change

Re-parsed the live trigger block **from the cooked v0.05.1 package**
(`legacy/CockHero/Content/NewSetup/BP_GlobalManager.uasset`,
`ExecuteUbergraph_BP_GlobalManager`, bytecode count 138381 at export
offset 49288) with the repo parser (`tools/evidence/kismet2.py`,
`uasset.py`): 2569 statements, 0 errors, max iCode 99920 — the same
parse the #45 clock note reports. Name indices were resolved against
the package name table rather than trusting the earlier note:

- `@92333` `IsModifierActive?('SuccuFrenzy')`; `@92369` `JumpIfNot
  @93045` (Frenzy false → non-Frenzy branch).
- Frenzy branch: `@92383` `CurrentCardTypeEnum == 3` (CallMath
  Equal_ByteByte, ByteConst 3); `@92414` `PopExecutionFlowIfNot` — the
  block exits unless the card is Succubus (3).
- `@92424` `JumpIfNot @92439` on `HasCumMeterOverideTriggered?`: flag
  set → `PopExecutionFlow` (return, no re-fire). The guard is real and
  sits in the shared path both branches reach.
- `@92439` `JumpIfNot @93019` on `GameInstance.IsCumRound?`: false →
  `@93019` `RoundWinOverride` + set the flag (`@93033`); true → set
  the flag (`@92475`), `Spawn100PercentCumMeterOverrideEvent`
  (`@92486`), `Start Cum Window Timer` (`@92500`).
- Non-Frenzy branch `@93045–93214`: `== 5`, `== 6`, `== 3` OR-chained
  (CallMath BooleanOR, func −238), `@93214` `JumpIfNot @92424`: type
  NOT in {5, 6, 3} → shared fire path; type in the set →
  `PopExecutionFlow` (exit). The polarity is exactly as the corrected
  note states (OR {5,6,3} → exit); the earlier inverted version is
  wrong.

Player alignment: `objectives.js` `cumWindowTriggerGate` (non-Frenzy
`cardType ∉ {3,5,6}`, Frenzy `'Succufrenzy'` modifier → `cardType ===
3`) and `finishCompleteObjective` match the live block; the
`HasCumMeterOverideTriggered?` guard is `player.isAllowedToCum`
(set on open, cleared on expiry). Pinned by the existing test
`release window opens only for the card types the original trigger
accepts` (`tests/fanservice_objectives.test.js`: every objective in
{0,1,2,3,8} × card types {0,1,2,3,5,6,7,8} without Frenzy and
{0,3,5,6} with Frenzy, plus failed-gate retry on the next tick). No
code change was needed and none was made for this item.

## 2. Timer-objective override path — one real bug found and fixed

The seconds path already existed (`tickSecond` in `objectives.js`,
driven from `Run.advance()`; Timer completes only there, never on beat
advance — pinned by the existing `Timer completes only on the seconds
path` test). End-to-end in Classic it goes through the override path:
`finishCompleteObjective` → gate → `openReleaseWindow`
(`isAllowedToCum`, metric 19 `cumWindowsHit`, `releaseDeadline =
now + 60`, event `release-window-opened` with the original
notification `'60s Release Window\nFinish to Win'`) — i.e. the
player's form of `Spawn100PercentCumMeterOverrideEvent` + `Start Cum
Window Timer` + set the flag. It does not end the session directly
(Prejac does that) and does not take the round-win path in Classic
(Tower non-boss rounds return `round-complete`, the player's
`RoundWinOverride` equivalent, pinned by existing Tower tests).

**Bug found (test-first, red before the fix):** after a missed Timer
window, `resetAfterMiss` advanced only the wall baseline
(`baselineDuration`), while Timer completion reads the GM clock
(`gmElapsed` = `gmSeconds − baselineGmSeconds`). The objective
therefore stayed complete and the trigger re-fired on the next second
instead of after another full target — contradicting the original,
where the `Timer Reset` case does `Objective_TimeRequired_Seconds +=
Original Objective Time Required Seconds`. Probe before the fix
(Timer target 10): expiry left `baselineGmSeconds` at 0 and the next
`tickSecond` re-opened the window immediately. The bug bites hardest
at the real default target (300 s): after a missed window at
`gmSeconds` 360 the old code re-fired at once, where the original
requires `gmSeconds` 600.

**Fix** (`static/fanservice/objectives.js`, `resetAfterMiss`): for
objective 1, advance `baselineGmSeconds` by the target in step with
`baselineDuration` (guarded to states that have a GM baseline;
pre-clock saves keep the wall baseline as their fallback). The wall
baseline still advances (Tower deadline display in `play.js` and the
legacy fallback).

**Tests added:**
- `tests/fanservice_objectives.test.js` — `GM objective clock: Timer
  reset advances the GM baseline so the window re-fires only after
  another full target`: opens the window, asserts no re-fire while it
  is open (the `HasCumMeterOverideTriggered?` guard), expires it
  (`'Timer Reset'`), asserts `baselineGmSeconds` advanced, asserts no
  re-fire at `gmSeconds` 161/199 and a re-fire at 200; plus a direct
  `resetAfterMiss` pin (GM baseline advance + int32 wrap).
- `tests/fanservice_run.test.js` — `GM clock: Classic Timer completion
  takes the override path and a missed window re-arms only after
  another full target`: end-to-end via `run.advance()` at the real
  300 s target (open → expiry → no re-fire at 361 → re-fire at 600).
  The test models the reset's `requestNextCard` draw (current card
  back to an ordinary type 0) because the gate correctly holds the
  re-arm while the current card is still the Cum card (6) the window
  opened with.

## 3. 75–100-stroke card — verified implemented, pinned precisely

`Spawn100PercentCumMeterOverrideEvent` (stub → entry 66033) spawns
`SpawnCustomCardEvent(CumCards, 75, 100, ..., byte 6, ...)`. **Byte 6
resolved from the player code and the call-site pattern, not the
notes:** the 6th argument is the card-type byte — `byte(2)` fast/taunt,
`byte(3)` succubus/punishment, `byte(9)` frenzy in `cards.js` — so
byte 6 is the Cum card (type 6), which the player already models
(`run.js` sets `state.card = 6` on `release-window-opened`;
`cards.js` maps pool `'cum'` to card 6).

Player alignment, verified in code: `play.js` draws `'cum'` with no
`override` flag on `release-window-opened` → `Cards.start` plain
`'cum'` branch (`min=75, max=100, low=.28, high=.35, travel=1.5,
bank='fast'`); later automatic draws while the window is open use
`override:true` → the 25–50 card (`cards.js`, `play.js:328`). The
earlier `>= 60` pin in the cards test was loose (combo-tier count
multiplier 0.8); the new test pins the range exactly.

**Test added** (`tests/fanservice_cards.test.js` —
`Spawn100PercentCumMeterOverrideEvent card is 75-100 strokes at
0.28-0.35 s from FastBeatPatterns with 1.5 s travel (byte 6 Cum)`):
at combo 250 (tier 2, count ×1.0) and difficulty 1, 39 seeds assert
card 6, travel 1.5, assigned strokes in [75, 100], interval in
[0.28, 0.35], pattern from the fast bank; plus the window-open flow
(plain `'cum'` draw after `release-window-opened` is 75–100, the
next override draw is 25–50 at travel 1.75). No code change was
needed for this item. (`PlaySpecialEventDialogue(4)` and the random
`FastBeatPatterns` choice are covered by the fast-bank pin; the
dialogue line itself has no player surface — same standing as the
other unmodeled voicelines.)

## 4. Acceptance re-check against the #51 ticket body

Ticket body (GitHub issue #51, "[Fanservice] Newest-game music
timeline and completion"): *"Recover and implement recording-clock
beats, breaks and event effects through a complete playable song,
including buffering and progression."* Acceptance criteria:

| Criterion | Verdict | Evidence / exact missing piece |
|---|---|---|
| Recover the newest game's music clock, beat completion, breaks and supported event semantics through REA | **Partially met** | Music clock, beat completion (`BeatComplete` → trigger), breaks (`disable_break` type 8, 10.0 s warning lead pinned in the exe), and the timeline event semantics in the shipped maps are decoded (Tick disassembly; `HandleCumEvent`/`HandleMediaSwitch`/`HandleDialogueEvent`/`HandleEdgeEvent` decoded; event census of the 10 shipped maps: `background`, `cum_event`, `cycle_media` ×3597, `disable_break`, `media_change` — all handled). MEDIA-event weighting is recovered: `special-events.json` holds all 12 rows decoded from the installed game's `SpecialEventDataTable`, applied by `weightedEvents` (`docs/fanservice/evidence/automatic-media-pools-20261110.md`). **Missing:** the non-media special-event handlers / full original event dispatcher — that note states explicitly they "remain open under #51" and "this does not claim that the entire original event dispatcher is finished". |
| Drive a complete playable song from actual recording position with correct offset and lead-in behavior | **Not met** | Lead-in is met (2.0 s `IntroLeadInSeconds`, constructor default + native runtime log) and the player drives a song from `audio.currentTime` with the confirmed-manifest contract. **Missing (the known blocker):** correct-offset behavior for a nonzero file offset is unproven — the native parser demonstrably does not apply `Meta.Offset` to timestamps and no retained runtime body reads it, but `StartFromBeatmap` (0x148321290) / `StartFromBeatmapWithMediaSync` (0x1483213f0) are unrecovered, so a nonzero offset could still be applied at spawner init (`docs/fanservice/evidence/ticket51-offset-validation-20261110.md`). Exact missing piece: a decompilation of those two functions from the hash-verified exe, or a native runtime run with a nonzero-offset map that has events. |
| Pause and buffering cannot advance the recording-bound timeline or duplicate beat rewards | **Met** | `tests/fanservice_music_timeline.test.js`: pause/lead-in/buffering samples cannot advance recording time or cursors; explicit seek and restored high-water ledger cannot duplicate music rewards; a frame stall preserves event/beat effects at each timestamp; premature end is not completion. `play.js` gates the recording sample on `!paused && !musicBuffering && !audio.paused && !audio.seeking && readyState >= 3` and pauses the audio on `waiting`. |
| Verify event effects, natural completion and progression through the player with exact original-build provenance | **Partially met** | Event effects verified through the player (music-timeline unit tests; cum-override browser evidence `docs/fanservice/evidence/cum-override-browser-20261110/`; map-window warning text now the original's); natural completion modeled (`recordingSample` complete at the song boundary, `HandleSongComplete` decoded, `play.js` `ended` handler grants no rewards before the boundary); progression settled (#45 XP/UP, 4200-row fixture). Provenance is the v0.05.1 build (SHA-256 `a8f46896…`) throughout. **Missing:** the same two pieces as above — event-effect verification under a nonzero offset (offset gap) and verification of the non-media dispatcher events (dispatcher gap). |

**Overall: #51 stays OPEN.** The three implementation items in §1–§3
are done (gate verified, Timer path fixed + tested, 100%-meter card
pinned), but the ticket's acceptance criteria are not fully met. The
exact missing pieces are (a) nonzero-offset runtime semantics
(`StartFromBeatmap*` decompilation or a native nonzero-offset run
with events) and (b) the non-media special-event handlers / full
original event dispatcher. Neither is achievable in this VM on the
evidence available (no GPU/Wine run of the exe, no native runtime
runs); both need original-side evidence, not more player code.

## Test runs

- `node --test tests/*.test.js` (with the `python`→`python3` shim):
  **398 pass / 0 fail** (baseline 395; +3 new tests).
- `python3 -m unittest tests.recover_game_instance_schema_test`:
  **12 pass**.
