#!/usr/bin/env python3
"""Resumable autonomous supervisor for Agent Flight Recorder runs."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
ADAPTERS_DIR = ROOT / "runner" / "adapters"
sys.path.insert(0, str(TRACE_TOOLS))

from trace_tools import analyze, append_event, init_run, recommend, record_metric, record_model_response, record_prompt, run_dir, write_json  # noqa: E402


DEFAULT_TIMEOUT_SECONDS = 120
TERMINAL_STATES = {"completed", "blocked", "failed"}
WAITING_STATES = {"waiting_for_desktop_thread"}


@dataclass
class CommandResult:
    status: str
    exit_code: int | None
    stdout: str
    stderr: str
    blocker: str | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_state(run_id: str, state: dict[str, Any]) -> None:
    state["updated_at"] = now_iso()
    write_json(run_dir(run_id) / "state.json", state)


def state_path(run_id: str) -> Path:
    return run_dir(run_id) / "state.json"


def plan_path(run_id: str) -> Path:
    return run_dir(run_id) / "plan.json"


def find_bash() -> str | None:
    candidates = [
        os.environ.get("HARNESS_BASH"),
        shutil.which("bash"),
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def python_executable() -> str:
    return os.environ.get(
        "FLIGHT_RECORDER_PYTHON",
        str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "python" / "python.exe"),
    )


def bash_path(path: Path) -> str:
    resolved = path.resolve()
    drive = resolved.drive.rstrip(":").lower()
    rest = resolved.as_posix().split(":", 1)[-1]
    return f"/{drive}{rest}"


def shell_command(command: str, shell_name: str) -> tuple[list[str], str | None]:
    if shell_name == "bash":
        bash = find_bash()
        if not bash:
            return [], "bash is required for this command but was not found on PATH or common Git Bash paths."
        return [bash, "-lc", command], None
    if shell_name == "cmd":
        return ["cmd.exe", "/c", command], None
    if shell_name == "powershell":
        return ["powershell.exe", "-NoProfile", "-Command", command], None
    if shell_name == "python":
        return [python_executable(), *command.split(" ")], None
    return [], f"Unsupported shell: {shell_name}"


def run_command(step: dict[str, Any]) -> CommandResult:
    command = step.get("command")
    if not command:
        return CommandResult("passed", 0, "", "")
    shell_name = step.get("shell", "cmd")
    argv, blocker = shell_command(command, shell_name)
    if blocker:
        return CommandResult("blocked", None, "", "", blocker)
    timeout = int(step.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS))
    try:
        completed = subprocess.run(
            argv,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "FLIGHT_RECORDER_DIR": str(ROOT / ".harness" / "runs")},
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult("failed", None, exc.stdout or "", exc.stderr or "", f"Command timed out after {timeout}s.")
    except OSError as exc:
        return CommandResult("blocked", None, "", "", str(exc))
    status = "passed" if completed.returncode == 0 else "failed"
    return CommandResult(status, completed.returncode, completed.stdout, completed.stderr)


def agent_dir(run_id: str) -> Path:
    path = run_dir(run_id) / "agent"
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_agent_prompt(run_id: str, state: dict[str, Any], step: dict[str, Any], attempt: int) -> Path:
    step_id = step.get("id", "agent-step")
    prompt_file = agent_dir(run_id) / f"{step_id}-attempt-{attempt}.md"
    success_criteria = step.get("success_criteria") or ["Complete the requested agent task."]
    previous = analyze(run_id) if attempt > 1 else None
    recommendation = recommend(run_id, state.get("mission", "")) if attempt > 1 else None
    lines = [
        "# Autonomous Agent Task",
        "",
        f"Run ID: {run_id}",
        f"Step ID: {step_id}",
        f"Attempt: {attempt}",
        "",
        "## Mission",
        "",
        state.get("mission", ""),
        "",
        "## Step",
        "",
        step.get("summary", step_id),
        "",
        "## Success Criteria",
        "",
    ]
    lines.extend(f"- {item}" for item in success_criteria)
    lines.extend(
        [
            "",
            "## Operating Rules",
            "",
            "- Work autonomously until the step is complete or truly blocked.",
            "- Record important tool calls, failures, retries, validation, and outcome.",
            "- Do not use destructive commands unless explicitly requested.",
            "- Prefer local context and existing project patterns.",
            "",
            "## Final Output",
            "",
            "- Summarize what changed or what artifact was produced.",
            "- Include validation evidence.",
            "- Mention any blocker precisely.",
        ]
    )
    if previous:
        lines.extend(["", "## Previous Trace Analysis", "", json.dumps(previous, ensure_ascii=False, indent=2)])
    if recommendation:
        lines.extend(["", "## Prompt Coach Recommendation", "", recommendation.get("recommended_prompt", "")])
    prompt_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return prompt_file


def run_agent(run_id: str, state: dict[str, Any], step: dict[str, Any], attempt: int) -> CommandResult:
    adapter = step.get("adapter", "codex")
    if adapter != "codex":
        return CommandResult("blocked", None, "", "", f"Unsupported agent adapter: {adapter}")
    prompt_file = build_agent_prompt(run_id, state, step, attempt)
    output_file = agent_dir(run_id) / f"{step.get('id', 'agent-step')}-attempt-{attempt}-output.md"
    adapter_script = ADAPTERS_DIR / "codex_adapter.py"
    argv = [
        python_executable(),
        str(adapter_script),
        "--run-id",
        run_id,
        "--step-id",
        step.get("id", "agent-step"),
        "--mission",
        state.get("mission", ""),
        "--prompt-file",
        str(prompt_file),
        "--output-file",
        str(output_file),
        "--mode",
        step.get("mode", "auto"),
        "--timeout-seconds",
        str(step.get("timeout_seconds", 600)),
    ]
    if step.get("command"):
        argv.extend(["--command", step["command"]])
    try:
        completed = subprocess.run(
            argv,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=int(step.get("timeout_seconds", 600)) + 5,
            env={**os.environ, "FLIGHT_RECORDER_DIR": str(ROOT / ".harness" / "runs")},
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult("failed", None, exc.stdout or "", exc.stderr or "", "Agent adapter timed out.")
    except OSError as exc:
        return CommandResult("blocked", None, "", "", str(exc))
    payload: dict[str, Any] = {}
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        pass
    status = payload.get("status")
    if completed.returncode == 0 and status == "passed":
        return CommandResult("passed", 0, completed.stdout, completed.stderr)
    if status == "waiting" or completed.returncode == 3:
        return CommandResult("waiting", completed.returncode, completed.stdout, completed.stderr, payload.get("blocker"))
    if status == "blocked" or completed.returncode == 2:
        return CommandResult("blocked", completed.returncode, completed.stdout, completed.stderr, payload.get("blocker"))
    blocker = payload.get("blocker") or completed.stderr or completed.stdout or f"Agent adapter exited {completed.returncode}."
    return CommandResult("failed", completed.returncode, completed.stdout, completed.stderr, blocker)


def default_plan(mission: str) -> dict[str, Any]:
    return {
        "mission": mission,
        "max_recovery_attempts": 2,
        "steps": [
            {
                "id": "inspect",
                "kind": "command",
                "summary": "Inspect tracked harness files.",
                "shell": "cmd",
                "command": "git status --short",
                "required": False,
            },
            {
                "id": "offline-python-validation",
                "kind": "validation",
                "summary": "Validate Python harness files compile.",
                "shell": "cmd",
                "command": (
                    f"{python_executable()} "
                    r"-m py_compile skills\agent-flight-recorder\scripts\trace_tools.py "
                    r"mcp\flight-recorder\server.py hooks\hook_event.py runner\supervisor.py "
                    r"runner\adapters\codex_adapter.py"
                ),
                "required": True,
            },
            {
                "id": "offline-node-validation",
                "kind": "validation",
                "summary": "Validate Electron CommonJS entrypoints parse.",
                "shell": "cmd",
                "command": (
                    r"C:\Users\yhj\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe "
                    r"--check electron\main.cjs"
                ),
                "required": True,
            },
            {
                "id": "pnpm-build",
                "kind": "validation",
                "summary": "Run package build through bash when dependencies are available.",
                "shell": "bash",
                "command": f"cd {bash_path(ROOT)} && pnpm install --offline && pnpm run build",
                "required": False,
                "allow_blocked": True,
            },
        ],
    }
    return {
        "mission": mission,
        "max_recovery_attempts": 2,
        "steps": [
            {
                "id": "inspect",
                "kind": "command",
                "summary": "Inspect tracked harness files.",
                "shell": "cmd",
                "command": "git status --short",
                "required": False,
            },
            {
                "id": "offline-python-validation",
                "kind": "validation",
                "summary": "Validate Python harness files compile.",
                "shell": "cmd",
                "command": (
                    r"C:\Users\yhj\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe "
                    r"-m py_compile skills\agent-flight-recorder\scripts\trace_tools.py "
                    r"mcp\flight-recorder\server.py hooks\hook_event.py runner\supervisor.py"
                ),
                "required": True,
            },
            {
                "id": "offline-node-validation",
                "kind": "validation",
                "summary": "Validate Electron CommonJS entrypoints parse.",
                "shell": "cmd",
                "command": (
                    r"C:\Users\yhj\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe "
                    r"--check electron\main.cjs"
                ),
                "required": True,
            },
            {
                "id": "pnpm-build",
                "kind": "validation",
                "summary": "Run package build through bash when dependencies are available.",
                "shell": "bash",
                "command": (
                    "cd /c/Users/yhj/Documents/하네스 "
                    "&& pnpm install --offline "
                    "&& pnpm run build"
                ),
                "required": False,
                "allow_blocked": True,
            },
        ],
    }


def create_run(mission: str, slug: str, plan_file: str | None) -> dict[str, Any]:
    created = init_run(slug, mission)
    run_id = created["run_id"]
    if plan_file:
        plan_file_path = Path(plan_file)
        if not plan_file_path.is_absolute():
            plan_file_path = ROOT / plan_file_path
        plan = read_json(plan_file_path, {})
        plan.setdefault("mission", mission)
        plan.setdefault("steps", [])
        plan.setdefault("max_recovery_attempts", 2)
    else:
        plan = default_plan(mission)
    write_json(plan_path(run_id), plan)
    state = {
        "run_id": run_id,
        "status": "pending",
        "mission": mission,
        "current_step": 0,
        "steps_total": len(plan.get("steps", [])),
        "attempts": {},
        "completed_steps": [],
        "blocked_steps": [],
        "failed_steps": [],
        "created_at": now_iso(),
    }
    write_state(run_id, state)
    append_event(run_id, "decision", "Supervisor run created.", {"status": "pending", "steps": len(plan.get("steps", []))})
    return {"run_id": run_id, "state": state, "plan": plan}


def finish(run_id: str, state: dict[str, Any], status: str, summary: str) -> dict[str, Any]:
    state["status"] = status
    append_event(run_id, "outcome", summary, {"status": status})
    write_state(run_id, state)
    analysis = analyze(run_id)
    recommendation = recommend(run_id, state.get("mission", "Continue the autonomous run."))
    return {"run_id": run_id, "state": state, "analysis": analysis, "recommendation": recommendation}


def execute_step(run_id: str, state: dict[str, Any], step: dict[str, Any], step_index: int) -> bool | None:
    step_id = step.get("id", f"step-{step_index}")
    attempts = state.setdefault("attempts", {})
    attempts[step_id] = int(attempts.get(step_id, 0)) + 1
    state["status"] = "running"
    state["current_step"] = step_index
    write_state(run_id, state)

    kind = step.get("kind")
    event_type = "validation" if kind == "validation" else "tool_call"
    append_event(
        run_id,
        event_type,
        step.get("summary", step_id),
        {
            "step_id": step_id,
            "attempt": attempts[step_id],
            "kind": kind,
            "adapter": step.get("adapter"),
            "shell": step.get("shell", "cmd"),
            "command": step.get("command", ""),
        },
    )
    result = run_agent(run_id, state, step, attempts[step_id]) if kind == "agent" else run_command(step)
    append_event(
        run_id,
        "tool_result",
        f"{step_id}: {result.status}",
        {
            "step_id": step_id,
            "exit_code": result.exit_code,
            "stdout_tail": result.stdout[-2000:],
            "stderr_tail": result.stderr[-2000:],
            "blocker": result.blocker,
        },
    )

    if result.status == "passed":
        state.setdefault("completed_steps", []).append(step_id)
        if state.get("waiting_step") == step_id:
            state.pop("waiting_step", None)
        write_state(run_id, state)
        return True

    if result.status == "waiting":
        state["status"] = "waiting_for_desktop_thread"
        state["waiting_step"] = step_id
        append_event(
            run_id,
            "decision",
            f"{step_id} waiting for Codex Desktop thread response.",
            {"step_id": step_id, "resume_command": f"python runner/supervisor.py resume --run-id {run_id}"},
        )
        write_state(run_id, state)
        return None

    if result.status == "blocked" or step.get("allow_blocked"):
        state.setdefault("blocked_steps", []).append(step_id)
        blocked_summary = f"{step_id} blocked: {result.blocker or 'command unavailable'}"
        event_type = "decision" if not step.get("required", True) else "error"
        append_event(run_id, event_type, blocked_summary, {"step_id": step_id, "required": step.get("required", True)})
        write_state(run_id, state)
        return not step.get("required", True)

    max_retries = int(step.get("max_retries", state.get("max_recovery_attempts", 2)))
    if attempts[step_id] <= max_retries:
        state["status"] = "recovering"
        append_event(run_id, "retry", f"Retrying {step_id} after failed attempt {attempts[step_id]}.", {"step_id": step_id})
        write_state(run_id, state)
        return execute_step(run_id, state, step, step_index)

    state.setdefault("failed_steps", []).append(step_id)
    append_event(run_id, "error", f"{step_id} failed after {attempts[step_id]} attempts.", {"step_id": step_id})
    write_state(run_id, state)
    return not step.get("required", True)


def resume(run_id: str) -> dict[str, Any]:
    state = read_json(state_path(run_id), None)
    plan = read_json(plan_path(run_id), None)
    if not state or not plan:
        raise SystemExit(f"Run {run_id} is missing state.json or plan.json.")
    if state.get("status") in TERMINAL_STATES:
        return {"run_id": run_id, "state": state, "analysis": analyze(run_id)}

    steps = plan.get("steps", [])
    state["status"] = "running"
    write_state(run_id, state)
    append_event(run_id, "decision", "Supervisor resumed autonomous execution.", {"from_step": state.get("current_step", 0)})

    for index in range(int(state.get("current_step", 0)), len(steps)):
        ok = execute_step(run_id, state, steps[index], index)
        if ok is None:
            return {"run_id": run_id, "state": state, "analysis": analyze(run_id)}
        state["current_step"] = index + 1
        write_state(run_id, state)
        if not ok:
            return finish(run_id, state, "blocked", f"Supervisor blocked at step {steps[index].get('id', index)}.")

    return finish(run_id, state, "completed", "Supervisor completed all required steps.")


def autopilot(mission: str, slug: str, plan_file: str | None, max_cycles: int) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc)
    created = create_run(mission, slug, plan_file)
    run_id = created["run_id"]
    record_prompt(
        run_id,
        "system",
        (
            "You are an autonomous supervisor for Tool-Use Flight Recorder + Prompt Recommender. "
            "Do not run destructive commands without explicit approval. "
            "Record tool calls, tool results, errors, retries, validation, metrics, and outcome. "
            "Final output must include changed artifacts, validation evidence, and residual risks."
        ),
        prompt_kind="autopilot-system",
        source="supervisor",
    )
    record_prompt(
        run_id,
        "user",
        (
            f"Mission: {mission}\n\n"
            "Success criteria:\n"
            "- Finish the validation plan without user intervention when possible.\n"
            "- Preserve a timeline of decisions, tool calls, tool results, validation, metrics, and final outcome.\n"
            "- Generate prompt diagnosis and a recommended next-run prompt.\n"
            "- Stop only when completed, failed, blocked, or max cycles are exhausted.\n\n"
            "Output format:\n"
            "- status\n"
            "- completed steps\n"
            "- validation evidence\n"
            "- remaining risks"
        ),
        prompt_kind="autopilot-user",
        source="supervisor",
    )
    record_model_response(
        run_id,
        "Autopilot plan accepted. The supervisor will execute the configured plan, resume until terminal state, analyze the trace, and recommend a stronger prompt.",
        source="supervisor",
    )
    append_event(
        run_id,
        "decision",
        "Autopilot started. The supervisor will keep resuming until a terminal state is reached.",
        {"max_cycles": max_cycles},
    )

    result: dict[str, Any] = created
    for cycle in range(1, max_cycles + 1):
        result = resume(run_id)
        state = result.get("state", {})
        append_event(
            run_id,
            "decision",
            f"Autopilot cycle {cycle} finished with status {state.get('status')}.",
            {"cycle": cycle, "status": state.get("status")},
        )
        if state.get("status") in TERMINAL_STATES:
            break
    else:
        state = read_json(state_path(run_id), {})
        state["status"] = "blocked"
        append_event(
            run_id,
            "error",
            "Autopilot stopped because max cycles were exhausted before a terminal state.",
            {"max_cycles": max_cycles},
        )
        write_state(run_id, state)
        result = {"run_id": run_id, "state": state}

    ended_at = datetime.now(timezone.utc)
    duration_ms = int((ended_at - started_at).total_seconds() * 1000)
    final_state = result.get("state", {})
    record_metric(
        run_id,
        duration_ms=duration_ms,
        token_count=None,
        cost_estimated=None,
        user_intervention_count=0,
        success=final_state.get("status") == "completed",
    )
    result["analysis"] = analyze(run_id)
    result["recommendation"] = recommend(run_id, mission)
    return result


def list_states() -> dict[str, Any]:
    runs = []
    runs_root = ROOT / ".harness" / "runs"
    if not runs_root.exists():
        return {"runs": []}
    for path in runs_root.iterdir():
        if not path.is_dir():
            continue
        state = read_json(path / "state.json", None)
        if state:
            runs.append(state)
    return {"runs": sorted(runs, key=lambda item: item.get("updated_at", ""), reverse=True)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Autonomous Agent Flight Recorder supervisor")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start")
    start.add_argument("--mission", required=True)
    start.add_argument("--slug", default="supervisor")
    start.add_argument("--plan-file")
    start.add_argument("--no-resume", action="store_true")

    auto_parser = sub.add_parser("autopilot")
    auto_parser.add_argument("--mission", required=True)
    auto_parser.add_argument("--slug", default="autopilot")
    auto_parser.add_argument("--plan-file")
    auto_parser.add_argument("--max-cycles", type=int, default=5)

    resume_parser = sub.add_parser("resume")
    resume_parser.add_argument("--run-id", required=True)

    state_parser = sub.add_parser("state")
    state_parser.add_argument("--run-id")

    sub.add_parser("list")

    args = parser.parse_args()
    if args.command == "start":
        result = create_run(args.mission, args.slug, args.plan_file)
        if not args.no_resume:
            result = resume(result["run_id"])
    elif args.command == "autopilot":
        result = autopilot(args.mission, args.slug, args.plan_file, args.max_cycles)
    elif args.command == "resume":
        result = resume(args.run_id)
    elif args.command == "state":
        result = read_json(state_path(args.run_id), {}) if args.run_id else list_states()
    elif args.command == "list":
        result = list_states()
    else:
        raise SystemExit(f"Unknown command: {args.command}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
