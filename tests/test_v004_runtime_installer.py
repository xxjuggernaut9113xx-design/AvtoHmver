import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mod'))
import v004_runtime_installer as runtime


class RuntimeInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.game = self.root / 'game'
        self.binary = self.game / 'CockHero/Binaries/Win64'
        self.binary.mkdir(parents=True)
        self.archive = self.root / 'loader.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name in runtime.LOADER_FILES:
                archive.writestr(name, b'fixture ' + name.encode())
            archive.writestr('ue4ss/Mods/Cheat/Scripts/main.lua', b'never installed')
            archive.writestr('../outside.dll', b'never extracted')
        self.source = self.root / 'runtime'
        (self.source / 'Scripts').mkdir(parents=True)
        (self.source / 'Scripts/main.lua').write_text('print("fixture")')
        (self.source / 'Scripts/bridge.js').write_text('void 0;')
        (self.source / 'server-origin.txt').write_text('http://127.0.0.1:42168')
        self.registry = self.root / 'registry.json'
        self.data = dict(schema=1, supported_builds=[], candidates=[dict(id=runtime.packs.TARGET,
            files={}, verified={key: True for key in runtime.GATES})],
            loader_probe={'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest()})
        self.save_registry()
        for name, value in [('REGISTRY', self.registry), ('SOURCE', self.source)]:
            mocked = patch.object(runtime, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        mocked = patch.object(runtime, 'identify', return_value={'build_id': runtime.packs.TARGET})
        mocked.start()
        self.addCleanup(mocked.stop)
        mocked = patch.object(runtime.packs, '_require_closed')
        mocked.start()
        self.addCleanup(mocked.stop)

    def save_registry(self):
        self.registry.write_text(json.dumps(self.data))

    def test_install_update_remove_preserves_other_files(self):
        for name in ('Saved/save.sav', 'packs/original.chpack', 'Extracted/original/manifest.json',
                     'ue4ss/Mods/Other/readme.txt'):
            path = self.binary / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'untouched')
        first = runtime.install(self.game, self.archive)
        self.assertFalse(first['full_mod_supported'])
        self.assertEqual(set(first['files']), runtime.OWNED)
        self.assertFalse((self.binary / 'ue4ss/Mods/Cheat').exists())
        self.assertEqual(runtime.install(self.game, self.archive), first)
        (self.source / 'Scripts/main.lua').write_text('print("updated")')
        second = runtime.install(self.game, self.archive, origin='https://server.example:8443')
        self.assertNotEqual(first['files'], second['files'])
        self.assertTrue(runtime.remove(self.game)['removed'])
        self.assertFalse(runtime.remove(self.game)['removed'])
        for name in ('Saved/save.sav', 'packs/original.chpack', 'Extracted/original/manifest.json',
                     'ue4ss/Mods/Other/readme.txt'):
            self.assertEqual((self.binary / name).read_bytes(), b'untouched')

    def test_gate_and_unknown_build_reject_without_writes(self):
        self.data['candidates'][0]['verified']['native_catalog_bridge'] = False
        self.save_registry()
        with self.assertRaisesRegex(ValueError, 'acceptance gates'):
            runtime.install(self.game, self.archive)
        with patch.object(runtime, 'identify', return_value={'build_id': None}):
            with self.assertRaisesRegex(ValueError, 'exact identified'):
                runtime.install(self.game, self.archive)
        self.assertEqual(list(self.binary.iterdir()), [])

    def test_pinned_hash_and_origin_validation(self):
        self.archive.write_bytes(b'wrong archive')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            runtime.install(self.game, self.archive)
        for origin in ('http://example.com', 'https://host/path', 'https://user@host',
                       'https://host?x=1', 'https://host#x', 'https://host:0',
                       'https://host\n', 'file:///tmp', 'http://127.0.0.1.evil',
                       'http://127.0.0.2', 'http://127.255.255.254', 'http://LOCALHOST',
                       'http://[::1]:1234', 'https://[::1]', 'https://host..example',
                       'https://host:65536', 'https://host:', 'HTTPS://host',
                       'https://host_name', 'https://höst'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                runtime.validate_origin(origin)
        for origin in ('http://localhost:42168', 'http://127.0.0.1:1',
                       'https://server.example', 'https://Server-1.example:65535'):
            self.assertEqual(runtime.validate_origin(origin), origin)

    def test_unowned_and_tampered_files_rejected(self):
        path = self.binary / 'dwmapi.dll'
        path.write_bytes(b'unrelated')
        with self.assertRaisesRegex(ValueError, 'not owned'):
            runtime.install(self.game, self.archive)
        self.assertEqual(path.read_bytes(), b'unrelated')
        path.unlink()
        runtime.install(self.game, self.archive)
        path.write_bytes(b'changed')
        for operation in (lambda: runtime.install(self.game, self.archive), lambda: runtime.remove(self.game)):
            with self.assertRaisesRegex(ValueError, 'missing or changed'):
                operation()
        self.assertEqual(path.read_bytes(), b'changed')

    def test_install_and_remove_rollback(self):
        real_write = runtime._write
        def fail_manifest(path, data):
            if path.name == runtime.MANIFEST:
                raise PermissionError('fixture commit failure')
            return real_write(path, data)
        with patch.object(runtime, '_write', side_effect=fail_manifest):
            with self.assertRaises(PermissionError):
                runtime.install(self.game, self.archive)
        self.assertFalse((self.binary / 'dwmapi.dll').exists())
        runtime.install(self.game, self.archive)
        before = {name: (self.binary / name).read_bytes() for name in (*runtime.OWNED, runtime.MANIFEST)}
        (self.source / 'Scripts/main.lua').write_text('print("replacement")')
        with patch.object(runtime, '_write', side_effect=fail_manifest):
            with self.assertRaises(PermissionError):
                runtime.install(self.game, self.archive)
        self.assertEqual({name: (self.binary / name).read_bytes() for name in before}, before)
        real_unlink = Path.unlink
        def fail_unlink(path, *args, **kwargs):
            if path.name == runtime.MANIFEST:
                raise PermissionError('fixture removal failure')
            return real_unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', fail_unlink):
            with self.assertRaises(PermissionError):
                runtime.remove(self.game)
        self.assertEqual({name: (self.binary / name).read_bytes() for name in before}, before)

    def test_reparse_and_running_game_rejected(self):
        with patch.object(runtime.packs, '_reparse', side_effect=lambda path: path.name == 'ue4ss'):
            (self.binary / 'ue4ss').mkdir()
            with self.assertRaisesRegex(ValueError, 'reparse'):
                runtime.install(self.game, self.archive)
        with patch.object(runtime.packs, '_require_closed', side_effect=ValueError('Close this game')):
            with self.assertRaisesRegex(ValueError, 'Close this game'):
                runtime.install(self.game, self.archive)

    def test_manifest_path_injection_rejected(self):
        runtime.install(self.game, self.archive)
        manifest = self.binary / runtime.MANIFEST
        record = json.loads(manifest.read_text())
        record['files']['Saved/save.sav'] = '0' * 64
        manifest.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'ownership manifest'):
            runtime.remove(self.game)


if __name__ == '__main__':
    unittest.main()
