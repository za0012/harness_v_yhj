import type { Analysis, CodexThreadSummary, ComparisonResult, ImportResult, LiveWatcherStatus, Recommendation, RunDetail, RunSummary, SupervisorResult, SupervisorState, TraceEvent } from "../src/types";

declare global {
  interface Window {
    flightRecorder?: {
      listRuns(): Promise<RunSummary[]>;
      deleteRun(runId: string): Promise<{ run_id: string; deleted: boolean }>;
      getRun(runId: string): Promise<RunDetail>;
      initRun(payload: { slug: string; mission: string }): Promise<{ run_id: string; path: string }>;
      recordEvent(payload: { runId: string; type: TraceEvent["type"]; summary: string }): Promise<TraceEvent>;
      analyze(runId: string): Promise<Analysis>;
      recommend(payload: { runId: string; task: string }): Promise<Recommendation>;
      compareRuns(payload: { beforeRunId: string; afterRunId: string }): Promise<ComparisonResult>;
      importTranscript(payload: { text: string; mission?: string; runId?: string; slug?: string; source?: string }): Promise<ImportResult>;
      importLatestCodexThread(payload?: { cwd?: string; threadId?: string; mission?: string; runId?: string }): Promise<ImportResult>;
      listCodexThreads(payload?: { cwd?: string; limit?: number; allWorkspaces?: boolean }): Promise<{ threads: CodexThreadSummary[] }>;
      startLiveWatcher(payload?: { cwd?: string; threadId?: string; mission?: string; runId?: string; slug?: string; interval?: number }): Promise<LiveWatcherStatus>;
      stopLiveWatcher(): Promise<LiveWatcherStatus>;
      getLiveWatcherStatus(payload?: { runId?: string; cwd?: string }): Promise<LiveWatcherStatus>;
      startSupervisor(payload: { slug: string; mission: string; planFile?: string; noResume?: boolean }): Promise<SupervisorResult>;
      startAutopilot(payload: { slug: string; mission: string; planFile?: string; maxCycles?: number }): Promise<SupervisorResult>;
      resumeSupervisor(runId: string): Promise<SupervisorResult>;
      getSupervisorState(runId: string): Promise<SupervisorState>;
    };
  }
}

export {};
