# #44 RollFavoritesChance(6) / CumFavoriteCards trace (static, 2026-11-10)

Source: `reJOIce` commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`,
`Analysis/ReferenceBuilds/newer-20261017/`. Static reading of retained bytecode
only. No original game was run and the shared player was not changed. This does
not close #44: it records the full trace and the exact missing piece.

Companion note: `ticket44-pattern-bank-reachability-20261110.md` (CumEventOverride
flow, statement 1776 onward). This note answers the four questions that note
left open for this slice.

## 1. RollFavoritesChance(6): exact semantics

Function: `functions/BP_GlobalManager/RollFavoritesChance.json` (73 statements).
Switch on the `Card Type` byte against `CardTypeEnum` (`decoded-blueprint-enums.json`:
0 Slow, 1 Medium, 2 Fast, 3 Succubus, 4 Event, 5 Edging, 6 Cum, 7 AssFrenzy,
8 BoobFrenzy, 9 FavoriteFrenzy). Jump targets are absolute byte offsets; the five
branch bodies follow the switch header in statement order.

| Card Type | Jump target | Branch array (on `DrawManager`, `BP_DrawManager_C`) |
|---:|---:|---|
| 0 Slow | 421 | `SlowFavoriteCards` (stmts 20-30) |
| 1 Medium | 815 | `MediumFavoriteCards` (stmts 31-40) |
| 2 Fast | 1190 | `FastFavoriteCards` (stmts 41-50) |
| 3 Succubus | 1565 | `SuccubusFavoriteCards` (stmts 51-60) |
| 6 Cum | 1940 | `CumFavoriteCards` (stmts 61-70) |
| 4 Event, 5 Edging, 7 AssFrenzy, 8 BoobFrenzy | 1190 | `FastFavoriteCards` (same target as type 2) |

The type 4/5/7/8 -> Fast sharing is what the retained bytecode says (all four
`EX_JumpIfNot` targets are 1190, the Fast body start). Whether the source
Blueprint wired those pins to the Fast body or the compiler filled a default is
not distinguishable from the AST alone. Type 9 (FavoriteFrenzy) has no case and
falls through to the end (stmt 19 `EX_Jump` 2315, then `EX_Return`).

Every branch has the same shape (Cum branch, stmts 61-70):

- If the branch array `Array_IsEmpty` -> `RollSuccessLocal = false`, out param
  `RollSuccess? = false`, return (stmts 61-64).
- Else roll `RandomIntegerInRange(1, 100)`; success iff roll `<=
  FavoritesLikelyhoodPercent` (stmts 65-67).
- On success only: `RollSuccessLocal = true` and `UIManager.CreateNotificationBox`
  (`"Playing Favorite"`, `"Favorited Media is Displayed"`) (stmts 68-69). On a
  failed roll the true-assignment and notification are skipped and the function
  returns false.

`FavoritesLikelyhoodPercent` is an int field on `BP_GlobalManager_C`, class
default **10** (`blueprint-class-defaults.json`, `defaults[0]`, `values`). It is
user-adjustable: `UI_Manager` sets it to
`trunc(FavoriteFrequencySliderValue * 100.0)` (`functions/UI_Manager/
ExecuteUbergraph_UI_Manager.json`, slider section) and persists the same value
as `CurrentSave.FavoritesLikelihoodPercentage` (`BP_CHSaveGame_C`).

The only retained caller of `RollFavoritesChance` in the whole `functions/**`
tree is `CumEventOverride` (`functions/BP_GlobalManager/
ExecuteUbergraph_BP_GlobalManager.json` stmt 1779, argument byte `6`); the
other mention is the function's own definition file. So in retained code the
roll is only ever invoked for Cum.

## 2. What CumFavoriteCards contains and how entries get there

`CumFavoriteCards` is an `ArrayProperty` of `CHPackMediaEntry` structs
(64 bytes each; the struct carries a `File` member — see
`SpawnCustomCardEvent` stmt 33) on `BP_DrawManager_C`
(`blueprint-class-fields.json`). It is a runtime array of favorited cum media
entries, **not** a defaults bank: `BP_DrawManager_C` defaults
(`blueprint-class-defaults.json`, `defaults[4]`) contain no favorite arrays at
all, and neither do `BP_CardManager_C` (`defaults[1]`, only `UberGraphFrame`)
or the save-game defaults. It starts empty.

Two writers are visible in retained bytecode:

- **Load path** — `functions/BP_CardManager/ExecuteUbergraph_BP_CardManager.json`:
  stmts 75-78: if `DrawManager.CumFavoriteCards` is empty, assign it from
  `CardManager.Master_Favorite_Cum`. Stmts 110-112: `Master_Favorite_Cum =
  ValidateMediaEntries(CurrentSave.Saved_Cum_FavoriteCards)` (native
  validation of the saved entries), then `Saved_Cum_FavoriteCards` is written
  back from the master copy. The same load pattern holds for Slow/Medium/Fast/
  Succubus favorites. (`CumCards` is loaded the same way from
  `Master_CumCards`, stmts 83-88.)
- **Toggle path** — `functions/BP_DrawManager/AddFavoriteCardToArray.json`
  (91 statements; Cum body stmts 76-88, switch target 5774 for type 6; types
  4/5/7/8 again share the Fast body, target 3078). It takes `Card Type` and a
  `Favorited Card` (`CHPackMediaEntry`) and toggles it: if
  `Master_Favorite_Cum` already contains the card, remove it from both
  `Master_Favorite_Cum` and `DrawManager.CumFavoriteCards` and notify
  `"Media Unfavorited" / "Cum Media removed from your favorites."`; otherwise
  add it to both and notify `"Media Favorited" / "Cum Media added to your
  favorites."`. Either way it writes `Saved_Cum_FavoriteCards` back to
  `GameInstance.CurrentSave`. The Slow/Medium/Fast/Succubus bodies are the
  same shape against their own `Master_Favorite_*` / `*FavoriteCards` /
  `Saved_*_FavoriteCards` triples.

**No retained caller of `AddFavoriteCardToArray` exists.** A search of every
`functions/**` JSON (all Blueprint classes and all retained widget BPs) finds
the name only in its own definition file; `blueprint-function-delta.json`
lists the function with no call edges. So the user action that puts a cum
media entry into `CumFavoriteCards` is not traceable in the retained ASTs.

The retained UI favorite path is a *different* mechanism and does not touch
the per-type arrays: `UI_Manager` calls `BP_GlobalManager.AddFavoriteMedia`
(`functions/UI_Manager/ExecuteUbergraph_UI_Manager.json`, line ~7402), which
toggles the currently selected card (`SelectedRandomCard`) in
`CurrentSave.AllFavoritedCards_Array` (a flat list, not per-type), calls native
`MediaPlaybackManager.ToggleFavorite(SelectedRandomCard)`, then
`CheckAndUpdateFavoriteUI` (`functions/BP_GlobalManager/AddFavoriteMedia.json`,
25 statements). `AllFavoritedCards_Array` is otherwise only read by the
settings-menu favorite count display
(`VideoSettingsMenuV2/GetFavoriteMediaCountAndSetText.json`); no retained
Blueprint copies it into `Master_Favorite_*` / `*FavoriteCards`. Whether the
native `ToggleFavorite` (or `ValidateMediaEntries`) maintains the per-type
arrays is not visible in retained bytecode — both are native calls whose
internals are not in this tree.

## 3. The player has no favorites mechanism to attach this to

- `grep -rni 'favorite'` over `static/fanservice/`, `tests/`, and
  `docs/fanservice/COMBINED_PRODUCT_SPEC_20261105.md` finds no favorites
  concept: only the unrelated `Embers_Favorite_Icon` asset path in
  `static/fanservice/data/native-contract.json` and `notification:` strings in
  `objectives.js`. No favorites list, no favoriting UI, no saved favorites, no
  `favorite` flag on media items.
- `static/fanservice/rules.js` `mediaPools(media, options)` builds tag-based
  pools only: `slow`, `medium`, `fast`, `succubus`, `cum`, `ass`, `boobs`,
  `video`. There is no favorite pool.
- `static/fanservice/cards.js` `Cards.start` / `static/fanservice/run.js`
  `Run.player` (`{sessionLength, hasCame, isAllowedToCum}`) model no media
  identity at all: a card flow is pool, card type, pattern, interval, travel.
  `static/fanservice/play.js` `draw()` picks a random media item from
  `decks[pool]` (`decks['cum']` on an override draw), but nothing marks an
  item as a favorite and nothing persists one.
- The already-implemented override branch (`cards.js`, `card===6 &&
  options.override===true`: 25-50 strokes, 0.28-0.30 s, bank `cum`) already
  covers the numbers shared by both original branches (see §4).

## 4. The favorite branch changes nothing else observable

`CumEventOverride` stmts 1781 (success) and 1785 (failure), read in full:

- 1781: `DrawManager.SpawnCustomCardEvent(CumFavoriteCards, 25, 50, 0.28, 0.3,
  6, Stroke Time Speed Multiplier, Stroke Count Multiplier, out SlateBrush,
  out StrokeInterval)`.
- 1785: identical except `CumCards` in place of `CumFavoriteCards`.

Both fall through / jump to stmt 1782, the shared `Array_Random` pick from
`CumBeatPatterns` and `StartPatternWithMediaSync` at 1783. Strokes, interval,
type, multipliers, pattern bank, and timing are identical in both branches —
confirmed, not just as the prior note stated.

Inside `SpawnCustomCardEvent` (`functions/BP_DrawManager/
SpawnCustomCardEvent.json`, 96 statements), the array argument
`CardArrayInput` is referenced **exactly once**: stmt 22 `Array_Length` feeding
a debug `PrintString` (`"In Array Current Size: " + length`, stmts 23-25).
There is no `Array_Random` on it anywhere in the function. The displayed media
is instead chosen by native `MediaPlaybackManager.SwapMedia()` (stmts 30-31,
no parameters) after `DetermineShouldMediaSwap` (stmt 26) and
`MediaPlaybackManager.SetActiveCategory(Converted CardType)` (stmts 28-29),
with the result stored as `DrawManager.SelectedRandomCard` / `GlobalManager.
SelectedRandomCard` (stmts 31-32, `.File` used for display at stmt 33). The
array is also not the source of the stroke/interval rolls: those are
`RandomIntegerInRange(MinStrokes, MaxStrokes)` (stmt 65) and
`RandomFloatInRange(MinInterval, MaxInterval) * TimeSpeedMultiplier`
(stmts 75-76, 89-90).

So the retained bytecode does **not** establish that passing
`CumFavoriteCards` instead of `CumCards` changes which media `SwapMedia`
picks — selection is native and by category. The only established observable
difference of a successful `RollFavoritesChance(6)` is the `"Playing Favorite"`
notification (§1). A bare 10% roll in the player would be wrong: in the
original the notification (and the favorite branch) can only fire when the
favorites list is non-empty, and the player has no such list.

## Verdict: still blocked — no player change made

No code was changed. A faithful player change would need a favorites roll
with the traced probability **using a favorites list whose population is
established**, and none is. The exact missing evidence, in order:

1. **What populates `CumFavoriteCards` in play.** A retained caller of
   `AddFavoriteCardToArray`, or retained evidence that native
   `MediaPlaybackManager.ToggleFavorite` maintains the per-type
   `Master_Favorite_*` / `*FavoriteCards` arrays. Without it, any player-side
   favorites list would have to be seeded by an invented rule (e.g. "all cum
   media are favorites", or a `favorite` media tag) — explicitly not done.
   Note the retained UI toggle (`AddFavoriteMedia`) writes a different list
   (`AllFavoritedCards_Array`), so it cannot be used as the seeding rule.
2. **That the array argument affects the spawned media.** Retained evidence
   that `SpawnCustomCardEvent`'s `CardArrayInput` influences what native
   `SwapMedia()` selects. As traced, the array is only length-logged and
   selection is native/by-category, so even a populated favorites list has no
   established observable effect in the player beyond the notification.
3. **A player-side favorites surface to attach to.** None exists (no list, no
   toggle, no saved favorites, no favorite media flag); the spec has none
   either.

If (1) and (2) arrive, the faithful change is then a roll in the cum override
draw path (`play.js` `draw()` / `run.cumOverrideDue()`): when the roll succeeds
and the established favorites deck is non-empty, pick the override media from
it instead of `decks['cum']` and show the "Playing Favorite" notification;
strokes, interval, type, and pattern bank stay exactly as the existing
override branch already implements them.
