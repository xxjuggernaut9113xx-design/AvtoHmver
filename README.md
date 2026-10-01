# AvtoHmver 0.3.4

> **Pre-release:** The Server with its browser UI is the established path. The
> native Windows Host covers the core library, playback, source, download, and
> remote-access workflows, but installer and broader parity validation are in
> progress. Windows is the primary development and manual-test platform;
> Linux has automated checks and limited UI smoke evidence.

AvtoHmver is a self-hosted gallery-dl library: download media you are entitled to
access, organize it with groups/tags/ratings, and browse it locally in a
browser or native desktop app. The Host server can listen on localhost, LAN,
and detected Tailscale addresses according to its remote-access settings.

See the [native parity status](docs/parity/STATUS.md) for current verification
and the [permission matrix](docs/permissions.md) for role authority.

AvtoHmver's own code is licensed under [GPL-3.0-only](LICENSE). The packaged
media tools retain the terms recorded in the [third-party notices](packaging/bundles/NOTICES.md).

AvtoHmver has three editions built from one Rust core:

- **AvtoHmver Server** (`avtohmver-server`) is the headless backend, browser UI, download
  manager, media server, and background service.
- **AvtoHmver Host** (`AvtoHmver`) is the native Slint application with local
  library and session controls. It owns a library just like Server.
- **AvtoHmver Viewer** (`avtohmver-viewer`) is a lightweight native Slint client. It
  starts no database or server and connects only to saved Tailnet hosts.

Host and Server can never open the same resolved data directory at once. An OS
lock is held for the complete backend lifetime, so an unsafe shared SQLite/WAL
setup fails before workers begin.

## Installation scope

Every product has a **Current user** choice (the default) and an **All users**
choice. App binaries follow the selected scope; Host and Viewer preferences
stay per-user in either case.

Current-user Server data lives in `%LocalAppData%\AvtoHmver` on Windows,
`~/.local/share/AvtoHmver` on typical Linux desktops. It runs as a Windows
scheduled task or `systemd --user` unit.

All-users Server data lives in `%ProgramData%\AvtoHmver` or `/var/lib/avtohmver`.
It requires elevation and runs as a Windows service or systemd service. The package service
templates are in [packaging](packaging/README.md).

Windows Server releases contain separate current-user and all-users NSIS
installers. The Linux portable archive includes its non-elevated service
installer script; Linux `.deb` is the all-users Server package. Linux Host and
Viewer packaging scripts produce `.deb` and portable tar archives; AppImages
are not part of the current release workflow.

To bring a stopped Host library into a new all-users Server location, run the
elevated import command. It locks both locations, snapshots the source SQLite
database, copies library artifacts, and refuses to overwrite a non-empty
destination:

```text
avtohmver import-host --from "C:\path\to\host-data" --install-scope all-users
```

## Viewer and Tailnet access

Start Server or Host on the machine that owns the library, install Tailscale on
both devices, and configure an owner-only Tailnet grant. In Viewer, add the
host URL, test it, then connect. Viewer verifies the host against the local
Tailscale peer inventory and resolved Tailnet IP before it accepts the
connection; it also checks `/api/system/info` for the AvtoHmver API protocol and
edition.

Viewer access follows the canonical [permission matrix](docs/permissions.md).
That document is generated and tested against every mutating HTTP route.

## Local Admin and recovery

Host and local Server browser sessions expose **Local Admin**. Tailnet peers
receive a 403 for this surface. Admin serializes maintenance jobs, reports
progress, creates SQLite online backups, validates/downloads/restores backups,
rebuilds derived caches, reconciles the library, and provides explicitly
confirmed reset/cleanup tools.

Every destructive job requires its displayed typed phrase, pauses/quiesces
workers, creates a database/configuration backup, performs transactional data
changes, invalidates caches, and restores prior state on failure. Restore and
factory reset are staged for restart. Backups cover database/configuration,
not downloaded media; factory reset preserves media, archives, managed P-HAR
files, and backups unless their separate delete control is chosen.

## Diagnostics

Host shows the current diagnostic log path under Manage → Settings. Server
prints its diagnostic log directory at startup. Logs rotate daily and retain
eight files. Secret shaped values are redacted before file output; existing
logs are redacted again when read through the native view or `/api/log`.
Normal runs log at `info` level. Set `RUST_LOG=debug` before starting Host or
Server to opt into more detail. Viewer cannot open the Host diagnostic log
through its native interface.

## Appearance and layout

The app uses one primary scroller per view, an independent sidebar scroller,
and modal-body scrollers so long lists remain usable on short displays.
`100dvh`, bounded flex/grid sizing, sticky actions, keyboard focus, touch
scrolling, and horizontal-overflow checks are part of the shell contract.

Alongside AvtoHmver palettes, known GTK mappings are available for GTK System,
Adwaita, Yaru, Arc, and Breeze in light/dark variants. Host and Viewer can
inject their local GTK name, light/dark preference, accent, and font. AvtoHmver
maps those known families to accessible palettes; it does not parse arbitrary
GTK stylesheet files. Browser clients fall back to `prefers-color-scheme`.

## Optional classification and P-HAR

NudeNet is optional and can only suggest SFW, Slow, or Medium from anatomical
evidence. P-HAR is separately opt-in and can suggest Fast only when a
qualifying upstream action class appears in two consecutive temporal windows.
Kissing/fondling are insufficient; climax labels never assign Cum
automatically.

The managed P-HAR environment pins the upstream source archive beneath the
data directory. Native CUDA is preferred, with supported AMD ROCm used
when CUDA is unavailable or explicitly selected. AvtoHmver does not redistribute
or download model checkpoints until each checkpoint has a verified upstream
right, size, and SHA-256.
If setup is unavailable or fails, NudeNet/manual review remains operational
and P-HAR is not reported ready.

The Server NSIS installer and local OOBE both offer an unchecked opt-in choice;
Local Admin can enable, cancel, repair, self-test, or remove the managed
environment later. Setup reports persistent native-install stages and fails
closed if model publisher metadata or hardware compatibility cannot be
verified; NudeNet and manual review remain available.

## Building from source

```bash
cargo test --workspace --locked
cargo clippy --workspace --all-targets --all-features -- -D warnings
node --test tests/*.test.js
```

Run `avtohmver-server --docs` for the full operational reference. Desktop releases
target Windows and Linux.

Only add sources you have the right to access, and respect each source site's
terms and rate limits.

## Playback presets and music (0.3.4)

Open Playback setup in the browser or the GOON setup panel in Host. Presets are shared through the connected host and use revision checks: after a conflict, reload or Save as new. Draft edits never change active playback; Start uses the draft and Apply music changes only independent music playback.

Import local files/folders in Host, or upload supported audio in the browser. Local playlists contain managed integer track IDs, never arbitrary paths. Streaming retains host playback permissions and supports single byte ranges. Browser conversions for AAC, FLAC and Ogg are cached as MP3 using the configured ffmpeg. Music volume is separate from visual media volume.

Spotify opens externally. Desktop opens all external services in their own apps; browser YouTube and SoundCloud use visible official embeds. Apple Music uses MusicKit when `AVTOHMVER_APPLE_DEVELOPER_TOKEN` supplies a valid developer token and the browser user authorizes eligible playback; otherwise use the external link. Signing keys remain outside the app database and user authorization is session scoped. OAuth code exchange is not implemented and never reports placeholder success.

Host permissions apply to preset/playlist editing and uploads. Remote mobile clients remain read-only: they can load shared presets and playlists and start a presentation draft, but Save, playlist edits, and uploads require the local Host.

Fresh installs use AvtoHmver paths. Existing Curator data, configuration, native preferences and custom paths remain in place. `AVTOHMVER_*` variables take precedence over `CURATOR_*` aliases; the protocol stays `curator-api/1`.

To verify real AAC, FLAC and Ogg browser conversion, set `AVTOHMVER_TEST_FFMPEG` to an FFmpeg executable and run `cargo test real_audio_conversion_is_cached_and_range_streamable -- --ignored`. The test generates short tones in a temporary library and checks converted audio, cache reuse and byte-range streaming.
