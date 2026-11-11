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

- Ordinary draws in modes 0 and 1, outside music mode, are replaced by `CumEventOverride` while `HasCame?` or `IsAllowedToCum?` holds. That path uses the five-row `CumBeatPatterns` bank at the default 1.75 s travel, not the Fast bank at 1.5 s. The Fast/1.5 s pairing in the shared player's `cum` pool matches `Spawn100PercentCumMeterOverrideEvent` (entry 66033) only.
- The shared `card-rules.json` has no `CumBeatPatterns` rows, so the CDO capture must supply them (names and float32 intervals are not recoverable from the repository; see the evidence review).
- `EdgingBeatPatterns` needs no player change on this evidence.

## Still open

- Whether the shared player's meter/`cum` semantics correspond to `HasCame?` or `IsAllowedToCum?`; whether a bank swap there would be a faithful change or a different mechanic.
- The five CumBeatPatterns interval vectors, from the local CDO capture, before any fixture is written.
- Whether `BeatSpawnerManagerCPP` (native) reads `EdgingBeatPatterns`.
