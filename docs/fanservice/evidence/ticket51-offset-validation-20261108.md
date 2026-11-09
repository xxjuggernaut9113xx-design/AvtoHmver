# Ticket #51: offset validation

## Result

Both browser smoke fixtures now match the server manifest contract: offset `0.25` is already applied to beat and event timestamps, and `beatmap.meta.offset` is zero. The shifted final rows remain at recording duration `4.0`, so the player must consume server timestamps directly and must not apply the offset twice.

`src/routes/fanservice_music.rs` validates the editable offset and shifts both beats and events in the confirmed manifest. The existing Rust roundtrip test verifies first beat/event times shift from `0.5`/`1.0` to `0.75`/`1.25` with offset `0.25`.

## Validation

- Existing Rust offset roundtrip test binary: 1 passed.
- Music rules and soundtrack tests: 11 passed.
- Timeline and interruption Chrome browser smokes: both passed with the source-correct shifted manifest, synthetic audio, and mocked API.

## Limits

Original build provenance is SHA-256 `a8f46896593d8724cefb9a232db5772df48ae5731da78cfacbec82e98d040c10`. Retained native findings say the original beatmap offset field exists, but only a zero-offset map was verified; nonzero native offset semantics remain untraced. The retained native runtime log verifies a 2.000-second lead-in and natural stop at audio duration, but its run had no events and blank media. Therefore exact original-build event effects and progression remain unresolved; this evidence does not close ticket #51.
