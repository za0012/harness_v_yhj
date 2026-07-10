const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const harnessRoot = path.join(root, ".harness", "runs");
const startedAt = new Date();
const runId = `${formatRunDate(startedAt)}-release-harness`;
const runDir = path.join(harnessRoot, runId);
const eventsPath = path.join(runDir, "events.jsonl");
const statePath = path.join(runDir, "state.json");
const planPath = path.join(runDir, "plan.json");
const reportPath = path.join(runDir, "release-report.json");
const reportMdPath = path.join(runDir, "release-report.md");

let prepackagedRel = path.join("artifacts", `prepackaged-${runId}`);
let portableRel = path.join("artifacts", `portable-${runId}`);

const plan = [
  { id: "build", title: "pnpm run build", required: true },
  { id: "static_ui_smoke", title: "정적 UI smoke", required: true },
  { id: "electron_ui_smoke", title: "Electron UI visual smoke", required: true },
  { id: "prepare_python", title: "Python runtime 준비", required: true },
  { id: "codex_rollout_smoke", title: "Codex rollout timestamp/filter smoke", required: true },
  { id: "python_recommend_smoke", title: "Python import/recommend smoke", required: true },
  { id: "prepare_prepackaged", title: "prepackaged 준비", required: true },
  { id: "package_portable", title: "portable exe 생성", required: true },
  { id: "launch_exe", title: "exe 실행 및 5초 유지 확인", required: true },
  { id: "loading_screen_check", title: "빈 화면/로딩 화면 최소 확인", required: true },
  { id: "sha256", title: "SHA256 생성", required: true },
  { id: "report", title: "결과 보고서 저장", required: true },
];

const state = {
  run_id: runId,
  status: "pending",
  started_at: startedAt.toISOString(),
  updated_at: startedAt.toISOString(),
  cwd: root,
  attempts: {},
  steps: {},
  artifacts: {
    run_dir: runDir,
    prepackaged_dir: path.join(root, prepackagedRel),
    portable_dir: path.join(root, portableRel),
  },
  blockers: [],
  limitations: [],
};

const stepResults = [];

main().catch((error) => {
  recordBlocker("unexpected", error.message, { stack: error.stack });
  finalize("blocked");
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(planPath, {
    run_id: runId,
    objective: "One-command release verification harness for Agent Flight Recorder",
    created_at: startedAt.toISOString(),
    steps: plan,
  });
  updateState("running");
  appendEvent("mission", {
    objective: "pnpm run harness:release로 빌드, 검증, 패키징, exe 실행 확인, 해시, 보고서 저장을 자동 수행한다.",
    success_conditions: [
      "build passes",
      "static UI smoke passes",
      "Electron UI visual smoke passes",
      "Codex rollout timestamp/filter smoke passes",
      "Python import/recommend smoke passes",
      "portable exe is generated",
      "exe process survives at least 5 seconds",
      "loading screen marker is present",
      "SHA256 and release report are written",
    ],
  });

  const bash = findBash();
  if (!bash) {
    recordBlocker("environment:bash-missing", "Git Bash/bash를 찾지 못해 Node/pnpm 릴리즈 명령을 실행하지 않았습니다.");
    state.limitations.push("Node/pnpm 명령은 bash에서 실행해야 하므로 bash 미탐지 시 오프라인 파일 검증만 수행합니다.");
    await offlineChecks();
    finalize("blocked");
    process.exitCode = 1;
    return;
  }
  appendEvent("decision", { message: "Node/pnpm 명령은 bash에서 실행합니다.", bash });

  await runStepWithRecovery({
    id: "build",
    command: "pnpm run build",
    timeoutMs: 180000,
  });
  await runStepWithRecovery({
    id: "static_ui_smoke",
    command: "node runner/tests/static-ui-smoke.mjs",
    timeoutMs: 60000,
  });
  await runStepWithRecovery({
    id: "electron_ui_smoke",
    command: "pnpm exec electron runner/tests/electron-ui-smoke.cjs",
    timeoutMs: 90000,
    env: () => ({ HARNESS_RUN_DIR: runDir }),
  });
  await runStepWithRecovery({
    id: "prepare_python",
    command: "pnpm run prepare:python",
    timeoutMs: 180000,
  });
  await runStepWithRecovery({
    id: "codex_rollout_smoke",
    command: () => `${shQuote(toBashPath(pythonPath()))} runner/tests/codex-rollout-smoke.py`,
    timeoutMs: 60000,
  });
  await pythonRecommendSmoke(bash);
  await runStepWithRecovery({
    id: "prepare_prepackaged",
    command: "pnpm run prepare:python && node scripts/prepare-prepackaged-app.cjs",
    timeoutMs: 240000,
    env: () => ({ FLIGHT_RECORDER_PREPACKAGED_DIR: prepackagedRel }),
    recover: (classification, attempt) => {
      if (classification === "environment:file-lock") {
        prepackagedRel = path.join("artifacts", `prepackaged-${runId}-retry-${attempt + 1}`);
        state.artifacts.prepackaged_dir = path.join(root, prepackagedRel);
        return `잠긴 prepackaged 폴더를 피하기 위해 ${prepackagedRel} 경로로 재시도합니다.`;
      }
      return null;
    },
  });
  await runStepWithRecovery({
    id: "package_portable",
    command: () =>
      `pnpm exec electron-builder --win portable --prepackaged ${shQuote(prepackagedRel)} -c.directories.output=${shQuote(portableRel)}`,
    timeoutMs: 360000,
    recover: (classification, attempt) => {
      if (classification === "environment:file-lock") {
        portableRel = path.join("artifacts", `portable-${runId}-retry-${attempt + 1}`);
        state.artifacts.portable_dir = path.join(root, portableRel);
        return `잠긴 portable 출력 폴더를 피하기 위해 ${portableRel} 경로로 재시도합니다.`;
      }
      return null;
    },
  });

  const exePath = findPortableExe(path.join(root, portableRel));
  if (!exePath) {
    failStep("package_portable", "Portable exe를 찾지 못했습니다.", "artifact:missing-exe");
    finalize("blocked");
    process.exitCode = 1;
    return;
  }
  state.artifacts.exe_path = exePath;
  await launchExeSmoke(exePath);
  loadingScreenStaticCheck();
  sha256Step(exePath);
  finalize(hasRequiredFailures() ? "blocked" : "completed");
  if (hasRequiredFailures()) process.exitCode = 1;

  async function runStepWithRecovery(options) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      state.attempts[options.id] = attempt;
      const command = typeof options.command === "function" ? options.command() : options.command;
      const env = typeof options.env === "function" ? options.env() : options.env;
      updateStep(options.id, "running", { attempt, command });
      const result = await runBash(bash, command, { timeoutMs: options.timeoutMs, env });
      if (result.ok) {
        passStep(options.id, {
          attempt,
          command,
          duration_ms: result.durationMs,
          stdout_tail: tail(result.stdout),
          stderr_tail: tail(result.stderr),
        });
        return;
      }
      const classification = classifyFailure(`${result.stdout}\n${result.stderr}`, result.error);
      appendEvent("error", {
        step: options.id,
        attempt,
        command,
        classification,
        exit_code: result.exitCode,
        error: result.error,
        stdout_tail: tail(result.stdout),
        stderr_tail: tail(result.stderr),
      });
      if (attempt >= 3) {
        failStep(options.id, `3회 시도 후 실패했습니다: ${classification}`, classification);
        return;
      }
      updateState("recovering");
      const recovery = options.recover?.(classification, attempt);
      appendEvent("retry", {
        step: options.id,
        next_attempt: attempt + 1,
        classification,
        recovery: recovery || "동일 명령을 한 번 더 실행합니다.",
      });
      updateState("running");
    }
  }
}

async function pythonRecommendSmoke(bash) {
  const sampleLogPath = path.join(runDir, "python-smoke-log.txt");
  fs.writeFileSync(
    sampleLogPath,
    [
      "User: Build the Electron release and verify it.",
      "Assistant: pnpm run build failed with EBUSY on default_app.asar, retry with timestamped artifacts.",
      "Tool call: pnpm run build",
      "Tool result: passed",
      "Validation: exe stayed alive for 5 seconds",
    ].join("\n"),
    "utf8",
  );
  const pythonExe = pythonPath();
  const command = `${shQuote(toBashPath(pythonExe))} runner/adapters/codex_capture.py --input ${shQuote(
    toBashPath(sampleLogPath),
  )} --mission ${shQuote("release harness python smoke")} --run-id ${shQuote(runId)}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    state.attempts.python_recommend_smoke = attempt;
    updateStep("python_recommend_smoke", "running", { attempt, command });
    const result = await runBash(bash, command, { timeoutMs: 60000 });
    if (result.ok) {
      passStep("python_recommend_smoke", {
        attempt,
        command,
        duration_ms: result.durationMs,
        stdout_tail: tail(result.stdout),
        stderr_tail: tail(result.stderr),
      });
      return;
    }
    const classification = classifyFailure(`${result.stdout}\n${result.stderr}`, result.error);
    appendEvent("error", {
      step: "python_recommend_smoke",
      attempt,
      command,
      classification,
      exit_code: result.exitCode,
      error: result.error,
      stdout_tail: tail(result.stdout),
      stderr_tail: tail(result.stderr),
    });
    if (attempt >= 3) {
      failStep("python_recommend_smoke", `3회 시도 후 실패했습니다: ${classification}`, classification);
      return;
    }
    appendEvent("retry", {
      step: "python_recommend_smoke",
      next_attempt: attempt + 1,
      classification,
      recovery: "동일 Python smoke를 한 번 더 실행합니다.",
    });
  }
}

async function launchExeSmoke(exePath) {
  updateStep("launch_exe", "running", { exe_path: exePath });
  appendEvent("tool_call", { step: "launch_exe", command: exePath });
  const started = Date.now();
  let child;
  try {
    child = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      stdio: "ignore",
      windowsHide: false,
    });
  } catch (error) {
    failStep("launch_exe", error.message, "runtime:launch-failed");
    return;
  }
  let exited = false;
  let exitCode = null;
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });
  await delay(5200);
  const survived = !exited;
  const durationMs = Date.now() - started;
  if (survived) {
    try {
      child.kill();
    } catch {
      state.limitations.push("릴리즈 smoke 이후 exe 프로세스 종료 신호를 보냈지만 종료 여부를 추가 확인하지 못했습니다.");
    }
    passStep("launch_exe", { exe_path: exePath, pid: child.pid, survived_ms: durationMs });
  } else {
    failStep("launch_exe", `exe가 ${durationMs}ms 후 종료되었습니다. exit_code=${exitCode}`, "runtime:early-exit");
  }
}

function loadingScreenStaticCheck() {
  const mainPath = path.join(root, "electron", "main.cjs");
  updateStep("loading_screen_check", "running", { file: mainPath });
  const source = fs.readFileSync(mainPath, "utf8");
  const markers = ["프로그램을 불러오는 중", "loadingScreenUrl", "loadURL(loadingScreenUrl())"];
  const missing = markers.filter((marker) => !source.includes(marker));
  if (missing.length) {
    failStep("loading_screen_check", `로딩 화면 marker 누락: ${missing.join(", ")}`, "ui:loading-marker-missing");
    return;
  }
  state.limitations.push(
    "빈 화면/로딩 화면 확인은 현재 자동 스크린샷 없이 main process의 로딩 HTML marker와 exe 5초 생존으로 최소 검증합니다.",
  );
  passStep("loading_screen_check", { markers });
}

function sha256Step(exePath) {
  updateStep("sha256", "running", { exe_path: exePath });
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(exePath);
  hash.update(data);
  const sha256 = hash.digest("hex").toUpperCase();
  const shaPath = path.join(runDir, "portable-exe.sha256.txt");
  fs.writeFileSync(shaPath, `${sha256}  ${path.relative(root, exePath).replace(/\\/g, "/")}\n`, "utf8");
  state.artifacts.sha256_path = shaPath;
  state.artifacts.sha256 = sha256;
  passStep("sha256", { sha256, sha256_path: shaPath });
}

async function offlineChecks() {
  const files = [
    "package.json",
    "scripts/prepare-prepackaged-app.cjs",
    "runner/tests/static-ui-smoke.mjs",
    "electron/main.cjs",
  ];
  for (const file of files) {
    const fullPath = path.join(root, file);
    if (fs.existsSync(fullPath)) {
      appendEvent("validation", { step: "offline_file_exists", file, status: "passed" });
    } else {
      appendEvent("validation", { step: "offline_file_exists", file, status: "failed" });
    }
  }
  loadingScreenStaticCheck();
}

function runBash(bash, command, options = {}) {
  const started = Date.now();
  const fullCommand = `cd ${shQuote(toBashPath(root))} && ${command}`;
  appendEvent("tool_call", { command: fullCommand, shell: bash, timeout_ms: options.timeoutMs });
  return new Promise((resolve) => {
    const child = spawn(bash, ["-lc", fullCommand], {
      cwd: root,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs || 120000);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = {
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr,
        error: timedOut ? "timeout" : null,
        durationMs: Date.now() - started,
      };
      appendEvent("tool_result", {
        command: fullCommand,
        exit_code: code,
        ok: result.ok,
        duration_ms: result.durationMs,
        stdout_tail: tail(stdout),
        stderr_tail: tail(stderr),
        timed_out: timedOut,
      });
      resolve(result);
    });
  });
}

function findBash() {
  const candidates = [
    process.env.HARNESS_BASH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Git", "usr", "bin", "bash.exe"),
    "bash",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "bash") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findPortableExe(directory) {
  if (!fs.existsSync(directory)) return null;
  const matches = [];
  walk(directory, (file) => {
    if (/Agent Flight Recorder.*\.exe$/i.test(path.basename(file))) matches.push(file);
  });
  matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return matches[0] || null;
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, visit);
    else visit(fullPath);
  }
}

function passStep(id, details = {}) {
  updateStep(id, "passed", details);
  appendEvent("validation", { step: id, status: "passed", ...details });
}

function failStep(id, message, classification) {
  updateStep(id, "failed", { message, classification });
  recordBlocker(classification, message, { step: id });
  appendEvent("validation", { step: id, status: "failed", classification, message });
}

function updateStep(id, status, details = {}) {
  const item = {
    id,
    status,
    updated_at: new Date().toISOString(),
    ...details,
  };
  state.steps[id] = item;
  const existing = stepResults.findIndex((step) => step.id === id);
  if (existing >= 0) stepResults[existing] = item;
  else stepResults.push(item);
  writeState();
}

function updateState(status) {
  state.status = status;
  state.updated_at = new Date().toISOString();
  writeState();
}

function finalize(status) {
  updateState(status);
  const endedAt = new Date();
  const reportStep = {
    id: "report",
    status: "passed",
    updated_at: endedAt.toISOString(),
    report_path: reportPath,
    markdown_report_path: reportMdPath,
  };
  state.steps.report = reportStep;
  const existingReportStep = stepResults.findIndex((step) => step.id === "report");
  if (existingReportStep >= 0) stepResults[existingReportStep] = reportStep;
  else stepResults.push(reportStep);
  const report = {
    run_id: runId,
    status,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt.getTime() - startedAt.getTime(),
    steps: stepResults.map(reportStepSummary),
    artifacts: state.artifacts,
    blockers: state.blockers,
    limitations: state.limitations,
    event_log: eventsPath,
  };
  writeJson(reportPath, report);
  fs.writeFileSync(reportMdPath, renderMarkdownReport(report), "utf8");
  writeJson(path.join(runDir, "analysis.json"), analyzeEvents());
  writeState();
  appendEvent("outcome", { status, report_path: reportPath, markdown_report_path: reportMdPath });
}

function reportStepSummary(step) {
  const { stdout_tail, stderr_tail, ...summary } = step;
  if (stdout_tail) summary.stdout_tail_recorded = true;
  if (stderr_tail) summary.stderr_tail_recorded = true;
  return summary;
}

function renderMarkdownReport(report) {
  const passed = report.steps.filter((step) => step.status === "passed").length;
  const failed = report.steps.filter((step) => step.status === "failed").length;
  const lines = [
    "# Release Harness Report",
    "",
    `- Run ID: ${report.run_id}`,
    `- Status: ${report.status}`,
    `- Passed steps: ${passed}`,
    `- Failed steps: ${failed}`,
    `- Portable exe: ${report.artifacts.exe_path || "not generated"}`,
    `- SHA256: ${report.artifacts.sha256 || "not generated"}`,
    "",
    "## Steps",
    ...report.steps.map((step) => `- ${step.id}: ${step.status}`),
  ];
  if (report.blockers.length) {
    lines.push("", "## Blockers", ...report.blockers.map((blocker) => `- ${blocker.classification}: ${blocker.message}`));
  }
  if (report.limitations.length) {
    lines.push("", "## Limitations", ...report.limitations.map((limitation) => `- ${limitation}`));
  }
  lines.push("");
  return lines.join("\n");
}

function analyzeEvents() {
  const counts = {};
  if (!fs.existsSync(eventsPath)) return { event_counts: counts };
  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const eventType = event.type || event.kind || "unknown";
      counts[eventType] = (counts[eventType] || 0) + 1;
    } catch {
      counts.unparseable = (counts.unparseable || 0) + 1;
    }
  }
  return {
    run_id: runId,
    event_counts: counts,
    blockers: state.blockers,
    limitations: state.limitations,
  };
}

function recordBlocker(classification, message, details = {}) {
  const blocker = {
    classification,
    message,
    recorded_at: new Date().toISOString(),
    ...details,
  };
  state.blockers.push(blocker);
  appendEvent("blocker", blocker);
  writeState();
}

function appendEvent(kind, payload) {
  if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
  const { summary, ...data } = payload || {};
  fs.appendFileSync(
    eventsPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      run_id: runId,
      type: kind,
      summary: summary || summarizeEvent(kind, data),
      data,
    })}\n`,
    "utf8",
  );
}

function summarizeEvent(kind, data) {
  if (kind === "mission") return data.objective || "Release harness mission recorded.";
  if (kind === "decision") return data.message || "Release harness decision recorded.";
  if (kind === "tool_call") return `Run command: ${compact(data.command || data.step || "unknown")}`;
  if (kind === "tool_result") return `${data.ok ? "Command passed" : "Command failed"}: ${compact(data.command || "unknown")}`;
  if (kind === "validation") return `${data.step || "validation"} ${data.status || "recorded"}`;
  if (kind === "error") return `${data.step || "step"} failed: ${data.classification || "unknown"}`;
  if (kind === "retry") return `${data.step || "step"} retry ${data.next_attempt || ""}`.trim();
  if (kind === "blocker") return `${data.classification || "blocker"}: ${data.message || ""}`.trim();
  if (kind === "outcome") return `Release harness ${data.status || "completed"}`;
  return `${kind} recorded`;
}

function compact(value, limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function writeState() {
  writeJson(statePath, state);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function classifyFailure(text, error) {
  const combined = `${error || ""}\n${text || ""}`;
  if (/EBUSY|EPERM|busy|locked|being used by another process/i.test(combined)) return "environment:file-lock";
  if (/ENOENT|not recognized|command not found|No such file or directory/i.test(combined)) return "environment:missing-command";
  if (/ECONN|ENOTFOUND|ETIMEDOUT|network|download/i.test(combined)) return "environment:network";
  if (/TS\d+|TypeScript|vite build|failed to compile/i.test(combined)) return "code:build";
  if (/electron-builder|Cannot find module|ERR_MODULE/i.test(combined)) return "packaging:dependency";
  if (/timeout/i.test(combined)) return "environment:timeout";
  return "unknown";
}

function hasRequiredFailures() {
  return plan.some((item) => item.required && state.steps[item.id]?.status === "failed") || state.blockers.length > 0;
}

function tail(text, maxLength = 1600) {
  if (!text) return "";
  const cleaned = cleanLogText(text);
  return cleaned.length > maxLength ? cleaned.slice(cleaned.length - maxLength) : cleaned;
}

function cleanLogText(text) {
  return String(text)
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pythonPath() {
  const bundled = path.join(root, "build", "python", process.platform === "win32" ? "python.exe" : "bin/python");
  return fs.existsSync(bundled) ? bundled : "python";
}

function toBashPath(value) {
  if (!value || value === "python") return value;
  const resolved = path.resolve(value);
  if (/^[A-Za-z]:/.test(resolved)) {
    return `/${resolved[0].toLowerCase()}${resolved.slice(2).replace(/\\/g, "/")}`;
  }
  return resolved.replace(/\\/g, "/");
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function formatRunDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
