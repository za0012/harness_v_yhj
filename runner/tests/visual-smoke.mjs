import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/yhj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright",
);

const root = path.resolve(".");
const dist = path.join(root, "dist");
const outputDir = path.join(root, "output", "playwright");
const browserPaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serveDist() {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURI((req.url || "/").split("?")[0]);
      const rel = pathname.replace(/^\/+/, "") || "index.html";
      let filePath = path.join(dist, rel);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
      } catch {
        filePath = path.join(dist, "index.html");
      }
      const data = await fs.readFile(filePath);
      res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function visible(page, text) {
  return page.getByText(text).first().isVisible();
}

const server = await serveDist();
const port = server.address().port;
await fs.mkdir(outputDir, { recursive: true });

let context;
let browser;
try {
  const launchErrors = [];
  for (const executablePath of browserPaths) {
    try {
      await fs.access(executablePath);
      browser = await chromium.launch({
        headless: true,
        executablePath,
        args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
      });
      context = await browser.newContext();
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") launchErrors.push({ executablePath, message: String(error.message || error) });
    }
  }
  if (!context) throw new Error(`No launchable local Chromium-compatible browser found: ${JSON.stringify(launchErrors)}`);
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });

  const checks = [];
  checks.push(["hero", await visible(page, "작성한 프롬프트")]);
  checks.push(["records", await visible(page, "시간순으로 실행을 재생합니다")]);
  await page.getByRole("button", { name: "가져오기" }).click();
  checks.push(["codex-import", await visible(page, "Codex 대화를 골라 run으로 가져옵니다")]);
  await page.getByRole("button", { name: "로그 붙여넣기" }).click();
  checks.push(["capture", await page.getByRole("button", { name: "로그에서 run 만들기" }).isVisible()]);
  await page.getByRole("button", { name: "프롬프트 추천" }).click();
  checks.push(["recommend", await visible(page, "선택한 run의 실제 약점을 넣어")]);
  await page.getByRole("button", { name: "Before / After" }).click();
  checks.push(["compare", await visible(page, "두 실행의 실제 지표를 비교합니다")]);
  await page.getByRole("button", { name: "작업 노트" }).click();
  checks.push(["how", await visible(page, "제품이 run을 만드는 흐름")]);
  await page.getByRole("button", { name: "패치노트" }).click();
  checks.push(["patch", await visible(page, "탭 구조와 긴 대화 읽기 개선")]);

  const body = await page.locator("body").innerText();
  const broken = /[\uFFFD\u5360]{2,}|[?]{4,}|\u5A9B|\u6E72|\u7570|\u5BC3|\uF9CF/.test(body);
  await page.screenshot({ path: path.join(outputDir, "visual-smoke.png"), fullPage: false });
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length || broken) {
    throw new Error(`visual smoke failed: ${JSON.stringify({ failed, broken })}`);
  }
  console.log(JSON.stringify({ status: "passed", checks, screenshot: path.join(outputDir, "visual-smoke.png") }, null, 2));
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  server.close();
}
