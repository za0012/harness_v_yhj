# Prompt Recommendation Rubric

Use this rubric to diagnose a run and recommend a better prompt.

## Common Problems

- Vague goal: The task does not define the final artifact or success condition.
- Missing context gathering: The agent edits before reading relevant files.
- Weak tool policy: The prompt does not say when to search, inspect, run tests, or ask.
- No recovery loop: Errors stop progress instead of triggering retries or fallback.
- No validation: The run ends without a check tied to the success criteria.
- Unsafe autonomy: The prompt allows broad edits, destructive commands, or unstated assumptions.
- No output contract: The final answer format is unclear.

## Recommendation Shape

Return:

1. Diagnosis: 3-6 bullets grounded in trace evidence.
2. Improved prompt: A copy-ready prompt.
3. Why it helps: Map each major instruction to a trace failure or inefficiency.
4. Verification checklist: 3-7 concrete checks for the next run.

## Strong Prompt Template

```text
Mission:
<one-sentence task>

Success criteria:
- <observable completion condition>
- <required artifact or behavior>

Operating rules:
- Inspect relevant context before changing files.
- Record major tool calls, errors, retries, validations, and outcome.
- If blocked, retry with one alternative; if still blocked, complete the smallest useful version and report the blocker.
- Do not perform destructive actions unless explicitly requested.

Verification:
- Run <test/check>.
- Summarize evidence from the result.

Final response:
- Changed artifacts
- Verification
- Recommended next prompt or follow-up
```
