const HOURS_COLUMN_NAME = "用时(H)";

export function parseWorkHours(html) {
  if (typeof html !== "string" || html.trim() === "") {
    throw new Error("日报页面响应为空。");
  }

  const parsedByDom = parseWithDom(html);
  if (parsedByDom) {
    return parsedByDom;
  }

  return parseWithRegex(html);
}

function parseWithDom(html) {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const table = document.querySelector("#maintable");

  if (!table) {
    return null;
  }

  const headers = Array.from(table.querySelectorAll("thead th, thead td"));
  const hoursIndex = findHoursColumnIndex(headers.map((cell) => cell.textContent));

  if (hoursIndex < 0) {
    throw new Error(`未找到“${HOURS_COLUMN_NAME}”列。`);
  }

  const rows = Array.from(table.querySelectorAll("tbody tr"));
  let totalHours = 0;
  let rowCount = 0;

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("th, td"));
    const hoursCell = cells[hoursIndex];

    if (!hoursCell) {
      continue;
    }

    const value = parseHourValue(hoursCell.textContent);
    if (value === null) {
      continue;
    }

    totalHours += value;
    rowCount += 1;
  }

  return buildResult(totalHours, rowCount);
}

function parseWithRegex(html) {
  const tableHtml = matchFirst(html, /<table\b[^>]*id=["']maintable["'][^>]*>[\s\S]*?<\/table>/i);

  if (!tableHtml) {
    throw new Error("未找到日报表格，可能未登录或页面结构已变化。");
  }

  const theadHtml = matchFirst(tableHtml, /<thead\b[^>]*>[\s\S]*?<\/thead>/i);
  const tbodyHtml = matchFirst(tableHtml, /<tbody\b[^>]*>[\s\S]*?<\/tbody>/i);

  if (!theadHtml || !tbodyHtml) {
    throw new Error("日报表格结构不完整。");
  }

  const headerCells = extractCells(theadHtml, "th").concat(extractCells(theadHtml, "td"));
  const hoursIndex = findHoursColumnIndex(headerCells.map(stripHtml));

  if (hoursIndex < 0) {
    throw new Error(`未找到“${HOURS_COLUMN_NAME}”列。`);
  }

  const rows = Array.from(tbodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  let totalHours = 0;
  let rowCount = 0;

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const cells = extractCells(rowHtml, "td").concat(extractCells(rowHtml, "th"));
    const cellHtml = cells[hoursIndex];

    if (!cellHtml) {
      continue;
    }

    const value = parseHourValue(stripHtml(cellHtml));
    if (value === null) {
      continue;
    }

    totalHours += value;
    rowCount += 1;
  }

  return buildResult(totalHours, rowCount);
}

function buildResult(totalHours, rowCount) {
  return {
    totalHours: Number(totalHours.toFixed(2)),
    rowCount
  };
}

function findHoursColumnIndex(headers) {
  return headers.findIndex((header) => normalizeText(header) === HOURS_COLUMN_NAME);
}

function parseHourValue(value) {
  const matched = normalizeText(value).match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : null;
}

function normalizeText(value) {
  return decodeEntities(String(value)).replace(/\s+/g, "").trim();
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

function decodeEntities(value) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}
