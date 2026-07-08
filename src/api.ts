import type {
  Analysis,
  CodexThreadSummary,
  ComparisonResult,
  ImportResult,
  LiveWatcherStatus,
  Recommendation,
  RunDetail,
  RunSummary,
  SupervisorResult,
  SupervisorState,
} from "./types";

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();

const demoAnalysis: Analysis = {
  run_id: "demo-codex-flight-recorder",
  event_count: 13,
  event_counts: {
    mission: 1,
    prompt: 2,
    model_response: 1,
    tool_call: 3,
    tool_result: 2,
    error: 1,
    retry: 1,
    validation: 1,
    metric: 1,
    outcome: 1,
  },
  tool_call_count: 3,
  prompt_count: 2,
  model_response_count: 1,
  error_count: 1,
  retry_count: 1,
  validation_count: 1,
  metric_count: 1,
  metric_totals: {
    duration_ms: 94000,
    token_count: 18200,
    cost_estimated: 0.46,
    user_intervention_count: 0,
    success: true,
  },
  risks: ["검증 단계가 한 번뿐이라 회귀 위험을 더 넓게 확인하면 좋습니다."],
  diagnosis_issues: [
    {
      id: "missing_output_format",
      severity: "medium",
      title: "출력 형식이 불명확함",
      evidence: "최종 답변 형식이 프롬프트에 고정되어 있지 않습니다.",
      recommendation: "최종 답변에 변경 사항, 검증 결과, 남은 위험을 포함하도록 형식을 고정하세요.",
    },
    {
      id: "missing_validation",
      severity: "high",
      title: "검증 단계가 부족함",
      evidence: "도구 호출은 여러 번 있었지만 validation 이벤트는 1개뿐입니다.",
      recommendation: "빌드, 정적 스모크, UI 실행 확인처럼 서로 다른 검증을 최소 2개 이상 남기세요.",
    },
  ],
  last_event: null,
};

const demoRecommendation: Recommendation = {
  run_id: "demo-codex-flight-recorder",
  source_mission: "Tool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성",
  evidence: [
    "이 run은 이벤트 13개, 도구 호출 3개, 오류 1개, 검증 1개를 포함했습니다.",
    "완료 시간은 약 94초, 토큰은 18,200개, 비용은 $0.46으로 기록되었습니다.",
    "오류 이후 retry가 있었고 최종 결과는 성공으로 기록되었습니다.",
  ],
  diagnosis: ["출력 형식이 불명확함", "검증 단계가 부족함"],
  diagnosis_issues: demoAnalysis.diagnosis_issues,
  original_user_prompt: "Tool-Use Flight Recorder + Prompt Recommender UI와 자율 실행 루프를 검증해줘",
  original_system_prompt: "사용자의 작업을 끝까지 구현하고 검증 결과를 짧게 보고한다.",
  prompt_fixes: [
    "완료 조건을 측정 가능한 항목으로 분리합니다.",
    "도구 호출 뒤에는 최소 하나의 검증 이벤트를 남기도록 요구합니다.",
    "실패하면 원인 분류, 복구 시도, 축소 검증 순서를 기록하게 합니다.",
  ],
  used_tools: ["functions.shell_command", "apply_patch"],
  system_prompt:
    "당신은 Agent Flight Recorder가 관찰하는 자율 코딩 에이전트입니다. 사용자의 목표를 실제 산출물로 완주하면서 프롬프트, 모델 응답, 도구 호출, 오류, 재시도, 검증, 비용, 결과를 run 단위로 남깁니다.",
  user_prompt:
    "작업 목표:\nTool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성\n\n완료 조건:\n- 실행 로그를 run 단위로 저장한다.\n- 타임라인, 진단, 추천, Before/After 비교가 같은 run 데이터에서 계산된다.\n- 빌드, 정적 스모크, UI 실행 확인 결과를 validation 이벤트로 남긴다.\n- 최종 답변에는 변경 사항, 검증 결과, 남은 위험만 짧게 보고한다.",
  tool_policy: [
    "파일을 수정하기 전에 관련 파일과 설정을 먼저 읽고 근거를 남긴다.",
    "검색, 파일 읽기, 명령 실행, UI 검증을 각각 tool_call/tool_result로 기록한다.",
    "명령이 실패하면 error를 기록하고 원인을 권한, 환경, 입력, 코드 오류 중 하나로 분류한다.",
    "삭제, 리셋, 배포처럼 되돌리기 어려운 행동은 명시 승인 없이 하지 않는다.",
  ],
  validation_checklist: [
    "events.jsonl에 mission, prompt, model_response, tool_call, tool_result가 들어가는가?",
    "오류가 있으면 error와 retry 또는 blocked outcome이 남는가?",
    "recommendation.json이 diagnosis_issues와 evidence를 반영하는가?",
    "Before/After 비교에서 success, tool_call_count, error_count, cost, duration, user_intervention_count가 계산되는가?",
  ],
  retry_strategy: [
    "실패 원인을 권한, 환경, 입력 부족, 코드 오류로 먼저 분류한다.",
    "복구 가능한 오류는 가장 작은 수정으로 한 번 재시도하고 retry 이벤트를 남긴다.",
    "같은 오류가 반복되면 범위를 줄여 검증 가능한 최소 산출물까지 완주한다.",
  ],
  recommended_prompt:
    "Mission:\nTool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성\n\nTrace evidence:\n- 이 run은 이벤트 13개, 도구 호출 3개, 오류 1개, 검증 1개를 포함했습니다.\n- 완료 시간은 약 94초, 토큰은 18,200개, 비용은 $0.46으로 기록되었습니다.\n\nSuccess criteria:\n- 실행 기록, 타임라인, 프롬프트 진단, 추천, Before/After 비교가 같은 run 데이터에서 계산된다.\n- 검증은 빌드, 정적 스모크, UI 실행 확인을 포함한다.\n\nFinal response:\n- 변경 사항, 검증 결과, 남은 위험만 짧게 보고한다.",
  verification_checklist: [
    "events.jsonl에 필수 이벤트가 들어가는가?",
    "추천이 실제 진단 이슈를 반영하는가?",
    "비교 지표가 계산되는가?",
  ],
};

demoRecommendation.copy_prompt = `## System Prompt
${demoRecommendation.system_prompt}

## User Prompt
${demoRecommendation.user_prompt}

## Tool Policy
${demoRecommendation.tool_policy?.map((item) => `- ${item}`).join("\n")}

## Validation Checklist
${demoRecommendation.validation_checklist?.map((item) => `- ${item}`).join("\n")}

## Retry Strategy
${demoRecommendation.retry_strategy?.map((item) => `- ${item}`).join("\n")}`;

const demoRuns: RunSummary[] = [
  {
    run_id: "demo-codex-flight-recorder",
    path: ".harness/runs/demo-codex-flight-recorder",
    event_count: 13,
    mission: "Codex 실행 로그를 분석해서 다음 프롬프트 추천까지 생성",
    outcome: "완료. 로그 가져오기, 타임라인, 진단, 추천, 비교 흐름 확인",
    updated_at: minutesAgo(2),
  },
];

const demoDetail: RunDetail = {
  run_id: "demo-codex-flight-recorder",
  events: [
    { timestamp: minutesAgo(12), run_id: "demo-codex-flight-recorder", type: "mission", summary: "Codex 실행 로그를 분석해서 다음 프롬프트 추천까지 생성" },
    {
      timestamp: minutesAgo(10),
      run_id: "demo-codex-flight-recorder",
      type: "prompt",
      summary: "user prompt recorded",
      data: { role: "user", content: "Tool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성" },
    },
    { timestamp: minutesAgo(8), run_id: "demo-codex-flight-recorder", type: "tool_call", summary: "functions.shell_command 호출", data: { command: "rg --files" } },
    { timestamp: minutesAgo(7), run_id: "demo-codex-flight-recorder", type: "tool_result", summary: "파일 목록 확인", data: { output: "src/App.tsx runner/supervisor.py" } },
    { timestamp: minutesAgo(6), run_id: "demo-codex-flight-recorder", type: "error", summary: "TypeScript 빌드 실패", data: { exit_code: 1 } },
    { timestamp: minutesAgo(5), run_id: "demo-codex-flight-recorder", type: "retry", summary: "깨진 UI 문구를 교체하고 다시 검증" },
    { timestamp: minutesAgo(4), run_id: "demo-codex-flight-recorder", type: "validation", summary: "TypeScript와 수락 테스트 통과" },
    { timestamp: minutesAgo(3), run_id: "demo-codex-flight-recorder", type: "model_response", summary: "Model response recorded", data: { content: "완료했습니다." } },
    { timestamp: minutesAgo(2), run_id: "demo-codex-flight-recorder", type: "metric", summary: "Run metric recorded", data: demoAnalysis.metric_totals },
    { timestamp: minutesAgo(2), run_id: "demo-codex-flight-recorder", type: "outcome", summary: "완료", data: { status: "completed" } },
  ],
  analysis: demoAnalysis,
  recommendation: demoRecommendation,
  state: {
    run_id: "demo-codex-flight-recorder",
    status: "completed",
    mission: "Codex 실행 로그를 분석해서 다음 프롬프트 추천까지 생성",
    current_step: 4,
    steps_total: 4,
    attempts: {},
    completed_steps: ["capture", "analyze", "recommend", "validate"],
    blocked_steps: [],
    failed_steps: [],
    created_at: minutesAgo(14),
    updated_at: minutesAgo(2),
  },
};

function electronApi() {
  return window.flightRecorder;
}

export async function listRuns(): Promise<RunSummary[]> {
  return electronApi()?.listRuns() ?? demoRuns;
}

export async function deleteRun(runId: string): Promise<{ run_id: string; deleted: boolean }> {
  return electronApi()?.deleteRun?.(runId) ?? { run_id: runId, deleted: true };
}

export async function getRun(runId: string): Promise<RunDetail> {
  return electronApi()?.getRun(runId) ?? { ...demoDetail, run_id: runId };
}

export async function initRun(slug: string, mission: string): Promise<{ run_id: string; path: string }> {
  return electronApi()?.initRun({ slug, mission }) ?? { run_id: `demo-${Date.now()}`, path: ".harness/runs/demo" };
}

export async function analyzeRun(runId: string): Promise<Analysis> {
  return electronApi()?.analyze(runId) ?? { ...demoAnalysis, run_id: runId };
}

export async function recommendPrompt(runId: string, task: string): Promise<Recommendation> {
  return electronApi()?.recommend({ runId, task }) ?? { ...demoRecommendation, run_id: runId, source_mission: task };
}

export async function importTranscript(text: string, mission: string): Promise<ImportResult> {
  return (
    electronApi()?.importTranscript?.({ text, mission, slug: "codex-import" }) ?? {
      run_id: `demo-import-${Date.now()}`,
      events_imported: 7,
      analysis: demoAnalysis,
      recommendation: demoRecommendation,
    }
  );
}

export async function listCodexThreads(scope: "workspace" | "all" = "workspace"): Promise<CodexThreadSummary[]> {
  return (
    electronApi()?.listCodexThreads?.({ limit: 100, allWorkspaces: scope === "all" }).then((result) => result.threads) ?? [
      {
        id: "demo-thread",
        label: "Demo Codex thread",
        first_user_message: "Tool-Use Flight Recorder + Prompt Recommender를 개선해줘",
        has_rollout: true,
        tokens_used: 14615,
      },
    ]
  );
}

export async function importLatestCodexThread(mission?: string, threadId?: string): Promise<ImportResult> {
  return (
    electronApi()?.importLatestCodexThread?.({ mission, threadId }) ?? {
      run_id: `demo-rollout-${Date.now()}`,
      events_imported: 10,
      analysis: demoAnalysis,
      recommendation: {
        ...demoRecommendation,
        original_user_prompt: demoRecommendation.user_prompt,
        prompt_fixes: ["최근 Codex rollout에서 가져온 프롬프트를 근거로 추천합니다."],
      },
    }
  );
}

export async function startLiveWatcher(mission?: string, threadId?: string): Promise<LiveWatcherStatus> {
  return (
    electronApi()?.startLiveWatcher?.({ mission, threadId, slug: "codex-live", interval: 1 }) ?? {
      status: "started",
      process_status: "running",
      run_id: "demo-live-watcher",
      events_imported: 0,
    }
  );
}

export async function stopLiveWatcher(): Promise<LiveWatcherStatus> {
  return electronApi()?.stopLiveWatcher?.() ?? { status: "stopped", process_status: "stopped", run_id: "demo-live-watcher" };
}

export async function getLiveWatcherStatus(runId?: string | null): Promise<LiveWatcherStatus> {
  return (
    electronApi()?.getLiveWatcherStatus?.(runId ? { runId } : {}) ?? {
      status: "stopped",
      process_status: "stopped",
      run_id: runId ?? null,
    }
  );
}

export async function compareRuns(beforeRunId: string, afterRunId: string): Promise<ComparisonResult> {
  return (
    electronApi()?.compareRuns?.({ beforeRunId, afterRunId }) ?? {
      before_run_id: beforeRunId,
      after_run_id: afterRunId,
      metrics: [
        { metric: "success", before: false, after: true },
        { metric: "tool_call_count", before: 8, after: 3 },
        { metric: "error_count", before: 3, after: 1 },
        { metric: "cost_estimated", before: 0.74, after: 0.46 },
        { metric: "duration_ms", before: 210000, after: 94000 },
        { metric: "user_intervention_count", before: 5, after: 0 },
      ],
      before: { ...demoAnalysis, run_id: beforeRunId, error_count: 3, tool_call_count: 8 },
      after: { ...demoAnalysis, run_id: afterRunId },
    }
  );
}

export async function startSupervisor(mission: string, planFile = "runner/plans/frontend-build.json"): Promise<SupervisorResult> {
  return (
    electronApi()?.startSupervisor({
      slug: "ui-supervisor",
      mission,
      planFile,
    }) ?? { run_id: "demo-codex-flight-recorder", state: demoDetail.state!, analysis: demoAnalysis, recommendation: demoRecommendation }
  );
}

export async function startAutopilot(mission: string, planFile = "runner/plans/product-autopilot.json"): Promise<SupervisorResult> {
  return (
    electronApi()?.startAutopilot?.({
      slug: "product-autopilot",
      mission,
      planFile,
      maxCycles: 5,
    }) ?? { run_id: "demo-codex-flight-recorder", state: demoDetail.state!, analysis: demoAnalysis, recommendation: demoRecommendation }
  );
}

export async function resumeSupervisor(runId: string): Promise<SupervisorResult> {
  return electronApi()?.resumeSupervisor(runId) ?? { run_id: runId, state: demoDetail.state!, analysis: demoAnalysis };
}

export async function getSupervisorState(runId: string): Promise<SupervisorState> {
  return electronApi()?.getSupervisorState(runId) ?? demoDetail.state!;
}
