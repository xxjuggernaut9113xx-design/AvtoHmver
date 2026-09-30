"""Contract checks for the JSON Lines inference worker protocol."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WorkerProtocolTests(unittest.TestCase):
    def test_nudenet_version_and_batch_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "nudenet.py"
            fake.write_text(
                "__version__ = 'contract-test'\n"
                "class NudeDetector:\n"
                "    def detect_batch(self, paths):\n"
                "        return [[{'class': 'FEMALE_BREAST_EXPOSED', 'score': 0.9}] for _ in paths]\n",
                encoding="utf-8",
            )
            environment = os.environ.copy()
            environment["PYTHONPATH"] = directory
            requests = [
                {"protocol_version": 1, "id": 7, "paths": ["image-a", "image-b"]},
                {"protocol_version": 2, "id": 8, "paths": ["image-a"]},
            ]
            completed = subprocess.run(
                [sys.executable, str(ROOT / "workers" / "nsfw_worker.py")],
                input="".join(json.dumps(item) + "\n" for item in requests),
                text=True,
                capture_output=True,
                env=environment,
                timeout=10,
                check=True,
            )
            messages = [json.loads(line) for line in completed.stdout.splitlines()]
            self.assertEqual(len(messages), 3)
            self.assertTrue(messages[0]["ready"])
            self.assertTrue(all(item["protocol_version"] == 1 for item in messages))
            self.assertEqual(messages[1]["id"], 7)
            self.assertEqual(len(messages[1]["results"]), 2)
            self.assertEqual(messages[2]["id"], 8)
            self.assertIn("unsupported worker protocol", messages[2]["error"])

    def test_action_worker_unavailable_response_has_version(self):
        with tempfile.TemporaryDirectory() as directory:
            completed = subprocess.run(
                [sys.executable, str(ROOT / "workers" / "action_worker.py"),
                 "--environment", directory],
                text=True,
                capture_output=True,
                timeout=10,
            )
            self.assertEqual(completed.returncode, 1)
            message = json.loads(completed.stdout)
            self.assertEqual(message["protocol_version"], 1)
            self.assertFalse(message["ready"])


if __name__ == "__main__":
    unittest.main()
