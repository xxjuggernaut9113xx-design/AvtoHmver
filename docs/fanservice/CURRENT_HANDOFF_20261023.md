# Current delivery — October 23, 2026

The full consolidated plan is not complete. This checkpoint finishes the saved
pack transfer path and refreshes available Android, Server and editable-source
deliverables. No entitled Cockhero v0.05.1 installation is available; the native
mod supported-build registry must remain empty until original-game acceptance.

## Saved pack transfer

The top-level Saved pack transfer section uses an unrestricted Files picker,
separate from the image/video picker. It accepts actual ZIP contents regardless
of whether Safari names the file .chpack or .chpack.zip. Import validates central
and local ZIP headers, paths, compression, CRC-32, manifest metadata and referenced
media before saving. Stored and deflated ZIP entries are supported. Limits are
512 MiB per archive/expanded payload, 256 MiB per entry and 500 media per imported
mobile pack. Password-protected, multipart and ZIP64 archives are unsupported.
Imported custom packs preserve their name, description and UP price, and remain
disabled until enabled in Unlocks. A priced pack must be purchased with local UP.
Failed profile creation removes media staged by that import. No phone media is
uploaded. Selected original covers are not restored as custom-pack covers by this
mobile importer; the generated cover is used.

Browser and Home Screen storage remain separate. Export a pack from one and
import it into the other. HTTP port 8000 and private HTTPS are separate origins.
Keep existing app storage and archive backups; no automatic migration is claimed.

The private HTTPS site is https://bougoisie.tail16554f.ts.net/fanservice/.
Tailscale Serve handles static files persistently; Python is unnecessary. Server
API 404 responses at this static site are expected. Local media remains usable;
full Server browsing/music/sync needs a running configured backend.

## Evidence

The user's physical-iPhone screenshots show two imported local packs (8 and 11
members), enablement and session playback with an advancing video clock. This
closes those specific checks. Cloud-only iCloud imports, standalone offline
restart at the new origin, eviction, revoked access and storage exhaustion remain
unverified on physical iPhone. No native iPhone companion is required by current
evidence.

76 shared tests pass, including archive round trips, corruption rejection,
conflicting ZIP headers and deflated import. HTTPS browser acceptance confirms
archive selection, exact local video bytes, enablement and offline reload; a
separate actual playback check advances a 3470-byte synthetic video offline.
63 assets/licenses and five mod compatibility/packaging tests pass. The Android
workflow now runs all shared fanservice unit tests before building.

## Reproducible Android build

From mobile, install the locked dependencies with npm ci and run npm run sync.
Use a configured Android SDK and JDK, then android/gradlew -p android assembleDebug
--no-daemon --max-workers=2. Version 0.3.8 (308) includes the current importer.
The locally signed test APK verifies with APK Signature Scheme v2, RSA-2048,
certificate SHA-256 60b891b9af05e07549b69fd7f1f114774366a86e338555b869f68f6a3b40c7ac.
It retains the existing test application identity so upgrade preserves app data.

## Remaining work

Full native event/card/edge/Succubus timelines and all mobile parity requirements
still need source-grounded implementation and end-to-end corroboration. Current
tests verify the implemented subset; they are not proof of complete parity.
Native v0.05.1 import/return, Unlocks/UP/save lifecycle, archive importer parity,
original gameplay regression, mod/Host install and clean removal remain blocked
on the original-game acceptance environment. Physical Android providers and
physical phone storage failure scenarios remain separate acceptance gates.
Do not publish a supported Windows mod/Host release from reconstruction evidence.

Artifacts are staged under D:/reJOIce/Deliverables/fanservice-current-20261023/.
Installer lifecycle and Android runtime reports in that directory determine their
observed acceptance status; a successful build alone is insufficient.

Final checkpoint: Android 0.3.8 native runtime acceptance and v2 signature checks
passed. Server installer install, upgrade and removal each verified 212 owned
files while preserving all five synthetic save/library/config sentinels; 120
packaged static files matched source. The cached Server test binary passed 331
tests with six opt-in tests ignored. No Rust code changed in that final checkpoint.
APK SHA-256: f605f6aae5e78c30c9fe4b92603aa878ff879ae80e73121f07f14023901ed13f.
Installer SHA-256: 8fb8cd3da34511c1c582f36404e06916f9c4abb1de1070de950923c52937e350.
Portable Server SHA-256: cb98e8c81e7ba0f28f39ae3d3c94251f5cbff0edc954de2dcc4b7561a207024a.
