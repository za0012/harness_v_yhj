# Patch Notes

## 2026-07-07

### Korean UI recovery

- Rebuilt `src/App.tsx` copy with natural Korean labels for run records, timeline, prompt diagnosis, recommendation, comparison, how-it-works, and patch notes.
- Rebuilt `src/api.ts` fallback/demo data so the app still presents a coherent Flight Recorder + Prompt Recommender flow when Electron IPC is unavailable.
- Kept how-it-works and patch notes as independent tabs rather than embedding them inside run blocks.

### UI validation

- Added `runner/tests/static-ui-smoke.mjs` to verify required Korean UI copy exists in source/build output and broken mojibake patterns are absent.
- Added `static-ui-smoke` to `runner/plans/product-autopilot.json`, increasing the product autopilot plan to seven validation steps.
- Updated `runner/tests/visual-smoke.mjs` to use the current Korean UI copy. Local Chrome/Edge still closes immediately in this environment, so visual browser execution remains a recorded environment blocker.

### Prompt evidence import

- Added `runner/adapters/codex_rollout_capture.py` to import local Codex thread rollout JSONL from `~/.codex/state_5.sqlite`.
- The rollout importer captures system/developer/user prompts, model responses, outcome, duration, and `tokens_used` when available.
- Added a "최근 Codex 대화 가져오기" action in the Electron app so the user can import the latest local Codex conversation without manually pasting logs.
- Added a "수집된 프롬프트" panel to the run record view so captured prompt evidence is visible before reading the recommendation.

### Recommendation quality

- Reworked `recommend()` so the recommended prompt includes original prompt evidence, trace evidence, and issue-driven prompt fixes.
- Recommendation output now exposes `original_user_prompt`, `original_system_prompt`, `prompt_fixes`, and `used_tools`.
- Acceptance tests now assert that recommendations are not just task-name substitutions and include prompt evidence/fix sections.

### Live Codex watcher

- Added `runner/adapters/codex_live_watcher.py` to watch the active Codex rollout JSONL and append new events into a Flight Recorder run.
- The watcher stores `live-watcher.json` with the current thread id, rollout path, byte offset, imported event count, and last status so it can resume without duplicating old lines.
- Electron now exposes `startLiveWatcher`, `stopLiveWatcher`, and `getLiveWatcherStatus` IPC calls and keeps the watcher as a background child process.
- The capture tab now has live start/stop controls, shows the connected run id, rollout path, imported event count, and auto-refreshes the selected run while watching.

### Validation

- TypeScript project build passed.
- Acceptance suite passed.
- Vite production build passed after escalation because esbuild process spawning is blocked inside the sandbox.
- Static UI smoke passed against source and built assets.
- Product autopilot run `20260707-100802-ui-korean-static-smoke` completed all 7 steps with zero errors and zero user interventions.

## 2026-07-06

### Product direction

- Reframed the project as Tool-Use Flight Recorder + Prompt Recommender.
- Kept the uninterrupted harness as the internal execution engine, not the final product surface.
- Reworked the app flow around execution records, timeline, prompt diagnosis, prompt recommendation, and Before/After comparison.

### Flight Recorder

- Added richer trace analysis for prompts, model responses, tool calls, tool results, errors, retries, validation, metrics, and final outcome.
- Added diagnosis issues for vague goals, missing success criteria, missing forbidden actions, unclear output format, missing tool policy, missing validation, and overloaded constraints.
- Added prompt recommendation output with system prompt, user prompt, tool policy, validation checklist, and retry strategy.
- Added Before/After comparison for success, tool calls, errors, cost, duration, and user interventions.

### Autopilot harness

- Added `runner/supervisor.py autopilot`.
- Autopilot creates a run, records system/user prompts, records a model-response summary, executes the plan, resumes until terminal state, records metrics, analyzes the run, and generates a recommendation.
- Added `runner/plans/product-autopilot.json` for product validation.

### Electron app

- Rebuilt the React UI around a Toss-style layout.
- Fixed the sidebar width on desktop and medium screens.
- Added an in-app explanation of why run count grows.
- Added in-app patch notes.
- Applied Pretendard Variable as the preferred font.
- Replaced stiff translated labels with natural Korean copy.

### Follow-up UI QA

- Split execution records, prompt recommendation, Before/After comparison, how-it-works, and patch notes into separate tabs.
- Hid scrollbars in the run list and timeline while keeping scrolling behavior.
- Clamped sidebar run-card text so long missions do not spill outside cards.
- Made the timeline scroll internally after it grows past a fixed height.
- Stopped selected runs from overwriting the prompt recommendation input.
- Normalized prompt recommendation input so UI helper text such as "이런 작업을 하고 싶어:" is not copied into the generated prompt.
- Added clearer Before/After comparison guidance and a plain-language comparison summary.

### Log-based recommendation QA

- Reworked the recommendation tab so it shows selected run, diagnosis evidence, and what the recommendation improves.
- Suppressed old mojibake recommendation data and prompts users to regenerate with the current engine.
- Added display guards for broken legacy run text in the sidebar, timeline, and diagnosis areas.
- Added explicit "actual Codex capture status" notes to clarify that standalone Codex Desktop runs are not yet automatically captured unless hooks/adapters are connected.
- Added ellipsis handling for long block titles.

### Codex capture adapter

- Added `runner/adapters/codex_capture.py` to import pasted or exported Codex transcripts into `.harness/runs/*/events.jsonl`.
- Added a dedicated "로그 가져오기" tab in the Electron app. Imported logs are analyzed, recommended, and selected as runs immediately.
- Exposed transcript import through Electron IPC and the MCP server as `import_codex_transcript`.
- Rebuilt `trace_tools.py` with clean Korean diagnosis text and log-grounded recommendations that include trace evidence.
- Added `runner/tests/acceptance.py` to check transcript import, timeline event extraction, diagnosis, recommendation, and Before/After comparison.
- Updated the product autopilot plan so the new adapter and acceptance suite are part of local validation.

### Codex lifecycle hooks

- Added `.codex/hooks.json`, the official project-local Codex hook configuration file.
- Wired `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` to the Flight Recorder hook entrypoint.
- Rebuilt `hooks/hook_event.py` so it reads stdin hook payloads, preserves redacted raw payloads, extracts prompt/tool/result/status fields, and keeps related hook events in the same run.
- Added `hooks/session-start.cmd` and `hooks/user-prompt-submit.cmd` wrappers.
- Hook smoke simulation confirmed prompt, tool call, tool result, outcome, metric, analysis, and recommendation files are generated under `.harness/runs`.

### Codex exec capture

- Confirmed the local AppData Codex CLI supports `codex exec --json`.
- Added `runner/adapters/codex_exec_capture.py` to run Codex non-interactively and map JSONL stream events into Flight Recorder timeline events.
- Added `codex-exec` mode to `runner/adapters/codex_adapter.py` so supervisor plans can run a real Codex agent and capture the stream.
- Rebuilt the acceptance suite with clean text fixtures and added JSONL parser coverage for `thread.started`, `turn.started`, `item.started`, `item.completed`, `item.agentMessage.delta`, and `turn.completed`.

### Validation

- Python harness compile passed.
- Electron main/preload syntax checks passed.
- TypeScript build passed.
- Vite production build passed after running outside the sandbox because esbuild process spawning was blocked inside it.
- Autopilot run `20260706-145322-ui-autopilot` completed with zero user interventions.
