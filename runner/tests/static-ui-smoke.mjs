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
  "프로그램을 불러오는 중",
  "다음 조종 포인트",
  "프롬프트 턴",
  "사용자 입력",
  "일부 로그를 건너뛰고 가져왔습니다",
  "지원하는 Codex 실행 기록이 없습니다",
  "rollout JSONL 파일이 비어 있습니다",
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
  path.join(root, "index.html"),
  path.join(root, "src", "App.tsx"),
  path.join(root, "src", "api.ts"),
  path.join(root, "dist"),
]);
const textFiles = files.filter((file) => /\.(tsx|ts|js|css|html)$/.test(file));
const combined = (await Promise.all(textFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
const appSource = await fs.readFile(path.join(root, "src", "App.tsx"), "utf8");
const styleSource = await fs.readFile(path.join(root, "src", "styles.css"), "utf8");
const missing = requiredTexts.filter((text) => !combined.includes(text));
const broken = brokenPattern.test(combined);
const distIndex = path.join(root, "dist", "index.html");
let absoluteAssetPaths = false;
const timelineContract = {
  controlledAccordion: appSource.includes('aria-expanded={isOpen}') && !appSource.includes('<details className="timeline-group"'),
  readableCollapsedRows: /\.timeline-group-summary\s*{[^}]*min-height:\s*(?:[6-9]\d|[1-9]\d{2,})px/s.test(styleSource),
  visibleTurnMetadata:
    appSource.includes("timeline-turn-label") &&
    appSource.includes("timeline-turn-count") &&
    styleSource.includes(".timeline-turn-label") &&
    styleSource.includes(".timeline-turn-count"),
  visibleTimelineScrollbar:
    /\.timeline\s*{[^}]*overflow-y:\s*scroll/s.test(styleSource) &&
    styleSource.includes(".timeline::-webkit-scrollbar-thumb") &&
    !/\.timeline::-webkit-scrollbar\s*{[^}]*display:\s*none/s.test(styleSource),
};
const failedTimelineContracts = Object.entries(timelineContract)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

try {
  const distHtml = await fs.readFile(distIndex, "utf8");
  absoluteAssetPaths = /\b(?:src|href)="\/assets\//.test(distHtml);
} catch {
  // Build may not have run yet. Source-only smoke still has value.
}

if (missing.length || broken || absoluteAssetPaths || failedTimelineContracts.length) {
  throw new Error(JSON.stringify({ status: "failed", missing, broken, absoluteAssetPaths, failedTimelineContracts }, null, 2));
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      files_checked: textFiles.length,
      required_texts: requiredTexts.length,
      dist_checked: files.some((file) => file.includes(`${path.sep}dist${path.sep}`)),
      relative_dist_assets: !absoluteAssetPaths,
      timeline_contract: timelineContract,
    },
    null,
    2,
  ),
);
