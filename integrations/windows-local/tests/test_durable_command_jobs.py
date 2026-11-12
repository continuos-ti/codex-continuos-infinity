import json
import base64
import hashlib
import os
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from durable_command_jobs import (
    DurableCommandJobs,
    build_powershell_job_script,
    probe_windows_process,
)


class FakeProcess:
    def __init__(self, return_code=None):
        self.return_code = return_code

    def wait(self, timeout=None):
        if self.return_code is None:
            raise subprocess.TimeoutExpired("fake", timeout)
        return self.return_code

    def poll(self):
        return self.return_code


class DurableCommandJobsTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.store = DurableCommandJobs(self.root, process_probe=lambda _pid, _created: "running")
        self.operation_id = "call_" + "A" * 32

    def tearDown(self):
        self.temp_dir.cleanup()

    def reserve(self):
        return self.store.reserve(
            self.operation_id,
            self.store.epoch,
            "Get-Date",
            r"E:\Projetos",
        )

    def test_same_operation_id_and_arguments_are_idempotent(self):
        first, created = self.reserve()
        second, created_again = self.reserve()

        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["operation_id"], second["operation_id"])
        self.assertEqual(first["args_digest"], second["args_digest"])

    def test_reusing_operation_id_with_different_arguments_is_rejected(self):
        self.reserve()

        with self.assertRaisesRegex(ValueError, "different command arguments"):
            self.store.reserve(
                self.operation_id,
                self.store.epoch,
                "Remove-Item -Recurse",
                r"E:\Projetos",
            )

    def test_concurrent_reservations_create_only_one_operation(self):
        def reserve_once():
            return self.store.reserve(
                self.operation_id,
                self.store.epoch,
                "Get-Date",
                r"E:\Projetos",
            )[1]

        with ThreadPoolExecutor(max_workers=8) as pool:
            created = list(pool.map(lambda _: reserve_once(), range(8)))

        self.assertEqual(sum(created), 1)

    def test_running_state_survives_store_reconstruction(self):
        record, _ = self.reserve()
        marker = {
            "pid": 4242,
            "process_created_filetime": 133700000000000000,
        }
        Path(record["start_path"]).write_text(json.dumps(marker), encoding="utf-8")
        restarted = DurableCommandJobs(self.root, process_probe=lambda _pid, _created: "running")

        result = restarted.result(self.operation_id, self.store.epoch)

        self.assertEqual(result["status"], "running")
        self.assertTrue(result["running"])

    def test_exit_marker_survives_store_reconstruction(self):
        record, _ = self.reserve()
        Path(record["exit_path"]).write_text("7", encoding="ascii")
        restarted = DurableCommandJobs(self.root)

        result = restarted.result(self.operation_id, self.store.epoch)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["exit_code"], 7)
        self.assertFalse(result["running"])

    def test_missing_process_and_exit_marker_remains_unknown(self):
        record, _ = self.reserve()
        marker = {
            "pid": 4242,
            "process_created_filetime": 133700000000000000,
        }
        Path(record["start_path"]).write_text(json.dumps(marker), encoding="utf-8")
        restarted = DurableCommandJobs(self.root, process_probe=lambda _pid, _created: "unknown")

        result = restarted.result(self.operation_id, self.store.epoch)

        self.assertEqual(result["status"], "unknown")
        self.assertIn("no durable exit code was recorded", result["message"])

    def test_process_exit_code_is_persisted(self):
        self.reserve()

        result = self.store.result(
            self.operation_id,
            self.store.epoch,
            process=FakeProcess(return_code=9),
            wait_seconds=1,
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["exit_code"], 9)

    def test_provider_epoch_mismatch_is_not_treated_as_not_found(self):
        self.reserve()

        result = self.store.result(self.operation_id, "0" * 32)

        self.assertEqual(result["status"], "provider_changed")
        self.assertFalse(result["running"])

    def test_missing_record_is_reported_as_non_authoritative(self):
        result = self.store.result(self.operation_id, self.store.epoch)

        self.assertEqual(result["status"], "not_found")
        self.assertIn("does not prove", result["message"])

    def test_missing_record_requires_provider_epoch_for_reconciliation(self):
        result = self.store.result(self.operation_id)

        self.assertEqual(result["status"], "epoch_required")
        self.assertIn("provider_epoch is required", result["message"])

    def test_orphaned_operation_directory_cannot_be_reused(self):
        (self.store.jobs_dir / self.operation_id).mkdir(parents=True)

        with self.assertRaisesRegex(RuntimeError, "orphaned operation directory"):
            self.reserve()

    def test_invalid_operation_id_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsupported format"):
            self.store.reserve("unsafe/operation", self.store.epoch, "Get-Date", r"E:\Projetos")

    def test_explicit_operation_id_requires_provider_epoch(self):
        with self.assertRaisesRegex(ValueError, "provider_epoch is required"):
            self.store.reserve(self.operation_id, None, "Get-Date", r"E:\Projetos")

        self.assertIsNone(self.store._load(self.operation_id))

    def test_legacy_command_without_operation_id_uses_new_uuid(self):
        record, created = self.store.reserve(None, None, "Get-Date", r"E:\Projetos")

        self.assertTrue(created)
        self.assertEqual(len(record["operation_id"]), 36)
        self.assertIsNotNone(self.store._load(record["operation_id"]))

    def test_screenshot_metadata_survives_store_reconstruction(self):
        screenshot_id = "8a4d3f70-2a11-4a0d-9d45-2f8f7d1c2a90"
        shot = {
            "captured_at": time.time(),
            "left": -1920,
            "top": 0,
            "sx": 1.5,
            "sy": 1.5,
            "width": 2400,
            "height": 1200,
            "foreground": "123456",
        }
        self.store.save_screenshot(screenshot_id, shot)
        restarted = DurableCommandJobs(self.root)

        restored = restarted.load_screenshot(screenshot_id)

        self.assertIsNotNone(restored)
        self.assertEqual(restored["screenshot_id"], screenshot_id)
        self.assertEqual(restored["foreground"], shot["foreground"])
        self.assertEqual(restored["left"], shot["left"])
        self.assertEqual(restored["width"], shot["width"])

    def test_clear_screenshots_invalidates_persisted_ids(self):
        screenshot_id = "8a4d3f70-2a11-4a0d-9d45-2f8f7d1c2a90"
        self.store.save_screenshot(screenshot_id, {
            "captured_at": time.time(),
            "left": 0,
            "top": 0,
            "sx": 1.0,
            "sy": 1.0,
            "width": 1200,
            "height": 800,
            "foreground": "123456",
        })

        self.store.clear_screenshots()

        self.assertIsNone(self.store.load_screenshot(screenshot_id))

    def test_invalid_screenshot_metadata_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid durable screenshot metadata"):
            self.store.save_screenshot("invalid-id", {})

    def test_nonfinite_screenshot_metadata_is_rejected(self):
        screenshot_id = "8a4d3f70-2a11-4a0d-9d45-2f8f7d1c2a90"
        shot = {
            "captured_at": time.time(),
            "left": 0,
            "top": 0,
            "sx": 1.0,
            "sy": 1.0,
            "width": 1200,
            "height": 800,
            "foreground": "123456",
        }
        for field, invalid_value in (("captured_at", float("nan")),
                                     ("captured_at", float("inf")),
                                     ("captured_at", 0),
                                     ("sx", float("nan")),
                                     ("sy", float("inf"))):
            with self.subTest(field=field, invalid_value=invalid_value):
                with self.assertRaisesRegex(ValueError, "Invalid durable screenshot"):
                    self.store.save_screenshot(screenshot_id, {**shot, field: invalid_value})
        self.assertIsNone(self.store.load_screenshot(screenshot_id))

    @unittest.skipUnless(os.name == "nt", "PowerShell process marker test requires Windows")
    def test_powershell_script_writes_start_and_exit_markers(self):
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        with tempfile.TemporaryDirectory() as directory:
            start_path = str(Path(directory) / "start.json")
            exit_path = str(Path(directory) / "exit_code.txt")
            script = build_powershell_job_script("Write-Output 'durable-job-test'", start_path, exit_path)
            encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")

            completed = subprocess.run(
                [str(powershell), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                capture_output=True,
                timeout=20,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr.decode(errors="replace"))
            self.assertTrue(Path(start_path).is_file())
            self.assertEqual(Path(exit_path).read_text(encoding="ascii"), "0")

    @unittest.skipUnless(os.name == "nt", "PowerShell process marker test requires Windows")
    def test_powershell_script_records_nonzero_native_exit_code(self):
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        with tempfile.TemporaryDirectory() as directory:
            start_path = str(Path(directory) / "start.json")
            exit_path = str(Path(directory) / "exit_code.txt")
            script = build_powershell_job_script("cmd.exe /c exit 17", start_path, exit_path)
            encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")

            completed = subprocess.run(
                [str(powershell), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                capture_output=True,
                timeout=20,
            )

            self.assertEqual(completed.returncode, 17)
            self.assertEqual(Path(exit_path).read_text(encoding="ascii"), "17")

    @unittest.skipUnless(os.name == "nt", "PowerShell process marker test requires Windows")
    def test_powershell_finally_runs_when_command_uses_exit(self):
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        with tempfile.TemporaryDirectory() as directory:
            start_path = str(Path(directory) / "start.json")
            exit_path = str(Path(directory) / "exit_code.txt")
            script = build_powershell_job_script("exit 23", start_path, exit_path)
            encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")

            completed = subprocess.run(
                [str(powershell), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                capture_output=True,
                timeout=20,
            )

            self.assertEqual(completed.returncode, 23)
            self.assertTrue(Path(exit_path).is_file())
            self.assertEqual(Path(exit_path).read_text(encoding="ascii"), "23")

    @unittest.skipUnless(os.name == "nt", "PowerShell process marker test requires Windows")
    def test_powershell_script_records_a_terminating_error(self):
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        with tempfile.TemporaryDirectory() as directory:
            start_path = str(Path(directory) / "start.json")
            exit_path = str(Path(directory) / "exit_code.txt")
            script = build_powershell_job_script("throw 'expected durable-job failure'", start_path, exit_path)
            encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")

            completed = subprocess.run(
                [str(powershell), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                capture_output=True,
                timeout=20,
            )

            self.assertEqual(completed.returncode, 1)
            self.assertEqual(Path(exit_path).read_text(encoding="ascii"), "1")

    @unittest.skipUnless(os.name == "nt", "Process reattachment test requires Windows")
    def test_running_command_can_be_reattached_after_store_reconstruction(self):
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        record, created = self.reserve()
        self.assertTrue(created)
        output_dir = self.root / "transient-output"
        output_dir.mkdir()
        stdout_path = output_dir / "stdout.txt"
        stderr_path = output_dir / "stderr.txt"
        self.store.set_output_paths(self.operation_id, str(stdout_path), str(stderr_path))
        script = build_powershell_job_script("Start-Sleep -Seconds 4", record["start_path"], record["exit_path"])
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")

        with open(stdout_path, "wb") as stdout, open(stderr_path, "wb") as stderr:
            process = subprocess.Popen(
                [str(powershell), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                cwd=str(self.root),
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        self.store.mark_started(self.operation_id, process.pid)

        deadline = time.monotonic() + 5
        while not Path(record["start_path"]).is_file() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertTrue(Path(record["start_path"]).is_file())

        restarted = DurableCommandJobs(self.root, process_probe=probe_windows_process)
        running = restarted.result(self.operation_id, self.store.epoch)
        self.assertEqual(running["status"], "running")

        process.wait(timeout=10)
        completed = restarted.result(self.operation_id, self.store.epoch)
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["exit_code"], 0)


class ManifestIntegrityTests(unittest.TestCase):
    def test_manifest_hashes_match_sources(self):
        integration_root = Path(__file__).resolve().parents[1]
        manifest = json.loads((integration_root / "manifest.json").read_text(encoding="utf-8"))

        self.assertEqual(manifest["schemaVersion"], 1)
        for item in manifest["files"]:
            with self.subTest(path=item["path"]):
                source = integration_root / item["path"]
                actual = hashlib.sha256(source.read_bytes()).hexdigest()
                self.assertEqual(actual, item["sha256"])


if __name__ == "__main__":
    unittest.main()
