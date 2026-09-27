#!/bin/sh
set -eu

# Build the Curator Viewer Debian package plus a portable archive from an
# already-compiled Viewer binary. The Viewer keeps no library and bundles
# no helper tools; it streams from a Host or Server.
#
# Usage: build-viewer-deb.sh <curator-viewer-binary> <output-dir>
binary=${1:?pass the compiled Curator Viewer binary}
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
stage=$(mktemp -d "${TMPDIR:-/tmp}/curator-viewer-deb.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

mkdir -p "$output" "$stage/DEBIAN" "$stage/usr/lib/curator-viewer" \
  "$stage/usr/share/applications" "$stage/usr/share/icons/hicolor/256x256/apps"
chmod 0755 "$stage" "$stage/DEBIAN"
install -m 0755 "$binary" "$stage/usr/lib/curator-viewer/curator-viewer"
install -m 0644 "$root/packaging/linux/curator-viewer.desktop" "$stage/usr/share/applications/curator-viewer.desktop"
install -m 0644 "$root/desktop/icons/icon.png" "$stage/usr/share/icons/hicolor/256x256/apps/curator-viewer.png"
sed "s/@CURATOR_VERSION@/$version/" "$root/packaging/linux/debian-control-viewer" > "$stage/DEBIAN/control"

dpkg-deb --root-owner-group --build "$stage" "$output/curator-viewer_${version}_amd64.deb"

# Portable archive for current-user installs.
portable=$(mktemp -d "${TMPDIR:-/tmp}/curator-viewer-portable.XXXXXX")
trap 'rm -rf "$stage" "$portable"' EXIT HUP INT TERM
install -m 0755 "$binary" "$portable/curator-viewer"
install -m 0644 "$root/desktop/icons/icon.png" "$portable/icon.png"
tar -C "$portable" -czf "$output/curator-viewer-${version}-linux-x86_64.tar.gz" .
echo "Built $output/curator-viewer_${version}_amd64.deb"
