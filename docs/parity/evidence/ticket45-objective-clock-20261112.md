# #45 — GM-side objective clock (Devil guard / Prejac stop) — 2026-11-12

Decoded from the selected original v0.05.1 Hotfix Public and implemented in
the player. Sources: the legacy-converted cooked package
`CockHero/Content/NewSetup/BP_GlobalManager.uasset` (parsed with the repo's
`tools/evidence/kismet2.py` + `uasset.py`: ubergraph 2569 stmts, 0 errors,
icode 99921), cross-checked against the reJOIce newer-20261017 function
ASTs (`SetSessionDuration.json`, `SetSessionDurationEvent.json`,
`Format_Session_Duration_Text.json`, `Format_and_Session_Duration_Text.json`,
`ApplyHungrySuccubiEffects.json`, `ApplyAllOrNothingModifierEffects_IfToggled.json`,
`InitializeRoundObjectiveAndStats.json`, `AddtoCumMeteronBeatComplete.json`,
`EndSession.json`). No original game was executed.

## Reproduction (bytecode extraction)

The ubergraph `ScriptBytecode` is a TArray inside the
`ExecuteUbergraph_BP_GlobalManager` export: int32 count prefix at export
offset 49288 (value 138381), bytecode at 49292, 12 trailing bytes after it.
`SetSessionDuration`'s bytecode starts at export offset 716 (count prefix
1361 at 712). Parse with `kismet2.parse_script(data, pkg)`; statement
`ip` fields are iCode offsets, which is what jump targets use.

## The clock as decoded: two 1 s timers, one integer counter

Both timers are bound once at GM init (ubergraph stmts 586–591) and share
one counter, `PlayerVariablesStruct.SessionLength` (int; no non-zero CDO
default is recorded — it starts at 0 and is only ever incremented,
All-or-Nothing-zeroed, or Hungry-Succubi-adjusted; see §5).

| Timer | Binding | Rate / loop / first fire | Handler |
|---|---|---|---|
| `SetSessionDurationHandle` | stmt 586 `BindDelegate(SetSessionDurationEvent)` + stmt 587 `K2_SetTimerDelegate(delegate, 1.0, True, 1.0, 0.0)` → stored stmt 588 | 1.0 s / looping / 1.0 s | Entry 92328 → stmt 2329 → `Jump @92313` → stmt 2327: call `SetSessionDuration()`, stmt 2328 `PopExecutionFlow` |
| `FormatSessionDurationTextHandle` | stmt 589 `BindDelegate(Format Session Duration Text)` + stmt 590 `K2_SetTimerDelegate(delegate, 1.0, True, 0.5, 0.0)` → stored stmt 591 | 1.0 s / looping / 0.5 s | Entry 94452 → stmt 2400 → `Jump @93229` → stmts 2364–2399 |

`K2_SetTimerDelegate` parameters are
`(Delegate, Time, bLooping, InitialStartDelay, InitialStartDelayVariance)`,
so the two ticks are offset by half a second: the format tick fires first
at 0.5 s, then every 1 s; the duration tick fires at 1.0 s, then every 1 s.
The player evaluates both at the same whole-second boundary — a sub-second
phase difference only; thresholds are identical.

### Timer 1 — `SetSessionDuration()` (the Devil guard)

Verified in the v0.05.1 cooked function export (22 stmts, same op sequence
and jump offsets as the reJOIce AST):

```
devil = IsModifierActive?("Deal with the Devil")
if (!devil) goto INCREMENT            // stmt 1 JumpIfNot @141 -> stmt 5
if (!(CurrentCardTypeEnum == 3 && devil)) return   // stmt 4 JumpIfNot @918 -> Return
INCREMENT:
SessionLength += 1
SetSessionMetric(24, FTrunc(TimeAtHighHeat / SessionLength * 100.0))  // f64
if (Heat Level >= 70.0) UpdateMetric(23, 1)
if (Heat Level >= 70.0) PrintString(PercentTimeAtHighHeat)  // debug print only
```

Jump resolution (iCode offsets → statements): `@141` is stmt 5, the
increment — so Devil-inactive skips the card check and always counts.
`@918` is stmt 21, `Return` — so Devil-active with a non-Succubus card
returns immediately, skipping the increment AND the high-heat metric
updates. The guard is therefore: **count always, unless Devil is active
and the current card is not Succubus (3)**. The `PrintString` only runs
on high-heat ticks (stmt 16 `JumpIfNot @918` skips it otherwise); it is a
debug print with no player surface.

### Timer 2 — `Format Session Duration Text` (completion checks)

Entry via stmt 2400 → stmt 2364, whose condition is `IsStoreOnCooldown`:

```
2364: if (!IsStoreOnCooldown) goto 2396
2365: Format and Session Duration Text(...)   // SessionLength -> h/m/s text
2366: UIManager.UpdateObjectiveUITimerDisplay(...)
2367: if (CurrentSessionObjective == 1) {     // Timer branch
  2369-2372: ManuallyUpdateObjectiveProgressBar(SessionLength / Objective_TimeRequired_Seconds)
  2373: if (!IsAllowedToCum?) goto 2376
  2374: if (!HasCame?) goto 2340
  2375: PopExecutionFlow                      // allowed AND came: tick ends
  2376: FormatDurationText(SessionLength)
  2377: UIManager.UpdateObjectiveUITimerDisplay(formatted)
  2378: if (SessionLength >= Objective_TimeRequired_Seconds) {
    2379: PopExecutionFlowIfNot
    2380: Jump @92333 -> trigger block (stmt 2330, SuccuFrenzy check) }
  }
2381: if (CurrentSessionObjective == 6) {     // Prejac branch
  2382: PopExecutionFlowIfNot
  2383: if (SessionLength >= Objective_PrejacTimeRequired_Seconds) {
    2384: JumpIfNot @94068 -> 2389 (not yet complete)
    2385: K2_ClearAndInvalidateTimerHandle(FormatSessionDurationTextHandle)
    2386: K2_ClearAndInvalidateTimerHandle(SetSessionDurationHandle)
    2387: EndSession()
    2388: PopExecutionFlow }
  2389: UpdateObjectiveUIPrejacTimerDisplay()
  2390-2394: ManuallyUpdateObjectiveProgressBar((PrejacTimeRequired - SessionLength) / PrejacTimeRequired)
  2395: PopExecutionFlow }
2396: TimeSinceLastShop += 1.0   // only when the store is NOT on cooldown
2399: Jump @93243 -> 2365        // ...then the format/display/checks run anyway
```

Readings that matter for the player:

- **Timer completion is seconds-driven only.** The trigger function has no
  Timer case; completion reaches the trigger block (SuccuFrenzy check at
  stmt 2330, then the card-type gate at stmts 2357–2362:
  `CurrentCardTypeEnum ∈ {5, 6, 3}` blocks, else the trigger fires)
  exclusively from stmt 2380. Threshold is inclusive (`>=`).
- **Prejac completion stops the clock.** Stmts 2385–2386 clear both 1 s
  handles, then `EndSession()` — no trigger block, no release window, no
  notification, no metric. (EndSession itself clears one more timer, the
  Cum Window Timer Handle.) The only other clears of the two session
  handles anywhere in the ubergraph are none: every other
  `K2_ClearAndInvalidateTimerHandle` targets Idle/LootRush/Cum-Window/
  Bounty/FavoriteFrenzy/Taunt/RhythmMode/Slowdown/Succubus-cooldown or
  widget/edging timers.
- **While the release window is open**, the Timer branch (stmts 2373–2374)
  jumps to stmts 2340–2352 instead of the display/completion path:
  `UIManager.Objective_Numbers_Text.SetText(Format("{sec} Sec Left",
  trunc(CumWindowTime)))` — a display refresh only, no re-trigger. (The
  player already renders the release-window countdown from its
  `releaseDeadline`; the exact `"{sec} Sec Left"` wording is not wired as
  a separate text slot.)
- **Prejac-not-yet-complete and Timer display updates** (stmts 2369–2372,
  2376–2377, 2389–2394) are per-second UI updates (progress bar,
  formatted duration text). The player shows elapsed seconds in the stats
  line but has no Prejac-specific remaining countdown or progress bar —
  the same presentation gap recorded in
  `docs/parity/evidence/ticket51-queue-consumer-20261111.md`.
- **The shop counter rides the same tick.** `TimeSinceLastShop += 1.0`
  (double) runs on the format tick when the store is not on cooldown.
  Not modeled in the player (shop cooldowns are a separate system).

## How the seconds path differs from the beat path

| | Beat path (`BeatComplete` stmt 17 → trigger function) | Seconds path (the two 1 s timers) |
|---|---|---|
| Cadence | Every beat complete | Every whole session second (two timers, 0.5 s apart) |
| Objectives checked | 0 (Cum meter), 2 (Strokes), 3 (Edges), 8 (Succubus) — plus 7 (Tribute) direct | 1 (Timer), 6 (Prejac) only |
| Devil guard | None (meter gain is separately gated in `rules.js`) | Gates the counter increment in `SetSessionDuration()` |
| Prejac outcome | — (no Prejac case) | Clears both timers, `EndSession()` directly |
| Timer outcome | — (no Timer case) | Jumps into the trigger block at 92333 |

## What the clock does NOT do

- **It is not the release-window timer.** The 60 s cum window has its own
  1 s looping timer (`Start Cum Window Timer` →
  `Set and Display Cum Window Timer`, `CumWindowTime -= 1` per tick).
  That timer is not Devil-guarded; the player's release window still
  runs on wall seconds.
- **It is not the rewards clock.** Rewards (XP/UP) use the PM-side
  counter: `UProgressionManager::StartNewSession` (0x148313cd0) records
  session start world time and starts a separate 1 s timer;
  `EndSession` reconciles `elapsed = floor(UWorld+0x740 - start)` and
  takes `max(stored, elapsed)` (see
  `docs/parity/evidence/ticket45-classic-objectives.md`, Clock accounting).
  The PM clock is NOT Devil-guarded and NOT stopped at Prejac expiry.
  The player keeps `player.sessionLength` / `state.seconds` as that
  PM-side clock; `rules.js xp()` and `progression.js sessionUP()` still
  use it. Only `PercentAtHighHeat` (metric 24) uses the GM clock, because
  `SetSessionDuration` computes it from the GM counter (see §6).

## Other GM-clock readers and writers found

- **All-or-Nothing zeroes it.** `ApplyAllOrNothingModifierEffects_IfToggled`
  stmt 19: `SessionLength = 0` for objective 1 (the Timer reset branch;
  see `docs/parity/evidence/ticket48-item-source-gaps-20261108.md`).
  Implemented: `Run.resetObjective()` zeroes `gmSeconds` and its baseline
  alongside the existing PM-offset reset.
- **Hungry Succubi adjusts it.** `ApplyHungrySuccubiEffects` writes
  `SessionLength = Clamp(SessionLength - 2, …)` (stmts 20–22) on one
  branch and `SessionLength = SessionLength + 15` (stmts 41–42) on
  another, gated by a `HungrySuccubiCounter` and card-type switches
  (stmts 7–18, 27–38). The exact trigger conditions were NOT fully
  decoded in this pass — **not implemented** (no invented adjustment).
  This is a #50 modifier-effect item, not a #45 clock item.
- **Meter time gain reads it.** `AddtoCumMeteronBeatComplete` stmt 43:
  `SessionLength / 300` (the `Math.trunc(seconds/300)/10000` term in
  `rules.js meter()`). The player still uses wall `state.seconds` there —
  the effect is +0.0001 meter per 5 GM-minutes; threading the GM counter
  into the beat path was left out as a separable follow-up, recorded
  here rather than silently changed.
- **Tower rounds use the global counter natively.** `SessionLength` is
  never reset per round: no write to it exists in the ubergraph besides
  the `SetSessionDuration` increment (verified: no `Let` with a
  `SessionLength` target, no whole-struct `PlayerVariablesStruct` write),
  and `InitializeRoundObjectiveAndStats` sets `CurrentSessionObjective`
  and the per-objective targets from the round option without touching
  it. So a native Tower Timer/Prejac round compares TOTAL session
  seconds against the round's parameter. The player keeps its
  per-round baselines for Tower (the established round model, pinned by
  the Tower tests) and records this as an open divergence for #49, not
  silently changed in #45. The GM clock itself is global in the player
  too (`gmSeconds` is session-global; only the round baseline is
  per-round).

## Player implementation (2026-11-12)

- `static/fanservice/objectives.js` — `Runtime` gains the GM clock:
  `gmSeconds` (int, starts 0), `gmStopped` (both handles cleared),
  `gmSecondCounts(context)` (Devil guard: false iff
  `modifiers` includes `'Deal With The Devil'` and `cardType !== 3`),
  `tickSecond(player, stats, meter, now, context)` returning
  `{events, counted}` (one increment + the format-tick checks, in native
  order), and `finishCompleteObjective(...)` shared by the beat and
  seconds paths. `tick()` no longer completes Timer (1) or Prejac (6);
  `isComplete` / `isPrejacExpired` / `resolveClimax` take the GM reading
  (defaulting to `player.sessionLength`, so pre-clock callers keep the
  old behavior); states carry `baselineGmSeconds` (Tower round baselines
  come from the GM reading at `select()` time).
- `static/fanservice/run.js` — `advance()` runs one `tickSecond` per
  whole session second crossed (after edge/card advance, so the Devil
  guard reads the current card and the completion shares the post-advance
  stats snapshot), breaks the loop on a session/round-ending event, and
  applies `TimeAtHighHeat += counted` when heat ≥ 70 (heat read at the
  start of the advance, as before). `resetObjective()` zeroes the clock
  for Timer; `export()`/`restore()` persist `gmSeconds`/`gmStopped`
  (pre-clock saves fall back to `floor(player.sessionLength)`).
  `climax()` passes `gmSeconds` to `resolveClimax`.
- `static/fanservice/economy.js` — the `TimeAtHighHeat` increment moved
  out of `Economy.advance` into `Run.advance` (it is the only caller).
- `static/fanservice/progression.js` + `play.js` — `sessionMetrics`
  uses `gmSessionLength` (passed from `run.objective.gmSeconds` at
  settlement) as the `PercentAtHighHeat` denominator with
  `Math.trunc(TimeAtHighHeat / gm * 100)` (native `FTrunc`, f64),
  falling back to the old round-half wall-clock formula when no GM
  reading is supplied; `gmSessionLength` is deleted from the result so
  it cannot pollute lifetime metrics. XP/UP minutes still use the PM
  `SessionDuration`.
- Tests: `tests/fanservice_objectives.test.js` (Devil guard incl. the
  gate-blocked retry, Timer seconds-only, Prejac stop, gate/expiry
  tests moved to `tickSecond`), `tests/fanservice_run.test.js` (Devil
  hold + banked completion + wall-clock rewards separation, Prejac
  through `advance()`, export/restore + AoN zeroing + legacy fallback,
  `TimeAtHighHeat` gating), `tests/fanservice_progression.test.js`
  (`PercentAtHighHeat` trunc/GM denominator + fallback + no leak).
  Suite: 395 pass / 0 fail (was 387), Python schema 12 pass.

## Remaining open items for #45

- **UI bounds: blocked by construction.** No Classic objective-target
  selection UI exists in v0.05.1; targets are GameInstance class
  defaults (see `ticket45-classic-objectives.md`). Nothing new found.
- **Hungry Succubi ±2/±15 s adjustments** to `SessionLength`: trigger
  conditions not decoded (see §5). Needs a dedicated decode of
  `ApplyHungrySuccubiEffects` (a #50 modifier item).
- **Meter time-gain reader** (`SessionLength / 300` in
  `AddtoCumMeteronBeatComplete`): player still uses wall seconds
  (+0.0001 per 5 GM-minutes at most). Needs the GM counter threaded
  into the beat path if exactness is wanted.
- **Tower global-vs-baseline divergence** (see §5): native compares
  total session seconds per round; the player keeps per-round baselines.
  Needs a #49 decision, not a silent change here.
- **Presentation gaps** (unchanged): no Prejac remaining countdown or
  Timer progress bar in the player; the stats line shows PM wall
  seconds while the native Timer display shows the GM counter; the
  `"{sec} Sec Left"` objective-numbers text during an open window is
  not a separate slot (the release-window countdown overlay covers it).
- The PM 1 s tick function at 0x1482d2840 (via thunk 0x1482d9450) still
  has no PDB symbol, so the exact PM-side per-second accounting is not
  fully settled (pre-existing, from `ticket45-classic-objectives.md`).
