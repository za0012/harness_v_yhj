#!/usr/bin/env python3
"""Codex lifecycle hook entrypoint for Agent Flight Recorder.

The hook payload shape can vary across Codex surfaces, so this script keeps the
raw payload and extracts the fields we know how to recognize.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / ".harness" / "runs"
STATE_PATH = ROOT / ".harness" / "hook-state.json"
MAX_RAW_CHARS = 120_000

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"(?i)(api[_-]?key|token|password|secret)(\s*[:=]\s*)([^\s,}]+)"),
]


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9가-힣_-]+", "-", value.strip()).strip("-")
    return cleaned[:42] or "codex-hook"


def redact(value: str) -> str:
    redacted = value
    for pattern in SECRET_PATTERNS:
        if pattern.groups >= 3:
            redacted = pattern.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", redacted)
        else:
            redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def bounded_raw(value: str) -> str:
    value = redact(value)
    if len(value) <= MAX_RAW_CHARS:
        return value
    return value[:MAX_RAW_CHARS] + "\n...[truncated]"


def read_payload() -> tuple[Any, str]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}, ""
    safe_raw = bounded_raw(raw)
    try:
        return json.loads(raw), safe_raw
    except json.JSONDecodeError:
        return {"text": safe_raw}, safe_raw


def normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def walk_values(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key, child
            yield from walk_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_values(child)


def first_value(payload: Any, names: set[str]) -> Any:
    if isinstance(payload, dict):
        for key, value in walk_values(payload):
            if normalize_key(str(key)) in names and value not in (None, ""):
                return value
    return None


def text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return redact(value.strip())
    return bounded_raw(json.dumps(value, ensure_ascii=False))


def extract_context_keys(payload: Any) -> list[str]:
    wanted = {
        "runid",
        "flightrecorderrunid",
        "turnid",
        "threadid",
        "sessionid",
        "conversationid",
        "codexsessionid",
    }
    values: list[str] = []
    if isinstance(payload, dict):
        for key, value in walk_values(payload):
            if normalize_key(str(key)) in wanted and isinstance(value, (str, int)):
                values.append(f"{normalize_key(str(key))}:{value}")
    return list(dict.fromkeys(values))


def load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"active_run_id": None, "contexts": {}}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(STATE_PATH)


def run_dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def events_path(run_id: str) -> Path:
    return run_dir(run_id) / "events.jsonl"


def append_event(run_id: str, event_type: str, summary: str, data: dict[str, Any]) -> None:
    event = {
        "timestamp": now_iso(),
        "run_id": run_id,
        "type": event_type,
        "summary": summary,
        "data": data,
    }
    path = events_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def create_run_id(seed: str) -> str:
    return f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slugify(seed)}"


def resolve_run_id(args: argparse.Namespace, payload: Any, state: dict[str, Any], starts_new_turn: bool, seed: str) -> str:
    if args.run_id:
        run_id = args.run_id
    elif os.environ.get("FLIGHT_RECORDER_RUN_ID"):
        run_id = os.environ["FLIGHT_RECORDER_RUN_ID"]
    elif starts_new_turn:
        run_id = create_run_id(seed)
    else:
        contexts = state.get("contexts") or {}
        run_id = ""
        for key in extract_context_keys(payload):
            if contexts.get(key):
                run_id = contexts[key]
                break
        run_id = run_id or state.get("active_run_id") or create_run_id(seed)

    state["active_run_id"] = run_id
    contexts = state.setdefault("contexts", {})
    for key in extract_context_keys(payload):
        contexts[key] = run_id
    return run_id


def extract_prompt(payload: Any) -> str:
    value = first_value(payload, {"prompt", "userprompt", "input", "message", "text", "content"})
    return text_value(value)


def extract_tool_name(payload: Any, fallback: str) -> str:
    value = first_value(payload, {"toolname", "tool", "name", "recipientname"})
    result = text_value(value)
    return result or fallback or "unknown"


def extract_exit_code(payload: Any, fallback: int | None) -> int | None:
    value = first_value(payload, {"exitcode", "returncode", "statuscode", "code"})
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        return int(value.strip())
    return fallback


def extract_status(payload: Any, fallback: str) -> str:
    value = first_value(payload, {"status", "state", "finishreason", "outcome"})
    return text_value(value) or fallback


def extract_metric(payload: Any, names: set[str]) -> Any:
    return first_value(payload, names)


def is_failure(status: str, exit_code: int | None, payload: Any) -> bool:
    success = first_value(payload, {"success", "ok", "passed"})
    if isinstance(success, bool):
        return not success
    if exit_code not in (None, 0):
        return True
    return bool(re.search(r"fail|error|blocked|cancel|실패|오류|차단|중단", status, re.I))


def event_for_hook(args: argparse.Namespace, payload: Any, raw: str) -> tuple[str, str, dict[str, Any], bool]:
    hook = args.hook
    tool_name = extract_tool_name(payload, args.tool_name)
    exit_code = extract_exit_code(payload, args.exit_code)
    status = extract_status(payload, args.status)
    base_data = {
        "hook": hook,
        "tool_name": tool_name,
        "exit_code": exit_code,
        "status": status,
        "payload": payload,
        "raw": raw,
    }

    if hook == "user-prompt-submit" or args.event_type == "prompt":
        content = extract_prompt(payload) or args.summary
        base_data.update({"role": "user", "content": content, "prompt_kind": "task", "source": "codex-hook"})
        return "prompt", "사용자 프롬프트 기록", base_data, True

    if hook == "session-start":
        return "decision", "Codex session started", base_data, False

    if args.event_type == "tool_call":
        command = text_value(first_value(payload, {"command", "cmd", "arguments", "input"}))
        base_data["command"] = command
        return "tool_call", f"{tool_name} 호출", base_data, False

    if args.event_type == "tool_result":
        output = text_value(first_value(payload, {"output", "stdout", "stderr", "result", "content"}))
        base_data["output"] = output
        if is_failure(status, exit_code, payload):
            return "error", f"{tool_name} 실행 실패", base_data, False
        return "tool_result", f"{tool_name} 실행 결과", base_data, False

    if args.event_type == "outcome":
        final_status = "completed"
        if is_failure(status, exit_code, payload):
            final_status = "failed"
        if re.search(r"blocked|차단|permission|approval", status, re.I):
            final_status = "blocked"
        base_data["status"] = final_status
        return "outcome", args.summary if args.summary != "Hook event" else "Codex turn ended", base_data, False

    return args.event_type, args.summary, base_data, False


def append_metric_if_present(run_id: str, payload: Any) -> None:
    duration = extract_metric(payload, {"durationms", "elapsedms", "duration", "elapsed"})
    tokens = extract_metric(payload, {"tokencount", "tokens", "totaltokens"})
    cost = extract_metric(payload, {"cost", "costestimated", "estimatedcost"})
    interventions = extract_metric(payload, {"userinterventioncount", "interventions"})
    success = extract_metric(payload, {"success", "passed"})

    if not any(value is not None for value in (duration, tokens, cost, interventions, success)):
        return

    append_event(
        run_id,
        "metric",
        "Codex hook metric recorded",
        {
            "duration_ms": duration if isinstance(duration, int) else None,
            "token_count": tokens if isinstance(tokens, int) else None,
            "cost_estimated": cost if isinstance(cost, (int, float)) else None,
            "user_intervention_count": interventions if isinstance(interventions, int) else None,
            "success": success if isinstance(success, bool) else None,
            "source": "codex-hook",
        },
    )


def maybe_analyze(run_id: str) -> None:
    try:
        sys.path.insert(0, str(ROOT / "skills" / "agent-flight-recorder" / "scripts"))
        from trace_tools import analyze, recommend  # type: ignore

        analysis = analyze(run_id)
        mission = "Codex Desktop 자동 기록 run"
        mission_event = next((event for event in reversed(read_events(run_id)) if event.get("type") == "mission"), None)
        if mission_event:
            mission = str(mission_event.get("summary") or mission)
        elif analysis.get("last_event"):
            mission = str((analysis["last_event"].get("data") or {}).get("content") or mission)
        recommend(run_id, mission)
    except Exception as exc:  # Hooks must never break Codex itself.
        append_event(run_id, "decision", "Hook analysis skipped", {"error": str(exc), "source": "codex-hook"})


def read_events(run_id: str) -> list[dict[str, Any]]:
    path = events_path(run_id)
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                events.append(json.loads(line))
    return events


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-type", required=True)
    parser.add_argument("--hook", required=True)
    parser.add_argument("--run-id", "-RunId", default=os.environ.get("FLIGHT_RECORDER_RUN_ID"))
    parser.add_argument("--tool-name", "-ToolName", default="unknown")
    parser.add_argument("--summary", "-Summary", default="Hook event")
    parser.add_argument("--exit-code", "-ExitCode", type=int)
    parser.add_argument("--status", "-Status", default="completed")
    args = parser.parse_args()

    payload, raw = read_payload()
    state = load_state()
    event_type, summary, data, starts_new_turn = event_for_hook(args, payload, raw)
    seed = data.get("content") or summary or args.hook
    run_id = resolve_run_id(args, payload, state, starts_new_turn, str(seed))

    if starts_new_turn and not read_events(run_id):
        mission = text_value(data.get("content")) or "Codex Desktop 자동 기록 run"
        append_event(run_id, "mission", mission.splitlines()[0][:220], {"source": "codex-hook", "hook": args.hook})

    append_event(run_id, event_type, summary, data)
    if args.event_type == "outcome":
        append_metric_if_present(run_id, payload)
        maybe_analyze(run_id)

    save_state(state)
    print(run_id)


if __name__ == "__main__":
    main()
