# Android native acceptance checkpoint, 2026-10-23

## Emulator repair confirmed later in this session

Switching the isolated AVD from software graphics to the NVIDIA host GPU with
Vulkan disabled resolved the stored-local Preview crash reproducer. APK 0.3.6
passed 15 successive Preview open/play/close cycles: five initially, five after
force-stopping/reopening the app, and five after a page refresh. All cycles decoded
64 × 64, advanced the video clock and reported verified playback. The saved
3470-byte MP4 retained its source SHA-256 throughout. The emulator remained
connected after all cycles. This is an observed configuration workaround;
the faulting instruction inside the software renderer was not diagnosed.

The isolated AVD config now defaults to host GPU, four cores and 4 GiB RAM.
`E:\fanservice-tools\Start-FanserviceEmulator.ps1` launches it with host GPU,
Vulkan disabled, WHPX, and no snapshots or data wiping. It leaves an existing
emulator on its port alone. Google Search and Messages were disabled only inside
this isolated test AVD to reduce background startup load. Other devices and
Windows graphics drivers were not changed. The prior config is backed up.

Evidence and reusable launcher copy:
`D:\reJOIce\Deliverables\android-emulator-repair-20261023`.
The three JSON reports contain all 15 results and the retained media checksum.
The blocked Preview statements below are historical and superseded by this
repair result. No APK rebuild or package hash change was needed for this fix.

The user separately confirmed mobile-phone Preview playback and refresh
persistence. That is user-reported evidence; iCloud-only files, physical-phone
restart, and secure offline behavior have not been independently verified.

## Later local-media correction: APK 0.3.6

0.3.6 / versionCode 306 supersedes the 0.3.5 APK below. A later reboot check
found the imported video record missing and a zero-byte IndexedDB blob. Import
previously stored the picker-backed File without reading it. Import now reads
and checks every byte, creates an app-owned Blob, and waits for a strict-durability
IndexedDB transaction before reporting success. Copy failures occur before any
records are written. Limits are explicit: 256 MiB per file, 512 MiB per import.

An actual Android Files selection was copied into a non-File Blob with all 3470
bytes and SHA-256 `5a50c5ce9aea537ffdea3b6d7644ec3b0dce76016fc44a4d02aba1986a60a307`,
matching the original synthetic MP4. Browser tests verify detached source reads,
atomic failure on incomplete copies, saved image/video decoding, advancing video
playback, reload persistence, no uploads, and preservation of snapshot pins.

Windows Application events identify two host emulator access violations
(`qemu-system-x86_64-headless.exe`, exception `0xc0000005`) when saved-media Preview
opens. The first restart also produced system-wide Android startup ANRs. A
4 GiB/four-core isolated AVD and disabled Vulkan are being used for the follow-up;
the host crash is not counted as an app playback pass. Original app data has not
been cleared or the AVD wiped.

Latest APK: `D:\reJOIce\Deliverables\android-local-recovery-20261023\fanservice-viewer-plus-0.3.6-debug.apk`.
SHA-256: `68e89e0d3f27936e1eada29bd92a4fac588296773d365fda01410504546b11c4`.

Final follow-up: the copied 3470-byte video survived the emulator host crash and
reboot. Its on-disk SHA-256 still matched, `FanserviceStore.localFiles()` returned
the record in 0.3.6, and its tile reappeared in the app. This establishes copied
local-media retention through that crash/reboot. Preview then crashed the host
emulator again with Vulkan disabled. Saved-media Preview/playback on Android
remains unverified; do not equate retained bytes or the earlier single-Blob
playback pass with this UI acceptance. No further same-path retries were made.

The final 0.3.6 APK signature verifies. Fresh browser export, saved-media playback,
and IndexedDB copying/pinning tests pass after the strict-durability change.
Windows host crash events are retained beside the final APK. Original v0.05.1,
physical iPhone and full gameplay parity acceptance remain open as below.

## Earlier archive acceptance, retained as evidence

WHPX is operational after the user's Windows configuration and reboot. The isolated Android 35 x86_64 AVD booted, and the delivered 0.3.4 APK installed successfully. Actual runtime testing exposed two bugs that mocks did not catch:

1. The injected Capacitor bridge has `Plugins.ArchiveSave` but no `registerPlugin`. `archive-save.js` now prefers the injected plugin. A regression test covers this bridge shape.
2. The system document picker appended `.zip` to `.chpack` when given `application/zip`. The native intent now uses `application/octet-stream`; final runtime output preserves `.chpack`.

The corrected APK is 0.3.5 / versionCode 305. Installation over the previous app preserved a localStorage sentinel. Real native saves staged chunks, opened DocumentsUI, wrote and reread the destination, returned verified byte counts, and removed staging files. The pulled final 500289-byte synthetic ZIP matched source SHA-256 `b5e3145cf5a03ee66172f0336d95dc704210fc5f2a555c1c98895431db02f7b1` and passed Python ZIP integrity verification. Picker Back cancellation returned AbortError and left no owned staging file. Force-stop with a partially staged archive followed by restart cleaned the owned leftover without clearing browser data. Invalid name/size/order guards rejected their actual bridge calls.

Synthetic MP4 Blob playback decoded 64 × 64 and advanced the clock on Android; a background playback attempt was interrupted by Android's power policy, and the foreground retry passed. Android photo picker → Browse → Downloads returned a synthetic video, which the app stored as device-local. The emulator exited during the later saved-media Preview check; the complete stored-local playback/restart sequence remains open pending the restarted emulator.

63 shared fanservice unit tests pass. The browser export smoke passes on the isolated localhost fixture. APK v2 signature verifies with the preexisting debug signing certificate.

Current delivery: `D:\reJOIce\Deliverables\android-native-20261023\fanservice-viewer-plus-0.3.5-debug.apk`.
SHA-256: `4a51a3b3a451b46751999019e704e839a11bd28a25646b5afa4c899bdd3e3da1`.
Detailed report: `D:\reJOIce\Deliverables\android-native-20261023\VALIDATION.md`.

The older 0.3.4 delivery remains preserved but is superseded for Android archive export. Original-game v0.05.1 acceptance, full mobile gameplay parity, physical iPhone playback/Files/iCloud, cloud document providers and full-storage destination handling remain open. No complete-product or store-release acceptance is claimed.
