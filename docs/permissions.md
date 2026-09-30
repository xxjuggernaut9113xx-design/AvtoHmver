# Permission model

This is Curator's canonical permission policy. Other documentation links here instead of restating role capabilities.

## Roles and read capabilities

Host and Server own a local library and have full authority over it. Viewer is a remote Tailnet client and receives the default capabilities advertised by `/api/system/info`.

| Operation | Host | Server | Viewer default |
|---|---:|---:|---:|
| System handshake | Allow | Allow | Allow |
| Library metadata and thumbnails | Allow | Allow | Allow (`library_read`) |
| Media streaming and native playback | Allow | Allow | Allow (`playback`) |
| Provider catalog and discovery queries | Allow | Allow | Allow (`discovery`) |
| Library, source, tag, rating, settings, download, storage, OOBE, and session mutations | Allow | Allow | Deny |
| Local administration, diagnostics, executable paths, services, and classifier installation | Allow when the edition provides it | Allow when the edition provides it | Deny |

Viewer capabilities are independent booleans. A Host may advertise fewer read capabilities, and Viewer must enforce the negotiated values before sending a request. `library_edit` and `session_control` remain false in the default handshake. HTTP mutation enforcement is based on the actual TCP peer; forwarding headers cannot elevate a remote caller.

## Mutating routes

The following table is generated from `routes::MUTATION_PERMISSIONS`. Tests compare it with the Axum router and exercise every entry as Host, Server, and Viewer. Adding or removing a mutating route without updating this table fails the test suite.

<!-- BEGIN GENERATED MUTATION MATRIX -->
| Method | Route | Host | Server | Viewer |
|---|---|---:|---:|---:|
| DELETE | `/api/groups/{id}` | Allow | Allow | Deny |
| DELETE | `/api/groups/{id}/tags/{tag_id}` | Allow | Allow | Deny |
| DELETE | `/api/media/{id}/tags/{tag_id}` | Allow | Allow | Deny |
| DELETE | `/api/source-tag-rules/{id}` | Allow | Allow | Deny |
| DELETE | `/api/sources/{id}` | Allow | Allow | Deny |
| DELETE | `/api/tags/{id}` | Allow | Allow | Deny |
| PATCH | `/api/goon/beat-maps/{id}` | Allow | Allow | Deny |
| PATCH | `/api/groups/{id}` | Allow | Allow | Deny |
| PATCH | `/api/settings` | Allow | Allow | Deny |
| PATCH | `/api/sources/{id}` | Allow | Allow | Deny |
| PATCH | `/api/sources/{id}/group` | Allow | Allow | Deny |
| POST | `/api/admin/backups` | Allow | Allow | Deny |
| POST | `/api/admin/backups/{id}/restore` | Allow | Allow | Deny |
| POST | `/api/admin/backups/{id}/validate` | Allow | Allow | Deny |
| POST | `/api/admin/jobs` | Allow | Allow | Deny |
| POST | `/api/admin/phar` | Allow | Allow | Deny |
| POST | `/api/admin/phar/cancel` | Allow | Allow | Deny |
| POST | `/api/admin/phar/install` | Allow | Allow | Deny |
| POST | `/api/admin/phar/repair` | Allow | Allow | Deny |
| POST | `/api/admin/phar/self-test` | Allow | Allow | Deny |
| POST | `/api/ch/session` | Allow | Allow | Deny |
| POST | `/api/downloads/pause` | Allow | Allow | Deny |
| POST | `/api/downloads/resume` | Allow | Allow | Deny |
| POST | `/api/downloads/sources/{id}/pause` | Allow | Allow | Deny |
| POST | `/api/downloads/sources/{id}/resume` | Allow | Allow | Deny |
| POST | `/api/export/chpack` | Allow | Allow | Deny |
| POST | `/api/goon/beat-maps/analyze` | Allow | Allow | Deny |
| POST | `/api/goon/oauth/callback` | Allow | Allow | Deny |
| POST | `/api/goon/playlists` | Allow | Allow | Deny |
| POST | `/api/goon/session` | Allow | Allow | Deny |
| POST | `/api/goon/session/complete` | Allow | Allow | Deny |
| POST | `/api/groups` | Allow | Allow | Deny |
| POST | `/api/groups/{id}/tags` | Allow | Allow | Deny |
| POST | `/api/import` | Allow | Allow | Deny |
| POST | `/api/media/bulk` | Allow | Allow | Deny |
| POST | `/api/media/{id}/clips` | Allow | Allow | Deny |
| POST | `/api/media/{id}/rating/approve` | Allow | Allow | Deny |
| POST | `/api/media/{id}/rating/undo` | Allow | Allow | Deny |
| POST | `/api/media/{id}/tags` | Allow | Allow | Deny |
| POST | `/api/oobe/complete` | Allow | Allow | Deny |
| POST | `/api/oobe/reset` | Allow | Allow | Deny |
| POST | `/api/oobe/settings` | Allow | Allow | Deny |
| POST | `/api/oobe/validate` | Allow | Allow | Deny |
| POST | `/api/search/download` | Allow | Allow | Deny |
| POST | `/api/session/command` | Allow | Allow | Deny |
| POST | `/api/session/start` | Allow | Allow | Deny |
| POST | `/api/source-tag-rules` | Allow | Allow | Deny |
| POST | `/api/source-tags/review` | Allow | Allow | Deny |
| POST | `/api/sources` | Allow | Allow | Deny |
| POST | `/api/sources/resync-all` | Allow | Allow | Deny |
| POST | `/api/sources/{id}/resync` | Allow | Allow | Deny |
| POST | `/api/storage/archives/cleanup` | Allow | Allow | Deny |
| POST | `/api/storage/sources/{id}/cleanup` | Allow | Allow | Deny |
| POST | `/api/storage/sources/{id}/permit-once` | Allow | Allow | Deny |
| POST | `/api/storage/thumbnails/clear` | Allow | Allow | Deny |
| PUT | `/api/media/{id}/duration` | Allow | Allow | Deny |
| PUT | `/api/media/{id}/rating` | Allow | Allow | Deny |
<!-- END GENERATED MUTATION MATRIX -->

## Maintenance and edition constraints

An allowed role can still receive a validation error, maintenance rejection, shutdown rejection, or an edition-specific denial. Those checks narrow authority and never grant an operation denied above. Viewer cannot become Host through `X-Forwarded-For` or another caller-controlled header.
