#!/usr/bin/env python3
"""Import local Codex rollout JSONL threads into Flight Recorder runs."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parents[2]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
sys.path.insert(0, str(TRACE_TOOLS))

from trace_tools import analyze, append_event, init_run, read_events, recommend, record_metric, record_model_response, record_prompt  # noqa: E402


CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
STATE_DB = CODEX_HOME / "state_5.sqlite"


def text_from_content(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or item.get("input_text")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts).strip()
    if isinstance(value, dict):
        for key in ("text", "content", "message", "output"):
            if isinstance(value.get(key), str):
                return value[key]
    return ""


def compact(value: str, limit: int = 240) -> str:
    cleaned = " ".join(value.strip().split())
    return cleaned[:limit] + ("..." if len(cleaned) > limit else "")


def comparable_text(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.strip().splitlines())


def is_injected_context(content: str) -> bool:
    cleaned = content.strip()
    if not cleaned:
        return True
    patterns = (
        r"^#\s*AGENTS\.md instructions",
        r"<environment_context>",
        r"</INSTRUCTIONS>",
        r"^The following is the Codex agent history",
        r"^We need continue from summary",
    )
    return any(re.search(pattern, cleaned, re.IGNORECASE) for pattern in patterns)


def cwd_variants(cwd: str | None) -> list[str]:
    if not cwd:
        return []
    value = str(cwd)
    prefix = "\\\\?\\"
    variants = [value]
    if value.startswith(prefix):
        variants.append(value[len(prefix):])
    else:
        variants.append(f"{prefix}{value}")
    return list(dict.fromkeys(variants))


def is_user_visible_thread(row: dict[str, Any]) -> bool:
    thread_source = str(row.get("thread_source") or "")
    if thread_source == "subagent":
        return False
    source = str(row.get("source") or "")
    if "subagent" in source.lower():
        return False
    title = str(row.get("title") or row.get("first_user_message") or "")
    if is_injected_context(title):
        return False
    return True


def connect_state() -> sqlite3.Connection:
    if not STATE_DB.exists():
        raise SystemExit(f"Codex state DB not found: {STATE_DB}")
    return sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True)


def find_thread(thread_id: str | None = None, cwd: str | None = None) -> dict[str, Any]:
    con = connect_state()
    con.row_factory = sqlite3.Row
    if thread_id:
        row = con.execute("select * from threads where id = ?", (thread_id,)).fetchone()
    elif cwd:
        variants = cwd_variants(cwd)
        placeholders = ",".join("?" for _ in variants)
        row = con.execute(
            f"select * from threads where cwd in ({placeholders}) and coalesce(thread_source, 'user') <> 'subagent' order by updated_at_ms desc, updated_at desc limit 1",
            variants,
        ).fetchone()
    else:
        row = con.execute("select * from threads where coalesce(thread_source, 'user') <> 'subagent' order by updated_at_ms desc, updated_at desc limit 1").fetchone()
    if not row:
        raise SystemExit("No matching Codex thread found.")
    result = dict(row)
    if not is_user_visible_thread(result):
        raise SystemExit("Selected Codex thread is an internal subagent thread.")
    return result


def list_threads(cwd: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
    con = connect_state()
    con.row_factory = sqlite3.Row
    if cwd:
        variants = cwd_variants(cwd)
        placeholders = ",".join("?" for _ in variants)
        rows = con.execute(
            f"select id, title, first_user_message, cwd, rollout_path, tokens_used, created_at_ms, updated_at_ms, thread_source, source, has_user_event from threads where cwd in ({placeholders}) and coalesce(thread_source, 'user') <> 'subagent' order by updated_at_ms desc, updated_at desc limit ?",
            (*variants, limit),
        ).fetchall()
    else:
        rows = con.execute(
            "select id, title, first_user_message, cwd, rollout_path, tokens_used, created_at_ms, updated_at_ms, thread_source, source, has_user_event from threads where coalesce(thread_source, 'user') <> 'subagent' order by updated_at_ms desc, updated_at desc limit ?",
            (limit,),
        ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        if not is_user_visible_thread(item):
            continue
        title = item.get("title") or compact(str(item.get("first_user_message") or "Untitled Codex thread"), 70)
        updated_ms = item.get("updated_at_ms")
        updated_label = ""
        if isinstance(updated_ms, int):
            updated_label = datetime.fromtimestamp(updated_ms / 1000).strftime("%m.%d %H:%M")
        short_id = str(item.get("id") or "")[-8:]
        tokens = item.get("tokens_used") if isinstance(item.get("tokens_used"), int) else None
        token_label = f"{tokens:,}tok" if tokens else "no token"
        item["label"] = " · ".join(part for part in [updated_label, compact(str(title), 70), token_label, short_id] if part)
        item["updated_label"] = updated_label
        item["short_id"] = short_id
        item["has_rollout"] = isinstance(item.get("rollout_path"), str) and bool(item.get("rollout_path"))
        item["is_internal"] = False
        result.append(item)
    return result


def record_user_message_event(run_id: str, payload: dict[str, Any], source: str, timestamp: str | None) -> bool:
    content = text_from_content(payload.get("message")) or text_from_content(payload.get("text_elements"))
    if not content:
        return False
    if is_injected_context(content):
        append_event(run_id, "decision", "Injected Codex context skipped", {"source": source, "timestamp": timestamp, "role": "user"}, timestamp=timestamp)
        return True
    return record_prompt_once(run_id, "user", content, "conversation", source, timestamp)


def record_agent_message_event(run_id: str, payload: dict[str, Any], source: str, timestamp: str | None) -> bool:
    content = text_from_content(payload.get("message")) or text_from_content(payload.get("last_agent_message"))
    if not content:
        return False
    return record_model_response_once(run_id, content, source, timestamp)


def record_prompt_once(run_id: str, role: str, content: str, prompt_kind: str, source: str, timestamp: str | None) -> bool:
    normalized = comparable_text(content)
    if any(
        event.get("type") == "prompt"
        and (event.get("data") or {}).get("role") == role
        and comparable_text(str((event.get("data") or {}).get("content") or "")) == normalized
        for event in read_events(run_id)[-80:]
    ):
        return False
    record_prompt(run_id, role, normalized, prompt_kind, source, timestamp=timestamp)
    return True


def record_model_response_once(run_id: str, content: str, source: str, timestamp: str | None) -> bool:
    normalized = comparable_text(content)
    if any(
        event.get("type") == "model_response"
        and comparable_text(str((event.get("data") or {}).get("content") or "")) == normalized
        for event in read_events(run_id)[-80:]
    ):
        return False
    record_model_response(run_id, normalized, source, timestamp=timestamp)
    return True


def append_decision_once(run_id: str, summary: str, data: dict[str, Any], timestamp: str | None) -> bool:
    if any(
        event.get("type") == "decision"
        and event.get("summary") == summary
        for event in read_events(run_id)[-120:]
    ):
        return False
    append_event(run_id, "decision", summary, data, timestamp=timestamp)
    return True


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                yield {"type": "raw", "payload": {"text": line}}
                continue
            if isinstance(payload, dict):
                yield payload


def import_rollout_file(
    rollout_path: str | Path,
    mission: str,
    run_id: str | None = None,
    slug: str = "codex-rollout",
    thread_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    path = Path(rollout_path)
    if not path.exists():
        raise SystemExit(f"Rollout file not found: {path}")
    created = {"run_id": run_id} if run_id else init_run(slug, mission)
    run_id = created["run_id"]
    imported = 0
    saw_outcome = False
    meta = thread_meta or {}

    for item in iter_jsonl(path):
        event_type = item.get("type")
        payload = item.get("payload") or {}
        timestamp = item.get("timestamp")

        if event_type == "session_meta":
            session_payload = payload if isinstance(payload, dict) else {}
            base = session_payload.get("base_instructions")
            base_text = text_from_content(base)
            if base_text and record_prompt_once(run_id, "system", base_text, "base_instructions", "codex-rollout", timestamp):
                imported += 1
            if append_decision_once(run_id, "Codex session metadata imported", {"source": "codex-rollout", "timestamp": timestamp, "payload": session_payload}, timestamp):
                imported += 1
            continue

        if event_type == "turn_context":
            if isinstance(payload, dict):
                user_instructions = payload.get("user_instructions")
                if isinstance(user_instructions, str) and user_instructions.strip() and record_prompt_once(run_id, "developer", user_instructions, "project_instructions", "codex-rollout", timestamp):
                    imported += 1
                append_event(run_id, "decision", "Codex turn context imported", {"source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
                imported += 1
            continue

        if event_type == "response_item" and isinstance(payload, dict):
            payload_type = payload.get("type")
            role = payload.get("role")
            content = text_from_content(payload.get("content"))
            if payload_type == "message" and role in {"user", "developer", "system"}:
                if role == "user" and is_injected_context(content):
                    append_event(run_id, "decision", "Injected Codex context skipped", {"source": "codex-rollout", "timestamp": timestamp, "role": role}, timestamp=timestamp)
                    imported += 1
                    continue
                if record_prompt_once(run_id, str(role), content, "conversation", "codex-rollout", timestamp):
                    imported += 1
                continue
            if payload_type == "message" and role in {"assistant", "model"}:
                if record_model_response_once(run_id, content, "codex-rollout", timestamp):
                    imported += 1
                continue
            if payload_type in {"function_call", "tool_call", "local_shell_call"}:
                name = payload.get("name") or payload.get("tool_name") or payload.get("call_id") or payload_type
                append_event(run_id, "tool_call", f"{name} 호출", {"source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
                imported += 1
                continue
            if payload_type in {"function_call_output", "tool_result", "local_shell_call_output"}:
                append_event(run_id, "tool_result", "도구 실행 결과", {"source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
                imported += 1
                continue
            append_event(run_id, "decision", compact(content or str(payload_type)), {"source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
            imported += 1
            continue

        if event_type == "event_msg" and isinstance(payload, dict):
            payload_type = str(payload.get("type") or "")
            if payload_type == "user_message":
                if record_user_message_event(run_id, payload, "codex-rollout", timestamp):
                    imported += 1
                continue
            if payload_type == "agent_message":
                if record_agent_message_event(run_id, payload, "codex-rollout", timestamp):
                    imported += 1
                continue
            if payload_type in {"task_completed", "turn_completed", "task_finished", "task_complete"}:
                append_event(run_id, "outcome", "Codex turn completed", {"status": "completed", "source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
                saw_outcome = True
            elif payload_type in {"task_failed", "turn_failed"}:
                append_event(run_id, "outcome", "Codex turn failed", {"status": "failed", "source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
                saw_outcome = True
            elif payload_type == "token_count":
                token_info = payload.get("info") or {}
                total = token_info.get("total_token_usage") or {}
                tokens = total.get("total_tokens")
                record_metric(run_id, token_count=tokens if isinstance(tokens, int) else None, timestamp=timestamp)
            else:
                append_event(run_id, "decision", payload_type or "Codex event", {"source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
            imported += 1
            continue

        append_event(run_id, "decision", compact(str(event_type)), {"source": "codex-rollout", "timestamp": timestamp, "payload": payload}, timestamp=timestamp)
        imported += 1

    created_ms = meta.get("created_at_ms")
    updated_ms = meta.get("updated_at_ms")
    duration_ms = updated_ms - created_ms if isinstance(created_ms, int) and isinstance(updated_ms, int) and updated_ms >= created_ms else None
    tokens = meta.get("tokens_used") if isinstance(meta.get("tokens_used"), int) else None
    has_metric = any(event.get("type") == "metric" for event in read_events(run_id))
    if not has_metric and (tokens is not None or duration_ms is not None):
        record_metric(run_id, duration_ms=duration_ms, token_count=tokens, success=True if saw_outcome else None)
        imported += 1
    if not saw_outcome:
        append_event(run_id, "outcome", "Codex rollout imported", {"status": "completed", "source": "codex-rollout", "inferred": True})
        imported += 1

    analysis = analyze(run_id)
    recommendation = recommend(run_id, mission)
    return {
        "run_id": run_id,
        "events_imported": imported,
        "thread_id": meta.get("id"),
        "rollout_path": str(path),
        "analysis": analysis,
        "recommendation": recommendation,
    }


def import_thread(thread_id: str | None = None, cwd: str | None = None, mission: str | None = None, run_id: str | None = None) -> dict[str, Any]:
    meta = find_thread(thread_id, cwd)
    rollout_path = meta.get("rollout_path")
    if not isinstance(rollout_path, str):
        raise SystemExit("Selected Codex thread has no rollout_path.")
    selected_mission = mission or meta.get("title") or meta.get("first_user_message") or "Imported Codex thread"
    return import_rollout_file(rollout_path, str(selected_mission), run_id=run_id, thread_meta=meta)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import local Codex rollout JSONL into a Flight Recorder run")
    parser.add_argument("--thread-id")
    parser.add_argument("--cwd", default=str(ROOT))
    parser.add_argument("--rollout-path")
    parser.add_argument("--mission")
    parser.add_argument("--run-id")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--all-workspaces", action="store_true")
    args = parser.parse_args()

    if args.list:
        print(json.dumps({"threads": list_threads(None if args.all_workspaces else args.cwd, args.limit)}, ensure_ascii=False, indent=2))
        return

    if args.rollout_path:
        result = import_rollout_file(args.rollout_path, args.mission or "Imported Codex rollout", run_id=args.run_id)
    else:
        result = import_thread(args.thread_id, args.cwd, args.mission, args.run_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
