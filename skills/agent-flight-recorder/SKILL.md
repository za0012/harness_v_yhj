---
name: agent-flight-recorder
description: Record, inspect, and improve AI agent runs. Use when a task needs Tool-Use Flight Recorder behavior: capturing tool calls, errors, retries, validation steps, autonomous completion decisions, prompt diagnostics, or recommending stronger prompts from execution traces.
---

# Agent Flight Recorder

## Purpose

Use this skill to make an agent run observable and improvable. Record the mission, tool events, failures, retries, validation, and final outcome; then diagnose the trace and recommend a better prompt for the next run.

Primary mode: near-realtime Codex work recording through supervisor plans and the desktop-thread bridge. Keep the schema generic so other AI agent runtimes can emit the same events later.

## Workflow

1. Define the mission in one sentence, including success criteria.
2. Start or identify a run ID using `yyyyMMdd-HHmmss-<slug>`.
3. Record major events as JSONL: `mission`, `prompt`, `tool_call`, `tool_result`, `error`, `retry`, `validation`, and `outcome`.
4. Analyze the trace before final response when the task involved multiple tool calls, errors, retries, or meaningful autonomy decisions.
5. Recommend a revised prompt when the trace shows ambiguity, missing constraints, missing validation, repeated tool calls, or avoidable failures.

## Autonomous Supervisor

Use `runner/supervisor.py` when the user asks for uninterrupted or autonomous completion. It persists `state.json` and `plan.json` under the run directory, retries failed required steps, records blockers, and resumes from the last incomplete step.

```powershell
python runner/supervisor.py start --slug ui-build --mission "Validate the Electron frontend." --plan-file runner/plans/frontend-build.json
python runner/supervisor.py resume --run-id <run_id>
python runner/supervisor.py state --run-id <run_id>
```

Package-manager steps must use bash. If bash or network access is unavailable, record that step as blocked and continue with offline validations when the step is not required.

## Codex Adapter

Use `kind: "agent"` steps to make the supervisor hand work to an agent adapter.

```json
{
  "id": "agent-draft",
  "kind": "agent",
  "summary": "Ask Codex to implement the next task.",
  "adapter": "codex",
  "mode": "auto",
  "required": true
}
```

`runner/adapters/codex_adapter.py` writes and consumes prompt files under `.harness/runs/<run_id>/agent/`. Set `HARNESS_CODEX_COMMAND` to the real Codex command template when available. Use `{prompt_file}`, `{output_file}`, or stdin depending on the command. Use `mode: "mock"` only for local harness validation.

Use `mode: "desktop-thread"` when Codex Desktop thread tools are the execution surface. The adapter writes a request to `.harness/runs/<run_id>/desktop-thread/<step_id>/request.json`, sets the supervisor to `waiting_for_desktop_thread`, and resumes after `response.json` exists. Use `runner/adapters/desktop_thread_bridge.py list` to find pending requests and `complete` to write a response after a Codex thread finishes.

Near-realtime recording behavior:

- Request creation records a `prompt` event.
- Response completion records a `model_response` event.
- Response completion records a `metric` event with duration, token, cost, intervention count, and success when available.
- Supervisor resume records validation and final outcome.

Full automatic Codex thread monitoring is deferred; see `ROADMAP.md`.

## Local Tools

Use `scripts/trace_tools.py` for deterministic local operations:

```powershell
python skills/agent-flight-recorder/scripts/trace_tools.py init-run --slug demo
python skills/agent-flight-recorder/scripts/trace_tools.py record --run-id <run_id> --type mission --summary "Implement the harness."
python skills/agent-flight-recorder/scripts/trace_tools.py analyze --run-id <run_id>
python skills/agent-flight-recorder/scripts/trace_tools.py recommend --run-id <run_id> --task "Build an agent harness."
```

If `python` is unavailable, use the bundled Codex Python runtime from the workspace dependency list.

## Prompt Diagnosis Rubric

Read `references/prompt-rubric.md` when generating a detailed prompt recommendation. Focus on:

- Goal clarity and explicit success criteria
- Tool-use policy and permission boundaries
- Evidence gathering before edits
- Failure recovery and retry limits
- Verification steps
- Output format

## Trace Schema

Read `references/trace-schema.md` when adding new event types, wiring hooks, or integrating an MCP server.

## Completion Style

For autonomous completion, prefer a full loop: record, act, verify, analyze, recommend. If a full trace is not possible, record at least the mission, key decisions, validation result, and final outcome.
