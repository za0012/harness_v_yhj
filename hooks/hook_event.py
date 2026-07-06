#!/usr/bin/env python3
"""Execution-policy-safe hook entrypoint for Flight Recorder events."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-type", required=True)
    parser.add_argument("--hook", required=True)
    parser.add_argument("--run-id", "-RunId", default=os.environ.get("FLIGHT_RECORDER_RUN_ID"))
    parser.add_argument("--tool-name", "-ToolName", default="unknown")
    parser.add_argument("--summary", "-Summary", default="Hook event")
    parser.add_argument("--exit-code", "-ExitCode", type=int, default=0)
    parser.add_argument("--status", "-Status", default="completed")
    args = parser.parse_args()

    run_id = args.run_id or datetime.now().strftime("%Y%m%d-%H%M%S-hook")
    path = ROOT / ".harness" / "runs" / run_id / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)

    event = {
        "timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
        "run_id": run_id,
        "type": args.event_type,
        "summary": args.summary,
        "data": {
            "tool_name": args.tool_name,
            "exit_code": args.exit_code,
            "status": args.status,
            "hook": args.hook,
        },
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    print(run_id)


if __name__ == "__main__":
    main()
