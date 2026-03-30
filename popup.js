const lastMonthButton = document.getElementById("lastMonthButton");
const currentMonthButton = document.getElementById("currentMonthButton");
const openPanelButton = document.getElementById("openPanelButton");
const statusElement = document.getElementById("status");
const resultElement = document.getElementById("result");

const DEFAULT_ORIGIN = "http://10.19.3.38";
const MESSAGE_TIMEOUT_MS = 20000;

init();

async function init() {
  lastMonthButton.addEventListener("click", () => runPreset("lastMonth"));
  currentMonthButton.addEventListener("click", () => runPreset("currentMonth"));
  openPanelButton.addEventListener("click", openFloatingPanel);

  const { lastStatistics } = await chrome.storage.local.get("lastStatistics");
  if (lastStatistics) {
    renderResult(lastStatistics);
    setStatus("已恢复最近一次统计结果。");
  }
}

async function runPreset(preset) {
  setLoading(true);
  setStatus("正在刷新页面内日报列表并统计全部工时…", "loading");

  try {
    const activeTab = await getActiveTab();
    const response = await sendRuntimeMessageWithTimeout({
      type: "RUN_STATISTICS",
      preset,
      activeTabUrl: activeTab.url,
      activeTabId: activeTab.id
    });

    if (!response?.ok) {
      throw new Error(response?.error || "统计失败。");
    }

    renderResult(response.result);
    setStatus(response.result.warning || "统计完成。", response.result.warning ? "warning" : "");
  } catch (error) {
    setStatus(error.message || "统计失败。", "error");
  } finally {
    setLoading(false);
  }
}

async function openFloatingPanel() {
  setLoading(true);
  setStatus("正在打开网页悬浮窗…", "loading");

  try {
    const activeTab = await getActiveTab();

    if (!activeTab.id) {
      throw new Error("未找到当前标签页。");
    }

    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content.js"]
    });

    const response = await sendTabMessageWithTimeout(activeTab.id, {
      type: "SHOW_FLOATING_PANEL"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "打开悬浮窗失败。");
    }

    setStatus("悬浮窗已显示。");
  } catch (error) {
    setStatus(error.message || "打开悬浮窗失败。", "error");
  } finally {
    setLoading(false);
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return {
    id: tabs[0]?.id,
    url: tabs[0]?.url || DEFAULT_ORIGIN
  };
}

function renderResult(result) {
  resultElement.classList.remove("empty");
  const rows = [
    renderRow("时间范围", `${result.startDate} 至 ${result.endDate}`),
    renderRow("总工时", formatHours(result.totalHours)),
    renderRow("出勤天数", `${result.attendanceDayCount ?? 0} 天`),
    renderRow("记录条数", `${result.rowCount} 条`),
    renderRow("统计时间", formatDateTime(result.fetchedAt))
  ];

  if (result.invalidHourCount > 0) {
    rows.push(renderRow("异常工时", `${result.invalidHourCount} 条已忽略`));
  }

  resultElement.innerHTML = rows.join("");
}

function renderRow(label, value) {
  return `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function sendRuntimeMessageWithTimeout(message) {
  return Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error("统计超时，请确认当前页面已打开考勤系统并重试。"));
      }, MESSAGE_TIMEOUT_MS);
    })
  ]);
}

function sendTabMessageWithTimeout(tabId, message) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message),
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error("页面悬浮窗操作超时，请确认当前页面已打开考勤系统。"));
      }, MESSAGE_TIMEOUT_MS);
    })
  ]);
}

function setLoading(loading) {
  lastMonthButton.disabled = loading;
  currentMonthButton.disabled = loading;
  openPanelButton.disabled = loading;
}

function setStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `status${type ? ` ${type}` : ""}`;
}

function formatHours(value) {
  const fixed = Number(value).toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatDateTime(isoString) {
  try {
    return new Date(isoString).toLocaleString("zh-CN", {
      hour12: false
    });
  } catch (_error) {
    return isoString;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
