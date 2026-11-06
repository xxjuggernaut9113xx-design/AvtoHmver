# Shared acceptance fixture

Run from the repository root on Windows with Rust, Python 3.10 or newer, and FFmpeg with libx264. Build the launcher with the lockfile.

```powershell
cargo build --locked -p avtohmver-desktop --example parity_acceptance
$fixture = Join-Path $env:TEMP ("avtohmver-parity-" + [guid]::NewGuid())
.\target\debug\examples\parity_acceptance.exe $fixture
```

Use the command as shown for Host, or append `--server` for Server. Keep the launcher running. In a second PowerShell session, set `$fixture` to the same absolute path and seed it once after `ready.json` appears.

```powershell
python scripts/seed-parity-fixture.py $fixture
$seed = Get-Content "$fixture/seeded.json" -Raw | ConvertFrom-Json
```

Pass `--ffmpeg C:\path\to\ffmpeg.exe` if FFmpeg is outside PATH. The launcher marks the fixture directory and records its process, port and data paths in `ready.json`. The seeder uses generated color bars and a click track. The report lists the generated archive, tag memberships, playlist, playable videos, virtual clip, deliberately broken preview, owner edition and advertised Viewer capabilities. If setup fails after media is inserted, use a fresh path to rerun. Use separate fresh directories to repeat the same dataset in Host and Server. Stop the owner when finished and dispose of the marked directory when its evidence is no longer needed.

## Entry points

- **Host**. Open the launcher's native window. Browse and tag generated media, play a video and its virtual clip, inspect the broken preview, and open the fixture playlist. Check owner operations in Organization. Record lifecycle results separately against the installed Host.
- **Server and local browser**. Open the report's `origin` in a browser on the owner computer. Use the library UI for owner operations and `/fanservice/` for library selection, music and pack workflows. Open the archive relative to the fixture root for portable package checks. Use Organization to stage a managed linked package when checking invalidation separately.
- **Native Viewer**. With both computers on the intended Tailnet, launch the installed `avtohmver-viewer` on the second computer. Add the fixture owner's Tailnet IP or MagicDNS name with the port from `ready.json`. Browse the same tags and play a valid video. Check that owner controls are unavailable and that switching hosts revalidates the fixture identity.
- **Remote browser**. Open the fixture owner's Tailnet address and port from a second device. Verify browsing, image and video playback, and seek against both the direct Tailnet IP and MagicDNS. Use the known broken preview as the error control.
- **Viewer+**. Use a fresh emulator or test-device profile. Open the Android app's Connection settings and enter the same Server origin, with no path. Browse generated media, save a test selection locally and use the generated package or an explicit export to check archive compatibility. For secure-origin browser and physical-device acceptance, follow the [private Server deployment procedure](../fanservice/SERVER_DEPLOYMENT.md) on the test setup.

## Role probe

From the owner computer, send a valid tag creation request to loopback. From the second computer send the same request to the Tailnet address. Use a fresh tag name for each local repetition.

```powershell
$origin = $seed.origin
$body = '{"name":"Parity permission probe"}'
Invoke-WebRequest -Method Post -ContentType 'application/json' -Body $body -Uri "$origin/api/tags"
```

On the second computer set `$origin` to the remote origin. The local owner should succeed. The remote request should return HTTP 403, including with a forged `X-Forwarded-For: 127.0.0.1` header. Compare `/api/system/info` with the report for the Viewer handshake and verify a remote read still succeeds. Repeat with both owner editions and consult the [permission matrix](../permissions.md) for the other routes and the narrow Viewer exceptions.

Record the applicable checks and results in the [parity ledger](STATUS.md) and its linked evidence. Record the build, edition, client and result, using fixture identifiers in place of Tailnet addresses.
