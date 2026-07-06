export type EventType =
  | "mission"
  | "prompt"
  | "tool_call"
  | "tool_result"
  | "error"
  | "retry"
  | "decision"
  | "validation"
  | "outcome";

export type TraceEvent = {
  timestamp: string;
  run_id: string;
  type: EventType;
  summary: string;
  data?: Record<string, unknown>;
};

export type RunSummary = {
  run_id: string;
  path: string;
  event_count: number;
  mission: string;
  outcome: string;
  updated_at: string;
};

export type Analysis = {
  run_id: string;
  event_count: number;
  event_counts: Record<string, number>;
  tool_call_count: number;
  error_count: number;
  retry_count: number;
  validation_count: number;
  risks: string[];
  last_event: TraceEvent | null;
};

export type Recommendation = {
  run_id: string;
  diagnosis: string[];
  recommended_prompt: string;
  verification_checklist: string[];
};

export type RunDetail = {
  run_id: string;
  events: TraceEvent[];
  analysis: Analysis | null;
  recommendation: Recommendation | null;
  state?: SupervisorState | null;
};

export type SupervisorStatus =
  | "pending"
  | "running"
  | "recovering"
  | "waiting_for_desktop_thread"
  | "completed"
  | "blocked"
  | "failed";

export type SupervisorState = {
  run_id: string;
  status: SupervisorStatus;
  mission: string;
  current_step: number;
  steps_total: number;
  attempts: Record<string, number>;
  completed_steps: string[];
  blocked_steps: string[];
  failed_steps: string[];
  waiting_step?: string;
  created_at: string;
  updated_at: string;
};

export type SupervisorResult = {
  run_id: string;
  state: SupervisorState;
  analysis?: Analysis;
  recommendation?: Recommendation;
};
