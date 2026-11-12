# #45 — Hungry Succubi, meter time-gain, and the PM 1 s tick — 2026-11-12

Work done on branch `spec/avtohmver-open-tickets` starting at HEAD
`85a486c` (local commits only). All decodes are from the cooked
v0.05.1 package and the hash-verified v0.05.1 exe/PDB
(`~/workspace/rejoice-evidence/cockhero-itch/`, exe SHA-256
`a8f46896…`), parsed with the repo tools
(`tools/evidence/kismet2.py`, `uasset.py`) and cross-checked against
reJOIce
(`~/workspace/reJOIce/Analysis/ReferenceBuilds/newer-20261017/`).

## Hungry Succubi — fully decoded

Source: `BP_GlobalManager.uasset`, export 26
`ApplyHungrySuccubiEffects` (size 2834, offset 498389).
ScriptBytecode TArray at export offset 575, count 2243, 12 trailing
bytes. Parsed: **49 stmts, max_icode 1526, 0 errors**. Cross-checked
against reJOIce
`functions/BP_GlobalManager/ApplyHungrySuccubiEffects.json`.

`JumpIfNot` jumps when its condition is false; the condition is
`NotEqual_ByteByte`. Resolved flow:

- **Gate (stmts 0–3):** return unless `CurrentCardTypeEnum == 3`
  (Succubus) AND `IsModifierActive?('Hungry Succubi')`.
- **Stmts 4–6:** `HungrySuccubiCounter += 1`; Temp = new value.
- **First switch on `GameInstance.CurrentSessionObjective`
  (stmts 7–19):** `==1` → Timer branch (ip 625); `==2` → Strokes
  branch (ip 824); `==3/6/7/8` → 200-check (ip 890, stmt 27); else
  (0, 4, 5) → return @1524.
- **Timer branch (ip 625–819):** `SessionLength = Clamp(SessionLength
  - 2, 0, 9999999)` (stmts 20–22; member
  `SessionLength_56_D6CECACC4BB58ACDC313F09687D17721` in
  `PlayerVariablesStruct`); `PlaySound2D` (stmt 23, ip 759; sound
  asset `cumSFX__10_`, vol 1.5, pitch 1.0, import -3914); Jump @1524
  return. **Timer: −2 s per Succubus card; the 200-check is NOT
  reached; the counter is never reset on Timer.**
- **Strokes branch (ip 824):** `SubtractSessionMetric(0, 3)` (metric
  0 = Strokes); Jump @759 → sound → return. Also never reaches the
  200-check.
- **200-check (ip 890, stmts 27–29):** Temp < 200 → return with no
  effect; Temp ≥ 200 → counter = 0, then a second switch (stmts
  30–38): `==3` → ip 1392: `SubtractSessionMetric(1, 1)` (Edges −1);
  `==6` → ip 1300: `SessionLength += 15` (no clamp); `==7` → ip
  1234: `SubtractSessionMetric(36, 1)` (MilkingCount −1); `==8` → ip
  1458: `SubtractSessionMetric(2, 1)` (SuccubiDefeated −1); each jumps
  @759 → sound → return.
- Metric ids from `static/fanservice/economy.js` `metricIds`: 0
  Strokes, 1 Edges, 2 SuccubiDefeated, 36 MilkingCount.
- The sound plays on every effect (Timer/Strokes immediate + each
  200-bonus); there is no player audio surface for it — recorded as
  not modeled.
- **Caller:** `BeatComplete` calls `ApplyHungrySuccubiEffects`
  unconditionally last (stmt 31 of 34), once per beat complete —
  verified via reJOIce `BeatComplete.json` and cooked export 35 (33
  stmts, max_icode 820).
- **Counter lifetime:** written ONLY in this function (grep of the
  reJOIce GM functions) — session-persistent, starts 0, no per-round
  reset. In Tower it persists across rounds while the objective
  switches per round (200 built under Timer rounds fires +15 s on the
  first Succubus card of a Prejac round — native behavior, pinned in
  test).

## Meter time-gain reader — threaded

`AddtoCumMeteronBeatComplete`, cooked export 14 (ScriptBytecode at
export offset 1304, count 2261, 12 trailing; 49 stmts, max_icode
1516, 0 errors): stmt 43, ip 1307:
`Divide_IntInt(PlayerVariablesStruct.SessionLength [name idx 1134],
300)` → `Conv_IntToDouble` → `/10000.0`. Other struct members
confirmed by name index: 1340 `TotalEdgeCount`, 459
`ConsecutiveHighHeatDraws`, 495 `CurrentComboCount`, 687 `HasCame?`,
483 `CumMeterMultiplier`, 1028 `PlayerVariablesStruct`. The player
previously used wall `state.seconds` in `rules.js` `meter()`; it now
uses the GM counter.

## PM 1 s tick at 0x1482d2840 — identified (functionally, no PDB name)

- Registered by `StartNewSession` (0x148313cd0): delegate struct on
  the stack, function pointer = thunk `0x1482d9450` (single `jmp
  0x1482d2840`), stored at +0x160; PM object (r15) at +0x188.
  Verified via objdump (`lea` at 0x148314183 → 0x1482d9450).
- Disassembly 0x1482d2840–0x1482d2c39 (ret): three identical blocks —
  `MultiFind` (0x1482cce40) on PM+0x1e0
  `TMultiMap<EMetricType,FName>` for keys 12 (SessionDuration), 23
  (0x17, TimeAtHighHeat), 24 (0x18, PercentAtHighHeat); per challenge
  name: `GetChallengeDataPtr` (0x1468fb7a0), skip if +0x68 complete
  byte set, call `UpdateChallengeProgress` (0x148318270) as (this,
  name, metric, 0); then broadcast `FOnChallengeProgressUpdate`
  delegate (this+0x28) via 0x1481e86d0.
- `UpdateChallengeProgress` PDB signature:
  `?UpdateChallengeProgress@UProgressionManager@@IEAAXVFName@@W4EMetricType@@H@Z`.
  Its reJOIce.c shows the 4th param is a delta added only in the
  default case; for metrics 12/23/24 it re-reads live values: metric
  12 via `FUN_1482e9f20(this)`, metric 23 from this+0x288, metric 24
  derived as `clamp(floor(TimeAtHighHeat/SessionDuration*100 − 0.25),
  0, 100)` (constants 100.0f at 0x14bf56a6c, 0.5f at
  0x14bf3cd28) — the same formula as `CombineSessionStatsArray`.
- **Conclusion: the tick maintains NO stored per-second counter; the
  PM clock is the live world-time computation** (`FUN_1482e9f20`
  body not decoded — exact formula unverified, presumably
  `floor(UWorld+0x740 − start)` matching the EndSession
  reconciliation). The player model (`player.sessionLength` advances
  with wall time; settlement takes max) is confirmed consistent; **no
  code change was needed**.
- PDB verification: a minimal MSF 7.0 reader was written for this
  pass (`pip install pdbparse` failed — construct<2.10 build error on
  this Python). Streams 8/9 are hash-only tables; records live in
  stream 10 (sym record stream, 160 MB). Scanned 1,112,194 S_PUB32
  records. Validation: StartNewSession at exactly 0x148313cd0,
  UpdateChallengeProgress at 0x148318270,
  RefreshIncompleteSessionChallengeMetric at 0x148307760. **No public
  symbol at 0x1482d2840**: nearest below
  `FBeatmapLibraryEntry::operator=` at 0x1482d0db0 (0x1790 bytes
  before), nearest above `FObjectFinder<UDataTable>` deleting
  destructor at 0x1482d3040 (0x800 after).

## Implementation map

- `static/fanservice/objectives.js`: `Runtime` gains
  `hungrySuccubiCounter = 0` (constructor + `reset()`); new method
  `applyHungrySuccubiEffects(live, context)` with the full evidence
  comment. Gate: `cardType === 3` + `'Hungry Succubi'` in modifiers.
  Tower uses `context.state` (round objective), Classic uses
  `this.state`. Music mode (mode 2) returns null — no modeled
  `CurrentSessionObjective` in Music mode, same as the rest of the
  objective machinery. Returns null on gate fail / Music; otherwise
  `{effect, sound, counter}`, effect in `'timer-minus-2' |
  'strokes-minus-3' | 'edges-minus-1' | 'prejac-plus-15' |
  'milking-minus-1' | 'succubi-minus-1' | null`. Timer clamps [0,
  9999999]; Prejac +15 unclamped; metric subtracts clamp ≥0 on the
  live fields (`run.state` `strokes`/`edges`/`succubi`/`milkingCount`
  — NOT `Economy.subtractSessionMetric`, which writes PascalCase
  session-stats fields the objectives don't read).
- `static/fanservice/economy.js`: `beat()` meter call now passes
  `seconds: run.objective?.gmSeconds ?? effective.seconds`; calls
  `run.objective.applyHungrySuccubiEffects(s, run.context())` at the
  end of `beat()` (last, mirroring BeatComplete stmt 31), guarded by
  `run.objective && typeof run.context === 'function'`.
- `static/fanservice/rules.js`: comment that `meter()`'s
  `state.seconds` is the GM SessionLength.
- `static/fanservice/run.js`: `export()` includes
  `objective.hungrySuccubiCounter`; `restore()` defaults it to 0
  when not finite (pre-counter saves).
- Tests (test-first; red confirmed — 6 failing before
  implementation): 4 appended to
  `tests/fanservice_objectives.test.js` (gate/counter; Timer −2 /
  Strokes −3 + clamps + 200-check unreachable; 200-threshold bonuses
  per objective incl. Cum-meter counter-only growth; Tower round
  objective + counter persistence + reset); 1 appended to
  `tests/fanservice_economy.test.js` (meter time gain reads GM
  SessionLength: gmSeconds=300/wall 0 → meter .00035; wall 600/gm 0
  → .00025); 1 appended to `tests/fanservice_run.test.js` (beat
  integration + export/restore round-trip + pre-counter save fallback
  + no-modifier control).
- Full suite after implementation: Node 418 pass / 0 fail (baseline
  412 + 6 new).

## Still unresolved for #45

- **UI bounds — blocked by construction.** No Classic
  objective-target selection UI exists in v0.05.1; targets are
  GameInstance class defaults. See `ticket45-classic-objectives.md`.
- **Tower global-vs-baseline divergence** — needs a #49 decision, not
  a silent change.
- **Presentation gaps** — no Prejac countdown, no Timer progress bar,
  `"{sec} Sec Left"` text is not a separate slot.
- `FUN_1482e9f20` body undecoded (exact PM SessionDuration formula
  unverified); `UWorld+0x740` field name unresolved; EndSession's
  single `UpdateMetricWithConditions` call arguments not decoded.
