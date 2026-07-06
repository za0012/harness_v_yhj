import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Clock3,
  Coins,
  FileSearch,
  FileText,
  GitCompare,
  Info,
  ListChecks,
  ListTree,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Upload,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeRun,
  compareRuns,
  getRun,
  importTranscript,
  listRuns,
  recommendPrompt,
  resumeSupervisor,
  startAutopilot,
} from "./api";
import type {
  Analysis,
  ComparisonResult,
  DiagnosisIssue,
  EventType,
  Recommendation,
  RunDetail,
  RunSummary,
  TraceEvent,
} from "./types";

type TabId = "capture" | "records" | "recommend" | "compare" | "how" | "patch";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "capture", label: "로그 가져오기" },
  { id: "records", label: "실행 기록" },
  { id: "recommend", label: "프롬프트 추천" },
  { id: "compare", label: "Before / After" },
  { id: "how", label: "동작 방식" },
  { id: "patch", label: "패치노트" },
];

const eventLabels: Record<EventType, string> = {
  mission: "목표 저장",
  prompt: "프롬프트 기록",
  model_response: "모델 응답",
  tool_call: "도구 호출",
  tool_result: "도구 결과",
  error: "오류",
  retry: "재시도",
  decision: "판단",
  validation: "검증",
  metric: "실행 지표",
  outcome: "최종 결과",
};

const eventIcons: Record<EventType, LucideIcon> = {
  mission: FileText,
  prompt: Sparkles,
  model_response: FileText,
  tool_call: TerminalSquare,
  tool_result: CheckCircle2,
  error: AlertCircle,
  retry: RotateCcw,
  decision: ListTree,
  validation: ShieldCheck,
  metric: Clock3,
  outcome: CheckCircle2,
};

const metricLabels: Record<string, string> = {
  success: "성공 여부",
  tool_call_count: "도구 호출",
  error_count: "오류",
  cost_estimated: "비용",
  duration_ms: "완료 시간",
  user_intervention_count: "사용자 개입",
};

const recordItems = [
  "사용자 목표",
  "시스템/개발자/사용자 프롬프트",
  "모델 응답",
  "tool call 목록",
  "tool result",
  "오류, 재시도, 중단 지점",
  "실행 시간, 토큰, 비용",
  "최종 성공 여부",
];

const diagnosisItems = [
  "목표가 모호함",
  "성공 조건이 없음",
  "금지 행동이 없음",
  "출력 형식이 불명확함",
  "도구 사용 기준이 없음",
  "검증 단계가 빠짐",
  "역할과 제약이 너무 많이 섞임",
];

const autopilotSteps = [
  "Codex 실행 로그나 자율 실행 결과를 run으로 만든다.",
  "run 안의 이벤트를 시간순 타임라인으로 재생한다.",
  "진단기가 누락된 목표, 검증, 도구 정책, outcome을 찾는다.",
  "추천기가 실제 이슈와 근거를 넣어 다음 실행용 프롬프트를 만든다.",
  "Before/After는 두 run의 성공률, 도구 호출, 오류, 비용, 시간, 사용자 개입을 비교한다.",
];

const patchNotes = [
  {
    title: "제품 방향 재정렬",
    body: "무중단 하네스는 제품이 아니라 개발과 검증을 자동화하는 내부 엔진으로 정리했습니다. 화면의 중심은 실행 기록, 타임라인, 진단, 추천, 비교입니다.",
  },
  {
    title: "Codex 로그 가져오기 추가",
    body: "Codex 출력, 터미널 로그, 대화 로그를 붙여넣으면 run으로 변환하고 분석과 추천까지 생성합니다. 이후 자동 훅은 같은 adapter에 입력만 연결하면 됩니다.",
  },
  {
    title: "추천기 개선",
    body: "추천 프롬프트가 단순 템플릿 복붙이 아니라 이벤트 수, 오류 수, 검증 누락, outcome 누락 같은 실제 run 근거를 반영합니다.",
  },
  {
    title: "깨진 문구 제거",
    body: "기본 데모 데이터와 trace 진단 문구를 정상 한국어로 교체했습니다. 오래된 run에 남은 깨진 로그는 원본 보존을 위해 그대로 두되 새 run은 정상 저장됩니다.",
  },
  {
    title: "검증 루프 보강",
    body: "Python compile, TypeScript build, Electron entrypoint check, acceptance test가 제품 하네스 검증 루틴에 들어갑니다.",
  },
];

function formatTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms: unknown) {
  if (typeof ms !== "number") return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function formatMetric(metric: string, value: unknown) {
  if (metric === "duration_ms") return formatDuration(value);
  if (metric === "cost_estimated" && typeof value === "number") return `$${value.toFixed(2)}`;
  if (metric === "success") return value === true ? "성공" : value === false ? "실패" : "-";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function textLooksBroken(value: unknown): boolean {
  if (typeof value === "string") return /[�]|占|揶|疫|筌|獄|野/.test(value);
  if (Array.isArray(value)) return value.some((item) => textLooksBroken(item));
  if (value && typeof value === "object") return Object.values(value).some((item) => textLooksBroken(item));
  return false;
}

function safeText(value: string | undefined | null, fallback = "오래된 로그의 문자가 깨져 표시를 생략했습니다.") {
  if (!value) return fallback;
  return textLooksBroken(value) ? fallback : value;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

function SectionHeader({ label, title, action }: { label?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div>
        {label ? <span>{label}</span> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ busy }: { busy: boolean }) {
  return (
    <div className={busy ? "status-badge running" : "status-badge"}>
      <span />
      {busy ? "실행 중" : "대기 중"}
    </div>
  );
}

function RunSidebar({
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
      <div className="sidebar-head">
        <div>
          <span>실행 기록</span>
          <h1>Run log</h1>
          <p>저장된 실행 {runs.length}개</p>
        </div>
        <button className="icon-button dark" onClick={onRefresh} title="목록 새로고침" type="button">
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="sidebar-note">Codex 로그, 자율 실행, 수동 기록을 모두 하나의 run으로 모아 봅니다.</div>
      <div className="run-list">
        {runs.map((run) => (
          <button
            className={run.run_id === selectedRunId ? "run-card active" : "run-card"}
            key={run.run_id}
            onClick={() => onSelect(run.run_id)}
            type="button"
          >
            <span>{formatTime(run.updated_at)}</span>
            <strong>{safeText(run.mission, "제목을 읽을 수 없는 run")}</strong>
            <small>
              {run.event_count}개 이벤트 · {safeText(run.outcome, "결과 없음")}
            </small>
          </button>
        ))}
        {runs.length === 0 ? <div className="empty-dark">아직 저장된 실행이 없습니다.</div> : null}
      </div>
    </aside>
  );
}

function TabBar({ activeTab, onChange }: { activeTab: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="tab-bar" aria-label="주요 화면">
      {tabs.map((tab) => (
        <button className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => onChange(tab.id)} type="button">
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function StatCard({ label, value, icon: Icon, tone = "blue" }: { label: string; value: string | number; icon: LucideIcon; tone?: string }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div>
        <Icon size={18} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function timelineTitle(event: TraceEvent) {
  const summary = event.summary || "";
  if (event.type === "tool_call" && /search|검색/i.test(summary)) return "여기서 검색함";
  if (event.type === "tool_call" && /read|file|파일|inspect/i.test(summary)) return "여기서 파일 읽음";
  if (event.type === "error") return "여기서 잘못된 도구 호출";
  if (event.type === "retry") return "여기서 같은 작업을 다시 시도";
  if (event.type === "decision" && /intent|의도|scope|범위/i.test(summary)) return "여기서 사용자 의도와 맞는지 판단";
  return eventLabels[event.type];
}

function Timeline({ detail }: { detail: RunDetail | null }) {
  if (!detail) return <div className="empty-light">왼쪽에서 실행을 선택하거나 로그를 가져오세요.</div>;

  return (
    <div className="timeline">
      {detail.events.map((event, index) => {
        const Icon = eventIcons[event.type];
        return (
          <article className={`timeline-item ${event.type}`} key={`${event.timestamp}-${event.type}-${index}`}>
            <div className="timeline-icon">
              <Icon size={16} />
            </div>
            <div className="timeline-content">
              <div className="timeline-title">
                <strong>{timelineTitle(event)}</strong>
                <time>{formatTime(event.timestamp)}</time>
              </div>
              <p>{safeText(event.summary)}</p>
              {event.data && Object.keys(event.data).length > 0 ? (
                <details>
                  <summary>원본 데이터 보기</summary>
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                </details>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function issueTone(issue: DiagnosisIssue) {
  if (issue.severity === "high") return "danger";
  if (issue.severity === "medium") return "warning";
  return "ok";
}

function DiagnosisPanel({ analysis, recommendation }: { analysis: Analysis | null | undefined; recommendation: Recommendation | null }) {
  const issues = recommendation?.diagnosis_issues ?? analysis?.diagnosis_issues ?? [];
  const fallback = recommendation?.diagnosis ?? analysis?.risks ?? [];
  return (
    <Panel className="diagnosis-panel">
      <SectionHeader label="프롬프트 진단" title="이번 실행에서 드러난 약점" />
      <div className="diagnosis-template">
        {diagnosisItems.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <div className="issue-list">
        {issues.length > 0
          ? issues.map((issue) => (
              <article className={`issue-card ${issueTone(issue)}`} key={issue.id}>
                <div>
                  <span>{issue.severity}</span>
                  <strong>{safeText(issue.title)}</strong>
                </div>
                <p>{safeText(issue.evidence)}</p>
                <small>{safeText(issue.recommendation)}</small>
              </article>
            ))
          : (fallback.length ? fallback : ["뚜렷한 누락은 보이지 않습니다. 다음 실행에서는 비용과 완료 기준을 더 선명하게 비교하세요."]).map((item) => (
              <article className="issue-card ok" key={item}>
                <div>
                  <span>info</span>
                  <strong>{safeText(item)}</strong>
                </div>
              </article>
            ))}
      </div>
    </Panel>
  );
}

function PromptBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="prompt-block">
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function RecommendationPanel({
  recommendation,
  analysis,
  selectedRunId,
  workRequest,
  setWorkRequest,
  disabled,
  onRecommend,
}: {
  recommendation: Recommendation | null;
  analysis: Analysis | null | undefined;
  selectedRunId: string | null;
  workRequest: string;
  setWorkRequest: (value: string) => void;
  disabled: boolean;
  onRecommend: () => void;
}) {
  const evidence = recommendation?.evidence ?? [];
  const issues = recommendation?.diagnosis_issues ?? analysis?.diagnosis_issues ?? [];
  return (
    <Panel className="recommendation-panel">
      <SectionHeader
        label="최적 프롬프트 추천"
        title="선택한 run의 실제 약점을 넣어 다음 프롬프트를 만듭니다"
        action={
          <button className="primary-button" disabled={disabled || !selectedRunId} onClick={onRecommend} type="button">
            <WandSparkles size={17} />
            추천 만들기
          </button>
        }
      />
      <div className="notice-box">
        <Info size={17} />
        <p>입력한 작업 문장은 추천 프롬프트의 목표로만 들어갑니다. 추천의 차이는 선택한 run의 오류, 검증 누락, outcome 누락 같은 로그 근거에서 나옵니다.</p>
      </div>
      <label className="field">
        <span>이번에 맡길 작업</span>
        <textarea value={workRequest} onChange={(event) => setWorkRequest(event.target.value)} />
      </label>
      <div className="recommendation-flow">
        <article>
          <h3>추천 근거</h3>
          <ul>
            {(evidence.length ? evidence : ["아직 추천 근거가 없습니다. 먼저 run을 선택하고 추천을 만드세요."]).map((item) => (
              <li key={item}>{safeText(item)}</li>
            ))}
          </ul>
        </article>
        <article>
          <h3>개선점</h3>
          <ul>
            {(issues.length ? issues.map((issue) => issue.title) : ["진단 이슈가 없으면 완료 기준과 검증 형식을 더 선명하게 만듭니다."]).map((item) => (
              <li key={item}>{safeText(item)}</li>
            ))}
          </ul>
        </article>
        <article>
          <h3>검증 방법</h3>
          <p>추천이 나아졌는지는 같은 작업을 Before/After로 실행해 성공 여부, 도구 호출 수, 오류 수, 비용, 완료 시간, 사용자 개입 수를 비교합니다.</p>
        </article>
      </div>
      <div className="prompt-grid">
        <PromptBlock title="에이전트용 시스템 프롬프트">
          <p>{safeText(recommendation?.system_prompt, "아직 생성된 시스템 프롬프트가 없습니다.")}</p>
        </PromptBlock>
        <PromptBlock title="작업별 사용자 프롬프트">
          <p>{safeText(recommendation?.user_prompt, "아직 생성된 사용자 프롬프트가 없습니다.")}</p>
        </PromptBlock>
        <PromptBlock title="도구 사용 정책">
          <ul>{(recommendation?.tool_policy ?? ["추천을 만들면 도구 사용 기준이 여기에 표시됩니다."]).map((item) => <li key={item}>{safeText(item)}</li>)}</ul>
        </PromptBlock>
        <PromptBlock title="검증 체크리스트">
          <ul>{(recommendation?.validation_checklist ?? ["추천을 만들면 검증 항목이 여기에 표시됩니다."]).map((item) => <li key={item}>{safeText(item)}</li>)}</ul>
        </PromptBlock>
        <PromptBlock title="실패 시 재시도 전략">
          <ul>{(recommendation?.retry_strategy ?? ["추천을 만들면 재시도 전략이 여기에 표시됩니다."]).map((item) => <li key={item}>{safeText(item)}</li>)}</ul>
        </PromptBlock>
        <PromptBlock title="바로 실행할 전체 프롬프트">
          <p>{safeText(recommendation?.recommended_prompt, "아직 생성된 전체 프롬프트가 없습니다.")}</p>
        </PromptBlock>
      </div>
      {recommendation?.copy_prompt ? (
        <>
          <div className="copy-header">
            <h2>복사용 프롬프트</h2>
            <button className="secondary-button" onClick={() => copyText(recommendation.copy_prompt || "")} type="button">
              <Clipboard size={16} />
              복사
            </button>
          </div>
          <pre className="prompt-output">{recommendation.copy_prompt}</pre>
        </>
      ) : null}
    </Panel>
  );
}

function CapturePanel({
  transcript,
  mission,
  setTranscript,
  setMission,
  onImport,
  disabled,
  lastImport,
}: {
  transcript: string;
  mission: string;
  setTranscript: (value: string) => void;
  setMission: (value: string) => void;
  onImport: () => void;
  disabled: boolean;
  lastImport: string | null;
}) {
  return (
    <Panel>
      <SectionHeader label="Codex Capture Adapter" title="실제 실행 로그를 run으로 바꿉니다" />
      <p className="panel-copy">
        Codex 출력, 터미널 로그, 대화 로그를 붙여넣으면 mission, prompt, model_response, tool_call, tool_result, error, retry,
        validation, metric, outcome 이벤트로 변환합니다.
      </p>
      <div className="middle-grid">
        <div className="field">
          <span>이번 run의 목표</span>
          <input value={mission} onChange={(event) => setMission(event.target.value)} />
          <span>Codex 로그</span>
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} />
          <button className="primary-button" disabled={disabled || !transcript.trim()} onClick={onImport} type="button">
            <Upload size={17} />
            로그에서 run 만들기
          </button>
        </div>
        <div>
          <div className="notice-box">
            <Info size={17} />
            <p>지금 구현된 자동화의 핵심은 이 adapter입니다. 완전 자동 감시는 Codex Desktop 내부 hook이 이 adapter에 로그를 흘려보내면 같은 구조로 확장됩니다.</p>
          </div>
          {lastImport ? (
            <div className="compare-result-copy">
              마지막 가져오기: <strong>{lastImport}</strong>
            </div>
          ) : null}
          <div className="capture-status">
            <h3>인식하는 흔한 패턴</h3>
            <ul>
              <li>User/System/Assistant 라벨이 붙은 대화 블록</li>
              <li>functions.shell_command, web.run, apply_patch 같은 tool call</li>
              <li>Exit code, Output, stdout, stderr 기반 tool result/error</li>
              <li>retry, validation, final, success, blocked 같은 상태 문장</li>
            </ul>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ComparePanel({
  runs,
  beforeRunId,
  afterRunId,
  setBeforeRunId,
  setAfterRunId,
  result,
  disabled,
  onCompare,
}: {
  runs: RunSummary[];
  beforeRunId: string;
  afterRunId: string;
  setBeforeRunId: (value: string) => void;
  setAfterRunId: (value: string) => void;
  result: ComparisonResult | null;
  disabled: boolean;
  onCompare: () => void;
}) {
  return (
    <Panel>
      <SectionHeader
        label="Before / After"
        title="두 실행의 실제 지표를 비교합니다"
        action={
          <button className="primary-button" disabled={disabled || !beforeRunId || !afterRunId} onClick={onCompare} type="button">
            <GitCompare size={17} />
            비교 실행
          </button>
        }
      />
      <div className="compare-selects">
        <label>
          <span>Before run</span>
          <select value={beforeRunId} onChange={(event) => setBeforeRunId(event.target.value)}>
            <option value="">선택</option>
            {runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {safeText(run.mission, run.run_id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>After run</span>
          <select value={afterRunId} onChange={(event) => setAfterRunId(event.target.value)}>
            <option value="">선택</option>
            {runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {safeText(run.mission, run.run_id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result ? (
        <>
          <div className="compare-table">
            <div className="compare-row head">
              <span>지표</span>
              <span>Before</span>
              <span>After</span>
            </div>
            {result.metrics.map((row) => (
              <div className="compare-row" key={row.metric}>
                <strong>{metricLabels[row.metric] ?? row.metric}</strong>
                <span>{formatMetric(row.metric, row.before)}</span>
                <span>{formatMetric(row.metric, row.after)}</span>
              </div>
            ))}
          </div>
          <div className="compare-result-copy">
            추천 프롬프트가 나아졌는지는 After의 오류, 사용자 개입, 시간, 비용이 줄고 성공 여부와 검증 이벤트가 개선됐는지로 판단합니다.
          </div>
        </>
      ) : (
        <div className="empty-light">비교할 두 run을 선택하세요.</div>
      )}
    </Panel>
  );
}

function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("capture");
  const [workRequest, setWorkRequest] = useState("Tool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성");
  const [captureMission, setCaptureMission] = useState("Codex 작업 기록을 가져와 프롬프트를 개선");
  const [transcript, setTranscript] = useState(
    "User: Tool-Use Flight Recorder + Prompt Recommender UI와 자율 실행 루프를 검증해줘\n\nAssistant: 먼저 관련 파일을 읽고 현재 구조를 확인하겠습니다.\n\nTool: functions.shell_command\nCommand: rg --files\n\nExit code: 0\nOutput: src/App.tsx runner/supervisor.py skills/agent-flight-recorder/scripts/trace_tools.py\n\nTool: functions.shell_command\nCommand: node node_modules/typescript/bin/tsc -b\n\nExit code: 1\nOutput: TypeScript error in src/App.tsx\n\nRetry: 깨진 문구를 제거하고 타입 오류를 수정한 뒤 다시 검증합니다.\n\nValidation: tsc -b passed\n\nFinal: 완료. UI, trace engine, adapter를 수정했고 검증을 통과했습니다.\nDuration: 94s\nTokens: 18200\nCost: $0.46\nSuccess: true",
  );
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [beforeRunId, setBeforeRunId] = useState("");
  const [afterRunId, setAfterRunId] = useState("");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [busy, setBusy] = useState(false);

  const analysis = detail?.analysis ?? null;
  const recommendation = detail?.recommendation ?? null;
  const metrics = analysis?.metric_totals;

  const refreshRuns = async () => {
    const nextRuns = await listRuns();
    setRuns(nextRuns);
    if (!selectedRunId && nextRuns[0]) setSelectedRunId(nextRuns[0].run_id);
  };

  useEffect(() => {
    void refreshRuns();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    void getRun(selectedRunId).then(setDetail);
  }, [selectedRunId]);

  const stats = useMemo(
    () => [
      { label: "이벤트", value: analysis?.event_count ?? 0, icon: ListChecks },
      { label: "프롬프트", value: analysis?.prompt_count ?? 0, icon: Sparkles },
      { label: "모델 응답", value: analysis?.model_response_count ?? 0, icon: FileText },
      { label: "도구 호출", value: analysis?.tool_call_count ?? 0, icon: TerminalSquare },
      { label: "오류", value: analysis?.error_count ?? 0, icon: AlertCircle, tone: "red" },
      { label: "검증", value: analysis?.validation_count ?? 0, icon: ShieldCheck, tone: "green" },
      { label: "시간", value: formatDuration(metrics?.duration_ms), icon: Clock3 },
      { label: "비용", value: typeof metrics?.cost_estimated === "number" ? `$${metrics.cost_estimated.toFixed(2)}` : "-", icon: Coins },
    ],
    [analysis, metrics],
  );

  const reloadSelected = async (runId: string) => {
    setSelectedRunId(runId);
    setDetail(await getRun(runId));
    await refreshRuns();
  };

  const handleImport = async () => {
    setBusy(true);
    try {
      const result = await importTranscript(transcript, captureMission);
      setLastImport(`${result.run_id} · ${result.events_imported}개 이벤트`);
      await reloadSelected(result.run_id);
      setActiveTab("records");
    } finally {
      setBusy(false);
    }
  };

  const handleAutopilot = async () => {
    setBusy(true);
    try {
      const result = await startAutopilot(workRequest);
      await reloadSelected(result.run_id);
      setActiveTab("records");
    } finally {
      setBusy(false);
    }
  };

  const handleRecommend = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      await recommendPrompt(selectedRunId, workRequest);
      setDetail(await getRun(selectedRunId));
    } finally {
      setBusy(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      await analyzeRun(selectedRunId);
      setDetail(await getRun(selectedRunId));
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      const result = await resumeSupervisor(selectedRunId);
      await reloadSelected(result.run_id);
    } finally {
      setBusy(false);
    }
  };

  const handleCompare = async () => {
    setBusy(true);
    try {
      setComparison(await compareRuns(beforeRunId, afterRunId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <RunSidebar runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} onRefresh={() => void refreshRuns()} />
      <main className="workspace">
        <section className="hero-panel">
          <div>
            <div className="breadcrumb">
              Tool-Use Flight Recorder <ArrowRight size={14} /> Prompt Recommender
            </div>
            <h1>에이전트가 뭘 했는지 남기고, 다음 프롬프트를 더 좋게 바꿉니다.</h1>
            <p>목표, 프롬프트, 모델 응답, 도구 호출, 오류, 재시도, 검증, 비용, 성공 여부를 한 실행 단위로 모아 봅니다.</p>
          </div>
          <StatusBadge busy={busy} />
        </section>

        <section className="panel mission-panel">
          <label className="field">
            <span>이번에 맡길 작업</span>
            <input value={workRequest} onChange={(event) => setWorkRequest(event.target.value)} />
          </label>
          <div className="mission-actions">
            <button className="primary-button" disabled={busy} onClick={handleAutopilot} type="button">
              <Play size={17} />
              자율 실행
            </button>
            <button className="secondary-button" disabled={busy || !selectedRunId} onClick={handleAnalyze} type="button">
              <FileSearch size={17} />
              분석 새로고침
            </button>
            <button className="secondary-button" disabled={busy || !selectedRunId} onClick={handleResume} type="button">
              <RotateCcw size={17} />
              중단 지점 재개
            </button>
          </div>
        </section>

        <TabBar activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === "capture" ? (
          <CapturePanel
            transcript={transcript}
            mission={captureMission}
            setTranscript={setTranscript}
            setMission={setCaptureMission}
            onImport={handleImport}
            disabled={busy}
            lastImport={lastImport}
          />
        ) : null}

        {activeTab === "records" ? (
          <>
            <div className="stat-grid">
              {stats.map((item) => (
                <StatCard key={item.label} {...item} />
              ))}
            </div>
            <div className="top-grid">
              <Panel>
                <SectionHeader label="실행 기록" title="이 run에 저장되는 항목" />
                <div className="record-list">
                  {recordItems.map((item) => (
                    <div key={item}>
                      <CheckCircle2 size={17} />
                      {item}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel className="timeline-panel">
                <SectionHeader label="타임라인 뷰" title="시간순으로 실행을 재생합니다" />
                <Timeline detail={detail} />
              </Panel>
            </div>
            <DiagnosisPanel analysis={analysis} recommendation={recommendation} />
          </>
        ) : null}

        {activeTab === "recommend" ? (
          <RecommendationPanel
            recommendation={recommendation}
            analysis={analysis}
            selectedRunId={selectedRunId}
            workRequest={workRequest}
            setWorkRequest={setWorkRequest}
            disabled={busy}
            onRecommend={handleRecommend}
          />
        ) : null}

        {activeTab === "compare" ? (
          <ComparePanel
            runs={runs}
            beforeRunId={beforeRunId}
            afterRunId={afterRunId}
            setBeforeRunId={setBeforeRunId}
            setAfterRunId={setAfterRunId}
            result={comparison}
            disabled={busy}
            onCompare={handleCompare}
          />
        ) : null}

        {activeTab === "how" ? (
          <div className="info-grid">
            <Panel>
              <SectionHeader label="동작 방식" title="제품이 run을 만드는 흐름" />
              <div className="step-list">
                {autopilotSteps.map((step, index) => (
                  <div key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <SectionHeader label="자동 감시 상태" title="지금 가능한 것과 다음 연결점" />
              <div className="warning-box">
                <AlertCircle size={17} />
                <p>
                  현재 제품은 실제 Codex 로그를 가져와 run으로 만드는 adapter를 갖췄습니다. Codex Desktop의 모든 내부 실행을 무접촉으로 감시하려면
                  Desktop/CLI 쪽 hook이 이 adapter에 transcript를 넘겨야 합니다.
                </p>
              </div>
              <div className="capture-status">
                <h3>다음 자동화 연결</h3>
                <ul>
                  <li>Codex CLI stdout/stderr wrapper가 codex_capture.py를 호출</li>
                  <li>MCP tool로 import_transcript 노출</li>
                  <li>hook에서 pre/post tool event를 같은 run_id로 append</li>
                </ul>
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === "patch" ? (
          <Panel>
            <SectionHeader label="패치노트" title="지금까지 바뀐 것" />
            <div className="patch-list">
              {patchNotes.map((note) => (
                <article key={note.title}>
                  <strong>{note.title}</strong>
                  <p>{note.body}</p>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
      </main>
    </div>
  );
}

export default App;
