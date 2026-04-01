import { getPresetRange } from "./lib/date-range.mjs";
import { buildAiSummaryPrompt } from "./lib/daily-report-prompt.mjs";
import { parseWorkHours } from "./lib/report-parser.mjs";

const DEFAULT_ORIGIN = "http://10.19.3.38";
const SUPPORTED_HOST = "10.19.3.38";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RUN_STATISTICS") {
    return undefined;
  }

  handleRunStatistics(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleRunStatistics(message, sender) {
  const { preset, startDate, endDate } = resolveDateRange(message);
  const activeTabId = message.activeTabId ?? sender?.tab?.id;
  const activeTabUrl = message.activeTabUrl ?? sender?.tab?.url ?? DEFAULT_ORIGIN;
  const origin = resolveOrigin(activeTabUrl);

  if (!activeTabId) {
    throw new Error("请先打开考勤系统主页面后再执行统计。");
  }

  await ensureContentScriptReady(activeTabId);

  const html = await runPageSearchAndGetHtml({
    tabId: activeTabId,
    origin,
    startDate,
    endDate
  });

  const result = {
    ...parseWorkHours(html),
    startDate,
    endDate,
    endpoint: new URL("/daily_report/my_report.jsp", origin).toString(),
    fetchedAt: new Date().toISOString()
  };

  const payload = {
    ...result,
    aiSummaryPrompt: buildAiSummaryPrompt(result),
    preset: preset || "custom"
  };

  await chrome.storage.local.set({ lastStatistics: payload });

  return payload;
}

function resolveDateRange(message) {
  if (message.startDate && message.endDate) {
    return {
      preset: null,
      startDate: message.startDate,
      endDate: message.endDate
    };
  }

  if (!message.preset) {
    throw new Error("缺少统计时间范围。");
  }

  return {
    preset: message.preset,
    ...getPresetRange(message.preset)
  };
}

function resolveOrigin(activeTabUrl) {
  if (isSupportedHost(activeTabUrl)) {
    return new URL(activeTabUrl).origin;
  }

  return DEFAULT_ORIGIN;
}

function isSupportedHost(activeTabUrl) {
  try {
    const url = new URL(activeTabUrl);

    if (url.protocol.startsWith("http") && url.hostname === SUPPORTED_HOST) {
      return true;
    }
  } catch (_error) {
  }

  return false;
}

async function runPageSearchAndGetHtml({ tabId, origin, startDate, endDate }) {
  let response;

  try {
    response = await chrome.tabs.sendMessage(tabId, {
      type: "RUN_STATISTICS_IN_PAGE",
      origin,
      startDate,
      endDate
    });
  } catch (error) {
    throw new Error(normalizeConnectionError(error));
  }

  if (!response?.ok) {
    throw new Error(response?.error || "页面内执行搜索失败。");
  }

  return response.html;
}

async function ensureContentScriptReady(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    throw new Error(normalizeInjectionError(error));
  }
}

function normalizeConnectionError(error) {
  const message = error?.message || String(error || "");

  if (message.includes("Receiving end does not exist")) {
    return "页面脚本尚未就绪，已尝试自动注入但仍失败，请刷新考勤系统主页面后重试。";
  }

  return `页面通信失败: ${message}`;
}

function normalizeInjectionError(error) {
  const message = error?.message || String(error || "");

  if (message.includes("Cannot access contents of the page")) {
    return "当前页面不允许注入脚本，请切到考勤系统主页面后重试。";
  }

  if (message.includes("The extensions gallery cannot be scripted")) {
    return "当前标签页不是业务系统页面，请切到考勤系统主页面后重试。";
  }

  return `注入页面脚本失败: ${message}`;
}
