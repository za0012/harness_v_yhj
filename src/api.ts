import type { Analysis, Recommendation, RunDetail, RunSummary, SupervisorResult, SupervisorState } from "./types";

const demoRuns: RunSummary[] = [
  {
    run_id: "demo-setup",
    path: ".harness/runs/demo-setup",
    event_count: 8,
    mission: "Set up an autonomous Tool-Use Flight Recorder harness.",
    outcome: "Harness completed with validation and prompt recommendation.",
    updated_at: new Date().toISOString(),
  },
];

const demoDetail: RunDetail = {
  run_id: "demo-setup",
  events: [
    {
      timestamp: new Date().toISOString(),
      run_id: "demo-setup",
      type: "mission",
      summary: "Set up an autonomous Tool-Use Flight Recorder harness.",
    },
    {
      timestamp: new Date().toISOString(),
      run_id: "demo-setup",
      type: "tool_call",
      summary: "Inspect workspace and scaffold app files.",
      data: { tool_name: "shell_command" },
    },
    {
      timestamp: new Date().toISOString(),
      run_id: "demo-setup",
      type: "validation",
      summary: "Run local syntax and JSON checks.",
      data: { status: "passed" },
    },
    {
      timestamp: new Date().toISOString(),
      run_id: "demo-setup",
      type: "outcome",
      summary: "Completed MVP harness.",
    },
  ],
  analysis: {
    run_id: "demo-setup",
    event_count: 4,
    event_counts: { mission: 1, tool_call: 1, validation: 1, outcome: 1 },
    tool_call_count: 1,
    error_count: 0,
    retry_count: 0,
    validation_count: 1,
    risks: [],
    last_event: null,
  },
  recommendation: {
    run_id: "demo-setup",
    diagnosis: ["Trace is complete enough for the next run; make success criteria explicit."],
    recommended_prompt:
      "Mission:\nBuild the next useful harness feature.\n\nSuccess criteria:\n- Record all major tool events.\n- Analyze the trace.\n- Recommend the next stronger prompt.",
    verification_checklist: ["Mission event exists.", "Validation event exists.", "Outcome event exists."],
  },
  state: {
    run_id: "demo-setup",
    status: "completed",
    mission: "Set up an autonomous Tool-Use Flight Recorder harness.",
    current_step: 4,
    steps_total: 4,
    attempts: {},
    completed_steps: ["inspect", "validate", "analyze", "recommend"],
    blocked_steps: [],
    failed_steps: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
  return electronApi()?.recommend({ runId, task }) ?? demoDetail.recommendation!;
}

export async function startSupervisor(mission: string, planFile = "runner/plans/frontend-build.json"): Promise<SupervisorResult> {
  return (
    electronApi()?.startSupervisor({
      slug: "ui-supervisor",
      mission,
      planFile,
    }) ?? { run_id: "demo-setup", state: demoDetail.state! }
  );
}

export async function resumeSupervisor(runId: string): Promise<SupervisorResult> {
  return electronApi()?.resumeSupervisor(runId) ?? { run_id: runId, state: demoDetail.state! };
}

export async function getSupervisorState(runId: string): Promise<SupervisorState> {
  return electronApi()?.getSupervisorState(runId) ?? demoDetail.state!;
}
