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
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeRun,
  compareRuns,
  deleteRun,
  getLiveWatcherStatus,
  getRun,
  importLatestCodexThread,
  importTranscript,
  listCodexThreads,
  listRuns,
  recommendPrompt,
  resumeSupervisor,
  startAutopilot,
  startLiveWatcher,
  stopLiveWatcher,
} from "./api";
import type {
  Analysis,
  CodexThreadSummary,
  ComparisonResult,
  DiagnosisIssue,
  EventType,
  LiveWatcherStatus,
  Recommendation,
  RunDetail,
  RunSummary,
  TraceEvent,
} from "./types";

type TabId = "import" | "records" | "recommend" | "compare" | "notes";
type ImportMode = "codex" | "paste";
type NotesMode = "how" | "patch";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "records", label: "실행 기록" },
  { id: "recommend", label: "프롬프트 추천" },
  { id: "compare", label: "Before / After" },
];

const sidebarTabs: Array<{ id: TabId; label: string }> = [
  { id: "import", label: "가져오기" },
  { id: "records", label: "실행 목록" },
  { id: "notes", label: "작업 노트" },
];

const eventLabels: Record<EventType, string> = {
  mission: "목표 기록",
  prompt: "프롬프트",
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

const productFlow = [
  "Codex Desktop live watcher, rollout import, 붙여넣은 로그, supervisor 실행을 모두 같은 run 형식으로 저장합니다.",
  "run에는 목표, 프롬프트, 모델 응답, 도구 호출/결과, 오류, 재시도, 검증, 토큰, 비용, 최종 결과가 쌓입니다.",
  "타임라인은 에이전트가 무엇을 읽고, 어떤 도구를 호출하고, 어디서 실패하거나 검증했는지 시간순으로 보여줍니다.",
  "프롬프트 진단은 목표, 성공 조건, 금지 행동, 출력 형식, 도구 정책, 검증 단계가 빠졌는지 찾습니다.",
  "추천 프롬프트는 선택한 run의 실제 오류, 검증 누락, 사용 도구, 지표를 근거로 다시 작성됩니다.",
  "Before/After는 두 run의 성공 여부, 도구 호출 수, 오류 수, 비용, 시간, 사용자 개입을 비교합니다.",
];

const packagedAppFlow = [
  "외부 PC에서 exe를 실행해도 앱은 dev server를 보지 않고 패키지 안의 dist/index.html을 열어야 합니다.",
  "Codex 대화는 클라우드에서 가져오지 않습니다. 실행 중인 PC의 로컬 Codex 데이터 폴더를 읽습니다.",
  "기본 위치는 %USERPROFILE%\\.codex\\state_5.sqlite입니다. 여기서 thread 목록과 rollout JSONL 경로를 찾습니다.",
  "선택한 thread의 rollout_path가 가리키는 JSONL에서 prompt, response, tool call/result, outcome을 변환합니다.",
  "실시간 감시는 rollout JSONL의 byte offset을 저장하고 새 줄이 생길 때 같은 run에 append합니다.",
  "외부 PC에 Codex Desktop/CLI 기록이 없거나 .codex 접근 권한이 없으면 목록은 비어 있을 수 있습니다.",
];

const patchNotes = [
  {
    title: "2026.07.08 · dev 빈 화면 복구",
    body: "깨진 UTF-8 문자열이 JSX와 TypeScript 문법까지 깨뜨려 Electron dev 창이 빈 화면으로 남던 문제를 정상 한국어 UI와 유효한 컴포넌트 구조로 복구했습니다.",
  },
  {
    title: "2026.07.08 · 가져오기 UX 정리",
    body: "Codex 대화 목록을 먼저 고르고 가져오기/실시간 감시 중 하나를 선택하는 흐름으로 정리했습니다. 로컬 state_5.sqlite와 rollout JSONL을 읽는다는 제한도 화면에 명시했습니다.",
  },
  {
    title: "2026.07.08 · 추천 근거 강화",
    body: "추천 화면에서 원본 프롬프트 발췌, run evidence, 진단 이슈, 개선 이유, 복사용 프롬프트를 함께 보여주도록 정리했습니다.",
  },
  {
    title: "2026.07.07 · 외부 exe 기준",
    body: "packaged runtime에서는 resources/app 내부가 아니라 패키지된 dist/index.html을 loadFile 하도록 분기해 외부 PC 빈 화면 가능성을 줄였습니다.",
  },
  {
    title: "2026.07.07 · slim portable 배포",
    body: "electron-builder dir 빌드의 EPERM rename 이슈를 피하기 위해 prepackaged 폴더를 만든 뒤 portable exe를 생성하는 경로를 사용합니다.",
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
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}분 ${restSeconds}초`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}시간 ${restMinutes}분`;
}

function formatMetric(metric: string, value: unknown) {
  if (metric === "duration_ms") return formatDuration(value);
  if (metric === "cost_estimated" && typeof value === "number") return `$${value.toFixed(4)}`;
  if (metric === "success") return value === true ? "성공" : value === false ? "실패" : "-";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function textLooksBroken(value: unknown): boolean {
  if (typeof value === "string") return /[\uFFFD\u5360]{2,}|[?]{4,}|[媛-힣][\uFFFD]/.test(value);
  if (Array.isArray(value)) return value.some((item) => textLooksBroken(item));
  if (value && typeof value === "object") return Object.values(value).some((item) => textLooksBroken(item));
  return false;
}

function safeText(value: string | undefined | null, fallback = "이전 로그의 깨진 문자열은 표시를 생략했습니다.") {
  if (!value) return fallback;
  return textLooksBroken(value) ? fallback : value;
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text);
}

function firstUsefulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "내용 없음";
}

function promptContent(event: TraceEvent) {
  const data = event.data ?? {};
  return typeof data.content === "string" ? data.content : event.summary;
}

function roleName(event: TraceEvent) {
  if (event.type === "model_response") return "모델";
  const role = typeof event.data?.role === "string" ? event.data.role : "unknown";
  if (role === "user") return "사용자";
  if (role === "system") return "시스템";
  if (role === "developer") return "개발자";
  return role;
}

function sourceName(event: TraceEvent) {
  const source = typeof event.data?.source === "string" ? event.data.source : "";
  if (source === "codex-rollout") return "Codex 대화";
  if (source === "codex-live") return "실시간 감시";
  if (source === "conversation") return "대화";
  return source || event.type;
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
  activeTab,
  onTabChange,
  onSelect,
  onDelete,
  onRefresh,
}: {
  runs: RunSummary[];
  selectedRunId: string | null;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onSelect: (runId: string) => void;
  onDelete: (runId: string) => void;
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
      <div className="sidebar-note">Codex 실행, 가져온 로그, 수동 기록을 하나의 run으로 묶어 분석합니다.</div>
      <div className="sidebar-tabs" aria-label="Run log 내부 화면">
        {sidebarTabs.map((tab) => (
          <button className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => onTabChange(tab.id)} type="button">
            {tab.label}
          </button>
        ))}
      </div>
      <div className="run-list">
        {runs.map((run) => (
          <article className={run.run_id === selectedRunId ? "run-card active" : "run-card"} key={run.run_id}>
            <button className="run-card-main" onClick={() => onSelect(run.run_id)} type="button">
              <span>{formatTime(run.updated_at)}</span>
              <strong>{safeText(run.mission, "제목을 읽을 수 없는 run")}</strong>
              <small>
                {run.event_count}개 이벤트 · {safeText(run.outcome, "결과 없음")}
              </small>
            </button>
            <button
              className="run-delete-button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(run.run_id);
              }}
              title="이 run 삭제"
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </article>
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

function SegmentedSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented-switch" role="group" aria-label={label}>
      {options.map((option) => (
        <button className={value === option.value ? "active" : ""} key={option.value} onClick={() => onChange(option.value)} type="button">
          {option.label}
        </button>
      ))}
    </div>
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
  if (event.type === "tool_call" && /search|검색/i.test(summary)) return "검색 실행";
  if (event.type === "tool_call" && /read|file|파일|inspect/i.test(summary)) return "파일 확인";
  if (event.type === "tool_call") return "도구 호출";
  if (event.type === "error") return "오류 발생";
  if (event.type === "retry") return "재시도";
  if (event.type === "decision" && /intent|의도|scope|범위/i.test(summary)) return "범위 판단";
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

function PromptSourcePanel({ detail }: { detail: RunDetail | null }) {
  const prompts = detail?.events.filter((event) => event.type === "prompt") ?? [];
  const responses = detail?.events.filter((event) => event.type === "model_response") ?? [];
  const items = [...prompts, ...responses].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const userPrompts = prompts.filter((event) => event.data?.role === "user").length;
  const instructionPrompts = prompts.filter((event) => event.data?.role === "system" || event.data?.role === "developer").length;

  return (
    <Panel>
      <SectionHeader label="수집된 입력" title="프롬프트와 모델 응답을 역할별로 확인합니다" />
      <div className="prompt-source-summary">
        <span>사용자 프롬프트 {userPrompts}개</span>
        <span>시스템/개발자 지시 {instructionPrompts}개</span>
        <span>모델 응답 {responses.length}개</span>
      </div>
      {items.length ? (
        <div className="prompt-thread">
          {items.map((event, index) => {
            const content = safeText(promptContent(event), "본문 없음");
            return (
              <details className={event.type === "model_response" ? "prompt-thread-item model" : "prompt-thread-item"} key={`${event.timestamp}-${index}`}>
                <summary>
                  <span>{roleName(event)}</span>
                  <strong>{firstUsefulLine(content)}</strong>
                  <small>{sourceName(event)}</small>
                </summary>
                <pre>{content}</pre>
              </details>
            );
          })}
        </div>
      ) : (
        <div className="empty-light">이 run에는 아직 프롬프트나 모델 응답이 없습니다.</div>
      )}
    </Panel>
  );
}

function DiagnosisPanel({ analysis, recommendation }: { analysis: Analysis | null; recommendation: Recommendation | null }) {
  const issues = recommendation?.diagnosis_issues ?? analysis?.diagnosis_issues ?? [];
  const fallback = recommendation?.diagnosis ?? analysis?.risks ?? [];

  return (
    <Panel>
      <SectionHeader label="진단" title="다음 프롬프트에서 보완할 약점" />
      <div className="diagnosis-template">
        {diagnosisItems.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      {issues.length ? (
        <div className="issue-list">
          {issues.map((issue) => (
            <article className={`issue-card ${issueTone(issue)}`} key={issue.id}>
              <div>
                <span>{issue.severity}</span>
                <strong>{safeText(issue.title)}</strong>
              </div>
              <p>{safeText(issue.evidence)}</p>
              <small>{safeText(issue.recommendation)}</small>
            </article>
          ))}
        </div>
      ) : fallback.length ? (
        <div className="issue-list">
          {fallback.map((item) => (
            <article className="issue-card" key={item}>
              <strong>{safeText(item)}</strong>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-light">분석을 실행하면 진단 결과가 여기에 표시됩니다.</div>
      )}
    </Panel>
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
  analysis: Analysis | null;
  selectedRunId: string | null;
  workRequest: string;
  setWorkRequest: (value: string) => void;
  disabled: boolean;
  onRecommend: () => void;
}) {
  const evidence = recommendation?.evidence ?? [];
  const issues = recommendation?.diagnosis_issues ?? analysis?.diagnosis_issues ?? [];
  const fixes = recommendation?.prompt_fixes ?? [];
  const copyPrompt = recommendation?.copy_prompt || recommendation?.recommended_prompt || "";
  const variants = [
    {
      title: "실전 실행형",
      note: "다음 Codex 실행에 바로 붙여넣기 좋은 형태",
      text: recommendation?.recommended_prompt,
    },
    {
      title: "하네스 관찰형",
      note: "도구 호출, 오류, 검증 기록을 더 촘촘히 요구",
      text: recommendation?.user_prompt,
    },
    {
      title: "복구 중심형",
      note: "실패 원인 분류와 재시도 전략을 강조",
      text: recommendation?.retry_strategy?.join("\n"),
    },
  ];

  return (
    <Panel className="recommendation-panel">
      <SectionHeader
        label="Prompt Recommender"
        title="선택한 run의 실제 로그로 다음 프롬프트를 만듭니다"
        action={
          <button className="primary-button" disabled={disabled || !selectedRunId} onClick={onRecommend} type="button">
            <WandSparkles size={17} />
            추천 생성
          </button>
        }
      />
      <label className="field">
        <span>다음에 다시 실행할 작업</span>
        <textarea value={workRequest} onChange={(event) => setWorkRequest(event.target.value)} />
      </label>
      <div className="prompt-planner">
        <article className="planner-stage">
          <span>1</span>
          <div>
            <strong>근거 수집</strong>
            <p>이벤트, 오류, 검증, 토큰/비용, outcome을 읽습니다.</p>
          </div>
        </article>
        <article className="planner-stage">
          <span>2</span>
          <div>
            <strong>누락 진단</strong>
            <p>목표, 성공 조건, 도구 정책, 검증 단계가 비었는지 봅니다.</p>
          </div>
        </article>
        <article className="planner-stage">
          <span>3</span>
          <div>
            <strong>프롬프트 재작성</strong>
            <p>실패 지점을 줄이는 다음 실행용 프롬프트를 만듭니다.</p>
          </div>
        </article>
      </div>
      <div className="prompt-grid">
        <div className="prompt-block">
          <h3>원본 사용자 프롬프트</h3>
          <p>{safeText(recommendation?.original_user_prompt, "선택한 run에 사용자 프롬프트가 없거나 아직 추천을 생성하지 않았습니다.")}</p>
        </div>
        <div className="prompt-block">
          <h3>실행 근거</h3>
          <ul>{(evidence.length ? evidence : ["추천을 만들면 이벤트 수, 오류, 검증, 시간/토큰/비용 근거가 여기에 표시됩니다."]).map((item) => <li key={item}>{safeText(item)}</li>)}</ul>
        </div>
      </div>
      <div className="why-improved">
        <SectionHeader label="왜 달라졌나" title="로그에서 반영한 개선점" />
        <ul>
          {(fixes.length ? fixes : issues.map((issue) => issue.recommendation)).slice(0, 6).map((item) => (
            <li key={item}>{safeText(item)}</li>
          ))}
          {!fixes.length && !issues.length ? <li>추천을 생성하면 실제 진단 이슈 기반 개선점이 표시됩니다.</li> : null}
        </ul>
      </div>
      <div className="variant-grid">
        {variants.map((variant) => (
          <article className="variant-card" key={variant.title}>
            <div>
              <strong>{variant.title}</strong>
              <span>{variant.note}</span>
            </div>
            <pre>{safeText(variant.text, "아직 생성된 추천이 없습니다.")}</pre>
          </article>
        ))}
      </div>
      <div className="copy-header">
        <SectionHeader label="복사용" title="다음 실행에 넣을 프롬프트 묶음" />
        <button className="secondary-button" disabled={!copyPrompt} onClick={() => copyText(copyPrompt)} type="button">
          <Clipboard size={16} />
          복사
        </button>
      </div>
      <pre className="prompt-output">{safeText(copyPrompt, "추천 생성 후 복사용 system/user/tool/checklist가 표시됩니다.")}</pre>
    </Panel>
  );
}

function CapturePanel({
  mode,
  transcript,
  mission,
  setTranscript,
  setMission,
  onImport,
  onImportLatest,
  onRefreshThreads,
  onStartLive,
  onStopLive,
  disabled,
  lastImport,
  liveStatus,
  codexThreads,
  selectedThreadId,
  setSelectedThreadId,
  codexScope,
  setCodexScope,
}: {
  mode: ImportMode;
  transcript: string;
  mission: string;
  setTranscript: (value: string) => void;
  setMission: (value: string) => void;
  onImport: () => void;
  onImportLatest: () => void;
  onRefreshThreads: () => void;
  onStartLive: () => void;
  onStopLive: () => void;
  disabled: boolean;
  lastImport: string | null;
  liveStatus: LiveWatcherStatus | null;
  codexThreads: CodexThreadSummary[];
  selectedThreadId: string;
  setSelectedThreadId: (value: string) => void;
  codexScope: "workspace" | "all";
  setCodexScope: (value: "workspace" | "all") => void;
}) {
  const selectedThread = codexThreads.find((thread) => thread.id === selectedThreadId) ?? codexThreads[0] ?? null;

  return (
    <Panel>
      <SectionHeader label="로그 가져오기" title={mode === "codex" ? "Codex 로컬 대화를 run으로 변환합니다" : "대화 로그를 붙여넣어 run으로 변환합니다"} />
      <div className="middle-grid">
        <div>
          <label className="field">
            <span>이 run의 목표</span>
            <input value={mission} onChange={(event) => setMission(event.target.value)} />
          </label>
          {mode === "codex" ? (
            <>
              <div className="thread-picker">
                <div className="thread-picker-head">
                  <strong>Codex 대화 선택</strong>
                  <button className="secondary-button compact" disabled={disabled} onClick={onRefreshThreads} type="button">
                    새로고침
                  </button>
                </div>
                <div className="scope-toggle">
                  <button className={codexScope === "workspace" ? "active" : ""} onClick={() => setCodexScope("workspace")} type="button">
                    현재 폴더
                  </button>
                  <button className={codexScope === "all" ? "active" : ""} onClick={() => setCodexScope("all")} type="button">
                    전체 Codex
                  </button>
                </div>
                <select value={selectedThreadId} onChange={(event) => setSelectedThreadId(event.target.value)}>
                  {codexThreads.length ? (
                    codexThreads.map((thread) => (
                      <option key={thread.id} value={thread.id} disabled={!thread.has_rollout}>
                        {thread.label || thread.title || thread.first_user_message || thread.id}
                      </option>
                    ))
                  ) : (
                    <option value="">가져올 Codex 대화가 없습니다</option>
                  )}
                </select>
                <div className="thread-meta">
                  <strong>{safeText(selectedThread?.title || selectedThread?.first_user_message, "대화를 선택하면 요약이 표시됩니다.")}</strong>
                  <small>{selectedThread?.rollout_path ? `rollout: ${selectedThread.rollout_path}` : "rollout JSONL 경로가 없으면 가져올 수 없습니다."}</small>
                </div>
              </div>
              <div className="live-controls">
                <button className="primary-button" disabled={disabled || !selectedThread?.has_rollout} onClick={onImportLatest} type="button">
                  <Upload size={17} />
                  선택한 Codex 대화 가져오기
                </button>
                <button className="secondary-button" disabled={disabled || !selectedThread?.has_rollout} onClick={onStartLive} type="button">
                  <Play size={17} />
                  실시간 감시 시작
                </button>
                <button className="secondary-button" disabled={disabled || !liveStatus?.run_id} onClick={onStopLive} type="button">
                  <RotateCcw size={17} />
                  실시간 감시 중지
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>Codex 실행 로그</span>
                <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} />
              </label>
              <button className="primary-button" disabled={disabled || !transcript.trim()} onClick={onImport} type="button">
                <Upload size={17} />
                붙여넣은 로그 가져오기
              </button>
            </>
          )}
        </div>
        <div>
          {liveStatus ? (
            <div className={liveStatus.process_status === "running" || liveStatus.status === "started" ? "live-status active" : "live-status"}>
              <strong>{liveStatus.process_status === "running" || liveStatus.status === "started" ? "Codex Desktop 감시 중" : "감시 상태"}</strong>
              <span>run: {liveStatus.run_id || "-"}</span>
              <small>{liveStatus.rollout_path || "선택한 Codex rollout JSONL을 따라갑니다."}</small>
              {liveStatus.last_error ? <small className="danger-text">{liveStatus.last_error}</small> : null}
            </div>
          ) : null}
          <div className="notice-box">
            <Info size={17} />
            <p>Codex 가져오기는 현재 PC의 로컬 .codex/state_5.sqlite와 rollout JSONL을 읽습니다. 외부 PC에 Codex 기록이 없으면 목록이 비어 보일 수 있습니다.</p>
          </div>
          {lastImport ? (
            <div className="compare-result-copy">
              마지막 가져오기: <strong>{lastImport}</strong>
            </div>
          ) : null}
          <div className="capture-status">
            <h3>인식하는 패턴</h3>
            <ul>
              <li>User, System, Assistant 형식의 대화 블록</li>
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
  const better = result ? result.metrics.filter((row) => {
    if (row.metric === "success") return row.after === true && row.before !== true;
    if (typeof row.before === "number" && typeof row.after === "number") return row.after < row.before;
    return false;
  }).length : 0;

  return (
    <Panel>
      <SectionHeader
        label="Before / After"
        title="두 실행의 실제 지표를 비교합니다"
        action={
          <button className="primary-button" disabled={disabled || !beforeRunId || !afterRunId || beforeRunId === afterRunId} onClick={onCompare} type="button">
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
            After run에서 개선된 지표가 {better}개입니다. 성공 여부가 바뀌었는지, 오류/사용자 개입/시간/비용이 줄었는지, 검증 이벤트가 충분한지를 함께 판단하세요.
          </div>
        </>
      ) : (
        <div className="empty-light">비교할 두 run을 선택하세요.</div>
      )}
    </Panel>
  );
}

function NotesPanel({ mode }: { mode: NotesMode }) {
  return mode === "how" ? (
    <div className="info-grid">
      <Panel>
        <SectionHeader label="동작 방식" title="제품이 run을 만드는 흐름" />
        <div className="step-list">
          {productFlow.map((step, index) => (
            <div key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SectionHeader label="외부 exe 배포" title="패키지와 Codex 로그 위치" />
        <div className="step-list">
          {packagedAppFlow.map((step, index) => (
            <div key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
        <SectionHeader label="현재 제한" title="지금 가능한 것과 아직 조심할 것" />
        <div className="warning-box">
          <AlertCircle size={17} />
          <p>토큰과 비용은 Codex 로그가 값을 제공하는 경우에만 정확합니다. 다른 Codex 데이터 경로를 쓰는 PC는 CODEX_HOME이나 앱 설정으로 경로 지정 옵션을 추가해야 더 안정적입니다.</p>
        </div>
        <div className="capture-status">
          <h3>지금 가능한 것</h3>
          <ul>
            <li>Codex Desktop rollout import</li>
            <li>Codex Desktop live watcher</li>
            <li>붙여넣은 로그 import와 동일한 분석/추천 파이프라인 적용</li>
            <li>run 간 Before/After 비교</li>
          </ul>
        </div>
      </Panel>
    </div>
  ) : (
    <Panel>
      <SectionHeader label="패치노트" title="지금까지 바꾼 것" />
      <div className="patch-list">
        {patchNotes.map((note) => (
          <article key={note.title}>
            <strong>{note.title}</strong>
            <p>{note.body}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("records");
  const [importMode, setImportMode] = useState<ImportMode>("codex");
  const [notesMode, setNotesMode] = useState<NotesMode>("how");
  const [workRequest, setWorkRequest] = useState("Tool-Use Flight Recorder + Prompt Recommender를 실제 로그 기반 제품으로 완성");
  const [captureMission, setCaptureMission] = useState("Codex 작업 기록을 가져와 다음 프롬프트를 개선");
  const [transcript, setTranscript] = useState(
    "User: Tool-Use Flight Recorder + Prompt Recommender UI와 자율 실행 루프를 검증해줘\n\nAssistant: 먼저 관련 파일을 읽고 현재 구조를 확인하겠습니다.\n\nTool: functions.shell_command\nCommand: rg --files\n\nExit code: 0\nOutput: src/App.tsx runner/supervisor.py skills/agent-flight-recorder/scripts/trace_tools.py\n\nTool: functions.shell_command\nCommand: node node_modules/typescript/bin/tsc -b\n\nExit code: 1\nOutput: TypeScript error in src/App.tsx\n\nRetry: 깨진 문구와 타입 오류를 수정한 뒤 다시 검증합니다.\n\nValidation: tsc -b passed\n\nFinal: 완료. UI, trace engine, adapter를 수정했고 검증을 통과했습니다.\nDuration: 94s\nTokens: 18200\nCost: $0.46\nSuccess: true",
  );
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [beforeRunId, setBeforeRunId] = useState("");
  const [afterRunId, setAfterRunId] = useState("");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveWatcherStatus | null>(null);
  const [codexThreads, setCodexThreads] = useState<CodexThreadSummary[]>([]);
  const [selectedCodexThreadId, setSelectedCodexThreadId] = useState("");
  const [codexScope, setCodexScope] = useState<"workspace" | "all">("workspace");

  const analysis = detail?.analysis ?? null;
  const recommendation = detail?.recommendation ?? null;
  const metrics = analysis?.metric_totals;

  const refreshRuns = async () => {
    const nextRuns = await listRuns();
    setRuns(nextRuns);
    if (!selectedRunId && nextRuns[0]) setSelectedRunId(nextRuns[0].run_id);
  };

  const refreshCodexThreads = async () => {
    const threads = await listCodexThreads(codexScope);
    setCodexThreads(threads);
    if (!threads.some((thread) => thread.id === selectedCodexThreadId)) {
      setSelectedCodexThreadId(threads.find((thread) => thread.has_rollout)?.id ?? "");
    }
  };

  useEffect(() => {
    void refreshRuns();
    void refreshCodexThreads();
  }, []);

  useEffect(() => {
    void refreshCodexThreads();
  }, [codexScope]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    void getRun(selectedRunId).then(setDetail);
  }, [selectedRunId]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!liveStatus?.run_id) return;
      const status = await getLiveWatcherStatus(liveStatus.run_id);
      setLiveStatus(status);
      await refreshRuns();
      if (selectedRunId === liveStatus.run_id) setDetail(await getRun(liveStatus.run_id));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [liveStatus?.run_id, selectedRunId]);

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

  const handleImportLatestCodexThread = async () => {
    setBusy(true);
    try {
      const selectedThread = codexThreads.find((thread) => thread.id === selectedCodexThreadId);
      const threadMission = selectedThread?.title || selectedThread?.first_user_message || captureMission;
      const result = await importLatestCodexThread(threadMission, selectedCodexThreadId || undefined);
      setLastImport(`${result.run_id} · ${result.events_imported}개 이벤트 · Codex thread`);
      await reloadSelected(result.run_id);
      setActiveTab("records");
    } finally {
      setBusy(false);
    }
  };

  const handleStartLiveWatcher = async () => {
    setBusy(true);
    try {
      const threadId = selectedCodexThreadId || codexThreads[0]?.id;
      const status = await startLiveWatcher(captureMission, threadId);
      setLiveStatus(status);
      if (status.run_id) await reloadSelected(status.run_id);
      else await refreshRuns();
      setActiveTab("records");
    } finally {
      setBusy(false);
    }
  };

  const handleStopLiveWatcher = async () => {
    setBusy(true);
    try {
      const status = await stopLiveWatcher();
      setLiveStatus(status);
      if (status.run_id) await reloadSelected(status.run_id);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    const target = runs.find((run) => run.run_id === runId);
    const title = safeText(target?.mission, runId);
    if (!window.confirm(`이 run을 삭제할까요?\n\n${title}`)) return;
    setBusy(true);
    try {
      await deleteRun(runId);
      const nextRuns = await listRuns();
      setRuns(nextRuns);
      if (selectedRunId === runId) {
        const next = nextRuns[0] ?? null;
        setSelectedRunId(next?.run_id ?? null);
        setDetail(next ? await getRun(next.run_id) : null);
      }
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
      <RunSidebar
        runs={runs}
        selectedRunId={selectedRunId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSelect={setSelectedRunId}
        onDelete={handleDeleteRun}
        onRefresh={() => void refreshRuns()}
      />
      <main className={["import", "notes"].includes(activeTab) ? "workspace info-only" : "workspace"}>
        <section className="hero-panel">
          <div>
            <div className="breadcrumb">
              Tool-Use Flight Recorder <ArrowRight size={14} /> Prompt Recommender
            </div>
            <h1>에이전트 실행을 기록하고 다음 프롬프트를 개선합니다</h1>
            <p>실제 로그를 run 단위로 모아 타임라인, 진단, 추천 프롬프트, Before/After 비교로 보여줍니다.</p>
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

        {activeTab === "import" ? (
          <>
            <SegmentedSwitch
              value={importMode}
              onChange={setImportMode}
              label="로그 가져오기 방식"
              options={[
                { value: "codex", label: "Codex 대화" },
                { value: "paste", label: "로그 붙여넣기" },
              ]}
            />
            <CapturePanel
              mode={importMode}
              transcript={transcript}
              mission={captureMission}
              setTranscript={setTranscript}
              setMission={setCaptureMission}
              onImport={handleImport}
              onImportLatest={handleImportLatestCodexThread}
              onRefreshThreads={() => void refreshCodexThreads()}
              onStartLive={handleStartLiveWatcher}
              onStopLive={handleStopLiveWatcher}
              disabled={busy}
              lastImport={lastImport}
              liveStatus={liveStatus}
              codexThreads={codexThreads}
              selectedThreadId={selectedCodexThreadId}
              setSelectedThreadId={setSelectedCodexThreadId}
              codexScope={codexScope}
              setCodexScope={setCodexScope}
            />
          </>
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
                <SectionHeader label="실행 기록" title="이 run에 저장된 항목" />
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
                <SectionHeader label="타임라인" title="시간순으로 실행을 재생합니다" />
                <Timeline detail={detail} />
              </Panel>
            </div>
            <PromptSourcePanel detail={detail} />
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

        {activeTab === "notes" ? (
          <>
            <SegmentedSwitch
              value={notesMode}
              onChange={setNotesMode}
              label="작업 노트"
              options={[
                { value: "how", label: "동작 방식" },
                { value: "patch", label: "패치노트" },
              ]}
            />
            <NotesPanel mode={notesMode} />
          </>
        ) : null}
      </main>
    </div>
  );
}

export default App;
