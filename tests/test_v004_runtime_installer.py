import hashlib
import json
import os
import shutil
import subprocess
import time
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
        for name in runtime.RUNTIME_FILES:
            if not (self.source / name).exists():
                (self.source / name).write_text('fixture companion payload')
        self.native_source = self.root / 'native'
        self.native_source.mkdir()
        for name in runtime.NATIVE_FILES:
            (self.native_source / name).write_text('fixture native worker')
        (self.source / 'server-origin.txt').write_text('http://127.0.0.1:42168')
        self.registry = self.root / 'registry.json'
        self.data = dict(schema=1, supported_builds=[], candidates=[dict(id=runtime.packs.TARGET,
            files={}, verified={key: True for key in runtime.GATES})],
            loader_probe={'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest()})
        self.save_registry()
        for name, value in [('REGISTRY', self.registry), ('SOURCE', self.source), ('NATIVE_SOURCE', self.native_source)]:
            mocked = patch.object(runtime, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        mocked = patch.object(runtime, 'identify', return_value={'build_id': runtime.packs.TARGET})
        mocked.start()
        self.addCleanup(mocked.stop)
        mocked = patch.object(runtime.packs, '_require_closed')
        mocked.start()
        self.addCleanup(mocked.stop)

    def test_running_companion_lock_prevents_runtime_changes(self):
        runtime.install(self.game, self.archive, origin='http://127.0.0.1:42168')
        lock = self.binary / runtime.PREFIX / '.fanservice-companion.host.lock'
        lock.write_text('a' * 32)
        before = (self.binary / runtime.PREFIX / 'Scripts/main.lua').read_bytes()
        with self.assertRaisesRegex(ValueError, 'Stop the helper'):
            runtime.remove(self.game)
        self.assertEqual((self.binary / runtime.PREFIX / 'Scripts/main.lua').read_bytes(), before)
        self.assertEqual(lock.read_text(), 'a' * 32)

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher process test')
    def test_launcher_passes_quoted_paths_to_only_its_helper(self):
        game = self.root / 'game with spaces'
        binary = game / 'CockHero/Binaries/Win64'
        runtime_dir = binary / 'ue4ss/Mods/Fanservice'
        native = runtime_dir / 'Native'
        native.mkdir(parents=True)
        (binary / 'CockHero.exe').write_bytes(b'never executed')
        launcher = runtime.ROOT / 'runtime/Start-FanserviceNative.ps1'
        shutil.copy2(launcher, runtime_dir / launcher.name)
        (native / 'host.mjs').write_text("import {writeFileSync} from 'node:fs';writeFileSync(new URL('./received-args.json',import.meta.url),JSON.stringify(process.argv.slice(2)));", encoding='utf-8')
        data = self.root / 'companion data with spaces'
        env = dict(os.environ, LOCALAPPDATA=str(self.root / 'local app data'))
        subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(runtime_dir / launcher.name), '-CompanionDataRoot', str(data)], env=env, capture_output=True, check=True, timeout=20)
        received = native / 'received-args.json'
        deadline = time.monotonic() + 10
        while not received.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertEqual(json.loads(received.read_text()), ['--runtime-dir', str(runtime_dir), '--game-root', str(game), '--store-root', str(data)])
        self.assertEqual((binary / 'CockHero.exe').read_bytes(), b'never executed')

    @unittest.skipUnless(os.name == 'nt', 'Windows helper lock sharing test')
    def test_stop_launcher_reads_live_node_lock_and_preserves_profile_data(self):
        game = self.root / 'stop game with spaces'
        binary = game / 'CockHero/Binaries/Win64'
        runtime_dir = binary / 'ue4ss/Mods/Fanservice'
        native = runtime_dir / 'Native'
        native.mkdir(parents=True)
        (binary / 'CockHero.exe').write_bytes(b'never executed')
        launcher = runtime.ROOT / 'runtime/Start-FanserviceNative.ps1'
        shutil.copy2(launcher, runtime_dir / launcher.name)
        helper = native / 'host.mjs'
        helper.write_text("import * as fs from 'node:fs/promises';import path from 'node:path';"
                          "const root=process.argv[2],lock=path.join(root,'.fanservice-companion.host.lock'),owner='a'.repeat(32);"
                          "const handle=await fs.open(lock,'wx');await handle.writeFile(owner);await handle.sync();"
                          "const timer=setInterval(async()=>{try{const stop=path.join(root,'.fanservice-companion.shutdown');"
                          "if(await fs.readFile(stop,'utf8')==='FANSERVICE_COMPANION_STOP_1\\n'+owner){"
                          "clearInterval(timer);await fs.unlink(stop);await handle.close();await fs.unlink(lock);}}"
                          "catch(error){if(error.code!=='ENOENT')throw error;}},25);", encoding='utf-8')
        sentinel = runtime_dir / 'profile-sentinel.json'
        sentinel.write_text('retain profile')
        process = subprocess.Popen(['node', str(helper), str(runtime_dir)], creationflags=subprocess.CREATE_NO_WINDOW,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            lock = runtime_dir / '.fanservice-companion.host.lock'
            deadline = time.monotonic() + 10
            while (not lock.exists() or lock.stat().st_size != 32) and time.monotonic() < deadline:
                if process.poll() is not None:
                    self.fail(process.communicate()[1].decode())
                time.sleep(.05)
            self.assertTrue(lock.exists())
            result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                                     '-File', str(runtime_dir / launcher.name), '-Stop'], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
            process.wait(timeout=5)
            self.assertEqual(process.returncode, 0)
            self.assertFalse(lock.exists())
            self.assertEqual(sentinel.read_text(), 'retain profile')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            process.communicate()

    @unittest.skipUnless(os.name == 'nt', 'Windows atomic shutdown publication test')
    def test_atomic_shutdown_is_visible_only_when_complete_and_unlocked(self):
        binary = self.root / 'atomic stop/CockHero/Binaries/Win64'
        runtime_dir = binary / 'ue4ss/Mods/Fanservice'
        native = runtime_dir / 'Native'
        native.mkdir(parents=True)
        (binary / 'CockHero.exe').write_bytes(b'never executed')
        launcher = runtime.ROOT / 'runtime/Start-FanserviceNative.ps1'
        script = launcher.read_text(encoding='utf-8')
        marker = '$stream.Write($bytes,0,$bytes.Length);'
        self.assertEqual(script.count(marker), 1)
        (runtime_dir / launcher.name).write_text(script.replace(marker, marker + 'Start-Sleep -Milliseconds 250;'), encoding='utf-8')
        helper = native / 'host.mjs'
        helper.write_text("import * as fs from 'node:fs/promises';import path from 'node:path';"
                          "const root=process.argv[2],lock=path.join(root,'.fanservice-companion.host.lock'),owner='a'.repeat(32),report=path.join(root,'atomic-report.json');"
                          "const handle=await fs.open(lock,'wx');await handle.writeFile(owner);await handle.sync();let busy=false,temporarySeen=0;"
                          "const timer=setInterval(async()=>{if(busy)return;busy=true;try{"
                          "const names=await fs.readdir(root);if(names.some(n=>/^\\.fanservice-companion\\.shutdown\\.[a-f0-9]{32}\\.tmp$/.test(n)))temporarySeen++;"
                          "const stop=path.join(root,'.fanservice-companion.shutdown');let value;"
                          "try{value=await fs.readFile(stop,'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}"
                          "if(value!=='FANSERVICE_COMPANION_STOP_1\\n'+owner)throw Error('Published incomplete shutdown bytes');"
                          "clearInterval(timer);await fs.writeFile(report,JSON.stringify({value,temporarySeen,unlocked:true}));"
                          "await fs.unlink(stop);await handle.close();await fs.unlink(lock);"
                          "}catch(error){clearInterval(timer);await fs.writeFile(report,JSON.stringify({error:error.code||error.message,temporarySeen}));await handle.close();process.exitCode=1;}finally{busy=false;}},1);", encoding='utf-8')
        for attempt in range(3):
            with self.subTest(attempt=attempt):
                process = subprocess.Popen(['node', str(helper), str(runtime_dir)], creationflags=subprocess.CREATE_NO_WINDOW,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    lock = runtime_dir / '.fanservice-companion.host.lock'
                    deadline = time.monotonic() + 10
                    while (not lock.exists() or lock.stat().st_size != 32) and time.monotonic() < deadline:
                        if process.poll() is not None:
                            self.fail(process.communicate()[1].decode())
                        time.sleep(.01)
                    self.assertTrue(lock.exists())
                    result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                                             '-File', str(runtime_dir / launcher.name), '-Stop'], capture_output=True, timeout=20)
                    report = json.loads((runtime_dir / 'atomic-report.json').read_text())
                    self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace') + repr(report))
                    process.wait(timeout=5)
                    self.assertEqual(process.returncode, 0)
                    self.assertTrue(report['unlocked'])
                    self.assertGreater(report['temporarySeen'], 0)
                    self.assertEqual(report['value'], 'FANSERVICE_COMPANION_STOP_1\n' + 'a' * 32)
                    self.assertEqual(list(runtime_dir.glob('.fanservice-companion.shutdown*')), [])
                finally:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=5)
                    process.communicate()

    @unittest.skipUnless(os.name == 'nt', 'Windows shutdown collision preservation test')
    def test_atomic_shutdown_preserves_existing_command_and_foreign_temporary(self):
        binary = self.root / 'foreign stop/CockHero/Binaries/Win64'
        runtime_dir = binary / 'ue4ss/Mods/Fanservice'
        native = runtime_dir / 'Native'
        native.mkdir(parents=True)
        (binary / 'CockHero.exe').write_bytes(b'never executed')
        (native / 'host.mjs').write_text('never executed', encoding='utf-8')
        launcher = runtime.ROOT / 'runtime/Start-FanserviceNative.ps1'
        shutil.copy2(launcher, runtime_dir / launcher.name)
        (runtime_dir / '.fanservice-companion.host.lock').write_text('a' * 32)
        (runtime_dir / '.fanservice-companion.shutdown').write_bytes(b'foreign pending command')
        (runtime_dir / '.fanservice-companion.shutdown.foreign.tmp').write_bytes(b'foreign staged data')
        before = {path.name: path.read_bytes() for path in runtime_dir.iterdir() if path.is_file()}
        result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                                 '-File', str(runtime_dir / launcher.name), '-Stop'], capture_output=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual({path.name: path.read_bytes() for path in runtime_dir.iterdir() if path.is_file()}, before)

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

    def legacy_manifest(self, missing):
        record = runtime.install(self.game, self.archive)
        for name in missing:
            self.assertNotIn(name, runtime.REQUIRED_CORE)
            (self.binary / name).unlink()
            del record['files'][name]
        (self.binary / runtime.MANIFEST).write_text(json.dumps(record), encoding='utf-8')
        return record

    def snapshot_binary(self):
        return {path.relative_to(self.binary).as_posix(): path.read_bytes()
                for path in self.binary.rglob('*') if path.is_file()}

    def test_legacy_upgrade_adds_absent_new_files_and_preserves_save(self):
        added = {runtime.PREFIX + 'Scripts/rhythm.lua', runtime.PREFIX + 'Scripts/rhythm_probe.lua'}
        old = self.legacy_manifest(added)
        save = self.binary / 'Saved/foreign-profile.sav'
        save.parent.mkdir()
        save.write_bytes(b'original profile bytes')
        before = runtime.status(self.game)
        self.assertTrue(before['integrity_verified'])
        self.assertTrue(before['upgrade_available'])
        self.assertFalse(before['installation_blocked'])
        self.assertEqual(set(before['pending_files']), added)
        self.assertEqual(before['missing_files'], [])
        latest = runtime.install(self.game, self.archive)
        self.assertEqual(set(latest['files']), runtime.OWNED)
        self.assertTrue(set(old['files']).issubset(latest['files']))
        for name in added:
            self.assertEqual((self.binary / name).read_bytes(), (self.source / name.removeprefix(runtime.PREFIX)).read_bytes())
        self.assertEqual(save.read_bytes(), b'original profile bytes')
        after = runtime.status(self.game)
        self.assertTrue(after['integrity_verified'])
        self.assertFalse(after['upgrade_available'])
        self.assertEqual(after['pending_files'], [])

    def test_stable_core_legacy_manifest_can_upgrade(self):
        self.legacy_manifest(runtime.OWNED - runtime.REQUIRED_CORE)
        before = runtime.status(self.game)
        self.assertTrue(before['integrity_verified'])
        self.assertEqual(set(before['pending_files']), runtime.OWNED - runtime.REQUIRED_CORE)
        self.assertEqual(set(runtime.install(self.game, self.archive)['files']), runtime.OWNED)

    def test_legacy_pending_path_is_never_adopted(self):
        added = runtime.PREFIX + 'Scripts/rhythm_probe.lua'
        self.legacy_manifest({added})
        (self.binary / added).write_bytes(b'unowned manual probe')
        snapshot = self.snapshot_binary()
        state = runtime.status(self.game)
        self.assertTrue(state['integrity_verified'])
        self.assertEqual(state['unowned_files'], [added])
        self.assertTrue(state['installation_blocked'])
        for operation in (lambda: runtime.install(self.game, self.archive), lambda: runtime.remove(self.game)):
            with self.assertRaisesRegex(ValueError, 'not owned'):
                operation()
            self.assertEqual(self.snapshot_binary(), snapshot)

    def test_legacy_removal_deletes_only_manifest_owned_files(self):
        old = self.legacy_manifest(runtime.OWNED - runtime.REQUIRED_CORE)
        for name in ('Saved/foreign-profile.sav', runtime.PREFIX + 'Native/untracked-note.txt'):
            path = self.binary / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'retain foreign data')
        result = runtime.remove(self.game)
        self.assertTrue(result['removed'])
        self.assertEqual(result['files'], len(old['files']))
        for name in old['files']:
            self.assertFalse((self.binary / name).exists())
        self.assertFalse((self.binary / runtime.MANIFEST).exists())
        for name in ('Saved/foreign-profile.sav', runtime.PREFIX + 'Native/untracked-note.txt'):
            self.assertEqual((self.binary / name).read_bytes(), b'retain foreign data')

    def test_invalid_legacy_schema_or_paths_never_modify_files(self):
        record = runtime.install(self.game, self.archive)
        invalid = [{}, {name: value for name, value in record['files'].items() if name != 'dwmapi.dll'},
                   {**record['files'], 'Saved/foreign-profile.sav': '0' * 64},
                   {**record['files'], '../dwmapi.dll': '0' * 64},
                   {**record['files'], 'dwmapi.dll': 'A' * 64},
                   {runtime.PREFIX + 'Scripts/main.lua': '0' * 64}]
        for files in invalid:
            with self.subTest(paths=sorted(files)):
                (self.binary / runtime.MANIFEST).write_text(json.dumps({**record, 'files': files}), encoding='utf-8')
                snapshot = self.snapshot_binary()
                for operation in (lambda: runtime.install(self.game, self.archive), lambda: runtime.remove(self.game), lambda: runtime.status(self.game)):
                    with self.assertRaisesRegex(ValueError, 'ownership manifest'):
                        operation()
                    self.assertEqual(self.snapshot_binary(), snapshot)

    def test_gate_and_unknown_build_reject_without_writes(self):
        self.data['candidates'][0]['verified']['native_catalog_query'] = False
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

    def test_status_is_read_only_and_allowed_while_game_runs(self):
        with patch.object(runtime.packs, '_require_closed', side_effect=ValueError('Game running')):
            result = runtime.status(self.game)
        self.assertFalse(result['installed'])
        self.assertFalse(result['installation_blocked'])
        self.assertEqual(list(self.binary.iterdir()), [])
        runtime.install(self.game, self.archive)
        before = {name: (self.binary / name).read_bytes() for name in (*runtime.OWNED, runtime.MANIFEST)}
        with patch.object(runtime.packs, '_require_closed', side_effect=ValueError('Game running')):
            result = runtime.status(self.game)
        self.assertTrue(result['integrity_verified'])
        self.assertFalse(result['full_mod_supported'])
        self.assertEqual({name: (self.binary / name).read_bytes() for name in before}, before)

    def test_status_identifies_conflicts_and_changed_or_missing_payload(self):
        target = self.binary / 'dwmapi.dll'
        target.write_bytes(b'unowned')
        result = runtime.status(self.game)
        self.assertEqual(result['unowned_files'], ['dwmapi.dll'])
        self.assertTrue(result['installation_blocked'])
        target.unlink()
        runtime.install(self.game, self.archive)
        target.write_bytes(b'changed')
        (self.binary / runtime.PREFIX / 'Scripts/main.lua').unlink()
        result = runtime.status(self.game)
        self.assertFalse(result['integrity_verified'])
        self.assertEqual(result['changed_files'], ['dwmapi.dll'])
        self.assertEqual(result['missing_files'], [runtime.PREFIX + 'Scripts/main.lua'])




if __name__ == '__main__':
    unittest.main()
