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
  `HandleCumEvent` does not disable breaks; Tick case 3 only logs and
  writes −1.0 to `+0x580` and r15 to `+0x588`. Breaks are disabled only
  by `disable_break` events (type 8 → `HandleBreakDisable`). What
  `+0x580`/`+0x588` mean is NOT pinned (their readers were not
  identified; a raw disp32 scan is too noisy to attribute).
- **Release deadline: NONE.** No timer, countdown, or fixed duration in
  `HandleCumEvent` or Tick case 3. The window is exactly the map's
  `cum_event` [start, end] pair (14.9–52.8 s, one per map). The
  warning delegates confirm the window is map-defined:
  `OnCumInWarning` → `SpawnCumWindowWarning(WindowStartTime,
  WindowEndTime, SecondsUntilWindow)`; `OnCumWithinStarted` →
  `CumWithinStartOverlay(WindowStartTime, WindowEndTime,
  SecondsUntilWindowEnd)`. Those are DISPLAY countdowns to the map's
  end time, not a separate deadline mechanism.
- **Event-vs-beat ordering:** Tick's structure is settled (beat loop
  first, event loop second; beats are ENQUEUED via `EnqueueBeatEvent`,
  not fired — see the Tick note). The player-visible order at equal
  timestamps is NOT settled: it depends on the spawner dequeue, not
  on Tick's internal order. Same-timestamp events are processed in
  array order in both.
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

## The 60 s hard-code: NOT replaced

`objectives.js:52` `openReleaseWindow` (60 s) is the **objective-
completion override** (`CumEventOverride` /
`Determine_And_Trigger_Cum_Meter_Override_Event`: fires when the
objective completes AND cum meter ≥ 1.0, unless Succu Frenzy is active
or it already triggered), NOT the map's cum_event window. It is a
different mechanism from the map window, so the map evidence does not
replace it. Its 60 s duration is itself UNEVIDENCED — the
`CumEventOverride` body lives in the ubergraph (EntryPoint 73198) and
is not decoded — but it is not contradicted either. Leave it untouched.

## Player alignment / open items

- Core map-window behavior already matches: `play.js:438` toggles
  `isAllowedToCum` on cum_event start/end and switches the pool to
  'cum' on start. No code change made for this note.
- Presentation gaps (settled by the decode, not yet wired to the MAP
  event — the overlay countdown currently only runs on the objective
  override's `releaseDeadline`): the "Cum Now!" / "Cum Window Closed"
  notifications; the `CumWithinXSec` countdown to the map's end time
  during the window; the CumButtonFlash green/red loop toggle.
- Still open: `+0x580`/`+0x588` readers; `CumEventOverride` body
  (ubergraph EntryPoint 73198) and the override window's duration;
  the GM cum-window timer functions (`Start_Cum_Window_Timer` 48674,
  `Set_and_Display_Cum_Window_Timer` 49184 — bodies not decoded,
  likely display); observable event-vs-beat order at equal timestamps
  (spawner dequeue).
