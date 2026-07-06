import type {
  Analysis,
  ComparisonResult,
  ImportResult,
  Recommendation,
  RunDetail,
  RunSummary,
  SupervisorResult,
  SupervisorState,
} from "./types";

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();

const demoAnalysis: Analysis = {
  run_id: "demo-imported-codex-run",
  event_count: 10,
  event_counts: {
    mission: 1,
    prompt: 2,
    model_response: 1,
    tool_call: 2,
    tool_result: 1,
    error: 1,
    retry: 1,
    validation: 1,
    metric: 1,
    outcome: 1,
  },
  tool_call_count: 2,
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
  risks: ["도구 실패 후 복구 근거를 더 자세히 남기면 좋음"],
  diagnosis_issues: [
    {
      id: "missing_output_format",
      severity: "medium",
      title: "출력 형식이 불명확함",
      evidence: "최종 답변 형식이 프롬프트에 고정되어 있지 않습니다.",
      recommendation: "변경사항, 검증 근거, 남은 위험을 포함하도록 마지막 응답 형식을 지정하세요.",
    },
  ],
  last_event: null,
};

const demoRecommendation: Recommendation = {
  run_id: "demo-imported-codex-run",
  source_mission: "Tool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성",
  evidence: ["이 run은 이벤트 10개, 도구 호출 2개, 오류 1개, 검증 1개를 남겼습니다."],
  diagnosis: ["출력 형식이 불명확함"],
  diagnosis_issues: demoAnalysis.diagnosis_issues,
  system_prompt:
    "당신은 Tool-Use Flight Recorder가 감시하는 자율 AI 에이전트입니다. 사용자 목표를 실제 산출물로 완주하면서 판단, 도구 호출, 오류, 재시도, 검증, 비용과 결과를 실행 로그로 남깁니다.",
  user_prompt:
    "작업 목표:\nTool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성\n\n완료 조건:\n- 실제 Codex 로그를 run으로 가져온다.\n- 타임라인, 진단, 추천, 비교가 같은 run 데이터에서 계산된다.\n- 로컬 검증 결과를 기록한다.",
  tool_policy: [
    "파일을 수정하기 전에 관련 파일과 설정을 먼저 읽는다.",
    "검색, 파일 읽기, 명령 실행, UI 검증은 tool_call/tool_result로 기록한다.",
    "명령이 실패하면 error를 기록하고 한 번은 다른 경로로 복구한다.",
  ],
  validation_checklist: [
    "events.jsonl에 mission, prompt, model_response, tool_call, tool_result가 들어갔는가?",
    "recommendation.json이 diagnosis_issues와 evidence를 반영하는가?",
    "Before/After 비교 지표가 계산되는가?",
  ],
  retry_strategy: [
    "실패 원인을 권한, 환경, 입력 부족, 코드 오류로 분류한다.",
    "복구 가능한 오류는 가장 작은 수정으로 한 번 재시도한다.",
    "같은 오류가 반복되면 blocked outcome을 남긴다.",
  ],
  recommended_prompt:
    "Mission:\nTool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성\n\nTrace evidence:\n- 이 run은 이벤트 10개, 도구 호출 2개, 오류 1개, 검증 1개를 남겼습니다.\n\nSuccess criteria:\n- 실제 Codex 로그를 run으로 가져온다.\n- 타임라인, 진단, 추천, 비교가 같은 run 데이터에서 계산된다.",
  verification_checklist: [
    "events.jsonl에 필수 이벤트가 들어갔는가?",
    "추천이 실제 진단 이슈를 반영하는가?",
    "비교 지표가 계산되는가?",
  ],
};

const demoRuns: RunSummary[] = [
  {
    run_id: "demo-imported-codex-run",
    path: ".harness/runs/demo-imported-codex-run",
    event_count: 10,
    mission: "Codex 실행 로그를 가져와 프롬프트 추천까지 생성",
    outcome: "완료. 로그 가져오기, 타임라인, 진단, 추천, 비교 흐름 확인",
    updated_at: minutesAgo(2),
  },
];

const demoDetail: RunDetail = {
  run_id: "demo-imported-codex-run",
  events: [
    { timestamp: minutesAgo(12), run_id: "demo-imported-codex-run", type: "mission", summary: "Codex 실행 로그를 가져와 프롬프트 추천까지 생성" },
    {
      timestamp: minutesAgo(10),
      run_id: "demo-imported-codex-run",
      type: "prompt",
      summary: "user prompt recorded",
      data: { role: "user", content: "Tool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성" },
    },
    { timestamp: minutesAgo(8), run_id: "demo-imported-codex-run", type: "tool_call", summary: "functions.shell_command 호출" },
    { timestamp: minutesAgo(7), run_id: "demo-imported-codex-run", type: "error", summary: "도구 실행 실패", data: { exit_code: 1 } },
    { timestamp: minutesAgo(6), run_id: "demo-imported-codex-run", type: "retry", summary: "다른 검증 경로로 재시도" },
    { timestamp: minutesAgo(4), run_id: "demo-imported-codex-run", type: "validation", summary: "TypeScript와 Python py_compile 통과" },
    { timestamp: minutesAgo(2), run_id: "demo-imported-codex-run", type: "outcome", summary: "완료", data: { status: "completed" } },
  ],
  analysis: demoAnalysis,
  recommendation: demoRecommendation,
  state: {
    run_id: "demo-imported-codex-run",
    status: "completed",
    mission: "Codex 실행 로그를 가져와 프롬프트 추천까지 생성",
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

export async function getRun(runId: string): Promise<RunDetail> {
  return electronApi()?.getRun(runId) ?? { ...demoDetail, run_id: runId };
}

export async function initRun(slug: string, mission: string): Promise<{ run_id: string; path: string }> {
  return electronApi()?.initRun({ slug, mission }) ?? { run_id: `demo-${Date.now()}`, path: ".harness/runs/demo" };
}

export async function analyzeRun(runId: string): Promise<Analysis> {
  return electronApi()?.analyze(runId) ?? demoDetail.analysis!;
}

export async function recommendPrompt(runId: string, task: string): Promise<Recommendation> {
  return electronApi()?.recommend({ runId, task }) ?? { ...demoRecommendation, run_id: runId };
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

export async function compareRuns(beforeRunId: string, afterRunId: string): Promise<ComparisonResult> {
  return (
    electronApi()?.compareRuns?.({ beforeRunId, afterRunId }) ?? {
      before_run_id: beforeRunId,
      after_run_id: afterRunId,
      metrics: [
        { metric: "success", before: false, after: true },
        { metric: "tool_call_count", before: 8, after: 4 },
        { metric: "error_count", before: 3, after: 0 },
        { metric: "cost_estimated", before: 0.74, after: 0.46 },
        { metric: "duration_ms", before: 210000, after: 94000 },
        { metric: "user_intervention_count", before: 5, after: 0 },
      ],
      before: { ...demoAnalysis, run_id: beforeRunId, error_count: 3, tool_call_count: 8 },
      after: demoAnalysis,
    }
  );
}

export async function startSupervisor(mission: string, planFile = "runner/plans/frontend-build.json"): Promise<SupervisorResult> {
  return (
    electronApi()?.startSupervisor({
      slug: "ui-supervisor",
      mission,
      planFile,
    }) ?? { run_id: "demo-imported-codex-run", state: demoDetail.state!, analysis: demoAnalysis, recommendation: demoRecommendation }
  );
}

export async function startAutopilot(mission: string, planFile = "runner/plans/product-autopilot.json"): Promise<SupervisorResult> {
  return (
    electronApi()?.startAutopilot?.({
      slug: "product-autopilot",
      mission,
      planFile,
      maxCycles: 5,
    }) ?? { run_id: "demo-imported-codex-run", state: demoDetail.state!, analysis: demoAnalysis, recommendation: demoRecommendation }
  );
}

export async function resumeSupervisor(runId: string): Promise<SupervisorResult> {
  return electronApi()?.resumeSupervisor(runId) ?? { run_id: runId, state: demoDetail.state!, analysis: demoAnalysis };
}

export async function getSupervisorState(runId: string): Promise<SupervisorState> {
  return electronApi()?.getSupervisorState(runId) ?? demoDetail.state!;
}
