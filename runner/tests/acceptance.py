#!/usr/bin/env python3
"""Acceptance checks for the Flight Recorder product flow."""

from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
os.environ["FLIGHT_RECORDER_DIR"] = str(ROOT / ".harness" / "acceptance-runs")
sys.path.insert(0, str(ROOT / "skills" / "agent-flight-recorder" / "scripts"))
sys.path.insert(0, str(ROOT / "runner" / "adapters"))

from codex_capture import import_transcript  # noqa: E402
from trace_tools import append_event, compare, init_run, normalize_task, recommend  # noqa: E402


SAMPLE = """User: Tool-Use Flight Recorder + Prompt Recommender UI와 자율 실행 루프를 검증해줘

Assistant: 관련 파일을 읽고 현재 구조를 확인하겠습니다.

Tool: functions.shell_command
Command: rg --files

Exit code: 0
Output: src/App.tsx runner/supervisor.py

Tool: functions.shell_command
Command: node node_modules/typescript/bin/tsc -b

Exit code: 1
Output: TypeScript error in src/App.tsx

Retry: 깨진 문구를 제거하고 타입 오류를 수정한 뒤 다시 검증합니다.

Validation: tsc -b passed

Final: 완료. UI, trace engine, adapter를 수정했고 검증을 통과했습니다.
Duration: 94s
Tokens: 18200
Cost: $0.46
Success: true
"""


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    assert_true(
        normalize_task("작업 목표: 무중단 하네스 어떻게 만드는지 구체적으로 정리해서 줘봐")
        == "무중단 하네스 어떻게 만드는지 구체적으로 정리해서 줘봐",
        "normalize_task should remove UI prefixes",
    )

    imported = import_transcript(SAMPLE, "실제 Codex 로그 기반 추천 검증", slug="acceptance-import")
    analysis = imported["analysis"]
    recommendation = imported["recommendation"]
    counts = analysis["event_counts"]

    assert_true(imported["events_imported"] >= 8, "transcript import should create enough timeline events")
    assert_true(counts.get("prompt", 0) >= 1, "transcript import should record user prompt")
    assert_true(counts.get("model_response", 0) >= 1, "transcript import should record model response")
    assert_true(counts.get("tool_call", 0) >= 2, "transcript import should record tool calls")
    assert_true(counts.get("error", 0) >= 1, "transcript import should record failing tool result as error")
    assert_true(counts.get("retry", 0) >= 1, "transcript import should record retry")
    assert_true(counts.get("validation", 0) >= 1, "transcript import should record validation")
    assert_true("Trace evidence:" in recommendation["recommended_prompt"], "recommendation should include run evidence")
    assert_true("실제 Codex 로그 기반 추천 검증" in recommendation["recommended_prompt"], "recommendation should include the task")

    before = init_run("acceptance-before", "대충 하네스 만들어줘")["run_id"]
    append_event(before, "prompt", "user prompt recorded", {"role": "user", "content": "대충 하네스 만들어줘"})
    append_event(before, "tool_call", "shell command", {"command": "pnpm build"})
    append_event(before, "error", "build failed", {"exit_code": 1})
    rec = recommend(before, "이런 작업을 하고 싶어: 실제 실행 로그 기반 추천 만들기")
    assert_true("실제 실행 로그 기반 추천 만들기" in rec["recommended_prompt"], "recommend should use cleaned task")
    assert_true(any("재시도" in item for item in rec["retry_strategy"]), "recommend should include retry strategy")

    compared = compare(before, imported["run_id"])
    assert_true(len(compared["metrics"]) == 6, "compare should expose six product metrics")
    assert_true(compared["after"]["validation_count"] >= 1, "after run should preserve validation count")

    print("acceptance ok")


if __name__ == "__main__":
    main()
