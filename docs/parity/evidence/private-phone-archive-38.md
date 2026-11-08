# Private phone archive acceptance (#38)

Observed 2026-11-07/08 using synthetic fixture images only. Browser and Android
save/reopen/import checks passed. No production media or original AVD was used.

The local-only pack contains one image; the mixed pack contains Server IDs
1, 2, 3 and one phone-local image. Explicit Server ID 1 overlaps a live rule
and occurs once in the resolved selection and archive. Deduplication here means
overlapping selections of the same media ID; distinct IDs with identical bytes
remain separate items.

Both packs preserve their selected cover bytes, name, description, author,
7-UP price, media count, gameplay tags and every media SHA-256 after import.
Browser re-export with all `/api/**` requests blocked reproduces the manifest
and archive-entry hash map exactly. Phone selection and archive assembly made
no mutation/upload requests. The mixed assembly reads its Server media and
phone blobs on the client.

Android uses real DocumentsUI `ACTION_CREATE_DOCUMENT` saving, then the file
input's real document picker to reopen the saved file. The harness verifies
the selected filename/size and a newly created imported pack ID before checking
metadata and media bytes. Native destination reread reports `verified:true`;
ADB-pulled destination bytes independently match the source archive:

- Local-only: 1,656 bytes, SHA-256
  `34c29505053a00a4cd7728ba6bf67f5f6e6c4240e6c3773b330f1e9a51f46888`.
- Mixed: 3,426 bytes, SHA-256
  `e898234cbdba688d5ee6efd95ee29d73e86606b3b4696dd7c7f37a24c0bfcb0c`.
- Synthetic image and selected cover bytes: SHA-256
  `0aad0fc500f42740ba1976ee01e9649164584e12e7ef672ac04bb03f013cc52c`.

Native transport also passed real picker Back cancellation (`AbortError`), a
real cache permission failure (`Cannot stage archive`), retry, cleanup of owned
`.part` files, and exact 600,123-byte four-chunk transport. This large transport
fixture is random bytes, not an importable pack. The cache failure verifies an
actual filesystem failure; it is not evidence of a physically full destination
or a cloud provider failure. Existing six archive-save unit tests pass, including
an exhausted-storage transport failure. Six ZIP tests cover missing media,
cancellation, corruption and URL restrictions. Two size-limit checks reject
an oversized input before reading it and abort a streaming export before
retaining an excessive chunk; all 14 unit tests pass.

## Build and device identity

Installed APK was pulled and hashed; it exactly matches
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`: version 0.3.11,
versionCode 311, 7,261,790 bytes, SHA-256
`feeea0837036a0c39859d8854ff19f6578906f8170aac57b1ee0d68b63e2c038`.
Device: disposable `retry-check`, serial `emulator-5558`, Android 15/API 35,
x86_64, emulator 37.2.12.0. Headless host GPU, Vulkan disabled, WHPX, four cores,
4 GiB RAM, no snapshots or data wiping. Original `fanservice-test` was untouched.

Repository HEAD at validation:
`1987ceb672e83615732b3ca9988a177ad87a32bc`.
Archive-related source files exactly match their embedded APK asset bytes:

- `chpack.js`: `c9a93cd2d21a898bb828e0d96f27403454a79bc72c88c55a5e41963a864042e0`.
- `archive-save.js`: `ef5b63315dbbf950efcdede818cb69960d1105951a9c58e1fef19fa587fe96c3`.
- `portable.js`: `058668d65fc665e6687b91eda026a855afbc993641d0de1818ea5fe7b9d5c448`.
- `export-ui.js`: `337721dd3b054fcbb263e6121e4803c1ea68f80ca13d2b5437c78444354cbb88`.

## Reproduction and retained evidence

Use the synthetic fixture Server containing sample IDs 1–3 and the disposable
emulator with the debug APK open on its import page. The browser harness uses
a new context, leaving other clients' profiles unchanged. Android imports add
synthetic packs to the disposable app; it never clears app data.

```powershell
$env:FANSERVICE_FIXTURE_ORIGIN='http://127.0.0.1:42169'
$env:FANSERVICE_BROWSER_EXECUTABLE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:FANSERVICE_ARCHIVE_OUTPUT='.test-tmp/archive38-runtime'
$env:FANSERVICE_ANDROID_SERIAL='emulator-5558'
$env:FANSERVICE_EXPECTED_ANDROID_VERSION='0.3.11'
node tests/fanservice_private_archive_smoke.cjs
node tests/fanservice_private_archive_android.cjs
node tests/fanservice_archive_native_acceptance.cjs
node --test tests/fanservice_archive_save.test.js tests/fanservice_chpack.test.js tests/fanservice_archive_limits.test.js
```

Machine-readable reports and synthetic archives remain in the ignored
`.test-tmp/archive38-runtime/` directory: `mixed-browser-report.json`,
`android-roundtrip-report.json`, and `native-transport-report.json` (the original
transport run is also retained as `report.json`). Bulky APKs and traces are not
included in tracked evidence. No issue/tracker writes or commits were made.
