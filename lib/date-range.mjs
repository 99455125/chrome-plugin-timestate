function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getPresetRange(type, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (type === "currentMonth") {
    return {
      startDate: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      endDate: formatDate(today)
    };
  }

  if (type === "lastMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);

    return {
      startDate: formatDate(start),
      endDate: formatDate(end)
    };
  }

  throw new Error(`不支持的时间范围类型: ${type}`);
}
