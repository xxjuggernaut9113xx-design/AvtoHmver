# fanservice — full plan, annotated
**Later scoped work:** [Parts 1, 4 and 5 continuation](PARTS_1_4_5_20261024.md) records the subsequent sync/offline fixes, current Android build and Server package acceptance. Remaining native and full-parity gates below are still open.

**Status snapshot: 2026-10-24 · source commit 3df136fd · not a release certification.**
Chief, the full plan is **not complete**. The largest implementation gap is live Server media entering original-game gameplay. Recovery evidence distinguishes working components, incomplete implementation, external access and unperformed acceptance.
**Legend:** COMPLETE means the stated scope has direct implementation/validation evidence; PARTIAL means a working subset; BLOCKED means a specific failed dependency or unavailable acceptance path; PENDING means work or verification remains. Historical plan wording is retained below, with current annotations inserted after its headings.
**Reading note:** v0.04 is the later user-selected mod development target. Any original v0.05.1 wording below is preserved for traceability, not treated as an unchanged priority. Native purchases/toggles belong in original Unlocks.
---
# fanservice: consolidated implementation and handoff plan

## 1. Product, architecture, and completed foundation

> **PARTIAL — Product foundation exists; the complete product is not released.** Server and shared mobile/PWA are implemented, packaged and exercised. The original-game Windows Viewer is an experimental v0.04 adapter. Combined Windows Host is still pending. The reconstruction remains reference material.
>
> **TARGET CHANGE —** The text below originally names v0.05.1. Later user instructions explicitly selected **v0.04 for mod creation**. Current development target is the exact v004-exclusive-c645757d build. v0.05.1 Public is a separate blocked compatibility target: its Import opens the developer access page, and no entitled v0.05.1 installation is available. This does not block source work on v0.04. Neither build is advertised as fully supported.


Build fanservice around the existing avtoHMVer Server, a mod of original Cockhero for Windows, and a playable mobile frontend.

- **Server:** Full library management, organization, downloads, administration, remote access, and game/media/music services.
- **Windows Viewer:** Original Cockhero with the fanservice mod installed.
- **Windows Host:** Server, full library management, and the mod launcher in one installation, using an existing Cockhero installation.
- **Mobile / Viewer+:** Shared browser/PWA frontend and Android Capacitor APK, with gameplay running locally.

The first Windows target remains **Cockhero v0.05.1**. Keep executable/content hashes, engine version, and displayed game version separate when identifying supported builds.

Preserve original Cockhero gameplay, media, UI, sounds, progression, and saves. Custom gameplay media comes from avtoHMVer through fanservice packs and coexists with original packs.

Keep the active reconstruction at `E:\reJOIce` as a reference for specifications, recovered behavior, fixtures, and existing integration work. Retain completed recovery and presentation assets; discontinue developing it as the standalone Windows product.

**Completed foundation to retain:**

- Versioned Server browsing, live selection resolution, music/beatmap, and profile synchronization services.
- Two-tab Lite frontend, selection review, custom-pack definitions, ownership/enablement model, and browser persistence.
- Phone-local media storage, explicit offline snapshots, and unavailable cross-device member reporting.
- Self-hosted soundtrack streaming, recording identities, beatmap editing/confirmation, and playback-clock handling.
- Mobile gameplay foundation and native-derived golden fixtures.
- Local voice-pack import, playback, captions, and missing-recording reporting.
- `.chpack` export from selection review and saved custom packs.
- Server packaging foundation, Android test APK foundation, and GitHub validation workflows.
- Reconstruction integration sources and runtime evidence, retained as reference rather than proof of original-game mod compatibility.

Preserve all existing uncommitted changes, library data, profiles, saves, and recovery evidence.

## 2. Windows mod and fanservice Lite

### Original-game integration

> **COMPLETE FOR TESTED v0.04 COMPONENTS —** Exact build identification; pinned UE4SS startup; embedded Lite opening and native Back; synthetic custom pack discovery in native Unlocks; native UP reads; free/priced purchase, insufficient-funds handling, enable/disable and ownership after restart; local image/video pack gameplay. The original access checks and Unlocks controls remain.
>
> **PARTIAL —** The active profile can be read (PlayerSave, user index 0); menu/store/profile changes revoke the browser bridge. This is not a durable versioned companion store or profile synchronization. Isolated saves were backed up before fixture mutations.
>
> **BLOCKING IMPLEMENTATION —** Live definitions do not yet flow from embedded Pack drafts into native gameplay. GetAllEnabledMedia diagnostic hook did not execute; a separate scratch-array append failed verification. Both experiments were removed from repository source. Need a reliable native media-entry lifetime/array insertion path, profile-bound definition store, session integration, soundtrack transport and full regression/removal acceptance. See [native MCP evidence](../../mod/evidence/v004-runtime-mcp.md).


Implement an isolated mod with build-specific adapters for:

- Opening and closing the Lite import interface.
- Registering custom packs in the original catalog and Unlocks screen.
- Reading native UP, purchasing packs, and persisting ownership/enablement.
- Supplying resolved media to native gameplay pools.
- Connecting soundtrack playback and rhythm timing.
- Binding companion data to the active original-game profile.

Keep the original game’s access checks intact. Use a versioned companion profile store for fanservice definitions and synchronization metadata, while native progression and UP remain authoritative.

Back up affected saves before the first migration. Preserve unknown fields, original pack identifiers, existing ownership, and original enabled-pack choices. Do not migrate v0.04 saves into v0.05.1.

Establish support through an isolated test installation before adding a build to the supported registry. Installation and removal must preserve the original game files and user data.

### Lite import interface

> **COMPLETE IN SHARED UI / TESTED v0.04 EMBEDDING —** Library and Organization remain the two main tabs; browse, preview, search/filter/sort, selection retention/review, pack drafts and export exist. Management and automation stay in full Server. Native WebView attachment and Back work in the isolated v0.04 game.
>
> **PARTIAL —** Browser behavior and native attachment are established separately. Production Server connectivity, authorization expiry and all media cases within the actual game still need end-to-end acceptance. Embedded Lite currently creates **Pack drafts**; it is not a completed live native-pack registration interface.


Replace the existing import workflow with exactly two main tabs:

**Library**

- Browse Server images and videos.
- Show thumbnails, previews, existing tags/ratings, search, sorting, and filters.
- Retain selections while changing views.
- Provide selection review, **Create Pack**, and **Export .chpack**.

**Organization**

- Browse existing source/group hierarchy and tag organization.
- Select collections or use them to filter Library.
- Display organization without editing it.

Keep connection setup and media-access controls within this workflow. Downloads, discovery, provider searches, automatic classification, scanning, scheduling, administration, and metadata editing remain in full fanservice.

Reuse the existing Lite frontend through the original game’s embedded WebView where supported. Match new controls to Cockhero’s presentation without replacing its other screens or assets.

### Create Pack and Unlocks

> **COMPLETE IN BROWSER/MOBILE —** Definition creation, name/description/default cover, immediate/priced packs, ownership/enablement, editing/export/deletion and local persistence. Synthetic native archive packs have passed native price/ownership/restart checks.
>
> **CURRENT USER REQUIREMENT —** Normal Windows purchases and Enable/Disable remain in **original Unlocks**. The duplicate Game packs panel was removed, and the user confirmed the current UI. Embedded Lite has no second UP wallet.
>
> **PARTIAL / IN THE WAY —** Saving a live draft does not yet register a live native catalog entry. Need stable custom:-to-native identity mapping, covers/count/status updates, validation before purchase, and rename/rule-refresh/delete lifecycle acceptance without recharge, lost ownership or deleted library media. Local archive bridge identity/cache handling is implemented, but does not close live-pack lifecycle.


Create Pack accepts:

- Name and optional description.
- A selected cover or generated default.
- **Available immediately**, or **Unlock with UP** with a positive whole-number price.

Saving creates a custom entry in Unlocks without copying Server media or changing library organization.

Custom entries display cover, description, current counts, availability, ownership, and enabled state alongside original packs.

- Immediate packs belong to the creating profile.
- Priced packs use native UP and purchase behavior.
- Purchases charge once and survive restart.
- Refreshing live contents never charges again or revokes ownership.
- Renaming or editing rules preserves identity and ownership.
- Deleting a custom pack never deletes library media.
- Empty or unavailable custom content receives an explicit status.

Use separate custom identifiers, preserving the existing `custom:` namespace.

## 3. Media membership, interfaces, export, and music

### Live membership and persistence

> **IMPLEMENTED AND TESTED IN SHARED/SERVER PATH —** Explicit members plus live rules, deduplicated resolution, frozen session membership, stable library/media identity and device-local references. Existing protocol limits remain the contract.
>
> **NATIVE GAP —** Resolved Server membership is not yet inserted into the original game's seven pools. Need to map effective tags into Slow/Medium/Fast/Succubus/Cum/Ass/Boobs, validate playable content, freeze one session generation, reject stale replies and handle empty/unavailable content without fallback. The native local-file validator also means URL-based saved favorites require explicit treatment. Native add/remove-during-play and rule-edit/restart tests remain open.


Retain the existing selection model:

- Explicit media identities remain individual members.
- Source/group/tag/filter selections become live rules.
- Combine explicit members and rules as a deduplicated union.
- Resolve when viewing a pack and preparing a session.
- Freeze resolved membership for the active session.
- Introduce no background scanner through live membership.

Map effective metadata into Slow, Medium, Fast, Succubus, Cum, Ass, and Boobs pools. Validate playable selections before enabling sessions or completing purchases. Never silently substitute original media for unavailable custom content.

Keep stable Server/library/media identities. Synchronize portable definitions and supported progression fields; keep phone-local references device-local.

Retain existing protocol limits unless deliberately versioned: 500 explicit Server IDs, 32 live rules, and 10,000 resolved members.

### Public interfaces

> **IMPLEMENTED FOUNDATION —** Versioned capabilities/library identity, browse/resolve, playable media/music, recording/beatmap services, authorized revision-checked profile synchronization and exact-membership export. The original plan records Server test evidence; these services are not waiting to be invented.
>
> **PARTIAL ADAPTER —** Embedded native read-only catalog transport rejects stale menu/profile generations. Packaged-game MCP now reads actual status/catalog/profile, enables only a configured already-owned synthetic fixture and runs a fixed decoder probe. EngineWire separately connects to Unreal Editor; it does not control the packaged game.
>
> **REMAINING —** Adapt production media/music/sync requests to durable native profile/session identity and demonstrate expiry, menu closure, profile replacement and session replacement with real asynchronous responses. MCP diagnostics do not supply that production adapter.


Retain and document the versioned interfaces for:

- Capabilities and stable library identity.
- Library browsing and live selection resolution.
- Playable media and music manifests.
- Recording inspection, beatmap analysis/editing/confirmation.
- Profile synchronization with authorization and revision checks.
- Exact-membership `.chpack` export.

The existing export endpoint is:

`POST /api/fanservice/v1/export/chpack`

It accepts a library identity, frozen media IDs, pack metadata, and an optional selected cover. Viewer access permits this download without granting library-edit permissions.

The original-game bridge must bind requests to the active profile and reject stale asynchronous replies after profile changes, menu closure, or session replacement. Treat the reconstruction bridge as reference code, adapting it to the original runtime.

### `.chpack` export

> **COMPLETE FOR IMPLEMENTED SHARED EXPORT AND v0.04 LOCAL TRANSPORT —** Selection/saved-pack export, exact frozen membership, privacy exclusions, progress/cancellation, browser size limits, local/mixed assembly, ZIP validation and Android native saving/checksum verification exist. The native bridge installs exact archive bytes under tracked owned identities; synthetic image/video packs import and play in v0.04 with native pricing. iPhone grayed-out archive selection was fixed using the separate unrestricted Files picker; user confirmed imports, including an older pack.
>
> **REMAINING COMPATIBILITY —** Full original importer matrix for covers, all supported formats/tags/counts/prices and failures, including intended v0.05.1 if that target is pursued. The mobile saved-pack importer currently uses a generated cover rather than restoring the archive's selected cover. It supports stored/deflated ZIP, not encrypted/multipart/ZIP64, and limits imported packs to 500 media. Physical cloud-provider/full-storage interruption cases remain unverified.


**Implemented; retain and finish original-game compatibility verification.**

Provide export from selection review and saved custom-pack actions.

Each archive contains a fixed snapshot of selected media and compatible manifest metadata:

- Name, author, description, and UP price.
- Cover where selected.
- Image/video counts and media entries.
- Compatible filenames and gameplay-pool tags.

Exclude credentials, Server URLs, live rules, and ownership/purchase history.

Export must:

- Include exactly the resolved selection, deduplicated.
- Report missing files and require correction or explicit exclusion.
- Show progress and allow cancellation.
- Leave definitions, library data, purchases, and live rules unchanged.
- Produce an archive that imports and plays without a Server connection.

Phone-local and mixed exports are assembled on-device without uploading phone files. Retain the current 512 MiB browser export limit and clear size-error handling. Add Android archive saving through device-local APIs, preserving the same privacy behavior.

Verify generated archives against the actual v0.05.1 importer, including cover handling, tags, formats, counts, and pricing.

### Offline snapshots and synchronization

> **IMPLEMENTED / BROWSER-TESTED —** Explicit snapshots, prior-snapshot preservation on failed refresh, durable active-session pins, retired-file cleanup, local-media privacy and supported offline music/beatmap paths. Real IndexedDB cross-tab/reload tests and offline browser playback checks passed. Local-first loading no longer waits for unavailable Server capabilities.
>
> **STORAGE BOUNDARY —** Safari, Home Screen app, old HTTP :8000 and new HTTPS origins can have separate stores. Pack export/import is the implemented transfer path; no automatic merging is claimed. Static HTTPS Tailscale Serve removes the Python requirement but is not the Server API; its API 404 does not imply local-media deletion.
>
> **REMAINING —** Native Windows snapshot/sync integration and physical iPhone offline cold restart at the final origin, eviction/quota/revocation/cloud-provider failures. Do not infer full offline acceptance from foreground playback or emulator tests.


Use explicitly downloaded snapshots for offline play.

- Label saved snapshot contents separately from current live contents.
- Refresh only through an explicit action.
- Preserve the previous snapshot if a replacement download fails.
- Report missing or evicted storage accurately.
- Include eligible music and its matching confirmed beatmap.
- Keep snapshot files and local phone media out of portable profile synchronization.
- Preserve active-session references during snapshot refresh or cleanup.

### Streaming rhythm gameplay

> **IMPLEMENTED IN SHARED MOBILE/BROWSER PATH —** Self-hosted music identities, beatmap analysis/edit/confirm, mismatch checks and playback-position-driven events; browser offline/music tests cover seek/completion paths.
>
> **NATIVE BLOCKER —** Native PlayMediaEntry successfully fetched a fixed localhost H.264 clip: HTTP 200, 64 x 64 texture, 20 decoded frames. This ran on a separate decoder and proves neither visible gameplay nor streaming/seek rhythm behavior. The game's master timeline getters use elapsed platform time rather than actual audio position. Need a real streamed-audio transport with buffering/pause/seek/end state and native event integration while preserving original music. Third-party providers are optional, not a dependency.


Use user-provided music streamed from fanservice Server as the primary supported path.

- Associate each recording with stable identity, duration, beat/control data, and offset.
- Retain beat analysis, editing, confirmation, and recording-mismatch detection.
- Drive rhythm events from actual client playback position.
- Handle buffering, pause/resume, seeking, drift, reconnects, and completion.
- Skip obsolete events after seeks rather than awarding them retroactively.
- Preserve normal original-game music behavior outside the fanservice soundtrack path.

Evaluate third-party music integrations only where playback permissions and timing capabilities permit them. Self-hosted music must remain independent of third-party approval.

## 4. Mobile, presentation, and distribution

### Mobile gameplay and local media

> **IMPLEMENTED SUBSET —** Shared PWA and Android shell; Classic/Tower flow, inventory/items, modifiers, objectives, challenges, progression/economy helpers, persistent session state and idempotent reward settlement. Source-derived fixtures and browser/emulator scenarios verify specific behavior.
>
> **PARITY STILL PARTIAL —** Complete native event/card/edge/Succubus timelines, every item/modifier/challenge interaction and whole-session outcomes are not fully corroborated. Some prerequisite-dependent behavior fails explicitly rather than inventing rules. Need source-grounded runtime metrics and full session/reload/reward evidence for each required mode.
>
> **DEVICE PASSES —** Android WHPX and host-GPU workaround work; native archive picker/save/cancel/cleanup and local-video restart/refresh checks passed on the emulator. User's iPhone evidence shows local packs (8 and 11 members), enabled packs and advancing playback. User also reported Hidden media selection and Safari reopen/seek behavior at the earlier origin.
>
> **DEVICE GAPS —** Physical Android provider behavior; iCloud-only Files/Drive/Photos acquisition, Hidden-library edge cases, true offline cold restart at final HTTPS origin, revoked access, quota/exhaustion and eviction. A native iPhone companion is not currently required by evidence. These are remaining physical checks, not a blanket claim that iPhone playback is broken.


Retain the shared PWA frontend and Android Capacitor shell.

Complete remaining gameplay parity, including Tower flow, inventory/loadouts, items, modifiers, objectives, challenges, upgrades, progression, and reward settlement. Use shared specifications and golden fixtures rather than independently inventing mobile rules.

Support:

- Server media.
- Explicitly selected phone-local files.
- Downloaded offline snapshots.
- The same Lite pack creation and export workflow.
- Profile switching and portable synchronization.

Test actual iPhone Files, iCloud Drive, iCloud Photos, and Hidden Photos, including cloud-only media, playback, seeking, restart, and offline persistence.

**If Hidden Photos requires a native iPhone companion, report the evidence and leave that feature for the user to decide. Do not make a companion an automatic dependency.**

Report revoked access, storage exhaustion, browser eviction, and cross-device unavailability. Do not upload phone-selected media as a fallback.

### Presentation

> **IMPLEMENTED / ASSET CHECKS PASSED —** Kenney UI/sounds, attributed Game-icons assets, fonts/vector branding, procedural/code-drawn presentation, importable local voices/captions and explicit missing-recording reporting. Prior asset/license validation covered 63 checks. No commissioning or paid-service approval is a dependency.
>
> **REMAINING —** Full physical-device visual/accessibility review and complete native original-presentation regression. Existing asset checks and mobile screenshots do not establish every screen/scale/input case.


On Windows, retain original Cockhero presentation. New Lite controls should fit the original interface.

For mobile and fanservice-owned surfaces:

- Retain Kenney UI Pack and Interface Sounds.
- Retain Game-icons.net icons with individual-author attribution.
- Retain licensed fonts, original vector branding, procedural backgrounds, and code-drawn meters/overlays.
- Preserve voice routing and captions with importable user-provided voice packs.
- Identify missing voice recordings explicitly.
- Keep commissioning, purchases, and paid-service approvals out of implementation dependencies.

### Packaging and GitHub workflows

> **DELIVERED TEST ARTIFACTS —** Editable source/build instructions; Server portable ZIP and NSIS installer; mobile web/PWA; Android 0.3.8 locally debug-signed APK. Isolated Server install/upgrade/removal checked 212 owned files and preserved five synthetic data sentinels. Android signature and emulator acceptance passed for that checkpoint. These are dated artifacts, not proof that every later source change has been rebuilt into them.
>
> **PARTIAL WINDOWS MOD PACKAGING —** Exact-build archive bridge, experimental embedded-runtime installer and ownership/integrity/update/remove tests exist. Separate file-lifecycle acceptance preserved build files/sentinels, but did not execute the game after install/removal. Full supported mod package and combined Host installer remain gated by integration and runtime regression. No commercial game is bundled.
>
> **CI / RELEASE GAP —** Workflows cover Server/shared/Android/archive/assets/compatibility; the latest commit adds MCP transport tests. A pushed workflow is not a confirmed green remote run. Need current reproducible artifact rebuilds, checksums, release signing decisions, installed full-session/upgrade/uninstall tests and release documentation. supported_builds remains empty and shipping_ready=false.


Deliver:

- Editable sources and reproducible build instructions.
- Server portable packages and installers.
- Windows mod package and mod installer.
- Windows Host installer using an existing Cockhero installation.
- Mobile web/PWA.
- Locally signed Android APK.

Do not bundle the original commercial game into mod packages.

Retain Server, browser, mobile, Android, archive, dependency, and license checks. Add native mod compatibility and acceptance checks before publishing Windows mod/Host artifacts.

Keep reconstruction automation labelled as reference verification. Preserve the reference packager, while the active product packager rejects reconstructed Viewer inputs.

Installers must track owned files, preserve saves/library data, and remove the mod cleanly. Record checksums, supported game identities, dependency versions, and signing details.

## 5. Execution order and acceptance

### Implementation sequence

> **CURRENT EXECUTION ORDER —**
> 1. Preserve/reconcile: working sources and evidence retained; older handoffs still contain superseded blocker text. This annotation resolves status for the current snapshot.
> 2. Mod foundation: passed for the selected v0.04 component; v0.05.1 remains separate and access-blocked.
> 3. Native lifecycle: archive/native ownership component passed; live definitions, companion persistence and session insertion pending.
> 4. Media/export: local archive gameplay passed; native HTTP decoder passed; full live Server gameplay, remote images, seeking and importer matrix pending.
> 5. Native music/offline/sync: production adapter pending.
> 6. Mobile: substantial playable subset and emulator/iPhone evidence; complete parity and physical failure matrix pending.
> 7. Release: Server/test APK delivered; supported mod/Host and final product acceptance pending.
>
> **CRITICAL PATH —** Reliable native media structs/pool integration → live profile-bound definitions and frozen sessions → actual Server image/video gameplay → native music/offline/sync → full regression/install/removal → supported mod/Host release. Mobile parity and physical checks can progress independently.


1. **Preserve and reconcile:** Retain working changes; reconcile older handoffs and protocol documentation with the current code and this plan.
2. **Original-game mod foundation:** Implement and verify v0.05.1 Import → Lite → return, followed by a synthetic custom entry in native Unlocks.
3. **Native pack lifecycle:** Connect profile-bound UP purchases, ownership, enablement, live membership, session freezing, and restart persistence.
4. **Media and export compatibility:** Verify Server images/videos, gameplay pools, covers, and exported `.chpack` import/playback in the original game.
5. **Music, offline, and synchronization:** Adapt completed services and reference implementations to the original runtime.
6. **Mobile completion:** Finish gameplay parity, Android archive saving, and physical phone/iCloud checks.
7. **Release verification:** Produce reproducible packages and installers, verify install/uninstall and full sessions, and document remaining device or presentation checks.

### Required acceptance scenarios

> **ACCEPTANCE ANNOTATIONS —**
> - Original game with mod and after removal: **partial**; ordinary import/local gameplay observed, full runtime removal/regression not closed.
> - Immediate custom packs enabled/played: **passed for browser/mobile and synthetic native archives**; live native draft registration pending.
> - UP insufficient/success/one charge/restart: **native synthetic checks passed**; live definition edits/refresh identity lifecycle pending.
> - Live additions/removals with frozen session: **shared implementation tested; native pending**.
> - Explicit/rule deduplication: **shared/Server tested; native insertion pending**.
> - Exactly Library/Organization: **implemented; current embedded UI user-verified**.
> - Empty/missing/offline/expired auth/profile change: **partial**, full production native matrix pending.
> - Exact export and offline original import/play: **implemented and v0.04 synthetic pass**, complete compatibility matrix pending.
> - Cancellation/storage failure: **automated and Android subset passed**, physical provider/full-storage coverage pending.
> - Phone-local privacy/cross-device status: **implemented/tested subset**, physical revocation/eviction pending.
> - Snapshots and music offline/explicit refresh: **browser-tested**, native and full physical matrix pending.
> - Rhythm pause/buffering/seek/reconnect/completion: **browser subset**, native actual-audio transport pending.
> - One-time reward settlement/reload: **implemented/tested subset**, whole native-derived parity pending.
> - Mobile matches shared fixtures: **known fixtures pass**, full behavior coverage incomplete.
> - Install/upgrade/removal/unsupported builds preserve data: **Server lifecycle and mod file component passed**, full installed native regression and Host pending.


- Original gameplay, presentation, packs, progression, and saves remain functional with the mod installed and after removal.
- Immediate custom packs can be created, enabled, and played.
- Insufficient UP is rejected; successful purchases charge once and survive restart.
- Live additions/removals affect the next resolution while active sessions stay frozen.
- Explicit items and live rules deduplicate correctly.
- Lite exposes only Library and Organization, without management or automation features.
- Empty rules, missing media, unavailable Servers, expired authorization, and profile changes receive accurate handling.
- Selection and saved-pack exports contain exactly the intended media, preserve compatible metadata, and import/play offline.
- Export cancellation and storage failures leave no falsely completed archive.
- Phone-local media remains private and is reported unavailable on other devices.
- Downloaded snapshots and matching music play offline and refresh explicitly.
- Rhythm events follow playback position through pause, buffering, seeks, reconnects, and completion.
- Complete sessions settle rewards once, persist, and reload correctly.
- Mobile outcomes match the shared gameplay fixtures.
- Clean installation, upgrade, removal, and unsupported-build rejection preserve user data.

### Verification already completed

> **EVIDENCE SCOPE —** Counts in the original text below are historical checkpoint results, not a fresh rerun of the entire product. Current pushed native/MCP checkpoint: **75 tests passed, one platform skip**; this covers transport, native UI ownership boundary, archive, installer and compatibility suites. The latest recorded Server checkpoint reports 331 passed with six ignored opt-in cases; Android 0.3.8 and physical-iPhone checks are recorded separately. Do not add these dated counts into a completion percentage.
>
> **LATEST SOURCE —** master commit 3df136fd, pushed to origin. Runtime MCP is implemented with SDK 1.32.1. Actual native queries/fixture enable/decoder evidence passed; failed array probes were excluded from repository source. The running lab retained the experimental revision at the last checkpoint. Automatic approval review rejected the subsequent combined edit/restart command as “blocked by policy,” without further detail, so deploying/reloading the cleaned revision remains pending. Computer Use separately denied access to CockHero. EngineWire editor connectivity is working but does not remove these native runtime acceptance gaps.


- **331 Server tests passed**, with six existing opt-in tests excluded.
- **17 shared gameplay/export tests passed**, covering 4,200 XP, 256 Tower draft, 216 Tower reward, and 32 media-pool golden cases.
- **Five compatibility/packaging checks passed.**
- Lite, export, mobile offline/music, and voice browser smoke tests passed.
- Clippy, Rust formatting, JavaScript syntax, workflow YAML parsing, and 63 asset/license checks passed.
- Reconstruction automation previously passed 123 tests; those results remain reference evidence.

Keep original-game acceptance, physical-device checks, final installers, current APK delivery, and full mobile parity as explicit remaining deliverables until individually verified.

---

Current evidence: [native MCP](../../mod/evidence/v004-runtime-mcp.md), [original Unlocks](../../mod/evidence/v004-original-unlocks.md), [runtime adapter](../../mod/runtime/README.md), [October 23 delivery](CURRENT_HANDOFF_20261023.md), [local-first/HTTPS](LOCAL_FIRST_20261023.md), [Android native](ANDROID_NATIVE_20261023.md), [continuation/parity limits](CONTINUATION_20261022.md), and [build registry](../../mod/compatibility.json).
