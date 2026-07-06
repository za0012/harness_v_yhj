#!/usr/bin/env python3
"""Minimal stdio MCP server for the Agent Flight Recorder harness."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
RUNNER_TOOLS = ROOT / "runner"
sys.path.insert(0, str(TRACE_TOOLS))
sys.path.insert(0, str(RUNNER_TOOLS))

from trace_tools import analyze, append_event, init_run, read_events, recommend  # noqa: E402
from adapters.codex_capture import import_transcript  # noqa: E402
from supervisor import create_run as create_supervisor_run  # noqa: E402
from supervisor import read_json as read_supervisor_json  # noqa: E402
from supervisor import resume as resume_supervisor_run  # noqa: E402
from supervisor import state_path as supervisor_state_path  # noqa: E402


TOOLS = [
    {
        "name": "init_run",
        "description": "Create a new flight-recorder run.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "mission": {"type": "string"},
            },
            "required": ["slug"],
        },
    },
    {
        "name": "record_event",
        "description": "Append a trace event to a run.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string"},
                "type": {"type": "string"},
                "summary": {"type": "string"},
                "data": {"type": "object"},
            },
            "required": ["run_id", "type", "summary"],
        },
    },
    {
        "name": "analyze_trace",
        "description": "Analyze a recorded run and persist analysis.json.",
        "inputSchema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
    {
        "name": "recommend_prompt",
        "description": "Recommend a stronger prompt from a recorded trace.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string"},
                "task": {"type": "string"},
            },
            "required": ["run_id", "task"],
        },
    },
    {
        "name": "list_events",
        "description": "Return raw events for a run.",
        "inputSchema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
    {
        "name": "import_codex_transcript",
        "description": "Import Codex-style transcript text into a flight-recorder run.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "mission": {"type": "string"},
                "run_id": {"type": "string"},
                "slug": {"type": "string"},
                "source": {"type": "string"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "start_supervisor",
        "description": "Create and run a resumable autonomous supervisor plan.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "mission": {"type": "string"},
                "plan_file": {"type": "string"},
                "no_resume": {"type": "boolean"},
            },
            "required": ["slug", "mission"],
        },
    },
    {
        "name": "resume_supervisor",
        "description": "Resume an existing autonomous supervisor run.",
        "inputSchema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
    {
        "name": "supervisor_state",
        "description": "Read supervisor state.json for a run.",
        "inputSchema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
]


def content(payload):
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}]}


def handle(method: str, params: dict) -> dict:
    if method == "initialize":
        return {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "flight-recorder", "version": "0.1.0"},
        }
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if name == "init_run":
            return content(init_run(args["slug"], args.get("mission")))
        if name == "record_event":
            return content(append_event(args["run_id"], args["type"], args["summary"], args.get("data")))
        if name == "analyze_trace":
            return content(analyze(args["run_id"]))
        if name == "recommend_prompt":
            return content(recommend(args["run_id"], args["task"]))
        if name == "list_events":
            return content(read_events(args["run_id"]))
        if name == "import_codex_transcript":
            return content(
                import_transcript(
                    args["text"],
                    args.get("mission"),
                    args.get("run_id"),
                    args.get("slug") or "codex-import",
                    args.get("source") or "mcp-codex-transcript",
                )
            )
        if name == "start_supervisor":
            created = create_supervisor_run(args["mission"], args["slug"], args.get("plan_file"))
            return content(created if args.get("no_resume") else resume_supervisor_run(created["run_id"]))
        if name == "resume_supervisor":
            return content(resume_supervisor_run(args["run_id"]))
        if name == "supervisor_state":
            return content(read_supervisor_json(supervisor_state_path(args["run_id"]), {}))
        raise ValueError(f"Unknown tool: {name}")
    if method == "notifications/initialized":
        return {}
    raise ValueError(f"Unsupported method: {method}")


def respond(request: dict, result=None, error=None) -> None:
    response = {"jsonrpc": "2.0", "id": request.get("id")}
    if error is None:
        response["result"] = result
    else:
        response["error"] = {"code": -32000, "message": str(error)}
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        if "id" not in request:
            try:
                handle(request.get("method", ""), request.get("params") or {})
            except Exception:
                pass
            continue
        try:
            respond(request, handle(request.get("method", ""), request.get("params") or {}))
        except Exception as exc:
            respond(request, error=exc)


if __name__ == "__main__":
    main()
