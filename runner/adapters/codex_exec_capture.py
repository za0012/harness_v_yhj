#!/usr/bin/env python3
"""Run `codex exec --json` and convert its JSONL stream into recorder events."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
sys.path.insert(0, str(TRACE_TOOLS))

from trace_tools import analyze, append_event, init_run, read_events, recommend, record_metric, record_model_response, record_prompt  # noqa: E402


DEFAULT_CODEX = Path(os.environ.get("HARNESS_CODEX_EXE", r"C:\Users\yhj\AppData\Local\OpenAI\Codex\bin\codex.exe"))
DEFAULT_MODEL = os.environ.get("HARNESS_CODEX_MODEL")
MODELS_CACHE = Path.home() / ".codex" / "models_cache.json"


def compact(value: str, limit: int = 240) -> str:
    cleaned = " ".join(value.strip().split())
    return cleaned[:limit] + ("..." if len(cleaned) > limit else "")


def find_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "content", "message", "output", "stdout", "stderr", "summary", "delta"):
            if key in value:
                found = find_text(value[key])
                if found:
                    return found
        for child in value.values():
            found = find_text(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = find_text(child)
            if found:
                return found
    return ""


def nested_get(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def item_kind(event: dict[str, Any]) -> str:
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    return str(item.get("type") or event.get("item_type") or event.get("kind") or event.get("type") or "unknown")


def tool_name(event: dict[str, Any]) -> str:
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    return str(
        item.get("tool_name")
        or item.get("tool")
        or item.get("name")
        or event.get("tool_name")
        or event.get("tool")
        or item_kind(event)
    )


def exit_code(event: dict[str, Any]) -> int | None:
    for value in (
        event.get("exit_code"),
        event.get("exitCode"),
        nested_get(event, "item", "exit_code"),
        nested_get(event, "item", "exitCode"),
        nested_get(event, "item", "result", "exit_code"),
    ):
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            return int(value)
    return None


def status(event: dict[str, Any]) -> str:
    return str(event.get("status") or nested_get(event, "item", "status") or nested_get(event, "turn", "status") or "unknown")


def is_tool_item(kind: str) -> bool:
    lowered = kind.lower()
    return any(token in lowered for token in ("tool", "command", "exec", "bash", "shell", "mcp", "function"))


def is_message_item(kind: str) -> bool:
    lowered = kind.lower()
    return any(token in lowered for token in ("agentmessage", "assistant", "message", "response"))


def default_model() -> str | None:
    if DEFAULT_MODEL:
        return DEFAULT_MODEL
    if not MODELS_CACHE.exists():
        return None
    try:
        payload = json.loads(MODELS_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    models = payload.get("models")
    if not isinstance(models, list):
        return None
    slugs = [model.get("slug") for model in models if isinstance(model, dict) and isinstance(model.get("slug"), str)]
    if "gpt-5.5" in slugs:
        return "gpt-5.5"
    visible = [
        model.get("slug")
        for model in models
        if isinstance(model, dict)
        and model.get("visibility") == "list"
        and isinstance(model.get("slug"), str)
    ]
    return visible[0] if visible else (slugs[0] if slugs else None)


def map_codex_event(run_id: str, event: dict[str, Any], agent_buffer: list[str]) -> None:
    event_name = str(event.get("type") or event.get("method") or "unknown")
    kind = item_kind(event)
    text = find_text(event)
    data = {"source": "codex-exec-json", "codex_event": event}

    if event_name in {"thread.started", "turn.started"}:
        append_event(run_id, "decision", event_name, data)
        return

    if event_name == "item.agentMessage.delta":
        if text:
            agent_buffer.append(text)
        return

    if event_name == "item.started":
        if is_tool_item(kind):
            append_event(run_id, "tool_call", f"{tool_name(event)} 호출", data)
        else:
            append_event(run_id, "decision", f"{kind} started", data)
        return

    if event_name == "item.completed":
        if is_tool_item(kind):
            code = exit_code(event)
            event_type = "error" if code not in (None, 0) or "fail" in status(event).lower() else "tool_result"
            append_event(run_id, event_type, f"{tool_name(event)} 완료", {**data, "exit_code": code, "output": text})
            return
        if is_message_item(kind):
            content = text or "".join(agent_buffer)
            if content:
                record_model_response(run_id, content, "codex-exec-json")
                agent_buffer.clear()
            else:
                append_event(run_id, "decision", f"{kind} completed", data)
            return
        append_event(run_id, "decision", f"{kind} completed", data)
        return

    if event_name in {"turn.completed", "turn.failed"}:
        if agent_buffer:
            record_model_response(run_id, "".join(agent_buffer), "codex-exec-json")
            agent_buffer.clear()
        final_status = "completed" if event_name == "turn.completed" and "fail" not in status(event).lower() else "failed"
        append_event(run_id, "outcome", f"Codex exec {final_status}", {**data, "status": final_status})
        return

    if event_name == "error" or "error" in event_name:
        append_event(run_id, "error", compact(text or event_name), data)
        return

    append_event(run_id, "decision", compact(text or event_name), data)


def import_jsonl(run_id: str, lines: Iterable[str]) -> dict[str, Any]:
    agent_buffer: list[str] = []
    imported = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            append_event(run_id, "decision", compact(line), {"source": "codex-exec-stdout", "raw": line})
            imported += 1
            continue
        if isinstance(event, dict):
            map_codex_event(run_id, event, agent_buffer)
            imported += 1
    if agent_buffer:
        record_model_response(run_id, "".join(agent_buffer), "codex-exec-json")
    return {"run_id": run_id, "events_imported": imported}


def resolve_codex(explicit: str | None = None) -> str:
    if explicit:
        return explicit
    if DEFAULT_CODEX.exists():
        return str(DEFAULT_CODEX)
    found = shutil.which("codex")
    if found:
        return found
    raise SystemExit("No Codex executable found. Set HARNESS_CODEX_EXE.")


def run_codex_exec(
    prompt: str,
    mission: str,
    run_id: str | None = None,
    codex_exe: str | None = None,
    cwd: str | None = None,
    sandbox: str = "workspace-write",
    approval: str = "never",
    model: str | None = None,
    timeout_seconds: int = 1200,
    ignore_user_config: bool = True,
) -> dict[str, Any]:
    created = {"run_id": run_id} if run_id else init_run("codex-exec", mission)
    run_id = created["run_id"]
    record_prompt(run_id, "user", prompt, "task", "codex-exec")
    selected_model = model or default_model()

    command = [
        resolve_codex(codex_exe),
        "--cd",
        cwd or str(ROOT),
        "--sandbox",
        sandbox,
        "--ask-for-approval",
        approval,
    ]
    if selected_model:
        command.extend(["--model", selected_model])
    command.extend(["exec", "--json"])
    if ignore_user_config:
        command.append("--ignore-user-config")
    command.append(prompt)

    raw_path = ROOT / ".harness" / "runs" / run_id / "codex-exec.jsonl"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    started = datetime.now()
    imported = 0

    proc = subprocess.Popen(
        command,
        cwd=cwd or ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout_seconds)
        return_code = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate()
        stderr = (stderr or "") + "\ncodex exec timed out"
        return_code = -1

    raw_path.write_text(stdout or "", encoding="utf-8")
    imported = import_jsonl(run_id, (stdout or "").splitlines())["events_imported"]

    duration_ms = int((datetime.now() - started).total_seconds() * 1000)
    if stderr.strip():
        append_event(run_id, "decision" if return_code == 0 else "error", compact(stderr), {"source": "codex-exec-stderr", "stderr": stderr})
    if not any(event.get("type") == "outcome" for event in read_events(run_id)):
        append_event(run_id, "outcome", "Codex exec process ended", {"status": "completed" if return_code == 0 else "failed", "return_code": return_code})
    record_metric(run_id, duration_ms=duration_ms, success=return_code == 0)
    analysis = analyze(run_id)
    recommendation = recommend(run_id, mission)
    return {
        "run_id": run_id,
        "status": "passed" if return_code == 0 else "failed",
        "return_code": return_code,
        "events_imported": imported,
        "raw_jsonl": str(raw_path),
        "model": selected_model,
        "analysis": analysis,
        "recommendation": recommendation,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture codex exec --json output into a Flight Recorder run")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run")
    run_parser.add_argument("--prompt", required=True)
    run_parser.add_argument("--mission", required=True)
    run_parser.add_argument("--run-id")
    run_parser.add_argument("--codex-exe")
    run_parser.add_argument("--cwd")
    run_parser.add_argument("--sandbox", default="workspace-write")
    run_parser.add_argument("--approval", default="never")
    run_parser.add_argument("--model")
    run_parser.add_argument("--timeout-seconds", type=int, default=1200)
    run_parser.add_argument("--use-user-config", action="store_true")

    import_parser = sub.add_parser("import-jsonl")
    import_parser.add_argument("--run-id", required=True)
    import_parser.add_argument("--input", required=True)

    args = parser.parse_args()
    if args.command == "run":
        result = run_codex_exec(
            args.prompt,
            args.mission,
            args.run_id,
            args.codex_exe,
            args.cwd,
            args.sandbox,
            args.approval,
            args.model,
            args.timeout_seconds,
            not args.use_user_config,
        )
    else:
        lines = Path(args.input).read_text(encoding="utf-8").splitlines()
        result = import_jsonl(args.run_id, lines)
        result["analysis"] = analyze(args.run_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
