const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..", "..");
const outputDir = process.env.HARNESS_RUN_DIR || path.join(root, ".harness", "ui-smoke");
const screenshotPath = path.join(outputDir, `timeline-ui-smoke-${Date.now()}.png`);
const preloadPath = path.join(__dirname, "electron-ui-smoke-preload.cjs");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(`Boolean(${expression})`, true).catch(() => false);
    if (ok) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function main() {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  await app.whenReady();

  const win = new BrowserWindow({
    width: 1306,
    height: 854,
    show: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preloadPath,
    },
  });

  await win.loadFile(path.join(root, "dist", "index.html"));
  await waitFor(win, "document.querySelectorAll('.timeline-group-summary').length > 0");
  await win.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  await delay(300);

  const metrics = await collectTimelineMetrics(win);

  fs.mkdirSync(outputDir, { recursive: true });
  const screenshot = await win.capturePage();
  fs.writeFileSync(screenshotPath, screenshot.toPNG());
  const bitmap = screenshot.toBitmap();
  const darkPixelCount = countDarkPixels(bitmap);

  await win.webContents.executeJavaScript(`document.querySelector(".timeline-group-summary")?.click()`, true);
  await win.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  const expandedMetrics = await collectTimelineMetrics(win);

  assert(metrics.timelineFound, "Timeline was not rendered", metrics);
  assert(metrics.selectedRunTitle.length > 0, "Smoke test did not select a real run", metrics);
  assert(metrics.nativeTimelineDetails === 0, "Timeline must use controlled accordion rows, not native details", metrics);
  assert(metrics.timelineClientHeight >= 360, "Timeline scroll area is too short to inspect comfortably", metrics);
  assert(["auto", "scroll"].includes(metrics.timelineOverflowY), "Timeline must own vertical scrolling", metrics);
  assert(metrics.rows.length > 0, "Timeline has no prompt-turn rows", metrics);
  assert(metrics.rows.every((row) => row.height >= 64), "Collapsed timeline rows are too thin", metrics);
  assert(metrics.rows.every((row) => row.text.length >= 12), "Collapsed timeline rows do not expose readable labels", metrics);
  assert(metrics.rows.every((row) => row.expanded === "false"), "Timeline groups should start collapsed for scanability", metrics);
  assert(
    ["STRONG", "SPAN"].includes(metrics.firstTitlePointElement?.tag),
    "Timeline row text is not actually hit-testable/painted at its screen position",
    metrics,
  );
  const distinctRowTimes = new Set(metrics.rows.map((row) => row.timeText).filter(Boolean));
  assert(metrics.rows.length < 3 || distinctRowTimes.size > 1, "Timeline user input rows should not all show the same time", metrics);
  assert(
    metrics.rows.every((row) => !/The following is the Codex agent history|AGENTS\.md instructions|environment_context/i.test(row.text)),
    "Timeline groups must be based on real user prompts, not injected Codex context",
    metrics,
  );
  assert(expandedMetrics.items.length > 0, "Clicking a timeline group does not render events", expandedMetrics);
  assert(expandedMetrics.items.every((item) => item.height >= 56), "Visible timeline events are too thin to read", expandedMetrics);
  assert(expandedMetrics.items.every((item) => item.text.length >= 8), "Visible timeline events include blank rows", expandedMetrics);
  assert(darkPixelCount > 10000, "Screenshot does not contain enough rendered text/detail pixels", { ...metrics, darkPixelCount });

  await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "가져오기")?.click()`,
    true,
  );
  await waitFor(win, `Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("선택한 Codex 대화 가져오기"))`);
  await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("선택한 Codex 대화 가져오기"))?.click()`,
    true,
  );
  await waitFor(win, `document.querySelector(".import-feedback.partial")`);
  const importFeedback = await win.webContents.executeJavaScript(
    `document.querySelector(".import-feedback.partial")?.innerText.trim() || ""`,
    true,
  );
  assert(importFeedback.includes("일부 로그를 건너뛰고 가져왔습니다"), "Partial JSONL state was not explained to the user", { importFeedback });
  assert(importFeedback.includes("3번째 줄"), "Partial JSONL state did not expose the broken line number", { importFeedback });

  await clickImportTabAndRun(win);
  await waitFor(win, `document.querySelector(".import-feedback.empty")`);
  const emptyImportFeedback = await win.webContents.executeJavaScript(
    `document.querySelector(".import-feedback.empty")?.innerText.trim() || ""`,
    true,
  );
  assert(emptyImportFeedback.includes("rollout JSONL 파일이 비어 있습니다"), "Empty JSONL state was not explained to the user", { emptyImportFeedback });

  await clickImportTabAndRun(win);
  await waitFor(win, `document.querySelector(".import-feedback.failed")`);
  const unsupportedImportFeedback = await win.webContents.executeJavaScript(
    `document.querySelector(".import-feedback.failed")?.innerText.trim() || ""`,
    true,
  );
  assert(unsupportedImportFeedback.includes("지원하는 Codex 실행 기록이 없습니다"), "Unsupported JSONL state was not distinguished from malformed input", {
    unsupportedImportFeedback,
  });

  console.log(
    JSON.stringify(
      {
        status: "passed",
        screenshot: screenshotPath,
        timeline_rows: metrics.rows.length,
        visible_event_items_after_expand: expandedMetrics.items.length,
        selected_run_title: metrics.selectedRunTitle,
        selected_run_meta: metrics.selectedRunMeta,
        row_title_samples: metrics.rows.slice(0, 8).map((row) => row.text.split("\n").slice(0, 2).join(" / ")),
        row_time_samples: metrics.rows.slice(0, 8).map((row) => row.timeText),
        first_row_rect: metrics.rows[0],
        first_title_point_element: metrics.firstTitlePointElement,
        min_row_height: Math.min(...metrics.rows.map((row) => row.height)),
        min_event_height_after_expand: Math.min(...expandedMetrics.items.map((item) => item.height)),
        timeline_client_height: metrics.timelineClientHeight,
        timeline_overflow_y: metrics.timelineOverflowY,
        dark_pixel_count: darkPixelCount,
        partial_import_feedback: importFeedback,
        empty_import_feedback: emptyImportFeedback,
        unsupported_import_feedback: unsupportedImportFeedback,
      },
      null,
      2,
    ),
  );
}

async function clickImportTabAndRun(win) {
  await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "가져오기")?.click()`,
    true,
  );
  await waitFor(win, `Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("선택한 Codex 대화 가져오기"))`);
  await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("선택한 Codex 대화 가져오기"))?.click()`,
    true,
  );
}

async function collectTimelineMetrics(win) {
  return win.webContents.executeJavaScript(
    `(() => {
      const timeline = document.querySelector(".timeline");
      const summaries = Array.from(document.querySelectorAll(".timeline-group-summary"));
      const visibleItems = Array.from(document.querySelectorAll(".timeline-item"));
      const rows = summaries.map((row) => {
        const rect = row.getBoundingClientRect();
        const main = row.querySelector(".timeline-turn-main")?.getBoundingClientRect();
        const label = row.querySelector(".timeline-turn-label")?.getBoundingClientRect();
        const title = row.querySelector("strong")?.getBoundingClientRect();
        const timeText = row.querySelector("time")?.innerText.trim() || "";
        return {
          height: rect.height,
          width: rect.width,
          top: rect.top,
          left: rect.left,
          mainWidth: main?.width || 0,
          labelWidth: label?.width || 0,
          titleWidth: title?.width || 0,
          titleTop: title?.top || 0,
          timeText,
          text: row.innerText.trim(),
          expanded: row.getAttribute("aria-expanded"),
        };
      });
      const items = visibleItems.map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          height: rect.height,
          text: item.innerText.trim(),
        };
      });
      const style = timeline ? getComputedStyle(timeline) : null;
      const firstTitle = summaries[0]?.querySelector("strong")?.getBoundingClientRect();
      const pointElement = firstTitle
        ? document.elementFromPoint(firstTitle.left + 8, firstTitle.top + Math.max(8, firstTitle.height / 2))
        : null;
      return {
        selectedRunTitle: document.querySelector(".run-card.active strong")?.innerText.trim() || "",
        selectedRunMeta: document.querySelector(".run-card.active span")?.innerText.trim() || "",
        timelineFound: Boolean(timeline),
        timelineClientHeight: timeline?.clientHeight || 0,
        timelineOverflowY: style?.overflowY || "",
        nativeTimelineDetails: document.querySelectorAll("details.timeline-group").length,
        firstTitlePointElement: pointElement ? {
          tag: pointElement.tagName,
          className: pointElement.className,
          text: pointElement.textContent?.trim().slice(0, 120) || "",
        } : null,
        rows,
        items,
      };
    })()`,
    true,
  );
}

function countDarkPixels(bitmap) {
  let count = 0;
  for (let index = 0; index < bitmap.length; index += 4) {
    const blue = bitmap[index];
    const green = bitmap[index + 1];
    const red = bitmap[index + 2];
    const alpha = bitmap[index + 3];
    if (alpha > 200 && red < 90 && green < 100 && blue < 120) count += 1;
  }
  return count;
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          message: error.message,
          details: error.details || null,
          screenshot: fs.existsSync(screenshotPath) ? screenshotPath : null,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    app.quit();
  });
