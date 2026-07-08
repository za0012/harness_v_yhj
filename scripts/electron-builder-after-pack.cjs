const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const source = path.join(context.projectDir, "build", "python");
  const destination = path.join(context.appOutDir, "resources", "python");
  if (!fs.existsSync(path.join(source, "python.exe"))) {
    throw new Error(`Python runtime is not prepared: ${source}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  console.log(`Bundled Python runtime: ${source} -> ${destination}`);
};
