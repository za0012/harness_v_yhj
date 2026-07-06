#!/usr/bin/env python3
"""Helper for completing Codex Desktop thread adapter requests."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = ROOT / ".harness" / "runs"
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
sys.path.insert(0, str(TRACE_TOOLS))

from trace_tools import record_metric, record_model_response  # noqa: E402


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_requests() -> list[dict[str, Any]]:
    requests: list[dict[str, Any]] = []
    if not RUNS_DIR.exists():
        return requests
    for request_file in RUNS_DIR.glob("*/desktop-thread/*/request.json"):
        response_file = request_file.with_name("response.json")
        request = read_json(request_file)
        request["request_file"] = str(request_file)
        request["has_response"] = response_file.exists()
        requests.append(request)
    return sorted(requests, key=lambda item: item.get("requested_at", ""), reverse=True)


def complete(
    request_file: Path,
    thread_id: str,
    summary: str,
    output: str,
    status: str,
    duration_ms: int | None,
    token_count: int | None,
    cost_estimated: float | None,
    user_intervention_count: int,
) -> dict[str, Any]:
    request = read_json(request_file)
    response_file = Path(request["response_file"])
    response = {
        "status": status,
        "completed_at": now_iso(),
        "thread_id": thread_id,
        "run_id": request["run_id"],
        "step_id": request["step_id"],
        "summary": summary,
        "output": output,
        "metrics": {
            "token_count": token_count,
            "cost_estimated": cost_estimated,
            "duration_ms": duration_ms,
            "user_intervention_count": user_intervention_count,
        },
    }
    write_json(response_file, response)
    record_model_response(request["run_id"], output, "desktop-thread", request["step_id"], thread_id, status)
    record_metric(
        request["run_id"],
        duration_ms,
        token_count,
        cost_estimated,
        user_intervention_count,
        status == "completed",
        request["step_id"],
    )
    return {"response_file": str(response_file), "response": response}


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect or complete Codex Desktop thread requests")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list")

    complete_parser = sub.add_parser("complete")
    complete_parser.add_argument("--request-file", required=True)
    complete_parser.add_argument("--thread-id", required=True)
    complete_parser.add_argument("--summary", required=True)
    complete_parser.add_argument("--output", required=True)
    complete_parser.add_argument("--status", default="completed")
    complete_parser.add_argument("--duration-ms", type=int)
    complete_parser.add_argument("--token-count", type=int)
    complete_parser.add_argument("--cost-estimated", type=float)
    complete_parser.add_argument("--user-intervention-count", type=int, default=0)

    args = parser.parse_args()
    if args.command == "list":
        result = {"requests": find_requests()}
    elif args.command == "complete":
        result = complete(
            Path(args.request_file),
            args.thread_id,
            args.summary,
            args.output,
            args.status,
            args.duration_ms,
            args.token_count,
            args.cost_estimated,
            args.user_intervention_count,
        )
    else:
        raise SystemExit(f"Unknown command: {args.command}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
