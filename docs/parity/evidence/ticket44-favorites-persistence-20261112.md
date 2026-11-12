# #44 favorites — persistence across sessions: SETTLED (original DOES persist)

Date: 2026-11-12. Source build: Cock Hero v0.05.1 Hotfix Public,
`CockHero.exe` SHA-256 `a8f46896…040c10` (verified). Evidence: cooked
packages (legacy-converted, parsed with `work/kismet2.py`), reJOIce
`Analysis/ReferenceBuilds/newer-20261017/` function ASTs
(`blueprint-function-delta.json` cross-check), `save-class-defaults.json`
(BP_CHSaveGame_C), and native disassembly from the build's own PDB
(`ValidateMediaEntries` 0x1482c3e50, `SaveProgress`/`LoadProgress`).

## Verdict

**The original persists favorites across sessions.** The persisted form is
the five per-category save arrays of full `CHPackMediaEntry` structs plus
the flat `AllFavoritedCards_Array`, all on the save-game object
`BP_CHSaveGame_C`, written by `SaveGameToSlot` on every toggle and
restored at startup through validation. The in-memory native registries
(`UMediaPlaybackController` +0x328 master, +0x3c8 favorites source,
+0x378 remaining, +0x418 remaining favorites) are session-scoped and are
repopulated from the restored Blueprint masters; the derived
FavoriteFrenzy deck (key 9) is NOT stored anywhere — it is rebuilt from
the restored favorites registry.

## What is persisted (save-game properties, `save-class-defaults.json`)

`BP_CHSaveGame_C` (116 properties, `byte_identical_roundtrip: True`)
carries, as `ArrayProperty` of `CHPackMediaEntry` (72-byte struct,
`bIsFavorite` at +0x41 — see `ticket44-favorites-native-20261111.md` §1):

- `Saved_Slow_FavoriteCards`, `Saved_Medium_FavoriteCards`,
  `Saved_Fast_FavoriteCards`, `Saved_Succubus_FavoriteCards`,
  `Saved_Cum_FavoriteCards` (property flags `0x10005`, i.e. serialized);
- `AllFavoritedCards_Array` (same struct type);
- `FavoritesLikelihoodPercentage` (IntProperty, CDO default **20** —
  note this differs from the GM CDO `FavoritesLikelyhoodPercent = 10`;
  see "Open follow-ups" below).

There is no saved FavoriteFrenzy deck and no saved copy of the native
+0x328/+0x3c8/+0x378/+0x418 maps.

## Write path — every toggle saves immediately

`AddFavoriteCardToArray` (BP_DrawManager; cooked parse: export 11,765 B,
script at offset 1595, icode 7114, 90 stmts, 0 errors — matches the
reJOIce AST stmt-for-stmt, including icode offsets) does, on BOTH the
add and the remove path, for all five categories (Slow / Medium / Fast /
Succubus / Cum):

1. `Array_Contains` on the CardManager master registry, then
   `Array_RemoveItem` (remove path) or `Array_Add` (add path) on BOTH
   the master registry (`Master_Favorite_<Cat>`) and the DrawManager
   draw pool (`<Cat>FavoriteCards`);
2. **write-through to the save array**:
   `CurrentSave.Saved_<Cat>_FavoriteCards = <master source>` (Slow
   stmts 23/29, Medium 37/44, Fast 52/58, Succubus 66/72, Cum 80/86);
3. **`GameInstance.SaveAllData()`** (Slow stmts 24/30, Medium 38/45,
   Fast 53/59, Succubus 67/73, Cum 81/87);
4. `UIManager.CreateNotificationBox("Media Favorited" /
   "Media Unfavorited", "<Cat> Media added to / removed from your
   favorites.")`.

`SaveAllData` (BP_CHGameInstance) → ubergraph entry 5037 →
`SaveGameToSlot(CurrentSave, SaveSlotName, UserIndex)` (GameInstance
ubergraph stmt 143), which serializes the whole `CurrentSave` object —
including the five `Saved_*_FavoriteCards` arrays and
`AllFavoritedCards_Array`. So a toggle is durable the moment it happens;
there is no deferred/batch save for favorites on this path.

This corrects the earlier blueprint note's line that "the toggle itself
operates on the master + draw-pool arrays, not the saved arrays": the
toggle operates on all three (master + pool + save array) and saves
immediately. (The note's per-category statement offsets are unchanged.)

`AddFavoriteMedia` (BP_GlobalManager, 24 stmts) is the second write
path: it toggles `SelectedRandomCard` in
`GameInstance.CurrentSave.AllFavoritedCards_Array`, calls
`GameInstance.SaveAllData()` and the native
`MediaPlaybackManager.ToggleFavorite(SelectedRandomCard)` on the REMOVE
path only; the ADD path only appends to the save array and notifies
("Added Favorite" / "Media has been added to favorties" [sic]).
So an add through that function is durable only when some later save
happens; a remove saves at once. No Blueprint caller of either toggle
function was found (see the blueprint note) — which path the live UI
takes is still unconfirmed, but both write paths persist.

## Restore path — validated load at startup

Call chain (all from the cooked v0.05.1 packages):

- GM `ReceiveBeginPlay` (ubergraph entry 63484) calls
  `InitializeWidgets&Managers` (GM ubergraph stmt 1580 @65570; the
  name is `InitializeWidgets&Managers` in the package name table —
  reJOIce sanitizes `&` to `_` in the JSON filename).
- `InitializeWidgets&Managers` (entry 71655) jumps at stmt 1737
  @72098 to icode 59222, the shared save-population block, which calls
  `CardManager.Validate&PopulateSavedMedia` (GM ubergraph stmt 1424
  @59222) and then populates modifiers from
  `CurrentSave.ActiveModifiers` ('Ass Fanatic' / 'Boobs Fanatic' /
  'Feet Fanatic' temp strings, stmts 1425–1438).
- `Validate&PopulateSavedMedia` (BP_CardManager ubergraph entry 3808;
  cooked parse: 125 stmts, icode 4737, 0 errors) does, for each of
  Slow / Succubus / Cum / Fast / Medium (CardManager ubergraph stmts
  102–120):
  ```
  Master_Favorite_<Cat> =
      UCHPackManager::ValidateMediaEntries(CurrentSave.Saved_<Cat>_FavoriteCards)
  CurrentSave.Saved_<Cat>_FavoriteCards = Master_Favorite_<Cat>   // write-back of the validated array
  ```
- `CheckAndReplaceEmptyDecks` (CardManager ubergraph entry 3259 → Jump
  1076) refills any EMPTY DrawManager pool from the corresponding
  CardManager master registry, including the five favorite pools:
  `DrawManager.<Cat>FavoriteCards = CardManager.Master_Favorite_<Cat>`
  when `Array_IsEmpty(<Cat>FavoriteCards)` (stmts 63–81), and the seven
  normal pools likewise (stmts 39–61, 83–85). `SetChildDecks` (entry
  3264) copies all seven normal master decks into the DrawManager
  unconditionally plus `Array_Clear(AllCards)`.

### `ValidateMediaEntries` — the filter rule (native, disassembled)

`UCHPackManager::ValidateMediaEntries`
(`?ValidateMediaEntries@UCHPackManager@@SA?AV?$TArray@UFCHPackMediaEntry@@…`,
0x1482c3e50–0x1482c4030, 480 bytes, 147 insns) returns a new
`TArray<FCHPackMediaEntry>` keeping an entry iff BOTH hold:

1. its filename FString (`+0x30`) has length **> 1**
   (`cmpl $0x1, (%rdi)` at 0x1482c3eca, skip at 0x1482c3fa5); and
2. `IFileManager::Get().FileExists(filename)` is true — the call at
   0x1482c3ed3 is `IFileManager::Get()` (0x140db7920, returns the
   singleton at 0x14ec25648), the virtual at vtable slot 10 (offset
   0x50) resolves through the singleton's vtable (0x14bf587b8) to
   `FFileManagerGeneric::FileExists(const TCHAR*)`
   (`?FileExists@FFileManagerGeneric@@UEAA_NPEB_W@Z`, 0x140dae4e0).

Kept entries are deep-copied whole (72-byte `FCHPackMediaEntry` copy
ctor 0x148243f70) — including `bIsFavorite` at +0x41 — into the
validated array. Skipped entries are counted (EBP) and logged at
verbosity ≥ 3 (`UE::Logging::Private::BasicLog`, 0x140f252a0).
**`bIsFavorite` is NOT consulted by the filter**: the restore keeps
every saved entry whose file still exists on disk, whatever its flag
says. The player's analogue is: drop persisted favorites whose file is
no longer in the current pack/library.

## `UProgressionManager` does NOT touch favorites

`UProgressionManager` (258 PDB symbols) has exactly four save/load
symbols: `SaveProgress` (0x14830f490, 117 insns) /
`LoadProgress` (0x1482ffb80, 687 insns) plus their `exec` wrappers.
Disassembly shows both operate on a separate `UProgressionSaveGame`
object (`CreateSaveGameObject(UProgressionSaveGame)`, 0x146a99ea0) via
`UGameplayStatics::SaveGameToSlot` (0x146ad5b50) /
`LoadGameFromSlot` (0x146abcaa0), copying `FSessionStats`,
`TMap<EMetricType, int>` metric totals and
`TSet<Tuple<FName, FChallengeProgress>>` challenge progress. No
`CHPackMediaEntry`, no favorites registry, no `Saved_*` reference
anywhere in either body, and no Blueprint caller of `SaveProgress` /
`LoadProgress` was found in reJOIce. Progression persistence and
favorites persistence are separate save paths; the favorites path is
the `BP_CHSaveGame_C` arrays + `SaveAllData` above.

## What this settles for the player (#44, last item)

- The original persists favorites: **implement the player equivalent.**
  Persisted form in the player: the favorited set as
  `{filename, home category}` pairs (the analogue of the five
  `Saved_*_FavoriteCards` arrays — the per-category split is
  recoverable from the home category). The derived FavoriteFrenzy deck
  (key 9) is NOT stored; it is rebuilt from the restored registry, as
  in the original.
- Write-through on every toggle (the `AddFavoriteCardToArray`
  behavior: sync + `SaveAllData` immediately), not deferred to session
  end.
- Restore on boot after media registration, dropping entries whose
  file is absent from the current pack (the `ValidateMediaEntries` /
  `FileExists` analogue). A pre-persistence profile (no favorites
  record) loads as empty.
- The player's profile store is the localStorage game profile
  (`fanservice-profile-v1:<library>`, written via `mutateProfile` in
  `play.js`); `FanserviceModel.portableProfile` copies the whole
  profile and only strips `snapshot_status` + per-pack transient
  fields, so a top-level `favorites` record survives library-side
  commits.

## Decoded quirks — recorded, NOT implemented

Two `AddFavoriteCardToArray` behaviors were verified in the cooked
package (independent of the reJOIce AST) but are NOT copied into the
player, because no caller of `AddFavoriteCardToArray` was found and
both contradict the native `ToggleFavorite` registry model the player's
`favorites.js` mirrors:

- **Medium add path saves `[card]` only** (stmts 43–44):
  `K2Node_MakeArray_Array = [Favorited Card]` (EX_SetArray, single
  element), then `Saved_Medium_FavoriteCards = K2Node_MakeArray_Array`.
  The remove path (stmt 37) correctly saves
  `Master_Favorite_Medium`. Net effect if this function ran: adding a
  medium favorite would overwrite the saved medium favorites with just
  the new card, so only that one card would restore next load.
- **Succubus branch operates on the NORMAL deck** (stmts 62–72):
  `Array_Contains` / `RemoveItem` / `Add` and both save writes use
  `Master_SuccubusCards`, not `Master_Favorite_Succubus` — so a
  succubus toggle adds/removes the card from the normal succubus
  master deck, and `Saved_Succubus_FavoriteCards` receives the whole
  normal deck. Since `ValidateMediaEntries` does not filter on
  `bIsFavorite`, a reload after such a toggle would restore the whole
  surviving succubus deck as favorites. (Whether this ever fires in
  the live game is unknown — no caller found.)

## Open follow-ups (not this slice)

- ~~`FavoritesLikelihoodPercentage`: the save-game CDO default is 20
  (`save-class-defaults.json`) while the GM CDO
  `FavoritesLikelyhoodPercent` is 10 (pinned, see the blueprint note).
  How (or whether) the saved 20 reaches the GM's roll threshold at
  startup — `InitializeFavoriteLikelihood` (UI_Manager) only READS the
  GM value — is unestablished. The player's threshold stays 10 (GM
  CDO); do not persist the threshold in the favorites slice.~~
  SETTLED 2026-11-12 (see the blueprint note): the earlier "only
  READS" line was wrong. `InitializeFavoriteLikelihood` (UI_Manager, 22
  stmts, called from the UI_Manager ubergraph entry flow at stmt 2)
  WRITES `GameInstance.CurrentSave.FavoritesLikelihoodPercentage` into
  `GlobalManagerRef.FavoritesLikelyhoodPercent` (stmt 4) and then into
  `GlobalManagerRef.MediaPlaybackManager.FavoritePercentage` (stmt 5)
  at UI init — before any draw — and the FavoritesFrequencySlider
  change handler keeps all three in sync (UI_Manager ubergraph stmts
  669/675/679, each writing `FTrunc(sliderValue * 100)` to the save
  value, the GM value, and the controller value). The effective
  threshold in a default game is 20, and the player's default is now
  20. The slider itself is not modeled in the player (no settings UI
  for it).
- The bridge from the restored Blueprint masters
  (`Master_Favorite_*`) into the native controller maps (+0x328/+0x3c8)
  at session start is not traced (presumably media registration via
  `CreateMasterDecks`); the player's `favorites.js` IS the controller
  equivalent, so restoring its `favoritesSource` registry is the
  faithful analogue, but the native-side handoff itself remains open.
  NOTE (2026-11-12): checked `CreateMasterDecks` and
  `Validate_PopulateSavedMedia` in the retained ASTs — neither calls
  into the native controller (no `MediaPlaybackManager`,
  `ToggleFavorite`, or `DrawNextCard` reference; the only
  `MediaPlayback` hit in `BP_CardManager` is
  `AddBlackListedMediaToArray`). Exact missing piece: a retained caller
  that writes the restored Blueprint masters into
  `UMediaPlaybackController` (+0x328/+0x3c8), or the native-side
  registration entry that fills those maps — neither is in the retained
  evidence. This is a note, not a player behavior: the player has no
  native controller, and its restore is implemented and tested.
- No Blueprint caller of `AddFavoriteCardToArray` / `AddFavoriteMedia`
  — which toggle path the live Favorite button takes is unconfirmed.
