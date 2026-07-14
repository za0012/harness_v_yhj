#!/usr/bin/env python3
"""Smoke test for Codex rollout import timestamp and context filtering."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "runner" / "adapters"))

from codex_rollout_capture import import_rollout_file  # noqa: E402


RUN_ID = "smoke-codex-rollout-filter"
RUN_DIR = ROOT / ".harness" / "runs" / RUN_ID
ROLL_OUT = ROOT / ".harness" / "imports" / "codex-rollout-smoke.jsonl"


def write_rollout() -> None:
    ROLL_OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "timestamp": "2026-07-08T15:00:01+09:00",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": "# AGENTS.md instructions for repo\n<INSTRUCTIONS>\nignore display\n</INSTRUCTIONS>",
            },
        },
        {
            "timestamp": "2026-07-08T15:03:12+09:00",
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": "실시간 탐지 타임라인 시간을 원본 이벤트 기준으로 보여줘",
            },
        },
        {
            "timestamp": "2026-07-08T15:03:13+09:00",
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": "실시간 탐지 타임라인 시간을 원본 이벤트 기준으로 보여줘",
                "images": [],
                "local_images": [],
                "text_elements": [],
            },
        },
        {
            "timestamp": "2026-07-08T15:04:30+09:00",
            "type": "event_msg",
            "payload": {"type": "agent_message", "message": "확인했습니다."},
        },
        {
            "timestamp": "2026-07-08T15:04:33+09:00",
            "type": "response_item",
            "payload": {"type": "message", "role": "assistant", "content": "확인했습니다."},
        },
        {
            "timestamp": "2026-07-08T15:04:35+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "shell_command",
                "arguments": json.dumps({"command": "npm --version", "workdir": "C:/fixture"}),
                "call_id": "call-failed",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:36+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call-failed",
                "output": "Exit code: 1\nOutput:\nPowerShell execution policy blocked npm.ps1",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:40+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "shell_command",
                "arguments": json.dumps({"command": "npm.cmd --version", "workdir": "C:/fixture"}),
                "call_id": "call-retry",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:41+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call-retry",
                "output": "Exit code: 0\nOutput:\n10.9.2",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:50+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "shell_command",
                "arguments": json.dumps({"command": "npm.cmd run build", "workdir": "C:/fixture"}),
                "call_id": "call-validation",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:51+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call-validation",
                "output": "Exit code: 0\nOutput:\nbuild passed",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:52+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "shell_command",
                "arguments": json.dumps({"command": "node --check src/main.js", "workdir": "C:/fixture"}),
                "call_id": "call-syntax-validation",
            },
        },
        {
            "timestamp": "2026-07-08T15:04:53+09:00",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call-syntax-validation",
                "output": "Exit code: 0\nOutput:\n",
            },
        },
        {
            "timestamp": "2026-07-08T15:05:44+09:00",
            "type": "event_msg",
            "payload": {"type": "turn_completed"},
        },
    ]
    ROLL_OUT.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


def main() -> None:
    if RUN_DIR.exists():
        shutil.rmtree(RUN_DIR)
    write_rollout()
    result = import_rollout_file(ROLL_OUT, "rollout timestamp smoke", run_id=RUN_ID)
    events = [json.loads(line) for line in (RUN_DIR / "events.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    user_prompts = [event for event in events if event.get("type") == "prompt" and (event.get("data") or {}).get("role") == "user"]
    model_responses = [event for event in events if event.get("type") == "model_response"]
    timestamps = [event.get("timestamp") for event in events]
    event_counts = result["analysis"]["event_counts"]

    failures: list[str] = []
    if any("# AGENTS.md" in ((event.get("data") or {}).get("content") or "") for event in user_prompts):
        failures.append("injected AGENTS context was recorded as a user prompt")
    if len(user_prompts) != 1:
        failures.append(f"expected one real user prompt, got {len(user_prompts)}")
    if len(model_responses) != 1:
        failures.append(f"expected one model response after dedupe, got {len(model_responses)}")
    if "2026-07-08T15:03:12+09:00" not in timestamps or "2026-07-08T15:05:44+09:00" not in timestamps:
        failures.append("original rollout timestamps were not preserved")
    if event_counts.get("tool_call") != 4:
        failures.append(f"expected four tool calls, got {event_counts.get('tool_call', 0)}")
    if event_counts.get("error") != 1:
        failures.append(f"expected one failed tool result, got {event_counts.get('error', 0)}")
    if event_counts.get("retry") != 1:
        failures.append(f"expected one linked retry, got {event_counts.get('retry', 0)}")
    if event_counts.get("validation") != 2:
        failures.append(f"expected two validation events, got {event_counts.get('validation', 0)}")
    linked_retry = [event for event in events if (event.get("data") or {}).get("attempt_id") == "call-retry"]
    if {event.get("type") for event in linked_retry} != {"retry", "tool_call", "tool_result"}:
        failures.append("retry attempt events were not linked by attempt_id")

    payload = {
        "status": "failed" if failures else "passed",
        "run_id": result["run_id"],
        "events": len(events),
        "user_prompts": len(user_prompts),
        "model_responses": len(model_responses),
        "event_counts": event_counts,
        "timestamps": timestamps[:5],
        "failures": failures,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
