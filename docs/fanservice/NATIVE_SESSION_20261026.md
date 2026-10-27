# Original native-session continuation — October 26, 2026

The full plan remains unfinished. Purchases and enable/disable remain in original Unlocks. Public-release entitlement checks remain unchanged. `supported_builds` is empty and `shipping_ready` is false.

## Native evidence

Computer Use access was restored. Original menu navigation, normal session startup, synthetic color-bar media and returning to the original menu were observed in the isolated v0.04 profile. The human handled age confirmation. The balance was 4 UP across the recorded observations; diagnostics do not grant UP or settle progression.

The original pause overlay did not freeze beat processing: three consecutive samples advanced position 7.444940 → 9.998726 → 12.528505 and CompletedBeats 2 → 3 → 5. This is unchanged native behavior, not a pause fix.

EpicGames membership and authorized SDK source access are now resolved. Exact PDB records establish a 24-byte checked multicast with its InvocationList header at +8. Its stored array elements are **unchecked 16-byte delegates**, with weak object at 0 and FName at 8. The separate 24-byte checked single-delegate type is not the array element. The old SDK wrapper misreads this layout.

The V3 bounded read-only helper passed live validation. It resolved the original manager callback and five manager bindings. Accepted samples found 21, 72, 78 and 86 owned widgets, with 6–7 moving, and zero foreign or unknown widgets. Helper SHA256: `11eb1ab577011b2c8e7fa1b8edda2077e9d97a8e6ff7fb5ffda121e895f1645b`. These results establish ownership inspection, not a working audio-driven gameplay adapter.

The V4 owned-manager factory crashed inside StaticConstructObject_Internal. The game parameter structure is 0xA0 bytes and places SubobjectOverrides at +0x90; the installed SDK wrapper places that field at +0x80. Do not reuse that constructor route. The retained original Lovense shutdown ensure is a separate incident and does not establish the cause of an earlier exit.

V5 instead uses reflected GameplayStatics.SpawnObject with checked parameter metadata and rejects pre-existing managers. Its root leases apply only to fresh owned managers and release only after stopped/empty validation. SHA256: `5741ba3a021e853476aa529eef4821e8eae16c840587d5b8988a74e4e8b010eb`. Its reflected factory passed isolated live acceptance with root acquisition and release.

The bounded owned-clock probe passed live: pause at 0.51644610241055 seconds, resume at 0.51645190268755, exactly one center hit, second future event untouched, owned widget cleanup and root release.

The audio-driven extension also passed live using the fixed neutral local AAC recording. It paused at 0.51083898544312 seconds, resumed at 0.53409992903471, completed exactly one beat and released its root. Final decoder position was 3.5062131881714. Largest sampled difference before correction was 0.031276799738407 seconds; immediately after correction it was 0.00013650208711624 seconds. These samples do not bound every native/UMG tick. Resume acknowledgement is asynchronous; the first test rejected it too early and cleaned up. The corrected test waits in a bounded resume state. Unexpected decoder jumps or unavailable clocks fail and clean up rather than awarding skipped beats.

`native_probe_audio_beat_clock` starts only the fixed owned fixture diagnostic. It takes no caller URL, path, code or game control. The original manager, widgets and progression are not adopted. Original-session seek retirement, tick-order acceptance, buffering/reconnect reconciliation and once-only original session settlement remain required. Portable fixture evidence is retained in `evidence/native-clock-20261026.json`.

Validation: 51 native/MCP top-level tests passed, including 17 rhythm inspection and 20 owned-probe cases. Native C++ contracts passed 37 delegate and 41 root-lease checks. All 19 installer tests passed, including legacy manifest upgrades and atomic shutdown publication under a forced writer/reader race.

## Current Server and mobile acceptance

Fresh Server source passed 343 Rust library tests, with nine ignored. All ten browser checks passed across the retained runs. The mobile smoke test now waits for the asynchronously committed summary before asserting its text and once-only profile reward.

Current artifacts: `D:/reJOIce/Deliverables/fanservice-native-session-20261026/server-current/`.

- Server executable SHA256: `83f2c3a4ba36862120c39bb6e3b31cee2242e8681d220b302edf318a9feea114`.
- Installer SHA256: `0ed70f637ace5452d0d6e4d56f4c2052ec6c95632e4dfa245ad650a3c359d957`.
- ZIP SHA256: `b85758106705729b05aeeb79ffbd878a087b9682c3912e57c3061e019fc5aa97`.

Install, upgrade and uninstall passed with 227 owned files, 126 exact static files and five preserved synthetic data/config/profile/user sentinels. No Server was launched against live user data. The earlier `server/` artifacts contain an older compiled binary and are superseded by `server-current/`. A failed E-drive extraction was retained separately; the final lifecycle passed in the isolated LocalAppData acceptance directory.

Android 0.3.11 retains its preceding emulator upgrade, cold restart and copied-video playback acceptance. The user confirmed physical iPhone HTTPS offline reopen, playback and seeking. Cloud-provider, revocation/eviction and release-signing checks remain separate gaps. These results do not mark the full plan complete.
