# Bundled third-party tools — license notices
#
# Windows AvtoHmver Host and AvtoHmver Viewer installers stage the required media
# runtime under `<install>\tools` (see `packaging/bundles/manifest.toml`).
# This file records what those tools are and under which terms they ship. It is a
# notice file, not legal advice; the authoritative texts live with the
# projects themselves.

## ffmpeg (gyan.dev essentials build)
- Homepage: https://ffmpeg.org — Windows builds: https://www.gyan.dev/ffmpeg/builds/
- License: GPL-3.0-or-later (essentials builds include GPL components).
- What ships: `ffmpeg.exe`, `ffprobe.exe` only.
- Implication: distributing these binaries means the bundle is subject to
  GPL-3.0 terms. Keep this notice with the installer and make the
  corresponding source offer available on request (ffmpeg.org provides it).

## mpv / libmpv
- Homepage: https://mpv.io — sources: https://github.com/mpv-player/mpv
- License: GPL-2.0-or-later for the pinned mpv and mpv-dev builds. The
  `mpv-dev` archive is the development/runtime library companion to that
  build; it is not identified as a separately configured LGPL variant.
- What ships: `mpv.exe`, `libmpv-2.dll`, and their required runtime DLLs.
- Implication: GPL-2.0+ terms apply to the bundle; keep this notice and the
  source offer with the installer.

## gallery-dl (standalone Windows executable)
- Homepage: https://github.com/mikf/gallery-dl
- License: GPL-2.0-only.
- What ships: `gallery-dl.exe`.
- Implication: GPL-2.0 terms apply; keep this notice with the installer.

## Linux packages
Linux packages use the distribution's `libmpv2` package. Host additionally
recommends `ffmpeg`; package-manager dependencies keep their licensing and
security updates under the distribution's control.
