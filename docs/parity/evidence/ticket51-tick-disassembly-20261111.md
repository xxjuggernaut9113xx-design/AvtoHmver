# #51 — UMusicModeManager::Tick disassembly (v0.05.1)

Date: 2026-11-11. Source build: Cock Hero v0.05.1 Hotfix Public,
`CockHero.exe` SHA-256 `a8f46896…040c10` (verified), PDB with 630,923 public
symbols. All addresses are RVAs in that exe (image base `0x140000000`).
Disassembly via `objdump` from the build's own PDB (`Tick.asm`, 867
instructions, `UMusicModeManager::Tick` at `0x148315ac0`). Nothing here is
guessed: every claim cites an address, a PDB symbol, a decoded jump table,
or a byte read from the exe.

## Verdict up front

**The event-type byte mapping is SETTLED** (ParseBeatmapJson chain +
PDB `EBeatmapEventType`). **Tick's per-event handling is SETTLED at the
Tick level** (12-way jump table decoded, all callees PDB-resolved). But
the three remaining #51 criteria are **NOT settled by Tick alone**,
because Tick is only half the pipeline: it logs, queues, and dispatches
events, and enqueues beats to the spawner — the actual effects (pool
switch, cum window, break suppression) live in the consumer of the
`+0x668` event queue / the `FOnBeatmapEventDispatched` delegate /
Blueprint, which was not disassembled here. The 60 s cum-window hard-code
is left untouched (see §7).

## 1. Event-type byte mapping — SETTLED

`ParseBeatmapJson` compares the JSON `"type"` string against literals
(UTF-16LE, in `.rdata`) and stores one byte per event (event struct:
time `+0x00` double, type byte `+0x08`, value string `+0x10` FString,
extra double `+0x20`). The chain (`0x1483032c0`–`0x14830346d`, callee
`0x140d80e70` string-equals) gives, in check order:

| JSON string | byte | enum name |
|---|---|---|
| `media_change`, `media_switch` | 0 | MediaSwitch |
| `dialogue` | 1 | Dialogue |
| `edge` | 2 | Edge |
| `cum_event` | 3 | CumEvent |
| `speed_change` | 4 | SpeedChange |
| `cycle_media` | 5 | CycleMedia |
| `background` | 6 | Background |
| `text` | 7 | Text |
| `disable_break` | 8 | DisableBreak |
| `grant_break` | 9 | GrantBreak |
| (no match) | 10 | Custom |
| `restore_break` | 11 | RestoreBreak |

This matches the PDB `EBeatmapEventType` exactly (0 MediaSwitch …
11 RestoreBreak). Note `media_change` and `media_switch` both map to 0,
and an unknown type falls through to Custom (10), not an error.

Real-map usage (10 beatmaps, `CockHero/beatmaps/*/beatmap.json`):
`disable_break` and `cum_event` occur only as **start/end pairs** with
`value: 'start'` / `'end'` — the window is `[start, end]`, one cum
window per map (14.9–52.8 s, end − start). **No `grant_break` or
`restore_break` event exists in any of the 10 real maps.** The player's
`restore_break` handling is therefore dead code for real maps (harmless),
and its `disable_break` handling of the start/end pair matches the map
data.

## 2. Tick structure

Entry gates: `+0x541` set → return; two float-easing blocks (`+0x5e0`,
`+0x5f8`, smoothstep-style interpolation with completion callbacks);
`+0x540` clear → return; `+0x488` (spawner pointer) null → return.
Then `GetCurrentAudioTime` (`0x1482e9b40`, → audioTime) and
`EvaluateNotificationWarnings` (`0x1482decf0`).

**Beat loop first** (index `+0x688`, count `+0x280`, beat array `+0x278`,
24-byte structs: time `+0x00`, type byte `+0x08` where 0 = Stroke,
1 = Rest, 2 = Accent). A beat is processed when its time is ≤
audioTime + lookahead (`+0x690`); `+0x542` set skips the beat loop
entirely. Per beat:

- Inner event scan (cursor `+0x6d0`, separate from the event loop's
  `+0x68c`): events with time ≤ beat time. Type 0 (MediaSwitch) is
  applied **immediately here** — `FString::operator=` (`0x140cf99e0`)
  into member `+0x6c0`. Type 5 (CycleMedia) with
  |event time − beat time| < **0.02 s** (constant at `0x14bf2ebf8`) sets
  the same-time flag. Other types: nothing.
- Rest beats (type 1) are skipped. Accent beats (type 2) get a 1.5×
  speed field, others 1.0×.
- Interval = next non-rest beat time − beat time; else `60 / BPM`
  (`+0x268`); else **0.5 s** default (constant at `0x14bf2ec00`).
- If the spawner-side controller (`+0x498`, `UMediaPlaybackController*`)
  is non-null AND the CycleMedia same-time flag is set AND the
  beat payload's count field is > 1, `CommitMusicModeSwapForBeat`
  (`0x148267f20`) fires for that beat.
- The beat is **enqueued, not fired**: `EnqueueBeatEvent`
  (`0x14831d7a0`) on the spawner (`+0x488`).

**Event loop second** (index `+0x68c`, count `+0x290`, event array
`+0x288`). An event fires when its time is ≤ audioTime. Per event:

- If flag `+0x543` is set and the type is 8 (DisableBreak) or 11
  (RestoreBreak), the event is **logged and dropped** — never queued,
  never dispatched. The setter of `+0x543` was not found in any
  disassembled function (see §6).
- Otherwise the event is logged, **appended to the `+0x668` queue**
  (a per-manager event queue the spawner/Blueprint reads), and then
  dispatched through the 12-way jump table (table at RVA `0x83168e8`,
  entries are image-base-relative RVAs, type byte at event `+0x08`).

## 3. The 12 dispatch cases — what each does

| type | case | behavior in Tick |
|---|---|---|
| 0 MediaSwitch | `0x148316479` | `FString::operator=` into member `+0x6b0` (a *different* member from the beat-scan's `+0x6c0`); log; if `+0x498` non-null, `UMediaPlaybackController::SetExpectedMusicModeCategory(string)` (`0x1482aad70`); then `FOnMediaCategorySwitch_DelegateWrapper` (`0x1481d2a70`, delegate at `+0x1d8`). |
| 1 Dialogue | `0x1483164de` | Log; `FOnDialogueTriggered_DelegateWrapper` (`0x1481d29d0`, delegate at `+0x1f0`). |
| 2 Edge | `0x148316520` | Log only (with the event's `+0x20` double). |
| 3 CumEvent | `0x148316550` | **No pool switch, no state change in Tick.** Guard on `+0x4c8` (int32), `+0x4c4`, and flag bytes `+0x4c1`/`+0x4c3`: the common path logs and **skips** the shared tail; the other path logs and takes it. Either way the event was already queued at `+0x668` (see §4). |
| 4 SpeedChange | `0x1483165be` | Log only. |
| 5 CycleMedia | `0x1483165f3` | `ResolveBeatNumberForCycleMediaTime(eventTime)` (`0x14830c3d0`) → beat index; `ResolveMediaCategoryAtTime(eventTime, out)` (`0x14830caa0`) → category string; if `+0x498` non-null AND index ≠ −1 AND the out-param count > 1: `SetPendingMusicModeSwapCategory(string, index)` (`0x1482ac110`), `SetExpectedMusicModeCategory(string)`, `CommitMusicModeSwapForBeat(index, string)`. Log. |
| 6 Background | `0x1483166a9` | Log only. |
| 7 Text | `0x1483166de` | Log only. |
| 8 DisableBreak | `0x148316713` | Log; writes **−1.0** (double `0xbff0000000000000`) to `+0x580` and the event value-string's data pointer to `+0x588`. Does **not** distinguish `'start'` from `'end'` — both write the same values. No reader of `+0x580`/`+0x588` was found in the disassembled set (see §6). |
| 9 GrantBreak | `0x14831675b` | Log; `FOnBeatmapPlaybackComplete_DelegateWrapper` (`0x1481d29c0`, delegate at `+0x78`). Never fires on the real maps (no `grant_break` events). |
| 10 Custom | `0x1483167b0` | Straight to the shared tail. No case work. |
| 11 RestoreBreak | `0x148316782` | Log only, then the shared tail. No state change in Tick. |

**Shared tail** (`0x1483167b0`, reached by every case except the
CumEvent common path and the `+0x543`-dropped 8/11):
`FOnBeatmapEventDispatched_DelegateWrapper` (`0x1481d2810`, delegate at
`+0x130`, with the event struct). This broadcast — together with the
`+0x668` queue — is the channel by which the cum window, the break
suppression, and any pool switch would actually happen. That consumer
was not disassembled here.

## 4. The three #51 questions — answered as far as Tick goes

### Pool switch on cum_event start — NOT in Tick
Tick performs **no media/category/pool switch for `cum_event`**. Case 3
only logs, and (usually) skips even the `FOnBeatmapEventDispatched`
broadcast. The cum window's effect must come from the `+0x668` queue
consumer or the delegate/Blueprint — not disassembled. The player's
current behavior (switch to the cum pool on `cum_event` `'start'`) is
therefore **not confirmed by Tick, and not contradicted either**: the
delivery channel exists (the event is queued), but the consumer that
would act on it is unread. Do not present the player's cum-pool switch
as native-verified.

### Event-vs-beat ordering at equal timestamps — structure settled, observable order NOT settled
Within one Tick, the **beat loop runs first** (due beats are enqueued to
the spawner; MediaSwitch events at-or-before a beat are applied during
the scan; CycleMedia coincidences within 0.02 s are flagged) and the
**event loop runs second** (due events are logged, queued, and
dispatched). But the beat's observable effect is **deferred**: the beat
is only *enqueued* (`EnqueueBeatEvent`) and fires when the spawner
consumes its queue, while the event dispatch is immediate within Tick.
So Tick's internal order (beats enqueued before events dispatched) does
not by itself establish the player-visible order at equal timestamps —
that depends on the spawner, which was not disassembled. The player's
`schedule()` (events before beats at equal times) is **not confirmed**
as the observable order. Record it as an open ordering question, not as
a Tick-established fact.

### In-window break behavior — mechanism NOT settled
`DisableBreak` in Tick writes −1.0 / value-string-pointer to
`+0x580`/`+0x588` for both `'start'` and `'end'` events, and the
`+0x543` flag (setter unknown) makes DisableBreak/RestoreBreak events
drop entirely. No reader of `+0x580` was found, and `RestoreBreak`
performs no restore in Tick. The actual break suppression — what a
Break attempt does while a disable window is open — lives in the
queue/delegate consumer, not in Tick. The player's model (Break fails
during a disabled section, producer 45 records it) matches the map data
(start/end pairs) but its suppression mechanism is not native-verified.

## 5. Constants pinned by this read

- CycleMedia/beat coincidence epsilon: **0.02 s**.
- Beat interval fallback: `60 / BPM`, else **0.5 s** default.
- Beat lookahead: member `+0x690` (value not pinned — it is read live,
  not a constant in Tick).
- `+0x4c8` is written by `StartPlayback` (`0x148314496`, as part of a
  struct copy into `+0x4b0`–`+0x4f0`); its role in the CumEvent guard
  (compared as int32 against `+0x4c4`) is not established.

## 6. Still missing (exact)

1. **The `+0x668` event-queue consumer / `FOnBeatmapEventDispatched`
   handler.** Who reads the queued events and what it does for
   `cum_event` (window open/close, pool switch), `disable_break`
   (break suppression while a window is open), and `restore_break`.
   This is the piece that would settle the pool-switch, in-window
   break, and observable-ordering questions.
2. **The setter of `+0x543`** (the flag that drops DisableBreak /
   RestoreBreak events before queueing). Not in any disassembled
   function; likely Blueprint-side or in a native not disassembled.
3. **A reader of `+0x580`/`+0x588`** (the −1.0 / value-string written
   by the DisableBreak case). Without it, the meaning of −1.0 is
   unestablished.
4. **The CumEvent guard fields** `+0x4c8` / `+0x4c4` / `+0x4c1` /
   `+0x4c3`: their meanings (count vs threshold vs flags) are not
   established from the disassembled set.
5. **The spawner side** (`UBeatSpawnerManager`, `EnqueueBeatEvent`
   consumer): when an enqueued beat actually fires relative to a
   dispatched event at the same timestamp.
6. **Any release-deadline constant** for the cum window: no such
   constant exists in Tick. See §7.

## 7. The 60 s cum-window hard-code — left untouched

`static/fanservice/objectives.js:52` `openReleaseWindow` hard-codes a
60 s release window. The survey found the real cum windows are
14.9–52.8 s, one per map, defined by the `cum_event` start/end pairs —
but Tick establishes **no release-deadline mechanism at all** (no
constant, no deadline field, no pool switch). The map's `[start, end]`
window and the player's 60 s release deadline are different mechanisms
(the window is when cum is expected; the deadline is the player's
objective-completion grace period), and nothing in Tick links them.
Replacing 60 with `end − start` would invent that link. The hard-code
stays until the §6 item 1 consumer is read and either confirms a
deadline semantic or shows the deadline does not exist in the original.

## 8. Disassembly artifacts

Work files (not committed):
`~/workspace/rejoice-evidence/cockhero-itch/work/Tick.asm`,
`ParseBeatmapJson.asm`, `StartPlayback.asm`. Symbol resolution via
`~/workspace/rejoice-evidence/v0051-work/v0051-pdb-symbols.json`
(630,923 public symbols, this build's own PDB). Jump-table base RVA
`0x83168e8` (12 int32 image-relative entries, decoded in full).
