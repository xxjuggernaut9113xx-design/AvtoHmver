# #44 PlayAllowedtoCumLoop / Play Not Allowed to Cum Loop / cum-overlay widgets trace (static, 2026-11-10)

Source: `reJOIce` commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`,
`Analysis/ReferenceBuilds/newer-20261017/`. Static reading of retained bytecode
only. No original game was run and the shared player was not changed. This does
not close #44: it records the full trace and the exact missing piece.

Companion notes: `ticket44-pattern-bank-reachability-20261110.md`
(CumEventOverride flow, statement 1776 onward) and
`ticket44-roll-favorites-chance-20261110.md` (the favorites trace; same
CumEventOverride area). This note answers the three questions those notes left
open for this slice, and corrects one point in the reachability note (see §5).

## 0. Verdict: still blocked — no player change made

The two button-flash loops are fully traceable as *state transitions* (exact
callers, gates, and start/stop pairs — §1), and the overlay loop widget's
creation/removal sites are fully traced (§2). But every one of them is a
**UI-widget animation**: the observable effect (what flashes, how fast, what
the overlay shows) lives in the widget animation assets, which are **not in
the retained bytecode** — there is no `AllowedToCumOverlayLoop_Widget`
function AST, no `CumButtonFlashGreenLoop` / `CumButtonFlashRedLoop` keyframe
data, and no animation timeline anywhere in this tree. The player has no
flash state and no overlay widget to attach any of this to (§3), and the spec
defines neither (`grep -i 'flash|overlay.*loop|green.*loop|red.*loop'` over
`COMBINED_PRODUCT_SPEC_20261105.md` and `tests/*.js` finds nothing). Building
a pulsing finish button or an overlay widget now would mean inventing the
flash period, the animated properties, and the overlay's contents. Not done.

## 1. The two loops: exact semantics

Both are functions on `UI_Manager_C` (`functions/UI_Manager/`). Neither
touches audio and neither writes game state; each only starts one widget
animation and stops the other. `PlayAnimation` parameters throughout are
`(Animation, StartAtTime 0, NumLoopsToPlay, PlayMode 0, PlaybackRate 1.0,
bRestoreState false)`; `NumLoopsToPlay 0` is UE's infinite loop, `1` is
play-once.

### 1a. `PlayAllowedtoCumLoop` — green loop on, red loop off

`functions/UI_Manager/PlayAllowedtoCumLoop.json` (4 statements):

- `PlayAnimation(CumButtonFlashGreenLoop, 0, 0, 0, 1.0, false)` — green
  flash, infinite.
- `StopAnimation(CumButtonFlashRedLoop)`.

Callers in retained code (exactly two):

1. **Session init, objective 7 only** — `ExecuteUbergraph_BP_GlobalManager`
   stmts 604-610: stmt 604 `CurrentSessionObjective == 8` gates
   `AddMassivePermanentSuccubusWeight`; stmt 608
   `CurrentSessionObjective == 7` gates stmt 610
   `UIManager.PlayAllowedtoCumLoop`. (Objective numbering cross-check: 8 is
   Succu Slayer in the player, 7 is Tribute; §1c.)
2. **`DetermineCardV2` stmt 55** (`functions/BP_DrawManager/
   DetermineCardV2.json`): reached from stmt 53 when `IsAllowedToCum?` is
   true and stmt 54 finds `HasCame?` true; stmt 56 `CumEventOverride`
   follows immediately. So on a draw after the player has come, while still
   allowed, the green loop starts and the override draw runs.

### 1b. `Play Not Allowed to Cum Loop` — red loop on, green loop off, gated on objective 7

`functions/UI_Manager/Play_Not_Allowed_to_Cum_Loop.json` (8 statements):

- `CurrentSessionObjective == 7` (byte 7, on `BP_CHGameInstance_C`); if
  **not** equal, jump to the end and do nothing (stmts 1-3).
- If equal: `PlayAnimation(CumButtonFlashRedLoop, 0, 0, 0, 1.0, false)` —
  red flash, infinite — then `StopAnimation(CumButtonFlashGreenLoop)`
  (stmts 4-5).

Sole caller in retained code: **`DetermineCardV2` stmt 61**, reached from
stmt 53 when `IsAllowedToCum?` is false and stmt 59 finds `HasCame?` false;
after it, the ordinary draw continues (stmts 62 onward, `IsAllowedToCum?`
set false again, `CheckEventConditions&ReturnArray`, weighted event pick).
Note the asymmetry with §1a: the green loop is *not* gated on the objective
at the draw (its gate is `HasCame?`), while the red loop is gated on
objective 7 at the draw.

### 1c. Objective numbering

`decoded-blueprint-enums.json` (16 enums) contains **no session-objective
enum**, so objective 7's display name is not recoverable from the enums.
The numbering is nevertheless confirmed against the player by two
independent checks in the session-init block: stmt 604 `== 8` gates
`AddMassivePermanentSuccubusWeight` (8 = Succu Slayer in
`static/fanservice/objectives.js` `specs`), and stmt 608 `== 7` gates the
green loop (7 = Tribute in the player, whose `isAllowedToCum` is also
`[6,7].includes(objective)`).

### 1d. Full transition table for both loops (ubergraph-wide inventory)

Complete inventory of `CumButtonFlashGreenLoop` / `CumButtonFlashRedLoop`
`PlayAnimation` / `StopAnimation` in
`ExecuteUbergraph_BP_GlobalManager.json` (2570 stmts), plus the two
`UI_Manager` functions above and `HandleCumEvent.json`:

| Site (ubergraph stmt) | Effect |
|---|---|
| 610 | Green on (session init, objective 7 only; §1a) |
| 644 | Red on (music-mode session start: block 618-653 binds `MusicModeManager` delegates and calls `StartPlayback`; see caveat in §4) |
| 692-694 | Stop green, stop red, then red on (block 688-695: creates a widget, `PopulateHoriBox`, `AddToViewport`; entry/trigger unresolved, §4) |
| 1175-1176 | Stop red, green on (cum-window start: `IsAllowedToCum? = true` at 1174, timer delegate `Set and Display Cum Window Timer` bound at 1171-1173, notification at 1177) |
| 1208-1209, 1226-1227, 1243-1244, 1302-1303, 1316-1317 | Red on, stop green (five objective-complete / window-close blocks; each also sets `IsAllowedToCum? = false`, creates `CumWindowClosedOverlay_Widget_C`, removes the overlay widget, notifies, then `DetermineCardV2`; §2d) |
| `HandleCumEvent` "start" | Stop red, green on (0 loops); see §2c |
| `HandleCumEvent` "end" | Stop green, stop red, then red on (0 loops); see §2c |
| `DetermineCardV2` 55 / 61 | Green on / red on at draw time (§1a/§1b) |

What stops/ends each loop: **only the other loop's start** (each function
stops the other; the window-close blocks stop green before playing red;
`HandleCumEvent` "end" and block 688-695 stop both, then play red). There is
no site that stops a loop and leaves both off, and no audio is involved at
any of these sites.

What happens on cumming: `SuccessfulCum` (ubergraph entry 97747) and
`PrematureCum` (entry 99913) sit in the ubergraph tail, and **no statement
in stmts 1321-2569 touches either flash loop or either overlay-widget ref**
(the complete inventory above ends at stmt 1320). So in retained code
neither function stops the loops or removes the overlay widget in its own
body. Caveat: entry bodies can jump to shared blocks elsewhere in the file,
and the full-file byte-offset map does not validate (§4), so a jump from
those bodies back into the window-close blocks (stmts 1200-1323) cannot be
excluded from the ASTs alone — but no such jump is visible in the tail
statements read (stmts 2480-2569 jump to 32826, 33380, 33972, 96997, 97106,
97545, 97752, 98346, 98393, 98443, 99017, 99219, 99452, none of which is a
flash/overlay site).

## 2. The overlay loop widget

### 2a. Class and refs

Class: `AllowedToCumOverlayLoop_Widget_C`. Two object refs to it exist on
`BP_GlobalManager_C` (`blueprint-class-defaults.json` field declarations;
no default *value* is recorded for either in `defaults[0].values`, 161
entries):

- `AllowedToCumOverlayLoopWidgetRef` (field ~line 2088, target
  `AllowedToCumOverlayLoop_Widget_C`) — written by the two ubergraph
  creation sites (§2b).
- `CumLoopWidget` (field ~line 3273, same target) — written only by
  `HandleCumEvent` "start" (§2c).

Flag: `DoesCumOverlayLoopExist?` (`BoolProperty` on `BP_GlobalManager_C`,
field ~line 2071). In retained code it is **only ever set true** — at the
two ubergraph creation sites below — and **never set false anywhere** in
the tree (the only other mention is the field declaration). Its default
value is not recorded in `defaults[0].values`.

### 2b. Creation site A — `CumEventOverride` (ubergraph stmts 1787-1791)

Local byte offsets computed from the anchored entry (see §5) resolve every
jump target in stmts 1776-1791 exactly:

- 1776 (entry 73198, `CumEventOverride.json` passes `73198`):
  `PopExecutionFlowIfNot CanDraw?` — exit if cannot draw.
- 1777: `JumpIfNot 73254` on `IsAllowedToCum?` — **false jumps to stmt
  1779 (the roll), not out of the function**; see the correction in §5.
- 1778: `JumpIfNot 73757` on `DoesCumOverlayLoopExist?` — false jumps to
  stmt 1787 (create the widget).
- 1787: `Create(Self, AllowedToCumOverlayLoop_Widget_C [-4181], NoObject)`;
  1788: `AddToViewport(0)`; 1789: store in
  `AllowedToCumOverlayLoopWidgetRef`; 1790: `DoesCumOverlayLoopExist? =
  true`; 1791: `Jump 73254` (back to the roll, stmt 1779).
- Then 1779 `RollFavoritesChance(6)`, 1780/1781/1785 spawns, 1782
  `Array_Random(CumBeatPatterns)`, 1783 `StartPatternWithMediaSync`, 1784
  return (see the reachability note for that tail).

So the widget is created **once, lazily, on the first allowed override
draw** while it does not yet exist — and, because the flag is never
cleared, never recreated by this site after any removal (§2d).

### 2c. Creation site B — `CreateAllowedToCumBackgroundLoop` (entry 73997)

`functions/BP_GlobalManager/CreateAllowedToCumBackgroundLoop.json` calls
`ExecuteUbergraph_BP_GlobalManager(73997)`. Resolved (offsets in §5):
entry 73997 is stmt 1794, a `Jump 72658` landing on stmt 1758:

- 1758: `Create(Self, AllowedToCumOverlayLoop_Widget_C [-4181], NoObject)`;
  1759: `AddToViewport(0)`; 1760: store in
  `AllowedToCumOverlayLoopWidgetRef`; 1761: `DoesCumOverlayLoopExist? =
  true`; 1762: return.

Trigger: `Spawn100PercentCumMeterOverrideEvent` (entry 66033), stmts
1598-1602: creates `PermissionToCumOverlay_Widget_C` (`-4204`, stmt 1599),
`AddToViewport` (1600), binds `CreateAllowedToCumBackgroundLoop` as a
delegate (1601), and calls `BindToAnimationFinished(SpawnOverlay,
delegate)` on that widget (1602). **The loop widget is therefore created
when the Permission-to-Cum overlay's `SpawnOverlay` animation finishes**
— not on a timer and not on the draw.

Related block, same resume target: stmts 1752-1757 (entry 72479, reached
from stmt 1750's music-mode check): `CanDraw? = true` (1752); `Create`
widget class **`-4182`** (1753), `CheckBMAutoToggles` (1754),
`AddToViewport` (1755); `Delay 0.1s` (1756) — whose latent resume is the
1758-1762 block above. The `-4182` class is **unidentified**: it occurs
exactly once in the whole tree (ubergraph line 51914) and no import table
mapping the negative `EX_ObjectConst` indices to classes is retained.

### 2d. Creation site C — `HandleCumEvent` "start" (beatmap cum event)

`functions/BP_GlobalManager/HandleCumEvent.json`: on a beatmap event with
`Type == 3` and `Value == "start"`, if `HasCame?` is false:

- `IsAllowedToCum? = true`;
- notification `"Cum Now!"` / `"You have a limited time to finish.\r\nDon't
  miss your chance!"`;
- creates `PermissionToCumOverlay_Widget_C` (`-4204`),
  `PlayAnimation(SpawnOverlay, 0, 1, 0, 1.0, false)` (plays **once**),
  `AddToViewport(0)`;
- creates `AllowedToCumOverlayLoop_Widget_C` (`-4181`) and stores it in
  **`CumLoopWidget`** (the second ref — *not* gated by
  `DoesCumOverlayLoopExist?`, and it does not set the flag),
  `PlayAnimation(SpawnOverlay, 0, 1, 0, 1.0, false)` (once),
  `AddToViewport(0)`;
- `StopAnimation(CumButtonFlashRedLoop)`, then `PlayAnimation(
  CumButtonFlashGreenLoop, 0, 0, ...)` (green loop, infinite).

The "end" branch (`Value == "end"`, `HasCame?` false): `IsAllowedToCum? =
false`; notification `"Cum Window Closed"` / `"Your chance to finish has
passed.\r\nBack to stroking!"`; if `CumLoopWidget` `IsValid`,
`CumLoopWidget.RemoveFromParent()`; creates
`CumWindowClosedOverlay_Widget_C` (`-4200`), plays its `SpawnOverlay`
once, `AddToViewport(0)`; stops green, stops red, then plays red
(0 loops).

### 2e. Removal sites (for `AllowedToCumOverlayLoopWidgetRef`)

Complete inventory — six `RemoveFromParent` calls on that ref in the
ubergraph, and no other:

- Stmt 665, block 663-666: `ApplySpeedModifier`, `bStopSequence = true`,
  `RemoveFromParent(AllowedToCumOverlayLoopWidgetRef)`. (Stop-sequence
  path; it does **not** stop either flash loop and does not clear the
  flag.)
- Stmts 1212, 1230, 1247, 1306, 1320 — the five objective-complete /
  window-close blocks, one per objective family (Succubi at 1200-1215 with
  notification `"Succubi Reset"` / `"Window Closed — Back to survival"`,
  Edges at 1218-1233, Strokes at 1234-1250, Time at 1295-1309, and the
  `Reset Cum Meter` block at 1310-1323). Each block, in order: clear the
  Cum Window Timer handle, `CumWindowTime` reset,
  `HasCumMeterOverideTriggered? = false`, `CanCumMeterTrigger = true`,
  `IsAllowedToCum? = false`, play red loop, stop green loop, create
  `CumWindowClosedOverlay_Widget_C` (`-4200`) + `AddToViewport`,
  `RemoveFromParent(AllowedToCumOverlayLoopWidgetRef)`,
  `CreateNotificationBox`, `DetermineCardV2`.

Because the flag is never cleared, after any of these removals the
`CumEventOverride` site (1787-1791) will never recreate the widget, while
the `HandleCumEvent` "start" site can still create a second instance into
`CumLoopWidget` on a later beatmap "start" — the two refs are never
reconciled in retained code.

### 2f. What the widget does — not established

- There is **no `AllowedToCumOverlayLoop_Widget` function directory** in
  `functions/` (unlike `CummingEarlyOverlay_Widget`,
  `CummingOnTimeOverlay_Widget`, `NormalEdgeOverlay_Widget`, which do have
  retained function ASTs). No Construct, tick, or animation function for
  it is retained.
- Its `SpawnOverlay` animation is played with `NumLoopsToPlay = 1` wherever
  it is played (`HandleCumEvent` start). The word "Loop" is in the class
  name only; nothing in retained code shows anything inside the widget
  looping, sounding, or updating.
- No sound cue, media call, or state write occurs at any creation site.
- The widget's visual contents, size/position, and the keyframes of
  `SpawnOverlay` (and of both `CumButtonFlash*Loop` animations) are in
  the widget assets, which are not in this tree.

## 3. What the player does today at each of those points

| Original point | Player today |
|---|---|
| Session init, objective 7 → green loop (610); music-mode start → red loop (644) | `Run` constructor: `player.isAllowedToCum = [6,7].includes(objective)` (`run.js:16,33`; `objectives.js:37`). No flash state, no loop start. `player = {sessionLength, hasCame, isAllowedToCum}` — nothing else. |
| Window opens → green loop, PermissionToCum overlay, loop widget on animation finish (1171-1179, 1598-1602) | `Objectives.Runtime.openReleaseWindow` (`objectives.js:52`): sets `isAllowedToCum = true`, `releaseDeadline = now + 60`, emits `release-window-opened`. `play.js` `objectiveEvents` (line 365): `cancelEdge`, `draw('cum', {force:true})`, status text `'Objective complete. 60 second release window.'`. `render()` shows a text countdown (`'Release window: N seconds.'`). No overlay widget is created, no animation plays, no flash changes. |
| Draw-time loops (`DetermineCardV2` 55/61) | `Run.cumOverrideDue()` (`run.js:72`): modes 0/1, `(isAllowedToCum \|\| hasCame)`, not edging — the override gate is implemented, but the draw path (`play.js` `draw()`, `run.startCard`) never changes any flash state. |
| Window closes → red loop, closed overlay, overlay removal, notification (1208-block family) | `Objectives.Runtime.expireReleaseWindow` (`objectives.js:63-71`): clears `isAllowedToCum`, `missedCumWindows++`, emits `objective-reset` with `overlay: 'CumWindowClosedOverlay_Widget'` — the closed overlay's *name* is already in the player, but no widget is created or shown; `play.js` only sets status text `'Release window closed. Objective reset.'`. No overlay removal (nothing was created), no flash change. |
| Beatmap cum event start/end (`HandleCumEvent`) | `play.js` `event()` cum_event (line 309): `'start'` sets `isAllowedToCum = true` and `timelinePool('cum')`; `'end'` sets it false. No overlays, no notifications, no flash changes. |
| Cumming (`SuccessfulCum` / `PrematureCum`) | `Run.applyEvents` (`run.js:86-90`): `hasCame = true`, phase `'complete'` (classic). No loop/overlay teardown — which matches the original's retained code (§1d), as far as it goes. |
| The cum button itself | `#finish` (`play.html:14`, `'Hold to finish'` / `'Hold to record tribute'` for objective 7; `play.js:356-359`): `disabled = !canFinish()` where `canFinish()` is `isAllowedToCum \|\| meter >= 1` (`play.js:506`), and `$('controls').dataset.finishReady` is set. No flashing class, no green/red state. |

## 4. Still open / unresolved in this trace

- **Widget animation content** (the blocker, §0): keyframes, period,
  animated properties, and colors for `CumButtonFlashGreenLoop`,
  `CumButtonFlashRedLoop`, and `AllowedToCumOverlayLoop_Widget.SpawnOverlay`,
  plus whatever the overlay widget displays. None is in retained ASTs.
- **Widget class `-4182`** (stmt 1753, §2c): unidentified; sole occurrence
  in the tree; no retained import table maps `EX_ObjectConst` indices to
  classes.
- **Entry/trigger of the 688-695 block** (stop both loops, play red,
  `PopulateHoriBox` widget): entry byte offset unresolved.
- **Entry offset of the 618-653 music-mode init block** (red loop at 644):
  content-established as music-mode init (`MusicModeManager` delegates,
  `StartPlayback`), but its entry offset is unresolved for the same reason
  below.
- **Full-file byte-offset map does not validate.** An extended sizer (based
  on `tools/hotbar_ubergraph_offsets.py`, adding `EX_SetArray`,
  `EX_BindDelegate`, `EX_AddMulticastDelegate`, `EX_ClearMulticastDelegate`,
  `EX_VectorConst`, `EX_RotationConst`, `EX_TransformConst`,
  `EX_Int64Const`, `EX_TextConst`, `EX_UnicodeStringConst`) reaches **0
  `EX_Context` offset mismatches** across all 972 contexts — after two
  empirical fixes (`FString` inside `FScriptText` is 2+len per string, not
  1+len; `EX_UnicodeStringConst` is 3+2·len) — but only **40/280 distinct
  jump targets align**, total **99449 vs 99921 expected** (push target
  99918 = final `EX_Return` + `EX_EndOfScript`). A brute-force search over
  plausible per-op size deltas (numpy, ~7.7k combos constrained to total
  99921) found no combination above **44/280 aligned**, so the residual
  drift is not explained by those op sizes; it is likely a statement-order
  or omitted-statement difference in the decompiler output, not a sizing
  error in the cum region (which validates exactly, §5). The extended
  sizer script was scratch work in `/tmp` (`gm_offsets.py`,
  `gm_brute.py`) and is not committed.

## 5. Corrections and method notes

- **Correction to the reachability note** (§3 there): in `CumEventOverride`,
  `IsAllowedToCum?` false does **not** exit the function. Stmt 1777
  `JumpIfNot 73254` lands on stmt 1779 (`RollFavoritesChance`), so the
  roll and the spawn still run; only the overlay-widget creation
  (1778/1787-1791) is gated on `IsAllowedToCum?`. The reachability note's
  wording ("if `IsAllowedToCum?` then create the overlay loop widget…;
  `RollFavoritesChance(6)`; …") is consistent with this, but it is worth
  stating explicitly because the false path still draws an override card.
- **Local offset verification (cum region, exact).** Anchored at entry
  73198 = stmt 1776 (`CumEventOverride.json` passes `73198`): 1777 @73217,
  1778 @73240, 1779 @73254, 1780 @73279, 1781 @73293, 1782 @73426, 1783
  @73485, 1784 @73618, 1785 @73619, 1786 @73752, 1787 @73757, 1788 @73810,
  1789 @73847, 1790 @73866, 1791 @73877, end @73882. Every jump target in
  the region resolves: 73254→1779, 73426→1782, 73619→1785, 73757→1787,
  73882→1792. Anchored backward from 73198: 72479→1752, 72658→1758,
  72398→1747, 72858→1766. Anchored forward from 73882: 73997→1794
  (`Jump 72658`, i.e. `CreateAllowedToCumBackgroundLoop` routes to the
  1758-1762 block), 74002→1795. The statement sizes used are validated by
  the 0-mismatch `EX_Context` check (§4); only the file-wide map fails.
- **No audio anywhere in this slice.** Neither loop function, no overlay
  creation site, and no removal site calls any sound function. (The
  session-start block at 1585-1587 plays a sound via `SpawnSound2D`, but
  that is a different entry, unrelated to the loops.)

## Verdict: still blocked — no player change made

No code was changed. A faithful player change would need, in order:

1. **The widget animation contents.** Keyframes (period, animated
   properties, colors) for `CumButtonFlashGreenLoop` /
   `CumButtonFlashRedLoop` and for
   `AllowedToCumOverlayLoop_Widget.SpawnOverlay`, plus what the overlay
   widget displays. Without them, any finish-button pulse or overlay
   widget in the player invents the visible behaviour — explicitly not
   done. This is the same class of blocker as the favorites slice (a
   mechanism whose only established facts are its trigger conditions).
2. **The `-4182` widget class** (stmt 1753), to complete the
   create-after-0.1s-delay path.
3. **Entry offsets / triggers** for the 688-695 block and the 618-653
   music-mode init block (needs a validating full-file offset map, §4).
4. **A player-side surface to attach to.** The finish button exists
   (`#finish`, enabled iff allowed or meter full), but the spec defines no
   flash behaviour and no overlay-widget surface; the release-window UI
   today is a text countdown plus status messages.

If (1) arrives, the faithful change is then a `cumFlash` state
(`'green'` / `'red'`, driven by the §1d transition table at the existing
player seams: session init, `openReleaseWindow` / `expireReleaseWindow`,
`cum_event` start/end, and the draw path via `cumOverrideDue` /
`DetermineCardV2` conditions) rendered as a flashing class on `#finish`,
plus an overlay-widget create/remove mirroring §2b-§2e (create once on the
first allowed override draw or on the PermissionToCum spawn-animation
finish; remove on window close / stop-sequence; never re-create via the
override path after removal). Strokes, interval, type, and pattern bank
stay exactly as the existing override branch already implements them.
