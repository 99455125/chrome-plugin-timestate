import { buildAiSummaryPrompt } from "./daily-report-prompt.mjs";
import { parseWorkHours } from "./report-parser.mjs";

const REPORT_PATH = "/daily_report/my_report.jsp";
const FETCH_TIMEOUT_MS = 15000;

export async function fetchReportHtml({ origin, startDate, endDate, fetchImpl = fetch }) {
  if (!origin) {
    throw new Error("缺少系统地址。");
  }

  const url = new URL(REPORT_PATH, origin).toString();
  const body = new URLSearchParams({
    start_time: startDate,
    end_time: endDate,
    search: "搜索"
  });

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      credentials: "include",
      cache: "no-store",
      body: body.toString(),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("请求 my_report.jsp 超时。");
    }

    throw error;
  } finally {
    clearTimeout(timerId);
  }

  if (!response.ok) {
    throw new Error(`请求 my_report.jsp 失败: HTTP ${response.status}`);
  }

  return response.text();
}

export async function runStatistics({ origin, startDate, endDate, fetchImpl = fetch }) {
  if (!startDate || !endDate) {
    throw new Error("开始时间和结束时间不能为空。");
  }

  const endpoint = new URL(REPORT_PATH, origin).toString();
  const html = await fetchReportHtml({
    origin,
    startDate,
    endDate,
    fetchImpl
  });

  const parsed = parseWorkHours(html);

  return {
    ...parsed,
    aiSummaryPrompt: buildAiSummaryPrompt({
      ...parsed,
      startDate,
      endDate
    }),
    startDate,
    endDate,
    endpoint,
    fetchedAt: new Date().toISOString()
  };
}
