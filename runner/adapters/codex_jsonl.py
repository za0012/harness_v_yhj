#!/usr/bin/env python3
"""Parse Codex rollout JSONL with user-facing reliability diagnostics."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


SUPPORTED_ROLLOUT_TYPES = {"session_meta", "turn_context", "response_item", "event_msg"}
MAX_REPORTED_ISSUES = 20


def _new_report(path: Path) -> dict[str, Any]:
    return {
        "status": "success",
        "path": str(path),
        "total_lines": 0,
        "non_empty_lines": 0,
        "parsed_lines": 0,
        "supported_lines": 0,
        "unsupported_lines": 0,
        "skipped_lines": 0,
        "issue_count": 0,
        "issues": [],
    }


def _add_issue(
    report: dict[str, Any],
    code: str,
    message: str,
    line: int | None = None,
) -> None:
    report["issue_count"] += 1
    if len(report["issues"]) >= MAX_REPORTED_ISSUES:
        return
    issue: dict[str, Any] = {"code": code, "message": message}
    if line is not None:
        issue["line"] = line
    report["issues"].append(issue)


def parse_rollout_jsonl(path: str | Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return valid object rows and a report without hiding malformed input."""

    source = Path(path)
    report = _new_report(source)
    items: list[dict[str, Any]] = []

    if not source.exists():
        report["status"] = "failed"
        _add_issue(report, "FILE_NOT_FOUND", "선택한 rollout JSONL 파일을 찾을 수 없습니다.")
        return items, report
    if not source.is_file():
        report["status"] = "failed"
        _add_issue(report, "NOT_A_FILE", "선택한 경로가 JSONL 파일이 아닙니다.")
        return items, report

    try:
        with source.open("r", encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                report["total_lines"] += 1
                line = raw_line.strip()
                if not line:
                    continue
                report["non_empty_lines"] += 1
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError as error:
                    report["skipped_lines"] += 1
                    _add_issue(
                        report,
                        "INVALID_JSON",
                        f"JSON 형식이 올바르지 않습니다: {error.msg}",
                        line_number,
                    )
                    continue
                if not isinstance(payload, dict):
                    report["skipped_lines"] += 1
                    _add_issue(
                        report,
                        "NON_OBJECT_JSON",
                        "Codex 이벤트는 JSON 객체여야 합니다.",
                        line_number,
                    )
                    continue
                items.append(payload)
                report["parsed_lines"] += 1
                if payload.get("type") in SUPPORTED_ROLLOUT_TYPES:
                    report["supported_lines"] += 1
                else:
                    report["unsupported_lines"] += 1
    except (OSError, UnicodeError) as error:
        report["status"] = "failed"
        _add_issue(report, "READ_ERROR", f"rollout JSONL을 읽을 수 없습니다: {error}")
        return [], report

    if report["non_empty_lines"] == 0:
        report["status"] = "empty"
        _add_issue(report, "EMPTY_FILE", "rollout JSONL 파일이 비어 있습니다.")
    elif report["parsed_lines"] == 0:
        report["status"] = "failed"
        _add_issue(report, "NO_VALID_JSON", "분석할 수 있는 JSON 객체를 찾지 못했습니다.")
    elif report["supported_lines"] == 0:
        report["status"] = "failed"
        _add_issue(
            report,
            "NO_SUPPORTED_EVENTS",
            "JSONL은 읽었지만 지원하는 Codex 실행 이벤트를 찾지 못했습니다.",
        )
    elif report["skipped_lines"] > 0:
        report["status"] = "partial"

    return items, report
