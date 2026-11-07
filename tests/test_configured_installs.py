import json
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from mod.configured_installs import add_install, load_installs, main, remove_install, resolve_install


class ConfiguredInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.cwd())
        self.root = Path(self.temp.name)
        self.registry = self.root / "configured-games.json"
        self.old = self.root / "older"
        self.new = self.root / "newer"
        self.old.mkdir()
        self.new.mkdir()
        self.compat = self.root / "compatibility.json"
        self.compat.write_text("{}", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_add_moves_existing_install_to_newest_position(self):
        add_install(self.registry, self.old)
        installs = add_install(self.registry, self.new)
        installs = add_install(self.registry, self.old)
        self.assertEqual(installs, [self.new.resolve(), self.old.resolve()])
        self.assertEqual(load_installs(self.registry), installs)

    def test_remove_and_cli_list_round_trip(self):
        add_install(self.registry, self.old)
        add_install(self.registry, self.new)
        installs = remove_install(self.registry, self.old)
        self.assertEqual(installs, [self.new.resolve()])

        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(main(["--registry", str(self.registry), "list"]), 0)
        self.assertEqual(json.loads(output.getvalue()), {"installs": [str(self.new.resolve())]})

    def test_resolve_keeps_missing_configured_install_visible(self):
        missing = self.root / "removed-on-disk"
        self.registry.write_text(json.dumps({
            "schema": 1, "installs": [{"path": str(missing)}],
        }), encoding="utf-8")
        with patch("mod.configured_installs.validate_registry", return_value={}), patch(
                "mod.configured_installs.identify", side_effect=FileNotFoundError("gone")):
            result = resolve_install(self.registry, self.compat)
        self.assertIsNone(result["selected"])
        self.assertEqual(result["installs"][0]["path"], str(missing))
        self.assertIn("unavailable", result["installs"][0]["blockers"][0])

    def test_resolve_uses_older_supported_install_when_latest_is_blocked(self):
        add_install(self.registry, self.old)
        add_install(self.registry, self.new)
        with patch("mod.configured_installs.validate_registry", return_value={}), patch(
                "mod.configured_installs.identify", side_effect=lambda path, registry: {
                    "recognized": True, "supported": Path(path).name == "older",
                    "build_id": Path(path).name, "blockers": []}):
            result = resolve_install(self.registry, self.compat)
        self.assertEqual(result["selected"]["path"], str(self.old.resolve()))
        self.assertTrue(result["fallback"])
        self.assertEqual(len(result["installs"]), 2)

    def test_no_supported_install_returns_explicit_no_fallback(self):
        add_install(self.registry, self.old)
        add_install(self.registry, self.new)
        with patch("mod.configured_installs.validate_registry", return_value={}), patch(
                "mod.configured_installs.identify", return_value={
                    "recognized": True, "supported": False, "build_id": "known-testing-build",
                    "blockers": ["Acceptance incomplete"]}):
            result = resolve_install(self.registry, self.compat)
        self.assertIsNone(result["selected"])
        self.assertFalse(result["fallback"])
        self.assertIn("supported_builds", result["error"])
        self.assertIn("no compatible fallback", result["error"])


if __name__ == "__main__":
    unittest.main()
