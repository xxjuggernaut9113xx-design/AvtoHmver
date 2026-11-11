# #44 — Favorites: native UMediaPlaybackController disassembly (v0.05.1)

Date: 2026-11-11. Source build: Cock Hero v0.05.1 Hotfix Public,
`CockHero.exe` SHA-256 `a8f46896…040c10` (verified), PDB with 630,923 public
symbols. All addresses are RVAs in that exe (image base `0x140000000`).
Disassembly via `objdump` from the build's own PDB, using the same
`disasm.py` approach as the #51 StartFromBeatmap note. Nothing here is
guessed: every claim cites an address or a PDB symbol.

## Verdict up front

**How favorites populate is SETTLED by this disassembly.** `ToggleFavorite`
flips one media entry's `bIsFavorite` flag and moves it between the master
deck registry and the favorites source registry; `RebuildFavoriteFrenzyCategory`
re-derives the FavoriteFrenzy deck (category 9) from the favorites source
registry, deduped by anti-repeat key, and installs it (shuffled) as the
category-9 deck in both the master and the remaining-deck maps.
Favorites feed card draws in two ways: (1) a FavoriteFrenzy card draws
straight from the category-9 deck; (2) any other category draw has a
percentage roll (native field `this+0x30`; the only recorded default for the
equivalent setting is `FavoritesLikelyhoodPercent = 10` in
BP_GlobalManager's CDO) to draw from that category's remaining-favorites
deck instead of its normal deck.

**There is no `CumFavoriteCards` equivalent.** A PDB-wide search for
`CumFavorite*` returns zero symbols. Favorites are not a separate cum
structure; they are the `ECardCategory::FavoriteFrenzy = 9` deck plus the
per-category remaining-favorites decks (map `+0x418`).

What is still NOT settled by this disassembly (named exactly below):
the Blueprint caller side (`RollFavoritesChance`,
`CheckAndRollFavoritesMediaArray`, `FavoriteFrenzyEvent`,
`StartFavoriteFrenzyCooldown`, `FavoriteFrenzyEligibilityCheck` in
BP_GlobalManager; `AddFavoriteCardToArray` in BP_DrawManager), the exact
`MakeMediaAntiRepeatKey` string transform, the body of
`EnsureCategoryDeckInitialized`, and the provenance of the `+0x30`
roll-threshold value (native field vs the Blueprint's
`FavoritesLikelyhoodPercent = 10`). The cooked packages are now
unpackable (Oodle resolved 2026-11-11; `retoc manifest` works on the
v0.05.1 utoc, 16,302 entries) and the Blueprint caller side is being
mined from them separately — this note does not duplicate that work.

## 1. Types

### `ECardCategory` (from `Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json`)

| value | name |
|---|---|
| 0 | Slow |
| 1 | Medium |
| 2 | Fast |
| 3 | Succubus |
| 4 | Event |
| 5 | Edging |
| 6 | Cum |
| 7 | AssFrenzy |
| 8 | BoobFrenzy |
| 9 | FavoriteFrenzy |

All four per-category maps below are
`TMap<ECardCategory, TArray<FCHPackMediaEntry>>` (pair stride 0x20:
key byte + pad + 16-byte `TArray` + hash index). The key is stored as a
single byte; the disassembly compares it with `cmpb` against constants
including `9`.

### `FCHPackMediaEntry` — 72 bytes (0x48)

Field layout, verified by the copy code in `RebuildFavoriteFrenzyCategory`
(`0x14829a1ce`–`0x14829a2bd`, which deep-copies each field in order) and by
the `ToggleFavorite` return-value construction:

| offset | field |
|---|---|
| +0x00 | `TArray` (16 bytes) |
| +0x10 | `TArray` (16 bytes) |
| +0x20 | `FString` (16 bytes) |
| +0x30 | `FString` — filename, compared case-insensitively (`Stricmp`) to identify media |
| +0x40 | byte (copied as-is; not `bIsFavorite`) |
| +0x41 | **`bIsFavorite`** (bool byte) |

`bIsFavorite` at **+0x41** is proven, not inferred: the PDB's only
`FCHPackMediaEntry` bit setter,
`NewProp_bIsFavorite_SetBit` (`0x1481ba9c0`), is a single instruction:
`movb $0x1, 0x41(%rcx)`.

## 2. `UMediaPlaybackController` member map (offsets from `this`)

| offset | member | evidence |
|---|---|---|
| +0x30 | int — favorite-injection roll threshold (0–99 scale) | `DrawNextCardForCategory` `0x14826f60b`–`0x14826f648`: `rand() & 0x7fff` scaled to 0–99; roll `< this+0x30` enables the favorites path |
| +0x328 | `TMap<ECardCategory, TArray<FCHPackMediaEntry>>` — master deck registry | read by `GetFavoriteFrenzyCardCount` (key 9), `RebuildGlobalDrawCycleUniverse` loop 1, `DrawNextCardForCategory` refill; written by `ToggleFavorite` and the rebuild |
| +0x378 | `TMap<...>` — remaining deck per category (normal draws) | read by `GetRemainingCards` (key = `+0x568`), `DrawNextCardForCategory` normal path; refilled from `+0x328` on exhaustion |
| +0x3c8 | `TMap<...>` — favorites source registry (favorited entries, by home category) | iterated by `RebuildFavoriteFrenzyCategory` (all keys except 9); written by `ToggleFavorite` |
| +0x418 | `TMap<...>` — remaining favorites deck per category | read by `GetRemainingFavoriteCards` (key = `+0x568`), `DrawNextCardForCategory` favorites path; refilled from `+0x3c8` on exhaustion |
| +0x468 | `TSet<FString>` — global draw-cycle universe (anti-repeat keys of all registered media) | emptied + refilled by `RebuildGlobalDrawCycleUniverse`; read by `MarkGlobalDrawCycleSeen`, `RefreshGlobalDrawCycleIfComplete` |
| +0x4b8 | `TSet<FString>` — global draw-cycle seen set (anti-repeat keys already drawn this cycle) | added to by `MarkGlobalDrawCycleSeen`; pruned by `RebuildGlobalDrawCycleUniverse`; emptied by `RefreshGlobalDrawCycleIfComplete` when the cycle completes |
| +0x568 | byte — current card category (`ECardCategory`) | read by `DrawNextCard` (`0x14826f406`: `movzbl 0x568(%rcx),%r8d`) and both `GetRemaining*` getters |
| +0x574 | bool — controller ready gate | if 0, `ToggleFavorite` returns the input unchanged, `DrawNextCardForCategory` returns an empty entry, `MarkGlobalDrawCycleSeen` returns |

The four maps sit 0x50 apart; each `TMap` is 0x28 bytes with a 0x28-byte
gap whose contents were not needed here.

## 3. The native favorites API (all `UMediaPlaybackController`)

| function | address | signature (from PDB mangling) |
|---|---|---|
| `ToggleFavorite` | `0x1482bd300` (4,768 bytes) | `FCHPackMediaEntry ToggleFavorite(const FCHPackMediaEntry&)` |
| `GetRemainingFavoriteCards` | `0x148282950` | `int32 GetRemainingFavoriteCards() const` |
| `GetFavoriteFrenzyCardCount` | `0x1482810b0` | `int32 GetFavoriteFrenzyCardCount() const` |
| `HasEnoughFavoriteFrenzyCards` | `0x148283c00` | `bool HasEnoughFavoriteFrenzyCards(int32) const` |
| `RebuildFavoriteFrenzyCategory` | `0x148299d10` (2,288 bytes) | `void RebuildFavoriteFrenzyCategory()` (private) |
| `GetRemainingCards` | `0x1482828c0` | `int32 GetRemainingCards() const` (non-favorite counterpart) |
| `DrawNextCard` | `0x14826f400` (48 bytes) | `FCHPackMediaEntry DrawNextCard()` |
| `DrawNextCardForCategory` | `0x14826f430` (7,968 bytes) | `FCHPackMediaEntry DrawNextCardForCategory(ECardCategory, bool)` |
| `RebuildGlobalDrawCycleUniverse` | `0x14829a600` (3,184 bytes) | `void RebuildGlobalDrawCycleUniverse()` (private) |
| `RefreshGlobalDrawCycleIfComplete` | `0x14829d220` (160 bytes) | `void RefreshGlobalDrawCycleIfComplete()` (private) |
| `MarkGlobalDrawCycleSeen` | `0x1482878e0` (176 bytes) | `void MarkGlobalDrawCycleSeen(const FString&)` (private) |
| `RememberDrawnMedia` | `0x1482a0a80` (16 bytes) | `void RememberDrawnMedia(const FCHPackMediaEntry&)` — tail-calls `MarkGlobalDrawCycleSeen(entry+0x30)` |
| `MakeMediaAntiRepeatKey` | `0x1482877e0` | `static FString MakeMediaAntiRepeatKey(const FString&)` |
| `ShuffleArray` | `0x1482aff80` | `static void ShuffleArray(TArray<FCHPackMediaEntry>&)` |
| `EnsureCategoryDeckInitialized` | `0x148272d70` | `void EnsureCategoryDeckInitialized(ECardCategory)` (private) |
| `BuildAntiRepeatBlockedKeys` | `0x14825e6b0` | `TSet<FString> BuildAntiRepeatBlockedKeys(bool) const` |
| `BuildSoftGlobalAntiRepeatBlockedKeys` | `0x1482632d0` | `TSet<FString> BuildSoftGlobalAntiRepeatBlockedKeys(const TSet<FString>&) const` |
| `HasAntiRepeatEligibleCard` | `0x148283870` | `bool HasAntiRepeatEligibleCard(const TArray<FCHPackMediaEntry>&, const TSet<FString>&) const` |
| `TryPopWarmReadyCardFromDeck` | `0x1482be750` | `bool TryPopWarmReadyCardFromDeck(TArray<FCHPackMediaEntry>&, const TSet<FString>&, FCHPackMediaEntry&)` |
| `PopCardFromDeckAvoidingAntiRepeat` | `0x148292910` | `FCHPackMediaEntry PopCardFromDeckAvoidingAntiRepeat(TArray<FCHPackMediaEntry>&, const TSet<FString>&)` |

## 4. `ToggleFavorite` — how the favorites list populates

`0x1482bd300`, read in full. Flow:

1. **Gate.** If `this+0x574` is 0, return the input entry unchanged (no-op).
2. **Locate the entry.** Scan the `+0x328` master map's pairs — every key
   **except 9** — and within each pair's array compare the entry's
   filename (`+0x30` FString) case-insensitively (`Stricmp`) against the
   input filename. Set a found-flag (stack `0x50`) if the input is present
   in any non-9 category array. The key-9 (favorites) array is never
   scanned here.
3. **Find the home pair.** Find the pair in the `+0x328` map whose key is
   the input entry's category. If its key is 9, skip step 4 (the three
   `FindOrAdd` calls) and go to the rebuild.
4. **Move the entry between registries** (key != 9):
   - **Favorite path** (found-flag = 1, i.e. the entry is currently a
     non-favorite in the master pool): deep-copy the matching entry with
     `bIsFavorite` (`+0x41`) forced to **1**; append the copy to the
     `+0x3c8` (favorites source) and `+0x418` (remaining favorites) arrays
     for its category key (`FindOrAddImpl 0x14823fe70`); remove it from the
     `+0x328` master array (`RemoveAtImpl 0x1482a1a60`).
   - **Unfavorite path** (found-flag = 0): scan the `+0x3c8` array
     backwards for the filename; on match, deep-copy it with
     `bIsFavorite` forced to **0**; append the copy to the `+0x328`
     master array and the `+0x378` (remaining deck) array for its
     category; remove it from the `+0x3c8` array.
5. **Rebuild.** Call `RebuildFavoriteFrenzyCategory` (`0x148299d10`),
   then `RebuildGlobalDrawCycleUniverse` (`0x14829a600`).
6. **Return.** A field-by-field copy of the entry with `+0x40` copied
   from the source entry and `+0x41` = the found-flag — i.e. the returned
   entry reports the NEW favorite state (1 = now a favorite, 0 = no
   longer a favorite).

Net effect: toggling moves one entry between the master pool and the
favorites pool; the entry's identity is its filename (case-insensitive);
the favorite flag lives on the entry copy (`+0x41`).

## 5. `RebuildFavoriteFrenzyCategory` — what it builds

`0x148299d10`, read in full. Flow:

1. Iterate **all pairs of the `+0x3c8` favorites-source map except key 9**.
   For each entry in each pair's array:
   - Compute `MakeMediaAntiRepeatKey(entry filename)`; skip the entry if
     the returned key's length is <= 1.
   - Hash the key (`Strihash_DEPRECATED`) and look it up in a local
     `TSet<FString>`; if already present, skip the entry (**dedup by
     anti-repeat key** — the same media file reached through two
     categories appears once).
   - Otherwise add the key to the local set, deep-copy the entry into a
     local with `bIsFavorite` forced to **1**, and append the copy to a
     local `TArray<FCHPackMediaEntry>` (the rebuilt deck).
2. Install the rebuilt deck as key 9 by `Emplace` (which, in this build's
   instantiation, replaces the existing pair's value via
   `TryReplaceExisting 0x1482c00f0`) into the **`+0x328` master map** and
   into the **`+0x378` remaining-deck map**.
3. `Remove(9)` from the `+0x3c8` map and from the `+0x418` map (the
   favorites category does not live in the source or remaining-favorites
   maps).
4. If the rebuilt deck is non-empty, find key 9 in the `+0x378` map and
   `ShuffleArray` its value — **the FavoriteFrenzy remaining deck is
   shuffled on every rebuild**.

So the FavoriteFrenzy deck is **derived, not stored**: it is rebuilt from
all favorited entries (from every home category), deduped by anti-repeat
key, with `bIsFavorite = 1`, and shuffled. There is no separate
"favorites list" object beyond the `+0x3c8` source registry and the
derived key-9 deck.

## 6. The draw-cycle universe and anti-repeat

`RebuildGlobalDrawCycleUniverse` (`0x14829a600`, read in full):

1. Empty the universe set `+0x468` (`TSet<FString>`).
2. Collect `MakeMediaAntiRepeatKey(filename)` for **every** entry in the
   `+0x328` map (all categories, including 9) **and** the `+0x3c8` map
   (all categories) into `+0x468` — the union of all anti-repeat keys of
   currently registered media.
3. Prune the seen set `+0x4b8`: keep only keys still present in `+0x468`
   (stale keys — media that no longer exists — are dropped); move-assign
   the filtered set back into `+0x4b8`.
4. Call `RefreshGlobalDrawCycleIfComplete` (`0x14829d220`, read in full):
   if the seen set's effective size is >= the universe set's effective
   size (and the universe is non-empty), **empty the seen set** — the
   draw cycle is complete and a new cycle starts. (A log line is emitted
   when `this+0x4d` is set and global verbosity >= 3.)

`MarkGlobalDrawCycleSeen` (`0x1482878e0`, read in full): gated on
`+0x574`; if the universe set is empty, return; otherwise compute the
anti-repeat key of the given filename and, **only if that key is in the
universe set**, add it to the seen set `+0x4b8`. `RememberDrawnMedia`
passes the drawn entry's filename (`+0x30`) to it, and
`DrawNextCardForCategory` calls `RememberDrawnMedia` on the drawn entry
when its bool argument is true (`0x14826fc11`).

## 7. How favorites feed card draws

`DrawNextCard` (`0x14826f400`) is a 48-byte wrapper: it reads the current
category byte from `this+0x568`, passes `true` as the bool argument, and
tail-calls `DrawNextCardForCategory`.

`DrawNextCardForCategory` (`0x14826f430`, read in full — 2,100 insns):

1. **Gate.** If `this+0x574` is 0, log (verbosity >= 2) and return an
   all-zero `FCHPackMediaEntry` (empty draw).
2. `EnsureCategoryDeckInitialized(category)`, then
   `RefreshGlobalDrawCycleIfComplete()`.
3. Look up the category's deck in the **`+0x378` map** (normal remaining
   deck) and in the **`+0x418` map** (remaining favorites deck).
4. Build the blocked-key sets: `BuildAntiRepeatBlockedKeys(true)` (hard
   set) and `BuildSoftGlobalAntiRepeatBlockedKeys(hard set)` (soft set).
5. **Favorite injection roll.** If the requested category is **not** 9
   (FavoriteFrenzy) and `this+0x30 > 0` and the `+0x418` array has an
   entry with a non-empty filename: roll `rand() & 0x7fff`, scale to
   0–99, and if the roll is `< this+0x30`, the favorites path is taken.
   (The only recorded default for the equivalent setting is
   `FavoritesLikelyhoodPercent = 10` in BP_GlobalManager's CDO — see §9.)
6. **Favorites path** (roll hit): if the `+0x418` array has an
   anti-repeat-eligible card (`HasAntiRepeatEligibleCard` against the
   soft set), pop from it with `TryPopWarmReadyCardFromDeck`, using the
   hard blocked set when an eligible card exists under it, else the soft
   set. If the pop fails, fall back to
   `PopCardFromDeckAvoidingAntiRepeat` on the same array. If the array
   is exhausted after the pop, refill it from the `+0x3c8` favorites
   source array for the category (`TArray::operator=`) and
   `ShuffleArray` it (plus one random-swap step).
7. **Normal path** (roll missed, category is 9, or no favorites deck):
   pop from the `+0x378` array the same way (hard set if an eligible
   card exists under it, else soft set; `PopCardFromDeckAvoidingAntiRepeat`
   fallback). If the array is exhausted after the pop, refill it from the
   `+0x328` master array for the category and `ShuffleArray` it.
   **A FavoriteFrenzy (category 9) draw therefore pops from the shuffled
   key-9 deck in `+0x378` that the rebuild installed.**
8. **Empty deck.** If the chosen deck is null or empty, log (verbosity
   >= 2) and return an all-zero entry. There is **no fallback to another
   category**.
9. If the bool argument is true, `RememberDrawnMedia` the drawn entry
   (marks its anti-repeat key seen), then copy the entry to the out
   parameter.

### Getters

- `GetFavoriteFrenzyCardCount` (`0x1482810b0`): find key 9 in the
  `+0x328` map; return the value array's Num, or 0 if absent.
- `HasEnoughFavoriteFrenzyCards(n)` (`0x148283c00`): same lookup;
  return `Num >= max(n, 0)`.
- `GetRemainingCards` (`0x1482828c0`, disassembled by address): find key
  = byte at `this+0x568` in the `+0x378` map; return the value array's
  Num, or 0.
- `GetRemainingFavoriteCards` (`0x148282950`): find key = byte at
  `this+0x568` in the `+0x418` map; return the value array's Num, or 0.
  Note the key is the **current category**, not 9: it counts the
  remaining favorite cards **for the current category**.

## 8. The 4 FavoriteFrenzy widget packages — verified in the container

All four named in the survey are present in the v0.05.1 container
(`v0051-paths.txt`, 26,988 lines; mount `../../../CockHero/Content/`):

- `Widgets/SpecialEventWidgets/FavoriteFrenzySpawnOverlay_Widget.uasset`
- `Widgets/SpecialEventWidgets/FavoriteFrenzyOverlayText.uasset`
- `Widgets/SpecialEventWidgets/FavoriteFrenzyOverlayBackground.uasset`
- `ChallengeIcons/Embers_Favorite_Icon.uasset` (+ `.ubulk`)

Related packages also present (not part of the named four):
`Widgets/NotificationBoxIcons/FavoriteIcon.uasset`,
`Widgets/NotificationBoxIcons/Unfavorite_Icon.uasset`,
`Widgets/NotificationBoxIcons/PlayFavoriteMedia.uasset`,
`UI/FavoritedMedia_DEBUG_Widget.uasset` (a debug widget for favorited
media). Their Blueprint contents are in the cooked packages, now
unpackable — see §9.

## 9. Still missing (exact)

1. **Blueprint caller side.** The Blueprint functions that drive this
   native API live in BP_GlobalManager (from reJOIce
   `blueprint-class-defaults.json`, classes[0]):
   `FavoriteFrenzyEvent`, `StartFavoriteFrenzyCooldown`,
   `ProgressFavoriteFrenzyCooldown`, `FavoriteFrenzyEligibilityCheck`,
   `RollFavoritesChance`, `CheckAndRollFavoritesMediaArray`,
   `AddFavoriteMedia`, `PlayRandomFavoritedMedia`, `CheckAndUpdateFavoriteUI`,
   plus `BoobFrenzyEvent` / `AssFrenzyEvent` and their eligibility checks;
   and `AddFavoriteCardToArray` in BP_DrawManager (classes[4]). Which of
   these call `ToggleFavorite` / `DrawNextCardForCategory`, what triggers
   a FavoriteFrenzy event, and what `FavoriteFrenzyEligibilityCheck`
   requires are **not** established by native disassembly. The cooked
   packages are now unpackable and this is being mined from them
   separately.
2. **`MakeMediaAntiRepeatKey` transform.** The function takes a filename
   `FString` and returns a key `FString`; the exact transform (clean
   filename? path stripping? case folding?) was not decoded. It matters
   for dedup: two entries dedup iff their keys are equal (compared with
   `Strihash_DEPRECATED` + case-insensitive compare).
3. **`EnsureCategoryDeckInitialized` body.** Called at the top of every
   draw; its exact source population (which map it fills from, on first
   draw of a category) was not read.
4. **`+0x30` threshold provenance.** The native roll threshold is the
   `UMediaPlaybackController` member at `+0x30` (int, 0–99 scale). The
   only recorded default for the equivalent setting is
   `FavoritesLikelyhoodPercent = 10` in **BP_GlobalManager's** CDO
   (`blueprint-class-defaults.json`, defaults[0]). Whether the
   controller's `+0x30` is initialized to 10 from its own CDO or set at
   runtime by the Blueprint is not established here; the cooked
   `UMediaPlaybackController` CDO would settle it. Do not hard-code 10
   as a native fact — record it as the Blueprint-side default.
5. **FavoriteFrenzy cooldown.** BP_GlobalManager's CDO has
   `Master_FavoriteFrenzyCooldownSeconds = 120.0`, with
   `StartFavoriteFrenzyCooldown` / `ProgressFavoriteFrenzyCooldown`
   functions. The native side has no cooldown field in the disassembled
   functions; the 120 s value and its enforcement live in the Blueprint.
6. **The `+0x574` gate and `+0x568` current-category writer.** The gate
   bool and the current-category byte are read by the native functions
   but written elsewhere (Blueprint / initialization); their exact
   writers were not traced.

## 10. Implementation plan for the player

The player currently has **no** favorites code (no `favorite` matches in
`static/fanservice/*.js`). Build a `static/fanservice/favorites.js`
module (new file) plus wiring, test-first, in this order:

1. **Data model.** A media entry object carrying the 72-byte struct's
   player-relevant fields: filename (the identity, compared
   case-insensitively), category (`ECardCategory` 0–9), and `isFavorite`
   (the `+0x41` byte). Keep the four per-category maps as
   `Map<category, Entry[]>`:
   - `master` (`+0x328`): all non-favorite media by category, plus key 9
     = the derived favorites deck.
   - `remaining` (`+0x378`): working remaining deck per category.
   - `favoritesSource` (`+0x3c8`): favorited entries by home category.
   - `remainingFavorites` (`+0x418`): working remaining-favorites deck
     per category.
   And two `Set<string>`s: `universe` (`+0x468`, anti-repeat keys of all
   registered media) and `seen` (`+0x4b8`, keys drawn this cycle).
   Anti-repeat key: use the entry filename as the key until §9 item 2 is
   decoded (record that substitution in the code as a known deviation).
2. **`toggleFavorite(entry)`.** Mirror §4 exactly: if the entry's
   filename (case-insensitive) is in a non-9 `master` array, move it to
   `favoritesSource` + `remainingFavorites` for its category with
   `isFavorite = true` and remove it from `master`; else move it back
   to `master` + `remaining` with `isFavorite = false` and remove it
   from `favoritesSource`. Then rebuild (§3) and refresh the universe.
   Return the entry with its new `isFavorite`.
3. **`rebuildFavoriteFrenzyCategory()`.** Mirror §5: collect all entries
   from `favoritesSource` except key 9, dedupe by anti-repeat key, force
   `isFavorite = true`, install the result as key 9 in `master` and
   `remaining`, remove key 9 from `favoritesSource` and
   `remainingFavorites`, and shuffle the key-9 `remaining` deck.
4. **`rebuildGlobalDrawCycleUniverse()`.** Mirror §6: rebuild `universe`
   from `master` + `favoritesSource` keys; prune `seen` to keys still in
   `universe`; if `seen.size >= universe.size` and the universe is
   non-empty, clear `seen`.
5. **Draw.** Mirror §7 in the existing draw path (`cards.js` / `run.js`
   seams — to be identified at implementation time): gate on the
   controller-ready flag; `EnsureCategoryDeckInitialized`; refresh the
   cycle; build hard/soft blocked sets; for a non-9 category, roll
   0–99 against the injection threshold (default 10, from the
   Blueprint-side `FavoritesLikelyhoodPercent`, recorded as such) and,
   on a hit, pop from `remainingFavorites[category]`; otherwise pop from
   `remaining[category]`; on exhaustion refill from the matching source
   map (`remaining` ← `master`, `remainingFavorites` ←
   `favoritesSource`) and shuffle; empty deck → empty draw (no fallback
   to another category); mark the drawn entry seen.
6. **Getters.** `getFavoriteFrenzyCardCount()` (`master[9].length`),
   `hasEnoughFavoriteFrenzyCards(n)` (`>= max(n, 0)`),
   `getRemainingCards()` (`remaining[currentCategory].length`),
   `getRemainingFavoriteCards()` (`remainingFavorites[currentCategory].length`).
7. **UI (deferred until the Blueprint side is mined).** The four
   FavoriteFrenzy widget packages (§8) and the Blueprint cooldown
   (120 s) plus `FavoriteFrenzyEligibilityCheck` gate the event UI; do
   not build the frenzy overlay, the toggle button placement, or the
   cooldown until the caller-side mining names the trigger and the
   eligibility rule. The `FavoritedMedia_DEBUG_Widget` suggests a debug
   listing exists in the original; it is not a player requirement.

### Acceptance criteria (#44, favorites part)

- Toggling a favorite moves the entry between the master and favorites
  registries and the FavoriteFrenzy deck (key 9) is rebuilt, deduped,
  and shuffled — verifiable by unit tests over the four maps.
- A FavoriteFrenzy draw pops from the shuffled key-9 deck; a normal
  draw injects a favorite from the current category's remaining-favorites
  deck on the percentage roll and otherwise draws the normal deck; both
  decks refill from their source map and reshuffle on exhaustion.
- `getFavoriteFrenzyCardCount`, `hasEnoughFavoriteFrenzyCards`,
  `getRemainingCards`, `getRemainingFavoriteCards` match the native
  semantics in §7 (including the current-category keying of the two
  `getRemaining*` getters and the empty-deck → empty-draw behavior).
- No `CumFavoriteCards` structure is built (none exists in the original).
- The Blueprint-side trigger / eligibility / cooldown (120 s) and the
  four widget packages remain open until the caller-side mining lands;
  the note must say so rather than guessing them.

## 11. Disassembly artifacts

Work files (not committed): `~/workspace/rejoice-evidence/cockhero-itch/work/`
`ToggleFavorite.asm`, `RebuildFavoriteFrenzyCategory.asm`,
`RebuildGlobalDrawCycleUniverse.asm`, `DrawNextCardForCategory.asm`,
`DrawNextCard.asm`, `RememberDrawnMedia.asm`, `MarkGlobalDrawCycleSeen.asm`,
`RefreshGlobalDrawCycleIfComplete.asm`, plus the `disasm.py` tool in
`~/workspace/rejoice-evidence/v0051-work/`.
