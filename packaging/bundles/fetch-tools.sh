#!/bin/sh
set -eu

# Fetch and verify the Windows Host helper-tool bundle.
#
# Usage: fetch-tools.sh <output-tools-dir>
#
# Reads packaging/bundles/manifest.toml, downloads each tool, verifies the
# SHA-256 against packaging/bundles/bundles.lock (recording it on first
# fetch), and stages the listed files into <output-tools-dir>.
#
# Any failure — missing URL, checksum mismatch, absent staged file — exits
# non-zero so CI packaging never ships a partial or tampered bundle.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
manifest="$root/packaging/bundles/manifest.toml"
lock="$root/packaging/bundles/bundles.lock"
out=${1:?pass the output tools directory}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/avtohmver-tools.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$out"

# Minimal TOML read: pull url/kind/stage entries per [tool] section.
tools=$(awk '/^\[.+\]$/ { gsub(/\[|\]/, ""); tool=$0 } /./ { print tool }' "$manifest" | sort -u | grep -v '^notes$')
fail=0

get() { # section key -> value
  awk -v section="[$1]" -v key="$2" '
    $0 == section { in_section=1; next }
    in_section && /^\[/ { exit }
    in_section && $0 ~ "^" key " =" {
      sub(/^[^=]*= *"/, ""); sub(/".*$/, ""); print; exit
    }' "$manifest"
}

lock_get() { # tool -> sha256 (empty when unpinned)
  [ -f "$lock" ] || return 0
  awk -v tool="$1" '$1 == tool { print $2; exit }' "$lock"
}

for tool in $tools; do
  url=$(get "$tool" url)
  kind=$(get "$tool" kind)
  version=$(get "$tool" version)
  if [ -z "$url" ]; then
    echo "manifest: [$tool] has no url" >&2
    fail=1
    continue
  fi
  archive="$tmp/$tool-download"
  echo "Fetching $tool $version ..."
  if ! curl -fsSL -o "$archive" "$url"; then
    echo "FAILED to download $tool from $url" >&2
    fail=1
    continue
  fi
  sha=$(sha256sum "$archive" | awk '{print $1}')
  pinned=$(lock_get "$tool")
  if [ -n "$pinned" ]; then
    if [ "$sha" != "$pinned" ]; then
      echo "CHECKSUM MISMATCH for $tool: got $sha, lock wants $pinned" >&2
      fail=1
      continue
    fi
  else
    echo "$tool $sha" >> "$lock"
    echo "Pinned $tool $version sha256=$sha in bundles.lock"
  fi
  extract="$tmp/$tool-extract"
  mkdir -p "$extract"
  case "$kind" in
    zip) unzip -q -o "$archive" -d "$extract" ;;
    7z) 7z x -y -o"$extract" "$archive" >/dev/null ;;
    exe) cp "$archive" "$extract/$tool.exe" ;;
    *) echo "Unknown kind '$kind' for $tool" >&2; fail=1; continue ;;
  esac
  # Stage the manifest-listed files by basename. A wildcard deliberately
  # brings along libmpv/mpv dependency DLLs; copying only libmpv itself makes
  # a fresh Windows installation fail during dynamic loading.
  staged=$(awk -v section="[$tool]" '
    $0 == section { in_section=1; next }
    in_section && /^\[/ { exit }
    in_section && /^stage = / {
      line=$0; gsub(/.*\[/, "", line); gsub(/\].*/, "", line); gsub(/"/, "", line); gsub(/, */, "\n", line); print line; exit
    }' "$manifest")
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    base=$(basename "$rel")
    found=$(find "$extract" -name "$base" -type f -print)
    if [ -z "$found" ]; then
      echo "Staged file pattern '$rel' not found in $tool archive" >&2
      fail=1
      continue
    fi
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      install -m 0755 "$file" "$out/$(basename "$file")"
    done <<EOF
$found
EOF
  done <<EOF
$staged
EOF
done

if [ "$fail" -ne 0 ]; then
  echo "Tool bundle is incomplete; refusing to package." >&2
  exit 1
fi
for required in ffmpeg.exe ffprobe.exe mpv.exe gallery-dl.exe libmpv-2.dll; do
  if [ ! -f "$out/$required" ]; then
    echo "Required bundled runtime '$required' was not staged" >&2
    exit 1
  fi
done
echo "Tools staged in $out:"
ls -la "$out"
