# Native v0.04 development target

The user explicitly selected the supplied v0.04 Exclusive installation as the
native mod development target. This supersedes the earlier v0.05.1-first choice
for ongoing development, not the recorded v0.05.1 observations.

An isolated copy is at E:/fanservice-mod-lab/v004-native/game. Existing Saved,
Extracted and packs directories and PDBs were excluded from that copy. The original
game and its saves were not modified. Runtime arguments explicitly use
E:/fanservice-mod-lab/v004-native/profile with -NotInstalled, -UserDir and
-SaveToUserDir. Logs and a newly created BP_CHSaveGame.sav appear in that test
profile. No original save was copied or migrated.

REA identifies the copied binary as PE x86_64 with executable SHA-256
c645757d1112491952b67bf29502b4721133ba6940a9cfb08358f0dde127560f.
The log confirms UE 5.3.2-29314046+++UE5+Release-5.3. Displayed game version has
observed on the main menu as V0.04 PATREON BUILD; the distribution label is v0.04 Exclusive.
Executable and three content-container hashes are recorded separately in
mod/compatibility.json. The file-identification checker recognizes this candidate
but must continue to reject it as unsupported for mod installation.

The actual unmodified game reached its age-confirmation screen. The user handled
that screen. Windows computer-use guidance prohibits the agent submitting age
verification. Subsequent normal UI actions reached the main menu and Import.

The first hidden-window startup was stopped and relaunched visibly with the same
isolated profile. No loader or synthetic widget was injected. Runtime logs are
E:/fanservice-mod-lab/v004-native/baseline.log and visible-baseline.log.

Existing recovered CHPackManager code is useful reference: GetAllChpackPaths
searches a packs directory for .chpack archives and LoadManifestFromChpack
extracts and parses manifest.json. The directory base and original-game behavior
were subsequently confirmed on this exact build. No speculative companion
launcher is treated as media-to-game integration.

## Native media acceptance, 2026-10-23

Normal Import opened without modifying access flags. Add Directory selected the
isolated synthetic media folder. The UI showed one image and one video; Save
created the fanservice-native-validation preset. Original gameplay displayed the
synthetic button image and color-bar video. visible-baseline.log records the
input/media paths and PlayMediaEntry completion.

Native discovery uses CockHero/Binaries/Win64/packs/*.chpack. On restart the
unmodified game extracted the exported fanservice-native-validation.chpack into
its adjacent Extracted directory. Native Unlocks displayed its cover, two media
entries, description and free unlock. The ordinary Unlock action produced PACK
UNLOCKED and PACK ENABLED while retaining the five-UP balance.

Starting original Easy gameplay used the extracted native pack image and video.
native-pack.log records PlayMediaEntry for media/0_ass_boobs_cum_fast_medium_slow_succubus.png
and media/1_ass_boobs_cum_fast_medium_slow_succubus.mp4, video auto-fit and completion.
This proves local media delivery into original gameplay. It does not prove live
streaming, embedded Lite, profile synchronization or the complete planned mod.

The native store derives its title from the archive filename stem, rather than
the manifest name. The transport therefore uses a readable fanservice name plus
a unique UUID. It stages exact archive bytes and requires a game restart. The
new v004_pack_bridge.py was run against the isolated identified build to install
two additional synthetic packs priced at two and 999 UP. Native purchase and
restart results are recorded separately when observed.

## Native UP acceptance

The third launch used native-up.log. All three synthetic packs appeared in native
Unlocks. The earlier free pack remained unlocked/enabled after a full process
restart with five UP unchanged. Attempting the 999-UP pack left it locked, showed
red feedback and retained five UP. Buying the two-UP pack produced PACK UNLOCKED,
PACK ENABLED and three UP. These actions used the original store controls with
no save editing, currency grants, entitlement changes or runtime injection.

A fourth clean launch uses native-up-restart.log. Startup loads the existing
BP_CHSaveGame slot (line 920) and confirms the paid pack is unlocked and enabled
(line 955), with two media entries. Thus paid ownership persists across a full
process restart. The remaining three-UP balance was subsequently verified by the
real store's reflected GetUnlockPoints() query on three passes after restart.
See v004-loader-reflection.md for that separate loader/query checkpoint.

## Bridge checks

Six Python transport tests cover exact byte preservation, recognizable filenames,
existing-save retention, repeat imports without overwrites, malformed previews,
unsupported builds, unsafe/missing archive payloads and staging cleanup when the
final atomic install fails. Five existing compatibility tests and eleven shared
archive/export tests also passed. The GUI module compiles and starts as a Windows
process; visual automation could not inspect it because the helper twice reported
an owner mismatch with identical owner strings. The owned GUI test process was
closed. Full GUI interaction acceptance remains pending.

## Automatic embedded catalog acceptance

The isolated runtime-catalog-corrected.log and ue4ss/UE4SS.log record automatic
attachment through ordinary Import. The Game packs panel displayed the native
three-UP balance and three fanservice packs. Disable and Enable changed the
owned two-UP pack through CHPackStoreController. A 999-UP purchase was rejected
and the balance remained three. Positive new purchase through the injected panel
remains a separate acceptance case; earlier purchases used the original UI.

The loader log records bridge revocation at 21:43:56, a second Import attachment
at 21:44:12 and revocation at 21:44:33 on 2026-10-23 local time. The game then
exited cleanly. These observations establish close/reopen behavior, not full
profile switching or live Server streaming acceptance.

The current bridge verifies consumed archives through extracted payload hashes,
refreshes stable owned identities and removes only verified owned caches.
BRIDGE-QUICKSTART.md supersedes earlier archive-only removal instructions.
On 2026-10-24, 26 Python transport tests passed with one platform-dependent skip;
all seven runtime installer tests passed. Eleven JavaScript bridge tests passed
on the preceding validation run.

## Positive embedded-panel purchase, 2026-10-24

The user explicitly reports purchasing native-panel-one through Import → Game
packs, observing three UP become two UP and the pack become Owned. This is
user-observed balance evidence. Independently, native-panel-purchase.log line
1377 records successful native unlock and enablement of
fanservice-native-panel-one-721da5f4-2186-409c-8c09-e9c5ecfde329; lines 1386–1393
confirm unlocked, enabled and two media entries. No save edits or UP grants were
used. This completes the positive purchase case for the embedded catalog bridge.
The purchased pack's persistence through another restart remains a separate
case; earlier paid native UI purchases already passed their restart check.
