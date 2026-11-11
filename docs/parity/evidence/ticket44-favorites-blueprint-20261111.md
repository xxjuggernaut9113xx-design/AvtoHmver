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

The function also references the five SaveGame arrays
(`Saved_Cum/Fast/Medium/Slow/Succubus_FavoriteCards`, owner BP_CHSaveGame_C
import −6) in Let assignments, but the toggle itself operates on the master +
draw-pool arrays, not the saved arrays.

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
"Timer Cooldown Over". The player's favorites.js does not yet model the
frenzy trigger/cooldown (120 s) or the frenzy event itself.

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
- Frenzy trigger bodies (`FavoriteFrenzyEvent`, cooldown progress/start) live
  in the GM ubergraph (now parseable end-to-end with the fixed parser); the
  trigger gate and 120 s cooldown are decoded above, but the frenzy event
  itself and its overlay are not yet modeled in the player.
- The loops/overlay half of #44 is in `ticket44-loops-overlay-20261111.md`.
