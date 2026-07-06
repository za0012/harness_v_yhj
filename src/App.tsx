import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clipboard,
  FastForward,
  Gauge,
  History,
  Play,
  RefreshCw,
  Route,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { analyzeRun, getRun, initRun, listRuns, recommendPrompt, resumeSupervisor, startSupervisor } from "./api";
import type { EventType, Recommendation, RunDetail, RunSummary, SupervisorState, TraceEvent } from "./types";

const eventLabels: Record<EventType, string> = {
  mission: "Mission",
  prompt: "Prompt",
  tool_call: "Tool Call",
  tool_result: "Tool Result",
  error: "Error",
  retry: "Retry",
  decision: "Decision",
  validation: "Validation",
  outcome: "Outcome",
};

const eventClasses: Record<EventType, string> = {
  mission: "tone-mission",
  prompt: "tone-prompt",
  tool_call: "tone-tool",
  tool_result: "tone-result",
  error: "tone-error",
  retry: "tone-retry",
  decision: "tone-decision",
  validation: "tone-validation",
  outcome: "tone-outcome",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return (
    <div className="metric">
      <Icon size={18} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function RunList({
  runs,
  selectedRunId,
  onSelect,
  onRefresh,
}: {
  runs: RunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="side-title">
        <div>
          <p>Runs</p>
          <h2>Trace Store</h2>
        </div>
        <button className="icon-button" onClick={onRefresh} title="Refresh runs" type="button">
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="run-list">
        {runs.map((run) => (
          <button
            className={run.run_id === selectedRunId ? "run-item active" : "run-item"}
            key={run.run_id}
            onClick={() => onSelect(run.run_id)}
            type="button"
          >
            <span className="run-id">{run.run_id}</span>
            <strong>{run.mission}</strong>
            <small>{run.event_count} events · {formatTime(run.updated_at)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function EventRow({ event }: { event: TraceEvent }) {
  return (
    <article className={`event-row ${eventClasses[event.type]}`}>
      <div className="event-dot" />
      <div className="event-body">
        <div className="event-head">
          <span>{eventLabels[event.type]}</span>
          <time>{formatTime(event.timestamp)}</time>
        </div>
        <p>{event.summary}</p>
        {event.data && Object.keys(event.data).length > 0 ? (
          <pre>{JSON.stringify(event.data, null, 2)}</pre>
        ) : null}
      </div>
    </article>
  );
}

function Timeline({ detail }: { detail: RunDetail | null }) {
  if (!detail) {
    return <section className="empty-panel">Select or create a run to inspect the timeline.</section>;
  }
  return (
    <section className="timeline">
      {detail.events.map((event, index) => (
        <EventRow event={event} key={`${event.timestamp}-${event.type}-${index}`} />
      ))}
    </section>
  );
}

function PromptCoach({
  detail,
  recommendation,
  task,
  setTask,
  onRecommend,
}: {
  detail: RunDetail | null;
  recommendation: Recommendation | null;
  task: string;
  setTask: (value: string) => void;
  onRecommend: () => void;
}) {
  return (
    <section className="coach">
      <div className="panel-heading">
        <div>
          <p>Prompt Coach</p>
          <h2>Next-run prompt</h2>
        </div>
        <button className="primary-button" disabled={!detail} onClick={onRecommend} type="button">
          <Sparkles size={17} aria-hidden="true" />
          Recommend
        </button>
      </div>
      <textarea
        aria-label="Task for prompt recommendation"
        onChange={(event) => setTask(event.target.value)}
        placeholder="Describe the next task you want the agent to complete..."
        value={task}
      />
      <div className="diagnosis">
        {(recommendation?.diagnosis ?? detail?.analysis?.risks ?? ["No diagnosis yet."]).map((item) => (
          <div className="diagnosis-item" key={item}>
            <BrainCircuit size={16} aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="prompt-box">
        <div className="prompt-toolbar">
          <span>Recommended prompt</span>
          <button
            className="icon-button"
            onClick={() => copyText(recommendation?.recommended_prompt ?? "")}
            title="Copy recommended prompt"
            type="button"
          >
            <Clipboard size={16} aria-hidden="true" />
          </button>
        </div>
        <pre>{recommendation?.recommended_prompt ?? "Run analysis and recommendation to generate a prompt."}</pre>
      </div>
    </section>
  );
}

function SupervisorPanel({
  state,
  selectedRunId,
  onStart,
  onAgentDemo,
  onResume,
}: {
  state: SupervisorState | null | undefined;
  selectedRunId: string | null;
  onStart: () => void;
  onAgentDemo: () => void;
  onResume: () => void;
}) {
  const progress = state?.steps_total ? Math.round((state.current_step / state.steps_total) * 100) : 0;
  return (
    <section className="supervisor-band">
      <div className="supervisor-copy">
        <p>Autonomous Supervisor</p>
        <h2>{state ? state.status : "not started"}</h2>
        <span>
          {state
            ? `${state.current_step}/${state.steps_total} steps · ${state.blocked_steps.length} blocked · ${state.failed_steps.length} failed`
            : "No supervisor state for the selected run."}
        </span>
      </div>
      <div className="progress-track" aria-label="Supervisor progress">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="supervisor-actions">
        <button className="primary-button" onClick={onStart} type="button">
          <FastForward size={17} aria-hidden="true" />
          Start Supervisor
        </button>
        <button className="secondary-button" onClick={onAgentDemo} type="button">
          <BrainCircuit size={17} aria-hidden="true" />
          Agent Demo
        </button>
        <button className="secondary-button" disabled={!selectedRunId} onClick={onResume} type="button">
          <Play size={17} aria-hidden="true" />
          Resume
        </button>
      </div>
    </section>
  );
}

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [mission, setMission] = useState("Build the next autonomous agent harness feature.");
  const [task, setTask] = useState("Build the next useful Agent Flight Recorder feature with validation.");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);

  const metrics = useMemo(() => {
    const analysis = detail?.analysis;
    return {
      events: detail?.events.length ?? 0,
      tools: analysis?.tool_call_count ?? detail?.events.filter((event) => event.type === "tool_call").length ?? 0,
      validations: analysis?.validation_count ?? detail?.events.filter((event) => event.type === "validation").length ?? 0,
      risks: analysis?.risks.length ?? 0,
    };
  }, [detail]);

  async function refreshRuns(selectFirst = false) {
    const nextRuns = await listRuns();
    setRuns(nextRuns);
    if (selectFirst && nextRuns[0]) {
      setSelectedRunId(nextRuns[0].run_id);
    }
  }

  async function loadRun(runId: string) {
    setBusy(true);
    try {
      const nextDetail = await getRun(runId);
      setDetail(nextDetail);
      setRecommendation(nextDetail.recommendation);
      const missionEvent = nextDetail.events.find((event) => event.type === "mission");
      if (missionEvent) setTask(missionEvent.summary);
    } finally {
      setBusy(false);
    }
  }

  async function createRun() {
    setBusy(true);
    try {
      const created = await initRun("ui-mission", mission);
      await refreshRuns();
      setSelectedRunId(created.run_id);
    } finally {
      setBusy(false);
    }
  }

  async function createSupervisorRun(planFile = "runner/plans/frontend-build.json") {
    setBusy(true);
    try {
      const created = await startSupervisor(mission, planFile);
      await refreshRuns();
      setSelectedRunId(created.run_id);
      setRecommendation(created.recommendation ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function resumeSelectedSupervisor() {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      const result = await resumeSupervisor(selectedRunId);
      setRecommendation(result.recommendation ?? recommendation);
      await loadRun(selectedRunId);
      await refreshRuns();
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis() {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      await analyzeRun(selectedRunId);
      await loadRun(selectedRunId);
      await refreshRuns();
    } finally {
      setBusy(false);
    }
  }

  async function runRecommendation() {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      const next = await recommendPrompt(selectedRunId, task);
      setRecommendation(next);
      await loadRun(selectedRunId);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshRuns(true);
  }, []);

  useEffect(() => {
    if (selectedRunId) void loadRun(selectedRunId);
  }, [selectedRunId]);

  return (
    <main className="app-shell">
      <RunList runs={runs} selectedRunId={selectedRunId} onRefresh={() => void refreshRuns()} onSelect={setSelectedRunId} />
      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Agent Mission Control</p>
            <h1>Tool-Use Flight Recorder</h1>
          </div>
          <div className="status-pill">
            <Gauge size={16} aria-hidden="true" />
            {busy ? "Working" : "Ready"}
          </div>
        </header>

        <section className="mission-band">
          <div className="mission-input">
            <label htmlFor="mission">Mission</label>
            <input id="mission" onChange={(event) => setMission(event.target.value)} value={mission} />
          </div>
          <button className="primary-button" onClick={createRun} type="button">
            <Play size={17} aria-hidden="true" />
            Start Run
          </button>
        </section>

        <SupervisorPanel
          onAgentDemo={() => void createSupervisorRun("runner/plans/agent-loop-demo.json")}
          onResume={resumeSelectedSupervisor}
          onStart={() => void createSupervisorRun()}
          selectedRunId={selectedRunId}
          state={detail?.state}
        />

        <section className="metrics-grid">
          <Metric icon={History} label="Events" value={metrics.events} />
          <Metric icon={TerminalSquare} label="Tool calls" value={metrics.tools} />
          <Metric icon={CheckCircle2} label="Validations" value={metrics.validations} />
          <Metric icon={AlertTriangle} label="Risks" value={metrics.risks} />
        </section>

        <section className="content-grid">
          <div className="main-panel">
            <div className="panel-heading">
              <div>
                <p>Timeline</p>
                <h2>{selectedRunId ?? "No run selected"}</h2>
              </div>
              <button className="secondary-button" disabled={!selectedRunId} onClick={runAnalysis} type="button">
                <Route size={17} aria-hidden="true" />
                Analyze
              </button>
            </div>
            <Timeline detail={detail} />
          </div>
          <PromptCoach
            detail={detail}
            onRecommend={runRecommendation}
            recommendation={recommendation}
            setTask={setTask}
            task={task}
          />
        </section>
      </section>
    </main>
  );
}
