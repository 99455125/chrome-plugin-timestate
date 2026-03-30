import { getPresetRange } from "./lib/date-range.mjs";
import { parseWorkHours } from "./lib/report-parser.mjs";

const DEFAULT_ORIGIN = "http://10.19.3.38";
const SUPPORTED_HOST = "10.19.3.38";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_STATISTICS") {
    return undefined;
  }

  handleRunStatistics(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleRunStatistics(message) {
  const { preset, startDate, endDate } = resolveDateRange(message);
  const origin = resolveOrigin(message.activeTabUrl);
  const canUseContentScript = isSupportedHost(message.activeTabUrl);

  if (!message.activeTabId || !canUseContentScript) {
    throw new Error("请先打开考勤系统主页面后再执行统计。");
  }

  const html = await runPageSearchAndGetHtml({
    tabId: message.activeTabId,
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
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "RUN_STATISTICS_IN_PAGE",
    origin,
    startDate,
    endDate
  });

  if (!response?.ok) {
    throw new Error(response?.error || "页面内执行搜索失败。");
  }

  return response.html;
}
