(function bootstrapContentScript() {
  if (window.__workHoursStatsContentScriptLoaded) {
    return;
  }

  window.__workHoursStatsContentScriptLoaded = true;
  console.debug("[work-hours-stats] content script ready");

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_STATISTICS_IN_PAGE") {
      runStatisticsInPage(message)
        .then((html) => sendResponse({ ok: true, html }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message?.type === "SHOW_FLOATING_PANEL") {
      showFloatingPanelFromMessage()
        .then((visible) => sendResponse({ ok: true, visible }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    return undefined;
  });
})();

const FLOAT_PANEL_ID = "__workHoursStatsFloatingPanel";
const FLOAT_PANEL_STYLE_ID = "__workHoursStatsFloatingPanelStyle";
const FLOAT_PANEL_STORAGE_KEY = "floatingPanelState";
let floatingPanelState = null;

restoreFloatingPanelOnLoad();

async function runStatisticsInPage({ startDate, endDate }) {
  let reportContext = findReportContext();

  if (!reportContext) {
    throw new Error("未找到主页面中的日报 iframe，请先进入包含“我的日报”的系统主页。");
  }

  if (reportContext.state === "login") {
    throw new Error("当前会话可能已失效，请先登录考勤系统后重试。");
  }

  if (reportContext.state !== "report") {
    reportContext = await navigateToMyReport(reportContext);
  }

  if (reportContext.state === "login") {
    throw new Error("当前会话可能已失效，请先登录考勤系统后重试。");
  }

  if (reportContext.state !== "report") {
    throw new Error("自动打开“我的日报”失败，请确认当前页面为系统主页。");
  }

  const { reportWindow, reportDocument, iframeElement } = reportContext;
  const startInput = reportDocument.querySelector("#start_time");
  const endInput = reportDocument.querySelector("#end_time");
  const searchButton = reportDocument.querySelector("#search_btn");

  if (!startInput || !endInput || !searchButton) {
    throw new Error("未找到日报查询表单。");
  }

  setInputValue(startInput, startDate);
  setInputValue(endInput, endDate);

  if (!iframeElement) {
    throw new Error("当前页面不是带 iframe 的系统主页，请回到主页面后再执行统计。");
  }

  const loadedDocument = await submitSearchInIframe({
    iframeElement,
    startDate,
    endDate,
    reportWindow,
    searchButton
  });

  return fetchFullReportHtml({
    reportWindow: loadedDocument.defaultView || iframeElement.contentWindow,
    startDate,
    endDate
  });
}

function findReportContext() {
  const iframeElement = document.querySelector("#mainframe, iframe[name='iframe'], iframe[src*='/daily_report/my_report.jsp']");

  if (!iframeElement) {
    return null;
  }

  const reportDocument = iframeElement.contentDocument;
  const reportWindow = iframeElement.contentWindow;

  if (!reportDocument || !reportWindow) {
    return null;
  }

  if (isLoginDocument(reportDocument)) {
    return {
      state: "login",
      reportWindow,
      reportDocument,
      iframeElement
    };
  }

  if (!isReportDocument(reportDocument)) {
    return {
      state: "other",
      reportWindow,
      reportDocument,
      iframeElement
    };
  }

  return {
    state: "report",
    reportWindow,
    reportDocument,
    iframeElement
  };
}

function isReportDocument(doc) {
  return Boolean(
    doc.querySelector("#start_time") &&
    doc.querySelector("#end_time") &&
    doc.querySelector("#search_btn")
  );
}

function setInputValue(input, value) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

async function submitSearchInIframe({ iframeElement, reportWindow, searchButton }) {
  const loadPromise = waitForIframeLoad(iframeElement, 15000);
  triggerSearch(reportWindow, searchButton);
  const loadedDocument = await loadPromise;

  if (isLoginDocument(loadedDocument)) {
    throw new Error("当前会话可能已失效，请先登录考勤系统后重试。");
  }

  if (!loadedDocument.querySelector("#maintable")) {
    throw new Error("iframe 已刷新，但未找到日报表格。");
  }

  return loadedDocument;
}

async function navigateToMyReport(reportContext) {
  const { iframeElement } = reportContext;
  const loadPromise = waitForIframeLoad(iframeElement, 15000);
  const clicked = clickMyReportLink();

  if (!clicked) {
    const loadedDocument = await forceNavigateIframeToMyReport(iframeElement, loadPromise);
    return buildContextFromLoadedDocument(iframeElement, loadedDocument);
  }

  const loadedDocument = await loadPromise;
  return buildContextFromLoadedDocument(iframeElement, loadedDocument);
}

function waitForIframeLoad(iframeElement, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timerId = 0;

    const onLoad = () => {
      window.clearTimeout(timerId);

      window.setTimeout(() => {
        try {
          const loadedDocument = iframeElement.contentDocument;

          if (!loadedDocument) {
            reject(new Error("iframe 刷新后无法访问内容文档。"));
            return;
          }

          resolve(loadedDocument);
        } catch (error) {
          reject(error);
        }
      }, 250);
    };

    timerId = window.setTimeout(() => {
      iframeElement.removeEventListener("load", onLoad);
      reject(new Error("等待日报 iframe 刷新超时。"));
    }, timeoutMs);

    iframeElement.addEventListener("load", onLoad, { once: true });
  });
}

function clickMyReportLink() {
  const candidates = [
    "a[href='./daily_report/my_report.jsp']",
    "a[href='/daily_report/my_report.jsp']",
    "a[href='daily_report/my_report.jsp']",
    "a[target='iframe'][href*='my_report.jsp']"
  ];

  for (const selector of candidates) {
    const link = document.querySelector(selector);

    if (!link) {
      continue;
    }

    if (typeof link.click === "function") {
      link.click();
      return true;
    }
  }

  return false;
}

async function forceNavigateIframeToMyReport(iframeElement, loadPromise) {
  const targetUrl = new URL("./daily_report/my_report.jsp", window.location.href).toString();

  try {
    if (typeof window.set_iframe_cookie === "function") {
      window.set_iframe_cookie("./daily_report/my_report.jsp");
    }
  } catch (_error) {
  }

  iframeElement.src = targetUrl;
  return loadPromise;
}

function buildContextFromLoadedDocument(iframeElement, loadedDocument) {
  const reportWindow = loadedDocument.defaultView || iframeElement.contentWindow;

  if (!reportWindow) {
    throw new Error("切换到“我的日报”后无法获取 iframe 上下文。");
  }

  if (isLoginDocument(loadedDocument)) {
    return {
      state: "login",
      reportWindow,
      reportDocument: loadedDocument,
      iframeElement
    };
  }

  if (!isReportDocument(loadedDocument)) {
    return {
      state: "other",
      reportWindow,
      reportDocument: loadedDocument,
      iframeElement
    };
  }

  return {
    state: "report",
    reportWindow,
    reportDocument: loadedDocument,
    iframeElement
  };
}

function triggerSearch(reportWindow, searchButton) {
  if (typeof searchButton.click === "function") {
    searchButton.click();
    return;
  }

  const form = searchButton.form || reportWindow.document.querySelector("form");

  if (!form) {
    throw new Error("未找到日报查询表单。");
  }

  if (typeof form.requestSubmit === "function") {
    form.requestSubmit(searchButton);
    return;
  }

  form.submit();
}

async function fetchFullReportHtml({ reportWindow, startDate, endDate }) {
  if (!reportWindow) {
    throw new Error("日报 iframe 刷新后无法获取页面上下文。");
  }

  const currentUrl = new URL(reportWindow.location.href);
  const requestUrl = new URL(currentUrl.pathname, currentUrl.origin).toString();
  const requestBody = new URLSearchParams({
    start_time: startDate,
    end_time: endDate,
    search: "搜索"
  });

  const response = await reportWindow.fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    credentials: "include",
    cache: "no-store",
    body: requestBody.toString()
  });

  if (!response.ok) {
    throw new Error(`刷新后获取完整日报失败: HTTP ${response.status}`);
  }

  return response.text();
}

function isLoginDocument(doc) {
  return Boolean(
    doc.querySelector("#username_input") &&
    doc.querySelector("#password_input") &&
    doc.querySelector("#login_btn")
  );
}

async function showFloatingPanelFromMessage() {
  const reportContext = await ensureReportContextForPanel();
  const panel = ensureFloatingPanel();

  syncPanelDateInputs(panel, reportContext);
  showFloatingPanel(panel, reportContext);
  await persistFloatingPanelState({
    visible: true,
    startDate: panel.startInput.value,
    endDate: panel.endInput.value,
    collapsed: panel.collapsed
  });
  return true;
}

async function ensureReportContextForPanel() {
  let reportContext = findReportContext();

  if (!reportContext) {
    throw new Error("未找到主页面中的日报 iframe，请先进入包含“我的日报”的系统主页。");
  }

  if (reportContext.state === "login") {
    throw new Error("当前会话可能已失效，请先登录考勤系统后重试。");
  }

  if (reportContext.state !== "report") {
    reportContext = await navigateToMyReport(reportContext);
  }

  if (reportContext.state === "login") {
    throw new Error("当前会话可能已失效，请先登录考勤系统后重试。");
  }

  if (reportContext.state !== "report") {
    throw new Error("自动打开“我的日报”失败，请确认当前页面为系统主页。");
  }

  return reportContext;
}

function ensureFloatingPanel() {
  ensureFloatingPanelStyles();

  if (floatingPanelState?.root && document.body.contains(floatingPanelState.root)) {
    return floatingPanelState;
  }

  const root = document.createElement("section");
  root.id = FLOAT_PANEL_ID;
  root.hidden = true;
  root.innerHTML = `
    <div class="whs-panel__header">
      <div class="whs-panel__titlewrap">
        <strong class="whs-panel__title">日报工时悬浮窗</strong>
        <span class="whs-panel__subtitle">拖动标题可移动</span>
      </div>
      <div class="whs-panel__tools">
        <button class="whs-panel__tool" data-action="collapse" type="button">收起</button>
        <button class="whs-panel__tool whs-panel__tool--close" data-action="close" type="button">关闭</button>
      </div>
    </div>
    <div class="whs-panel__body">
      <div class="whs-panel__dates">
        <label class="whs-panel__field">
          <span>开始</span>
          <input class="whs-panel__input" data-role="start" type="date">
        </label>
        <label class="whs-panel__field">
          <span>结束</span>
          <input class="whs-panel__input" data-role="end" type="date">
        </label>
      </div>
      <div class="whs-panel__actions">
        <button class="whs-panel__btn whs-panel__btn--ghost" data-action="fill-last" type="button">上月</button>
        <button class="whs-panel__btn whs-panel__btn--ghost" data-action="fill-current" type="button">当月</button>
        <button class="whs-panel__btn whs-panel__btn--primary" data-action="run" type="button">执行统计</button>
      </div>
      <p class="whs-panel__status" data-role="status">等待执行</p>
      <dl class="whs-panel__result whs-panel__result--empty" data-role="result">
        <div class="whs-panel__row"><dt>时间范围</dt><dd>暂无</dd></div>
        <div class="whs-panel__row"><dt>总工时</dt><dd>--</dd></div>
        <div class="whs-panel__row"><dt>出勤天数</dt><dd>--</dd></div>
        <div class="whs-panel__row"><dt>记录条数</dt><dd>--</dd></div>
      </dl>
    </div>
  `;

  document.body.append(root);

  floatingPanelState = {
    root,
    header: root.querySelector(".whs-panel__header"),
    body: root.querySelector(".whs-panel__body"),
    status: root.querySelector("[data-role='status']"),
    result: root.querySelector("[data-role='result']"),
    startInput: root.querySelector("[data-role='start']"),
    endInput: root.querySelector("[data-role='end']"),
    collapseButton: root.querySelector("[data-action='collapse']"),
    closeButton: root.querySelector("[data-action='close']"),
    fillLastButton: root.querySelector("[data-action='fill-last']"),
    fillCurrentButton: root.querySelector("[data-action='fill-current']"),
    runButton: root.querySelector("[data-action='run']"),
    collapsed: false,
    userMoved: false
  };

  bindFloatingPanelEvents(floatingPanelState);
  return floatingPanelState;
}

function ensureFloatingPanelStyles() {
  if (document.getElementById(FLOAT_PANEL_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = FLOAT_PANEL_STYLE_ID;
  style.textContent = `
    #${FLOAT_PANEL_ID} {
      position: fixed;
      top: 16px;
      left: 16px;
      width: 340px;
      border: 1px solid rgba(24, 53, 92, 0.18);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.97);
      box-shadow: 0 20px 50px rgba(24, 53, 92, 0.18);
      backdrop-filter: blur(10px);
      z-index: 2147483646;
      color: #18355c;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    }

    #${FLOAT_PANEL_ID}[hidden] {
      display: none !important;
    }

    #${FLOAT_PANEL_ID}.is-collapsed .whs-panel__body {
      display: none;
    }

    #${FLOAT_PANEL_ID}.is-dragging {
      user-select: none;
      cursor: grabbing;
    }

    #${FLOAT_PANEL_ID} .whs-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 12px;
      border-bottom: 1px solid rgba(24, 53, 92, 0.08);
      background: linear-gradient(135deg, rgba(234, 241, 255, 0.98) 0%, rgba(246, 250, 255, 0.98) 100%);
      border-radius: 18px 18px 0 0;
      cursor: grab;
    }

    #${FLOAT_PANEL_ID} .whs-panel__titlewrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    #${FLOAT_PANEL_ID} .whs-panel__title {
      font-size: 14px;
      line-height: 1.3;
    }

    #${FLOAT_PANEL_ID} .whs-panel__subtitle {
      font-size: 11px;
      color: #6a7c97;
    }

    #${FLOAT_PANEL_ID} .whs-panel__tools {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    #${FLOAT_PANEL_ID} button {
      border: 0;
      cursor: pointer;
      font-family: inherit;
    }

    #${FLOAT_PANEL_ID} .whs-panel__tool {
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      color: #31517d;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: inset 0 0 0 1px rgba(155, 179, 214, 0.42);
    }

    #${FLOAT_PANEL_ID} .whs-panel__tool--close {
      color: #8f2d2d;
    }

    #${FLOAT_PANEL_ID} .whs-panel__body {
      padding: 14px 16px 16px;
    }

    #${FLOAT_PANEL_ID} .whs-panel__dates {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    #${FLOAT_PANEL_ID} .whs-panel__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: #516884;
    }

    #${FLOAT_PANEL_ID} .whs-panel__input {
      height: 34px;
      padding: 0 10px;
      border: 1px solid #cfdbef;
      border-radius: 10px;
      background: #f9fbff;
      color: #18355c;
      font-size: 12px;
      outline: none;
    }

    #${FLOAT_PANEL_ID} .whs-panel__input:focus {
      border-color: #3d7dff;
      box-shadow: 0 0 0 3px rgba(61, 125, 255, 0.15);
    }

    #${FLOAT_PANEL_ID} .whs-panel__actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 12px;
    }

    #${FLOAT_PANEL_ID} .whs-panel__btn {
      height: 36px;
      border-radius: 11px;
      font-size: 12px;
      font-weight: 700;
      transition: transform 0.12s ease, opacity 0.12s ease;
    }

    #${FLOAT_PANEL_ID} .whs-panel__btn:hover:not(:disabled),
    #${FLOAT_PANEL_ID} .whs-panel__tool:hover:not(:disabled) {
      transform: translateY(-1px);
    }

    #${FLOAT_PANEL_ID} .whs-panel__btn:disabled,
    #${FLOAT_PANEL_ID} .whs-panel__tool:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    #${FLOAT_PANEL_ID} .whs-panel__btn--ghost {
      color: #21426b;
      background: linear-gradient(135deg, #eef4ff 0%, #e2edff 100%);
      box-shadow: inset 0 0 0 1px rgba(157, 180, 214, 0.55);
    }

    #${FLOAT_PANEL_ID} .whs-panel__btn--primary {
      color: #ffffff;
      background: linear-gradient(135deg, #1a73ff 0%, #3d8bff 100%);
      box-shadow: 0 10px 20px rgba(26, 115, 255, 0.25);
    }

    #${FLOAT_PANEL_ID} .whs-panel__status {
      min-height: 18px;
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.5;
      color: #54657d;
    }

    #${FLOAT_PANEL_ID} .whs-panel__status.is-loading {
      color: #1368ec;
    }

    #${FLOAT_PANEL_ID} .whs-panel__status.is-error {
      color: #b42318;
    }

    #${FLOAT_PANEL_ID} .whs-panel__status.is-warning {
      color: #b54708;
    }

    #${FLOAT_PANEL_ID} .whs-panel__result {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    #${FLOAT_PANEL_ID} .whs-panel__row {
      display: grid;
      grid-template-columns: 70px 1fr;
      gap: 10px;
      align-items: start;
    }

    #${FLOAT_PANEL_ID} .whs-panel__row dt,
    #${FLOAT_PANEL_ID} .whs-panel__row dd {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
    }

    #${FLOAT_PANEL_ID} .whs-panel__row dt {
      color: #637896;
    }

    #${FLOAT_PANEL_ID} .whs-panel__row dd {
      word-break: break-word;
      color: #18355c;
    }

    #${FLOAT_PANEL_ID} .whs-panel__result--empty dd {
      color: #91a0b4;
    }
  `;

  document.head.append(style);
}

function bindFloatingPanelEvents(panel) {
  panel.fillLastButton.addEventListener("click", () => applyFloatingPreset("lastMonth"));
  panel.fillCurrentButton.addEventListener("click", () => applyFloatingPreset("currentMonth"));
  panel.runButton.addEventListener("click", () => runFloatingPanelStatistics());
  panel.closeButton.addEventListener("click", () => hideFloatingPanel({ manual: true }));
  panel.collapseButton.addEventListener("click", () => toggleFloatingCollapse(panel));
  panel.startInput.addEventListener("change", () => persistCurrentFloatingPanelState());
  panel.endInput.addEventListener("change", () => persistCurrentFloatingPanelState());
  enableFloatingPanelDragging(panel);
  window.addEventListener("resize", () => keepFloatingPanelInViewport(panel));
}

function toggleFloatingCollapse(panel) {
  panel.collapsed = !panel.collapsed;
  panel.root.classList.toggle("is-collapsed", panel.collapsed);
  panel.collapseButton.textContent = panel.collapsed ? "展开" : "收起";

  if (!panel.userMoved) {
    const reportContext = findReportContext();
    if (reportContext?.state === "report") {
      positionFloatingPanel(panel, reportContext);
    }
  }

  persistCurrentFloatingPanelState();
}

function enableFloatingPanelDragging(panel) {
  let dragOffset = null;

  const handleMouseMove = (event) => {
    if (!dragOffset) {
      return;
    }

    const maxLeft = Math.max(12, window.innerWidth - panel.root.offsetWidth - 12);
    const maxTop = Math.max(12, window.innerHeight - panel.root.offsetHeight - 12);
    const nextLeft = clamp(event.clientX - dragOffset.x, 12, maxLeft);
    const nextTop = clamp(event.clientY - dragOffset.y, 12, maxTop);

    panel.root.style.left = `${nextLeft}px`;
    panel.root.style.top = `${nextTop}px`;
    panel.userMoved = true;
  };

  const handleMouseUp = () => {
    dragOffset = null;
    panel.root.classList.remove("is-dragging");
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    persistCurrentFloatingPanelState();
  };

  panel.header.addEventListener("mousedown", (event) => {
    if (event.target.closest("button, input, label")) {
      return;
    }

    const rect = panel.root.getBoundingClientRect();
    dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    panel.root.classList.add("is-dragging");
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    event.preventDefault();
  });
}

function showFloatingPanel(panel, reportContext) {
  panel.root.hidden = false;
  panel.root.style.visibility = "hidden";

  if (!panel.userMoved) {
    positionFloatingPanel(panel, reportContext);
  } else {
    keepFloatingPanelInViewport(panel);
  }

  panel.root.style.visibility = "";
}

function hideFloatingPanel({ manual = false } = {}) {
  if (!floatingPanelState?.root) {
    return;
  }

  floatingPanelState.root.hidden = true;

  if (manual) {
    chrome.storage.local.remove(FLOAT_PANEL_STORAGE_KEY);
  }
}

function syncPanelDateInputs(panel, reportContext) {
  const startInput = reportContext.reportDocument.querySelector("#start_time");
  const endInput = reportContext.reportDocument.querySelector("#end_time");

  if (!panel.startInput.value && startInput?.value) {
    panel.startInput.value = normalizeDateInputValue(startInput.value);
  }

  if (!panel.endInput.value && endInput?.value) {
    panel.endInput.value = normalizeDateInputValue(endInput.value);
  }

  if (!panel.startInput.value || !panel.endInput.value) {
    const range = getPresetRange("currentMonth");
    panel.startInput.value = range.startDate;
    panel.endInput.value = range.endDate;
  }
}

function positionFloatingPanel(panel, reportContext) {
  const formElement =
    reportContext.reportDocument.querySelector("form.form-inline") ||
    reportContext.reportDocument.querySelector("#main_div1 form") ||
    reportContext.reportDocument.querySelector("form");
  const iframeRect = reportContext.iframeElement.getBoundingClientRect();
  const formRect = formElement?.getBoundingClientRect();
  const panelWidth = panel.root.offsetWidth || 340;
  const panelHeight = panel.root.offsetHeight || 220;
  const minLeft = Math.max(12, iframeRect.left + 8);
  const maxLeft = Math.max(minLeft, Math.min(window.innerWidth - panelWidth - 12, iframeRect.right - panelWidth - 8));
  const referenceRight = formRect ? iframeRect.left + formRect.right : iframeRect.right - 12;
  const preferredLeft = referenceRight - panelWidth;
  const left = clamp(preferredLeft, minLeft, maxLeft);
  const preferredTop = formRect ? iframeRect.top + formRect.top - panelHeight - 12 : iframeRect.top + 8;
  const top = Math.max(12, preferredTop);

  panel.root.style.left = `${left}px`;
  panel.root.style.top = `${top}px`;
}

function keepFloatingPanelInViewport(panel) {
  if (panel.root.hidden) {
    return;
  }

  const rect = panel.root.getBoundingClientRect();
  const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
  const maxTop = Math.max(12, window.innerHeight - rect.height - 12);
  const left = clamp(rect.left, 12, maxLeft);
  const top = clamp(rect.top, 12, maxTop);

  panel.root.style.left = `${left}px`;
  panel.root.style.top = `${top}px`;
}

function applyFloatingPreset(type) {
  const panel = ensureFloatingPanel();
  const range = getPresetRange(type);
  panel.startInput.value = range.startDate;
  panel.endInput.value = range.endDate;
  setFloatingPanelStatus("已填入时间范围。");
  persistCurrentFloatingPanelState();
}

async function runFloatingPanelStatistics() {
  const panel = ensureFloatingPanel();
  const startDate = normalizeDateInputValue(panel.startInput.value);
  const endDate = normalizeDateInputValue(panel.endInput.value);

  if (!startDate || !endDate) {
    setFloatingPanelStatus("请输入开始和结束日期。", "error");
    return;
  }

  if (startDate > endDate) {
    setFloatingPanelStatus("开始日期不能晚于结束日期。", "error");
    return;
  }

  setFloatingPanelLoading(true);
  setFloatingPanelStatus("正在刷新页面并统计全部工时…", "loading");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_STATISTICS",
      startDate,
      endDate,
      activeTabUrl: window.location.href
    });

    if (!response?.ok) {
      throw new Error(response?.error || "统计失败。");
    }

    renderFloatingPanelResult(response.result);
    setFloatingPanelStatus(response.result.warning || "统计完成。", response.result.warning ? "warning" : "");

    if (!panel.userMoved) {
      const reportContext = findReportContext();
      if (reportContext?.state === "report") {
        positionFloatingPanel(panel, reportContext);
      }
    }

    persistCurrentFloatingPanelState();
  } catch (error) {
    setFloatingPanelStatus(error.message || "统计失败。", "error");
  } finally {
    setFloatingPanelLoading(false);
  }
}

function renderFloatingPanelResult(result) {
  const panel = ensureFloatingPanel();
  const rows = [
    renderFloatingPanelRow("时间范围", `${result.startDate} 至 ${result.endDate}`),
    renderFloatingPanelRow("总工时", formatHours(result.totalHours)),
    renderFloatingPanelRow("出勤天数", `${result.attendanceDayCount ?? 0} 天`),
    renderFloatingPanelRow("记录条数", `${result.rowCount} 条`),
    renderFloatingPanelRow("统计时间", formatDateTime(result.fetchedAt))
  ];

  if (result.invalidHourCount > 0) {
    rows.push(renderFloatingPanelRow("异常工时", `${result.invalidHourCount} 条已忽略`));
  }

  panel.result.classList.remove("whs-panel__result--empty");
  panel.result.innerHTML = rows.join("");
}

function renderFloatingPanelRow(label, value) {
  return `<div class="whs-panel__row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function setFloatingPanelStatus(message, type = "") {
  const panel = ensureFloatingPanel();
  panel.status.textContent = message;
  panel.status.className = "whs-panel__status";

  if (type) {
    panel.status.classList.add(`is-${type}`);
  }
}

function setFloatingPanelLoading(loading) {
  const panel = ensureFloatingPanel();
  panel.fillLastButton.disabled = loading;
  panel.fillCurrentButton.disabled = loading;
  panel.runButton.disabled = loading;
  panel.collapseButton.disabled = loading;
}

function getPresetRange(type) {
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (type === "lastMonth") {
    return {
      startDate: formatDate(new Date(current.getFullYear(), current.getMonth() - 1, 1)),
      endDate: formatDate(new Date(current.getFullYear(), current.getMonth(), 0))
    };
  }

  return {
    startDate: formatDate(new Date(current.getFullYear(), current.getMonth(), 1)),
    endDate: formatDate(current)
  };
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDateInputValue(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function restoreFloatingPanelOnLoad() {
  try {
    const { [FLOAT_PANEL_STORAGE_KEY]: storedState } = await chrome.storage.local.get(FLOAT_PANEL_STORAGE_KEY);

    if (!storedState?.visible) {
      return;
    }

    const reportContext = await ensureReportContextForPanel();
    const panel = ensureFloatingPanel();

    if (storedState.startDate) {
      panel.startInput.value = storedState.startDate;
    }

    if (storedState.endDate) {
      panel.endInput.value = storedState.endDate;
    }

    panel.collapsed = Boolean(storedState.collapsed);
    panel.root.classList.toggle("is-collapsed", panel.collapsed);
    panel.collapseButton.textContent = panel.collapsed ? "展开" : "收起";

    if (storedState.position && Number.isFinite(storedState.position.left) && Number.isFinite(storedState.position.top)) {
      panel.userMoved = true;
      panel.root.style.left = `${storedState.position.left}px`;
      panel.root.style.top = `${storedState.position.top}px`;
    }

    syncPanelDateInputs(panel, reportContext);
    showFloatingPanel(panel, reportContext);
    keepFloatingPanelInViewport(panel);
  } catch (_error) {
  }
}

function persistCurrentFloatingPanelState() {
  if (!floatingPanelState?.root || floatingPanelState.root.hidden) {
    return;
  }

  persistFloatingPanelState({
    visible: true,
    startDate: floatingPanelState.startInput.value,
    endDate: floatingPanelState.endInput.value,
    collapsed: floatingPanelState.collapsed,
    position: {
      left: parseFloat(floatingPanelState.root.style.left) || floatingPanelState.root.getBoundingClientRect().left,
      top: parseFloat(floatingPanelState.root.style.top) || floatingPanelState.root.getBoundingClientRect().top
    }
  });
}

async function persistFloatingPanelState(state) {
  try {
    await chrome.storage.local.set({
      [FLOAT_PANEL_STORAGE_KEY]: state
    });
  } catch (_error) {
  }
}
