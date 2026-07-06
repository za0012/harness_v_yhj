import type { Analysis, Recommendation, RunDetail, RunSummary, SupervisorResult, SupervisorState, TraceEvent } from "../src/types";

declare global {
  interface Window {
    flightRecorder?: {
      listRuns(): Promise<RunSummary[]>;
      getRun(runId: string): Promise<RunDetail>;
      initRun(payload: { slug: string; mission: string }): Promise<{ run_id: string; path: string }>;
      recordEvent(payload: { runId: string; type: TraceEvent["type"]; summary: string }): Promise<TraceEvent>;
      analyze(runId: string): Promise<Analysis>;
      recommend(payload: { runId: string; task: string }): Promise<Recommendation>;
      startSupervisor(payload: { slug: string; mission: string; planFile?: string; noResume?: boolean }): Promise<SupervisorResult>;
      resumeSupervisor(runId: string): Promise<SupervisorResult>;
      getSupervisorState(runId: string): Promise<SupervisorState>;
    };
  }
}

export {};
