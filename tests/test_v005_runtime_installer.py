import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mod'))
import v005_runtime_installer as runtime


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.game = self.root / 'game'
        self.binary = self.game / 'CockHero/Binaries/Win64'
        self.binary.mkdir(parents=True)
        self.component = self.binary / 'ue4ss/Mods/FanserviceV005'
        self.archive = self.root / 'loader.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name in runtime.LOADER_FILES:
                payload = ('loader:' + name).encode()
                archive.writestr(name, payload)
                target = self.binary / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
        registry = self.root / 'registry.json'
        registry.write_text(json.dumps({'loader_probe': {'sha256': runtime.packs.digest(self.archive)}}))
        for name, value in [('REGISTRY', registry), ('identify', lambda *_: {'build_id': runtime.packs.TARGET}),
                            ('validate_registry', lambda value: value)]:
            mock = patch.object(runtime, name, value)
            mock.start()
            self.addCleanup(mock.stop)
        mock = patch.object(runtime.packs, '_require_closed')
        self.closed = mock.start()
        self.addCleanup(mock.stop)
        self.kw = {'origin': 'https://example.test'}
        for name, payload in [('ue4ss/UE4SS-settings.ini', b'user settings'), ('ue4ss/Mods/mods.txt', b'OtherMod : 1'),
                              ('ue4ss/Mods/OtherMod/Scripts/main.lua', b'user mod'), ('../../Saved/SaveGames/user.sav', b'user save')]:
            target = self.binary / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        self.preserved = {p: p.read_bytes() for p in self.game.rglob('*') if p.is_file()}

    def install(self, **kwargs):
        return runtime.install(self.game, self.archive, **self.kw, **kwargs)

    def test_review_is_default_and_writes_nothing(self):
        self.assertFalse(self.install()['applied'])
        self.assertFalse(self.component.exists())
        self.assertEqual(self.preserved, {p: p.read_bytes() for p in self.game.rglob('*') if p.is_file()})
        self.closed.assert_not_called()

    def test_install_update_remove_preserves_loader_settings_saves_other_mods(self):
        self.assertTrue(self.install(apply=True)['applied'])
        self.assertEqual((self.component / 'build-id.txt').read_text().strip(), runtime.packs.TARGET)
        self.assertTrue((self.component / 'enabled.txt').is_file())
        self.kw['origin'] = 'http://127.0.0.1:42168'
        self.install(apply=True)
        self.assertEqual((self.component / 'server-origin.txt').read_text().strip(), self.kw['origin'])
        self.assertFalse(runtime.remove(self.game, self.archive)['applied'])
        self.assertTrue(runtime.remove(self.game, self.archive, apply=True)['removed'])
        self.assertFalse(self.component.exists())
        for path, content in self.preserved.items():
            self.assertEqual(path.read_bytes(), content)

    def test_payload_hashes_cover_all_owned_files(self):
        record = self.install(apply=True)
        self.assertEqual(set(record['files']), runtime.OWNED)
        for name, expected in record['files'].items():
            self.assertEqual(hashlib.sha256((self.component / name).read_bytes()).hexdigest(), expected)
        self.assertFalse(record['full_mod_supported'])

    def test_unowned_component_refused_even_empty(self):
        self.component.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'unowned'):
            self.install(apply=True)

    def test_modified_owned_file_refuses_update_and_remove(self):
        self.install(apply=True)
        target = self.component / 'Scripts/main.lua'
        target.write_text('user modified')
        for action in (lambda: self.install(apply=True), lambda: runtime.remove(self.game, self.archive, apply=True)):
            with self.assertRaisesRegex(ValueError, 'modified'):
                action()
            self.assertEqual(target.read_text(), 'user modified')

    def test_unknown_user_files_preserved_and_block_removal(self):
        self.install(apply=True)
        target = self.component / 'user-notes.txt'
        target.write_text('keep')
        with self.assertRaisesRegex(ValueError, 'unowned files'):
            runtime.remove(self.game, self.archive, apply=True)
        self.assertEqual(target.read_text(), 'keep')

    def test_wrong_build_refused(self):
        with patch.object(runtime, 'identify', return_value={'build_id': 'v004-exclusive-c645757d'}):
            with self.assertRaisesRegex(ValueError, 'exact pinned'):
                self.install()

    def test_wrong_installed_loader_refused(self):
        (self.binary / 'dwmapi.dll').write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'Existing loader'):
            self.install()

    def test_wrong_archive_refused(self):
        self.archive.write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            self.install()

    def test_remote_http_credentials_path_and_bad_port_refused(self):
        for origin in ['http://example.test', 'https://user:pass@example.test', 'https://example.test/path',
                       'https://example.test:0', 'https://example.test:65536', 'https://example.test\n']:
            self.kw['origin'] = origin
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                self.install()

    def test_running_game_prevents_writes(self):
        self.closed.side_effect = ValueError('Close game')
        with self.assertRaisesRegex(ValueError, 'Close game'):
            self.install(apply=True)
        self.assertFalse(self.component.exists())

    def test_reparse_ancestor_refused(self):
        original = runtime.packs._reparse
        with patch.object(runtime.packs, '_reparse', side_effect=lambda path: path == self.binary / 'ue4ss' or original(path)):
            with self.assertRaisesRegex(ValueError, 'reparse'):
                self.install()

    def test_initial_install_failure_rolls_back_component(self):
        original = runtime._write
        calls = 0
        def broken(path, data):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise OSError('injected failure')
            return original(path, data)
        with patch.object(runtime, '_write', side_effect=broken), self.assertRaisesRegex(OSError, 'injected'):
            self.install(apply=True)
        self.assertFalse(self.component.exists())

    def test_update_failure_restores_old_origin_and_manifest(self):
        self.install(apply=True)
        before = {p: p.read_bytes() for p in self.component.rglob('*') if p.is_file()}
        original = runtime._write
        failed = False
        def broken(path, data):
            nonlocal failed
            if path.name == runtime.MANIFEST and not failed:
                failed = True
                raise OSError('manifest failure')
            return original(path, data)
        self.kw['origin'] = 'https://changed.test'
        with patch.object(runtime, '_write', side_effect=broken), self.assertRaisesRegex(OSError, 'manifest'):
            self.install(apply=True)
        self.assertEqual(before, {p: p.read_bytes() for p in self.component.rglob('*') if p.is_file()})

    def test_malformed_manifest_type_refused(self):
        self.install(apply=True)
        (self.component / runtime.MANIFEST).write_text('[]')
        with self.assertRaisesRegex(ValueError, 'Invalid runtime ownership'):
            runtime.remove(self.game, self.archive, apply=True)

    def test_empty_unknown_directory_preserved(self):
        self.install(apply=True)
        notes = self.component / 'personal'
        notes.mkdir()
        with self.assertRaisesRegex(ValueError, 'unowned files'):
            runtime.remove(self.game, self.archive, apply=True)
        self.assertTrue(notes.is_dir())

    def test_protocol_upgrade_uninstall_and_reinstall_preserve_bytes(self):
        self.install(apply=True)
        state = {'.fanservice-companion.state': b'heartbeat bytes',
                 '.fanservice-music-sessions.json': b'{"old-session":"retained"}',
                 '.fanservice-companion.response.123-456': b'reply bytes',
                 '.fanservice-companion.request.tmp': b'interrupted request'}
        for name, content in state.items():
            (self.component / name).write_bytes(content)
        self.kw['origin'] = 'https://changed.test'
        self.install(apply=True)
        removed = runtime.remove(self.game, self.archive, apply=True)
        self.assertEqual(removed['status'], 'disabled')
        manifest = json.loads((self.component / runtime.MANIFEST).read_text())
        self.assertEqual(manifest['files'], {})
        self.assertFalse((self.component / 'enabled.txt').exists())
        self.assertFalse((self.component / 'Scripts/main.lua').exists())
        for name, content in state.items():
            self.assertEqual((self.component / name).read_bytes(), content)
        self.install(apply=True)
        self.assertTrue((self.component / 'enabled.txt').exists())
        for name, content in state.items():
            self.assertEqual((self.component / name).read_bytes(), content)

    def test_active_helper_markers_block_apply_but_allow_review(self):
        self.install(apply=True)
        for name in runtime.ACTIVE_FILES:
            path = self.component / name
            path.write_bytes(b'a' * 32)
            self.assertFalse(self.install()['applied'])
            for action in (lambda: self.install(apply=True), lambda: runtime.remove(self.game, self.archive, apply=True)):
                with self.assertRaisesRegex(ValueError, 'Stop the native helper'):
                    action()
            self.assertEqual(path.read_bytes(), b'a' * 32)
            path.unlink()

    def test_retained_protocol_size_bound(self):
        self.install(apply=True)
        target = self.component / '.fanservice-companion.request'
        target.write_bytes(b'x' * 65537)
        with self.assertRaisesRegex(ValueError, 'oversized'):
            self.install(apply=True)
        self.assertEqual(target.stat().st_size, 65537)

    def test_stale_helper_archive_preserved_and_reinstallable(self):
        self.install(apply=True)
        folder = self.component / '.fanservice-stale-helper' / ('a' * 32)
        folder.mkdir(parents=True)
        token = folder / '.fanservice-companion.host.lock'
        token.write_bytes(b'b' * 32)
        runtime.remove(self.game, self.archive, apply=True)
        self.assertEqual(token.read_bytes(), b'b' * 32)
        self.install(apply=True)
        self.assertEqual(token.read_bytes(), b'b' * 32)

    def test_unrecognized_archive_payload_is_not_silently_preserved(self):
        self.install(apply=True)
        folder = self.component / '.fanservice-stale-helper' / ('a' * 32)
        folder.mkdir(parents=True)
        (folder / 'user.txt').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'unowned'):
            runtime.remove(self.game, self.archive, apply=True)
        self.assertEqual((folder / 'user.txt').read_text(), 'keep')

    def test_disabled_manifest_cannot_claim_owned_scripts(self):
        self.install(apply=True)
        (self.component / '.fanservice-companion.state').write_text('state')
        runtime.remove(self.game, self.archive, apply=True)
        (self.component / 'enabled.txt').write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'unowned'):
            self.install(apply=True)

    def test_launcher_has_immutable_build_and_optional_explicit_ffmpeg(self):
        self.install(apply=True)
        text = (self.component / 'Start-FanserviceNative.ps1').read_text()
        self.assertIn("'--build-id', 'v0051-hotfix-public-a8f46896'", text)
        self.assertIn('[string]$FFmpeg', text)
        self.assertIn('IsPathRooted($FFmpeg)', text)
        self.assertIn('Get-Item -LiteralPath $FFmpeg', text)
        self.assertIn("'--ffmpeg'", text)
        self.assertIn('Archive-StaleCompanion', text)
        self.assertIn('FANSERVICE_COMPANION_STOP_1', text)
        self.assertIn('-WindowStyle Hidden', text)

    def test_manifest_path_traversal_refused(self):
        self.install(apply=True)
        manifest = self.component / runtime.MANIFEST
        data = json.loads(manifest.read_text())
        data['files']['../../outside'] = 'a' * 64
        manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'Invalid runtime ownership'):
            runtime.remove(self.game, self.archive, apply=True)


if __name__ == '__main__':
    unittest.main()
