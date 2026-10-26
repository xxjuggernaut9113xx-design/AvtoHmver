# Music control evidence — October 25, 2026

## Named backgrounds: implemented presentation behavior

A bounded inventory of the ten supplied sample maps in the isolated lab game
found 3,876 events: 3,597 cycle-media, 177 media-change, 54 background, 28
break-disable and 20 release events. The 54 background values are:

- `normalbeatbackground`: 31.
- `succubusbackground`: 12.
- `successfulcumbackground`: 8.
- `temptationbackground`, `tauntbackground`, `mercybackground`: one each.

The old shared player cast every value to a number to produce a hue, so these
named values produced invalid `NaN` CSS. `background.js` now maps all six names
to distinct procedural gradients and exposes the chosen preset in the player.
These are fanservice presentation choices, not reproductions of original game
background imagery. No original media is copied, fetched or redistributed.
Finite numeric presets retain numeric hue behavior; nonnumeric unknown values
receive an explicitly labeled Normal preset. Large numbers cannot overflow into
invalid CSS. A replay/seek reconciliation can apply the same preset idempotently
without altering the audio clock, playback rate, media selection or progression.

The fixture `tests/fixtures/fanservice/music-control-inventory.json` records the
sample-map hashes and aggregate counts. Four focused helper tests cover every
observed named value, numeric/extreme values, invalid values, and presentation-only
application. A real Chromium check also parsed all six named gradients, the
unknown-value fallback and an extreme finite numeric hue; all produced valid
radial-gradient CSS. Its local report is background-browser.json beside the
full audit JSON. This is neutral-DOM helper validation, not full app or original-
game presentation acceptance. Browser/offline packaging still requires the
helper in the PWA shell.

## speed_change: unresolved control contract

The reconstructed RecoveredBeatmap.cpp recognizes the `speed_change` name, but
that parser is not evidence of its runtime effect. The supplied ten-map inventory
contains zero such events, so it does not supply a payload/unit fixture.

The exact v0.04 executable SHA-256 is
`c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f`;
its matching PDB SHA-256 is
`fa1a7bd6918faf9a273e5b377bda9e36d0e59283441be3a54610d7910cc96dad`.
The retained PDB GUID/age match was confirmed. A fresh bounded search of the
complete PDB public-symbol stream 11 inspected 1,097,286 S_PUB32 symbols. It found
no names containing `Beatmap`, `MusicMode` or `speed_change`. This corrects the
weaker initial search of native-symbol-addresses.tsv, which was generated with a
class allowlist. The exact lowercase `speed_change` literal was also absent from
the executable in ASCII and UTF-16LE. These are bounded negative searches, not
proof that equivalent or differently named behavior cannot exist.

Ten public symbols do mention BeatSpeedChanged, including its native delegate
wrapper and reflected BeatIndex/SpeedMultiplier fields. The retained decompiled
UpdateBeatInterval and beat-queue code concern native pattern timing/media
synchronization. They do not connect that delegate to JSON `speed_change`, establish
its payload units, or justify changing the streamed recording's playbackRate.
The supplied sample maps are a separate lab-tree artifact set; they are not
assumed to be music-mode acceptance for the exact v0.04 build.

Consequently no source-backed speed_change effect is implemented by this finding.
Maps containing this control remain saveable, but playback now fails with an explicit unsupported-control error before audio starts. Its semantics remain an explicit contract gap.
Do not invent an audio-rate change or claim native parity from the event name.
Closing it requires an actual shipped dispatcher/payload specification or a
separately versioned, explicitly specified fanservice extension, plus tests for
seek reconciliation and the relationship to absolute beat times.

Sources read without executing the game: C:/Users/webma/analysis/cockhero-v004/,
the original exact-v0.04 CockHero.exe/PDB, the supplied lab beatmap JSON files,
and the reconstructed RecoveredBeatmap.cpp reference. The full local audit JSON
is D:/reJOIce/Deliverables/fanservice-native-companion-20261025/music-control-evidence.json.
No UI, process control, age confirmation or runtime event injection was performed.
