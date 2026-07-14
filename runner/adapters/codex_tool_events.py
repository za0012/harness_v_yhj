#!/usr/bin/env python3
"""Normalize Codex tool calls and outputs into linked Flight Recorder events."""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from typing import Any


EXIT_CODE_PATTERN = re.compile(r"(?:exit code|exit_code)\s*[:=]\s*(-?\d+)", re.IGNORECASE)
FAILED_STATUS_PATTERN = re.compile(r"\b(?:failed|failure|timed out|timeout|error)\b", re.IGNORECASE)
VALIDATION_COMMAND_PATTERN = re.compile(
    r"(?:^|[\s;&|])(?:"
    r"(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:test|build|lint|typecheck|check|audit)\b|"
    r"node(?:\.exe)?\s+--check\b|"
    r"(?:pytest|vitest|jest|playwright|cypress|eslint|ruff|mypy)\b|"
    r"(?:tsc|biome)(?:\.cmd)?\b|"
    r"(?:acceptance|smoke|harness-release)(?:\.[\w-]+)?\b"
    r")",
    re.IGNORECASE,
)


def compact(value: str, limit: int = 280) -> str:
    cleaned = " ".join(value.strip().split())
    return cleaned[:limit] + ("..." if len(cleaned) > limit else "")


def parse_arguments(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {"raw": value}
    return parsed if isinstance(parsed, dict) else {"raw": value}


def output_text(payload: dict[str, Any]) -> str:
    for key in ("output", "result", "content", "text", "stderr", "stdout"):
        value = payload.get(key)
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, list):
            pieces = [str(item.get("text") or item.get("content") or "") if isinstance(item, dict) else str(item) for item in value]
            text = "\n".join(piece for piece in pieces if piece).strip()
            if text:
                return text
    return ""


def parse_exit_code(payload: dict[str, Any], output: str) -> int | None:
    for key in ("exit_code", "return_code", "status_code"):
        value = payload.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            return int(value)
    match = EXIT_CODE_PATTERN.search(output)
    return int(match.group(1)) if match else None


def is_failed_result(payload: dict[str, Any], output: str, exit_code: int | None) -> bool:
    if exit_code not in (None, 0):
        return True
    status = str(payload.get("status") or "")
    if FAILED_STATUS_PATTERN.search(status):
        return True
    return bool(re.search(r"\b(?:timed out|timeout)\b", output, re.IGNORECASE) and exit_code is None)


def is_validation_command(command: str) -> bool:
    return bool(command and VALIDATION_COMMAND_PATTERN.search(command))


def executable_name(command: str) -> str:
    stripped = command.strip().lstrip("& ")
    first = re.split(r"\s+", stripped, maxsplit=1)[0].strip("'\"") if stripped else ""
    first = first.replace("\\", "/").rsplit("/", 1)[-1].lower()
    return re.sub(r"\.(?:cmd|exe|ps1)$", "", first)


def meaningful_tokens(command: str) -> set[str]:
    tokens = re.findall(r"[a-zA-Z0-9_.-]+", command.lower())
    ignored = {"run", "cmd", "exe", "powershell", "pwsh", "command", "literalpath"}
    return {re.sub(r"\.(?:cmd|exe|ps1)$", "", token) for token in tokens if len(token) > 2 and token not in ignored}


def is_probable_retry(previous: dict[str, Any], current: dict[str, Any]) -> bool:
    if previous.get("tool_name") != current.get("tool_name"):
        return False
    before = str(previous.get("command") or "").strip()
    after = str(current.get("command") or "").strip()
    if not before or not after:
        return False
    if before.casefold() == after.casefold():
        return True
    if SequenceMatcher(None, before.casefold(), after.casefold()).ratio() >= 0.5:
        return True
    before_executable = executable_name(before)
    after_executable = executable_name(after)
    if before_executable and before_executable == after_executable:
        return bool(meaningful_tokens(before) & meaningful_tokens(after))
    return False


class ToolAttemptTracker:
    """Link tool calls/results and conservatively infer retries and validations."""

    def __init__(self, existing_events: list[dict[str, Any]] | None = None) -> None:
        self.calls: dict[str, dict[str, Any]] = {}
        self.pending_failure: dict[str, Any] | None = None
        self.calls_after_failure = 0
        for event in (existing_events or [])[-200:]:
            data = event.get("data") or {}
            call_id = data.get("call_id")
            if event.get("type") == "prompt" and data.get("role") == "user":
                self.pending_failure = None
                self.calls_after_failure = 0
            if event.get("type") == "tool_call" and isinstance(call_id, str):
                self.calls[call_id] = data
                if self.pending_failure:
                    self.calls_after_failure += 1
                    if self.calls_after_failure >= 3:
                        self.pending_failure = None
                        self.calls_after_failure = 0
            if event.get("type") == "error" and isinstance(call_id, str):
                self.pending_failure = data
                self.calls_after_failure = 0
            if event.get("type") == "retry":
                self.pending_failure = None
                self.calls_after_failure = 0

    def reset_retry_context(self) -> None:
        self.pending_failure = None
        self.calls_after_failure = 0

    def record_call(self, run_id: str, payload: dict[str, Any], source: str, timestamp: str | None, append_event: Any) -> int:
        arguments = parse_arguments(payload.get("arguments") or payload.get("input"))
        tool_name = str(payload.get("name") or payload.get("tool_name") or payload.get("type") or "tool")
        call_id = str(payload.get("call_id") or payload.get("id") or f"{tool_name}-{len(self.calls) + 1}")
        command = str(arguments.get("command") or arguments.get("cmd") or "")
        data = {
            "source": source,
            "timestamp": timestamp,
            "attempt_id": call_id,
            "call_id": call_id,
            "tool_name": tool_name,
            "arguments": arguments,
            "command": command,
            "workdir": arguments.get("workdir") or arguments.get("cwd"),
            "payload": payload,
        }
        imported = 0
        if self.pending_failure:
            self.calls_after_failure += 1
            if is_probable_retry(self.pending_failure, data):
                append_event(
                    run_id,
                    "retry",
                    f"{tool_name} 재시도",
                    {
                        **data,
                        "retry_of_call_id": self.pending_failure.get("call_id"),
                        "previous_command": self.pending_failure.get("command"),
                        "reason": "실패한 도구 호출과 유사한 명령을 다시 실행했습니다.",
                    },
                    timestamp=timestamp,
                )
                imported += 1
            if self.calls_after_failure >= 3 or imported:
                self.pending_failure = None
                self.calls_after_failure = 0
        append_event(run_id, "tool_call", f"{tool_name} 호출", data, timestamp=timestamp)
        self.calls[call_id] = data
        return imported + 1

    def record_result(self, run_id: str, payload: dict[str, Any], source: str, timestamp: str | None, append_event: Any) -> int:
        call_id = str(payload.get("call_id") or payload.get("id") or "")
        call = self.calls.get(call_id, {})
        output = output_text(payload)
        exit_code = parse_exit_code(payload, output)
        failed = is_failed_result(payload, output, exit_code)
        tool_name = str(call.get("tool_name") or payload.get("tool_name") or "tool")
        command = str(call.get("command") or "")
        validation = is_validation_command(command)
        data = {
            "source": source,
            "timestamp": timestamp,
            "attempt_id": call_id or call.get("attempt_id"),
            "call_id": call_id or call.get("call_id"),
            "tool_name": tool_name,
            "command": command,
            "workdir": call.get("workdir"),
            "exit_code": exit_code,
            "status": "failed" if failed else "passed",
            "is_validation": validation,
            "output": output,
            "payload": payload,
        }
        event_type = "error" if failed else "tool_result"
        summary = f"{tool_name} 실행 실패" if failed else f"{tool_name} 실행 완료"
        if exit_code is not None:
            summary += f" (exit {exit_code})"
        elif output:
            summary += f": {compact(output, 100)}"
        append_event(run_id, event_type, summary, data, timestamp=timestamp)
        imported = 1
        if validation:
            append_event(
                run_id,
                "validation",
                f"검증 {'실패' if failed else '통과'}: {compact(command, 140)}",
                {**data, "validation_status": "failed" if failed else "passed"},
                timestamp=timestamp,
            )
            imported += 1
        if failed:
            self.pending_failure = data
            self.calls_after_failure = 0
        return imported
