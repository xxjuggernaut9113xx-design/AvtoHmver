import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'mod'))
spec = importlib.util.spec_from_file_location('v004_pack_bridge', ROOT / 'mod/v004_pack_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def make_pack(path, *, extra=None, missing=False, payload=b'synthetic media bytes'):
    manifest = dict(name='Synthetic native pack', description='', unlock_cost=7,
                    image_count=1, video_count=0, total_media=1,
                    media=[dict(file='0_slow.png', type='image')])
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        if not missing:
            archive.writestr('media/0_slow.png', payload)
        if extra:
            archive.writestr(extra, b'unexpected')


def extract_owned(receipt, *, consume=False):
    archive = Path(receipt['archive'])
    cache = archive.parent.parent / 'Extracted' / archive.stem
    with zipfile.ZipFile(archive) as source:
        source.extractall(cache)
    if consume:
        archive.unlink()
    return cache


class PackBridgeTests(unittest.TestCase):
    def test_interruption_after_commit_does_not_restore_outdated_archive(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            old_cache = extract_owned(receipt)
            make_pack(source, payload=b'committed replacement')
            with patch.object(bridge, '_discard_cache', side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    bridge.install(root, source, 'custom:stable')
            self.assertFalse(old_cache.exists())
            self.assertEqual(Path(receipt['archive']).read_bytes(), source.read_bytes())
            self.assertEqual(bridge.list_installed(root)[0]['sha256'], bridge.digest(source))
            self.assertTrue(bridge.list_installed(root)[0]['integrity_verified'])

    def test_failed_rollback_retains_original_backup_for_recovery(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            target = Path(receipt['archive'])
            original = target.read_bytes()
            extract_owned(receipt)
            make_pack(source, payload=b'new content')
            real_replace = bridge.os.replace
            def fail_rollback(source_path, destination_path):
                if Path(source_path).name.startswith('.fanservice-backup-'):
                    raise PermissionError('rollback blocked externally')
                return real_replace(source_path, destination_path)
            with patch.object(bridge, '_write_ledger', side_effect=PermissionError('commit failed')), \
                    patch.object(bridge.os, 'replace', side_effect=fail_rollback):
                with self.assertRaisesRegex(PermissionError, 'rollback blocked'):
                    bridge.install(root, source, 'custom:stable')
            backups = list(target.parent.glob('.fanservice-backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), original)
            self.assertEqual(len(list(target.parent.glob('.fanservice-cache-*'))), 1)
            self.assertFalse(bridge.list_installed(root)[0]['integrity_verified'])

    def test_pack_directory_reparse_rejected_without_any_mutation(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            (root / 'CockHero').mkdir()
            source = root / 'pack.chpack'
            make_pack(source)
            with patch.object(bridge, '_reparse', side_effect=lambda path: path == root / 'CockHero'):
                with self.assertRaisesRegex(ValueError, 'reparse point'):
                    bridge.install(root, source)
            self.assertEqual(list((root / 'CockHero').iterdir()), [])

    @unittest.skipUnless(os.name == 'nt', 'Windows process-path API acceptance')
    def test_windows_process_path_detection_finds_current_python(self):
        self.assertTrue(bridge._running_game(Path(sys.executable)))

    def test_cache_links_are_rejected_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(receipt)
            payload = cache / 'media/0_slow.png'
            outside = root / 'outside.png'
            outside.write_bytes(payload.read_bytes())
            payload.unlink()
            try:
                payload.symlink_to(outside)
            except OSError:
                self.skipTest('Creating test symlinks requires Windows developer mode or privilege.')
            for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                              lambda: bridge.uninstall(root, 'custom:stable')):
                with self.assertRaisesRegex(ValueError, 'unsafe link'):
                    operation()
            self.assertTrue(Path(receipt['archive']).exists())
            self.assertEqual(outside.read_bytes(), b'synthetic media bytes')

    def test_native_consumed_archive_is_verified_and_can_be_updated(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            first = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(first, consume=True)
            listed = bridge.list_installed(root)[0]
            self.assertTrue(listed['integrity_verified'])
            self.assertEqual(listed['source'], 'extracted')
            make_pack(source, payload=b'replacement payload')
            second = bridge.install(root, source, 'custom:stable')
            self.assertEqual(first['archive'], second['archive'])
            self.assertTrue(second['cache_invalidated'])
            self.assertFalse(cache.exists())
            self.assertEqual(Path(second['archive']).read_bytes(), source.read_bytes())
            self.assertFalse(list(Path(second['archive']).parent.glob('.fanservice-cache-*')))

    def test_update_invalidates_only_exact_owned_cache(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(receipt)
            sibling = cache.parent / 'user-owned'
            sibling.mkdir()
            (sibling / 'manifest.json').write_bytes(b'unrelated cache')
            bridge.install(root, source, 'custom:stable')
            self.assertFalse(cache.exists())
            self.assertEqual((sibling / 'manifest.json').read_bytes(), b'unrelated cache')

    def test_consumed_owned_cache_can_be_removed_without_touching_saves(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(receipt, consume=True)
            save = root / 'Saved/ProgressionSave.sav'
            save.parent.mkdir()
            save.write_bytes(b'UP and ownership')
            result = bridge.uninstall(root, 'custom:stable')
            self.assertTrue(result['cache_invalidated'])
            self.assertFalse(cache.exists())
            self.assertEqual(save.read_bytes(), b'UP and ownership')
            self.assertEqual(bridge.list_installed(root), [])

    def test_unknown_changed_and_incomplete_cache_block_all_mutations(self):
        for kind in ('unknown-file', 'unknown-dir', 'changed', 'missing'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory, \
                    patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
                root = Path(directory)
                source = root / 'pack.chpack'
                make_pack(source)
                receipt = bridge.install(root, source, 'custom:stable')
                cache = extract_owned(receipt, consume=True)
                if kind == 'unknown-file':
                    (cache / 'unknown.txt').write_bytes(b'keep')
                elif kind == 'unknown-dir':
                    (cache / 'unknown').mkdir()
                elif kind == 'changed':
                    (cache / 'media/0_slow.png').write_bytes(b'changed')
                else:
                    (cache / 'media/0_slow.png').unlink()
                ledger = Path(receipt['archive']).parent / '.fanservice-receipts.json'
                before = ledger.read_bytes()
                for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                                  lambda: bridge.uninstall(root, 'custom:stable')):
                    with self.assertRaisesRegex(ValueError, 'cache'):
                        operation()
                    self.assertTrue(cache.exists())
                    self.assertEqual(ledger.read_bytes(), before)
                    self.assertFalse(Path(receipt['archive']).exists())
                self.assertFalse(bridge.list_installed(root)[0]['integrity_verified'])

    def test_failed_update_and_removal_restore_consumed_cache(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(receipt, consume=True)
            make_pack(source, payload=b'new content')
            with patch.object(bridge, '_write_ledger', side_effect=PermissionError('commit failed')):
                for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                                  lambda: bridge.uninstall(root, 'custom:stable')):
                    with self.assertRaises(PermissionError):
                        operation()
                    self.assertFalse(Path(receipt['archive']).exists())
                    self.assertEqual((cache / 'media/0_slow.png').read_bytes(), b'synthetic media bytes')
                    self.assertTrue(bridge.list_installed(root)[0]['integrity_verified'])
            self.assertFalse(list(Path(receipt['archive']).parent.glob('.fanservice-cache-*')))

    def test_failed_archive_replacement_restores_verified_cache_and_archive(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(receipt)
            original = Path(receipt['archive']).read_bytes()
            make_pack(source, payload=b'new')
            with patch.object(bridge.os, 'replace', side_effect=PermissionError('archive in use')):
                with self.assertRaises(PermissionError):
                    bridge.install(root, source, 'custom:stable')
            self.assertEqual(Path(receipt['archive']).read_bytes(), original)
            self.assertEqual((cache / 'media/0_slow.png').read_bytes(), b'synthetic media bytes')
            self.assertTrue(bridge.list_installed(root)[0]['integrity_verified'])

    def test_missing_archive_without_verified_cache_is_not_treated_as_consumed(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            Path(receipt['archive']).unlink()
            self.assertFalse(bridge.list_installed(root)[0]['integrity_verified'])
            for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                              lambda: bridge.uninstall(root, 'custom:stable')):
                with self.assertRaisesRegex(ValueError, 'no verified extracted cache'):
                    operation()

    def test_running_game_blocks_first_install_without_creating_directory(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}), \
                patch.object(bridge, '_running_game', return_value=True):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            with self.assertRaisesRegex(ValueError, 'Close this CockHero'):
                bridge.install(root, source)
            self.assertFalse((root / 'CockHero').exists())

    def test_running_game_blocks_update_and_uninstall_but_allows_inventory(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            cache = extract_owned(receipt)
            with patch.object(bridge, '_running_game', return_value=True):
                for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                                  lambda: bridge.uninstall(root, 'custom:stable')):
                    with self.assertRaisesRegex(ValueError, 'Close this CockHero'):
                        operation()
                self.assertTrue(bridge.list_installed(root)[0]['integrity_verified'])
                self.assertTrue(cache.exists())
                self.assertTrue(Path(receipt['archive']).exists())

    def test_inventory_reads_durable_receipts_and_reports_integrity(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            records = bridge.list_installed(root)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]['custom_id'], 'custom:stable')
            self.assertTrue(records[0]['integrity_verified'])
            self.assertEqual(records[0]['archive'], receipt['archive'])
            Path(receipt['archive']).write_bytes(b'external modification')
            self.assertFalse(bridge.list_installed(root)[0]['integrity_verified'])

    def test_existing_lock_blocks_concurrent_mutation(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            packs = bridge._pack_directory(root)
            lock = packs / '.fanservice-bridge.lock'
            lock.write_bytes(b'other operation')
            with self.assertRaises(FileExistsError):
                bridge.install(root, source, 'custom:stable')
            self.assertEqual(lock.read_bytes(), b'other operation')
            self.assertFalse(list(packs.glob('*.chpack')))

    def test_stable_identity_updates_same_native_filename_and_uninstalls_only_owned_archive(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            first = bridge.install(root, source, 'custom:library-pack-1')
            packs = Path(first['archive']).parent
            external = packs / 'original.chpack'
            external.write_bytes(b'external archive')
            save = root / 'Saved/ownership.sav'
            save.parent.mkdir()
            save.write_bytes(b'native ownership')
            cache = packs.parent / 'Extracted/native-cache/media.png'
            cache.parent.mkdir(parents=True)
            cache.write_bytes(b'keep cache')
            make_pack(source, payload=b'updated media')
            second = bridge.install(root, source, first['custom_id'])
            self.assertEqual(first['archive'], second['archive'])
            self.assertEqual(first['custom_id'], second['custom_id'])
            self.assertNotEqual(first['sha256'], second['sha256'])
            self.assertEqual(Path(second['archive']).read_bytes(), source.read_bytes())
            ledger = json.loads((packs / '.fanservice-receipts.json').read_text())
            self.assertEqual(ledger['packs'][first['custom_id']]['sha256'], second['sha256'])
            bridge.uninstall(root, first['custom_id'])
            self.assertFalse(Path(first['archive']).exists())
            self.assertEqual(external.read_bytes(), b'external archive')
            self.assertEqual(save.read_bytes(), b'native ownership')
            self.assertEqual(cache.read_bytes(), b'keep cache')
            self.assertEqual(json.loads((packs / '.fanservice-receipts.json').read_text())['packs'], {})

    def test_changed_owned_archive_blocks_update_and_uninstall(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            target = Path(receipt['archive'])
            target.write_bytes(b'changed externally')
            for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                              lambda: bridge.uninstall(root, 'custom:stable')):
                with self.assertRaisesRegex(ValueError, 'missing or changed'):
                    operation()
            self.assertEqual(target.read_bytes(), b'changed externally')

    def test_failed_ledger_commit_rolls_back_install_update_and_uninstall(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            with patch.object(bridge, '_write_ledger', side_effect=PermissionError('ledger read only')):
                with self.assertRaises(PermissionError):
                    bridge.install(root, source, 'custom:stable')
            packs = root / 'CockHero/Binaries/Win64/packs'
            self.assertEqual(list(packs.iterdir()), [])
            first = bridge.install(root, source, 'custom:stable')
            original_bytes = Path(first['archive']).read_bytes()
            ledger_bytes = (packs / '.fanservice-receipts.json').read_bytes()
            make_pack(source, payload=b'new payload')
            with patch.object(bridge, '_write_ledger', side_effect=PermissionError('ledger read only')):
                for operation in (lambda: bridge.install(root, source, 'custom:stable'),
                                  lambda: bridge.uninstall(root, 'custom:stable')):
                    with self.assertRaises(PermissionError):
                        operation()
                    self.assertEqual(Path(first['archive']).read_bytes(), original_bytes)
                    self.assertEqual((packs / '.fanservice-receipts.json').read_bytes(), ledger_bytes)
            self.assertFalse(list(packs.glob('*.tmp')))
            self.assertFalse((packs / '.fanservice-bridge.lock').exists())

    def test_corrupt_ledger_and_unknown_identity_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            receipt = bridge.install(root, source, 'custom:stable')
            with self.assertRaisesRegex(ValueError, 'No owned archive'):
                bridge.uninstall(root, 'custom:unknown')
            ledger = Path(receipt['archive']).parent / '.fanservice-receipts.json'
            data = json.loads(ledger.read_text())
            data['packs']['custom:stable']['filename'] = '../other.chpack'
            ledger.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'Unsafe receipt'):
                bridge.install(root, source, 'custom:stable')
            self.assertEqual(Path(receipt['archive']).read_bytes(), source.read_bytes())

    def test_invalid_identity_has_no_game_directory_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            for identity in ('../bad', 'custom:../../bad', 'builtin:foo', 'custom:'):
                with self.assertRaisesRegex(ValueError, 'identity'):
                    bridge.install(root, source, identity)
            self.assertFalse((root / 'CockHero').exists())

    def test_transport_preserves_exact_bytes_and_existing_game_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'pack.chpack.zip'
            make_pack(source)
            sentinel = root / 'Saved' / 'original.sav'
            sentinel.parent.mkdir()
            sentinel.write_bytes(b'keep unchanged')
            with patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
                receipt = bridge.install(root, source)
            installed = Path(receipt['archive'])
            self.assertEqual(installed.read_bytes(), source.read_bytes())
            self.assertEqual(receipt['unlock_cost'], 7)
            self.assertTrue(installed.name.startswith('fanservice-synthetic-native-pack-'))
            self.assertTrue(receipt['custom_id'].startswith('custom:'))
            self.assertEqual(sentinel.read_bytes(), b'keep unchanged')
            self.assertEqual(list(installed.parent.glob('*.tmp')), [])

    def test_repeated_import_never_replaces_an_existing_pack(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            with patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}):
                first = bridge.install(root, source)
                second = bridge.install(root, source)
            self.assertNotEqual(first['archive'], second['archive'])
            self.assertEqual(Path(first['archive']).read_bytes(), source.read_bytes())
            self.assertEqual(Path(second['archive']).read_bytes(), source.read_bytes())

    def test_malformed_preview_is_rejected_cleanly(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'bad.chpack'
            manifest = dict(name='Bad preview', description='', unlock_cost=0,
                            image_count=1, video_count=0, total_media=1,
                            media=[dict(file='0_slow.png', type='image')], preview=[])
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('manifest.json', json.dumps(manifest))
                archive.writestr('media/0_slow.png', b'synthetic')
            with self.assertRaisesRegex(ValueError, 'preview'):
                bridge.validate_archive(source)

    def test_failed_atomic_install_removes_staging_and_retains_other_packs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            packs = root / 'CockHero/Binaries/Win64/packs'
            packs.mkdir(parents=True)
            existing = packs / 'existing.chpack'
            existing.write_bytes(b'original pack')
            with patch.object(bridge, 'identify', return_value={'build_id': bridge.TARGET}), \
                    patch.object(bridge.os, 'link', side_effect=PermissionError('read only')):
                with self.assertRaises(PermissionError):
                    bridge.install(root, source)
            self.assertEqual(list(packs.iterdir()), [existing])
            self.assertEqual(existing.read_bytes(), b'original pack')

    def test_unsupported_build_never_creates_pack_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'pack.chpack'
            make_pack(source)
            with patch.object(bridge, 'identify', return_value={'build_id': None}):
                with self.assertRaisesRegex(ValueError, 'v0.04'):
                    bridge.install(root, source)
            self.assertFalse((root / 'CockHero').exists())

    def test_unsafe_or_missing_payload_is_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for extra in ['../escape.exe', 'media/CON.png', 'media/other.exe']:
                source = root / 'bad.chpack'
                make_pack(source, extra=extra)
                with self.assertRaises(ValueError):
                    bridge.validate_archive(source)
            make_pack(source, missing=True)
            with self.assertRaisesRegex(ValueError, 'Missing'):
                bridge.validate_archive(source)


if __name__ == '__main__':
    unittest.main()
