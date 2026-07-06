#!/usr/bin/env python3
"""Codex command adapter for supervisor-managed agent steps."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"

import sys

sys.path.insert(0, str(TRACE_TOOLS))

from trace_tools import record_prompt  # noqa: E402


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def emit(payload: dict, exit_code: int) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    raise SystemExit(exit_code)


def read_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_mock_output(output_file: Path, prompt: str, mission: str) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(
        "\n".join(
            [
                "# Mock Codex Adapter Output",
                "",
                f"Timestamp: {now_iso()}",
                f"Mission: {mission}",
                "",
                "This mock run proves the supervisor can hand a prompt to an agent adapter,",
                "capture an output artifact, and continue the autonomous plan.",
                "",
                "## Prompt Preview",
                "",
                prompt[:2000],
                "",
            ]
        ),
        encoding="utf-8",
    )


def desktop_thread_dir(run_id: str, step_id: str) -> Path:
    path = ROOT / ".harness" / "runs" / run_id / "desktop-thread" / step_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_desktop_thread_mode(run_id: str, step_id: str, mission: str, prompt_file: Path, output_file: Path, prompt: str) -> None:
    bridge_dir = desktop_thread_dir(run_id, step_id)
    request_file = bridge_dir / "request.json"
    response_file = bridge_dir / "response.json"

    if response_file.exists():
        response = json.loads(response_file.read_text(encoding="utf-8"))
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_text = response.get("output") or response.get("summary") or json.dumps(response, ensure_ascii=False, indent=2)
        output_file.write_text(output_text, encoding="utf-8")
        emit(
            {
                "status": "passed",
                "run_id": run_id,
                "step_id": step_id,
                "mode": "desktop-thread",
                "thread_id": response.get("thread_id"),
                "request_file": str(request_file),
                "response_file": str(response_file),
                "output_file": str(output_file),
                "blocker": None,
            },
            0,
        )

    request = {
        "status": "queued",
        "requested_at": now_iso(),
        "run_id": run_id,
        "step_id": step_id,
        "mission": mission,
        "prompt_file": str(prompt_file),
        "output_file": str(output_file),
        "response_file": str(response_file),
        "suggested_title": f"Flight Recorder Agent Step: {step_id}",
        "prompt": prompt,
        "instructions": [
            "Create or continue a Codex Desktop thread with this prompt.",
            "When the thread completes, write response.json with thread_id, status, summary, output, and metrics if available.",
            "Then resume the supervisor run.",
        ],
    }
    request_file.write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    record_prompt(run_id, "user", prompt, "agent_task", "desktop-thread", step_id)
    emit(
        {
            "status": "waiting",
            "run_id": run_id,
            "step_id": step_id,
            "mode": "desktop-thread",
            "request_file": str(request_file),
            "response_file": str(response_file),
            "output_file": str(output_file),
            "blocker": "Waiting for Codex Desktop thread response.",
        },
        3,
    )


def render_command(template: str, prompt_file: Path, output_file: Path, prompt: str) -> str:
    return (
        template.replace("{prompt_file}", str(prompt_file))
        .replace("{output_file}", str(output_file))
        .replace("{prompt_text}", prompt.replace('"', '\\"'))
    )


def detect_command(explicit: str | None) -> tuple[str | None, str | None]:
    if explicit:
        return explicit, None
    env_command = os.environ.get("HARNESS_CODEX_COMMAND")
    if env_command:
        return env_command, None
    codex_path = shutil.which("codex")
    if codex_path:
        return f'"{codex_path}"', None
    return None, "No Codex command configured. Set HARNESS_CODEX_COMMAND or make codex executable available."


def run_command(command: str, prompt: str, prompt_file: Path, output_file: Path, timeout: int) -> dict:
    rendered = render_command(command, prompt_file, output_file, prompt)
    try:
        completed = subprocess.run(
            rendered,
            cwd=ROOT,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=True,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "status": "failed",
            "exit_code": None,
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "blocker": f"Codex adapter command timed out after {timeout}s.",
        }
    except OSError as exc:
        return {"status": "blocked", "exit_code": None, "stdout": "", "stderr": "", "blocker": str(exc)}

    if completed.returncode == 0:
        if not output_file.exists():
            output_file.write_text(completed.stdout, encoding="utf-8")
        return {
            "status": "passed",
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "blocker": None,
        }
    blocker = completed.stderr.strip() or completed.stdout.strip() or f"Command exited with {completed.returncode}."
    return {
        "status": "failed",
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "blocker": blocker,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a Codex-compatible agent command from a prompt file")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--step-id", required=True)
    parser.add_argument("--mission", required=True)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--mode", choices=["auto", "command", "mock", "desktop-thread"], default="auto")
    parser.add_argument("--command")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    args = parser.parse_args()

    prompt_file = Path(args.prompt_file)
    output_file = Path(args.output_file)
    prompt = read_prompt(prompt_file)

    if args.mode == "mock":
        write_mock_output(output_file, prompt, args.mission)
        emit(
            {
                "status": "passed",
                "run_id": args.run_id,
                "step_id": args.step_id,
                "mode": "mock",
                "output_file": str(output_file),
                "blocker": None,
            },
            0,
        )

    if args.mode == "desktop-thread":
        run_desktop_thread_mode(args.run_id, args.step_id, args.mission, prompt_file, output_file, prompt)

    command, blocker = detect_command(args.command)
    if blocker:
        emit(
            {
                "status": "blocked",
                "run_id": args.run_id,
                "step_id": args.step_id,
                "mode": args.mode,
                "output_file": str(output_file),
                "blocker": blocker,
            },
            2,
        )

    result = run_command(command or "", prompt, prompt_file, output_file, args.timeout_seconds)
    result.update(
        {
            "run_id": args.run_id,
            "step_id": args.step_id,
            "mode": args.mode,
            "command": command,
            "output_file": str(output_file),
        }
    )
    if result["status"] == "passed":
        emit(result, 0)
    if result["status"] == "blocked":
        emit(result, 2)
    emit(result, 1)


if __name__ == "__main__":
    main()
