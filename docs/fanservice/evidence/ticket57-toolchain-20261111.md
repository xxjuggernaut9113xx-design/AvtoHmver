# #57 Android toolchain — provisioning and build attempt, 2026-11-11

Work area 4 of the close-the-tickets push. Branch `spec/avtohmver-open-tickets`,
HEAD `4eaaf44` at start (clean tree). This note records what was provisioned,
built and tested, and what is still blocked. Nothing was pushed.

## Verdict: #57 is NOT met

- Same-signature release upgrade: **not demonstrated, and not demonstrable
  from this checkout** — no release keystore exists anywhere (searched repo
  and home for `*.jks` / `*.keystore`, none found), and the release build
  type had no `signingConfig` until the scaffold below. A debug APK cannot
  prove a same-signature release upgrade.
- Emulator verification of the upgrade / gameplay / migration: **not done** —
  no emulator can boot in this VM (x86_64 needs KVM, which the host does
  not expose; arm64 is refused by the emulator on an x86_64 host;
  no binder/ashmem for Waydroid/Anbox). The manually built debug APK
  (§3) is ready to install wherever an emulator or device exists.
- Kill-mid-migration and low-storage-migration runs: **not done** — no
  running emulator yet. The migration code paths were re-read (see §5);
  nothing in them was changed.

## 1. Toolchain provisioned in this VM (all outside the repo)

- JDK: Eclipse Temurin 17.0.21+9 (`~/android/jdk-17.0.21+9`, from
  api.adoptium.net) and Temurin 21.0.13 (`~/android/jdk-21.0.13+9`; the
  Capacitor library targets Java 21). `apt` was NOT usable for this: the
  dpkg frontend lock was held by a VM-level os-intent replay process, so
  the JDKs were fetched as tarballs instead.
- Android SDK `~/android/sdk`, assembled by hand because `sdkmanager`
  cannot run here (see §2). Packages, all SHA-1 verified against
  `repository2-1.xml` / `sys-img2-1.xml`:
  - commandlinetools 11076708 (from dl.google.com)
  - platform-tools r37.0.3 — `e1579b288a7ae4e9bc28dedec6a154d78b3c04ed`
  - platform-36 r02 — `2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576`
  - build-tools 36.0.0 — `b0b6376977657e8ad9b969bacf4093601da2c6fb`
    (its zip's top dir is literally `android-16`; installed as
    `build-tools/36.0.0`)
  - emulator 37.3.9 — `5c3eeebb678f7f94a45a0b963409d8e875d1962d`
  - system image `system-images;android-35;google_apis;x86_64` r09 —
    `0103e6dab21290c4b9d16550a3ce99476f884eef` (1,738,815,903 bytes)
  - system image `system-images;android-35;google_apis;arm64-v8a` r09 —
    `16f5bceca236b2737008977c4aaf826e46a8de7d` (1,778,933,980 bytes,
    downloading at time of writing)
  - Gradle 8.14.3 (bin distribution, services.gradle.org)
  - `package.xml` files for `emulator` and the system image were written
    by hand (sdkmanager normally generates them); the emulator zip ships
    none. License files `android-sdk-license` /
    `android-sdk-preview-license` written with the standard hashes.
- `npm ci` in `mobile/` (98 packages) and `npm run sync` (prepare-web +
  cap sync) work; `mobile/www/` (4.0 MB) and
  `android/app/src/main/assets/public/` are generated and gitignored.
  `git status` is clean apart from the two committed changes below.
- Env notes that bit: `$HOME` flips between `/home/hatch` and `/root`
  across exec calls (Java `user.home` is `/root`), so `GRADLE_USER_HOME`,
  `ANDROID_USER_HOME` and `ANDROID_AVD_HOME` must be pinned explicitly
  (see `/tmp/android-env.sh`, not committed). The AVD lives in
  `/home/hatch/.android/avd` (the 150 GB disk); `/root` is a 7.5 GB
  overlay and the emulator refused to create userdata there
  ("need 7372.80 MB, available 2633.81 MB").

## 2. Gradle cannot run in this VM — sandbox blocks JVM loopback TCP

Every `gradle assembleDebug` fails identically (10 attempts, heap
512 MB–1536 MB, `--no-daemon`, `--info`, `--debug`):

```
FAILURE: Build failed with an exception.
* What went wrong:
Could not receive a message from the daemon.
```

Root cause, proven with `--debug` plus a minimal reproducer:

- Client log: `TcpOutgoingConnector: Connected to address /127.0.0.1:35097`,
  `Dispatching request Build{...}`, then 14 ms later
  `Problem receiving message to the daemon. Performing 'on failure' operation...`
- The daemon log shows it started and listened, but never logged accepting
  the connection or the build; 10 s later it stops itself ("no longer
  found in the daemon registry") after the client removed it.
- Minimal reproducer (`/tmp/jvmtest/EchoServer.java` / `EchoClient.java`):
  a JVM client connecting to a JVM server on `127.0.0.1` receives the
  sandbox denial instead of the server's bytes:
  `muse: Other TCP connections is turned off for this assistant. To allow
  it, ask the user to open Muse settings -> Permissions -> Direct network
  protocols and switch other_tcp from Deny to Ask.`
  The identical Python→Python loopback test succeeds (`b'hello'`).
  So JVM-originated raw TCP is intercepted; Gradle's daemon protocol is
  raw TCP on localhost, so no Gradle build can run here. This is a
  policy gate, not something to work around by stealth: the fix is to
  enable `other_tcp` (Ask) in Muse settings, or run Gradle on a machine
  without this restriction.
- Side notes: `sdkmanager` fails the same way at the proxy CONNECT stage
  (`java.util.NoSuchElementException` in
  `HttpURLConnection.doTunneling0` against the egress proxy), which is
  why the SDK was assembled by direct curl downloads instead. Memory is
  NOT the cause: a JVM allocating 2,000 MB RSS survived fine
  (`/tmp/jvmtest/Alloc.java`); a bare JVM child survives; only the
  daemon handshake fails. `gradle --foreground` only starts an idle
  daemon (it waits for a client that never connects) — it does not run
  the build. `swapon` is not permitted in this container, so no swap
  could be added.

## 3. Manual APK build (no Gradle) — SUCCEEDED

Because Gradle is blocked, the APK was assembled with the SDK tools
directly (`~/android/manual-build/build_apk.py`, kept outside the repo;
`~/android/manual-build/resolve_deps.py` resolved the dependency tree):

- 50 artifacts resolved from Google Maven + Maven Central (POM walk):
  appcompat 1.7.1, core 1.17.0, activity 1.11.0, fragment 1.8.9,
  coordinatorlayout 1.3.0, webkit 1.14.0, core-splashscreen 1.2.0,
  cordova framework 14.0.1, plus transitives.
- aapt2 compile (25 resource dirs) + link with a hand-merged manifest
  (app manifest + `androidx.startup.InitializationProvider` with the
  EmojiCompat / ProcessLifecycle / ProfileInstaller initializers +
  ProfileInstallReceiver; `${applicationId}` → `org.fanservice.viewer`).
  One conflict fixed per AGP semantics: the app's
  `AppTheme.NoActionBar` (DayNight parent) overrides Capacitor's copy,
  so the library copy is dropped at compile time.
- javac (JDK 21, `--release 17`) over the Capacitor library sources
  (67 Java files, 0 Kotlin) + app sources + generated R.java.
  Fixes applied: `native-bridge.js` (Capacitor lib asset) merged into
  the APK — without it the injected bridge is empty; `capacitor.js`
  itself is absent (as in the prior successful builds — the bridge is
  injected natively, the 404 is harmless).
- D8: `--min-api 24` auto-splits multidex (`classes.dex` +
  `classes2.dex`; 78,702 fields > 64K). Notes: D8 rejects a bare
  classes directory (jar it first); R8 8.10 rejects `--main-dex-list`
  for class-file inputs ("deprecated", issue 181858113) and has no
  `--multi-dex` flag; stale kotlin-stdlib-jdk7/jdk8 1.6.21 jars duplicate
  classes already in kotlin-stdlib 1.8.22 and must be excluded from D8.
- zipalign + apksigner with a FRESH LOCAL DEBUG keystore generated by
  keytool (`work/debug.keystore`, android/android). **This is a debug
  key, not the release key, and must never be presented as one.**

Result: `~/android/manual-build/work/app-debug.apk`, 6,043,345 bytes,
SHA-256 `4861c1948966d7ed961a97c83cdfae836be3b0834e371ee1daec41a4f01884a3`.
`aapt2 dump badging`: package `org.fanservice.viewer`, versionCode 311,
versionName 0.3.11, minSdk 24, targetSdk 36, label "fanservice Viewer+".
`apksigner verify`: v2 + v3 true. Contents checked: 510 entries,
`classes.dex` + `classes2.dex` (5,547 classes incl. D8 synthetics),
`assets/public/` with index.html, all game JS, `origin-migration.js`,
`origin-migration.html`, `cordova.js`; `assets/native-bridge.js`
present (53,118 bytes). Not yet installed or launched anywhere
(no running emulator/device yet).

## 4. Emulator

- AVD `fanservice35` (Pixel 7, API 35, Google APIs): 1024 MB RAM,
  256 MB heap, 2 GB data partition.
- x86_64 image: **will not boot** — emulator 37.3.9:
  `ERROR: x86_64 emulation currently requires hardware acceleration!`
  No `/dev/kvm`, and the CPU exposes no vmx/svm flags (no nested
  virtualization in this VM). There is no software fallback for x86_64.
- ARM64 image (`arm64-v8a` r09): downloaded and SHA-1 verified
  (`16f5bceca236b2737008977c4aaf826e46a8de7d`, 1,778,933,980 bytes);
  AVD `fanservice35arm` created — but the emulator refuses it too:
  `FATAL: Avd's CPU Architecture 'arm64' is not supported by the QEMU2
  emulator on x86_64 host. System image must match the host architecture.`
  Emulator 37.3.9 on an x86_64 host runs x86_64 images only, and those
  need KVM. **No emulator can boot in this VM.**
- Waydroid/Anbox alternative checked: no `/dev/binder`, no
  `/dev/ashmem`, no binder/ashmem kernel modules, no waydroid/anbox
  binaries. Dead end in this VM.
- `adb` itself works (native binary; the adb server started on tcp:5037).

## 5. Migration code re-read (no changes)

- `mobile/migration/origin-migration.js` + `origin-compatibility.js` +
  `mobile/android/app/src/main/java/org/fanservice/viewer/OriginMigrationPlugin.java`:
  export stages artifacts via the bridge with per-chunk SHA-256;
  import verifies each record; `QuotaExceededError` → fallback message
  + "Retry migration" UI; the native `startup()` converts an
  interrupted export/import phase to `compatibility` with reason
  "The previous migration was interrupted." on next launch, keeping
  prior data (export never touches destination data; import only
  writes after `claimDestination`). The kill-mid-migration and
  low-storage runs that would exercise this are still unexecuted
  (blocked on the emulator).

## 6. Changes committed in this work area

- `mobile/android/app/build.gradle`: release `signingConfig` scaffold
  reading the keystore from environment variables
  (`RELEASE_KEYSTORE_PATH` / `RELEASE_KEYSTORE_PASSWORD` /
  `RELEASE_KEY_ALIAS` / `RELEASE_KEY_PASSWORD`). Unsigned when unset
  (behaviour unchanged); hard error if the path is set but missing.
  No keystore or password is committed. Syntax verified with the
  Groovy parser from the Gradle distribution (PARSE OK); full Gradle
  execution is blocked by §2, so the scaffold still needs a Gradle
  run on an unrestricted machine (or after `other_tcp` is enabled).
- This note.

## 7. Tests run

- `node --test tests/*.test.js`: **364 pass / 0 fail** (after the
  build.gradle change; count includes sibling agents' additions).
- `python3 tests/recover_game_instance_schema_test.py`: **12 pass**.
- The manual APK build itself is the functional check for the
  scaffold-adjacent work: link + javac + D8 + sign all succeed.

## 8. What would unblock #57

1. A release keystore matching the existing release signature, supplied
   by Kevin (where is it? — it is not in the repo, not in home, and no
   `signingConfig`/`storeFile` reference exists anywhere in the repo;
   the prior builds were debug-only, signer cert SHA-256
   `60b891b9…c7ac`, which is a debug keystore cert). With it, set the
   four `RELEASE_*` env vars and run `assembleRelease` on a machine
   where Gradle runs.
2. Gradle runnable: enable Muse `other_tcp` (Settings → Permissions →
   Direct network protocols → Ask) so the daemon handshake works, or
   build on an unrestricted machine. (The manual build in §3 is a
   valid substitute for producing a debug APK, but it is not a
   substitute for a Gradle release build.)
3. A booting emulator (needs a host with KVM for the x86_64 image, or an
   ARM host for the arm64 image) or a physical device, for:
   `adb install -r` upgrade over existing data, preserved
   profile/settings/media/snapshots/pins, kill-mid-migration and
   low-storage-migration runs showing a usable prior state + retry.
   The APK to install is `~/android/manual-build/work/app-debug.apk`
   (SHA-256 `4861c194…84a3`, debug-signed — see §3); a same-signature
   release upgrade still needs item 1 first.
