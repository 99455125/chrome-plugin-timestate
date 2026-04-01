const HOURS_COLUMN_NAME = "用时(H)";
const REPORT_DATE_COLUMN_NAME = "日报日期";
const PROJECT_NAME_COLUMN_NAME = "项目名称";
const REPORT_CATEGORY_COLUMN_NAME = "日报分类";
const REPORT_SUBCATEGORY_COLUMN_NAME = "分类子项";
const REPORT_CONTENT_COLUMN_NAME = "日报内容";
const SUBMITTED_AT_COLUMN_NAME = "提交时间";
const REVIEW_STATUS_COLUMN_NAME = "审核状态(人)";
const LOGIN_REQUIRED_ERROR = "当前会话可能已失效，请先登录考勤系统后重试。";
const MISSING_TABLE_ERROR = "未找到日报表格，页面结构可能已变化。";

export function parseWorkHours(html) {
  if (typeof html !== "string" || html.trim() === "") {
    throw new Error("日报页面响应为空。");
  }

  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");

    if (isLoginDocument(document)) {
      throw new Error(LOGIN_REQUIRED_ERROR);
    }

    const parsedByDom = parseTableWithDom(document);
    if (parsedByDom) {
      return parsedByDom;
    }

    throw new Error(MISSING_TABLE_ERROR);
  }

  return parseWithRegex(html);
}

function parseTableWithDom(document) {
  const table = document.querySelector("#maintable");

  if (!table) {
    return null;
  }

  const headers = Array.from(table.querySelectorAll("thead th, thead td"));
  const columnIndexes = resolveColumnIndexes(headers.map((cell) => cell.textContent));
  const hoursIndex = columnIndexes.hoursIndex;
  const reportDateIndex = columnIndexes.reportDateIndex;

  if (hoursIndex < 0) {
    throw new Error(`未找到“${HOURS_COLUMN_NAME}”列。`);
  }

  const rows = Array.from(table.querySelectorAll("tbody tr"));
  let totalHours = 0;
  let rowCount = 0;
  let invalidHourCount = 0;
  const invalidHourSamples = [];
  const attendanceDates = new Set();
  const dailyHoursMap = new Map();
  const reportEntries = [];

  rows.forEach((row, index) => {
    const cells = Array.from(row.querySelectorAll("th, td"));
    const hoursCell = cells[hoursIndex];
    const reportDateCell = cells[reportDateIndex];

    if (!hoursCell) {
      return;
    }

    const parsedValue = parseHourValue(hoursCell.textContent);
    if (parsedValue.value === null) {
      if (parsedValue.isInvalid) {
        invalidHourCount += 1;
        pushInvalidSample(invalidHourSamples, index + 1, hoursCell.textContent);
      }

      return;
    }

    totalHours += parsedValue.value;
    rowCount += 1;

    const reportDate = normalizeReportDate(reportDateCell?.textContent || "");
    if (reportDate) {
      attendanceDates.add(reportDate);
      dailyHoursMap.set(reportDate, Number(((dailyHoursMap.get(reportDate) || 0) + parsedValue.value).toFixed(2)));
    }

    reportEntries.push(buildReportEntry({
      rowNumber: index + 1,
      reportDate,
      hours: parsedValue.value,
      projectName: getDomCellValue(cells, columnIndexes.projectNameIndex),
      reportCategory: getDomCellValue(cells, columnIndexes.reportCategoryIndex),
      reportSubCategory: getDomCellValue(cells, columnIndexes.reportSubCategoryIndex),
      reportContent: getDomCellValue(cells, columnIndexes.reportContentIndex),
      submittedAt: getDomCellValue(cells, columnIndexes.submittedAtIndex),
      reviewStatus: getDomCellValue(cells, columnIndexes.reviewStatusIndex)
    }));
  });

  return buildResult(totalHours, rowCount, invalidHourCount, invalidHourSamples, attendanceDates, dailyHoursMap, reportEntries);
}

function parseWithRegex(html) {
  if (looksLikeLoginPage(html)) {
    throw new Error(LOGIN_REQUIRED_ERROR);
  }

  const tableHtml = matchFirst(html, /<table\b[^>]*id=["']maintable["'][^>]*>[\s\S]*?<\/table>/i);

  if (!tableHtml) {
    throw new Error(MISSING_TABLE_ERROR);
  }

  const theadHtml = matchFirst(tableHtml, /<thead\b[^>]*>[\s\S]*?<\/thead>/i);
  const tbodyHtml = matchFirst(tableHtml, /<tbody\b[^>]*>[\s\S]*?<\/tbody>/i);

  if (!theadHtml || !tbodyHtml) {
    throw new Error("日报表格结构不完整。");
  }

  const headerCells = extractCells(theadHtml, "th").concat(extractCells(theadHtml, "td"));
  const columnIndexes = resolveColumnIndexes(headerCells.map(stripHtml));
  const hoursIndex = columnIndexes.hoursIndex;
  const reportDateIndex = columnIndexes.reportDateIndex;

  if (hoursIndex < 0) {
    throw new Error(`未找到“${HOURS_COLUMN_NAME}”列。`);
  }

  const rows = Array.from(tbodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  let totalHours = 0;
  let rowCount = 0;
  let invalidHourCount = 0;
  const invalidHourSamples = [];
  const attendanceDates = new Set();
  const dailyHoursMap = new Map();
  const reportEntries = [];

  rows.forEach((rowMatch, index) => {
    const rowHtml = rowMatch[1];
    const cells = extractCells(rowHtml, "td").concat(extractCells(rowHtml, "th"));
    const cellHtml = cells[hoursIndex];
    const reportDateCellHtml = cells[reportDateIndex];

    if (!cellHtml) {
      return;
    }

    const parsedValue = parseHourValue(stripHtml(cellHtml));
    if (parsedValue.value === null) {
      if (parsedValue.isInvalid) {
        invalidHourCount += 1;
        pushInvalidSample(invalidHourSamples, index + 1, stripHtml(cellHtml));
      }

      return;
    }

    totalHours += parsedValue.value;
    rowCount += 1;

    const reportDate = normalizeReportDate(stripHtml(reportDateCellHtml || ""));
    if (reportDate) {
      attendanceDates.add(reportDate);
      dailyHoursMap.set(reportDate, Number(((dailyHoursMap.get(reportDate) || 0) + parsedValue.value).toFixed(2)));
    }

    reportEntries.push(buildReportEntry({
      rowNumber: index + 1,
      reportDate,
      hours: parsedValue.value,
      projectName: getRegexCellValue(cells, columnIndexes.projectNameIndex),
      reportCategory: getRegexCellValue(cells, columnIndexes.reportCategoryIndex),
      reportSubCategory: getRegexCellValue(cells, columnIndexes.reportSubCategoryIndex),
      reportContent: getRegexCellValue(cells, columnIndexes.reportContentIndex),
      submittedAt: getRegexCellValue(cells, columnIndexes.submittedAtIndex),
      reviewStatus: getRegexCellValue(cells, columnIndexes.reviewStatusIndex)
    }));
  });

  return buildResult(totalHours, rowCount, invalidHourCount, invalidHourSamples, attendanceDates, dailyHoursMap, reportEntries);
}

function buildResult(totalHours, rowCount, invalidHourCount, invalidHourSamples, attendanceDates, dailyHoursMap, reportEntries) {
  const result = {
    totalHours: Number(totalHours.toFixed(2)),
    rowCount,
    attendanceDayCount: attendanceDates.size,
    dailyHoursMap: Object.fromEntries(
      Array.from(dailyHoursMap.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    reportEntries: sortReportEntries(reportEntries),
    invalidHourCount,
    invalidHourSamples
  };

  if (invalidHourCount > 0) {
    result.warning = `发现 ${invalidHourCount} 条工时不是数值，统计时已忽略。`;
  }

  return result;
}

function resolveColumnIndexes(headers) {
  return {
    hoursIndex: findColumnIndex(headers, HOURS_COLUMN_NAME),
    reportDateIndex: findColumnIndex(headers, REPORT_DATE_COLUMN_NAME),
    projectNameIndex: findColumnIndex(headers, PROJECT_NAME_COLUMN_NAME),
    reportCategoryIndex: findColumnIndex(headers, REPORT_CATEGORY_COLUMN_NAME),
    reportSubCategoryIndex: findColumnIndex(headers, REPORT_SUBCATEGORY_COLUMN_NAME),
    reportContentIndex: findColumnIndex(headers, REPORT_CONTENT_COLUMN_NAME),
    submittedAtIndex: findColumnIndex(headers, SUBMITTED_AT_COLUMN_NAME),
    reviewStatusIndex: findColumnIndex(headers, REVIEW_STATUS_COLUMN_NAME)
  };
}

function findColumnIndex(headers, columnName) {
  return headers.findIndex((header) => normalizeText(header) === columnName);
}

function findHoursColumnIndex(headers) {
  return findColumnIndex(headers, HOURS_COLUMN_NAME);
}

function findReportDateColumnIndex(headers) {
  return findColumnIndex(headers, REPORT_DATE_COLUMN_NAME);
}

function parseHourValue(value) {
  const normalizedValue = normalizeText(value);

  if (normalizedValue === "") {
    return {
      value: null,
      isInvalid: false
    };
  }

  const matched = normalizedValue.match(/^-?\d+(?:\.\d+)?$/);

  return {
    value: matched ? Number(matched[0]) : null,
    isInvalid: !matched
  };
}

function normalizeText(value) {
  return decodeEntities(String(value)).replace(/\s+/g, "").trim();
}

function normalizeCellValue(value) {
  return decodeEntities(String(value)).replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " "));
}

function extractCells(html, tagName) {
  const matches = html.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi"));
  return Array.from(matches, (match) => match[1]);
}

function matchFirst(value, pattern) {
  return value.match(pattern)?.[0] || "";
}

function pushInvalidSample(samples, rowNumber, rawValue) {
  if (samples.length >= 3) {
    return;
  }

  const normalizedValue = stripHtml(rawValue).trim();
  samples.push(`第${rowNumber}行: ${normalizedValue || "(空值)"}`);
}

function normalizeReportDate(value) {
  const normalizedValue = normalizeCellValue(value);
  const matched = normalizedValue.match(/^\d{4}-\d{2}-\d{2}$/);
  return matched ? matched[0] : "";
}

function getDomCellValue(cells, index) {
  if (index < 0 || !cells[index]) {
    return "";
  }

  return normalizeCellValue(cells[index].textContent || "");
}

function getRegexCellValue(cells, index) {
  if (index < 0 || !cells[index]) {
    return "";
  }

  return normalizeCellValue(stripHtml(cells[index]));
}

function buildReportEntry(entry) {
  return {
    rowNumber: entry.rowNumber,
    reportDate: entry.reportDate,
    hours: Number(entry.hours.toFixed(2)),
    projectName: entry.projectName,
    reportCategory: entry.reportCategory,
    reportSubCategory: entry.reportSubCategory,
    reportContent: entry.reportContent,
    submittedAt: entry.submittedAt,
    reviewStatus: entry.reviewStatus
  };
}

function sortReportEntries(reportEntries) {
  return [...reportEntries].sort((left, right) => {
    const dateCompare = left.reportDate.localeCompare(right.reportDate);
    if (dateCompare !== 0) {
      return dateCompare;
    }

    const submitCompare = left.submittedAt.localeCompare(right.submittedAt);
    if (submitCompare !== 0) {
      return submitCompare;
    }

    return left.rowNumber - right.rowNumber;
  });
}

function isLoginDocument(document) {
  const titleText = normalizeText(document.title || "");
  const bodyText = normalizeText(document.body?.textContent || "");
  const hasPasswordInput = Boolean(document.querySelector("input[type='password']"));
  const hasLoginForm = Boolean(document.querySelector("form[action*='login'], form[id*='login'], form[name*='login']"));
  const hasUserField = Boolean(document.querySelector("input[name*='user'], input[id*='user'], input[name*='account'], input[name*='login']"));

  if (titleText.includes("登录") || titleText === "login") {
    return true;
  }

  return hasPasswordInput && (hasLoginForm || hasUserField || bodyText.includes("登录"));
}

function looksLikeLoginPage(html) {
  const normalizedText = normalizeText(stripHtml(html));
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = normalizeText(titleMatch?.[1] || "");
  const hasPasswordInput = /<input\b[^>]*type=["']password["']/i.test(html);
  const hasLoginForm = /<form\b[^>]*(action|id|name)=["'][^"']*login/i.test(html);
  const hasUserField = /<input\b[^>]*(name|id)=["'][^"']*(user|account|login)/i.test(html);

  if (titleText.includes("登录") || titleText === "login") {
    return true;
  }

  return hasPasswordInput && (hasLoginForm || hasUserField || normalizedText.includes("请登录") || normalizedText.includes("用户登录"));
}

function decodeEntities(value) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}
