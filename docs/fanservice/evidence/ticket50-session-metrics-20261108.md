# Ticket 50 session metric evidence

## Pinned sources

The newer build sources below are from `xxjuggernaut9113xx-design/reJOIce`
commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff` (`newer-20261017`).

| Source | Path | Blob |
| --- | --- | --- |
| Challenge text and requirement rows | `Analysis/ReferenceBuilds/newer-20261017/DT_Challenges.json` | retained as `static/fanservice/data/native-contract.json` |
| Runtime metric compatibility audit | `Analysis/ReferenceBuilds/newer-20261017/PROGRESSION_RUNTIME_COMPATIBILITY.md` | `13667a45b5f7a5bb3dd5fef5143fa9ceedebf546` |
| Runtime metric enum | `Analysis/ReferenceBuilds/newer-20261017/native-reflection-enums.json` | `4d3aa7cf09061465f9e8877c453948a241eade16` |
| Record metric routine | `Analysis/ReferenceBuilds/newer-20261017/native-progression-runtime/0x1483070c0.c` | `6c6d91c029fa0ea6b9b1fc21f69d3658514a5cab` |
| Set metric routine | `Analysis/ReferenceBuilds/newer-20261017/native-progression-runtime/0x148312540.c` | `fd28883f4fb30874bb495a406b14d4d76ccfa057` |
| Update challenge progress routine | `Analysis/ReferenceBuilds/newer-20261017/native-progression-runtime/0x148318270.c` | `91cc1d1bede00eadb0113b4d5f91f0bdc90dcc4c` |

## Metric behavior wired

The native challenge descriptions define `built_different` as winning a
session on Insane difficulty and `public_safety` as winning 10 SuccuSlayer
sessions in Classic mode. The reflected enums identify `SuccuSlayer` as
objective 8. The native compatibility audit assigns metric IDs 41 and 37 to
`SessionsWonAtMaxDifficulty` and `SuccuSlayerSessionsWon` respectively.

The static routines establish generic metric recording and challenge progress,
but they do not expose the native `EndSession` event producers for these two
fields. The exact predicates used here are therefore an authored-description
interpretation mapped to the mobile app's explicit selectors: Insane difficulty
value 2, Classic mode value 0, and SuccuSlayer objective value 8. Both metrics
increment only for a win. Mode, difficulty, and objective are settlement
context and are excluded from the generic numeric lifetime metric ledger.

## Verification

`tests/fanservice_progression.test.js` checks winning and losing outcomes,
non-Insane difficulty, Tower and Soundtrack exclusions, non-SuccuSlayer
objectives, and actual `built_different` and `public_safety` challenge progress.
The focused suite passed 10/10 on 2026-11-08. The [Classic objectives browser
report](../../parity/evidence/classic-objectives-browser.json) also records a
Succu Slayer run selecting Insane through the UI, then settling one win with
both metrics at 1, `built_different` completed, and `public_safety` at 1. The
browser report binds the run to source hashes for the current mobile scripts.
This does not establish direct native runtime observation of the two event
producers.
