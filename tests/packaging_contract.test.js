const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Host and Viewer package native Slint binaries without Tauri', () => {
  const manifest = read('desktop/Cargo.toml');
  assert.match(manifest, /^default-run = "Curator"$/m);
  assert.doesNotMatch(manifest, /tauri/);
  assert.doesNotMatch(read('viewer/Cargo.toml'), /tauri/);
  assert.match(read('desktop/build.rs'), /slint_build/);
  assert.match(read('viewer/build.rs'), /slint_build/);
});

test('Windows Server installer has explicit user and machine scope plus opt-in P-HAR', () => {
  const nsis = read('packaging/windows/curator-server.nsi');
  const register = read('packaging/windows/Register-CuratorServer.ps1');
  const build = read('packaging/windows/build-server-installers.ps1');
  assert.match(nsis, /RequestExecutionLevel admin/);
  assert.match(nsis, /RequestExecutionLevel user/);
  assert.match(nsis, /Set up P-HAR after installation/);
  assert.match(nsis, /-Scope "\$\{SERVER_SCOPE\}"/);
  assert.match(register, /New-ScheduledTaskAction/);
  assert.match(register, /sc\.exe create CuratorServer/);
  assert.match(register, /phar-intent --enabled true/);
  assert.ok(register.indexOf('phar-intent --enabled true') < register.indexOf('& $startServer'));
  assert.match(build, /Get-Command -Name \$name -CommandType Application/);
  assert.match(build, /ProgramFilesX86/);
  assert.match(build, /NSIS\\makensis\.exe/);
});

test('Host and Viewer installers require the media runtime needed by native playback', () => {
  const manifest = read('packaging/bundles/manifest.toml');
  const fetch = read('packaging/bundles/fetch-tools.sh');
  const build = read('packaging/windows/build-desktop-installers.ps1');
  const host = read('packaging/windows/curator-host.nsi');
  const viewer = read('packaging/windows/curator-viewer.nsi');
  assert.match(manifest, /\[mpv\][\s\S]*stage = \["mpv\.exe", "\*\.dll"\]/);
  assert.match(manifest, /\[mpv-dev\][\s\S]*stage = \["\*\.dll"\]/);
  assert.match(fetch, /ffmpeg\.exe ffprobe\.exe mpv\.exe gallery-dl\.exe libmpv-2\.dll/);
  assert.match(build, /ToolsDirectory is required/);
  assert.match(build, /ToolMode = 'libraries'/);
  assert.match(host, /File \/r "\$\{CURATOR_STAGE\}\\tools\\\*\.\*"/);
  assert.doesNotMatch(host, /File \/nonfatal \/r "\$\{CURATOR_STAGE\}\\tools/);
  assert.match(viewer, /File \/r "\$\{CURATOR_STAGE\}\\tools\\\*\.\*"/);
  assert.match(viewer, /THIRD_PARTY_NOTICES\.md/);
  assert.match(host, /File "\$\{CURATOR_STAGE\}\\LICENSE"/);
  assert.match(viewer, /File "\$\{CURATOR_STAGE\}\\LICENSE"/);
  assert.match(read('packaging/windows/curator-server.nsi'), /File "\$\{CURATOR_STAGE\}\\LICENSE"/);
});

test('Linux scope packages carry appropriate service definitions', () => {
  const systemd = read('packaging/linux/curator-server.service');
  const userSystemd = read('packaging/linux/curator-server-user.service');
  const portable = read('packaging/linux/install-current-user.sh');
  const postinst = read('packaging/linux/postinst');
  assert.match(systemd, /CURATOR_INSTALL_SCOPE=all-users/);
  assert.match(systemd, /User=curator/);
  assert.match(userSystemd, /--install-scope current-user/);
  assert.match(userSystemd, /__CURATOR_SERVER_PATH__/);
  assert.match(portable, /systemctl --user enable --now/);
  assert.match(postinst, /systemctl enable --now curator-server\.service/);
  for (const edition of ['server', 'host', 'viewer']) {
    assert.match(read(`packaging/linux/build-${edition}-deb.sh`), /\$root\/LICENSE/);
  }
});

test('release workflow builds native Windows and Linux binaries without browser runtimes', () => {
  const workflow = read('.github/workflows/desktop-release.yml');
  assert.match(workflow, /validate:/);
  assert.match(workflow, /windows:/);
  assert.match(workflow, /linux:/);
  assert.match(workflow, /windows-installers:/);
  assert.match(workflow, /smoke-desktop-installers\.ps1/);
  assert.match(workflow, /needs: \[dependency-security, windows-installers, linux\]/);
  assert.match(workflow, /cargo build -vv --release --locked -p \$\{\{ matrix\.package \}\} --bin/);
  assert.match(workflow, /RUST_LOG: debug/);
  assert.match(workflow, /RUST_BACKTRACE: full/);
  assert.doesNotMatch(workflow, /tauri|webkit|macos/i);
  assert.equal(fs.existsSync(path.join(root, '.github/workflows/windows-release.yml')), false);
});

test('obsolete desktop WebView configuration is absent', () => {
  for (const file of ['desktop/tauri.conf.json', 'viewer/tauri.conf.json', 'viewer/static/index.html']) {
    assert.equal(fs.existsSync(path.join(root, file)), false);
  }
});
