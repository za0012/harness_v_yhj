const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runsDir = path.join(root, ".harness", "runs");
const traceTool = path.join(root, "skills", "agent-flight-recorder", "scripts", "trace_tools.py");
const supervisorTool = path.join(root, "runner", "supervisor.py");
const fallbackPython = path.join(
  process.env.USERPROFILE || "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe"
);

function pythonPath() {
  return process.env.FLIGHT_RECORDER_PYTHON || fallbackPython || "python";
}

function runPython(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [script, ...args], {
      cwd: root,
      env: { ...process.env, FLIGHT_RECORDER_DIR: runsDir },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `${path.basename(script)} exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Invalid Python tool JSON: ${stdout || error.message}`));
      }
    });
  });
}

function runTraceTool(args) {
  return runPython(traceTool, args);
}

function runSupervisor(args) {
  return runPython(supervisorTool, args);
}

async function readJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function listRuns() {
  await fs.mkdir(runsDir, { recursive: true });
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runId = entry.name;
        const dir = path.join(runsDir, runId);
        const events = await readJsonl(path.join(dir, "events.jsonl"));
        const stat = await fs.stat(dir);
        const mission = events.find((event) => event.type === "mission");
        const outcome = [...events].reverse().find((event) => event.type === "outcome");
        return {
          run_id: runId,
          path: dir,
          event_count: events.length,
          mission: mission?.summary || "Untitled mission",
          outcome: outcome?.summary || "No outcome recorded",
          updated_at: stat.mtime.toISOString(),
        };
      })
  );
  return runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "Agent Flight Recorder",
    backgroundColor: "#f7f4ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(root, "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("flight:listRuns", listRuns);
  ipcMain.handle("flight:getRun", async (_event, runId) => {
    const dir = path.join(runsDir, runId);
    const [events, analysisRaw, recommendationRaw, stateRaw] = await Promise.all([
      readJsonl(path.join(dir, "events.jsonl")),
      fs.readFile(path.join(dir, "analysis.json"), "utf8").catch(() => null),
      fs.readFile(path.join(dir, "recommendation.json"), "utf8").catch(() => null),
      fs.readFile(path.join(dir, "state.json"), "utf8").catch(() => null),
    ]);
    return {
      run_id: runId,
      events,
      analysis: analysisRaw ? JSON.parse(analysisRaw) : null,
      recommendation: recommendationRaw ? JSON.parse(recommendationRaw) : null,
      state: stateRaw ? JSON.parse(stateRaw) : null,
    };
  });
  ipcMain.handle("flight:initRun", async (_event, payload) => {
    return runTraceTool(["init-run", "--slug", payload.slug, "--mission", payload.mission]);
  });
  ipcMain.handle("flight:recordEvent", async (_event, payload) => {
    return runTraceTool([
      "record",
      "--run-id",
      payload.runId,
      "--type",
      payload.type,
      "--summary",
      payload.summary,
    ]);
  });
  ipcMain.handle("flight:analyze", async (_event, runId) => {
    return runTraceTool(["analyze", "--run-id", runId]);
  });
  ipcMain.handle("flight:recommend", async (_event, payload) => {
    return runTraceTool(["recommend", "--run-id", payload.runId, "--task", payload.task]);
  });
  ipcMain.handle("flight:startSupervisor", async (_event, payload) => {
    const args = ["start", "--slug", payload.slug, "--mission", payload.mission];
    if (payload.planFile) args.push("--plan-file", payload.planFile);
    if (payload.noResume) args.push("--no-resume");
    return runSupervisor(args);
  });
  ipcMain.handle("flight:resumeSupervisor", async (_event, runId) => {
    return runSupervisor(["resume", "--run-id", runId]);
  });
  ipcMain.handle("flight:getSupervisorState", async (_event, runId) => {
    return runSupervisor(["state", "--run-id", runId]);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
