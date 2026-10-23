"""Compatibility identification must never mistake a known binary for a working mod."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('compatibility', ROOT / 'mod/verify_compatibility.py')
compatibility = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compatibility)


class CompatibilityTests(unittest.TestCase):
    def test_product_packager_rejects_reconstruction_before_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'must-not-be-created'
            result = subprocess.run([sys.executable, str(ROOT / 'packaging/windows/build-fanservice.py'),
                                     '--output', str(output), '--tools', directory, '--viewer', directory],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('reconstructed Viewer is retired', result.stderr)
            self.assertFalse(output.exists())

    def test_current_registry_has_no_accidental_support_claim(self):
        registry = compatibility.validate_registry(json.loads(compatibility.REGISTRY.read_text()))
        self.assertEqual(registry['supported_builds'], [])
        self.assertEqual(registry['official_release']['version'], '0.05.1 Public')

    def test_matching_and_changed_installations_fail_closed(self):
        registry = {'schema': 1, 'supported_builds': [], 'candidates': [{
            'id': 'test', 'status': 'blocked', 'verified': {}, 'blockers': ['Not verified'],
            'files': {'CockHero/game.exe': hashlib.sha256(b'synthetic').hexdigest()}}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'CockHero').mkdir()
            (root / 'CockHero/game.exe').write_bytes(b'synthetic')
            report = compatibility.identify(root, registry)
            self.assertTrue(report['recognized'])
            self.assertFalse(report['supported'])
            (root / 'CockHero/game.exe').write_bytes(b'changed')
            self.assertFalse(compatibility.identify(root, registry)['recognized'])

    def test_supported_build_requires_all_native_acceptance_gates(self):
        registry = json.loads(compatibility.REGISTRY.read_text())
        registry['supported_builds'] = [registry['candidates'][0]['id']]
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            compatibility.validate_registry(registry)
        registry['candidates'][0]['status'] = 'verified'
        with self.assertRaisesRegex(ValueError, 'acceptance'):
            compatibility.validate_registry(registry)

    def test_registry_cannot_read_paths_outside_installation(self):
        registry = json.loads(compatibility.REGISTRY.read_text())
        for path in ['../private', '/absolute', 'C:/private', 'CockHero\\..\\private']:
            candidate = copy.deepcopy(registry)
            candidate['candidates'][0]['files'] = {path: '0' * 64}
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                compatibility.validate_registry(candidate)


if __name__ == '__main__':
    unittest.main()
