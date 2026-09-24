type StatusSnapshot = {
  source: string;
  timeframe_label: string;
  fetched_at: string;
  quote: { quote_time: string | null };
};

export function terminalStatusTooltip(snapshot: StatusSnapshot | null): string {
  if (!snapshot) return "等待行情连接";
  const fetchedAt = new Date(snapshot.fetched_at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return [
    snapshot.source,
    snapshot.timeframe_label,
    `快照 ${fetchedAt}`,
    `报价 ${snapshot.quote.quote_time ?? "时间不可用"}`,
  ].join(" · ");
}
