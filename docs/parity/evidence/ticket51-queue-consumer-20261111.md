# #51 — Queue consumer / delegate / Blueprint side (2026-11-11)

Sources: v0.05.1 exe + PDB (`Tick.asm`, `HandleCumEvent.asm`,
`HandleMediaSwitch.asm`, `HandleDialogueEvent.asm`, `HandleEdgeEvent.asm`,
`HandleSongComplete.asm`); reJOIce
`Analysis/ReferenceBuilds/newer-20261017/functions/BP_GlobalManager/`
(`HandleCumEvent.json`, `HandleCategorySwitch.json`,
`BeatMapEventHandler.json`, `ExecuteUbergraph_BP_GlobalManager.json`,
`SpawnCumWindowWarning.json`, `CumWithinStartOverlay.json`); 10 real
beatmaps (`CockHero/beatmaps/*/beatmap.json`).

## Correction: +0x668 is an event HISTORY, not a work queue

Tick appends each dispatched event to `+0x668`, a
`TArray<FEventHistoryEntry>` (element 0x30 = 48 B). When count `+0x670`
reaches 15, the oldest entry is shifted out (memmove) and `ResizeShrink`
(`0x14830ba00`) runs. Nothing drains it to produce effects. Effects come
from (a) Tick's inline per-type cases and (b) the
`FOnBeatmapEventDispatched` delegate broadcast (wrapper `0x1481d2810`,
delegate at `+0x130`, Tick shared tail). There is no "queue consumer".

## The delegate consumer: BP_GlobalManager.BeatMapEventHandler

GM binds `MusicModeManager.OnBeatmapEvent` (ubergraph stmt 627) to
`BeatMapEventHandler`, which forwards the event struct to the ubergraph
(EntryPoint 95480) and dispatches by the Type byte (stmts 2443–2468) to:
`HandleBreakDisable` (8), `HandleTextEvent` (7),
`HandleBackGroundChange` (6), `HandleCumEvent` (3),
`HandleCategorySwitch` (0 MediaSwitch), and the CycleMedia path.
Other GM bindings on the same manager: `OnNextBeatmapPrepared` →
`CacheBeatMapAndShowUpgrades`; `OnRoundSessionComplete` →
`OnRoundSessionCompleted`; `OnCumInWarning` → `SpawnCumWindowWarning`;
`OnCumWithinStarted` → `CumWithinStartOverlay`.

## HandleCumEvent (Blueprint) — fully decoded

```
if (Event.Type != 3) return;                    // 3 = CumEvent
switch (Event.Value) { case "start": goto START; case "end": goto END; default: return; }
START:
  if (LegacyStats.HasCame?) return;
  LegacyStats.IsAllowedToCum? = true;
  UIManager notify: "Cum Now!" / "You have a limited time to finish.\nDon't miss your chance!"
  Create PermissionToCumOverlay_Widget; PlayAnimation SpawnOverlay (0, 1, 0, 1.0); AddToViewport(0);
  CumLoopWidget = Create AllowedToCumOverlayLoop_Widget; PlayAnimation SpawnOverlay (0, 1, 0, 1.0); AddToViewport(0);
  UIManager.StopAnimation(CumButtonFlashRedLoop);
  UIManager.PlayAnimation(CumButtonFlashGreenLoop, 0, 0, 0, 1.0);   // NumLoops 0 = infinite
  return;
END:
  if (LegacyStats.HasCame?) return;
  LegacyStats.IsAllowedToCum? = false;
  UIManager notify: "Cum Window Closed" / "Your chance to finish has passed.\nBack to stroking!"
  if (IsValid(CumLoopWidget)) CumLoopWidget.RemoveFromParent();
  Create CumWindowClosedOverlay_Widget; PlayAnimation SpawnOverlay (0, 1, 0, 1.0); AddToViewport(0);
  UIManager.StopAnimation(CumButtonFlashGreenLoop); UIManager.StopAnimation(CumButtonFlashRedLoop);
  UIManager.PlayAnimation(CumButtonFlashRedLoop, 0, 0, 0, 1.0);     // NumLoops 0 = infinite
  return;
```

## Settled answers

- **Pool switch on cum_event start: NO.** `HandleCumEvent` touches no
  media pool/category. The switch is via `media_change` (type 0 →
  `HandleCategorySwitch`, which switches on Value: slow/medium/fast/
  succubus/cum/…) and `cycle_media` (type 5 → Tick's
  `CommitMusicModeSwapForBeat` / `SetPendingMusicModeSwapCategory`).
  In the real maps the `media_change=cum` (and
  `background=successfulcumbackground`) fires at the SAME timestamp as
  `cum_event=start` in 9/10 maps, and `media_change=slow` +
  `background=normalbeatbackground` at `cum_event=end`. Exception:
  Cake — `media_change=cum` fires 7.5 s BEFORE its `cum_event=start`
  (119.05 vs 126.50), and no `media_change=slow` accompanies its end.
  The player's redundant `timelinePool('cum')` on cum_event start
  (`play.js:438`) is therefore harmless, not a bug: the media_change
  event does the real switch.
- **In-window break behavior: NOT suppressed by the cum window.**
  `HandleCumEvent` does not disable breaks; Tick case 3 (CumEvent)
  only logs. Breaks are disabled only by `disable_break` events
  (type 8 → `HandleBreakDisable`). Tick case 8 (DisableBreak) writes
  −1.0 to `+0x580` and 0.0 to `+0x588` — see the `+0x580`/`+0x588`
  settlement below. (Correction, 2026-11-11: the earlier note said
  the case-8 write stored "r15" as the event value-string's data
  pointer. Wrong: the event-loop prologue (`Tick.asm`
  0x14831630c–0x148316348) loads the value-string data pointer into
  r15, copies the string into a stack buffer, then `xor %r15d,%r15d`
  on BOTH paths before the type switch — r15 is 0 at case 8, so the
  write stores double 0.0.)
- **`+0x580`/`+0x588` readers: SETTLED (2026-11-11).** They are
  CUM-WINDOW WARNING fields, not break-disable fields
  (`UMusicModeManager`, `this`-relative):
  - `+0x570` = next upcoming cum window start (audio time);
    `+0x578` = its end. Written by
    `EvaluateNotificationWarnings` (0x1482decf0, called from Tick
    every frame) when the next window falls inside the warning lead.
  - `+0x580` = warning lead time = `max(+0x60, 0.0)` (a config
    double at `+0x60`; its CDO default is NOT established).
  - `+0x588` = latched announced upcoming window start; re-latched
    only when `|new start − old| > 0.001` (epsilon const
    0x14bf3cd30 = 0.001), so the warning broadcast fires once per
    window.
  - `+0x590`/`+0x598` = CURRENT (in-progress) window start/end, or
    −1.0 when none; `+0x5a0` = latched announced current-window
    start (same 0.001 epsilon).
  - Readers: `GetCumWindowWarningRemainingSeconds` (0x1482e9570:
    `max(+0x570 − audioTime, 0)`, else −1.0),
    `GetCumWindowWarningProgress` (0x1482e94e0:
    `clamp(1 − (+0x570 − now)/+0x580, 0, 1)`, 0 when `+0x570<=0`
    or `+0x580<=0`), `GetCumWindowWarningText` (0x1482e95d0:
    formats remaining until `+0x570` and until `+0x578`).
  - Tick case 8 (DisableBreak) RESETS the latch: `+0x580 = −1.0`
    (disables the progress getter until re-latched) and
    `+0x588 = 0.0` (clears the announced-start latch so the next
    window can re-announce).
- **Break-disable warning readers: SETTLED (2026-11-11).**
  - `+0x5a8` = start time (audio time) of the next upcoming
    DisableBreak event; `+0x5b0` = warning window =
    `max(+0x68, 0.0)` (a config double at `+0x68`; CDO default NOT
    established). Written by `EvaluateNotificationWarnings`: it
    scans the beatmap event array at `+0x2b0` (40-byte stride,
    count `+0x2b8`) for type-8 events with `0 < time − now <=
    +0x68`, skips indices already in the `TSet<int32>` dedup set
    at `+0x5b8`, and latches the first one (`+0x5a8 = time`,
    `+0x5b0 = +0x68` value) while broadcasting the warning via
    the Blueprint exec delegates at `+0xd0`/`+0x118`. When the
    `+0x56b` flag is set, `+0x5a8 = −1.0`, `+0x5b0 = 0.0`.
  - Readers: `GetBreaksDisabledInRemainingSeconds` (0x1482e6fe0:
    `max(+0x5a8 − audioTime, 0)` when `+0x5a8 > 0`, else −1.0 —
    i.e. seconds UNTIL breaks are disabled),
    `GetBreakDisableWarningRemainingSeconds` (0x1482e6e70, same
    value, `max(..., 0)` form),
    `GetBreakDisableWarningProgress` (0x1482e6de0:
    `clamp(1 − (+0x5a8 − now)/+0x5b0, 0, 1)`),
    `GetBreakDisableWarningText` (0x1482e6ed0: formats the
    remaining seconds). The −1.0 sentinel const is at
    0x14bf683b8; the audio clock is `GetCurrentAudioTime`
    (0x1482e9b40). No native setter exists — the only writers are
    Tick case 8 (the `+0x580`/`+0x588` reset) and
    `EvaluateNotificationWarnings`.
- **Release deadline: NONE.** No timer, countdown, or fixed duration in
  `HandleCumEvent` or Tick case 3. The window is exactly the map's
  `cum_event` [start, end] pair (14.9–52.8 s, one per map). The
  warning delegates confirm the window is map-defined:
  `OnCumInWarning` → `SpawnCumWindowWarning(WindowStartTime,
  WindowEndTime, SecondsUntilWindow)`; `OnCumWithinStarted` →
  `CumWithinStartOverlay(WindowStartTime, WindowEndTime,
  SecondsUntilWindowEnd)`. Those are DISPLAY countdowns to the map's
  end time, not a separate deadline mechanism.
- **Event-vs-beat ordering: SETTLED (2026-11-11).** Tick's structure
  is settled (beat loop first, event loop second; beats are ENQUEUED
  via `EnqueueBeatEvent`, not fired — see the Tick note). The
  observable order at equal timestamps follows from that: the event
  is handled in the same Tick the beat is enqueued, but the beat's
  HIT happens only when it reaches center, travel-time later — so
  the event's effect observably PRECEDES the beat's hit. The player
  already matches: `rules.js` `schedule` fires the event first at
  equal timestamps (`nextEvent.time <= nextBeat.time`), and its beat
  callback IS the hit (`play.js` `scoreBeat`). No code change.
  Same-timestamp events are processed in array order in both.
- **Native Handle\* functions:** `HandleCumEvent` (0x1482f9a40) is a
  bool predicate (`+0x4e9==0 && +0x4eb==0 && +0x4f0>0 &&
  +0x4f0>=+0x4ec`); `HandleDialogueEvent` logs + broadcasts
  `FOnDialogueTriggered` (`+0x218`); `HandleEdgeEvent` logs only;
  `HandleMediaSwitch` copies Value to `+0x6d8`, calls
  `SetExpectedMusicModeCategory`, broadcasts
  `FOnMediaCategorySwitch` (`+0x200`). None of the four has a native
  call site (0 hits in a .text `call rel32` scan) — they are
  Blueprint-invoked (or dead). Only `HandleSongComplete` is called
  natively, from Tick (song end / round advance: `PrepareNextRoundBeatmap`,
  `StopPlayback`, `FOnBeatmapPlaybackComplete` (+0x170, +0x1d0),
  `EndRoundSession`).

## The 60 s hard-code: SETTLED as a constant (2026-11-11)

`objectives.js` `openReleaseWindow` (60 s) is the **objective-
completion override** (`CumEventOverride` /
`Determine_And_Trigger_Cum_Meter_Override_Event`: fires when the
objective completes AND cum meter ≥ 1.0, unless Succu Frenzy is active
or it already triggered), NOT the map's cum_event window. The
`CumEventOverride` body is now decoded (GM ubergraph EntryPoint 73198,
fixed kismet2 parser) and the 60 s is **evidenced as a constant**:

- `Start Cum Window Timer` (stub → entry 48674): binds a 1.0 s looping
  `K2_SetTimerDelegate` (rate 1.0, True, 0.0, 0.0) calling `Set and
  Display Cum Window Timer`, stops the red flash, plays the green flash
  loop, notifies `CreateNotificationBox('Cum Meter Filled', '60s Release
  Window\r\nFinish to Win')`, and `UpdateMetric(19, 1)` (metric 19 =
  CumWindowsHit — the player already records it).
- `Set and Display Cum Window Timer` (stub → entry 49184, the 1 s tick):
  if `CumWindowTime <= 0.0` → expiry handling per objective (reset logic,
  see below); else `CumWindowTime -= 1` and display `'Cum Window Timer
  Activated!: Time Left: ' + CumWindowTime`. The five `FloatConst 60.0`
  assignments in this function are `CumWindowTime = 60.0` resets, one
  per objective case.
- The player's 60 s is therefore correct as a constant and is now named
  `RELEASE_WINDOW_SECONDS` in objectives.js with the source cited; the
  event notification carries the original's exact body text (`'60s
  Release Window\nFinish to Win'`), and play.js renders the event's
  notification instead of its own hard-coded string. No numeric change.

## `CumEventOverride` body — decoded (GM ubergraph EntryPoint 73198)

```
if (!PlayerVariablesStruct.CanDraw?) return;
if (!PlayerVariablesStruct.IsAllowedToCum?) goto ROLL;
if (!DoesCumOverlayLoopExist?) {
  AllowedToCumOverlayLoopWidgetRef = Create(AllowedToCumOverlayLoop_Widget); AddToViewport(0);
  DoesCumOverlayLoopExist? = true;
}
ROLL:
if (RollFavoritesChance(6)) SpawnCustomCardEvent(CumFavoriteCards, 25, 50, 0.28, 0.30, byte 6, Stroke Time Speed Multiplier, Stroke Count Multiplier, ...);
else                        SpawnCustomCardEvent(CumCards,        25, 50, 0.28, 0.30, byte 6, Stroke Time Speed Multiplier, Stroke Count Multiplier, ...);
StartPatternWithMediaSync(Array_Random(CumBeatPatterns), BeatSpawnInterval, CurrentStrokeCount, MediaPlaybackManager, 1.0, 0.0, Beat Travel Time);
return;
```

The body carries **no duration, no timer, and no 60** — the window's
duration comes from `CumWindowTime = 60.0`, not from this body. No
Blueprint caller of `CumEventOverride` was found in the GM ubergraph
(same pattern as `AddFavoriteCardToArray` — native-by-name or dead code).

## Trigger function — decoded (`Determine And Trigger Cum Meter Override Event`, 4000-byte export)

Switch on `GameInstance.CurrentSessionObjective`; only cases 0, 2, 3, 8
have an override path (Timer 1, Prejac 6, Tribute 7 return without one):

- Case 0 (Cum meter): if NOT Frenzy, require `CurrentCardTypeEnum` ∈
  {5 Edging, 6 Cum, 3 Succubus}; then `CumMeterPercentage >= 1.0`.
- Case 2 (Strokes): `CurrentSessionStats.Strokes >=
  Objective_StrokesRequired`. Case 3 (Edges): `Edges >=
  Objective_EdgesRequired`. Case 8 (Succubus):
  `SuccubiDefeated >= Objective_SuccubusRequired`.
- Then: if `HasCumMeterOverideTriggered?` → return; if `IsCumRound?` →
  `Spawn100PercentCumMeterOverrideEvent` + `Start Cum Window Timer` +
  set the flag; else `RoundWinOverride` + set the flag.

`Spawn100PercentCumMeterOverrideEvent` (stub → entry 66033, decoded)
is separate from `CumEventOverride`: it updates the objective title,
creates a SpawnOverlay widget with an AnimationFinished binding, spawns
`SpawnCustomCardEvent(CumCards, 75, 100, ..., byte 6, ...)` (75–100
strokes, vs the override's 25–50), random `FastBeatPatterns`,
`StartPatternWithMediaSync`, and `PlaySpecialEventDialogue(4)`. The
trigger's other call site in the ubergraph (shared block at 92486)
re-checks `CurrentCardTypeEnum == 3` and `IsCumRound?` before firing
the same two calls. No Blueprint caller of the trigger function itself
was found in the GM ubergraph.

The player's `tick()` opens the release window for any objective on
completion (except Tower non-boss and Tribute, which complete directly).
Two decoded details are NOT yet modeled in the player and are recorded
here, not silently assumed: (a) the objective-0 card-type gate ({5, 6,
3} when not in Frenzy) — the player's tick has no such gate, and the
trigger's call cadence (which beat/card event invokes it) is not
established, so wiring the gate into the player's tick loop would invent
behavior; (b) the Timer objective has no override path in the trigger
function — the player's Timer → release window is unconfirmed by this
decode (the Timer objective may complete through a different path).
The 75–100-stroke 100%-meter card (vs the override's 25–50) is likewise
not modeled: the player's release-window draw is a forced `'cum'` card.

## Player alignment / open items

- Core map-window behavior already matches: `play.js:438` toggles
  `isAllowedToCum` on cum_event start/end and switches the pool to
  'cum' on start. No code change made for this note.
- Presentation gaps (settled by the decode, not yet wired to the MAP
  event — the overlay countdown currently only runs on the objective
  override's `releaseDeadline`): the "Cum Now!" / "Cum Window Closed"
  notifications; the `CumWithinXSec` countdown to the map's end time
  during the window; the CumButtonFlash green/red loop toggle.
- Still open: the GM cum-window timer functions
  (`Start_Cum_Window_Timer` 48674, `Set_and_Display_Cum_Window_Timer`
  49184) are now decoded (see above — 1 s tick, CumWindowTime = 60.0).
  The warning getters are decoded but NOT modeled in the player: no
  player UI seam exists for the break-disable warning (seconds-until-
  disabled text + progress) or the cum-window warning (lead-time
  countdown + progress), and the config defaults at `+0x60` (cum
  warning lead) and `+0x68` (break-disable warning window) are NOT
  established — pinning them needs the `UMusicModeManager` CDO
  property values mapped to those member offsets, which the session
  parser does not do. No player code change was made for Task 3:
  the disable_break toggle (`play.js:439`) and the event-first
  ordering in `rules.js` `schedule` already match the original's
  observable behavior.
- Decoded but not yet modeled in the player: the objective-0 card-type
  gate ({5, 6, 3} when not in Frenzy); the Timer objective's lack of an
  override path in the trigger function (player's Timer → release window
  unconfirmed); the 75–100-stroke 100%-meter card vs the override's
  25–50; the `CumEventOverride` caller (none found in the ubergraph).
