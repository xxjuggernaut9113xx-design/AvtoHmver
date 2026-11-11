# Review of untracked evidence before publication (2026-11-10)

Scope: independent consistency review of the Timer, Classic-pattern and Android #57 evidence files against the repository at `483d652` and the exported ticket text. No game, device or emulator was run. This review does not close any ticket.

## Verified

- Hash chain is consistent across files: selected `CockHero.exe` `a8f46896…`, `.utoc` `6B529FC3…`, `BP_GlobalManager.uasset` `b5b2263b…`, bytecode JSON `1F6AFEF3…` (identical in the Timer note, the patterns JSON and the bytecode map) and mapping `ed51d6ce…` (identical to the GameInstance evidence's input mapping).
- `static/fanservice/data/card-rules.json` has 8 Slow, 9 Medium, 14 Fast, 10 Succubus and 3 Frenzy rows, `travel` 1.75 and `minimum_intervals` [0.28, 0.18, 0.14], matching the patterns note.
- `compared_card_rules_sha256` (`4fc26316…`) matches the file only with CRLF line endings, as checked out on Windows. The LF blob stored in git hashes to `5b825198…`. Any hash comparison must name the line-ending form.
- The compact bytecode map is internally consistent: 299 targets, 2,570 statements, 99,921 bytes, every target offset and index in range, offsets and indices monotone, and no offset maps to two statements. Offsets 92333 -> statement 2330 and 56800 -> statement 1367 are present as the Timer note states.
- Timer note claims stay within static control flow; `objectives.js` still has the 300 s default and 10,800 s maximum, which the note correctly says are not established by the asset.

## Not verifiable from the repository

- Pattern names and the float32 equality of each interval vector come from the local CDO capture. The repository rows are unnamed vectors, so only counts, travel and the clamp were rechecked.
- Ubergraph entry offsets 79488 (statement 1947), 73198 (1776) and 66033 (1598) are cited but absent from the compact map, which records direct jump/push targets only. Add them to the map or label them as coming from the local full map.

## Open parity question for #44

The shared player's `cum` pool (`cards.js`, card 6) uses the Fast bank with 1.5 s travel. This matches the original `Spawn100PercentCumMeterOverrideEvent` path. The evidence also records an ordinary `CumEventOverride` path (statement 1776) that uses a separate five-row `CumBeatPatterns` bank at the default 1.75 s travel, and a nine-row `EdgingBeatPatterns` bank. Neither bank is in `card-rules.json`, and the player's Edge pool uses the Medium bank. Which original paths are reachable in normal play, and whether either bank should be used, is unresolved. Do not change the player without that evidence.

## Android #57 files

- Contain only `localhost`/`127.0.0.1` origins, hashes and synthetic markers; no private hostnames or credentials.
- `f9c7a9a2`'s integration limit (Native Connection opens Chrome) is superseded by `164a5743`, which records the connection staying in the app WebView. Neither package contains the latest HUD (`45ace01`).
- None of the three files evidences the criterion for interruption or low storage during migration. Version stays 0.3.11 (code 311) with `versionBumped: false`.
- Line endings differ (two CRLF, one LF); harmless.
