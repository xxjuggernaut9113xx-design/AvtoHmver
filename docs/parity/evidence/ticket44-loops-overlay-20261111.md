# #44 loops/overlay — widget animation contents (cooked packages, v0.05.1)

Source: hash-verified v0.05.1 build, unpacked with retoc (Oodle), converted to
legacy `.uasset`/`.uexp` with `retoc to-legacy` (Paks-dir input,
`--no-script-objects`), parsed with the session's Python reader
(`work/uasset.py`, `work/kismet2.py`, `work/moviescene3.py`, `work/cumoverlay.py`
in `~/workspace/rejoice-evidence/cockhero-itch/work/`).

Packages (manifest paths):
- `/Game/Widgets/ItemUseWidgets/AllowedToCumOverlayLoop_Widget`
- `/Game/NewSetup/CumInXSecWidgetOverlay`
- `/Game/NewSetup/CumWithinXSecWidgetOverlay`

## Correction: `AllowedToCumLoopBackground` is an image, not an animation

`AllowedToCumLoopBackground` is a **Texture2D** (8,294,537 bytes) — the static
background image of the overlay. The animation lives in
`AllowedToCumOverlayLoop_Widget` as the WidgetAnimation **`SpawnOverlay`**.

## AllowedToCumOverlayLoop_Widget — `SpawnOverlay` (1 second loop)

Tick resolution is **60000/1** (60000 ticks = 1.0 s) in every section below.
Section data ends with a 16-byte GUID + 4 zero bytes.

### Transform track — `MovieScene2DTransformSection_0` (666 bytes, 7 channels)

| Channel | Keys (tick, value) | Seconds |
|---|---|---|
| TranslationX | (0, 0.0) | constant |
| TranslationY | (0, 0.0) | constant |
| Rotation | (0, 0.0) | constant |
| **ScaleX** | (0, 1.0), (30041, 1.1), (60000, 1.0) | 0, ~0.501, 1.0 |
| **ScaleY** | (0, 1.0), (30041, 1.1), (60000, 1.0) | 0, ~0.501, 1.0 |
| ShearX | (0, 0.0) | constant |
| ShearY | (0, 0.0) | constant |

A uniform **10% scale pulse** (1.0 → 1.1 → 1.0) over 1 s. Nothing else moves.

### Color track — `MovieSceneColorSection_0` (488 bytes, 4 channels)

| Channel | Keys (tick, value) |
|---|---|
| Red | (0, 1.0), (60000, 1.0) — constant |
| Green | (0, 1.0), (60000, 1.0) — constant |
| Blue | (0, 1.0), (60000, 1.0) — constant |
| **Alpha** | (0, 1.0), (30041, 0.5), (60000, 1.0) |

Opacity **fades to 50% at the midpoint** (~0.501 s) and returns to 1.0 at 1.0 s.
RGB never changes.

### Playback — widget ubergraph (script at export offset 124, icode 89, storage 105, 7 stmts)

On Construct:
`PlayAnimation(SpawnOverlay, StartAtTime=0.0, NumLoopsToPlay=0, PlayMode=0 Forward, PlaybackSpeed=1.0, bRestoreState=False)`.

`NumLoopsToPlay = 0` means **loop infinitely** in UMG PlayAnimation (Epic forums,
multiple confirmations). So the overlay breathes continuously while visible:
1 s loop, +10% scale and −50% opacity at the midpoint.

The widget also has a `MovieSceneEventTrack_0` (81 bytes) +
`MovieSceneEventTriggerSection_0` (36 bytes) and a `SequenceEvent` stub export.
**Purpose: SETTLED (2026-11-11).** The widget ubergraph (7 stmts, icode 89):
stmt 1 @10 Construct → `PlayAnimation(SpawnOverlay, 0.0, NumLoops 0, Forward,
1.0, False)`; stmt 3 @62 (SequenceEvent entry, icode 62) →
`VirtualFunction RemoveFromParent` with no params. When the event track
fires, the widget removes itself from its parent.

**Frame: decoded as far as the cooked data allows — NOT recoverable
(2026-11-12).** The section exports are UE5 *unversioned* property streams,
not property-tag streams (PropWalker fails on them for that reason). The
fragment header decodes per the `unreal_asset` Rust crate
(`UnversionedHeaderFragment`: u16 LE = skip[6:0], has_zeros[7], is_last[8],
value_num[15:9]); the float-channel layout below validates byte-exact on all
11 channels, so the header machinery is confirmed. The event section's header
is 2 fragments — (skip=2, values=1), (skip=14, values=1, last) — i.e. exactly
2 serialized properties (schema indices 2 and 17) in 12 payload bytes:

`02 02 02 03 0f 00 00 00 10 00 00 00` (+ 16-byte section GUID + 4 zero bytes)

What the 12 bytes are: the leading `02 02 02 03` is the same nested-fragment
header that opens the footer of the transform/color sections, and the two
i32s (15, 16) match that footer's object-reference pattern exactly — the
transform footer holds (11, 12) → 1-based export refs to exports 10/11
(`EaseInFunction`, `EaseOutFunction`), the color footer (13, 14) → exports
12/13 (same pair), so (15, 16) → exports 14/15 (`EaseInFunction`,
`EaseOutFunction`): the section's EaseIn/EaseOut function objects. The event
track corroborates 1-based refs: its value 21 reads as export 20, the event
section itself. **No frame number is present anywhere in the 12 bytes** (no
60000, no plausible tick value), and the bound function name `SequenceEvent`
(name index 13) appears nowhere in the section export as an FName or string.
A 1-key `FMovieSceneEventChannel` (Times array + KeyValues array, one
`FMovieSceneEvent` = FName Function + `FMovieSceneEventParameters`) needs
≥44 bytes and cannot fit in 12 bytes, so the key time and the bound function
name are not recoverable from this export. A tree-wide scan confirms this is
the only `MovieSceneEventTriggerSection`/`MovieSceneEventTrack` in the whole
legacy tree (no second sample to compare against), and the Zen `.uasset` is
IoStore (`bad magic` for the legacy parser), so no independent parse exists
here. This is consistent with the cooked-build behavior documented on the
Epic forum (Feb 2026): `ChannelProxy` is not initialized for
`UMovieSceneEventTriggerSection` in cooked builds and the event data is
imported from the sequence at runtime via `ImportEntityImpl` — the key data
does not survive in this export in decodable form.

**Player consequence: none implementable.** The event is a second removal
path for the loop widget (fire → `RemoveFromParent`), alongside the
already-modeled removal when the cum window closes (`HandleCumEvent` end),
but its firing frame is unknown; timing a removal at a guessed frame (e.g.
60000) would be inventing behavior, so no player change and no test.
Scratch: `/tmp/scratch_floatchan.py`, `/tmp/scratch_sections.py`,
`/tmp/scratch_eventscan.py` (fragment decode + tree scan).

### Channel serialization (verified 2026-11-12, byte-exact on all 11 channels)

Section exports are UE5 **unversioned** property streams. Each section =
`[fragment header][channels][4 zero bytes between/after channels][footer]
[16-byte section GUID][4 zero bytes]`. The header is a run of u16 LE
fragments (`UnversionedHeaderFragment` per the `unreal_asset` crate: skip =
bits 0–6, has_zeros = bit 7, is_last = bit 8, value_num = bits 9–15).
Transform header: (skip=1, values=7), (skip=1, values=2), (skip=13, values=1,
last) — 10 values: 7 channels + 3 footer values. Color header: (skip=0,
values=4), (skip=1, values=2), (skip=13, values=1, last) — 7 values: 4
channels + 3 footer values.

`FMovieSceneFloatChannel` (per the `unreal_asset` crate, confirmed on every
channel here) = `[pre_infinity_extrap u8][post_infinity_extrap u8]
[times_struct_length i32 = 4][times_length i32][times: count×i32]
[values_struct_length i32 = 28][values_length i32][values: count×28 bytes]
[default_value f32][has_default_value i32][tick_resolution: i32 num, i32 den]`.
Both extrap bytes are 4 on every channel here; tick is 60000/1; default 0.0,
has_default 0. The 28-byte `FMovieSceneFloatValue` = f32 value +
`FMovieSceneTangentData` (arrive/leave tangent f32, arrive/leave tangent
weight f32, tangent-weight-mode u8, 5 padding bytes = 22) + interp-mode i8 +
tangent-mode i8 (4+22+1+1 = 28; padding size derived from the total).

Footer (22 bytes, both float sections) = `[nested fragment header
02 02 02 03][EaseIn object ref i32][EaseOut object ref i32][01 00 00 00 00 01
— 6 bytes, unidentified (i32 1 + two flag bytes)][EndFrame i32 = 60000]`.
The object refs are 1-based export indices (transform 11,12 → exports 10,11;
color 13,14 → exports 12,13 — each section's own EaseIn/EaseOut pair).
StartFrame 0 is zero-valued and skipped by the fragment header, so it never
appears. The PropWalker does NOT work on MovieScene exports (not an
FPropertyTag stream); the layout above is what validates (all channels land
exactly on the trailing GUID).

## CumInXSec / CumWithinXSec overlays — `Idle` + `SpawnAnim`

The two widgets are **structurally identical** (52 exports each, same sizes);
they differ only in the progress/text function names (see below). Each has two
animations, `Idle` and `SpawnAnim`, plus an audio track.

### `Idle` — 826-byte transform section, 60233 ticks ≈ 1.004 s, loops infinitely

| Channel | Keys (tick, value) |
|---|---|
| TranslationX/Y, Rotation, ShearX/Y | (0, 0.0), (60233, 0.0) — constant |
| ScaleX | (0, 1.0), (30117, 1.0), (60233, 1.0) — constant 1.0 (three keys, all 1.0) |
| **ScaleY** | (0, 1.0), (30117, 1.05), (60233, 1.0) |

A gentle **vertical-only 5% pulse** (ScaleY 1.0 → 1.05 → 1.0, midpoint
~0.502 s). ScaleX never changes. Duration is 60233 ticks, not a round 60000 —
recorded verbatim; the extra 233 ticks (~4 ms) are where the author placed the
last key.

### `SpawnAnim` — 666-byte transform section, 30000 ticks = 0.5 s, plays once

| Channel | Keys (tick, value) |
|---|---|
| TranslationX/Y, Rotation, ShearX/Y | (30000, 0.0) — single key at the end, constant |
| **ScaleX** | (0, 1.0), (15000, 1.05), (30000, 1.0) |
| **ScaleY** | (0, 1.0), (15000, 1.05), (30000, 1.0) |

A uniform **5% scale pulse** (midpoint 0.25 s), plus a
`MovieSceneFloatSection_0` (150 bytes, 1 channel): **Value (0, 0.0) →
(30000, 1.0)** — a fade-in from transparent to opaque over the same 0.5 s.

### Audio

`MovieSceneAudioSection_2` references SoundWave **`Enter_Simulate`**
(`/Engine/VREditor/Sounds/UI/Enter_Simulate`) — an engine UI sound, not a
game-specific cue.

### Playback — ubergraph (script at export offset 330, icode 351, storage 475, 15 stmts)

On Construct:
- `PlayAnimation(Idle, 0.0, NumLoopsToPlay=0 [infinite], Forward, 1.0×)`
- `PlayAnimation(SpawnAnim, 0.0, NumLoopsToPlay=1 [once], Forward, 1.0×)`

### Bindings (progress bar + text)

- `GetPercent` calls `GetCumWindowWarningProgress` (CumInXSec) /
  `GetCumWithinProgress` (CumWithinXSec).
- `GetText` calls `GetCumInText` (CumInXSec) / `GetCumWithinText`
  (CumWithinXSec). Both are native `UMusicModeManager` methods
  (imports from class `MusicModeManager` in the cooked packages), not
  Blueprint functions — the exact format strings are recovered from
  the v0.05.1 exe in
  `docs/parity/evidence/ticket51-queue-consumer-20261111.md`
  (`CUM IN: %d SEC` / `CUM WITHIN: %d SEC`, `%d` =
  `floor(remaining + 0.75)`) and implemented in `overlays.js`
  (`cumInText` / `cumWithinText`).

## What this settles for #44

- The cum-button loop overlay is a **1 s breathing pulse**: scale 1.0→1.1→1.0,
  opacity 1.0→0.5→1.0, looping infinitely while the overlay is up. It is NOT
  a 60 s or multi-second animation; the "loop" is the 1 s pulse repeating.
- The cum-countdown overlays spawn with a **0.5 s entrance** (5% scale pulse +
  fade-in, plus the `Enter_Simulate` UI sound) and then idle with a **~1 s
  vertical 5% pulse**, looping.
- The two countdown overlays are the same widget with different progress/text
  bindings; the player can implement one overlay component parameterized by
  the progress/text source.
- `CreateAllowedToCumBackgroundLoop` (GM ubergraph entry 73997 → Jump
  @72658): creates the loop widget + `AddToViewport(0)`, stores
  `AllowedToCumOverlayLoopWidgetRef`, sets `DoesCumOverlayLoopExist? =
  true`. It is bound (GM ubergraph `BindDelegate` @66159) to the
  SpawnOverlay AnimationFinished delegate of the PermissionToCum overlay
  created in `Spawn100Percent` — the loop widget appears when the
  PermissionToCum spawn animation finishes.

## What this does NOT settle

- The **60 s cum-window hard-code** (`static/fanservice/objectives.js:52`) is
  not addressed by these animations; nothing here gives a window duration.
- The `SequenceEvent` wired to `SpawnOverlay`'s event track: purpose
  SETTLED (RemoveFromParent on fire); frame NOT recoverable from the cooked
  packages (event-section payload decoded 2026-11-12: 12 bytes hold only the
  EaseIn/EaseOut refs, no key time, no function name — see above). No player
  behavior follows from it; do not time a removal at a guessed frame.
- The `Idle` duration (60233 ticks) is recorded verbatim; do not round it to
  60000 without evidence.

## Implementation plan (player)

- "Allowed to cum" overlay: CSS/JS animation, 1.0 s loop, `scale(1.0 → 1.1 →
  1.0)` with the peak at ~0.50 s and `opacity(1.0 → 0.5 → 1.0)` with the trough
  at the same point; loop indefinitely while the overlay is shown. (The
  player's current overlay, if any, should be checked against this pulse
  rather than a static highlight.)
- Cum-countdown overlay: on spawn, a 0.5 s entrance (scale 1.0→1.05→1.0,
  opacity 0→1); then a ~1.0 s loop of ScaleY-only 1.0→1.05→1.0. Progress bar
  bound to the cum-window progress function, text bound to the cum-in/within
  text. A short UI blip on spawn (the original uses the engine
  `Enter_Simulate` sound; the player has no sound asset for it — visual-only
  unless a sound is added).
