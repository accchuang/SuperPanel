import type { MarketTimeframe } from "./api";

export type TradingSessionSpan = {
  kind: "day" | "night";
  tradingDate: string;
  startTime: string;
  endTime: string;
};

type BarTime = { time: string };

function tradingSession(time: string): { kind: TradingSessionSpan["kind"]; tradingDate: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):\d{2}:\d{2}$/.exec(time.trim());
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const h = Number(hour);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;

  if (h >= 20 || h < 3) {
    if (h >= 20) date.setUTCDate(date.getUTCDate() + 1);
    return { kind: "night", tradingDate: date.toISOString().slice(0, 10) };
  }
  if (h >= 8 && h < 16) return { kind: "day", tradingDate: date.toISOString().slice(0, 10) };
  return null;
}

export function buildTradingSessionSpans(bars: BarTime[], timeframe: MarketTimeframe): TradingSessionSpan[] {
  if (timeframe === "1d" || timeframe === "3d") return [];
  const spans: TradingSessionSpan[] = [];
  for (const bar of bars) {
    const session = tradingSession(bar.time);
    if (!session) continue;
    const last = spans.at(-1);
    if (last && last.kind === session.kind && last.tradingDate === session.tradingDate) {
      last.endTime = bar.time;
    } else {
      spans.push({ ...session, startTime: bar.time, endTime: bar.time });
    }
  }
  return spans;
}
