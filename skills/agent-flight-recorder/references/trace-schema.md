# Trace Schema

Store raw events as JSON Lines in `.harness/runs/<run_id>/events.jsonl`.

## Event Envelope

```json
{
  "timestamp": "2026-07-06T09:30:00+09:00",
  "run_id": "20260706-093000-demo",
  "type": "tool_call",
  "summary": "Read project files",
  "data": {}
}
```

## Event Types

- `mission`: User goal, success criteria, constraints.
- `prompt`: System, developer, user, or generated prompt.
- `model_response`: Assistant/model response text and metadata.
- `tool_call`: Tool name, arguments summary, expected result.
- `tool_result`: Result summary, exit code, files touched, artifacts produced.
- `error`: Failure, exception, sandbox rejection, missing dependency, bad output.
- `retry`: Recovery attempt and reason.
- `decision`: Autonomous choice, assumption, scope reduction.
- `validation`: Test, lint, static check, manual inspection, browser check.
- `metric`: Duration, token, cost, intervention count, success signal.
- `outcome`: Final state, completed work, unresolved risks.

## Required Fields

- `timestamp`
- `run_id`
- `type`
- `summary`

## Recommended Metrics

- `duration_ms`
- `tool_name`
- `exit_code`
- `files_read`
- `files_written`
- `tokens_estimated`
- `cost_estimated`
- `validation_status`
- `retry_count`

## Prompt Event Data

```json
{
  "role": "user",
  "prompt_kind": "task",
  "content": "Implement the next feature.",
  "source": "desktop-thread",
  "step_id": "agent-draft"
}
```

Allowed `role` values should remain generic: `system`, `developer`, `user`, `assistant`, `tool`, `generated`.

## Model Response Event Data

```json
{
  "content": "Completed the task...",
  "source": "desktop-thread",
  "thread_id": "019...",
  "step_id": "agent-draft",
  "finish_reason": "completed"
}
```

## Metric Event Data

```json
{
  "duration_ms": 12000,
  "token_count": 4021,
  "cost_estimated": 0.018,
  "user_intervention_count": 0,
  "success": true
}
```
