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
    double at `+0x60`; its default is PINNED: **30.0** —
    `UMusicModeManager` constructor 0x1482ce640, verified in the
    v0.05.1 exe: `movabs 0x403e000000000000 → +0x60`).
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
    `clamp(1 − max(+0x570 − now, 0)/+0x580, 0, 1)`, 0 when `+0x570<0`
    or `+0x580<=0`), `GetCumWindowWarningText` (0x1482e95d0:
    formats remaining until `+0x570` and until `+0x578`).
  - CumWithin readers (same history walk, over the
    `FEventHistoryEntry` array at `+0x238` that contains now):
    `GetCumWithinProgress` (0x1482e96e0:
    `clamp(max(end − now, 0)/(end − start), 0, 1)`, 0 when no entry
    contains now), `GetCumWithinRemainingSeconds` (0x1482e9870:
    `max(end − now, 0)` for the containing entry, else −1.0).
  - **Exact CumIn/CumWithin text format strings: RECOVERED (2026-11-11).**
    `GetText` in each countdown widget calls the native
    `UMusicModeManager` getter (`GetCumInText` / `GetCumWithinText`,
    imports from class `MusicModeManager` in the cooked packages) and
    converts the returned FString with `Conv_StringToText` — the format
    lives in the native getter, not in Blueprint. Disassembled from the
    hash-verified v0.05.1 exe (SHA-256 a8f46896…) with objdump; all
    format strings read back as UTF-16 from the exe's .rdata:
    - `GetCumInText` (0x1482e8f40): `""` when `+0x570 < 0` or
      `(start − now) <= 0`, else `FString::PrintfImpl("CUM IN: %d SEC",
      n)` (format at 0x14d20bf40). `PrintfImpl` is confirmed in the PDB
      public symbols (`?PrintfImpl@FString@@CA?AV1@PEB_WZZ`, 0x140d170d0).
    - `GetCumWithinText` (0x1482e99b0): `""` unless the internal gate
      holds (`+0x2f0 != 0`, `+0x4e9 != 0`, `+0x4eb == 0`, `+0x4f0 > 0`,
      `+0x4f0 >= +0x4ec`) and a `+0x238` history entry contains now and
      `(end − now) > 0`, else `FString::PrintfImpl("CUM WITHIN: %d
      SEC", n)` (format at 0x14d20bf60). The gate's internal flags have
      no player-observable counterpart; the player's containing-window
      condition is the observable equivalent.
    - The `%d` in both is `floor(remaining + 0.75)`: both getters
      compute it as `cvtsd2si(-0.5 − 2r)`, arithmetic shift right 1,
      negate, clamp at 0, with the −0.5 double at 0x14bf8d1d8
      (read back as −0.5). Verified equal to `floor(r + 0.75)` on a
      200k random sweep (0 mismatches) and on the boundary values
      (30.1 → 30, 30.24 → 30, 30.25 → 31, 0.24 → 0, 0.25 → 1).
    - Duration helper 0x1482dfe90 (same `floor(r + 0.75)` total
      seconds, then `'%d:%02d:%02d'` when hours > 0 else `'%02d:%02d'`;
      verified `(hours, minutes, seconds) = (n//3600, (n%3600)//60,
      n%60)` on 20005 values, 0 mismatches): used by
      `GetCumWindowWarningText` (0x1482e95d0: `""` when `+0x570 < 0`,
      else `"CUM WINDOW IN %s"` while `(start − now) > 0`,
      `"CUM WINDOW OPEN: %s"` while `(end − now) > 0`, formats at
      0x14d20bef0 / 0x14d20bf18), by `GetCumWindowCountdownString`
      (0x1482e8fe0: `"CUM NOW: %s"`, `"CUE %d/%d IN: %s"` /
      `"CUE %d/%d OPEN: %s"`, `"FINAL CUE IN: %s"` /
      `"FINAL CUE OPEN: %s"` — formats at 0x14d20be88 / 0x14d20be30 /
      0x14d20be48 / 0x14d20be68 / 0x14d20bea0 / 0x14d20bec8, selected by
      whether the containing entry is the only/last one), and by
      `GetBreakDisableWarningText` (0x1482e6ed0: `""` when `+0x5a8 <
      0`, `"BREAKS DISABLED IN %s"` while `(disable − now) > 0`,
      `"BREAKS DISABLED"` once the disable is in effect, formats at
      0x14d20bf88 / 0x14d20bfb8).
    - Implemented in the player (2026-11-11): `overlays.js` adds
      `displaySeconds` / `durationText` / `cumInText` / `cumWithinText`
      / `breakDisableText` / `mapWindowWarningTexts`, and `play.js`
      `renderOverlays` shows the exact text on the countdown overlay
      (`CUM IN: N SEC` / `CUM WITHIN: N SEC` /
      `BREAKS DISABLED IN MM:SS`). The existing `seconds` fields keep
      their raw-float meaning (pinned by earlier tests); the text
      functions compute the display value. Not wired (no player
      surface): `CUM WINDOW IN/OPEN`, `CUM NOW` / `CUE n/m` (no
      retained Blueprint caller for `GetCumWindowCountdownString`),
      and `BREAKS DISABLED` as a persistent state (the player tracks
      `state.breakSectionDisabled` but has no text slot for the
      in-effect disable state; the countdown overlay only renders
      while a warning is active).
  - Tick case 8 (DisableBreak) RESETS the latch: `+0x580 = −1.0`
    (disables the progress getter until re-latched) and
    `+0x588 = 0.0` (clears the announced-start latch so the next
    window can re-announce).
- **Break-disable warning readers: SETTLED (2026-11-11).**
  - `+0x5a8` = start time (audio time) of the next upcoming
    DisableBreak event; `+0x5b0` = warning window =
    `max(+0x68, 0.0)` (a config double at `+0x68`; its default is
    PINNED: **10.0** — same constructor: `movabs
    0x4024000000000000 → +0x68`). Written by `EvaluateNotificationWarnings`: it
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
duration comes from `CumWindowTime = 60.0`, not from this body. Its
caller is SETTLED: `DetermineCardV2` (BP_DrawManager) calls it at stmt
12 (@463) and stmt 56 (@2429), in modes 0/1 outside music mode, when
`HasCame?` OR `IsAllowedToCum?` (see below); the player's
`run.cumOverrideDue()` matches.

## Trigger function — decoded (`Determine And Trigger Cum Meter Override Event`, 4000-byte export)

Switch on `GameInstance.CurrentSessionObjective`; only cases 0, 2, 3, 8
have an override path (Timer 1, Prejac 6, Tribute 7 return without one):

- Case 0 (Cum meter): if NOT Frenzy, require `CurrentCardTypeEnum` ∉
  {5 Edging, 6 Cum, 3 Succubus} — the gate passes only when the current
  card is none of those three; then `CumMeterPercentage >= 1.0`. (An
  earlier version of this note had the polarity inverted; corrected
  2026-11-11 against the live ubergraph block @92330–93214, where the
  OR {5,6,3} → exit.) If Frenzy IS active, the live block requires
  type == 3 (Succubus); the dead trigger function has no frenzy type
  check — the live block governs.
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
the same two calls. **Trigger cadence: SETTLED.** `BeatComplete` (GM
function export, 33 stmts, icode 821, v0.05.1) stmt 16
`AddtoCumMeteronBeatComplete` → stmt 17 `Determine And Trigger Cum
Meter Override Event` — the trigger check runs on EVERY BEAT COMPLETE.
The player's `run.advance()` → `objective.tick()` runs per advance/beat,
the equivalent cadence.

**Timer path: SETTLED.** The trigger function has no Timer case, but the
Timer completion reaches the same live trigger block via the 1 s session
timer: `SetSessionDurationEvent` is bound at GM ubergraph stmt 586
(@25634) via `BindDelegate` + `K2_SetTimerDelegate(rate=1.0,
looping=True)`; the Timer completion check (stmts 2378–2380:
`SessionLength >= Objective_TimeRequired_Seconds` →
`PopExecutionFlowIfNot` → Jump @92333, the SuccuFrenzy check) enters
the trigger block. Prejac (objective 6) has an analogous check at stmts
2381–2384 (jump target @94068 not yet dumped).

**`IsCumRound?`: SETTLED with a caveat.** GM ubergraph stmt 657 (@28287)
sets `GameInstance.IsCumRound? = True` during session init. NO False
write exists in any converted package (GM ubergraph search found only
stmts 657 and 2336; GI scripts contain no write;
`SetCurrentSessionObjective` only sets `CurrentSessionObjective`); the
GI CDO default was not walked. In the decoded Classic path
`IsCumRound?` is effectively always true, so the trigger always takes
the `Spawn100Percent` branch, never `RoundWinOverride` — a False write
could exist in an unconverted package or native code.

**`RoundWinOverride` (entry 79488 → Jump @56800):** creates a widget +
`AddToViewport(0)` (class unresolved), `UpdateObjectiveTitleVictoryStart`,
`UpdateMetric(14, 1)`, `SessionStatsArray += CurrentSessionStats`,
notify 'Round Completed' / 'Advance to the next round.' — a round
victory, NO cum window.

**Expiry notifications: SETTLED** (`Set and Display Cum Window Timer`,
entry 49184 — all cases end with `DetermineCardV2`): case 0 'Cum Meter
Reset', case 1 'Timer Reset' (which also does
`Objective_TimeRequired_Seconds += Original Objective Time Required
Seconds`), case 2 'Strokes Reset', case 3 'Edges Reset', case 8
'Succubi Reset' (which also does `Objective_SuccubusRequired += Original
Objective Succubus Required`). Cases 2 and 8 end the session instead
when `DoesNotCummingInWindowResetObjective?` is false.

The player's `tick()` now models the gate
(`objectives.js cumWindowTriggerGate`, wired through `run.context()`'s
`modifiers` + `cardType`): non-Frenzy requires the type ∉ {5,6,3},
Frenzy requires type == 3; a failed gate leaves the objective complete
so the next tick retries. The 75–100-stroke 100%-meter card is already
modeled: `play.js` draws `'cum'` (75–100, 0.28–0.35, travel 1.5, bank
'fast') on `release-window-opened`, and subsequent automatic draws use
the 25–50 override card while the window is open.

## Player alignment / open items

- Core map-window behavior already matches: `play.js:438` toggles
  `isAllowedToCum` on cum_event start/end and switches the pool to
  'cum' on start. No code change made for this note.
- Presentation gaps (settled by the decode, not yet wired to the MAP
  event — the overlay countdown currently only runs on the objective
  override's `releaseDeadline`): the "Cum Now!" / "Cum Window Closed"
  notifications; the CumButtonFlash green/red loop toggle.
- Map-window warnings: MODELED (2026-11-11). The leads are pinned
  (+0x60 = 30.0, +0x68 = 10.0, ctor 0x1482ce640) and the getters are
  decoded (see above); `overlays.js` adds `cumInWarning` /
  `cumWithinWarning` / `breakDisableWarning` / `mapWindowWarnings` and
  `renderOverlays` shows them on the countdown overlay in music mode
  (the objective countdown never runs there). The exact CumIn/CumWithin
  / BreakDisable text format strings are recovered (see the
  `+0x580`/`+0x588` settlement above) and implemented in `overlays.js`
  (`cumInText` / `cumWithinText` / `breakDisableText` /
  `mapWindowWarningTexts`, `play.js` renders them); the player's
  countdown wording is now the original's (`CUM IN: N SEC` /
  `CUM WITHIN: N SEC` / `BREAKS DISABLED IN MM:SS`).
- Decoded and modeled in the player (2026-11-11): the objective-0
  card-type gate (∉ {5,6,3} non-Frenzy, == 3 Frenzy — live block
  governs); the Timer objective's path to the trigger block (1 s
  session timer, completion check @2378–2380); the 75–100-stroke
  100%-meter card (drawn on `release-window-opened`); the
  `CumEventOverride` caller (`DetermineCardV2` stmts 12/56).
