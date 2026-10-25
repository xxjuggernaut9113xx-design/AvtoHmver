# fanservice Lite protocol v1

The adapter uses the existing Server listener and authorization. Browsing and
resolution are read-only. Export and profile synchronization have narrowly scoped
write-method permissions; neither grants library-edit permission. Original-game
UP and progression remain authoritative for the planned mod adapter.

## Requests

- `GET /api/fanservice/v1/capabilities`: protocol version, stable library instance
  identity, supported and explicitly unsupported capabilities.
- `GET /api/fanservice/v1/library?query=<JSON>&cursor=<cursor>`: existing library
  filters, pages of 60 available downloaded images/videos, sanitized metadata.
- `GET /api/fanservice/v1/resolve?selection=<JSON>`: `{ids:[1],rules:[{source_id:2}]}`.
  Explicit identities and each live rule form a union. Empty selection means no
  media. Maximum 500 explicit identities, 32 rules and 10,000 resolved records.
  Missing files are omitted. Over-limit resolution fails rather than truncating.

JSON query values must be URL encoded. Rules use the existing `MediaQuery`
fields; resolution overrides pagination, random ordering and inclusion controls.
The response contains `library_id` and media records with `id`, display metadata,
relative `url`, `thumbnail`, and effective game tags. It contains no local path.
Clients must match `library_id` before accepting a manifest.

## Profile and lifecycle

The reconstruction reference bridge exposes `ue.fanservice.readprofile()` and
`ue.fanservice.dispatch(JSON.stringify(operation))`; both return JSON strings.
Operations are create, edit, delete, purchase, enable and refresh. Native saves
use `FanserviceGameProfileV1`, actual `UnlockPoints`, `UnlockedPacks` and
`EnabledPacks`. Custom identifiers start with `custom:`. A purchase is idempotent;
editing or refreshing does not debit again. Corrupt/unsupported profile documents
reject edits and playback while retaining their saved content.

The standalone browser stores definitions per Server library identity in local
browser storage. Its fresh profile has zero UP. It is an import prototype, not
an original-game progression authority. The shared mobile frontend now includes
local gameplay and portable synchronization. The reconstruction bridge is not
an adapter for the original v0.05.1 runtime. See `MOD_TRANSITION.md`.

Clients resolve live rules when viewing packs and before starting a session.
The native adapter retains resolved metadata in the profile for display, but
requires a successful resolution before starting live playback. Session rules
consume a detached media list; subsequent library changes affect the next
resolution. Cached metadata is not an offline media snapshot.

## Development verification

Run `cargo test -p avtohmver --lib routes:: --locked` and
`node --test tests/fanservice_packs.test.js`.
The ignored `routes::fanservice::tests::lite_browser_fixture` test serves an
isolated temporary sample library on port 42169 for browser testing. It does not
open or mutate the user's real library. Stop it when finished.

`tests/fanservice_browser_smoke.cjs` exercises the fixture with Playwright. Supply
`FANSERVICE_PLAYWRIGHT_MODULE` if Playwright is outside normal Node module lookup,
`FANSERVICE_BROWSER_EXECUTABLE` for an installed Chromium/Edge executable, and
optionally `FANSERVICE_SMOKE_OUTPUT` for screenshots. The default fixture origin
is loopback port 42169; `FANSERVICE_FIXTURE_ORIGIN` can override it. Run this only
against the isolated fixture, never the real library. Browser contexts are fresh
and temporary. Coverage includes two-tab navigation, retained selection, live
rules, creation, ownership, editing rules without replacing identity, enablement,
reload, insufficient UP, JavaScript errors and narrow-layout overflow.

## Music, portable synchronization, and export

- `GET /api/fanservice/v1/music/{id}` inspects recording identity and duration.
- `POST /api/fanservice/v1/music/{id}/analyze` explicitly analyzes a recording.
- `GET` and `PUT /api/fanservice/v1/music/{id}/beatmap` inspect and edit/confirm
  recording-bound rhythm data. GET returns the editable document, preserving its
  unshifted beat/event times and offset; the playback manifest applies that offset
  once. A replaced recording rejects the stale map without deleting it. Analysis
  and edits require library-write access.
- Beat types are `stroke`, `rest`, and `accent`. An optional control-event value
  must be a string, number, or boolean; strings are limited to 2,000 UTF-16 code
  units. Null, arrays, and objects are rejected before a map can be saved or
  published. This matches the shared and native manifest contracts.
- `GET /api/fanservice/v1/music/{id}/manifest` supplies playable music and its
  matching confirmed beatmap. Client rhythm follows actual playback position.
- `GET` and `PUT /api/fanservice/v1/profiles/{id}` synchronize a portable v1
  document. Both require `x-fanservice-profile-key` containing 64 hexadecimal
  characters. PUT takes `{expected_revision,profile}`; a stale revision fails.
  Phone file references and downloaded snapshots remain device-local. Profile
  responses include `Cache-Control: no-store`, including credential errors.
- `POST /api/fanservice/v1/export/chpack` takes `{library_id,ids,name,author,
  description,unlock_cost,cover_id}`. IDs are a frozen deduplicated selection;
  missing members fail. Viewer access permits export without library edits.
  Output excludes Server URLs, credentials, live rules, and purchase history.

Phone-local and mixed archives are assembled on-device without uploading phone
bytes. Browser downloads and Android native saving retain the 512 MiB limit.
Android uses the registered `ArchiveSave` plugin and system document picker;
the destination is reread and SHA-256 compared before completion is reported.
The user selects the destination; cloud document providers can be offered by
Android. There is no automatic Server upload or fallback.

Offline snapshots, phone-local membership, synchronization, music-clock handling,
and browser export have implementation and automated checks. Remaining acceptance
includes full mobile parity, physical iPhone/Android behavior, and original-game
integration. Files/iCloud/Hidden Photos require physical evidence; no native
iPhone companion dependency has been established.

Private HTTPS setup and the Viewer-only reverse-proxy gateway are described in
[Server deployment](SERVER_DEPLOYMENT.md). Static PWA hosting alone is not API
acceptance.
