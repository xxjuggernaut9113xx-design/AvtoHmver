# #51 remainder — MEDIA events in the 10 real beatmaps: survey (2026-11-11)

Survey only; no player code changes. The offset question is settled
elsewhere (`ticket51-startfrombeatmap-disassembly-20261111.md`: the
original parses `FBeatmapMeta.Offset`, stores it, and never applies it
to beat or event times). This note covers the remaining acceptance
criteria — event/progression correspondence and weighting for supported
MEDIA events — using the 10 real `beatmap.json` files in the v0.05.1
build plus the player's existing timeline code.

## Source

- Beatmaps: `Windows/CockHero/beatmaps/*/beatmap.json` in the
  hash-verified v0.05.1 build (exe SHA-256 `a8f46896…040c10`).
  10 maps, **5,734 beats, 3,876 events**.
- Player timeline: `static/fanservice/rules.js` (`schedule`, `seek`,
  `recordingSample`, `controlChannel`), `static/fanservice/play.js`
  `event()` (lines ~390–400), `static/fanservice/store.js`
  `validateMusic`.
- No Tick/event-dispatch disassembly exists yet (see §6).

## 1. Event taxonomy — what actually occurs

Every event in all 10 maps has exactly the keys `{time, type, value}` —
no weight, duration, or extra field anywhere. Every beat has exactly
`{time, type}` and **all 5,734 beats are type `stroke`** (no `rest` /
`accent` beats in the real maps, although the player's validator
accepts them).

| event type | count | values | player handling (`play.js` `event()`) |
|---|---|---|---|
| `cycle_media` | 3,597 | always `"true"` | `draw()` — draws a new card from the current pool |
| `media_change` | 177 | `slow` 63, `medium` 40, `fast` 53, `succubus` 12, `cum` 9 | `timelinePool(value)` — switches the card pool |
| `background` | 54 | `normalbeatbackground` 31, `succubusbackground` 12, `successfulcumbackground` 8, `temptationbackground` 1, `tauntbackground` 1, `mercybackground` 1 | `FanserviceBackground.apply(...)` |
| `disable_break` | 28 | `start` 14 / `end` 14 | `state.breakSectionDisabled = (value === 'start')` |
| `cum_event` | 20 | `start` 10 / `end` 10 | `isAllowedToCum = (value === 'start')`; on `start` also `timelinePool('cum')` |

All five types that occur are in the player's supported set
(`store.js`: `media_change`, `cycle_media`, `speed_change`,
`background`, `text`, `disable_break`, `restore_break`, `grant_break`,
`dialogue`, `edge`, `cum_event`). The other six supported types never
occur in the 10 real maps. `speed_change` fails closed at playback
(`validateMusic` throws when a playable map contains it) — consistent
with the NEWEST_MUSIC_TIMELINE note that its native semantics are
unverified.

## 2. Event/progression correspondence — what is determinable

**Cum windows.** Exactly one `cum_event` start/end pair per map
(10 windows, 14.9–52.8 s: Cake 14.9, Fantasy 32.4, I_Am_Just_a_Slut
37.4, In_Your_Head 52.8, Instructions_Unclear 44.9, Kinda_Quirky_Tho
30.0, Lil_Brat 41.4, Pleasure_Place 40.7, Say_I_m_Yours 36.0, YOLO
28.6). The window is late in the song in every map (starts at
126.5–221.3 s, ends at 141.4–270.5 s). The last event of every map is
its `cum_event` end, and every map's events end well before the song
does (e.g. Cake: last event 141.4 s, duration 156.3 s) — the timeline
goes quiet after the cum window closes. The player's 60 s cum-window
hard-code (`objectives.js:52`, already flagged as unevidenced under
#45) is **not** the original's window: the real windows are 14.9–52.8 s
and vary per map. Do not replace 60 s with any single number from this
table; the window is per-map data, not a constant.

**`media_change cum` vs the cum window — NOT 1:1.** 8 of the 9
`media_change cum` events land exactly on their map's `cum_event`
start time. The two exceptions prove the two events are independent
in the maps:
- Cake: `media_change cum` at 119.0 s, but the cum window starts at
  126.5 s (7.5 s later).
- In_Your_Head: no `media_change cum` at all, despite a 52.8 s cum
  window (217.7–270.5 s).

The player switches to the cum pool on `cum_event` start regardless
of any `media_change` (`play.js`: `timelinePool('cum')` on start), so
it covers both cases. Whether the ORIGINAL also switches pool on
`cum_event` start — or only on `media_change` — is **not**
established by the maps or by the existing disassembly; that is a
runtime-dispatch question (§6).

**Break disabling.** 14 matched `disable_break` start/end pairs
across 7 maps (Cake 4, In_Your_Head 2, Pleasure_Place 2, Say_I_m_Yours
2, Fantasy 1, Lil_Brat 1, YOLO 1); three maps have none
(I_Am_Just_a_Slut, Instructions_Unclear, Kinda_Quirky_Tho). Window
lengths 6.5–19.3 s. The player's `breakSectionDisabled` flag mirrors
the start/end pair directly. The native effect that consumes the flag
(the `RecordDisabledBreakSectionFailure` producer, metric 45 — see
`ticket50-producers-native-20261111.md`) is a separate, settled
producer; the dispatch question is only what the original does while
the flag is set (§6).

**Pool-switch weighting (map level).** The `media_change` distribution
is the timeline's pool-selection weighting as authored: slow 63,
medium 40, fast 53, succubus 12, cum 9 (177 switches over 10 maps).
No per-event weight field exists — the weighting IS the event stream.
`cycle_media` (3,597, ~93% of all events) is the draw trigger and
carries no payload beyond `"true"`.

**In-pool draw weighting is NOT a beatmap question.** Nothing in the
beatmap files weights draws within a pool. The draw-side weighting
(the favorite-injection roll, the category decks) is the #44 draw work
(`ticket44-favorites-native-20261111.md`), not something these files
can settle.

**Ordering at equal timestamps.** The player's `schedule()` fires
events before beats at equal times (control-before-beat). The real
maps do contain events and beats at (near-)identical times — e.g.
In_Your_Head's first `media_change` at t=0 — but whether the original
applies the same ordering is a dispatch question (§6), not something
the file contents establish.

## 3. The offset, revisited — a concrete player gap

The player's `validateMusic` (`store.js:52`) **rejects any map whose
`meta.offset` is nonzero** (`map.meta.offset!==undefined &&
map.meta.offset!==0` → throw). Three of the ten official maps have
nonzero offsets and are therefore unloadable in the player:

| map | `meta.offset` |
|---|---|
| Instructions_Unclear | +0.004 |
| Lil_Brat | −0.013 |
| Pleasure_Place | +0.016 |

The original parses the offset and never applies it — it plays these
maps at their raw file times. The player is therefore stricter than
the original: it refuses maps the original accepts. The fix implied by
the settled offset evidence is to **accept the offset field and ignore
it** (matching the original's runtime behavior), not to apply it and
not to keep rejecting. No code change is made in this run; this is
recorded here as the exact #51 remainder item.

(Observation, not a claim: Instructions_Unclear's first event time
0.0039999 numerically equals its stored offset 0.004, but the other
two nonzero-offset maps' first events are at 2.146 s and 6.796 s, so
there is no consistent offset-baking pattern in the files. Do not
treat the offset as baked into the file times.)

## 4. What the maps do NOT contain

- No `speed_change`, `text`, `restore_break`, `grant_break`,
  `dialogue`, or `edge` events in any real map. The player's handling
  of those six types is unvalidated against real content; they remain
  supported-but-unevidenced.
- No `rest` / `accent` beats. The player's beat handling for those
  types is unvalidated against real content.
- No per-event weight, duration, or priority field. Any "weighting"
  beyond the event stream itself must come from the native dispatch
  or the draw code, not from these files.

## 5. Determinable vs not — summary

Determinable from the beatmaps + player code (this note):
- The full event taxonomy, values, counts, and per-map windows (§1–2).
- The cum-window lengths are per-map (14.9–52.8 s), not a constant —
  the player's 60 s hard-code is unevidenced.
- `media_change cum` and `cum_event` are independent events (Cake,
  In_Your_Head).
- The player rejects 3 of 10 official maps over the nonzero offset,
  which the original ignores (§3).

Not determinable from the beatmaps (needs the dispatch disassembly):
- Whether the original switches pool on `cum_event` start.
- The original's event-vs-beat ordering at equal timestamps.
- What the original does while `disable_break` is active beyond the
  flag itself (the failure producer is settled; the in-window
  behavior is not).
- Any draw weighting beyond the event stream (that is #44's draw
  work).

## 6. Exact missing evidence

`UMusicModeManager::Tick` at `0x148315ac0` (v0.05.1 PDB, named in
`ticket51-startfrombeatmap-disassembly-20261111.md`) has **not been
disassembled** — no `Tick.asm` exists in
`~/workspace/rejoice-evidence/cockhero-itch/work/`. Disassembling it
(plus the event-consumer functions it calls — the `media_change` /
`cycle_media` / `cum_event` / `disable_break` handlers) is the named
next step for the remaining #51 acceptance criteria. `StartPlayback`
(`0x148314390`, disassembled) covers setup only, not runtime dispatch.
