import type { MarketTimeframe } from "./api";
import type { Time, UTCTimestamp } from "lightweight-charts";

export type ChartTime = Time;

const DATE_ONLY_TIMEFRAMES: readonly MarketTimeframe[] = ["1d", "3d"];

function validDatePart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function terminalChartTime(value: string, timeframe: MarketTimeframe): ChartTime | null {
  const normalized = value.trim().replace(" ", "T");
  const datePart = normalized.slice(0, 10);
  if (!validDatePart(datePart)) return null;
  if (DATE_ONLY_TIMEFRAMES.includes(timeframe)) return datePart;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return Math.round(Date.UTC(year, month - 1, day, hour, minute, second) / 1000) as UTCTimestamp;
}
