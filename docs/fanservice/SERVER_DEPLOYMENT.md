# Server API and private HTTPS deployment

The static PWA and the Server API are separate capabilities. A Python file server
or a Tailscale static-directory mapping can load saved phone media but cannot
provide library browsing, music manifests, profile sync or archive export.
`/api/fanservice/v1/capabilities` must return JSON from the real Server, not an HTML
404. Keep the final phone URL on one HTTPS origin to retain its browser storage.

## Windows Server with a private HTTPS proxy

From the packaged fanservice Server directory, run the existing installation with
its usual data-directory/install-scope options, adding the gateway option:

```powershell
.\Server\avtohmver-server.exe --fanservice-gateway-port 42171
```

The ordinary library-management listener remains on port 42168. That port must
be free; do not start a second backend on the same library. Add the gateway
option to the existing service/task command when using managed startup, rather
than starting another Server process. The data directory keeps its OS lock and
its existing library, settings and profiles. This option does not migrate data.

The gateway binds only `127.0.0.1:42171` and pins every proxied request to Viewer,
even though the reverse proxy connects from loopback. Forwarded headers cannot
grant Host authority. Browse/media/music reads are available; archive export
and key-authorized profile sync retain their narrow permissions. Beatmap
analysis/editing, library mutations and Local Admin stay on the owner listener.

Check the API before changing the private proxy:

```powershell
Invoke-RestMethod http://127.0.0.1:42171/api/fanservice/v1/capabilities
```

For the existing private Tailscale Serve installation, an Administrator terminal
can map the HTTPS root to the gateway:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --bg --https=443 http://127.0.0.1:42171
```

Use private Serve with the account's intended Tailnet access grants. This recipe
does not configure public Funnel. Existing `/fanservice/` static mappings can
continue serving the PWA; `/api/` requests must reach this real gateway. Inspect
`tailscale serve status` after configuration and validate capabilities at the
HTTPS origin as well as loopback. Server serves its own current `/fanservice/`
assets when no more-specific static mapping overrides that path.

On the phone, use `/fanservice/` on that same HTTPS origin and set Connection to
the HTTPS origin, without a path. A changed Server library identity selects its
own library-bound pack profile; local files and old profiles are retained, and
saved-pack export/import is the explicit transfer mechanism. Safari and a Home
Screen app can still have separate stores.

## Music and sync acceptance

Prepare music from the owner UI: import a local recording, explicitly analyze,
review/edit and confirm its beatmap. Playback manifests reject unconfirmed or
replaced recordings. `GET .../music/{id}/beatmap` returns editable times plus the
offset; playback manifests shift times exactly once. Snapshot clients copy the
selected recording and matching manifest, not a live Server URL alone.

Profile sync requires the per-profile 256-bit key in
`x-fanservice-profile-key`. A stale upload returns 409 for explicit review; it
never overwrites silently. Profile successes and credential errors use
`Cache-Control: no-store`. Keys are not put in URLs.

The isolated Rust gateway test checks actual HTTP capabilities, key-authorized
profile PUT/GET, stale-revision rejection, no-store responses, and rejection of
forwarded-header attempts to edit a beatmap or library. It does not configure
or certify a particular production Tailnet deployment. Physical device/provider
and original-game music acceptance remain separate gates.
