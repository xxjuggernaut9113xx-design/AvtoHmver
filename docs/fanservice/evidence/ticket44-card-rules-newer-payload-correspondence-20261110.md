# #44 card-rules.json vs the newer-build class defaults (static, 2026-11-10)

Source: reJOIce commit `1a18e9a8ccd97fbfb0cc785f6f3d2e025ad86cff`,
`Analysis/ReferenceBuilds/newer-20261017/blueprint-class-defaults.json`, `defaults[0]`
(class `BP_GlobalManager_C`, payload SHA-256
`2e54a9da90cdc07f94e30c45953587f94bef5f98d1d5733c616023f615caf3b7`,
`byte_identical_roundtrip: true`), compared against
`static/fanservice/data/card-rules.json` in this repo. No original game was run
and no gameplay behaviour changed. This closes the build-correspondence gap
flagged in `ticket44-pattern-bank-reachability-20261110.md`.

## Verdict: MATCH

All 49 bank rows match the newer payload float32-exact (bit-identical after
IEEE-754 single-precision conversion), in order, with matching row counts and
row lengths:

| Bank (defaults field -> `patterns.*`) | Rows | Result |
| --- | --- | --- |
| SlowBeatPatterns -> slow | 8 | 8/8 exact |
| MediumBeatPatterns -> medium | 9 | 9/9 exact |
| FastBeatPatterns -> fast | 14 | 14/14 exact |
| SuccubusBeatPatterns -> succubus | 10 | 10/10 exact |
| FrenzyBeatPatterns -> frenzy | 3 | 3/3 exact |
| CumBeatPatterns -> cum | 5 | 5/5 exact |
| **Total** | **49** | **49/49 exact, 0 mismatches** |

Pattern names agree too (e.g. Cum: `1-1`, `1-1-1-1-123456`, `1-1-12345`,
`123456789-rest`, `1234-1234`).

- `travel` 1.75 matches defaults field `Beat Travel Time` = 1.75 (float32-equal).
- `minimum_intervals[0]` 0.28 matches defaults field `LowestBeatIntervalClamp`
  = 0.28 (float32-equal).
- `minimum_intervals[1]` 0.18 and `[2]` 0.14 are **not in the defaults**: no
  numeric field in any `defaults[]` entry of `blueprint-class-defaults.json`
  equals 0.18 or 0.14. (The literals 0.18/0.14 do occur in the retained
  ubergraph as `SpawnCustomCardEvent` interval arguments, e.g. statements
  2006/2128 — that is not a class-default clamp field, and no origin for the
  0.18/0.14 entries is asserted here.)

## What the old metadata actually referred to

- `build: v004-exclusive-c645757d` was the v0.04 build id; `c645757d` is the
  first 8 hex characters of the v004 executable SHA-256
  `c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f`
  (recorded in `mod/compatibility.json`).
- `defaults_sha256: 05d48496e9dda9c1e8d556eca52fc039c74d768b9773e6648863001b8985b228`
  matches **no payload available in this VM**. Checked and excluded: the
  newer payload hash `2e54a9da...`; the SHA-256 of `card-rules.json` itself
  (LF `54114f36...`, CRLF `c79f4470...`, pre-cum version `4fc26316...`); the
  SHA-256 of `blueprint-class-defaults.json` (`fbd266ed...`) and canonical-JSON
  hashes of `defaults[0]` (`386c1872...`), `defaults[0].values`
  (`ef1564bd...`), and all `defaults` (`efaecc65...`). The string occurs
  nowhere else in this repo or in reJOIce (full-repo greps). Its input is
  unknown; the most likely hypothesis is a hash of a v004-era defaults
  payload/serialization from the file's Oct 27 authoring, whose source dump
  (`C:/Users/webma/analysis/cockhero-v004`) is not in this VM and cannot be
  verified here.

## Correction applied

`card-rules.json` `source` now records the dump the banks were verified
against — `build: v0051-hotfix-public-a8f46896` (the newer-20261017 reference
build; its executable SHA-256 `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`
is in that build's `reference-inventory.json` and in `mod/compatibility.json`)
and `defaults_sha256: 2e54a9da90cdc07f94e30c45953587f94bef5f98d1d5733c616023f615caf3b7`.
No test pinned the old values (no test or player code reads `cardRules.source`
at all) and the fields are purely informational metadata, so the correction is
metadata-only; no bank row, travel, interval, or gameplay value changed.
Pinned by `tests/fanservice_cards.test.js`:
`card-rules source records the verified newer-build defaults payload`.

## Caveat (not established)

The banks are identical to the newer (v0051) payload. That does **not** prove
the v004 banks differed: the v004 defaults dump is not in this VM, so whether
the banks were already identical in v004 is unestablished. The corrected
`source` records the dump the banks were verified against, not a claim that
v004 differed.

## Still open

- Origin of `minimum_intervals` 0.18 / 0.14 (not class-default fields).
- Whether the v004 banks matched these rows too (needs the v004 defaults dump).
