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
    throw new Error("未找到 my_report.jsp 页面或主页面内的日报 iframe。");
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

  if (iframeElement) {
    const loadedDocument = await submitSearchInIframe({
      iframeElement,
      reportWindow,
      searchButton
    });

    return loadedDocument.documentElement.outerHTML;
  }

  const html = await postReportWithinPage({
    reportWindow,
    startDate,
    endDate
  });

  return html;
}

function findReportContext() {
  if (isReportDocument(document)) {
    return {
      reportWindow: window,
      reportDocument: document,
      iframeElement: null
    };
  }

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

async function postReportWithinPage({ reportWindow, startDate, endDate }) {
  const url = new URL("/daily_report/my_report.jsp", reportWindow.location.origin).toString();
  const body = new URLSearchParams({
    start_time: startDate,
    end_time: endDate,
    search: "搜索"
  });

  const response = await reportWindow.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    credentials: "include",
    cache: "no-store",
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`页面内请求失败: HTTP ${response.status}`);
  }

  return response.text();
}
