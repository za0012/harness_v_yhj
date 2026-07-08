#!/usr/bin/env python3
"""Import Codex-style execution text into Agent Flight Recorder runs."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
TRACE_TOOLS = ROOT / "skills" / "agent-flight-recorder" / "scripts"
sys.path.insert(0, str(TRACE_TOOLS))

from trace_tools import analyze, append_event, init_run, recommend, record_model_response, record_prompt  # noqa: E402


TOOL_PATTERNS = [
    re.compile(r"^\s*(?:tool|function|recipient_name)\s*[:=]\s*([\w.\-:]+)", re.I),
    re.compile(r"^\s*(?:call|calling|실행|호출)\s+([\w.\-:]+)", re.I),
    re.compile(r"\b(functions\.[\w_]+|web\.run|apply_patch|image_gen\.[\w_]+|mcp__[\w_]+__[\w_]+)\b"),
]
COMMAND_PATTERNS = [
    re.compile(r"^\s*(?:command|cmd|명령)\s*[:=]\s*(.+)", re.I),
    re.compile(r"^\s*\$ (.+)"),
]
RESULT_PATTERNS = [
    re.compile(r"exit code\s*[:=]\s*(-?\d+)", re.I),
    re.compile(r"wall time\s*[:=]\s*(.+)", re.I),
    re.compile(r"output\s*[:=]\s*(.*)", re.I),
]
USER_MARKERS = re.compile(r"^\s*(?:user|사용자|human)\s*[:>]\s*(.*)", re.I)
ASSISTANT_MARKERS = re.compile(r"^\s*(?:assistant|model|codex|응답)\s*[:>]\s*(.*)", re.I)
SYSTEM_MARKERS = re.compile(r"^\s*(?:system|developer|시스템|개발자)\s*[:>]\s*(.*)", re.I)


def compact(value: str, limit: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", value.strip())
    return cleaned[:limit] + ("..." if len(cleaned) > limit else "")


def line_blocks(text: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.strip():
            current.append(line.rstrip())
            continue
        if current:
            blocks.append("\n".join(current))
            current = []
    if current:
        blocks.append("\n".join(current))
    return blocks


def detect_tool(line: str) -> str | None:
    for pattern in TOOL_PATTERNS:
        match = pattern.search(line)
        if match:
            return match.group(1)
    return None


def detect_command(line: str) -> str | None:
    for pattern in COMMAND_PATTERNS:
        match = pattern.search(line)
        if match:
            return match.group(1).strip()
    return None


def parse_metric_value(text: str, pattern: str) -> int | None:
    match = re.search(pattern, text, re.I)
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def parse_metrics(text: str) -> dict[str, Any]:
    duration_ms = None
    duration_match = re.search(r"(?:duration|elapsed|실행 시간|완료 시간)\s*[:=]\s*([\d.]+)\s*(ms|s|sec|seconds|초|분)?", text, re.I)
    if duration_match:
        value = float(duration_match.group(1))
        unit = (duration_match.group(2) or "ms").lower()
        if unit in {"s", "sec", "seconds", "초"}:
            duration_ms = int(value * 1000)
        elif unit == "분":
            duration_ms = int(value * 60_000)
        else:
            duration_ms = int(value)
    tokens = parse_metric_value(text, r"(?:tokens?|토큰)\s*[:=]\s*([\d,]+)")
    interventions = parse_metric_value(text, r"(?:user interventions?|사용자 개입)\s*[:=]\s*([\d,]+)")
    cost = None
    cost_match = re.search(r"(?:cost|비용)\s*[:=]\s*\$?([\d.]+)", text, re.I)
    if cost_match:
        cost = float(cost_match.group(1))
    success = None
    if re.search(r"\b(success|passed|completed|성공|완료)\b", text, re.I):
        success = True
    if re.search(r"\b(failed|blocked|실패|차단|중단)\b", text, re.I):
        success = False
    return {
        "duration_ms": duration_ms,
        "token_count": tokens,
        "cost_estimated": cost,
        "user_intervention_count": interventions,
        "success": success,
    }


def mission_from_first_user(text: str) -> str:
    for line in text.splitlines():
        match = USER_MARKERS.match(line)
        if match and match.group(1).strip():
            return match.group(1).strip()
    return "Imported Codex execution log"


def import_transcript(
    text: str,
    mission: str | None = None,
    run_id: str | None = None,
    slug: str = "codex-import",
    source: str = "codex-transcript",
) -> dict[str, Any]:
    if not text.strip():
        raise SystemExit("Transcript is empty.")

    if run_id is None:
        created = init_run(slug, mission or "Imported Codex execution log")
        run_id = created["run_id"]
    elif mission:
        append_event(run_id, "mission", mission, {"source": source})

    blocks = line_blocks(text)
    imported = 0
    last_tool: str | None = None
    saw_outcome = False
    saw_validation = False

    for block in blocks:
        first = block.splitlines()[0]
        lower = block.lower()

        user_match = USER_MARKERS.match(first)
        system_match = SYSTEM_MARKERS.match(first)
        assistant_match = ASSISTANT_MARKERS.match(first)
        if user_match:
            content = user_match.group(1) or block
            record_prompt(run_id, "user", content, "task", source)
            imported += 1
            continue
        if system_match:
            role = "developer" if "developer" in first.lower() or "개발자" in first else "system"
            content = system_match.group(1) or block
            record_prompt(run_id, role, content, "context", source)
            imported += 1
            continue
        if assistant_match:
            content = assistant_match.group(1) or block
            record_model_response(run_id, content, source)
            imported += 1
            continue

        tool_name = detect_tool(first) or detect_tool(block)
        command = detect_command(first) or detect_command(block)
        if tool_name or command:
            last_tool = tool_name or "shell_command"
            append_event(
                run_id,
                "tool_call",
                f"{last_tool} 호출",
                {"tool_name": last_tool, "command": command, "raw": block, "source": source},
            )
            imported += 1
            continue

        exit_match = RESULT_PATTERNS[0].search(block)
        if exit_match or lower.startswith(("output", "stdout", "stderr", "결과", "출력")):
            exit_code = int(exit_match.group(1)) if exit_match else None
            event_type = "error" if exit_code not in (None, 0) or "error" in lower or "failed" in lower else "tool_result"
            append_event(
                run_id,
                event_type,
                "도구 실행 실패" if event_type == "error" else "도구 실행 결과",
                {"tool_name": last_tool, "exit_code": exit_code, "output": block, "source": source},
            )
            imported += 1
            continue

        if any(word in lower for word in ("retry", "재시도", "다시 시도", "recover")):
            append_event(run_id, "retry", compact(block), {"raw": block, "source": source})
            imported += 1
            continue

        if any(word in lower for word in ("validation", "검증", "test passed", "typecheck", "build passed", "테스트")):
            append_event(run_id, "validation", compact(block), {"raw": block, "source": source})
            saw_validation = True
            imported += 1
            continue

        if any(word in lower for word in ("outcome", "final", "완료", "성공", "실패", "blocked", "차단")):
            status = "completed" if re.search(r"완료|성공|completed|success|passed", lower) else "failed"
            append_event(run_id, "outcome", compact(block), {"status": status, "raw": block, "source": source})
            saw_outcome = True
            imported += 1
            continue

        if any(word in lower for word in ("i will", "판단", "decide", "plan", "계획")):
            append_event(run_id, "decision", compact(block), {"raw": block, "source": source})
            imported += 1
            continue

    metrics = parse_metrics(text)
    if any(value is not None for value in metrics.values()):
        append_event(run_id, "metric", "Imported run metric", {**metrics, "source": source})
        imported += 1

    if not saw_validation and re.search(r"\b(tsc|pytest|vitest|npm test|pnpm test|build)\b", text, re.I):
        append_event(run_id, "validation", "Transcript mentions a local validation command.", {"source": source})
        imported += 1

    if not saw_outcome:
        success = metrics.get("success")
        append_event(
            run_id,
            "outcome",
            "Imported transcript ended without explicit final outcome." if success is None else "Imported transcript outcome inferred from metrics.",
            {"status": "completed" if success else "unknown", "inferred": True, "source": source},
        )
        imported += 1

    analysis = analyze(run_id)
    recommendation = recommend(run_id, mission or mission_from_first_user(text))
    return {"run_id": run_id, "events_imported": imported, "analysis": analysis, "recommendation": recommendation}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Codex transcript text into a flight-recorder run")
    parser.add_argument("--input", help="Transcript text file. Reads stdin when omitted.")
    parser.add_argument("--mission")
    parser.add_argument("--run-id")
    parser.add_argument("--slug", default="codex-import")
    parser.add_argument("--source", default="codex-transcript")
    args = parser.parse_args()

    if args.input:
        text = Path(args.input).read_text(encoding="utf-8")
    else:
        text = sys.stdin.read()
    result = import_transcript(text, args.mission, args.run_id, args.slug, args.source)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
