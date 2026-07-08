#!/usr/bin/env python3
"""Acceptance checks for the Flight Recorder product flow."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
os.environ["FLIGHT_RECORDER_DIR"] = str(ROOT / ".harness" / "acceptance-runs")
sys.path.insert(0, str(ROOT / "skills" / "agent-flight-recorder" / "scripts"))
sys.path.insert(0, str(ROOT / "runner" / "adapters"))

from codex_capture import import_transcript  # noqa: E402
from codex_exec_capture import import_jsonl  # noqa: E402
from codex_live_watcher import run_once as live_watch_once  # noqa: E402
from codex_rollout_capture import import_rollout_file  # noqa: E402
from trace_tools import append_event, compare, init_run, normalize_task, recommend  # noqa: E402


SAMPLE_TRANSCRIPT = """User: Build a Tool-Use Flight Recorder and Prompt Recommender.

Assistant: I will inspect the repo and validate the loop.

Tool: functions.shell_command
Command: rg --files

Exit code: 0
Output: src/App.tsx runner/supervisor.py

Tool: functions.shell_command
Command: node node_modules/typescript/bin/tsc -b

Exit code: 1
Output: TypeScript error in src/App.tsx

Retry: Fix the UI text and type error, then validate again.

Validation: tsc -b passed

Final: Completed. UI, trace engine, and adapter were updated and validated.
Duration: 94s
Tokens: 18200
Cost: $0.46
Success: true
"""


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def json_line(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def main() -> None:
    assert_true(
        normalize_task("Mission: explain how to build an uninterrupted harness") == "explain how to build an uninterrupted harness",
        "normalize_task should remove UI prefixes",
    )

    imported = import_transcript(SAMPLE_TRANSCRIPT, "log based prompt recommendation validation", slug="acceptance-import")
    analysis = imported["analysis"]
    recommendation = imported["recommendation"]
    counts = analysis["event_counts"]

    assert_true(imported["events_imported"] >= 8, "transcript import should create enough timeline events")
    assert_true(counts.get("prompt", 0) >= 1, "transcript import should record user prompt")
    assert_true(counts.get("model_response", 0) >= 1, "transcript import should record model response")
    assert_true(counts.get("tool_call", 0) >= 2, "transcript import should record tool calls")
    assert_true(counts.get("error", 0) >= 1, "transcript import should record failing tool result as error")
    assert_true(counts.get("retry", 0) >= 1, "transcript import should record retry")
    assert_true(counts.get("validation", 0) >= 1, "transcript import should record validation")
    assert_true("Trace evidence:" in recommendation["recommended_prompt"], "recommendation should include run evidence")
    assert_true("log based prompt recommendation validation" in recommendation["recommended_prompt"], "recommendation should include the task")
    assert_true("original_user_prompt" in recommendation, "recommendation should expose captured user prompt evidence")
    assert_true("Prompt fixes applied:" in recommendation["recommended_prompt"], "recommendation should explain what changed")

    before = init_run("acceptance-before", "make a harness quickly")["run_id"]
    append_event(before, "prompt", "user prompt recorded", {"role": "user", "content": "make a harness quickly"})
    append_event(before, "tool_call", "shell command", {"command": "pnpm build"})
    append_event(before, "error", "build failed", {"exit_code": 1})
    rec = recommend(before, "Mission: build log based recommendations")
    assert_true("build log based recommendations" in rec["recommended_prompt"], "recommend should use cleaned task")
    assert_true(any("재시도" in item for item in rec["retry_strategy"]), "recommend should include retry strategy")
    assert_true(rec.get("prompt_fixes"), "recommend should include issue-driven prompt fixes")

    compared = compare(before, imported["run_id"])
    assert_true(len(compared["metrics"]) == 6, "compare should expose six product metrics")
    assert_true(compared["after"]["validation_count"] >= 1, "after run should preserve validation count")

    codex_exec_run = init_run("acceptance-codex-exec-json", "codex exec json stream capture")["run_id"]
    codex_jsonl = [
        json_line({"type": "thread.started", "thread": {"id": "thr_accept"}}),
        json_line({"type": "turn.started", "turn": {"id": "turn_accept"}}),
        json_line({"type": "item.started", "item": {"type": "command", "tool_name": "Bash", "command": "rg --files"}}),
        json_line({"type": "item.completed", "item": {"type": "command", "tool_name": "Bash", "exit_code": 0, "output": "src/App.tsx"}}),
        json_line({"type": "item.agentMessage.delta", "delta": "Done."}),
        json_line({"type": "turn.completed", "turn": {"status": "completed"}}),
    ]
    parsed = import_jsonl(codex_exec_run, codex_jsonl)
    assert_true(parsed["events_imported"] == len(codex_jsonl), "codex exec JSONL importer should parse every line")
    codex_report = compare(before, codex_exec_run)["after"]
    assert_true(codex_report["tool_call_count"] >= 1, "codex exec JSONL should produce tool_call events")
    assert_true(codex_report["model_response_count"] >= 1, "codex exec JSONL should produce model_response events")

    rollout_fixture = ROOT / ".harness" / "acceptance-runs" / "rollout-fixture.jsonl"
    rollout_fixture.parent.mkdir(parents=True, exist_ok=True)
    rollout_fixture.write_text(
        "\n".join(
            [
                json_line({"type": "session_meta", "payload": {"base_instructions": {"text": "System instructions for recorder."}}}),
                json_line({"type": "turn_context", "payload": {"user_instructions": "Project instructions."}}),
                json_line({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Build the recorder UI."}]}}),
                json_line({"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "I inspected and validated it."}]}}),
                json_line({"type": "event_msg", "payload": {"type": "task_completed"}}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    rollout = import_rollout_file(
        rollout_fixture,
        "rollout import prompt evidence",
        thread_meta={"id": "thread_accept", "tokens_used": 1234, "created_at_ms": 1000, "updated_at_ms": 2500},
    )
    assert_true(rollout["analysis"]["prompt_count"] >= 3, "rollout import should capture system, developer, and user prompts")
    assert_true(rollout["analysis"]["model_response_count"] >= 1, "rollout import should capture model response")
    assert_true(rollout["analysis"]["metric_totals"]["token_count"] == 1234, "rollout import should capture token usage")
    assert_true(rollout["recommendation"].get("original_user_prompt"), "rollout recommendation should expose original prompt")

    live_run = init_run("acceptance-live-watch", "live watcher offset validation")["run_id"]
    live_args = type(
        "Args",
        (),
        {
            "run_id": live_run,
            "thread_id": None,
            "cwd": str(ROOT),
            "rollout_path": str(rollout_fixture),
            "mission": "live watcher offset validation",
        },
    )()
    first_tick = live_watch_once(live_args)
    second_tick = live_watch_once(live_args)
    assert_true(first_tick["events_imported"] >= 5, "live watcher should import rollout fixture events")
    assert_true(second_tick["events_imported"] == 0, "live watcher should resume from offset without duplicates")
    assert_true(second_tick["state"]["offset"] == first_tick["state"]["offset"], "live watcher should persist file offset")

    print("acceptance ok")


if __name__ == "__main__":
    main()
