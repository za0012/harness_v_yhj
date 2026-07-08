const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const fallbackPython = path.join(
  process.env.USERPROFILE || "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe"
);

function resourceRoot() {
  const unpackedRoot = path.join(process.resourcesPath || "", "app.asar.unpacked");
  if (isPackagedRuntime() && fsSync.existsSync(unpackedRoot)) return unpackedRoot;
  return appRoot;
}

function isPackagedRuntime() {
  return app.isPackaged || path.basename(appRoot) === "app" && path.basename(path.dirname(appRoot)) === "resources";
}

function writableRoot() {
  return isPackagedRuntime() ? app.getPath("userData") : appRoot;
}

function runsDirectory() {
  return isPackagedRuntime() ? path.join(writableRoot(), "runs") : path.join(appRoot, ".harness", "runs");
}

function toolPath(...segments) {
  return path.join(resourceRoot(), ...segments);
}

function traceTool() {
  return toolPath("skills", "agent-flight-recorder", "scripts", "trace_tools.py");
}

function supervisorTool() {
  return toolPath("runner", "supervisor.py");
}

function captureTool() {
  return toolPath("runner", "adapters", "codex_capture.py");
}

function rolloutCaptureTool() {
  return toolPath("runner", "adapters", "codex_rollout_capture.py");
}

function liveWatcherTool() {
  return toolPath("runner", "adapters", "codex_live_watcher.py");
}

function bundledPythonPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "python", "python.exe"),
    path.join(appRoot, "build", "python", "python.exe"),
  ];
  return candidates.find((candidate) => candidate && fsSync.existsSync(candidate));
}

function pythonPath() {
  return process.env.FLIGHT_RECORDER_PYTHON || bundledPythonPath() || fallbackPython || "python";
}

function pythonEnv() {
  const selectedPython = pythonPath();
  const env = {
    ...process.env,
    FLIGHT_RECORDER_DIR: runsDirectory(),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
  if (selectedPython.includes(`${path.sep}python${path.sep}`) || selectedPython.includes(`${path.sep}build${path.sep}python${path.sep}`)) {
    env.PYTHONHOME = path.dirname(selectedPython);
  }
  return {
    ...env,
  };
}

function runPython(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [script, ...args], {
      cwd: writableRoot(),
      env: pythonEnv(),
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
  return runPython(traceTool(), args);
}

function runSupervisor(args) {
  return runPython(supervisorTool(), args);
}

function runCapture(args) {
  return runPython(captureTool(), args);
}

function runRolloutCapture(args) {
  return runPython(rolloutCaptureTool(), args);
}

let liveWatcher = null;
let liveWatcherRunId = null;

function startLiveWatcher(payload = {}) {
  if (liveWatcher && !liveWatcher.killed) {
    return Promise.resolve({ status: "running", run_id: liveWatcherRunId });
  }

  return new Promise((resolve, reject) => {
    const args = [
      liveWatcherTool(),
      "watch",
      "--cwd",
      payload.cwd || writableRoot(),
      "--mission",
      payload.mission || "Codex Desktop 실시간 감시",
      "--slug",
      payload.slug || "codex-live",
      "--interval",
      String(payload.interval || 1),
    ];
    if (payload.threadId) args.push("--thread-id", payload.threadId);
    if (payload.runId) args.push("--run-id", payload.runId);

    const child = spawn(pythonPath(), args, {
      cwd: writableRoot(),
      env: pythonEnv(),
      windowsHide: true,
    });
    liveWatcher = child;
    let stdoutBuffer = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ status: "starting", run_id: liveWatcherRunId });
      }
    }, 3000);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.run_id) liveWatcherRunId = message.run_id;
          if (!settled && message.status === "started") {
            settled = true;
            clearTimeout(timeout);
            resolve(message);
          }
        } catch {
          // Keep the watcher alive even if a diagnostic line is not JSON.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      console.error(`codex live watcher: ${chunk}`);
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on("close", (code) => {
      liveWatcher = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`codex live watcher exited with ${code}`));
      }
    });
  });
}

async function stopLiveWatcher() {
  const runId = liveWatcherRunId;
  if (liveWatcher && !liveWatcher.killed) {
    liveWatcher.kill();
  }
  liveWatcher = null;
  return { status: "stopped", run_id: runId };
}

async function getLiveWatcherStatus(payload = {}) {
  const runId = payload.runId || liveWatcherRunId;
  if (!runId) {
    return { status: liveWatcher && !liveWatcher.killed ? "running" : "stopped", run_id: null };
  }
  const state = await runPython(liveWatcherTool(), ["status", "--run-id", runId]).catch(() => ({ status: "unknown", run_id: runId }));
  return {
    ...state,
    process_status: liveWatcher && !liveWatcher.killed ? "running" : "stopped",
    run_id: runId,
  };
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

function pathTail(value) {
  return String(value || "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() || value;
}

function shortenPaths(value) {
  return String(value || "")
    .replace(/[A-Za-z]:\\[^\s"'<>|]+(?:\\[^\s"'<>|]+)*/g, (match) => pathTail(match))
    .replace(/(?:\/[^\s"'<>|]+){2,}/g, (match) => pathTail(match));
}

function compactText(value, limit = 86) {
  const cleaned = shortenPaths(value).trim().replace(/\s+/g, " ");
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
}

function eventContent(event) {
  if (typeof event?.data?.content === "string") return event.data.content;
  if (typeof event?.summary === "string") return event.summary;
  return "";
}

function runTitle(events) {
  const mission = events.find((event) => event.type === "mission");
  const missionText = mission?.summary || "";
  const looksGeneric = /Codex 작업 기록|Imported Codex|Codex Desktop 실시간 감시/.test(missionText);
  if (missionText && !looksGeneric) return compactText(missionText);
  const userPrompt = events.find((event) => event.type === "prompt" && event.data?.role === "user");
  const content = eventContent(userPrompt);
  if (content) return compactText(content);
  return compactText(missionText || "Untitled mission");
}

async function listRuns() {
  const runsDir = runsDirectory();
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
        const outcome = [...events].reverse().find((event) => event.type === "outcome");
        return {
          run_id: runId,
          path: dir,
          event_count: events.length,
          mission: runTitle(events),
          outcome: outcome?.summary || "No outcome recorded",
          updated_at: stat.mtime.toISOString(),
        };
      })
  );
  return runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function safeRunDir(runId) {
  if (!runId || typeof runId !== "string" || /[\\/]/.test(runId)) {
    throw new Error("Invalid run id");
  }
  const base = path.resolve(runsDirectory());
  const dir = path.resolve(base, runId);
  if (dir !== base && dir.startsWith(`${base}${path.sep}`)) return dir;
  throw new Error(`Refusing to access run outside runs dir: ${runId}`);
}

function loadingScreenUrl() {
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color: #191f28;
        background: #f7f4ee;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", system-ui, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f4ee;
      }
      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
      }
      .spinner {
        width: 34px;
        height: 34px;
        border: 3px solid #d9dee5;
        border-top-color: #3182f6;
        border-radius: 50%;
        animation: spin 0.82s linear infinite;
      }
      h1 {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #6b7684;
        font-size: 12px;
        font-weight: 700;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <h1>프로그램을 불러오는 중...</h1>
      <p>Agent Flight Recorder</p>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

async function loadRenderer(win, packagedIndex) {
  await win.loadURL(loadingScreenUrl()).catch((error) => {
    console.error(`Failed to load splash screen: ${error.message}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isPackagedRuntime()) {
    await win.loadFile(packagedIndex);
  } else {
    await win.loadURL("http://127.0.0.1:5173");
  }
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

  const packagedIndex = path.join(appRoot, "dist", "index.html");
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load renderer: ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  void loadRenderer(win, packagedIndex).catch((error) => {
    console.error(`Failed to load renderer: ${error.message}`);
  });
}

app.whenReady().then(() => {
  ipcMain.handle("flight:listRuns", listRuns);
  ipcMain.handle("flight:deleteRun", async (_event, runId) => {
    const dir = safeRunDir(runId);
    await fs.rm(dir, { recursive: true, force: true });
    return { run_id: runId, deleted: true };
  });
  ipcMain.handle("flight:getRun", async (_event, runId) => {
    const runsDir = runsDirectory();
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
  ipcMain.handle("flight:compareRuns", async (_event, payload) => {
    return runTraceTool([
      "compare",
      "--before-run-id",
      payload.beforeRunId,
      "--after-run-id",
      payload.afterRunId,
    ]);
  });
  ipcMain.handle("flight:importTranscript", async (_event, payload) => {
    const importsDir = app.isPackaged ? path.join(writableRoot(), "imports") : path.join(appRoot, ".harness", "imports");
    await fs.mkdir(importsDir, { recursive: true });
    const inputFile = path.join(importsDir, `codex-${Date.now()}.txt`);
    await fs.writeFile(inputFile, payload.text || "", "utf8");
    const args = [
      "--input",
      inputFile,
      "--slug",
      payload.slug || "codex-import",
      "--source",
      payload.source || "codex-transcript",
    ];
    if (payload.mission) args.push("--mission", payload.mission);
    if (payload.runId) args.push("--run-id", payload.runId);
    return runCapture(args);
  });
  ipcMain.handle("flight:importLatestCodexThread", async (_event, payload = {}) => {
    const args = ["--cwd", payload.cwd || writableRoot()];
    if (payload.threadId) args.push("--thread-id", payload.threadId);
    if (payload.mission) args.push("--mission", payload.mission);
    if (payload.runId) args.push("--run-id", payload.runId);
    return runRolloutCapture(args);
  });
  ipcMain.handle("flight:listCodexThreads", async (_event, payload = {}) => {
    const args = ["--list", "--limit", String(payload.limit || 30)];
    if (payload.allWorkspaces) args.push("--all-workspaces");
    else args.push("--cwd", payload.cwd || writableRoot());
    return runRolloutCapture(args);
  });
  ipcMain.handle("flight:startLiveWatcher", async (_event, payload = {}) => {
    return startLiveWatcher(payload);
  });
  ipcMain.handle("flight:stopLiveWatcher", async () => {
    return stopLiveWatcher();
  });
  ipcMain.handle("flight:getLiveWatcherStatus", async (_event, payload = {}) => {
    return getLiveWatcherStatus(payload);
  });
  ipcMain.handle("flight:startSupervisor", async (_event, payload) => {
    const args = ["start", "--slug", payload.slug, "--mission", payload.mission];
    if (payload.planFile) args.push("--plan-file", payload.planFile);
    if (payload.noResume) args.push("--no-resume");
    return runSupervisor(args);
  });
  ipcMain.handle("flight:startAutopilot", async (_event, payload) => {
    const args = ["autopilot", "--slug", payload.slug, "--mission", payload.mission];
    if (payload.planFile) args.push("--plan-file", payload.planFile);
    if (payload.maxCycles) args.push("--max-cycles", String(payload.maxCycles));
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
