"""Regression tests for complete and concurrent DEV receipt persistence."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from receipt_journal import record_tool_receipt


class ReceiptJournalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="dev-receipt-test-")
        self.addCleanup(self.temporary.cleanup)
        self.state = Path(self.temporary.name)

    def read_entries(self) -> list[dict]:
        return [json.loads(line) for line in (self.state / "tool-receipts.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()]

    def test_partial_writes_complete_before_acknowledgement(self) -> None:
        real_write = os.write

        def write_five_bytes(fd: int, data: memoryview) -> int:
            return real_write(fd, data[:5])

        with patch("receipt_journal.os.write", side_effect=write_five_bytes):
            record_tool_receipt(self.state, "a" * 32, "dev_echo", False)

        self.assertEqual(self.read_entries()[0]["receipt_id"], "a" * 32)
        self.assertEqual(self.read_entries()[0]["outcome"], "completed")

    def test_no_progress_rejects_acknowledgement(self) -> None:
        with patch("receipt_journal.os.write", return_value=0):
            with self.assertRaisesRegex(OSError, "no progress"):
                record_tool_receipt(self.state, "b" * 32, "dev_ping", False)

        self.assertEqual((self.state / "tool-receipts.jsonl").stat().st_size, 0)

    def test_partial_failure_preserves_previous_receipts(self) -> None:
        record_tool_receipt(self.state, "1" * 32, "dev_echo", False)
        real_write = os.write
        attempts = 0

        def write_then_stall(fd: int, data: memoryview) -> int:
            nonlocal attempts
            attempts += 1
            return real_write(fd, data[:7]) if attempts == 1 else 0

        with patch("receipt_journal.os.write", side_effect=write_then_stall):
            with self.assertRaisesRegex(OSError, "no progress"):
                record_tool_receipt(self.state, "2" * 32, "dev_ping", False)

        self.assertEqual([entry["receipt_id"] for entry in self.read_entries()], ["1" * 32])
        record_tool_receipt(self.state, "3" * 32, "dev_ping", False)
        self.assertEqual([entry["receipt_id"] for entry in self.read_entries()],
                         ["1" * 32, "3" * 32])

    def test_sync_failure_rejects_acknowledgement(self) -> None:
        with patch("receipt_journal.os.fsync", side_effect=OSError("sync failed")):
            with self.assertRaisesRegex(OSError, "sync failed"):
                record_tool_receipt(self.state, "c" * 32, "dev_ping", False)

    def test_concurrent_receipts_remain_separate(self) -> None:
        receipts = [f"{index:032x}" for index in range(24)]
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(lambda value: record_tool_receipt(
                self.state, value, "dev_read_fixture", True
            ), receipts))

        entries = self.read_entries()
        self.assertEqual({entry["receipt_id"] for entry in entries}, set(receipts))
        self.assertEqual(len(entries), len(receipts))
        self.assertTrue(all(entry["outcome"] == "error" for entry in entries))


if __name__ == "__main__":
    unittest.main()
