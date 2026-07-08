const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const destination = path.resolve(root, process.env.FLIGHT_RECORDER_PREPACKAGED_DIR || path.join("artifacts", "prepackaged"));
const appDir = path.join(destination, "resources", "app");
const pythonSource = path.join(root, "build", "python");

function copyRequired(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Missing required path: ${source}`);
  console.log(`Copy: ${source} -> ${target}`);
  copyRecursive(source, target);
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyRecursive(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function electronDistDir() {
  const electronExe = require("electron");
  return path.dirname(electronExe);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
console.log(`Copy Electron dist: ${electronDistDir()} -> ${destination}`);
copyRecursive(electronDistDir(), destination);

const electronExe = path.join(destination, "electron.exe");
const appExe = path.join(destination, "Agent Flight Recorder.exe");
if (fs.existsSync(electronExe)) {
  console.log(`Rename: ${electronExe} -> ${appExe}`);
  fs.renameSync(electronExe, appExe);
}

fs.mkdirSync(appDir, { recursive: true });
copyRequired(path.join(root, "package.json"), path.join(appDir, "package.json"));
copyRequired(path.join(root, "dist"), path.join(appDir, "dist"));
copyRequired(path.join(root, "electron"), path.join(appDir, "electron"));
copyRequired(path.join(root, "runner"), path.join(appDir, "runner"));
copyRequired(path.join(root, "skills"), path.join(appDir, "skills"));
copyRequired(path.join(root, "harness.config.json"), path.join(appDir, "harness.config.json"));
copyRequired(pythonSource, path.join(destination, "resources", "python"));

console.log(`Prepackaged app prepared: ${destination}`);
