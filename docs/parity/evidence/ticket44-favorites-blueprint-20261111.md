# #44 favorites — Blueprint side (cooked packages, v0.05.1)

Source: hash-verified v0.05.1 build, unpacked with retoc (Oodle), converted to
legacy `.uasset`/`.uexp` with `retoc to-legacy`, parsed with the session's
Python reader (`work/uasset.py`, `work/kismet2.py`, `work/favcard*.py` in
`~/workspace/rejoice-evidence/cockhero-itch/work/`). Cross-checks the native
disassembly note `ticket44-favorites-native-20261111.md`; where the two
disagree, the scope is the cause (see "CumFavoriteCards" below).

Packages: `/Game/NewSetup/BP_DrawManager`, `/Game/NewSetup/BP_GlobalManager`,
`/Game/NewSetup/BP_CardManager`, `/Game/NewSetup/UI_Manager`.

## `AddFavoriteCardToArray` — body decoded (BP_DrawManager)

Export 11,765 bytes. Script at export offset 1595, icode 7114, storage 10158,
parsed exactly (`max_icode+1 == 7114`), 90 statements, 12 trailing bytes.

Signature: (`Favorited Card` card struct, `Card Type` byte). It is a
**per-category TOGGLE**, switching on ECardCategory
(Slow=0, Medium=1, Fast=2, Succubus=3, Event=4, Edging=5, Cum=6, AssFrenzy=7,
BoobFrenzy=8, FavoriteFrenzy=9 — from `native-reflection-enums.json`).

For each of Slow / Medium / Fast / Succubus / Cum it checks
`Array_Contains(GlobalManager.CardManager.Master_Favorite_<Cat>, Favorited Card)`:
- if present, `Array_RemoveItem` from **both** `Master_Favorite_<Cat>`
  (CardManager master registry) **and** `<Cat>FavoriteCards` (DrawManager
  draw pool);
- if absent, `Array_Add` to **both**.

Call iCode offsets: Slow Contains 442 / Remove 560 (master) + 664 (draw pool) /
Add 1176 (master) + 1288 (pool); Medium Contains 1786 / Remove 1904 (pool) +
2008 (master) / Add 2522 (pool) + 2634 (master); Fast Contains 3110 / Remove
3228 (master) + 3332 (pool, item is a `Temp_struct_Variable` copy) / Add 3844
(master) + 3956 (pool); Succubus Contains 4454 / Remove 4572 (master) + 4676
(pool) / Add 5192 (master) + 5304 (pool); Cum Contains 5806 / Remove 5924
(master) + 6028 (pool) / Add 6539 (master) + 6651 (pool).

Switch dispatch is `NotEqual_ByteByte(Card Type, N)` + JumpIfNot: N=0→Slow
block (410), N=1→Medium (1754), N=2→Fast (3078), N=3→Succubus (4422),
N=6→Cum (5774). **N=4 (Event), N=5 (Edging), N=7 (AssFrenzy), N=8
(BoobFrenzy) all dispatch to the Fast block (3078)** — compiled behavior as
read; likely those four switch cases share the Fast pin in the Blueprint (or
are unhandled and fall through to Fast).

The function also writes the five SaveGame arrays
(`Saved_Cum/Fast/Medium/Slow/Succubus_FavoriteCards`, owner BP_CHSaveGame_C
import −6) in Let assignments on BOTH the add and the remove path — and
calls `GameInstance.SaveAllData()` immediately after each write — so the
toggle persists the moment it happens. See
`ticket44-favorites-persistence-20261112.md` for the full settled
persistence story (write-through save, validated restore at startup,
and the Medium-add / Succubus wiring quirks, which are NOT copied into
the player).

## `CumFavoriteCards` EXISTS on the Blueprint side

This corrects the scope of the disassembly note's "no CumFavoriteCards
equivalent" finding, which was **native-only** (PDB-wide zero hits). On the
Blueprint side it exists in all three places:
- `DrawManager.CumFavoriteCards` (draw pool),
- `CardManager.Master_Favorite_Cum` (master registry),
- `SaveGame.Saved_Cum_FavoriteCards`.

The five per-category array triples exist for Slow / Medium / Fast / Succubus /
Cum in all three places (BP_CardManager's name map contains all 15 names).
BP_CardManager exports no favorites function itself
(`AddBlackListedMediaToArray`, `CheckAndReplaceEmptyDecks`,
`CreateMasterDecks`, `Validate&PopulateSavedMedia`, `SetChildDecks`,
`UserConstructionScript`, `ExecuteUbergraph_BP_CardManager`,
`ReceiveBeginPlay`); it imports BP_DrawManager_C as a class but not
`AddFavoriteCardToArray`.

## Caller of `AddFavoriteCardToArray`: NONE FOUND in Blueprint

Grep over legacy AND unpacked Zen `.uasset` files finds the name only in
BP_DrawManager.uasset itself. The DrawManager ubergraph (script at export
offset 710, icode 829, storage 1109, 23 stmts — only StopPlayback,
Array_Shuffle, Array_Random, SetBeatInterval, PlayMediaToSlot calls) does NOT
call it. None of the other BP_DrawManager functions call it either (all parsed
functions checked: AddWeightsFromSpecialEvents, ApplyBrainMelterIntervals,
ApplyRawDogModifier_IfValid, CheckAndApplyAutoBrainMelter,
ChooseWeightedEventFromArray, Convert BP Card Type to C++ Enum, Determine Time
and Stroke Multiplier Basedon Combo, DetermineCardV2,
DetermineShouldMediaSwap, GetAndSetRandomCard, GetAndSetRandomVideoLoop,
ReceiveTick, RemoveAllActiveBeatWidgets, RollChance, RollCumChance,
ToggleStrokeCounterVisibilityDuringEdging, TriggerSelectedEvent, Update Recent
Draws Count — all clean; raw byte-pattern check also clean for the 4 functions
whose scripts did not parse: GetRandomCard, SpawnCustomCardEvent,
SpawnCustomClothesBreakerCardEvent, SpawnCustomVideoCardEvent).

So it is either called from **native C++ by name** (FindFunction/ProcessEvent
— leaves no Blueprint import), called dynamically, or dead/unreachable code in
this build. This is a finding, not a blocker for the note. The player's
favorites implementation (favorites.js, Favorite button, injection roll) does
not depend on finding a Blueprint caller.

## `RollFavoritesChance` — pinned exactly (BP_GlobalManager)

Export 3,595 bytes. Script at export offset 601, icode 2318, storage 2982,
72 stmts. Switch on input `Card Type` vs ByteConsts 0–8; per category block:
`Array_IsEmpty(<Cat>FavoriteCards)` (5 calls, iCode 453/847/1222/1597/1972) →
if empty, `RollSuccessLocal = False`; else `RandomIntegerInRange(1, 100)` then
`LessEqual_IntInt(roll, FavoritesLikelyhoodPercent)` (name 643 confirmed) →
success sets `RollSuccessLocal = True` and calls `CreateNotificationBox`
(LocalVirtualFunction, name 471) via the UIManager. Returns `RollSuccess?` out
param.

So the injection roll is a **1–100 roll, success iff roll ≤
FavoritesLikelyhoodPercent**. This refines the implementation agent's "0–99
roll" (a 1–100 roll with `<=` is equivalent in probability to 0–99 with `<`,
but the exact form is now pinned). The threshold default is **PINNED to 10**
(2026-11-11, Task 3): `FavoritesLikelyhoodPercent` is GM class property
#243 (IntProperty, 4 B) and its CDO default is 10 (reJOIce
`blueprint-class-defaults.json`, `BP_GlobalManager_C` defaults, verified
`byte_identical_roundtrip: True`, `failures: []`). The player's favorites.js
default threshold 10 is therefore correct as a Blueprint fact; only the
native controller+0x30 provenance (own CDO vs Blueprint-set) remains
unestablished — do not treat 10 as a native fact.

## Frenzy trigger gate — `FavoriteFrenzyEligibilityCheck`

Export 596 bytes. Script at export offset 291, icode 193, storage 293,
11 stmts (parsed end-to-end with the fixed kismet2 parser, 2026-11-11).
Exact logic:
```
IsEligible = true
NOT_OnCooldown = NOT(IsFavoriteFrenzyOnCooldown?)          // Not_PreBool
HasEnough = MediaPlaybackManager.HasEnoughFavoriteFrenzyCards(3)
Eligible = HasEnough AND NOT_OnCooldown                     // BooleanAND
if (Eligible) IsEligible = true; else IsEligible = false;
return Eligible? = IsEligible
```
The frenzy trigger gate is **≥3 favorite cards AND not on cooldown**
(a BooleanAND of the two). The cooldown duration is **120 s**:
`Master_FavoriteFrenzyCooldownSeconds = 120.0` (GM CDO, property #302,
DoubleProperty; `Current_FavoriteFrenzyCooldownSeconds` #303,
`IsFavoriteFrenzyOnCooldown?` #301, `FavoriteFrenzyTimerHandle` #304).
The GM ubergraph carries the matching debug strings "Favorite Frenzy On
Cooldown" and "Favorite Frenzy Off Cooldown, Eligible for Draw" plus
"Timer Cooldown Over". The player's favorites.js models the gate and the
cooldown (2026-11-11, Task 1): `isFavoriteFrenzyEligible(now)` =
`hasEnoughFavoriteFrenzyCards(3) AND NOT isFavoriteFrenzyOnCooldown(now)`,
`startFavoriteFrenzyCooldown(now)` sets the end to now + 120,
`triggerFavoriteFrenzy(now)` returns the decoded spawn spec and starts
the cooldown. The cooldown counter is modeled as an absolute session-
seconds end time; the 1 s tick is an implementation detail with no
observable difference.

## `FavoriteFrenzyEvent` / `StartFavoriteFrenzyCooldown` / `ProgressFavoriteFrenzyCooldown` — decoded (GM ubergraph, 2026-11-11)

Parsed with the fixed kismet2 parser from the GM ubergraph
(BP_GlobalManager legacy `.uasset`).

`FavoriteFrenzyEvent` (stub → entry 81592):
1. `StartFavoriteFrenzyCooldown`.
2. Clear IdleTimerHandle.
3. `GetDataTableRowFromName(HeatCategoryDataTable, 'SlowHeat')` — gate;
   the row exists (rows are HighHeat/MediumHeat/SlowHeat), so the event
   proceeds. The OutRow is not visibly consumed by the spawn below.
4. `SpawnCustomCardEvent(SlowCards, 20, 50, 0.18, 0.25, byte 9, Stroke
   Time Speed Multiplier, Stroke Count Multiplier, SlateBrush,
   StrokeInterval)` — the gate counts the derived FavoriteFrenzy deck,
   but the event spawns from **SlowCards** with card type 9.
5. `Array_Random(FrenzyBeatPatterns)` → `CheckIntervalMultipliers` →
   `StartPatternWithMediaSync(pattern, BeatSpawnInterval,
   CurrentStrokeCount, MediaPlaybackManager, 1.0, 0.0, Beat Travel Time)`.
6. `PlayerEdgedLastDraw? = false`; `DrawManager.IsSpecialEvent? =
   false`; `CurrentCardTypeEnum = 2` (Fast — as read, although the
   spawned card is type 9).
7. `ApplyVolumeScalar(SFXVolume)` → `PlaySound2D(volume, 1.0, 0.0)`.
8. `PlayAnimation(FastPaceAnim, 0.0, 1 loop, 0, 1.0)`.
9. `PlaySpecialEventDialogue(0)`.
10. `Change Beat Background(3)`.
11. `PlayMusic(2)`.
12. Create `FavoriteFrenzySpawnOverlay_Widget` + `AddToViewport(0)`.

`StartFavoriteFrenzyCooldown` (stub → entry 79218, body at shared block
73041): debug print 'Favorite Frenzy On Cooldown' (2.0 s);
`K2_ClearAndInvalidateTimerHandle(FavoriteFrenzyTimerHandle)`;
`IsFavoriteFrenzyOnCooldown? = true`;
`Current_FavoriteFrenzyCooldownSeconds = 0.0`; then
`K2_SetTimerDelegate(delegate, 1.0, True, 0.0, 0.0)` → stored in
`FavoriteFrenzyTimerHandle` (shared block 57837) — a 1.0 s looping
timer calling `ProgressFavoriteFrenzyCooldown`.

`ProgressFavoriteFrenzyCooldown` (stub → entry 78910):
`Current_FavoriteFrenzyCooldownSeconds += 1.0` per tick; when `Current
>= Master_FavoriteFrenzyCooldownSeconds` (120.0): clear the timer
handle, `IsFavoriteFrenzyOnCooldown? = false`, debug print 'Favorite
Frenzy Off Cooldown, Eligible for Draw'. Otherwise return and keep
ticking.

**Call site: SETTLED (2026-11-11).** The frenzy fires as an ordinary
weighted special event per card draw. `TriggerSelectedEvent`
(BP_DrawManager, 65 stmts, icode 2279) switches on
`FoundEvent.EventName`: code 12 → `FavoriteFrenzyEvent` (stmt 62 @2142)
+ debug print "Favorite Frenzy Event Triggered" (codes 3, 9, 10 have no
case → return). The gate runs at filter time:
`CheckEventConditions&ReturnArray` (BP_GlobalManager, 88 stmts, icode
2527) loops `AllSpecialEventsArray`; Favorite Frenzy (EventName 12) →
`FavoriteFrenzyEligibilityCheck` (stmt 82 @2363) +
`PopExecutionFlowIfNot`. Chain: `DetermineCardV2` stmts 63–67 →
CheckEventConditions&ReturnArray → AdjustHeatLevelWeights →
AdjustComboLevelWeights → `ChooseWeightedEventFromArray` →
`TriggerSelectedEvent` → `FavoriteFrenzyEvent`. The player's
`triggerFavoriteFrenzy` starts the 120 s cooldown and returns the
decoded spawn spec; play.js wires it through `automaticMediaPool`
(event code 12 admitted when `favorites.isFavoriteFrenzyEligible`) and
draws the type-9 card through `Cards.start({frenzy:true})`. v0.05.1
`SpecialEventDataTable` row 12 ('NewRow') matches the player's
`special-events.json` exactly (baseWeight 0, weightMultiplier 0, heat
5/5/5, combo F5/D5/C5/B5/A25/S35), so no data change was needed.

## Frenzy presentation — decoded and wired (2026-11-12)

`FavoriteFrenzyEvent` was re-parsed from the GM ubergraph (entry 81592,
icode 99921, 2569 stmts; script `/tmp/frenzy_decode.py`) and each
presentation step was decoded from the cooked packages (retoc-converted
to `/tmp/frenzy-legacy/CockHero/Content/Widgets/SpecialEventWidgets/`,
scripts `/tmp/frenzy_overlay_decode.py`, `/tmp/fastpace_decode.py`,
`/tmp/frenzy_texture.py`). The event's 17 steps, in order:

1. `StartFavoriteFrenzyCooldown`.
2. Clear `IdleTimerHandle` (no player counterpart — the player has no
   idle timer).
3. `GetDataTableRowFromName(HeatCategoryDataTable, 'SlowHeat')` — gate;
   the row exists, so the event proceeds. The OutRow is not consumed.
4. `SpawnCustomCardEvent(SlowCards, 20, 50, 0.18, 0.25, byte 9, ...)` —
   **the spawn starts NO beat pattern** (96-stmt decode of
   `SpawnCustomCardEvent`): it rolls the stroke count and interval,
   toggles stroke-counter visibility, applies brain-melter intervals and
   the media swap, and returns an empty SlateBrush + StrokeInterval 0.
5. `Array_Random(FrenzyBeatPatterns)` → 6. `CheckIntervalMultipliers`
   (if the current interval is ≤ 0.2, any pattern value ≥ 2.0 becomes
   2.5 — the same constants as the player's existing rule in
   `cards.js`) → 7. `StartPatternWithMediaSync(pattern,
   BeatSpawnInterval, CurrentStrokeCount, MediaPlaybackManager, 1.0,
   0.0, Beat Travel Time)`. **The card's beat pattern comes from
   `FrenzyBeatPatterns`, not the slow bank.** Wired: `cards.js` frenzy
   branch now uses bank `'frenzy'` (`patterns.frenzy`, 3 rows:
   `[0.5,0.5,0.5,0.5,1.0]`, `[0.5]`, `[0.5,0.5,1.0]` — verified
   GM-CDO float32-exact in `card-rules.json`); the media deck stays
   slow. Pinned by `tests/fanservice_cards.test.js` (frenzy pattern
   from the frenzy bank, red-first).
8. `PlayerEdgedLastDraw? = false`; 9. `DrawManager.IsSpecialEvent? =
   false`; 10. `CurrentCardTypeEnum = 2` (Fast). The player models none
   of these flags — `state.card` is 9, and `taunts.js` treats card 9 as
   a normal card (its succubus branch keys on card 3 only), matching the
   original's Fast branch for a taunt during a frenzy card.
11. `ApplyVolumeScalar(1.0, SFXVolume)` → `PlaySound2D(Enter_Play, ...)`.
    Not wireable — no player sound asset (same precedent as
    `Enter_Simulate`).
12. `PlayAnimation(FastPaceAnim, 0.0, 1 loop, Forward, 1.0, false)` —
    wired (see below).
13. `PlaySpecialEventDialogue(0)` — the 'succubus' bucket
    (`DialogueSpecialEventsEnum` 0; the bucket key is the lowercased
    enumerator name). Not wireable: the lines live in the persona
    dialogue data tables built by `InitializeDialogueMap`, and the
    player has no Classic-mode dialogue-line system — same precedent as
    the taunt/punishment voicelines.
14. `Change Beat Background(3)` — wired (see below).
15. `PlayMusic(2)` — `AMP2_90_A_2_3` at 0.15×BackgroundMusicVolume,
    gated on `IsDynamicMusicEnabled?`. Not wireable: no dynamic music in
    Classic/Tower and no such asset — same precedent as punishment
    `PlayMusic(3)`.
16. Create `FavoriteFrenzySpawnOverlay_Widget` +
    `AddToViewport(0)` — wired (see below).

**Background — SETTLED, wired.** `Change Beat Background` (GM, 47
stmts) switches on the input byte: 3 → `SetBackground(1)`.
`BackgroundTypesEnum` 3 is 'Normal Beat Background', and the
`HandleBackGroundChange` string→byte map (`normalbeatbackground`→3)
cross-checks to the same SetBackground index. So frenzy input 3 =
player `normalbeatbackground`. Wired in `play.js` `draw()`: the frenzy
also resets a stale `tauntbackground` left by a prior taunt or
punishment, since the player otherwise never resets the background on
Classic/Tower draws. The `bColoredBackgroundEnabled?` black-tint branch
is unmodeled (the player has no such setting). Pinned by the favorites
smoke test (taunt first sets 'taunt', the frenzy resets it to 'normal').

**Overlay widget — SETTLED, wired.** `FavoriteFrenzySpawnOverlay_Widget`
(43 exports) has two image widgets: `Background` (Texture2D
`FavoriteFrenzyOverlayBackground`, 3840×2160 DXT5 — thin dark speed
lines radiating from the center, 3.6% opaque) and `Text` (Texture2D
`FavoriteFrenzyOverlayText`, 3840×2160 DXT5 — baked black letters
reading **"FAVORITE FRENZY"** in two arched bubbly lines with sparkles,
decoded from the BC3 pixel data at header offset 137; the RGB is pure
black, so the text displays black over the video). `SpawnOverlay`
(60000 ticks/s, 105000 ticks = 1.75 s, plays once): Background —
uniform scale 1.0 → 1.2 @0.15 s → 1.0 @0.5 s, opacity 0.25 → 1.0 @0.15 s,
then a 0.8/1.0 oscillation every 0.15 s, → 0.0 @1.75 s (the 10-key
alpha channel was recovered by widening the channel search past its
n≤8 cap); Text — uniform scale 0.5 → 1.0 @0.15 s → 1.2 @0.3 s → 1.0
@0.5 s → 0.9 @1.0 s → 1.1 @1.55 s, opacity 0.25 → 1.0 @0.15 s → 0.9
@0.5 s → 1.0 @0.85 s → 0.9 @1.2 s → 1.0 @1.55 s → 0.0 @1.75 s, RGB
1.0 → 0.9 @0.5 s → 1.0 (a tint dim with no visible effect on black
letters — recorded, not modeled). The event-trigger section fires
`SequenceEvent` at 105000 ticks and the widget's handler calls
`RemoveFromParent`, so the banner lives exactly 1.75 s. Construct also
plays a random evil laugh (`Array_Random(EvilLaughArraySFX)` →
`PlaySound2D`, 13 `evillaugh_sfx` files) plus two MovieScene audio
sections whose SoundWaves were not resolved from the section bytes
(the widget references `Epic_Stock_Media_-_Vibrant_Game_-_Sci_Fi_Cannon_Blast_Modulated`
and `Unrealsfx_-_Morph_-_Bubbly_Swoosh`); audio is not wireable. Wired:
`overlays.js` `frenzyBackground` / `frenzyText` specs +
`frenzyOverlayState` (visible for exactly 1.75 s from the frenzy draw),
`play.html` `#frenzy-overlay` (background layer + `FAVORITE<br>FRENZY`
text), `play.css` keyframes carrying the decoded curves, `play.js`
`renderOverlays()` toggling visibility on the session clock. The
speed-lines layer is a CSS `repeating-conic-gradient` approximation of
the baked texture and the bubbly arched font is not reproduced — both
documented in `play.css`. Pinned by `tests/fanservice_overlays.test.js`
(specs, samples, 1.75 s visibility boundary) and the favorites smoke
test (banner shows with the text at the draw, hides after 2 s).

**FastPaceAnim — SETTLED, wired.** The animation (MovieScene export in
`UI_Manager`) binds `TextBlock_2`, whose default text is **"Fast!"**
(114-byte export; the GUID string + `Fast!` literal). 45281 ticks ≈
0.7547 s, plays once: uniform scale 0.1 → 1.0 @0.2516 s → 0.75 @0.5031 s
→ 1.0 @0.7547 s, rotation 0° → 5° @0.25 s → 1° @0.2514 s → -2° @0.5 s →
-1° @0.5029 s (the near-duplicate keys are sharp jumps, kept verbatim),
opacity 1.0 → 0.75 @0.2516 s → 1.0 @0.5031 s → 0.0 @0.7547 s, RGB
constant (1.0, 0.5, 0.8) — a pink tint. It is the generic special-event
pace flash: the same animation is played by the succubus event (two
branches), the punishment, the 'ass'/'boobs' events, the frenzy, and the
taunt (GM ubergraph stmts 731, 746, 1453, 1823, 1838, 2016, 2313).
Wired for the frenzy only: `overlays.js` `fastPace` spec (with the
rotation channel — `sample()` returns `rotation` only for specs that
define it, so the older specs keep their pinned shape) +
`fastPaceState`, `play.html` `#pace-flash` (`Fast!`), `play.css`
`frenzy-fast-pace` keyframes (the scale values at the rotation-only
keys are the exact linear interpolations of the scale curve at those
times), `play.js` `renderOverlays()`. The flash sits near the top of
the stage so it does not cover the banner — the original's TextBlock_2
canvas slot was not decoded, so the placement is an adaptation.
Pinned by `tests/fanservice_overlays.test.js` and the favorites smoke
test. **Follow-up:** the same flash belongs on taunt, punishment, and
the succubus/'ass'/'boobs' events; wiring those is a separate slice
(the punishment comment in `play.js` records this).

**Taunt pattern bank — open follow-up, NOT changed.** `Taunt()` uses
the same `FrenzyBeatPatterns` → `StartPatternWithMediaSync` flow (GM
ubergraph stmt 2313 area; `taunts.js` header already records "a random
FrenzyBeatPattern"), but the player models the taunt card with the fast
bank (`run.startCard('fast', {taunt:true})` → `cards.js` bank
`'fast'`), and taunt tests/smoke pin it. Changing it needs its own
red-first slice and smoke re-check; the frenzy fix does not touch it.

`CheckAndUpdateFavoriteUI` (699 bytes; script at 183, icode 408, storage 504,
11 stmts) references `FavoritesIcon`, `GameModeSelection`,
`IsPlayerToggledCheck?`.

## Empty in v0.05.1

`CheckAndRollFavoritesMediaArray` (143 bytes) and `PlayRandomFavoritedMedia`
(139 bytes) are **empty functions** — icode=3, storage=3, 1 statement (just
Return). Whatever they were for, they do nothing in this build.

`FavoriteFrenzyEvent` / `ProgressFavoriteFrenzyCooldown` /
`StartFavoriteFrenzyCooldown` are 52-byte stubs → GM ubergraph entries 81592 /
78910 / 79218 (bodies live in the 187,685-byte GM ubergraph, not yet parsed).

## `AddFavoriteMedia` — decoded (GM, toggle on the save array)

Export 2,349 bytes. Script at export offset 520, icode 1341, storage 1817,
24 stmts (parsed end-to-end with the fixed kismet2 parser, 2026-11-11).
It toggles `SelectedRandomCard` in
`GameInstance.CurrentSave.AllFavoritedCards_Array`:
```
if (AllFavoritedCards_Array.Contains(SelectedRandomCard)):
    AllFavoritedCards_Array.RemoveItem(SelectedRandomCard)
    UIManager.CreateNotificationBox("Removed Favorite", "Media has been removed from favorites", ...)
    GameInstance.SaveAllData()
    (debug-print the card name, 2.0 s)
    MediaPlaybackManager.ToggleFavorite(SelectedRandomCard)   // native
    CheckAndUpdateFavoriteUI(ToggleFavorite_ReturnValue, true)
    return
else:
    AllFavoritedCards_Array.Add(SelectedRandomCard)
    UIManager.CreateNotificationBox("Added Favorite", "Media has been added to favorties", ...)  // sic: "favorties" in the original
    return
```
Note the asymmetry: the native `ToggleFavorite` (registry sync) and the
UI refresh run only on the remove path; the add path only appends to the
save array and notifies. No Blueprint caller of `AddFavoriteMedia` was
found in this pass.

## `InitializeFavoriteLikelihood` — decoded (UI_Manager)

Export 2,079 bytes. Script at export offset 565, icode 942, storage 1502,
22 stmts (parsed end-to-end with the fixed kismet2 parser, 2026-11-11).
It READS `GlobalManagerRef.FavoritesLikelyhoodPercent` (a GM property, not
a UI_Manager one) and `FavoritePercentage`, formats them into a
`FormatArgumentData` struct (`ArgumentName`/`ArgumentValue`/`ArgumentValueInt`
etc.), and sets `FavoritesFrequencyText` / `FavoritesFrequencySlider`. It
does not set the default — the default (10) lives in the GM CDO (see the
`RollFavoritesChance` section above).

## Parser fix (2026-11-11, Task 3) — the 0x91 token is resolved

0x91 was NOT a new token. It was a parser misalignment: `EX_BindDelegate`
(0x61) is `FName FunctionName + Delegate expr + ObjectTerm expr`
(UAssetAPI `EX_BindDelegate.cs`), but the session parser read it as two
bare expressions, so the FName's first byte (a name index, e.g. 0x91) was
mistaken for a token. Fixing that plus four more UAssetAPI-verified layouts
(`EX_ClearMulticastDelegate` 0x5d = one expr; `EX_CallMulticastDelegate`
0x63 = FPackageIndex + Delegate expr + params; `EX_TextConst` 0x29 =
FScriptText with a TextLiteralType byte and nested string expressions, not
raw FStrings; `EX_InterfaceContext` 0x51 = one expr only, not the Context
layout) and the large-world vector sizes (`EX_VectorConst`/`EX_RotationConst`
0x22/0x23 = 3 doubles, 24 B; `EX_TransformConst` 0x2b = 80 B) in
`work/kismet2.py` makes BOTH ubergraphs parse end-to-end: UI_Manager
(704 stmts, 0 errors, icode 25009/25010) and GM (2569 stmts, 0 errors,
icode 99920/99921). The 0x91 gap in `ticket48-taunt-cumadd-20261111.md` is
therefore closed; the parser fix itself lives in the evidence work dir
(`~/workspace/rejoice-evidence/cockhero-itch/work/kismet2.py`), not in
this repo.

## GM name-map extras relevant to #44

`AllFavoritedCards_Array`, `Favorited Media Array`, `FavoriteDebugString`,
`AssFrenzyEligibilityCheck`, `BoobFrenzyEligibilityCheck`,
`FavoriteFrenzySpawnOverlay_Widget`, `Current_FavoriteFrenzyCooldownSeconds`,
`Master_FavoriteFrenzyCooldownSeconds`, `FavoriteFrenzyTimerHandle`,
`FrenzyBeatPatterns`, `Is Succu Frenzy Active`, `PlayFavoriteMedia`,
`ToggleFavorite` (native import), `HasEnoughFavoriteFrenzyCards`,
`bIsFavorite`.

## What this settles for #44 (favorites)

- The toggle semantics: per-category, master registry + draw pool together,
  add-or-remove. Event/Edging/AssFrenzy/BoobFrenzy fall through to the Fast
  block.
- The injection roll: 1–100, success iff ≤ FavoritesLikelyhoodPercent; empty
  favorite pool → no roll, failure.
- The frenzy gate: ≥3 favorite cards and not on cooldown.
- CumFavoriteCards is real on the Blueprint side (master + pool + savegame);
  the native "no equivalent" finding stands only for native code.
- `CheckAndRollFavoritesMediaArray` / `PlayRandomFavoritedMedia` are dead
  (empty) in v0.05.1 — do not implement them as live behavior.

## What is still open for #44 (favorites)

- No Blueprint caller of `AddFavoriteCardToArray` — the UI path that toggles a
  favorite (the Favorite button's handler) is not traced to this function.
  The player's Favorite button is wired to its own favorites.js toggle; that
  matches the toggle semantics above, but the original's exact call path is
  unconfirmed.
- No Blueprint caller of `AddFavoriteMedia` found in this pass.
- **Persistence across sessions is SETTLED** (2026-11-12): the original
  DOES persist favorites — see
  `ticket44-favorites-persistence-20261112.md`. Per-category
  `Saved_*_FavoriteCards` arrays + `AllFavoritedCards_Array` on
  `BP_CHSaveGame_C`, written by `SaveGameToSlot` on every toggle,
  restored at startup by `Validate&PopulateSavedMedia` via
  `UCHPackManager::ValidateMediaEntries` (keep iff filename length > 1
  and the file exists). The derived FavoriteFrenzy deck is not stored.
  The player implements this in `favorites.js` (`serializeFavorites` /
  `restoreFavorites` / `parseSavedFavorites`) with the profile record
  written through `mutateProfile` on every toggle and restored in
  `installRun`.
- Frenzy trigger bodies (`FavoriteFrenzyEvent`, cooldown progress/start)
  are decoded and the gate + 120 s cooldown are modeled in favorites.js
  (see above); the call site is SETTLED (TriggerSelectedEvent, event
  code 12; gate at CheckEventConditions&ReturnArray stmt 82 @2363) and
  play.js wires it through `automaticMediaPool` with the type-9 spawn
  through `Cards.start({frenzy:true})`. The frenzy event's presentation
  (FastPaceAnim, dialogue 0, background 3, music 2,
  FavoriteFrenzySpawnOverlay_Widget) is carried in the trigger's spawn
  spec but play.js does not act on it yet.
- The loops/overlay half of #44 is in `ticket44-loops-overlay-20261111.md`.
