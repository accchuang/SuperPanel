import type { MarketTimeframe } from "./api";
import type { SubchartMode } from "./terminal-preferences";

export type TerminalLayout = {
  id: string;
  name: string;
  contract: string;
  timeframe: MarketTimeframe;
  subchartMode: SubchartMode;
  channelVisible: boolean;
  contextVisible: boolean;
};

export type TerminalEvent = {
  id: string;
  kind: "channel" | "volume" | "oi" | "trend";
  title: string;
  detail: string;
  time: string;
};

type EventBar = {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  oi_change?: number | null;
  is_closed: boolean;
};

export const TERMINAL_LAYOUTS_KEY = "market-terminal.layouts.v1";

const TREND_LABELS: Record<string, string> = {
  CONFIRMED_STEADY_UP: "稳步上行",
  CONFIRMED_STEADY_DOWN: "稳步下行",
  UPTREND_PULLBACK: "上升趋势回踩",
  DOWNTREND_PULLBACK: "下跌趋势反弹",
  UPTREND_CONTINUATION: "上升趋势延续",
  DOWNTREND_CONTINUATION: "下跌趋势延续",
  UPTREND_CONSOLIDATION: "上升趋势整理",
  DOWNTREND_CONSOLIDATION: "下跌趋势整理",
  VOLUME_OI_RISING: "量仓增强",
  STEADY_UP: "稳步上行",
  STEADY_DOWN: "稳步下行",
  OBSERVE: "观察",
  DATA_INCOMPLETE: "数据不足",
};

export function trendClassificationLabel(value: string) {
  return TREND_LABELS[value] ?? value;
}

export function resolveTerminalLayouts(raw: string | null, contracts: readonly string[], timeframes: readonly MarketTimeframe[]): TerminalLayout[] {
  if (!raw) return [];
  try {
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((entry): TerminalLayout[] => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.contract !== "string" || !contracts.includes(value.contract)) return [];
      if (typeof value.timeframe !== "string" || !timeframes.includes(value.timeframe as MarketTimeframe)) return [];
      return [{
        id: value.id,
        name: value.name.slice(0, 32),
        contract: value.contract,
        timeframe: value.timeframe as MarketTimeframe,
        subchartMode: value.subchartMode === "volume" ? "volume" : "oi",
        channelVisible: value.channelVisible !== false,
        contextVisible: value.contextVisible !== false,
      }];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

function exponentialAverage(values: number[], period: number) {
  const alpha = 2 / (period + 1);
  return values.reduce<number[]>((result, value, index) => {
    result.push(index ? value * alpha + result[index - 1] * (1 - alpha) : value);
    return result;
  }, []);
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function detectTerminalEvents(input: EventBar[], trendEvent?: TerminalEvent | null): TerminalEvent[] {
  const bars = input.filter((bar) => bar.is_closed && Number.isFinite(bar.close));
  const events: TerminalEvent[] = [];
  const latest = bars.at(-1);
  if (!latest) return trendEvent ? [trendEvent] : [];

  if (bars.length >= 60) {
    const ranges = bars.map((bar, index) => {
      const high = bar.high ?? bar.close;
      const low = bar.low ?? bar.close;
      if (!index) return high - low;
      const previousClose = bars[index - 1].close;
      return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    });
    const upper = exponentialAverage(bars.map((bar) => bar.high ?? bar.close), 45).at(-1)! + exponentialAverage(ranges, 60).at(-1)! * 1.5;
    const lower = exponentialAverage(bars.map((bar) => bar.low ?? bar.close), 45).at(-1)! - exponentialAverage(ranges, 60).at(-1)! * 1.5;
    if (latest.close > upper) events.push({ id: `channel-up:${latest.time}`, kind: "channel", title: "收盘站上 ATR 通道", detail: `收盘 ${latest.close} · 上轨 ${upper.toFixed(2)}`, time: latest.time });
    else if (latest.close < lower) events.push({ id: `channel-down:${latest.time}`, kind: "channel", title: "收盘跌破 ATR 通道", detail: `收盘 ${latest.close} · 下轨 ${lower.toFixed(2)}`, time: latest.time });
  }

  const previous = bars.slice(-21, -1);
  const previousVolumes = previous.map((bar) => bar.volume).filter((value): value is number => value != null && value > 0);
  const volumeBaseline = median(previousVolumes);
  if (previousVolumes.length === 20 && latest.volume != null && volumeBaseline != null && volumeBaseline > 0 && latest.volume / volumeBaseline >= 2) {
    events.push({ id: `volume:${latest.time}`, kind: "volume", title: "成交量明显放大", detail: `最新 ${latest.volume.toLocaleString("zh-CN")} 手 · 前20根中位数 ${volumeBaseline.toLocaleString("zh-CN")} 手 · ${(latest.volume / volumeBaseline).toFixed(1)}×`, time: latest.time });
  }

  const previousOi = previous.map((bar) => bar.oi_change).filter((value): value is number => value != null).map(Math.abs);
  const oiBaseline = median(previousOi);
  if (previousOi.length === 20 && latest.oi_change != null && oiBaseline != null && oiBaseline > 0 && Math.abs(latest.oi_change) / oiBaseline >= 2) {
    events.push({ id: `oi:${latest.time}`, kind: "oi", title: "持仓变化明显放大", detail: `最新 ${latest.oi_change > 0 ? "+" : ""}${latest.oi_change.toLocaleString("zh-CN")} 手 · 前20根绝对变化中位数 ${oiBaseline.toLocaleString("zh-CN")} 手`, time: latest.time });
  }

  if (trendEvent) events.push(trendEvent);
  return events.slice(0, 4);
}
