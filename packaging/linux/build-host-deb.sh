#!/bin/sh
set -eu

# Build the AvtoHmver Host Debian package plus a portable archive from an
# already-compiled Host binary. The .deb installs the app, its .desktop
# entry, and its icon; the portable archive is the current-user package.
#
# Usage: build-host-deb.sh <AvtoHmver-binary> <output-dir> [tools-dir]
# A tools directory (ffmpeg, ffprobe, mpv, gallery-dl) is staged under
# <install>/tools so the app resolves helpers install-relative first.
binary=${1:?pass the compiled AvtoHmver Host binary}
output=${2:?pass an output directory}
tools_dir=${3:-}
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
version=$(awk '
  /^\[workspace.package\]$/ { in_section=1; next }
  in_section && /^\[/ { exit }
  in_section && /^version = / { gsub(/"/, "", $3); print $3; exit }
' "$root/Cargo.toml")
if [ -z "$version" ]; then
  echo "Could not read workspace version from Cargo.toml" >&2
  exit 1
fi
stage=$(mktemp -d "${TMPDIR:-/tmp}/avtohmver-host-deb.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

mkdir -p "$output" "$stage/DEBIAN" "$stage/usr/lib/avtohmver-host" \
  "$stage/usr/share/applications" "$stage/usr/share/icons/hicolor/256x256/apps" \
  "$stage/usr/share/doc/avtohmver-host"
chmod 0755 "$stage" "$stage/DEBIAN"
install -m 0755 "$binary" "$stage/usr/lib/avtohmver-host/AvtoHmver"
install -m 0644 "$root/LICENSE" "$stage/usr/share/doc/avtohmver-host/LICENSE"
install -m 0644 "$root/packaging/linux/avtohmver-host.desktop" "$stage/usr/share/applications/avtohmver-host.desktop"
install -m 0644 "$root/desktop/icons/icon.png" "$stage/usr/share/icons/hicolor/256x256/apps/avtohmver-host.png"
if [ -n "$tools_dir" ] && [ -d "$tools_dir" ]; then
  mkdir -p "$stage/usr/lib/avtohmver-host/tools"
  cp -R "$tools_dir/." "$stage/usr/lib/avtohmver-host/tools/"
  chmod -R a+rX "$stage/usr/lib/avtohmver-host/tools"
fi
sed "s/@AVTOHMVER_VERSION@/$version/" "$root/packaging/linux/debian-control-host" > "$stage/DEBIAN/control"

dpkg-deb --root-owner-group --build "$stage" "$output/avtohmver-host_${version}_amd64.deb"

# Portable archive for current-user installs.
portable=$(mktemp -d "${TMPDIR:-/tmp}/avtohmver-host-portable.XXXXXX")
trap 'rm -rf "$stage" "$portable"' EXIT HUP INT TERM
install -m 0755 "$binary" "$portable/AvtoHmver"
install -m 0644 "$root/LICENSE" "$portable/LICENSE"
install -m 0644 "$root/desktop/icons/icon.png" "$portable/icon.png"
if [ -n "$tools_dir" ] && [ -d "$tools_dir" ]; then
  mkdir -p "$portable/tools"
  cp -R "$tools_dir/." "$portable/tools/"
fi
tar -C "$portable" -czf "$output/avtohmver-host-${version}-linux-x86_64.tar.gz" .
echo "Built $output/avtohmver-host_${version}_amd64.deb"
