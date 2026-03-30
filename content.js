(function bootstrapContentScript() {
  if (window.__workHoursStatsContentScriptLoaded) {
    return;
  }

  window.__workHoursStatsContentScriptLoaded = true;
  console.debug("[work-hours-stats] content script ready");

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "RUN_STATISTICS_IN_PAGE") {
      return undefined;
    }

    runStatisticsInPage(message)
      .then((html) => sendResponse({ ok: true, html }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });
})();

async function runStatisticsInPage({ startDate, endDate }) {
  const reportContext = findReportContext();

  if (!reportContext) {
    throw new Error("未找到主页面中的日报 iframe，请先进入包含“我的日报”的系统主页。");
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

  if (!reportDocument || !reportWindow || !isReportDocument(reportDocument)) {
    return null;
  }

  return {
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

  if (!loadedDocument.querySelector("#maintable")) {
    throw new Error("iframe 已刷新，但未找到日报表格。");
  }

  return loadedDocument;
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
