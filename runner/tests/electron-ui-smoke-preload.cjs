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

contextBridge.exposeInMainWorld("flightRecorder", {
  listRuns: async () => (selectedRunId ? [runSummary(selectedRunId)] : []),
  getRun: async (runId) => runDetail(runId || selectedRunId),
  analyze: async (runId) => runDetail(runId || selectedRunId).analysis,
  recommend: async ({ runId }) => runDetail(runId || selectedRunId).recommendation,
  listCodexThreads: async () => ({ threads: [] }),
  getLiveWatcherStatus: async () => ({
    status: "stopped",
    process_status: "stopped",
    run_id: null,
    project_name: "하네스",
    project_path: "C:\\Users\\yhj\\Documents\\하네스",
  }),
});
