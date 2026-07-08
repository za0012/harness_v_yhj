#!/usr/bin/env python3
"""Local trace tools for Agent Flight Recorder."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
RUNS_DIR = Path(os.environ.get("FLIGHT_RECORDER_DIR", ROOT / ".harness" / "runs"))


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9가-힣_-]+", "-", value.strip()).strip("-")
    return cleaned[:48] or "run"


def run_dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def events_path(run_id: str) -> Path:
    return run_dir(run_id) / "events.jsonl"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_events(run_id: str) -> list[dict[str, Any]]:
    path = events_path(run_id)
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


def append_event(run_id: str, event_type: str, summary: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    event = {
        "timestamp": now_iso(),
        "run_id": run_id,
        "type": event_type,
        "summary": summary,
        "data": data or {},
    }
    path = events_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def record_prompt(
    run_id: str,
    role: str,
    content: str,
    prompt_kind: str = "task",
    source: str = "manual",
    step_id: str | None = None,
) -> dict[str, Any]:
    return append_event(
        run_id,
        "prompt",
        f"{role} prompt recorded",
        {"role": role, "prompt_kind": prompt_kind, "content": content, "source": source, "step_id": step_id},
    )


def record_model_response(
    run_id: str,
    content: str,
    source: str = "manual",
    step_id: str | None = None,
    thread_id: str | None = None,
    finish_reason: str | None = None,
) -> dict[str, Any]:
    return append_event(
        run_id,
        "model_response",
        "Model response recorded",
        {"content": content, "source": source, "step_id": step_id, "thread_id": thread_id, "finish_reason": finish_reason},
    )


def record_metric(
    run_id: str,
    duration_ms: int | None = None,
    token_count: int | None = None,
    cost_estimated: float | None = None,
    user_intervention_count: int | None = None,
    success: bool | None = None,
    step_id: str | None = None,
) -> dict[str, Any]:
    return append_event(
        run_id,
        "metric",
        "Run metric recorded",
        {
            "duration_ms": duration_ms,
            "token_count": token_count,
            "cost_estimated": cost_estimated,
            "user_intervention_count": user_intervention_count,
            "success": success,
            "step_id": step_id,
        },
    )


def normalize_task(task: str) -> str:
    cleaned = task.strip()
    prefixes = ["작업 목표:", "목표:", "Mission:", "mission:"]
    changed = True
    while changed:
        changed = False
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :].strip()
                changed = True
    return cleaned or "사용자가 요청한 작업 완주"


def init_run(slug: str, mission: str | None = None) -> dict[str, Any]:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"{stamp}-{slugify(slug)}"
    run_dir(run_id).mkdir(parents=True, exist_ok=True)
    if mission:
        append_event(run_id, "mission", mission, {"source": "init"})
    return {"run_id": run_id, "path": str(run_dir(run_id))}


def event_text(event: dict[str, Any]) -> str:
    data = event.get("data") or {}
    parts = [str(event.get("summary", ""))]
    for key in ("content", "command", "output", "stderr", "stdout", "target"):
        value = data.get(key)
        if isinstance(value, str):
            parts.append(value)
    return "\n".join(parts)


def collected_prompt_text(events: list[dict[str, Any]]) -> str:
    return "\n".join(event_text(event) for event in events if event.get("type") in {"mission", "prompt"}).lower()


def has_any(text: str, needles: tuple[str, ...]) -> bool:
    return any(needle.lower() in text for needle in needles)


def diagnosis_issue(issue_id: str, severity: str, title: str, evidence: str, recommendation: str) -> dict[str, str]:
    return {
        "id": issue_id,
        "severity": severity,
        "title": title,
        "evidence": evidence,
        "recommendation": recommendation,
    }


def diagnose_events(events: list[dict[str, Any]]) -> list[dict[str, str]]:
    counts = Counter(event.get("type", "unknown") for event in events)
    prompt_text = collected_prompt_text(events)
    prompts = [event for event in events if event.get("type") == "prompt"]
    tool_calls = [event for event in events if event.get("type") == "tool_call"]
    errors = [event for event in events if event.get("type") == "error"]
    retries = [event for event in events if event.get("type") == "retry"]
    validations = [event for event in events if event.get("type") == "validation"]
    model_responses = [event for event in events if event.get("type") == "model_response"]
    issues: list[dict[str, str]] = []

    if not events:
        return [
            diagnosis_issue(
                "empty_trace",
                "high",
                "실행 기록이 비어 있음",
                "events.jsonl에 분석할 이벤트가 없습니다.",
                "작업 시작 때 mission, prompt, tool call, validation, outcome을 남기세요.",
            )
        ]

    if counts.get("mission", 0) == 0:
        issues.append(
            diagnosis_issue(
                "missing_goal",
                "high",
                "사용자 목표가 기록되지 않음",
                "mission 이벤트가 없습니다.",
                "첫 이벤트에 사용자의 원래 목표를 한 문장으로 저장하세요.",
            )
        )

    if not has_any(prompt_text, ("success", "criteria", "완료 조건", "성공 조건", "definition of done", "검증 기준")):
        issues.append(
            diagnosis_issue(
                "missing_success_criteria",
                "high",
                "성공 조건이 불명확함",
                "프롬프트나 목표에서 측정 가능한 완료 조건을 찾지 못했습니다.",
                "완료 조건을 3~5개의 확인 가능한 항목으로 분리하세요.",
            )
        )

    if not has_any(prompt_text, ("do not", "don't", "must not", "금지", "하지 말", "승인 없이")):
        issues.append(
            diagnosis_issue(
                "missing_forbidden_actions",
                "medium",
                "금지 행동이 없음",
                "삭제, 리셋, 배포, 외부 전송처럼 위험한 행동의 기준이 없습니다.",
                "에이전트가 사용자 승인 없이 하면 안 되는 행동을 명시하세요.",
            )
        )

    if not has_any(prompt_text, ("output", "format", "final response", "결과 형식", "출력 형식", "최종 답변")):
        issues.append(
            diagnosis_issue(
                "missing_output_format",
                "medium",
                "출력 형식이 불명확함",
                "마지막 답변이나 산출물 형식에 대한 지시가 부족합니다.",
                "최종 답변은 변경 사항, 검증 결과, 남은 위험을 포함하도록 형식을 고정하세요.",
            )
        )

    if tool_calls and not has_any(prompt_text, ("tool", "도구", "search", "read", "검증", "validation", "test")):
        issues.append(
            diagnosis_issue(
                "missing_tool_policy",
                "medium",
                "도구 사용 기준이 없음",
                f"tool_call은 {len(tool_calls)}개 있었지만 프롬프트에는 도구 사용 원칙이 없습니다.",
                "파일 읽기, 검색, 명령 실행, 검증을 언제 수행할지 기준을 적으세요.",
            )
        )

    if tool_calls and not validations:
        issues.append(
            diagnosis_issue(
                "missing_validation",
                "high",
                "검증 단계가 빠짐",
                f"tool_call {len(tool_calls)}개가 있지만 validation 이벤트가 없습니다.",
                "수정 뒤 최소 하나의 로컬 검증 명령 또는 수동 확인 결과를 기록하세요.",
            )
        )

    if prompts and not model_responses:
        issues.append(
            diagnosis_issue(
                "missing_model_response",
                "medium",
                "모델 응답이 기록되지 않음",
                "prompt 이벤트는 있지만 model_response 이벤트가 없습니다.",
                "에이전트 응답 원문 또는 요약을 model_response 이벤트로 저장하세요.",
            )
        )

    if errors and not retries:
        issues.append(
            diagnosis_issue(
                "missing_retry_strategy",
                "high",
                "실패 후 재시도 전략이 없음",
                f"error {len(errors)}개가 있지만 retry 이벤트가 없습니다.",
                "실패 원인, 복구 시도, 축소 실행 기준을 retry 이벤트로 남기세요.",
            )
        )

    if counts.get("outcome", 0) == 0:
        issues.append(
            diagnosis_issue(
                "missing_outcome",
                "high",
                "최종 성공 여부가 없음",
                "outcome 이벤트가 없습니다.",
                "완료, 실패, 차단 상태와 이유를 마지막 이벤트로 기록하세요.",
            )
        )

    role_count = sum(prompt_text.count(word) for word in ("role", "역할", "rule", "규칙", "constraint", "제약"))
    if len(prompt_text) > 2000 and role_count >= 5:
        issues.append(
            diagnosis_issue(
                "overloaded_prompt",
                "medium",
                "역할과 제약이 너무 많이 섞임",
                "프롬프트가 길고 역할, 규칙, 제약 표현이 많습니다.",
                "시스템 원칙, 작업 지시, 도구 정책, 검증 조건을 섹션별로 나누세요.",
            )
        )

    return issues


def metric_totals(events: list[dict[str, Any]]) -> dict[str, Any]:
    totals = {
        "duration_ms": 0,
        "token_count": 0,
        "cost_estimated": 0.0,
        "user_intervention_count": 0,
        "success": None,
    }
    for event in events:
        if event.get("type") != "metric":
            continue
        data = event.get("data") or {}
        for key in ("duration_ms", "token_count", "user_intervention_count"):
            value = data.get(key)
            if isinstance(value, int):
                totals[key] += value
        cost = data.get("cost_estimated")
        if isinstance(cost, (int, float)):
            totals["cost_estimated"] += float(cost)
        if isinstance(data.get("success"), bool):
            totals["success"] = data["success"]
    if totals["duration_ms"] == 0 and len(events) >= 2:
        try:
            started = datetime.fromisoformat(events[0]["timestamp"])
            ended = datetime.fromisoformat(events[-1]["timestamp"])
            totals["duration_ms"] = max(0, int((ended - started).total_seconds() * 1000))
        except (KeyError, TypeError, ValueError):
            pass
    if totals["success"] is None:
        outcome = next((event for event in reversed(events) if event.get("type") == "outcome"), None)
        status = ((outcome or {}).get("data") or {}).get("status")
        if status in {"completed", "success", "passed"}:
            totals["success"] = True
        elif status in {"failed", "blocked"}:
            totals["success"] = False
    return totals


def analyze(run_id: str) -> dict[str, Any]:
    events = read_events(run_id)
    counts = Counter(event.get("type", "unknown") for event in events)
    issues = diagnose_events(events)
    result = {
        "run_id": run_id,
        "event_count": len(events),
        "event_counts": dict(counts),
        "tool_call_count": counts.get("tool_call", 0),
        "prompt_count": counts.get("prompt", 0),
        "model_response_count": counts.get("model_response", 0),
        "error_count": counts.get("error", 0),
        "retry_count": counts.get("retry", 0),
        "validation_count": counts.get("validation", 0),
        "metric_count": counts.get("metric", 0),
        "metric_totals": metric_totals(events),
        "risks": [issue["title"] for issue in issues],
        "diagnosis_issues": issues,
        "last_event": events[-1] if events else None,
    }
    write_json(run_dir(run_id) / "analysis.json", result)
    return result


def mission_from_events(events: list[dict[str, Any]], fallback: str) -> str:
    mission = next((event for event in events if event.get("type") == "mission"), None)
    if mission:
        return str(mission.get("summary") or fallback)
    prompt = next((event for event in events if event.get("type") == "prompt" and (event.get("data") or {}).get("role") == "user"), None)
    if prompt:
        content = ((prompt.get("data") or {}).get("content") or "").strip()
        if content:
            return content.splitlines()[0][:180]
    return fallback


def issue_ids(issues: list[dict[str, Any]]) -> set[str]:
    return {str(issue.get("id")) for issue in issues}


def evidence_lines(events: list[dict[str, Any]], analysis: dict[str, Any]) -> list[str]:
    counts = analysis.get("event_counts") or {}
    metrics = analysis.get("metric_totals") or {}
    lines = [
        f"이 run은 이벤트 {analysis.get('event_count', 0)}개, 도구 호출 {counts.get('tool_call', 0)}개, 오류 {counts.get('error', 0)}개, 검증 {counts.get('validation', 0)}개를 포함했습니다.",
    ]
    if metrics.get("duration_ms"):
        lines.append(f"완료 시간은 약 {round(metrics['duration_ms'] / 1000)}초로 기록되었습니다.")
    if metrics.get("token_count"):
        lines.append(f"토큰 사용량은 {metrics['token_count']:,}개로 기록되었습니다.")
    if metrics.get("cost_estimated"):
        lines.append(f"비용은 약 ${metrics['cost_estimated']:.4f}로 기록되었습니다.")
    if metrics.get("success") is not None:
        lines.append(f"최종 성공 여부는 {metrics['success']}로 기록되었습니다.")
    last_error = next((event for event in reversed(events) if event.get("type") == "error"), None)
    if last_error:
        lines.append(f"마지막 오류 근거: {last_error.get('summary')}")
    return lines


def prompt_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [event for event in events if event.get("type") == "prompt"]


def prompt_excerpt(events: list[dict[str, Any]], role: str = "user", limit: int = 420) -> str:
    for event in reversed(prompt_events(events)):
        data = event.get("data") or {}
        if data.get("role") == role and isinstance(data.get("content"), str):
            content = data["content"].strip()
            return content[:limit] + ("..." if len(content) > limit else "")
    return ""


def tool_names(events: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for event in events:
        if event.get("type") != "tool_call":
            continue
        data = event.get("data") or {}
        name = data.get("tool_name") or data.get("tool") or data.get("recipient_name") or event.get("summary")
        if isinstance(name, str) and name:
            names.append(name)
    return list(dict.fromkeys(names))


def issue_driven_actions(ids: set[str], analysis: dict[str, Any]) -> list[str]:
    actions: list[str] = []
    if "missing_goal" in ids:
        actions.append("작업 목표를 한 문장으로 먼저 고정하고, 목표에 포함되지 않는 일은 별도 요청으로 분리한다.")
    if "missing_success_criteria" in ids:
        actions.append("완료 조건을 측정 가능한 체크리스트 3~5개로 둔다.")
    if "missing_forbidden_actions" in ids:
        actions.append("삭제, 리셋, 외부 전송, 대규모 리팩터링처럼 하지 말아야 할 행동을 명시한다.")
    if "missing_output_format" in ids:
        actions.append("최종 답변 형식을 변경 사항, 검증 결과, 남은 위험으로 고정한다.")
    if "missing_tool_policy" in ids:
        actions.append("검색, 파일 읽기, 명령 실행, UI 검증을 언제 사용할지 기준을 둔다.")
    if "missing_validation" in ids:
        actions.append("구현 뒤 타입체크, 스모크 테스트, UI 확인 중 가능한 검증을 validation으로 남긴다.")
    if "missing_model_response" in ids:
        actions.append("모델 응답 원문 또는 요약을 model_response 이벤트로 저장한다.")
    if "missing_retry_strategy" in ids or analysis.get("error_count", 0) > 0:
        actions.append("실패하면 원인을 분류하고 같은 방식 반복 대신 다른 복구 경로를 한 번 시도한다.")
    if "missing_outcome" in ids:
        actions.append("마지막에 completed, failed, blocked 중 하나로 outcome을 남긴다.")
    if "overloaded_prompt" in ids:
        actions.append("역할, 작업 지시, 도구 정책, 검증 조건을 섹션으로 나눠 프롬프트를 줄인다.")
    return actions


def recommend(run_id: str, task: str) -> dict[str, Any]:
    task = normalize_task(task)
    events = read_events(run_id)
    analysis = analyze(run_id)
    issues = analysis.get("diagnosis_issues") or []
    ids = issue_ids(issues)
    mission = mission_from_events(events, task)
    evidence = evidence_lines(events, analysis)
    diagnosis = [issue["title"] for issue in issues] or ["기록 구조는 안정적입니다. 다음 실행에서는 비용, 완료 시간, 성공 기준을 더 선명하게 비교하세요."]
    actions = issue_driven_actions(ids, analysis)
    original_user_prompt = prompt_excerpt(events, "user")
    original_system_prompt = prompt_excerpt(events, "system")
    used_tools = tool_names(events)

    success_criteria = [
        "사용자가 확인 가능한 산출물을 만든다.",
        "실행 중 받은 프롬프트, 모델 응답, 도구 호출, 도구 결과를 run 단위로 남긴다.",
        "오류, 재시도, 중단 지점, 실행 시간, 토큰, 비용, 최종 성공 여부를 누락 없이 기록한다.",
        "타임라인, 프롬프트 진단, 추천 프롬프트, Before/After 비교가 같은 run 데이터에서 계산된다.",
    ]
    if "missing_validation" in ids:
        success_criteria.append("최소 한 가지 검증 결과를 validation 이벤트로 남긴다.")
    if "missing_outcome" in ids:
        success_criteria.append("마지막에 completed, failed, blocked 중 하나로 outcome을 남긴다.")
    if "missing_model_response" in ids:
        success_criteria.append("모델 응답 원문 또는 요약을 model_response로 저장한다.")
    if analysis.get("error_count", 0) > 0:
        success_criteria.append("이전 run에서 발생한 오류 유형이 재발하지 않는지 확인한다.")

    system_prompt = (
        "당신은 Tool-Use Flight Recorder가 관찰하는 자율 AI 에이전트입니다. "
        "사용자 목표를 실제 산출물로 완주하면서 프롬프트, 모델 응답, 판단, 도구 호출, 오류, 재시도, 검증, 비용과 결과를 실행 로그로 남깁니다. "
        "불명확한 부분은 합리적으로 가정하되 권한, 안전, 필수 입력이 막히는 경우에만 사용자에게 질문합니다."
    )
    fixes_text = "\n".join(f"- {item}" for item in actions) if actions else "- 현재 큰 누락은 없지만 완료 기준, 검증, 비용/시간 비교를 더 선명하게 둔다."
    user_prompt = (
        f"작업 목표:\n{task}\n\n"
        "이전 run에서 본 근거:\n"
        + "\n".join(f"- {line}" for line in evidence)
        + "\n\n이번 프롬프트에서 반드시 보완할 점:\n"
        + fixes_text
        + "\n\n완료 조건:\n"
        + "\n".join(f"- {item}" for item in success_criteria)
        + "\n\n출력 형식:\n- 변경한 산출물\n- 검증 결과\n- 남은 위험\n- 다음 run에서 비교할 지표"
    )

    tool_policy = [
        "파일을 수정하기 전에 관련 파일과 설정을 먼저 읽고 근거를 남긴다.",
        "검색, 파일 읽기, 명령 실행, UI 검증은 각각 tool_call/tool_result로 기록한다.",
        "명령이 실패하면 error를 기록하고 원인을 권한, 환경, 입력, 코드 오류 중 하나로 분류한다.",
        "삭제, 리셋, 배포, 외부 전송처럼 되돌리기 어려운 행동은 명시 승인 없이 하지 않는다.",
    ]
    if used_tools:
        tool_policy.append(f"이전 run에서 사용한 도구({', '.join(used_tools[:5])})는 같은 목적일 때만 반복 사용한다.")
    if "missing_retry_strategy" in ids or analysis.get("error_count", 0) > 0:
        tool_policy.append("같은 실패를 반복하지 말고 두 번째 시도에서는 다른 검증 경로나 더 작은 범위로 복구한다.")
    if "missing_validation" in ids:
        tool_policy.append("구현 뒤 가능한 검증을 반드시 실행하고 결과를 validation 이벤트로 남긴다.")

    validation_checklist = [
        "events.jsonl에 mission, prompt, model_response, tool_call, tool_result가 들어가는가?",
        "오류가 있으면 error와 retry 또는 blocked outcome이 남는가?",
        "validation 이벤트가 실제 명령 결과나 수동 확인 근거를 포함하는가?",
        "recommendation.json이 이번 run의 diagnosis_issues와 evidence를 반영하는가?",
        "Before/After 비교에서 success, tool_call_count, error_count, cost, duration, user_intervention_count가 계산되는가?",
    ]
    retry_strategy = [
        "실패 원인을 권한, 환경, 입력 부족, 코드 오류로 먼저 분류한다.",
        "복구 가능한 오류는 가장 작은 수정으로 한 번 재시도하고 retry 이벤트를 남긴다.",
        "같은 오류가 반복되면 범위를 줄여 검증 가능한 최소 산출물까지 완주한다.",
        "권한이나 필수 입력이 없으면 중단 지점과 다음 행동을 outcome에 남긴다.",
    ]

    prompt = (
        f"Mission:\n{task}\n\n"
        "Original prompt evidence:\n"
        + (f"- User prompt excerpt: {original_user_prompt}\n" if original_user_prompt else "- User prompt was not captured in this run.\n")
        + (f"- System prompt excerpt: {original_system_prompt}\n" if original_system_prompt else "")
        + "\nTrace evidence:\n"
        + "\n".join(f"- {line}" for line in evidence)
        + "\n\nPrompt fixes applied:\n"
        + fixes_text
        + "\n\nSuccess criteria:\n"
        + "\n".join(f"- {item}" for item in success_criteria)
        + "\n\nOperating rules:\n"
        + "\n".join(f"- {item}" for item in tool_policy)
        + "\n\nVerification:\n"
        + "\n".join(f"- {item}" for item in validation_checklist)
        + "\n\nRetry strategy:\n"
        + "\n".join(f"- {item}" for item in retry_strategy)
        + "\n\nFinal response:\n- 변경한 산출물, 검증 결과, 남은 위험만 짧게 보고한다.\n"
    )

    result = {
        "run_id": run_id,
        "source_mission": mission,
        "evidence": evidence,
        "diagnosis": diagnosis,
        "diagnosis_issues": issues,
        "original_user_prompt": original_user_prompt,
        "original_system_prompt": original_system_prompt,
        "prompt_fixes": actions,
        "used_tools": used_tools,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "tool_policy": tool_policy,
        "validation_checklist": validation_checklist,
        "retry_strategy": retry_strategy,
        "copy_prompt": (
            f"## System Prompt\n{system_prompt}\n\n"
            f"## User Prompt\n{user_prompt}\n\n"
            "## Tool Policy\n"
            + "\n".join(f"- {item}" for item in tool_policy)
            + "\n\n## Validation Checklist\n"
            + "\n".join(f"- {item}" for item in validation_checklist)
            + "\n\n## Retry Strategy\n"
            + "\n".join(f"- {item}" for item in retry_strategy)
        ),
        "recommended_prompt": prompt,
        "verification_checklist": validation_checklist,
    }
    (run_dir(run_id) / "recommended-prompt.md").write_text(prompt, encoding="utf-8")
    write_json(run_dir(run_id) / "recommendation.json", result)
    return result


def compare(run_id_a: str, run_id_b: str) -> dict[str, Any]:
    before = analyze(run_id_a)
    after = analyze(run_id_b)
    before_metrics = before.get("metric_totals", {})
    after_metrics = after.get("metric_totals", {})

    def metric(report: dict[str, Any], totals: dict[str, Any], key: str) -> Any:
        return totals[key] if key in totals else report.get(key)

    rows = [
        ("success", metric(before, before_metrics, "success"), metric(after, after_metrics, "success")),
        ("tool_call_count", before.get("tool_call_count", 0), after.get("tool_call_count", 0)),
        ("error_count", before.get("error_count", 0), after.get("error_count", 0)),
        ("cost_estimated", metric(before, before_metrics, "cost_estimated"), metric(after, after_metrics, "cost_estimated")),
        ("duration_ms", metric(before, before_metrics, "duration_ms"), metric(after, after_metrics, "duration_ms")),
        (
            "user_intervention_count",
            metric(before, before_metrics, "user_intervention_count"),
            metric(after, after_metrics, "user_intervention_count"),
        ),
    ]
    result = {
        "before_run_id": run_id_a,
        "after_run_id": run_id_b,
        "metrics": [{"metric": name, "before": before_value, "after": after_value} for name, before_value, after_value in rows],
        "before": before,
        "after": after,
    }
    write_json(run_dir(run_id_b) / f"comparison-{run_id_a}-vs-{run_id_b}.json", result)
    return result


def parse_data(values: list[str]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"Invalid --data value: {value}. Use key=value.")
        key, raw = value.split("=", 1)
        try:
            data[key] = json.loads(raw)
        except json.JSONDecodeError:
            data[key] = raw
    return data


def parse_optional_int(value: str | None) -> int | None:
    return None if value in (None, "") else int(value)


def parse_optional_float(value: str | None) -> float | None:
    return None if value in (None, "") else float(value)


def parse_optional_bool(value: str | None) -> bool | None:
    if value in (None, ""):
        return None
    return value.lower() in ("1", "true", "yes", "y", "passed", "success", "completed")


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent Flight Recorder trace tools")
    sub = parser.add_subparsers(dest="command", required=True)

    init_parser = sub.add_parser("init-run")
    init_parser.add_argument("--slug", required=True)
    init_parser.add_argument("--mission")

    record_parser = sub.add_parser("record")
    record_parser.add_argument("--run-id", required=True)
    record_parser.add_argument("--type", required=True)
    record_parser.add_argument("--summary", required=True)
    record_parser.add_argument("--data", action="append", default=[])

    prompt_parser = sub.add_parser("record-prompt")
    prompt_parser.add_argument("--run-id", required=True)
    prompt_parser.add_argument("--role", required=True)
    prompt_parser.add_argument("--content", required=True)
    prompt_parser.add_argument("--prompt-kind", default="task")
    prompt_parser.add_argument("--source", default="manual")
    prompt_parser.add_argument("--step-id")

    response_parser = sub.add_parser("record-response")
    response_parser.add_argument("--run-id", required=True)
    response_parser.add_argument("--content", required=True)
    response_parser.add_argument("--source", default="manual")
    response_parser.add_argument("--step-id")
    response_parser.add_argument("--thread-id")
    response_parser.add_argument("--finish-reason")

    metric_parser = sub.add_parser("record-metric")
    metric_parser.add_argument("--run-id", required=True)
    metric_parser.add_argument("--duration-ms")
    metric_parser.add_argument("--token-count")
    metric_parser.add_argument("--cost-estimated")
    metric_parser.add_argument("--user-intervention-count")
    metric_parser.add_argument("--success")
    metric_parser.add_argument("--step-id")

    analyze_parser = sub.add_parser("analyze")
    analyze_parser.add_argument("--run-id", required=True)

    recommend_parser = sub.add_parser("recommend")
    recommend_parser.add_argument("--run-id", required=True)
    recommend_parser.add_argument("--task", required=True)

    compare_parser = sub.add_parser("compare")
    compare_parser.add_argument("--before-run-id", required=True)
    compare_parser.add_argument("--after-run-id", required=True)

    args = parser.parse_args()
    if args.command == "init-run":
        result = init_run(args.slug, args.mission)
    elif args.command == "record":
        result = append_event(args.run_id, args.type, args.summary, parse_data(args.data))
    elif args.command == "record-prompt":
        result = record_prompt(args.run_id, args.role, args.content, args.prompt_kind, args.source, args.step_id)
    elif args.command == "record-response":
        result = record_model_response(args.run_id, args.content, args.source, args.step_id, args.thread_id, args.finish_reason)
    elif args.command == "record-metric":
        result = record_metric(
            args.run_id,
            parse_optional_int(args.duration_ms),
            parse_optional_int(args.token_count),
            parse_optional_float(args.cost_estimated),
            parse_optional_int(args.user_intervention_count),
            parse_optional_bool(args.success),
            args.step_id,
        )
    elif args.command == "analyze":
        result = analyze(args.run_id)
    elif args.command == "recommend":
        result = recommend(args.run_id, args.task)
    elif args.command == "compare":
        result = compare(args.before_run_id, args.after_run_id)
    else:
        raise SystemExit(f"Unknown command: {args.command}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
