import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const requiredTexts = [
  "Tool-Use Flight Recorder",
  "Prompt Recommender",
  "Before / After",
  "가져오기",
  "작업 노트",
  "외부 exe 배포",
  "Codex 대화",
  "로그 붙여넣기",
  "선택한 Codex 대화 가져오기",
  "수집된 입력",
  "실시간 감시 시작",
  "Codex Desktop 감시 중",
  "패치노트",
];
const brokenPattern = /[\uFFFD\u5360]{2,}|[?]{4,}|[媛-힣][\uFFFD]/;

async function existingFiles(candidates) {
  const files = [];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        const children = await fs.readdir(candidate);
        for (const child of children) files.push(...(await existingFiles([path.join(candidate, child)])));
      } else {
        files.push(candidate);
      }
    } catch {
      // Missing dist is allowed; source checks still run.
    }
  }
  return files;
}

const files = await existingFiles([
  path.join(root, "src", "App.tsx"),
  path.join(root, "src", "api.ts"),
  path.join(root, "dist"),
]);
const textFiles = files.filter((file) => /\.(tsx|ts|js|css|html)$/.test(file));
const combined = (await Promise.all(textFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
const missing = requiredTexts.filter((text) => !combined.includes(text));
const broken = brokenPattern.test(combined);

if (missing.length || broken) {
  throw new Error(JSON.stringify({ status: "failed", missing, broken }, null, 2));
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      files_checked: textFiles.length,
      required_texts: requiredTexts.length,
      dist_checked: files.some((file) => file.includes(`${path.sep}dist${path.sep}`)),
    },
    null,
    2,
  ),
);
