#!/bin/sh
set -eu

# Install a portable AvtoHmver Server archive for the current user. The archive
# deliberately has no privileged post-install action: this copies files into
# the user's local application directory and registers a systemd --user unit.
bundle=${1:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}
target=${AVTOHMVER_SERVER_HOME:-${CURATOR_SERVER_HOME:-"$HOME/.local/lib/avtohmver"}}
unit_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user

if [ ! -x "$bundle/avtohmver-server" ] || [ ! -d "$bundle/static" ]; then
  echo "This does not look like a AvtoHmver Server portable bundle." >&2
  exit 1
fi

mkdir -p "$target" "$unit_dir"
cp -R "$bundle/." "$target/"
escaped_target=$(printf '%s' "$target/avtohmver-server" | sed 's/[\\&|]/\\&/g')
sed "s|__AVTOHMVER_SERVER_PATH__|$escaped_target|g" \
  "$bundle/avtohmver-server-user.service" > "$unit_dir/avtohmver-server-user.service"
chmod 0644 "$unit_dir/avtohmver-server-user.service"
systemctl --user disable --now curator-server-user.service >/dev/null 2>&1 || true
systemctl --user daemon-reload
systemctl --user enable --now avtohmver-server-user.service

echo "AvtoHmver Server is running for the current user. Open http://127.0.0.1:42168/"
