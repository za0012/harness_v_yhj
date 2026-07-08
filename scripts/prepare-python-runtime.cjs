const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "build", "python");
const runtimeManifest = path.join(destination, "flight-recorder-python-runtime.json");
const fullMode = process.argv.includes("--full");
const mode = fullMode ? "full" : "slim";

function candidateRuntimeDirs() {
  const candidates = [];
  if (process.env.FLIGHT_RECORDER_PYTHON_RUNTIME) candidates.push(process.env.FLIGHT_RECORDER_PYTHON_RUNTIME);
  if (process.env.FLIGHT_RECORDER_PYTHON) candidates.push(path.dirname(process.env.FLIGHT_RECORDER_PYTHON));
  if (process.env.USERPROFILE) {
    candidates.push(
      path.join(
        process.env.USERPROFILE,
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime",
        "dependencies",
        "python",
      ),
    );
  }
  return candidates;
}

function findRuntimeDir() {
  for (const candidate of candidateRuntimeDirs()) {
    const pythonExe = path.join(candidate, "python.exe");
    if (fs.existsSync(pythonExe)) return path.resolve(candidate);
  }
  throw new Error(
    "Python runtime not found. Set FLIGHT_RECORDER_PYTHON_RUNTIME to a directory containing python.exe.",
  );
}

function shouldCopy(source) {
  const normalized = source.replaceAll("\\", "/");
  if (normalized.includes("/__pycache__/")) return false;
  if (normalized.endsWith(".pyc") || normalized.endsWith(".pyo")) return false;
  if (!fullMode) {
    const lower = normalized.toLowerCase();
    const excludedParts = [
      "/include/",
      "/libs/",
      "/scripts/",
      "/tcl/",
      "/lib/site-packages/",
      "/lib/ensurepip/",
      "/lib/idlelib/",
      "/lib/tkinter/",
      "/lib/turtledemo/",
      "/lib/lib2to3/",
      "/lib/unittest/",
      "/lib/venv/",
      "/lib/pydoc_data/",
    ];
    if (excludedParts.some((part) => lower.includes(part))) return false;
  }
  return true;
}

const source = findRuntimeDir();
if (!process.argv.includes("--force") && fs.existsSync(path.join(destination, "python.exe")) && fs.existsSync(runtimeManifest)) {
  try {
    const current = JSON.parse(fs.readFileSync(runtimeManifest, "utf8"));
    if (path.resolve(current.source) === source && current.mode === mode) {
      console.log(`Python runtime already prepared: ${destination}`);
      process.exit(0);
    }
  } catch {
    // Re-copy if the manifest is unreadable.
  }
}
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true, filter: shouldCopy });
fs.writeFileSync(
  runtimeManifest,
  `${JSON.stringify({ source, mode, copied_at: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);

console.log(`Python runtime copied (${mode}): ${source} -> ${destination}`);
