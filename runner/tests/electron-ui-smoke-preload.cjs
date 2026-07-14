const { contextBridge } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const runsRoot = path.join(root, ".harness", "runs");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function chooseRunId() {
  if (process.env.HARNESS_UI_RUN_ID) return process.env.HARNESS_UI_RUN_ID;
  const runs = fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
  return runs
    .map((entry) => {
      const events = readJsonl(path.join(runsRoot, entry.name, "events.jsonl"));
      const hasCodexImport = events.some((event) => event.data?.source === "codex-rollout" || event.summary === "Codex turn context imported");
      return { runId: entry.name, eventCount: events.length, hasCodexImport };
    })
    .filter((run) => run.eventCount > 0)
    .sort((a, b) => Number(b.hasCodexImport) - Number(a.hasCodexImport) || b.eventCount - a.eventCount)[0]?.runId;
}

function runSummary(runId) {
  const dir = path.join(runsRoot, runId);
  const events = readJsonl(path.join(dir, "events.jsonl"));
  const stat = fs.statSync(dir);
  const outcome = [...events].reverse().find((event) => event.type === "outcome");
  const mission = events.find((event) => event.type === "mission");
  return {
    run_id: runId,
    path: dir,
    event_count: events.length,
    mission: mission?.summary || runId,
    outcome: outcome?.summary || "",
    updated_at: stat.mtime.toISOString(),
  };
}

function runDetail(runId) {
  const dir = path.join(runsRoot, runId);
  return {
    run_id: runId,
    events: readJsonl(path.join(dir, "events.jsonl")),
    analysis: readJson(path.join(dir, "analysis.json")),
    recommendation: readJson(path.join(dir, "recommendation.json")),
    state: readJson(path.join(dir, "state.json")),
  };
}

const selectedRunId = chooseRunId();
let importScenario = 0;

contextBridge.exposeInMainWorld("flightRecorder", {
  listRuns: async () => (selectedRunId ? [runSummary(selectedRunId)] : []),
  getRun: async (runId) => runDetail(runId || selectedRunId),
  analyze: async (runId) => runDetail(runId || selectedRunId).analysis,
  recommend: async ({ runId }) => runDetail(runId || selectedRunId).recommendation,
  listCodexThreads: async () => ({
    threads: [
      {
        id: "ui-partial-thread",
        label: "UI partial JSONL fixture",
        title: "UI partial JSONL fixture",
        rollout_path: "C:\\fixture\\partial-rollout.jsonl",
        has_rollout: true,
      },
    ],
  }),
  importLatestCodexThread: async () => {
    importScenario += 1;
    if (importScenario === 1) {
      return {
        status: "partial",
        run_id: selectedRunId,
        events_imported: 4,
        rollout_path: "C:\\fixture\\partial-rollout.jsonl",
        parse_report: {
          status: "partial",
          path: "C:\\fixture\\partial-rollout.jsonl",
          total_lines: 5,
          non_empty_lines: 5,
          parsed_lines: 4,
          supported_lines: 4,
          unsupported_lines: 0,
          skipped_lines: 1,
          issue_count: 1,
          issues: [{ code: "INVALID_JSON", line: 3, message: "JSON 형식이 올바르지 않습니다." }],
        },
      };
    }
    if (importScenario === 2) {
      return {
        status: "empty",
        run_id: null,
        events_imported: 0,
        rollout_path: "C:\\fixture\\empty.jsonl",
        parse_report: {
          status: "empty",
          path: "C:\\fixture\\empty.jsonl",
          total_lines: 0,
          non_empty_lines: 0,
          parsed_lines: 0,
          supported_lines: 0,
          unsupported_lines: 0,
          skipped_lines: 0,
          issue_count: 1,
          issues: [{ code: "EMPTY_FILE", message: "rollout JSONL 파일이 비어 있습니다." }],
        },
      };
    }
    return {
      status: "failed",
      run_id: null,
      events_imported: 0,
      rollout_path: "C:\\fixture\\unsupported.jsonl",
      parse_report: {
        status: "failed",
        path: "C:\\fixture\\unsupported.jsonl",
        total_lines: 2,
        non_empty_lines: 2,
        parsed_lines: 2,
        supported_lines: 0,
        unsupported_lines: 2,
        skipped_lines: 0,
        issue_count: 1,
        issues: [{ code: "NO_SUPPORTED_EVENTS", message: "JSONL은 읽었지만 지원하는 Codex 실행 이벤트를 찾지 못했습니다." }],
      },
    };
  },
  getLiveWatcherStatus: async () => ({
    status: "stopped",
    process_status: "stopped",
    run_id: null,
    project_name: "하네스",
    project_path: "C:\\Users\\yhj\\Documents\\하네스",
  }),
});
