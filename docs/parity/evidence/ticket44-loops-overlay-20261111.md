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
fires, the widget removes itself from its parent. Frame still unpinned:
the event section's 16-byte payload (`02020e03020202030f00000010000000`
+ GUID) is not a property-tag stream (PropWalker fails on it) and the
FMovieSceneEventChannel key-time layout for this payload is unestablished.

### Channel serialization (for future miners)

`FMovieSceneFloatChannel` = `[Times: i32 count + count×i32 frame numbers]`
`[Values: i32 per-value-size (28) + i32 count + count×28-byte values (float in
the first 4 bytes)]` `[trailing: Default f32 + hasDefault u8 + TickRate
(60000, 1) + padding]`. The 28-byte value is the 22-byte
`FMovieSceneFloatValue` (value + tangent mode/weight + arrive/leave tangents
and weights) plus 6 trailing bytes. The PropWalker does NOT work on MovieScene
exports (not an FPropertyTag stream); the byte-pattern parser above is what
validates (all channels land exactly on the trailing GUID).

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
  (CumWithinXSec).

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
  SETTLED (RemoveFromParent on fire); frame unpinned (event-channel
  payload layout unestablished).
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
