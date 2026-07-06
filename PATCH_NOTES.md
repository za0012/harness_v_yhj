# Patch Notes

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

### Validation

- Python harness compile passed.
- Electron main/preload syntax checks passed.
- TypeScript build passed.
- Vite production build passed after running outside the sandbox because esbuild process spawning was blocked inside it.
- Autopilot run `20260706-145322-ui-autopilot` completed with zero user interventions.
