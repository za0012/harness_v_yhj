#!/usr/bin/env python3
"""Local trace tools for the Agent Flight Recorder harness."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
RUNS_DIR = Path(os.environ.get("FLIGHT_RECORDER_DIR", ROOT / ".harness" / "runs"))


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-")
    return cleaned[:40] or "run"


def run_dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def events_path(run_id: str) -> Path:
    return run_dir(run_id) / "events.jsonl"


def read_events(run_id: str) -> list[dict[str, Any]]:
    path = events_path(run_id)
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            events.append(json.loads(line))
    return events


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_event(run_id: str, event_type: str, summary: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    event = {
        "timestamp": now_iso(),
        "run_id": run_id,
        "type": event_type,
        "summary": summary,
        "data": data or {},
    }
    path = events_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def record_prompt(run_id: str, role: str, content: str, prompt_kind: str = "task", source: str = "manual", step_id: str | None = None) -> dict[str, Any]:
    return append_event(
        run_id,
        "prompt",
        f"{role} prompt recorded",
        {
            "role": role,
            "prompt_kind": prompt_kind,
            "content": content,
            "source": source,
            "step_id": step_id,
        },
    )


def record_model_response(
    run_id: str,
    content: str,
    source: str = "manual",
    step_id: str | None = None,
    thread_id: str | None = None,
    finish_reason: str | None = None,
) -> dict[str, Any]:
    return append_event(
        run_id,
        "model_response",
        "Model response recorded",
        {
            "content": content,
            "source": source,
            "step_id": step_id,
            "thread_id": thread_id,
            "finish_reason": finish_reason,
        },
    )


def record_metric(
    run_id: str,
    duration_ms: int | None = None,
    token_count: int | None = None,
    cost_estimated: float | None = None,
    user_intervention_count: int | None = None,
    success: bool | None = None,
    step_id: str | None = None,
) -> dict[str, Any]:
    return append_event(
        run_id,
        "metric",
        "Run metric recorded",
        {
            "duration_ms": duration_ms,
            "token_count": token_count,
            "cost_estimated": cost_estimated,
            "user_intervention_count": user_intervention_count,
            "success": success,
            "step_id": step_id,
        },
    )


def init_run(slug: str, mission: str | None = None) -> dict[str, Any]:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"{stamp}-{slugify(slug)}"
    run_dir(run_id).mkdir(parents=True, exist_ok=True)
    if mission:
        append_event(run_id, "mission", mission)
    return {"run_id": run_id, "path": str(run_dir(run_id))}


def analyze(run_id: str) -> dict[str, Any]:
    events = read_events(run_id)
    counts = Counter(event.get("type", "unknown") for event in events)
    errors = [event for event in events if event.get("type") == "error"]
    retries = [event for event in events if event.get("type") == "retry"]
    validations = [event for event in events if event.get("type") == "validation"]
    tool_calls = [event for event in events if event.get("type") == "tool_call"]
    prompts = [event for event in events if event.get("type") == "prompt"]
    model_responses = [event for event in events if event.get("type") == "model_response"]
    metrics = [event for event in events if event.get("type") == "metric"]

    metric_totals = {
        "duration_ms": 0,
        "token_count": 0,
        "cost_estimated": 0.0,
        "user_intervention_count": 0,
        "success": None,
    }
    for event in metrics:
        data = event.get("data") or {}
        for key in ("duration_ms", "token_count", "user_intervention_count"):
            value = data.get(key)
            if isinstance(value, int):
                metric_totals[key] += value
        cost = data.get("cost_estimated")
        if isinstance(cost, (int, float)):
            metric_totals["cost_estimated"] += float(cost)
        if isinstance(data.get("success"), bool):
            metric_totals["success"] = data["success"]

    risks: list[str] = []
    if not events:
        risks.append("No events recorded; the run cannot be diagnosed.")
    if counts.get("mission", 0) == 0:
        risks.append("Mission was not recorded.")
    if tool_calls and not validations:
        risks.append("Tool use was recorded but no validation event was captured.")
    if prompts and not model_responses:
        risks.append("Prompt was recorded but no model response event was captured.")
    if errors and not retries:
        risks.append("Errors were recorded without a retry or recovery event.")
    if counts.get("outcome", 0) == 0:
        risks.append("Final outcome was not recorded.")

    result = {
        "run_id": run_id,
        "event_count": len(events),
        "event_counts": dict(counts),
        "tool_call_count": len(tool_calls),
        "prompt_count": len(prompts),
        "model_response_count": len(model_responses),
        "error_count": len(errors),
        "retry_count": len(retries),
        "validation_count": len(validations),
        "metric_count": len(metrics),
        "metric_totals": metric_totals,
        "risks": risks,
        "last_event": events[-1] if events else None,
    }
    write_json(run_dir(run_id) / "analysis.json", result)
    return result


def recommend(run_id: str, task: str) -> dict[str, Any]:
    analysis = analyze(run_id)
    risks = analysis["risks"]
    focus = risks or ["Trace is mostly complete; strengthen success criteria, verification, and reporting."]

    prompt = f"""Mission:
{task}

Success criteria:
- Define the expected artifact or behavior before acting.
- Complete the task autonomously unless a permission, safety, or missing-input blocker makes progress impossible.
- Leave a trace of major tool calls, errors, retries, validations, and final outcome.

Operating rules:
- Inspect relevant files and configuration before editing.
- Prefer the repository's existing patterns.
- If a command fails, record the failure, try one concrete recovery path, then reduce scope to the smallest useful deliverable if needed.
- Do not run destructive commands unless the user explicitly requested them.

Verification:
- Run the most relevant local check available.
- Record the validation result and any residual risk.

Final response:
- Summarize changed artifacts.
- Summarize verification evidence.
- Include the next prompt improvement if the trace revealed a repeatable weakness.
"""

    result = {
        "run_id": run_id,
        "diagnosis": focus,
        "recommended_prompt": prompt,
        "verification_checklist": [
            "Mission event exists.",
            "At least one validation event exists for code or config changes.",
            "Outcome event records completed work and residual risk.",
            "Recommended prompt addresses every recorded risk.",
        ],
    }
    output = run_dir(run_id) / "recommended-prompt.md"
    output.write_text(prompt, encoding="utf-8")
    write_json(run_dir(run_id) / "recommendation.json", result)
    return result


def parse_data(values: list[str]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"Invalid --data value: {value}. Use key=value.")
        key, raw = value.split("=", 1)
        data[key] = raw
    return data


def parse_optional_int(value: str | None) -> int | None:
    return None if value in (None, "") else int(value)


def parse_optional_float(value: str | None) -> float | None:
    return None if value in (None, "") else float(value)


def parse_optional_bool(value: str | None) -> bool | None:
    if value in (None, ""):
        return None
    return value.lower() in ("1", "true", "yes", "y", "passed", "success")


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent Flight Recorder trace tools")
    sub = parser.add_subparsers(dest="command", required=True)

    init_parser = sub.add_parser("init-run")
    init_parser.add_argument("--slug", required=True)
    init_parser.add_argument("--mission")

    record_parser = sub.add_parser("record")
    record_parser.add_argument("--run-id", required=True)
    record_parser.add_argument("--type", required=True)
    record_parser.add_argument("--summary", required=True)
    record_parser.add_argument("--data", action="append", default=[])

    prompt_parser = sub.add_parser("record-prompt")
    prompt_parser.add_argument("--run-id", required=True)
    prompt_parser.add_argument("--role", required=True)
    prompt_parser.add_argument("--content", required=True)
    prompt_parser.add_argument("--prompt-kind", default="task")
    prompt_parser.add_argument("--source", default="manual")
    prompt_parser.add_argument("--step-id")

    response_parser = sub.add_parser("record-response")
    response_parser.add_argument("--run-id", required=True)
    response_parser.add_argument("--content", required=True)
    response_parser.add_argument("--source", default="manual")
    response_parser.add_argument("--step-id")
    response_parser.add_argument("--thread-id")
    response_parser.add_argument("--finish-reason")

    metric_parser = sub.add_parser("record-metric")
    metric_parser.add_argument("--run-id", required=True)
    metric_parser.add_argument("--duration-ms")
    metric_parser.add_argument("--token-count")
    metric_parser.add_argument("--cost-estimated")
    metric_parser.add_argument("--user-intervention-count")
    metric_parser.add_argument("--success")
    metric_parser.add_argument("--step-id")

    analyze_parser = sub.add_parser("analyze")
    analyze_parser.add_argument("--run-id", required=True)

    recommend_parser = sub.add_parser("recommend")
    recommend_parser.add_argument("--run-id", required=True)
    recommend_parser.add_argument("--task", required=True)

    args = parser.parse_args()
    if args.command == "init-run":
        result = init_run(args.slug, args.mission)
    elif args.command == "record":
        result = append_event(args.run_id, args.type, args.summary, parse_data(args.data))
    elif args.command == "record-prompt":
        result = record_prompt(args.run_id, args.role, args.content, args.prompt_kind, args.source, args.step_id)
    elif args.command == "record-response":
        result = record_model_response(args.run_id, args.content, args.source, args.step_id, args.thread_id, args.finish_reason)
    elif args.command == "record-metric":
        result = record_metric(
            args.run_id,
            parse_optional_int(args.duration_ms),
            parse_optional_int(args.token_count),
            parse_optional_float(args.cost_estimated),
            parse_optional_int(args.user_intervention_count),
            parse_optional_bool(args.success),
            args.step_id,
        )
    elif args.command == "analyze":
        result = analyze(args.run_id)
    elif args.command == "recommend":
        result = recommend(args.run_id, args.task)
    else:
        raise SystemExit(f"Unknown command: {args.command}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
