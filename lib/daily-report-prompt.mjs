function buildEntryLine(entry) {
  const parts = [];

  if (entry.projectName) {
    parts.push(`项目=${entry.projectName}`);
  }

  const categoryParts = [entry.reportCategory, entry.reportSubCategory].filter(Boolean);
  if (categoryParts.length > 0) {
    parts.push(`分类=${categoryParts.join(" / ")}`);
  }

  if (entry.reportContent) {
    parts.push(`内容=${entry.reportContent}`);
  }

  if (Number.isFinite(Number(entry.hours))) {
    parts.push(`投入=${Number(entry.hours)}h`);
  }

  return `- ${parts.join("；")}`;
}

function groupEntriesByDate(reportEntries) {
  const entriesByDate = new Map();

  for (const entry of reportEntries || []) {
    const dateKey = entry.reportDate || "未标注日期";

    if (!entriesByDate.has(dateKey)) {
      entriesByDate.set(dateKey, []);
    }

    entriesByDate.get(dateKey).push(entry);
  }

  return entriesByDate;
}

export function buildAiSummaryPrompt(result) {
  if (!result || typeof result !== "object") {
    throw new Error("缺少统计结果，无法生成 AI 汇总提示词。");
  }

  const reportEntries = Array.isArray(result.reportEntries) ? result.reportEntries : [];
  const groupedEntries = groupEntriesByDate(reportEntries);
  const detailBlock = groupedEntries.size > 0
    ? Array.from(groupedEntries.entries())
      .map(([reportDate, entries]) => [
        reportDate,
        ...entries.map(buildEntryLine)
      ].join("\n"))
      .join("\n\n")
    : "统计区间内没有日报记录。";

  return [
    "你是一名中文研发月报/阶段总结助手。请直接输出一份可提交的工作总结成品。",
    "",
    "输出要求：",
    "1. 严格依据提供的数据，不要虚构项目、成果、风险、会议或不存在的职责边界。",
    "2. 开头总述只概括本月做了什么，聚焦工作方向、阶段成果和业务价值，不要写时间范围、工时、出勤、考勤、记录条数等信息。",
    "3. 结构要求：总述之后，再按 3 到 8 个主题归纳，每个主题使用“1.主题名称”这种编号，主题下再用“(1)(2)”展开具体成果。",
    "4. 正文只体现工作内容、产出成果、问题解决、协作推进、业务价值和个人贡献，不要出现工时、出勤天数、考勤、记录统计等信息。",
    "5. 主题要尽量按项目方向、工作方向或问题域归并，例如功能设计开发、性能优化、问题修复、联调测试、文档沉淀、会议推进等，避免简单按日期罗列。",
    "6. 每个主题下的内容要写出动作、对象和结果，语言务实、自然，像研发同学自己写的总结，不要出现来源说明、模型身份说明或套话。",
    "7. 可以合并相近日报，但不能遗漏关键动作；优先保留项目名、模块名、改造点、优化点、设计点、问题点、结果点。",
    "8. 主题数量不少于 3 个、不多于 8 个；如果原始记录较集中，就按功能开发、优化改造、问题排查、联调测试、设计沉淀、协作推进等角度拆分归纳，但不能虚构不存在的事实。",
    "9. 若没有数据，就明确写“本周期暂无有效日报记录”。",
    "10. 记录中的投入时长仅用于帮助你判断工作重心和投入程度，不能在最终成品中直接写出。",
    "11. 直接输出成品，不要解释写作思路，不要使用 Markdown 表格。",
    "",
    "工作记录：",
    detailBlock
  ].join("\n");
}
