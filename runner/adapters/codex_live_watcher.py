#!/usr/bin/env python3
"""Watch local Codex rollout JSONL files and mirror new events into a run."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parents[2]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
sys.path.insert(0, str(TRACE_TOOLS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from codex_rollout_capture import append_decision_once, find_thread, is_injected_context, record_agent_message_event, record_model_response_once, record_prompt_once, record_user_message_event, text_from_content  # noqa: E402
from codex_tool_events import ToolAttemptTracker  # noqa: E402
from trace_tools import analyze, append_event, init_run, read_events, recommend, record_metric, record_model_response, record_prompt  # noqa: E402


RUNS_DIR = Path(os.environ.get("FLIGHT_RECORDER_DIR", ROOT / ".harness" / "runs"))


def compact(value: str, limit: int = 240) -> str:
    cleaned = " ".join(value.strip().split())
    return cleaned[:limit] + ("..." if len(cleaned) > limit else "")


def watcher_state_path(run_id: str) -> Path:
    return RUNS_DIR / run_id / "live-watcher.json"


def read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def decode_line(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line:
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"type": "raw", "payload": {"text": line}}
    return payload if isinstance(payload, dict) else None


def mirror_rollout_item(run_id: str, item: dict[str, Any], tool_attempts: ToolAttemptTracker) -> int:
    event_type = item.get("type")
    payload = item.get("payload") or {}
    timestamp = item.get("timestamp")

    if event_type == "session_meta":
        session_payload = payload if isinstance(payload, dict) else {}
        base_text = text_from_content(session_payload.get("base_instructions"))
        count = 0
        if base_text and record_prompt_once(run_id, "system", base_text, "base_instructions", "codex-live", timestamp):
            count += 1
        if append_decision_once(run_id, "Codex session metadata imported", {"source": "codex-live", "timestamp": timestamp, "payload": session_payload}, timestamp):
            count += 1
        return count

    if event_type == "turn_context" and isinstance(payload, dict):
        user_instructions = payload.get("user_instructions")
        count = 0
        if isinstance(user_instructions, str) and user_instructions.strip() and record_prompt_once(run_id, "developer", user_instructions, "project_instructions", "codex-live", timestamp):
            count += 1
        append_event(run_id, "decision", "Codex turn context imported", {"source": "codex-live", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
        return count + 1

    if event_type == "response_item" and isinstance(payload, dict):
        payload_type = payload.get("type")
        role = payload.get("role")
        content = text_from_content(payload.get("content"))
        if payload_type == "message" and role in {"user", "developer", "system"}:
            if role == "user" and is_injected_context(content):
                append_event(run_id, "decision", "Injected Codex context skipped", {"source": "codex-live", "timestamp": timestamp, "role": role}, timestamp=timestamp)
                return 1
            if role == "user":
                tool_attempts.reset_retry_context()
            return 1 if record_prompt_once(run_id, str(role), content, "conversation", "codex-live", timestamp) else 0
        if payload_type == "message" and role in {"assistant", "model"}:
            return 1 if record_model_response_once(run_id, content, "codex-live", timestamp) else 0
        if payload_type in {"function_call", "tool_call", "local_shell_call"}:
            return tool_attempts.record_call(run_id, payload, "codex-live", timestamp, append_event)
        if payload_type in {"function_call_output", "tool_result", "local_shell_call_output"}:
            return tool_attempts.record_result(run_id, payload, "codex-live", timestamp, append_event)
        append_event(run_id, "decision", compact(content or str(payload_type)), {"source": "codex-live", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
        return 1

    if event_type == "event_msg" and isinstance(payload, dict):
        payload_type = str(payload.get("type") or "")
        if payload_type == "user_message":
            tool_attempts.reset_retry_context()
            return 1 if record_user_message_event(run_id, payload, "codex-live", timestamp) else 0
        if payload_type == "agent_message":
            return 1 if record_agent_message_event(run_id, payload, "codex-live", timestamp) else 0
        if payload_type in {"task_completed", "turn_completed", "task_finished", "task_complete"}:
            append_event(run_id, "outcome", "Codex turn completed", {"status": "completed", "source": "codex-live", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
        elif payload_type in {"task_failed", "turn_failed"}:
            append_event(run_id, "outcome", "Codex turn failed", {"status": "failed", "source": "codex-live", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
        elif payload_type == "token_count":
            token_info = payload.get("info") or {}
            total = token_info.get("total_token_usage") or {}
            tokens = total.get("total_tokens")
            record_metric(run_id, token_count=tokens if isinstance(tokens, int) else None, timestamp=timestamp)
        else:
            append_event(run_id, "decision", payload_type or "Codex event", {"source": "codex-live", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
        return 1

    append_event(run_id, "decision", compact(str(event_type)), {"source": "codex-live", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
    return 1


def read_new_lines(path: Path, offset: int) -> tuple[list[dict[str, Any]], int]:
    if not path.exists():
        return [], offset
    size = path.stat().st_size
    if offset > size:
        offset = 0
    items: list[dict[str, Any]] = []
    with path.open("rb") as handle:
        handle.seek(offset)
        for raw_line in handle:
            line = raw_line.decode("utf-8", errors="replace")
            item = decode_line(line)
            if item:
                items.append(item)
        return items, handle.tell()


def choose_thread(thread_id: str | None, cwd: str | None) -> dict[str, Any] | None:
    try:
        return find_thread(thread_id, cwd)
    except (sqlite3.Error, SystemExit):
        return None


def run_once(args: argparse.Namespace) -> dict[str, Any]:
    state = read_json(watcher_state_path(args.run_id), {})
    meta = {"id": "rollout-path", "rollout_path": args.rollout_path} if args.rollout_path else choose_thread(args.thread_id, args.cwd)
    if not meta:
        raise SystemExit("No matching Codex thread found.")
    rollout_path = meta.get("rollout_path")
    if not isinstance(rollout_path, str):
        raise SystemExit("Selected Codex thread has no rollout_path.")
    project_path = str(meta.get("cwd") or args.cwd or "")
    project_name = Path(project_path).name if project_path else ""

    previous_path = state.get("rollout_path")
    offset = int(state.get("offset", 0)) if previous_path == rollout_path else 0
    items, next_offset = read_new_lines(Path(rollout_path), offset)
    tool_attempts = ToolAttemptTracker(read_events(args.run_id))
    imported = sum(mirror_rollout_item(args.run_id, item, tool_attempts) for item in items)
    analysis = analyze(args.run_id)
    recommendation = recommend(args.run_id, args.mission)
    state.update(
        {
            "status": "watching",
            "thread_id": meta.get("id"),
            "cwd": project_path,
            "project_path": project_path,
            "project_name": project_name,
            "rollout_path": rollout_path,
            "offset": next_offset,
            "events_imported": int(state.get("events_imported", 0)) + imported,
            "last_seen_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "analysis_event_count": analysis.get("event_count"),
        }
    )
    write_json(watcher_state_path(args.run_id), state)
    return {
        "run_id": args.run_id,
        "thread_id": meta.get("id"),
        "cwd": project_path,
        "project_path": project_path,
        "project_name": project_name,
        "rollout_path": rollout_path,
        "events_imported": imported,
        "offset": next_offset,
        "analysis": analysis,
        "recommendation": recommendation,
        "state": state,
    }


def watch(args: argparse.Namespace) -> None:
    if args.run_id:
        run_id = args.run_id
    else:
        created = init_run(args.slug, args.mission)
        run_id = created["run_id"]
        args.run_id = run_id

    state = read_json(watcher_state_path(run_id), {})
    initial_project_path = str(args.cwd or "")
    state.update({
        "status": "starting",
        "run_id": run_id,
        "mission": args.mission,
        "cwd": initial_project_path,
        "project_path": initial_project_path,
        "project_name": Path(initial_project_path).name if initial_project_path else "",
    })
    write_json(watcher_state_path(run_id), state)
    print(json.dumps({
        "status": "started",
        "run_id": run_id,
        "cwd": initial_project_path,
        "project_path": initial_project_path,
        "project_name": Path(initial_project_path).name if initial_project_path else "",
    }, ensure_ascii=False), flush=True)

    while True:
        try:
            result = run_once(args)
            print(json.dumps({
                "status": "tick",
                "run_id": run_id,
                "events_imported": result["events_imported"],
                "cwd": result.get("cwd"),
                "project_path": result.get("project_path"),
                "project_name": result.get("project_name"),
                "rollout_path": result.get("rollout_path"),
            }, ensure_ascii=False), flush=True)
        except Exception as error:  # noqa: BLE001 - watcher should stay alive and report recoverable failures.
            state = read_json(watcher_state_path(run_id), {})
            state.update({"status": "recovering", "run_id": run_id, "last_error": str(error), "last_seen_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
            write_json(watcher_state_path(run_id), state)
            print(json.dumps({"status": "recovering", "run_id": run_id, "error": str(error)}, ensure_ascii=False), flush=True)
        time.sleep(args.interval)


def status(run_id: str) -> dict[str, Any]:
    state = read_json(watcher_state_path(run_id), {"status": "unknown", "run_id": run_id})
    return state


def main() -> None:
    parser = argparse.ArgumentParser(description="Watch Codex rollout JSONL and append live events to a Flight Recorder run")
    parser.add_argument("command", choices=["watch", "once", "status"])
    parser.add_argument("--run-id")
    parser.add_argument("--slug", default="codex-live")
    parser.add_argument("--mission", default="Codex Desktop 실시간 감시")
    parser.add_argument("--cwd", default=str(ROOT))
    parser.add_argument("--thread-id")
    parser.add_argument("--rollout-path")
    parser.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args()

    if args.command == "watch":
        watch(args)
        return
    if args.command == "once":
        if not args.run_id:
            created = init_run(args.slug, args.mission)
            args.run_id = created["run_id"]
        print(json.dumps(run_once(args), ensure_ascii=False, indent=2))
        return
    if not args.run_id:
        raise SystemExit("--run-id is required for status")
    print(json.dumps(status(args.run_id), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
