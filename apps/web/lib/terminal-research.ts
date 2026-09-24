export function selectLinkedResearch<Trend extends { contract: string }, Report extends { contract: string }>(
  contract: string,
  trends: readonly Trend[],
  ctaContracts: readonly string[],
  report: Report | null,
) {
  return {
    trend: trends.find((item) => item.contract === contract) ?? null,
    ctaConfigured: ctaContracts.includes(contract),
    ctaReport: report?.contract === contract ? report : null,
  };
}

export function describeCtaReportProvenance(report: { snapshot_time: string | null }) {
  return report.snapshot_time
    ? `历史校验 · 数据截至 ${report.snapshot_time.slice(0, 10)}`
    : "历史校验 · 数据时点未记录";
}

export function terminalQuoteMode(snapshot: { data_mode: "LIVE" | "STATIC" | "WAITING"; quote: { status: string } } | null) {
  if (!snapshot) return "WAITING";
  return snapshot.data_mode === "LIVE" && snapshot.quote.status !== "LIVE" ? "STATIC" : snapshot.data_mode;
}
