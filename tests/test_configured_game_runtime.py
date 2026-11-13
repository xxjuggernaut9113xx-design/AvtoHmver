import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mod"))
import configured_game_runtime as routing


class ConfiguredGameRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.registry = self.root / "configured-games.json"
        self.compatibility = self.root / "compatibility.json"
        self.compatibility.write_text("{}", encoding="utf-8")
        self.game = self.root / "older-compatible"
        self.game.mkdir()
        self.archive = self.root / "loader.zip"

    def test_install_routes_to_selected_older_compatible_build_and_defaults_to_review(self):
        selected = {"path": str(self.game), "build_id": routing.V004_BUILD}
        with patch.object(routing, "_selected", return_value=selected), \
                patch.object(routing.v004, "status", return_value={"installed": False}) as status, \
                patch.object(routing.v004, "install") as install:
            result = routing.install_selected(self.registry, self.compatibility, self.archive)
        self.assertEqual(result["selected"], selected)
        self.assertTrue(result["runtime"]["dry_run"])
        status.assert_called_once_with(self.game)
        install.assert_not_called()

    def test_apply_dispatches_only_after_fallback_resolution(self):
        selected = {"path": str(self.game), "build_id": routing.V004_BUILD}
        with patch.object(routing, "_selected", return_value=selected), \
                patch.object(routing.v004, "install", return_value={"files": 3}) as install:
            result = routing.install_selected(self.registry, self.compatibility, self.archive,
                                              origin="https://localhost", apply=True)
        install.assert_called_once_with(self.game, self.archive, origin="https://localhost")
        self.assertEqual(result["runtime"], {"files": 3})

    def test_unavailable_fallback_prevents_any_runtime_dispatch(self):
        with patch.object(routing, "resolve_install", return_value={"selected": None,
                                                                      "error": "no compatible fallback"}), \
                patch.object(routing.v004, "install") as install, \
                patch.object(routing.v005, "install") as install_v005:
            with self.assertRaisesRegex(ValueError, "no compatible fallback"):
                routing.install_selected(self.registry, self.compatibility, self.archive, apply=True)
        install.assert_not_called()
        install_v005.assert_not_called()

    def test_v005_install_uses_its_reviewable_apply_flag(self):
        selected = {"path": str(self.game), "build_id": routing.V005_BUILD}
        with patch.object(routing, "_selected", return_value=selected), \
                patch.object(routing.v005, "install", return_value={"applied": False}) as install:
            routing.install_selected(self.registry, self.compatibility, self.archive,
                                     cef_ready_dll=self.root / "cef.dll")
        install.assert_called_once_with(self.game, self.archive, origin=None,
                                        cef_ready_dll=self.root / "cef.dll", apply=False)

    def test_remove_requires_configured_exact_build_but_not_current_support(self):
        self.registry.write_text(json.dumps({"schema": 1, "installs": [{"path": str(self.game)}]}),
                                 encoding="utf-8")
        with patch.object(routing, "validate_registry", return_value={}), \
                patch.object(routing, "identify", return_value={"build_id": routing.V004_BUILD,
                                                               "supported": False}), \
                patch.object(routing.v004, "status", return_value={"installed": True}) as status:
            result = routing.remove_configured(self.registry, self.compatibility, self.game)
        status.assert_called_once_with(self.game.resolve())
        self.assertFalse(result["selected"]["supported"])
        self.assertTrue(result["runtime"]["dry_run"])

    def test_remove_refuses_unconfigured_path(self):
        with self.assertRaisesRegex(ValueError, "already in the configured"):
            routing.remove_configured(self.registry, self.compatibility, self.game)


if __name__ == "__main__":
    unittest.main()
