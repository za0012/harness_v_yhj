export type EventType =
  | "mission"
  | "prompt"
  | "model_response"
  | "tool_call"
  | "tool_result"
  | "error"
  | "retry"
  | "decision"
  | "validation"
  | "metric"
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
  prompt_count?: number;
  model_response_count?: number;
  error_count: number;
  retry_count: number;
  validation_count: number;
  metric_count?: number;
  metric_totals?: {
    duration_ms: number;
    token_count: number;
    cost_estimated: number;
    user_intervention_count: number;
    success: boolean | null;
  };
  risks: string[];
  diagnosis_issues?: DiagnosisIssue[];
  last_event: TraceEvent | null;
};

export type DiagnosisIssue = {
  id: string;
  severity: "low" | "medium" | "high" | string;
  title: string;
  evidence: string;
  recommendation: string;
};

export type Recommendation = {
  run_id: string;
  source_mission?: string;
  evidence?: string[];
  diagnosis: string[];
  diagnosis_issues?: DiagnosisIssue[];
  original_user_prompt?: string;
  original_system_prompt?: string;
  prompt_fixes?: string[];
  used_tools?: string[];
  system_prompt?: string;
  user_prompt?: string;
  tool_policy?: string[];
  validation_checklist?: string[];
  retry_strategy?: string[];
  copy_prompt?: string;
  recommended_prompt: string;
  verification_checklist: string[];
};

export type ComparisonMetric = {
  metric: string;
  before: unknown;
  after: unknown;
};

export type ComparisonResult = {
  before_run_id: string;
  after_run_id: string;
  metrics: ComparisonMetric[];
  before: Analysis;
  after: Analysis;
};

export type RunDetail = {
  run_id: string;
  events: TraceEvent[];
  analysis: Analysis | null;
  recommendation: Recommendation | null;
  state?: SupervisorState | null;
};

export type ImportResult = {
  run_id: string;
  events_imported: number;
  analysis: Analysis;
  recommendation: Recommendation;
};

export type CodexThreadSummary = {
  id: string;
  label?: string;
  title?: string;
  first_user_message?: string;
  cwd?: string;
  rollout_path?: string;
  tokens_used?: number;
  created_at_ms?: number;
  updated_at_ms?: number;
  updated_label?: string;
  short_id?: string;
  has_rollout?: boolean;
};

export type LiveWatcherStatus = {
  status: "starting" | "started" | "watching" | "running" | "recovering" | "stopped" | "unknown" | string;
  process_status?: "running" | "stopped" | string;
  run_id?: string | null;
  thread_id?: string | null;
  rollout_path?: string;
  offset?: number;
  events_imported?: number;
  last_seen_at?: string;
  last_error?: string;
  analysis_event_count?: number;
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
