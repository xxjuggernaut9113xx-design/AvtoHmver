#!/bin/sh
set -eu

# Build the AvtoHmver Viewer Debian package plus a portable archive from an
# already-compiled Viewer binary. The Viewer keeps no library and streams
# from a Host or Server; its required libmpv runtime is a package dependency.
#
# Usage: build-viewer-deb.sh <avtohmver-viewer-binary> <output-dir>
binary=${1:?pass the compiled AvtoHmver Viewer binary}
output=${2:?pass an output directory}
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
stage=$(mktemp -d "${TMPDIR:-/tmp}/avtohmver-viewer-deb.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

mkdir -p "$output" "$stage/DEBIAN" "$stage/usr/lib/avtohmver-viewer" \
  "$stage/usr/share/applications" "$stage/usr/share/icons/hicolor/256x256/apps" \
  "$stage/usr/share/doc/avtohmver-viewer"
chmod 0755 "$stage" "$stage/DEBIAN"
install -m 0755 "$binary" "$stage/usr/lib/avtohmver-viewer/avtohmver-viewer"
install -m 0644 "$root/LICENSE" "$stage/usr/share/doc/avtohmver-viewer/LICENSE"
install -m 0644 "$root/packaging/linux/avtohmver-viewer.desktop" "$stage/usr/share/applications/avtohmver-viewer.desktop"
install -m 0644 "$root/desktop/icons/icon.png" "$stage/usr/share/icons/hicolor/256x256/apps/avtohmver-viewer.png"
sed "s/@AVTOHMVER_VERSION@/$version/" "$root/packaging/linux/debian-control-viewer" > "$stage/DEBIAN/control"

dpkg-deb --root-owner-group --build "$stage" "$output/avtohmver-viewer_${version}_amd64.deb"

# Portable archive for current-user installs.
portable=$(mktemp -d "${TMPDIR:-/tmp}/avtohmver-viewer-portable.XXXXXX")
trap 'rm -rf "$stage" "$portable"' EXIT HUP INT TERM
install -m 0755 "$binary" "$portable/avtohmver-viewer"
install -m 0644 "$root/LICENSE" "$portable/LICENSE"
install -m 0644 "$root/desktop/icons/icon.png" "$portable/icon.png"
tar -C "$portable" -czf "$output/avtohmver-viewer-${version}-linux-x86_64.tar.gz" .
echo "Built $output/avtohmver-viewer_${version}_amd64.deb"
