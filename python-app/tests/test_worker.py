import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from app.desktop import worker


class WorkerTests(unittest.TestCase):
    def test_failsafe_is_terminal_and_does_not_execute_another_request(self):
        class FailSafeException(Exception):
            pass

        fake = SimpleNamespace(FailSafeException=FailSafeException)
        namespace = {"pyautogui": fake, "counter": 0}
        requests = [
            {"id": 1, "operation": "execute", "code": "raise pyautogui.FailSafeException('corner')"},
            {"id": 2, "operation": "execute", "code": "counter = 99"},
        ]
        with patch.object(worker, "emit") as emit:
            worker.serve_requests(namespace, io.StringIO("\n".join(map(json.dumps, requests))))
        self.assertEqual(namespace["counter"], 0)
        for call in emit.call_args_list:
            self.assertEqual(call.args[0]["error"]["code"], "python_failsafe")
            self.assertNotIn("output", call.args[0])

    def test_execute_protocol_preserves_globals_images_and_recovery(self):
        requests = [
            {"id": 1, "operation": "execute", "code": 'counter = 41\nraise ValueError("retry")'},
            {"id": 2, "operation": "execute", "code": 'log(counter + 1, "café 😀")\ndisplay(image)'},
        ]
        namespace = {"image": Image.new("RGB", (13, 7))}
        with patch.object(worker, "emit") as emit:
            worker.serve_requests(namespace, io.StringIO("\n".join(map(json.dumps, requests))))
        self.assertEqual(emit.call_count, 2)
        self.assertIn("ValueError: retry", emit.call_args_list[0].args[0]["output"][-1]["text"])
        response = emit.call_args_list[1].args[0]
        self.assertEqual(response["id"], 2)
        self.assertEqual(response["output"][0]["text"], "42 café 😀")
        self.assertEqual(response["output"][1]["detail"], "original")
        self.assertTrue(base64.b64decode(response["output"][1]["image_url"].split(",")[1]).startswith(b"\x89PNG"))
        self.assertEqual(namespace["counter"], 41)

    def test_unsupported_operation_does_not_execute_code(self):
        with patch.object(worker, "emit") as emit:
            namespace = {"counter": 0}
            request = {"id": 1, "operation": "unknown", "code": "counter = 99"}
            worker.serve_requests(namespace, io.StringIO(json.dumps(request)))
            self.assertEqual(namespace["counter"], 0)
            self.assertEqual(emit.call_args.args[0]["error"]["code"], "unsupported_python_operation")

    def test_readiness_captures_a_normalized_screenshot(self):
        calls = []

        def screenshot():
            calls.append(True)
            return Image.new("RGB", (200, 100))

        fake = SimpleNamespace(size=lambda: (100, 50), screenshot=screenshot)
        worker.normalize_screenshots(fake)
        worker.check_screenshot(fake, (100, 50))
        self.assertEqual(calls, [True])

    def test_readiness_reports_a_broken_screenshot_backend(self):
        def screenshot():
            raise RuntimeError("capture failed")

        fake = SimpleNamespace(size=lambda: (100, 50), screenshot=screenshot)
        with self.assertRaisesRegex(RuntimeError, "capture failed"):
            worker.check_screenshot(fake, (100, 50))

    def test_import_from_an_unrelated_directory_with_safe_path_enabled(self):
        worker_path = worker.__file__
        env = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
        env.update(PYTHONSAFEPATH="1", PYTHONDONTWRITEBYTECODE="1")
        # Import only: this checks production module loading without desktop input.
        program = "import runpy, sys; ns = runpy.run_path(sys.argv[1], run_name='worker_import_test'); assert callable(ns['serve_requests'])"
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-c", program, worker_path],
                cwd=directory,
                env=env,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_syntax_error_does_not_execute_partial_code(self):
        namespace = {"counter": 41}
        output = worker.execute("counter = 99\nfor x in [1]]:\n    pass", namespace)
        self.assertIn("SyntaxError", output["output"][-1]["text"])
        self.assertEqual(namespace["counter"], 41)

    def test_retina_coordinates_and_region_match_mouse_coordinates(self):
        fake = SimpleNamespace(size=lambda: (100, 50), screenshot=lambda: Image.new("RGB", (200, 100)))
        worker.normalize_screenshots(fake)
        self.assertEqual(fake.screenshot().size, (100, 50))
        self.assertEqual(fake.screenshot(region=(10, 5, 30, 20)).size, (30, 20))

    def test_reports_absent_desktop(self):
        with self.assertRaisesRegex(RuntimeError, "No local desktop"):
            worker.check_desktop(SimpleNamespace(size=lambda: (0, 0)))
