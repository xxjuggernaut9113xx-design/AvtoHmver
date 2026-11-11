# #44 CumBeatPatterns / EdgingBeatPatterns reachability (static, 2026-11-10)

Source: `reJOIce` commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`, `Analysis/ReferenceBuilds/newer-20261017/`. Static reading of retained bytecode only. No original game was run and the shared player was not changed. This does not close #44.

## Findings

1. `EdgingBeatPatterns` is declared on `BP_GlobalManager_C` (class defaults, nine rows) but no retained function AST reads it. A search of every `functions/**` JSON for `"field": "EdgingBeatPatterns"` finds nothing; the only reference file in the tree besides the class defaults is the GlobalManager ubergraph, and there it matches `CumBeatPatterns` only. In the retained bytecode the bank is unreachable. Whether another asset (widget, C++ `BeatSpawnerManagerCPP`) reads it by name is not visible here.
2. `CumBeatPatterns` is read at exactly one place: `ExecuteUbergraph_BP_GlobalManager` statement 1782 (`Array_Random`), followed by `BeatSpawnerManagerCPP.StartPatternWithMediaSync` at 1783 with `BeatSpawnInterval` and `CurrentStrokeCount` from `PlayerVariablesStruct`. The other six banks (Fast 841/1604/2304, Medium 1112/2259, Slow 1154/2241, Succubus 720/1447, Frenzy 1817/1832/2007/2087) are used elsewhere.
3. Statement 1782 is the shared tail of `CumEventOverride` (entry offset 73198, statement 1776). Flow: gate `PlayerVariablesStruct.CanDraw?`; if `IsAllowedToCum?` then create the overlay loop widget when `DoesCumOverlayLoopExist?` is false (stmt 1787-1791); `RollFavoritesChance(6)`; success -> `SpawnCustomCardEvent(CumFavoriteCards, 25, 50, 0.28, 0.3, 6, ...)` (1781) then 1782; failure -> `SpawnCustomCardEvent(CumCards, 25, 50, 0.28, 0.3, 6, ...)` (1785) then jump 73426 = 1782. Both branches end in the same `CumBeatPatterns` random pick, so the cum card plus pattern pair always comes together.
4. `CumEventOverride` is called from `BP_DrawManager.DetermineCardV2` at statements 12 and 56 (the only callers in the tree). Byte offsets for that function were computed with `tools/hotbar_ubergraph_offsets.py` (73 statements, 3030 bytes, 0 unaligned jump targets, 0 context-offset mismatches; internal consistency only). Resolved structure:
   - Stmts 1-5: `GameModeSelection` equal to 0 or 1 jumps to stmt 6; any other value (Playlist = 2) takes `EX_Jump 3027` (end, stmt 71). Whether 0/1 are Classic/Tower matches `items.js` numbering; confirm before relying on it.
   - Stmts 7-9: `BeatSpawnerManagerCPP.IsInMusicMode` true -> end. So no cum override in music mode.
   - Stmt 11 (reached via 6-10): `HasCame?` true -> stmt 12 `CumEventOverride`; false -> stmt 15 (ordinary draw).
   - Stmt 53 (entered from stmt 45): `IsAllowedToCum?` true -> stmt 54: `HasCame?` false -> stmt 12; true -> stmt 55 `PlayAllowedtoCumLoop` then stmt 56 `CumEventOverride`. `IsAllowedToCum?` false -> stmt 59: `HasCame?` true -> stmt 12; false -> stmt 61 `Play Not Allowed to Cum Loop` (no override).
   - Not resolved here: the conditions that lead into stmt 45/53 and what sets `HasCame?`.

## Consequence for the player (not applied)

- Ordinary draws in modes 0 and 1, outside music mode, are replaced by `CumEventOverride` while `HasCame?` or `IsAllowedToCum?` holds. That path uses the five-row `CumBeatPatterns` bank, passes `Beat Travel Time` (class default 1.75, no literal in the ubergraph) to `StartPatternWithMediaSync`, and does not call `CheckIntervalMultipliers` on the picked row (the 100 percent path does, stmt 1605). Its cum card is `SpawnCustomCardEvent(25, 50 strokes, 0.28-0.30 s, type 6)`; the player's `cum` card is 75-100 strokes, 0.28-0.35 s, travel 1.5, Fast bank, which equals the `Spawn100PercentCumMeterOverrideEvent` call (stmt 1603-1606) exactly. The Fast/1.5 s pairing in the shared player's `cum` pool matches `Spawn100PercentCumMeterOverrideEvent` (entry 66033) only.
- The shared `card-rules.json` has no `CumBeatPatterns` rows. The rows are in reJOIce itself: `Analysis/ReferenceBuilds/newer-20261017/blueprint-class-defaults.json`, `defaults[0].values` (class `BP_GlobalManager_C`, payload SHA-256 `2e54a9da90cdc07f94e30c45953587f94bef5f98d1d5733c616023f615caf3b7`, `byte_identical_roundtrip: true`). Note `card-rules.json` records `build v004-exclusive-c645757d` and defaults hash `05d48496...`; that differs from this payload hash, so the player's banks and these rows are not yet shown to come from the same dump.
- `CumBeatPatterns` (5 rows, multipliers): `1-1` [1.0]; `1-1-1-1-123456` [1,1,1,1,.5,.5,.5,.5,.5,.5]; `1-1-12345` [1,1,.5,.5,.5,.5,-1.0]; `123456789-rest` [.5 x8, 1.5]; `1234-1234` [1,1,1,1.5]. The `-1.0` is a negative multiplier; the player's queue already treats `CustomMultiplier < 0` as a non-beat (`cards.js` advance).
- `EdgingBeatPatterns` (9 rows, unread by any retained AST): `1-1`; `12-12` [1,1.5]; `1-1-123`; `1-12-1-12`; `12-1-123-1`; `1234-1-1`; `1234567-1-1`; `123-123`; `12-12-12-123456`.
- `EdgingBeatPatterns` needs no player change on this evidence.

## Still open

- Whether the shared player's meter/`cum` semantics correspond to `HasCame?` or `IsAllowedToCum?`; whether a bank swap there would be a faithful change or a different mechanic.
- Confirm the float32 values and the build identity (see above) before a fixture is written; the JSON rows are decimals.
- Whether `BeatSpawnerManagerCPP` (native) reads `EdgingBeatPatterns`.
