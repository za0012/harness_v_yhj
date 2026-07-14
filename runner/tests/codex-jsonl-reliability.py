#!/usr/bin/env python3
"""Reliability checks for empty, malformed, partial, and unsupported rollout JSONL."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = ROOT / ".harness" / "jsonl-reliability-runs"
FIXTURES = ROOT / "runner" / "tests" / "fixtures" / "codex-rollout"
os.environ["FLIGHT_RECORDER_DIR"] = str(RUNS_DIR)
sys.path.insert(0, str(ROOT / "skills" / "agent-flight-recorder" / "scripts"))
sys.path.insert(0, str(ROOT / "runner" / "adapters"))

from codex_jsonl import parse_rollout_jsonl  # noqa: E402
from codex_rollout_capture import import_rollout_file  # noqa: E402
from trace_tools import read_events  # noqa: E402


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def issue_codes(report: dict) -> set[str]:
    return {str(issue.get("code")) for issue in report.get("issues", [])}


def main() -> None:
    if RUNS_DIR.exists():
        shutil.rmtree(RUNS_DIR)

    valid = import_rollout_file(FIXTURES / "real-rollout-sanitized.jsonl", "sanitized real rollout", run_id="reliability-valid")
    assert_true(valid["status"] == "success", "sanitized real rollout should import successfully")
    assert_true(valid["parse_report"]["supported_lines"] == 7, "valid fixture should expose seven supported lines")
    assert_true(valid["analysis"]["tool_call_count"] == 1, "valid fixture should create a linked tool call")

    partial = import_rollout_file(FIXTURES / "mixed-valid-invalid.jsonl", "partial rollout", run_id="reliability-partial")
    partial_events = read_events("reliability-partial")
    assert_true(partial["status"] == "partial", "mixed fixture should be reported as partial")
    assert_true(partial["parse_report"]["skipped_lines"] == 1, "mixed fixture should skip exactly one broken line")
    assert_true("INVALID_JSON" in issue_codes(partial["parse_report"]), "mixed fixture should explain the invalid JSON line")
    assert_true(any(event.get("type") == "prompt" for event in partial_events), "valid rows should still be imported")
    assert_true(any(event.get("type") == "tool_call" for event in partial_events), "tool call before a broken result should remain visible")

    truncated = import_rollout_file(FIXTURES / "truncated-tail.jsonl", "truncated rollout", run_id="reliability-truncated")
    assert_true(truncated["status"] == "partial", "truncated tail should preserve earlier valid rows")
    assert_true(truncated["parse_report"]["skipped_lines"] == 1, "truncated tail should report one skipped line")

    empty = import_rollout_file(FIXTURES / "empty.jsonl", "empty rollout")
    assert_true(empty["status"] == "empty" and empty["run_id"] is None, "empty input must not create a meaningless run")
    assert_true("EMPTY_FILE" in issue_codes(empty["parse_report"]), "empty input should have an actionable issue code")

    malformed = import_rollout_file(FIXTURES / "malformed-only.jsonl", "malformed rollout")
    assert_true(malformed["status"] == "failed" and malformed["run_id"] is None, "fully malformed input must fail without a run")
    assert_true(malformed["parse_report"]["skipped_lines"] == 3, "all malformed fixture lines should be counted")
    assert_true("NO_VALID_JSON" in issue_codes(malformed["parse_report"]), "fully malformed input should explain that no JSON objects survived")

    unsupported = import_rollout_file(FIXTURES / "unsupported-events.jsonl", "unsupported rollout")
    assert_true(unsupported["status"] == "failed" and unsupported["run_id"] is None, "unsupported events must not create a run")
    assert_true("NO_SUPPORTED_EVENTS" in issue_codes(unsupported["parse_report"]), "unsupported events should be distinguished from malformed JSON")

    missing_items, missing_report = parse_rollout_jsonl(FIXTURES / "missing.jsonl")
    assert_true(not missing_items and missing_report["status"] == "failed", "missing file should return a structured failure")
    assert_true("FILE_NOT_FOUND" in issue_codes(missing_report), "missing file should explain that the path does not exist")

    payload = {
        "status": "passed",
        "fixtures": 7,
        "valid_supported_lines": valid["parse_report"]["supported_lines"],
        "partial_skipped_lines": partial["parse_report"]["skipped_lines"],
        "validated_states": ["success", "partial", "empty", "failed"],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
