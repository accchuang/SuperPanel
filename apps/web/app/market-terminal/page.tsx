"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import { Archive, ArrowLeftRight, CandlestickChart, CircleAlert, PanelRightClose, PanelRightOpen, RefreshCw, Search, Save, Wifi, WifiOff } from "lucide-react";
import { api, type CtaReport, type LiveQuote, type MarketTimeframe, type TerminalQuote, type TrendTracker, type WatchlistQuote } from "@/lib/api";
import { resolveTerminalPreferences, TERMINAL_PREFERENCES_KEY, type SubchartMode } from "@/lib/terminal-preferences";
import { terminalChartTime, type ChartTime } from "@/lib/terminal-time";
import { buildTradingSessionSpans } from "@/lib/trading-sessions";
import { TradingSessionBackground, TRADING_SESSION_BACKGROUND_COLORS } from "@/lib/trading-session-background";
import { buildBarExtremeMarkers, rankRecentBarExtremes, rankRecentOpenInterestChanges, type RankedBarExtreme } from "@/lib/bar-extremes";
import { formatNumber } from "@/lib/utils";
import { describeCtaReportProvenance, selectLinkedResearch, terminalQuoteMode } from "@/lib/terminal-research";
import { EMPTY_BLUEPRINT, resolveTerminalBlueprints, TERMINAL_BLUEPRINTS_KEY, updateTerminalBlueprint, type TerminalBlueprint } from "@/lib/terminal-blueprints";
import { detectTerminalEvents, resolveTerminalLayouts, TERMINAL_LAYOUTS_KEY, trendClassificationLabel, type TerminalEvent, type TerminalLayout } from "@/lib/terminal-workspace";

const CONTRACTS = [
  { contract: "P2701", name: "棕榈油", exchange: "DCE", sector: "油脂油料" },
  { contract: "OI2701", name: "菜籽油", exchange: "CZCE", sector: "油脂油料" },
  { contract: "Y2701", name: "豆油", exchange: "DCE", sector: "油脂油料" },
  { contract: "LH2611", name: "生猪", exchange: "DCE", sector: "农产品" },
  { contract: "JD2611", name: "鸡蛋", exchange: "DCE", sector: "农产品" },
  { contract: "SR2701", name: "白糖", exchange: "CZCE", sector: "农产品" },
  { contract: "CF2701", name: "棉花", exchange: "CZCE", sector: "农产品" },
  { contract: "M2701", name: "豆粕", exchange: "DCE", sector: "油脂油料" },
  { contract: "A2611", name: "豆一", exchange: "DCE", sector: "油脂油料" },
  { contract: "B2611", name: "豆二", exchange: "DCE", sector: "油脂油料" },
  { contract: "V2701", name: "PVC", exchange: "DCE", sector: "化工" },
  { contract: "TA2701", name: "PTA", exchange: "CZCE", sector: "化工" },
  { contract: "EB2611", name: "苯乙烯", exchange: "DCE", sector: "化工" },
  { contract: "MA2610", name: "甲醇", exchange: "CZCE", sector: "化工" },
  { contract: "RU2701", name: "天然橡胶", exchange: "SHFE", sector: "橡胶" },
  { contract: "NR2611", name: "20号胶", exchange: "INE", sector: "橡胶" },
  { contract: "BR2611", name: "丁二烯橡胶", exchange: "SHFE", sector: "橡胶" },
] as const;

const TIMEFRAMES: { value: MarketTimeframe; label: string }[] = [
  { value: "15m", label: "15 分钟" },
  { value: "30m", label: "30 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "1d", label: "日线" },
  { value: "3d", label: "3 日 K" },
];

const CHART_BACKGROUND = "#FFFFFF";
const CHART_GRID = "#EDF0F2";
const CHART_TEXT = "#687582";
const CHART_BORDER = "#D8E0E6";
const UP = "#E8EFF2";
const DOWN = "#87949B";
const BREAKOUT_UP = "#4F7180";
const BREAKOUT_DOWN = "#4F5A61";
const SUBCHART_UP = "#78929E";
const SUBCHART_DOWN = "#B5AEA3";

function signed(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function chartOptions(height: number) {
  return {
    width: 0,
    height,
    layout: {
      background: { type: ColorType.Solid, color: CHART_BACKGROUND },
      textColor: CHART_TEXT,
      fontFamily: "Arial, sans-serif",
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: CHART_GRID },
      horzLines: { color: CHART_GRID },
    },
    rightPriceScale: { borderColor: CHART_BORDER, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: CHART_BORDER, timeVisible: true, secondsVisible: false, rightOffset: 40 },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#95A0AA", width: 1, style: 2 }, horzLine: { color: "#95A0AA", width: 1, style: 2 } },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  } as const;
}

type ChartState = {
  priceChart: IChartApi;
  subchartChart: IChartApi;
  candleSeries: ISeriesApi<"Candlestick">;
  ma20Series: ISeriesApi<"Line">;
  ma60Series: ISeriesApi<"Line">;
  channelUpperSeries: ISeriesApi<"Line">;
  channelLowerSeries: ISeriesApi<"Line">;
  channelMiddleSeries: ISeriesApi<"Line">;
  subchartSeries: ISeriesApi<"Histogram">;
  extremeMarkers: ISeriesMarkersPluginApi<ChartTime>;
  subchartExtremeMarkers: ISeriesMarkersPluginApi<ChartTime>;
  priceSessionBackground: TradingSessionBackground;
  subchartSessionBackground: TradingSessionBackground;
};

type CandlePoint = {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
  borderColor?: string;
  wickColor?: string;
};

type ChannelLinePoint = { time: ChartTime; value: number };

function movingAverage(candles: CandlePoint[], period: number) {
  if (candles.length < period) return [];
  return candles.slice(period - 1).map((candle, index) => ({
    time: candle.time,
    value: candles.slice(index, index + period).reduce((total, item) => total + item.close, 0) / period,
  }));
}

function exponentialAverage(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  return values.reduce<number[]>((average, value, index) => {
    average.push(index === 0 ? value : value * multiplier + average[index - 1] * (1 - multiplier));
    return average;
  }, []);
}

function adaptiveChannel(candles: CandlePoint[]) {
  const trueRanges = candles.map((candle, index) => {
    const range = candle.high - candle.low;
    if (index === 0) return range;
    const previousClose = candles[index - 1].close;
    return Math.max(range, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  const highAverage = exponentialAverage(candles.map((candle) => candle.high), 45);
  const lowAverage = exponentialAverage(candles.map((candle) => candle.low), 45);
  const averageTrueRange = exponentialAverage(trueRanges, 60);

  return candles.map((candle, index) => {
    const bandWidth = averageTrueRange[index] * 1.5;
    const upper = highAverage[index] + bandWidth;
    const lower = lowAverage[index] - bandWidth;
    return {
      upper: { time: candle.time, value: upper } satisfies ChannelLinePoint,
      lower: { time: candle.time, value: lower } satisfies ChannelLinePoint,
      middle: { time: candle.time, value: (upper + lower) / 2 } satisfies ChannelLinePoint,
    };
  });
}

function TerminalCharts({
  quote,
  subchartMode,
  onSubchartModeChange,
  channelVisible,
  onChannelVisibleChange,
}: {
  quote: LiveQuote;
  subchartMode: SubchartMode;
  onSubchartModeChange: (mode: SubchartMode) => void;
  channelVisible: boolean;
  onChannelVisibleChange: (visible: boolean) => void;
}) {
  const priceContainer = useRef<HTMLDivElement>(null);
  const subchartContainer = useRef<HTMLDivElement>(null);
  const state = useRef<ChartState | null>(null);
  const extremeBarsByTime = useRef(new Map<ChartTime, RankedBarExtreme>());
  const initialized = useRef(false);
  const [hoveredExtreme, setHoveredExtreme] = useState<{
    bar: RankedBarExtreme;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!priceContainer.current || !subchartContainer.current) return;
    initialized.current = false;
    const priceChart = createChart(priceContainer.current, chartOptions(priceContainer.current.clientHeight));
    const subchartChart = createChart(subchartContainer.current, chartOptions(subchartContainer.current.clientHeight));
    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: "#6E8794",
      borderDownColor: "#74818A",
      wickUpColor: "#6E8794",
      wickDownColor: "#74818A",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const extremeMarkers = createSeriesMarkers(candleSeries, [], { autoScale: false, zOrder: "aboveSeries" });
    const ma20Series = priceChart.addSeries(LineSeries, {
      color: "#B88947",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    const ma60Series = priceChart.addSeries(LineSeries, {
      color: "#817A9F",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    const channelUpperSeries = priceChart.addSeries(LineSeries, {
      color: "#6F929A",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const channelLowerSeries = priceChart.addSeries(LineSeries, {
      color: "#6F929A",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const channelMiddleSeries = priceChart.addSeries(LineSeries, {
      color: "#ADB8BE",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const subchartSeries = subchartChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: true,
      base: 0,
    });
    const subchartExtremeMarkers = createSeriesMarkers(subchartSeries, [], { autoScale: false, zOrder: "aboveSeries" });
    const priceSessionBackground = new TradingSessionBackground("15m");
    const subchartSessionBackground = new TradingSessionBackground("15m");
    candleSeries.attachPrimitive(priceSessionBackground);
    subchartSeries.attachPrimitive(subchartSessionBackground);
    state.current = {
      priceChart,
      subchartChart,
      candleSeries,
      ma20Series,
      ma60Series,
      channelUpperSeries,
      channelLowerSeries,
      channelMiddleSeries,
      subchartSeries,
      extremeMarkers,
      subchartExtremeMarkers,
      priceSessionBackground,
      subchartSessionBackground,
    };

    let syncing = false;
    const syncPriceRange = (range: LogicalRange | null) => {
      if (!range || syncing) return;
      syncing = true;
      subchartChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    const syncSubchartRange = (range: LogicalRange | null) => {
      if (!range || syncing) return;
      syncing = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(syncPriceRange);
    subchartChart.timeScale().subscribeVisibleLogicalRangeChange(syncSubchartRange);
    const handleCrosshairMove = (param: Parameters<IChartApi["subscribeCrosshairMove"]>[0] extends (event: infer Event) => void ? Event : never) => {
      if (!param.point || param.time == null) {
        setHoveredExtreme(null);
        return;
      }
      const bar = extremeBarsByTime.current.get(param.time as ChartTime);
      setHoveredExtreme(bar ? { bar, x: param.point.x, y: param.point.y } : null);
    };
    priceChart.subscribeCrosshairMove(handleCrosshairMove);

    const resize = () => {
      if (!priceContainer.current || !subchartContainer.current) return;
      priceChart.applyOptions({ width: priceContainer.current.clientWidth, height: priceContainer.current.clientHeight });
      subchartChart.applyOptions({ width: subchartContainer.current.clientWidth, height: subchartContainer.current.clientHeight });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(priceContainer.current);
    observer.observe(subchartContainer.current);
    resize();

    return () => {
      observer.disconnect();
      priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncPriceRange);
      subchartChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncSubchartRange);
      priceChart.unsubscribeCrosshairMove(handleCrosshairMove);
      extremeMarkers.detach();
      subchartExtremeMarkers.detach();
      candleSeries.detachPrimitive(priceSessionBackground);
      subchartSeries.detachPrimitive(subchartSessionBackground);
      priceChart.remove();
      subchartChart.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const current = state.current;
    if (!current) return;
    const bars = quote.bars?.length ? quote.bars : quote.daily_bars ?? [];
    extremeBarsByTime.current.clear();
    const rankedExtremes = rankRecentBarExtremes(bars);
    for (const ranked of rankedExtremes) {
      const time = terminalChartTime(ranked.time, quote.timeframe);
      if (time != null) extremeBarsByTime.current.set(time, ranked);
    }
    const markers = buildBarExtremeMarkers(rankedExtremes).flatMap((marker) => {
      const time = terminalChartTime(marker.time, quote.timeframe);
      if (time == null) return [];
      return [
        {
          time,
          position: marker.kind === "volume" ? "aboveBar" as const : "belowBar" as const,
          shape: "circle" as const,
          color: marker.kind === "volume" ? "#365F72" : "#916526",
          size: 1.5,
        },
      ];
    });
    current.extremeMarkers.setMarkers(markers);
    const oiExtremes = subchartMode === "oi" ? rankRecentOpenInterestChanges(bars) : [];
    current.subchartExtremeMarkers.setMarkers(oiExtremes.flatMap((marker) => {
      const time = terminalChartTime(marker.time, quote.timeframe);
      if (time == null) return [];
      return [{
        time,
        position: "aboveBar" as const,
        shape: marker.change >= 0 ? "arrowUp" as const : "arrowDown" as const,
        color: marker.change >= 0 ? "#365F72" : "#805A3D",
        size: 1.5,
      }];
    }));
    if (!markers.length) setHoveredExtreme(null);
    const sessionSpans = buildTradingSessionSpans(bars, quote.timeframe);
    current.priceSessionBackground.setSpans(sessionSpans, quote.timeframe);
    current.subchartSessionBackground.setSpans(sessionSpans, quote.timeframe);
    const candles: CandlePoint[] = bars.flatMap((bar) => {
      const time = terminalChartTime(bar.time, quote.timeframe);
      if (time == null) return [];
      const close = bar.close;
      return [{
        time,
        open: bar.open ?? close,
        high: bar.high ?? close,
        low: bar.low ?? close,
        close,
      }];
    });
    const ma20 = movingAverage(candles, 20);
    const ma60 = movingAverage(candles, 60);
    const channel = adaptiveChannel(candles);
    const highlightedCandles = channelVisible
      ? candles.map((candle, index) => {
          const bounds = channel[index];
          if (candle.close > bounds.upper.value && candle.close > candle.open) {
            return { ...candle, borderColor: BREAKOUT_UP, wickColor: BREAKOUT_UP };
          }
          if (candle.close < bounds.lower.value && candle.close < candle.open) {
            return { ...candle, borderColor: BREAKOUT_DOWN, wickColor: BREAKOUT_DOWN };
          }
          return candle;
        })
      : candles;
    const subchart = bars.flatMap((bar) => {
      const time = terminalChartTime(bar.time, quote.timeframe);
      if (time == null) return [];
      if (subchartMode === "oi") {
        const value = bar.oi_change ?? 0;
        return [{ time, value, color: value >= 0 ? SUBCHART_UP : SUBCHART_DOWN }];
      }
      const value = bar.volume ?? 0;
      const isUpCandle = bar.close >= (bar.open ?? bar.close);
      return [{ time, value, color: isUpCandle ? SUBCHART_UP : SUBCHART_DOWN }];
    });
    current.candleSeries.setData(highlightedCandles);
    current.ma20Series.setData(ma20);
    current.ma60Series.setData(ma60);
    current.channelUpperSeries.setData(channelVisible ? channel.map((point) => point.upper) : []);
    current.channelLowerSeries.setData(channelVisible ? channel.map((point) => point.lower) : []);
    current.channelMiddleSeries.setData(channelVisible ? channel.map((point) => point.middle) : []);
    current.subchartSeries.setData(subchart);
    if (!initialized.current && candles.length) {
      const visibleBars = Math.min(candles.length, 40);
      const rightPadding = visibleBars;
      current.priceChart.timeScale().setVisibleLogicalRange({
        from: candles.length - visibleBars - 0.5,
        to: candles.length - 0.5 + rightPadding,
      });
      initialized.current = true;
    }
  }, [quote, channelVisible, subchartMode]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#DDE3E8] bg-white">
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#E5E9ED] bg-[#FCFDFE] px-2 text-[11px] text-[#75818C]">
          <span className="flex items-center gap-2">
            <span>价格 / K线</span>
            <span className="inline-flex items-center gap-1.5 text-[10px]">
              <span>近45根</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#365F72]" />量</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#916526]" />实体</span>
            </span>
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={channelVisible}
              title="EMA(最高/最低, 45) ± EMA(TR, 60) × 1.5；突破K线加亮边框"
              onClick={() => onChannelVisibleChange(!channelVisible)}
              className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${channelVisible ? "text-[#5E828C] hover:bg-[#EEF3F5]" : "text-[#9AA4AD] hover:bg-[#F0F2F4] hover:text-[#596570]"}`}
            >
              <i className={`inline-block h-px w-3 border-t border-dashed ${channelVisible ? "border-[#6F929A]" : "border-[#AAB3BA]"}`} />
              ATR通道
            </button>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#B88947]" />MA20</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#817A9F]" />MA60</span>
            {quote.timeframe !== "1d" && quote.timeframe !== "3d" && <>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm ring-1 ring-[#DFE6E9]" style={{ backgroundColor: TRADING_SESSION_BACKGROUND_COLORS.night }} />夜盘</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm ring-1 ring-[#ECE7DB]" style={{ backgroundColor: TRADING_SESSION_BACKGROUND_COLORS.day }} />日盘</span>
            </>}
            <span className="hidden sm:inline">浅色涨 · 灰蓝跌</span>
          </span>
        </div>
        <div className="relative min-h-0 w-full flex-1">
          <div ref={priceContainer} className="absolute inset-0" />
          {hoveredExtreme && <div
            className="pointer-events-none absolute z-10 rounded border border-[#DDE3E8] bg-white/95 px-2 py-1 text-[10px] leading-4 text-[#4F5D67] shadow-sm"
            style={{
              left: Math.max(4, Math.min(hoveredExtreme.x + 14, (priceContainer.current?.clientWidth ?? 240) - 220)),
              top: Math.max(4, Math.min(hoveredExtreme.y + 14, (priceContainer.current?.clientHeight ?? 48) - 48)),
            }}
          >
            {hoveredExtreme.bar.volumeRank != null && <div>成交量第{hoveredExtreme.bar.volumeRank}：{hoveredExtreme.bar.volume == null ? "--" : `${formatNumber(hoveredExtreme.bar.volume)} 手`}</div>}
            {hoveredExtreme.bar.bodyRank != null && <div>实体第{hoveredExtreme.bar.bodyRank}：{hoveredExtreme.bar.bodySize == null ? "--" : formatNumber(hoveredExtreme.bar.bodySize)}</div>}
          </div>}
        </div>
      </div>
      <div className="flex h-[23%] min-h-[112px] max-h-[176px] shrink-0 flex-col overflow-hidden rounded border border-[#DDE3E8] bg-white">
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#E5E9ED] bg-[#FCFDFE] px-2 text-[11px] text-[#75818C]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={subchartMode === "oi"}
              onClick={() => onSubchartModeChange("oi")}
              className={`rounded px-1.5 py-0.5 transition-colors ${subchartMode === "oi" ? "bg-[#E8EFF2] font-medium text-[#3F5F6B]" : "text-[#78848E] hover:bg-[#F0F3F4] hover:text-[#43515C]"}`}
            >
              OI 变化
            </button>
            <button
              type="button"
              aria-pressed={subchartMode === "volume"}
              onClick={() => onSubchartModeChange("volume")}
              className={`rounded px-1.5 py-0.5 transition-colors ${subchartMode === "volume" ? "bg-[#E8EFF2] font-medium text-[#3F5F6B]" : "text-[#78848E] hover:bg-[#F0F3F4] hover:text-[#43515C]"}`}
            >
              成交量
            </button>
          </div>
          <span className="inline-flex items-center gap-1.5">{subchartMode === "oi" ? <><span>蓝灰增仓 · 暖灰减仓</span><i className="inline-block h-2 w-2 rounded-full bg-[#365F72]" /><i className="inline-block h-2 w-2 rounded-full bg-[#805A3D]" /><span>OI变化前三</span></> : "蓝灰阳线 · 暖灰阴线"}</span>
        </div>
        <div ref={subchartContainer} className="min-h-0 w-full flex-1" />
      </div>
    </div>
  );
}

function TerminalChartLoading({ subchartMode }: { subchartMode: SubchartMode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#DDE3E8] bg-white">
        <div className="flex h-7 shrink-0 items-center border-b border-[#E5E9ED] bg-[#FCFDFE] px-2 text-[11px] text-[#75818C]"><span>价格 / K线 · MA20 / MA60</span></div>
        <div className="grid min-h-0 flex-1 place-items-center text-xs text-[#8B96A0]">正在读取 K 线…</div>
      </div>
      <div className="flex h-[19%] min-h-[88px] max-h-[152px] shrink-0 flex-col overflow-hidden rounded border border-[#DDE3E8] bg-white">
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#E5E9ED] bg-[#FCFDFE] px-2 text-[11px] text-[#75818C]"><span>{subchartMode === "oi" ? "OI 持仓量变化" : "成交量"}</span><span>{subchartMode === "oi" ? "蓝灰增仓 · 暖灰减仓" : "蓝灰阳线 · 暖灰阴线"}</span></div>
        <div className="grid min-h-0 flex-1 place-items-center text-[11px] text-[#8B96A0]">正在读取 OI…</div>
      </div>
    </div>
  );
}

function StatusBadge({ snapshot }: { snapshot: TerminalQuote | null }) {
  const mode = terminalQuoteMode(snapshot);
  if (mode === "LIVE") return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#D6E2DC] bg-[#F1F6F3] px-2 py-1 text-xs text-[#648271]"><Wifi size={13} />盘中实时</span>;
  if (mode === "STATIC") return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#E9E0CD] bg-[#F8F5EC] px-2 py-1 text-xs text-[#927F55]"><Archive size={13} />静态/未更新</span>;
  return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#DDE3E8] px-2 py-1 text-xs text-[#7D8994]"><WifiOff size={13} />等待行情</span>;
}

function directionLabel(direction: string) {
  return { UP: "上行", DOWN: "下行", SIDEWAYS: "横盘", NEUTRAL: "中性", UNKNOWN: "待确认" }[direction] ?? "待确认";
}

function localDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function TerminalContextPanel({
  contract, blueprint, onBlueprintChange, quote, snapshot, trendSnapshot, trendError, ctaContracts, ctaReady, ctaError, ctaReport, ctaLoading, events,
}: {
  contract: string;
  blueprint: TerminalBlueprint;
  onBlueprintChange: (blueprint: TerminalBlueprint) => void;
  quote: LiveQuote | null;
  snapshot: TerminalQuote | null;
  trendSnapshot: TrendTracker | null;
  trendError: boolean;
  ctaContracts: string[];
  ctaReady: boolean;
  ctaError: boolean;
  ctaReport: CtaReport | null;
  ctaLoading: boolean;
  events: TerminalEvent[];
}) {
  const linked = selectLinkedResearch(contract, trendSnapshot?.instruments ?? [], ctaContracts, ctaReport);
  const lastBar = quote?.bars?.at(-1) ?? quote?.daily_bars?.at(-1);
  const field = (label: string, value: string) => <div className="flex justify-between gap-2 py-1.5 text-[11px]"><dt className="shrink-0 text-[#83909B]">{label}</dt><dd className="min-w-0 break-all text-right font-mono text-[#3E4D59]">{value}</dd></div>;
  return <aside aria-label="合约信息" className="flex h-full w-[252px] shrink-0 flex-col overflow-y-auto border-l border-[#E2E7EC] bg-white px-3 py-2.5">
    <div className="flex items-center justify-between border-b border-[#E7ECEF] pb-2"><h2 className="text-xs font-semibold text-[#344652]">合约信息</h2><span className="text-[10px] text-[#87939D]">随自选联动</span></div>
    <section className="border-b border-[#E7ECEF] py-2">
      <div className="mb-1.5 flex items-center justify-between"><h3 className="text-[11px] font-medium text-[#526674]">事件雷达</h3><span className="font-mono text-[10px] text-[#9AA5AD]">{events.length}</span></div>
      {events.length ? <ul className="grid gap-1.5">{events.map((event) => <li key={event.id} className="border-l-2 border-[#A9854F] pl-2">
        <div className="text-[11px] font-medium leading-4 text-[#495965]">{event.title}</div>
        <div className="text-[10px] leading-4 text-[#75818C]">{event.detail}</div>
        <div className="font-mono text-[9px] text-[#9AA5AD]">{localDateTime(event.time)}</div>
      </li>)}</ul> : <p className="text-[10px] leading-4 text-[#98A2AA]">暂无触发事件 · 仅检查已完成K线</p>}
    </section>
    <section className="border-b border-[#E7ECEF] py-2"><div className="mb-1.5 flex items-center justify-between"><h3 className="text-[11px] font-medium text-[#526674]">人工交易蓝图</h3><span className="text-[10px] text-[#9AA5AD]">仅本机保存</span></div>
      <div className="grid gap-1.5 text-[11px]">
        <label className="flex items-center gap-2"><span className="w-[50px] shrink-0 text-[#83909B]">方向</span><select aria-label="蓝图方向" value={blueprint.direction} onChange={(event) => onBlueprintChange({ ...blueprint, direction: event.target.value as TerminalBlueprint["direction"] })} className="h-7 min-w-0 flex-1 rounded border border-[#DDE3E8] bg-white px-1.5 text-[#40515D]"><option value="WATCH">观察</option><option value="LONG">做多</option><option value="SHORT">做空</option></select></label>
        <label className="flex items-center gap-2"><span className="w-[50px] shrink-0 text-[#83909B]">等什么</span><input aria-label="蓝图触发条件" value={blueprint.trigger} onChange={(event) => onBlueprintChange({ ...blueprint, trigger: event.target.value })} maxLength={200} placeholder="填写触发条件" className="h-7 min-w-0 flex-1 rounded border border-[#DDE3E8] bg-white px-1.5 text-[#40515D] placeholder:text-[#B1BAC1]" /></label>
        <label className="flex items-center gap-2"><span className="w-[50px] shrink-0 text-[#83909B]">错在哪里</span><input aria-label="蓝图失效条件" value={blueprint.invalidation} onChange={(event) => onBlueprintChange({ ...blueprint, invalidation: event.target.value })} maxLength={200} placeholder="填写失效条件" className="h-7 min-w-0 flex-1 rounded border border-[#DDE3E8] bg-white px-1.5 text-[#40515D] placeholder:text-[#B1BAC1]" /></label>
      </div>
    </section>
    <details className="border-b border-[#E7ECEF] py-2"><summary className="cursor-pointer text-[11px] font-medium text-[#526674]">数据凭证 · {snapshot?.cache_age_seconds == null ? "等待行情" : `${Math.round(snapshot.cache_age_seconds)} 秒`} · {lastBar ? (lastBar.is_closed ? "K线已完成" : "K线形成中") : "无K线"}</summary><dl className="mt-1">
      {field("合约类型", quote?.instrument_type === "ACTUAL" ? "具体交割合约" : "待确认")}
      {field("数据标的", quote?.tq_symbol ?? "--")}
      {field("交易日归属*", quote?.trading_day ?? "--")}
      {field("报价时刻", quote?.quote_time ?? "--")}
      {field("报价来源", quote?.price_source === "QUOTE" ? "TqSdk 报价" : quote?.price_source === "BAR_CLOSE" ? "K线收盘价回退" : "暂无报价")}
      {field("快照写入", localDateTime(snapshot?.fetched_at))}
      {field("快照年龄", snapshot?.cache_age_seconds == null ? "--" : `${Math.round(snapshot.cache_age_seconds)} 秒`)}
      {field("最新K线", lastBar ? (lastBar.is_closed ? "已完成" : "形成中") : "--")}
    </dl><div className="mt-1 text-[10px] text-[#8A969F]">北京时间；*夜盘按下个工作日推算，节假日需复核交易所日历。过期快照不标记实时。</div></details>
    <section className="border-b border-[#E7ECEF] py-2"><h3 className="mb-1 text-[11px] font-medium text-[#526674]">当前量仓</h3><dl>
      {field("成交量", quote?.volume == null ? "--" : `${formatNumber(quote.volume)} 手`)}
      {field("持仓量", quote?.open_interest == null ? "--" : `${formatNumber(quote.open_interest)} 手`)}
      {field("本周期 OI 变化", lastBar?.oi_change == null ? "--" : `${signed(lastBar.oi_change, 0)} 手`)}
    </dl></section>
    <section className="border-b border-[#E7ECEF] py-2"><h3 className="mb-1 text-[11px] font-medium text-[#526674]">趋势跟踪</h3>
      {linked.trend ? <><div className="text-xs font-medium text-[#405B66]">{directionLabel(linked.trend.direction)} · {linked.trend.setup_state === "PULLBACK" ? "回踩" : linked.trend.setup_state === "CONTINUATION" ? "延续" : linked.trend.setup_state === "CONSOLIDATION" ? "整理" : "观察"}</div><div className="mt-1 text-[10px] text-[#87939D]">趋势分 {linked.trend.trend_score ?? "--"} · {linked.trend.data_quality === "COMPLETE" ? "数据完整" : "数据不足"}</div><div className="mt-1 text-[10px] text-[#9AA5AD]">价格样本截至 {linked.trend.points.at(-1)?.date ?? "--"}</div></> : <p className="text-[11px] leading-4 text-[#88949E]">{trendError ? "趋势服务暂不可用" : trendSnapshot ? "当前具体合约未覆盖；不借用其他主力合约的结论。" : "正在读取趋势…"}</p>}
      {trendSnapshot && <div className="mt-1 text-[10px] text-[#9AA5AD]">研究快照 {localDateTime(trendSnapshot.fetched_at)}</div>}
    </section>
    <section className="py-2"><h3 className="mb-1 text-[11px] font-medium text-[#526674]">CTA 校验</h3>
      {ctaError ? <p className="text-[11px] text-[#88949E]">CTA 服务暂不可用</p> : !ctaReady || ctaLoading ? <p className="text-[11px] text-[#88949E]">正在读取 CTA…</p> : !linked.ctaConfigured ? <p className="text-[11px] text-[#88949E]">该合约尚未配置 CTA 校验</p> : linked.ctaReport ? <><div className="text-xs font-medium text-[#405B66]">{linked.ctaReport.system_state} · {linked.ctaReport.direction}</div><div className="mt-1 text-[10px] text-[#87939D]">{describeCtaReportProvenance(linked.ctaReport)}</div><div className="mt-1 text-[10px] text-[#9AA5AD]">报告生成 {localDateTime(linked.ctaReport.generated_at)}</div></> : <p className="text-[11px] text-[#88949E]">已配置，尚无机器报告</p>}
    </section>
    <p className="mt-auto border-t border-[#E7ECEF] pt-2 text-[10px] leading-4 text-[#95A0A8]">趋势与 CTA 是独立研究结果；未覆盖不代表看空，也不构成交易指令。</p>
  </aside>;
}

export default function MarketTerminalPage() {
  const [contract, setContract] = useState("P2701");
  const [timeframe, setTimeframe] = useState<MarketTimeframe>("1d");
  const [subchartMode, setSubchartMode] = useState<SubchartMode>("oi");
  const [channelVisible, setChannelVisible] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [snapshot, setSnapshot] = useState<TerminalQuote | null>(null);
  const [quoteCache, setQuoteCache] = useState<Record<string, WatchlistQuote>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [contextVisible, setContextVisible] = useState(true);
  const [layouts, setLayouts] = useState<TerminalLayout[]>([]);
  const [layoutsReady, setLayoutsReady] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [compareSector, setCompareSector] = useState<string | null>(null);
  const [collapsedSectors, setCollapsedSectors] = useState<Record<string, boolean>>({});
  const commandInput = useRef<HTMLInputElement>(null);
  const trendStates = useRef(new Map<string, string>());
  const [trendEvents, setTrendEvents] = useState<Record<string, TerminalEvent>>({});
  const [trendSnapshot, setTrendSnapshot] = useState<TrendTracker | null>(null);
  const [trendError, setTrendError] = useState(false);
  const [ctaContracts, setCtaContracts] = useState<string[]>([]);
  const [ctaReady, setCtaReady] = useState(false);
  const [ctaError, setCtaError] = useState(false);
  const [ctaReport, setCtaReport] = useState<CtaReport | null>(null);
  const [ctaLoading, setCtaLoading] = useState(false);
  const [blueprints, setBlueprints] = useState<Record<string, TerminalBlueprint>>({});
  const [blueprintsReady, setBlueprintsReady] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(TERMINAL_BLUEPRINTS_KEY); } catch { /* Storage may be disabled. */ }
    setBlueprints(resolveTerminalBlueprints(saved, CONTRACTS.map((item) => item.contract)));
    setBlueprintsReady(true);
  }, []);

  useEffect(() => {
    if (!blueprintsReady) return;
    try { window.localStorage.setItem(TERMINAL_BLUEPRINTS_KEY, JSON.stringify(blueprints)); } catch { /* Keep the in-memory blueprint. */ }
  }, [blueprints, blueprintsReady]);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(TERMINAL_LAYOUTS_KEY); } catch { /* Storage may be disabled. */ }
    setLayouts(resolveTerminalLayouts(saved, CONTRACTS.map((item) => item.contract), TIMEFRAMES.map((item) => item.value)));
    setLayoutsReady(true);
  }, []);

  useEffect(() => {
    if (!layoutsReady) return;
    try { window.localStorage.setItem(TERMINAL_LAYOUTS_KEY, JSON.stringify(layouts)); } catch { /* Saved layouts are an optional convenience. */ }
  }, [layouts, layoutsReady]);

  useEffect(() => {
    if (!trendSnapshot) return;
    for (const instrument of trendSnapshot.instruments) {
      const previous = trendStates.current.get(instrument.contract);
      if (previous && previous !== instrument.classification) {
        setTrendEvents((current) => ({
          ...current,
          [instrument.contract]: {
            id: `trend:${instrument.contract}:${previous}:${instrument.classification}:${trendSnapshot.fetched_at}`,
            kind: "trend",
            title: "趋势状态变化",
            detail: `${trendClassificationLabel(previous)} → ${trendClassificationLabel(instrument.classification)}`,
            time: trendSnapshot.fetched_at,
          },
        }));
      }
      trendStates.current.set(instrument.contract, instrument.classification);
    }
  }, [trendSnapshot]);

  useEffect(() => {
    if (commandOpen) {
      setCommandIndex(0);
      window.setTimeout(() => commandInput.current?.focus(), 0);
    } else {
      setCommandQuery("");
    }
  }, [commandOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setCompareSector(null);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(TERMINAL_PREFERENCES_KEY);
    } catch {
      // Private browsing or disabled storage keeps the terminal usable with defaults.
    }
    const preferences = resolveTerminalPreferences(
      saved,
      { contract: "P2701", timeframe: "1d", subchartMode: "oi" },
      CONTRACTS.map((item) => item.contract),
      TIMEFRAMES.map((item) => item.value),
    );
    setContract(preferences.contract);
    setTimeframe(preferences.timeframe);
    setSubchartMode(preferences.subchartMode);
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem(TERMINAL_PREFERENCES_KEY, JSON.stringify({ contract, timeframe, subchartMode }));
    } catch {
      // The terminal can still operate without browser persistence.
    }
  }, [contract, timeframe, subchartMode, preferencesReady]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.watchlistQuotes();
        if (active) {
          setQuoteCache((current) => ({
            ...current,
            ...Object.fromEntries(next.quotes.map((item) => [item.contract, item])),
          }));
        }
      } catch {
        // Keep the last known prices while the feed or API is unavailable.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 6000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const loadTrend = async () => {
      try {
        const next = await api.trendTracker();
        if (active) { setTrendSnapshot(next); setTrendError(false); }
      } catch {
        if (active) setTrendError(true);
      }
    };
    void loadTrend();
    const timer = window.setInterval(loadTrend, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    api.ctaContracts().then((rows) => {
      if (active) { setCtaContracts(rows.map((row) => row.contract)); setCtaError(false); }
    }).catch(() => { if (active) setCtaError(true); })
      .finally(() => { if (active) setCtaReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ctaReady || !ctaContracts.includes(contract)) {
      setCtaReport(null);
      setCtaLoading(false);
      return;
    }
    let active = true;
    setCtaReport(null);
    setCtaLoading(true);
    api.ctaLatestReport(contract).then((report) => {
      if (active) { setCtaReport(report); setCtaError(false); }
    }).catch(() => { if (active) setCtaError(true); })
      .finally(() => { if (active) setCtaLoading(false); });
    return () => { active = false; };
  }, [contract, ctaContracts, ctaReady]);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const next = await api.terminalQuote(contract, timeframe);
      setSnapshot(next);
      setQuoteCache((current) => ({ ...current, [contract]: {
        contract, last_price: next.quote.last_price, change_percent: next.quote.change_percent,
        quote_time: next.quote.quote_time, status: next.quote.status,
      } }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "行情数据暂不可用");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [contract, timeframe]);

  useEffect(() => {
    if (!preferencesReady) return;
    setLoading(true);
    load();
    const timer = window.setInterval(() => load(), 6000);
    return () => window.clearInterval(timer);
  }, [load, preferencesReady]);

  const selected = useMemo(() => CONTRACTS.find((item) => item.contract === contract) ?? CONTRACTS[0], [contract]);
  const activeSnapshot = snapshot?.timeframe === timeframe && snapshot.quote.contract === contract ? snapshot : null;
  const quote = activeSnapshot?.quote ?? null;
  const quoteChange = quote?.change_percent ?? null;
  const sectors = useMemo(() => {
    const groups = new Map<string, typeof CONTRACTS[number][]>();
    for (const item of CONTRACTS) groups.set(item.sector, [...(groups.get(item.sector) ?? []), item]);
    return [...groups.entries()];
  }, []);
  const commandMatches = useMemo(() => {
    const query = commandQuery.trim().toLocaleLowerCase();
    return CONTRACTS.filter((item) => !query || `${item.name} ${item.contract} ${item.exchange} ${item.sector}`.toLocaleLowerCase().includes(query));
  }, [commandQuery]);
  const comparedContracts = useMemo(() => CONTRACTS.filter((item) => item.sector === compareSector), [compareSector]);
  const currentEvents = useMemo(() => {
    const bars = quote?.bars?.length ? quote.bars : quote?.daily_bars ?? [];
    return detectTerminalEvents(bars, trendEvents[contract] ?? null);
  }, [quote, contract, trendEvents]);

  const saveCurrentLayout = () => {
    const name = layoutName.trim() || `${selected.name} ${TIMEFRAMES.find((item) => item.value === timeframe)?.label ?? timeframe}`;
    const layout: TerminalLayout = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${contract}`,
      name,
      contract,
      timeframe,
      subchartMode,
      channelVisible,
      contextVisible,
    };
    setLayouts((current) => [layout, ...current.filter((item) => item.name !== name)].slice(0, 12));
    setLayoutName("");
  };

  const applyLayout = (id: string) => {
    const layout = layouts.find((item) => item.id === id);
    if (!layout) return;
    setContract(layout.contract);
    setTimeframe(layout.timeframe);
    setSubchartMode(layout.subchartMode);
    setChannelVisible(layout.channelVisible);
    setContextVisible(layout.contextVisible);
  };

  const chooseContract = (nextContract: string) => {
    setContract(nextContract);
    setCommandOpen(false);
  };

  return (
    <main className="h-full min-h-0 overflow-hidden bg-[#F5F6F7] text-[#253041]">
      <div className="flex h-full min-h-0">
        <aside className="flex h-full w-[230px] shrink-0 flex-col overflow-hidden border-r border-[#E2E7EC] bg-white">
          <div className="shrink-0 border-b border-[#E2E7EC] px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><CandlestickChart size={17} className="text-[#6E8794]" />自选合约</div>
            <div className="mt-1 text-[11px] text-[#87939D]">行情终端 · TqSdk</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="mb-1 flex items-center justify-between px-2 text-[11px] text-[#8B969F]"><span>自选列表</span><span>{CONTRACTS.length}</span></div>
            <div className="space-y-2">
              {sectors.map(([sector, items]) => <section key={sector} className="overflow-hidden rounded border border-[#E1E8EC]">
                <div className="flex items-center justify-between bg-[#F8FAFB] px-2 py-1.5">
                  <button type="button" aria-expanded={!collapsedSectors[sector]} onClick={() => setCollapsedSectors((current) => ({ ...current, [sector]: !current[sector] }))} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[10px] font-semibold text-[#72808B]">
                    <span className="inline-block w-2 text-center">{collapsedSectors[sector] ? "＋" : "−"}</span><span>{sector}</span><span className="font-mono font-normal text-[#9AA5AD]">{items.length}</span>
                  </button>
                  <button type="button" title={`比较${sector}合约`} onClick={() => setCompareSector(sector)} className="grid h-5 w-5 place-items-center rounded text-[#84919B] hover:bg-[#EAF0F2] hover:text-[#415C68]"><ArrowLeftRight size={11} /></button>
                </div>
                {!collapsedSectors[sector] && <div className="divide-y divide-[#E8ECEF]">
                  {items.map((item) => {
                    const cached = quoteCache[item.contract];
                    const active = item.contract === contract;
                    return <button key={item.contract} type="button" onClick={() => setContract(item.contract)} title={`${item.name} ${item.contract}`} className={`w-full border-l-2 px-2 py-1.5 text-left transition-colors ${active ? "border-[#6F929A] bg-[#E8EFF2]" : "border-transparent hover:bg-[#F2F4F5]"}`}>
                      <div className="flex items-center justify-between gap-2 leading-tight"><span className={`text-[13px] font-medium ${active ? "text-[#253F4B]" : "text-[#495562]"}`}>{item.name}</span><span className="font-mono text-[10px] text-[#84909A]">{item.contract}</span></div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono leading-tight"><span className="text-[12px] text-[#34404C]">{cached?.last_price == null ? "--" : formatNumber(cached.last_price)}</span><span className={`text-[10px] ${cached?.change_percent == null ? "text-[#9AA3AA]" : cached.change_percent >= 0 ? "text-[#6E8794]" : "text-[#9A9183]"}`}>{cached?.change_percent == null ? "--" : `${cached.change_percent >= 0 ? "+" : ""}${cached.change_percent.toFixed(2)}%`}</span></div>
                    </button>;
                  })}
                </div>}
              </section>)}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#F5F6F7]">
          <header className="shrink-0 border-b border-[#E2E7EC] bg-white px-3 py-1.5 md:px-5 md:py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 text-base font-semibold text-[#253041]">{selected.name} <span className="ml-1 font-mono text-xs font-normal text-[#7A8792]">{selected.contract}</span></div>
                {quote && <div className="flex shrink-0 items-baseline gap-1.5 border-l border-[#E0E5E9] pl-2"><span className="font-mono text-sm font-semibold text-[#253041]">{quote.last_price == null ? "--" : formatNumber(quote.last_price)}</span><span className={`font-mono text-[10px] ${quoteChange == null ? "text-[#7A8792]" : quoteChange >= 0 ? "text-[#6E8794]" : "text-[#9A9183]"}`}>{signed(quote.change)} {quoteChange == null ? "" : `(${signed(quoteChange)}%)`}</span></div>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5"><StatusBadge snapshot={activeSnapshot} /><button type="button" onClick={() => setCommandOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded border border-[#D6DDE2] px-2 text-[11px] text-[#65737E] hover:bg-[#F3F5F6] hover:text-[#34404C]"><Search size={13} /><span>搜索合约</span><kbd className="hidden rounded border border-[#E0E5E9] px-1 text-[9px] text-[#8B969F] lg:inline">⌘K</kbd></button><button type="button" aria-label={contextVisible ? "收起合约信息" : "展开合约信息"} title={contextVisible ? "收起合约信息" : "展开合约信息"} onClick={() => setContextVisible((value) => !value)} className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[#D6DDE2] text-[#72808B] hover:border-[#AEBAC2] hover:bg-[#F3F5F6] hover:text-[#34404C]">{contextVisible ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button><button type="button" aria-label="刷新行情" title="刷新行情" onClick={() => load(true)} disabled={refreshing} className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[#D6DDE2] text-[#72808B] hover:border-[#AEBAC2] hover:bg-[#F3F5F6] hover:text-[#34404C] disabled:opacity-50"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button></div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {TIMEFRAMES.map((item) => <button key={item.value} type="button" onClick={() => setTimeframe(item.value)} className={`rounded px-2.5 py-0.5 text-[11px] transition-colors ${timeframe === item.value ? "bg-[#DFE8EC] font-medium text-[#344F5A]" : "text-[#6F7C87] hover:bg-[#F0F3F5] hover:text-[#34404C]"}`}>{item.label}</button>)}
              <span className="ml-auto hidden text-[11px] text-[#87939D] xl:block">主图 K 线 · MA20 / MA60 · 副图 OI / 成交量切换</span>
              <div className="ml-auto flex items-center gap-1.5">
                <select aria-label="载入已保存布局" value="" onChange={(event) => applyLayout(event.target.value)} className="h-7 max-w-[150px] rounded border border-[#D6DDE2] bg-white px-1.5 text-[10px] text-[#65737E]"><option value="">布局…</option>{layouts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <input aria-label="布局名称" value={layoutName} onChange={(event) => setLayoutName(event.target.value)} maxLength={32} placeholder="布局名称" className="h-7 w-[92px] rounded border border-[#D6DDE2] px-1.5 text-[10px] text-[#53616D] placeholder:text-[#A6AFB6]" />
                <button type="button" onClick={saveCurrentLayout} title="保存当前合约、周期、副图和面板设置" className="inline-flex h-7 items-center gap-1 rounded border border-[#D6DDE2] px-1.5 text-[10px] text-[#65737E] hover:bg-[#F3F5F6]"><Save size={11} />保存</button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1.5 md:px-4 md:py-2">
            <div className="mb-1 flex min-h-5 shrink-0 items-center justify-between gap-2 text-[10px] text-[#75818C]"><span>{activeSnapshot?.source ?? "TQSDK"} · {activeSnapshot?.timeframe_label ?? TIMEFRAMES.find((item) => item.value === timeframe)?.label} · {activeSnapshot ? `快照 ${new Date(activeSnapshot.fetched_at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "正在连接"}</span><span className="shrink-0 font-mono">{quote?.quote_time?.slice(11) ?? "无实时报价"}</span></div>
            {error && <div role="alert" className="mb-1 flex shrink-0 items-center gap-2 rounded border border-[#E7D3D1] bg-[#FBF6F5] px-3 py-1.5 text-xs text-[#966A66]"><CircleAlert size={14} />{error}</div>}
            {activeSnapshot?.connection_error && <div role="status" className="mb-1 shrink-0 rounded border border-[#E9E0CD] bg-[#F8F5EC] px-3 py-1.5 text-[11px] text-[#927F55]">{activeSnapshot.connection_error}</div>}
            <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
              <div className="h-full min-h-0 min-w-0 flex-1">
                {loading && !quote ? <TerminalChartLoading subchartMode={subchartMode} /> : quote ? <TerminalCharts key={`${contract}-${timeframe}`} quote={quote} subchartMode={subchartMode} onSubchartModeChange={setSubchartMode} channelVisible={channelVisible} onChannelVisibleChange={setChannelVisible} /> : <TerminalChartLoading subchartMode={subchartMode} />}
              </div>
              {contextVisible && <div className="h-full min-h-0 w-[252px] shrink-0 overflow-hidden rounded border border-[#DDE3E8] bg-white"><TerminalContextPanel contract={contract} blueprint={blueprints[contract] ?? EMPTY_BLUEPRINT} onBlueprintChange={(value) => setBlueprints((current) => updateTerminalBlueprint(current, contract, value))} quote={quote} snapshot={activeSnapshot} trendSnapshot={trendSnapshot} trendError={trendError} ctaContracts={ctaContracts} ctaReady={ctaReady} ctaError={ctaError} ctaReport={ctaReport} ctaLoading={ctaLoading} events={currentEvents} /></div>}
            </div>
            <div className="mt-1 hidden shrink-0 flex-wrap items-center justify-between gap-2 text-[10px] text-[#87939D] md:flex"><span>数据来自 TqSdk；休市时使用最后一次持久化快照。</span><span>持仓量变化 = 相邻 K 线收盘持仓量之差，不代表多空方向。</span></div>
          </div>
        </section>
      </div>
      {commandOpen && <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#253041]/25 px-4 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}>
        <div role="dialog" aria-modal="true" aria-label="搜索合约" className="w-full max-w-[520px] overflow-hidden rounded-lg border border-[#D8E0E6] bg-white shadow-[0_18px_60px_rgba(37,48,65,0.24)]">
          <div className="flex items-center gap-2 border-b border-[#E6EBEF] px-3"><Search size={16} className="shrink-0 text-[#87939D]" /><input ref={commandInput} aria-label="按名称、代码或板块搜索" value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setCommandIndex(0); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((index) => commandMatches.length ? (index + 1) % commandMatches.length : 0); }
            if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => commandMatches.length ? (index - 1 + commandMatches.length) % commandMatches.length : 0); }
            if (event.key === "Enter" && commandMatches[commandIndex]) chooseContract(commandMatches[commandIndex].contract);
          }} placeholder="输入合约名、代码或板块" className="h-12 min-w-0 flex-1 bg-transparent text-sm text-[#34404C] outline-none placeholder:text-[#A4ADB4]" /><kbd className="rounded border border-[#E0E5E9] px-1.5 py-0.5 text-[10px] text-[#909AA2]">ESC</kbd></div>
          <div className="max-h-[55vh] overflow-y-auto p-1.5">{commandMatches.length ? commandMatches.map((item, index) => {
            const cached = quoteCache[item.contract];
            return <button key={item.contract} type="button" onMouseEnter={() => setCommandIndex(index)} onClick={() => chooseContract(item.contract)} className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left ${index === commandIndex ? "bg-[#EAF0F2]" : "hover:bg-[#F5F7F8]"}`}>
              <span className="min-w-0"><span className="text-sm font-medium text-[#3D4C57]">{item.name}</span><span className="ml-2 font-mono text-[11px] text-[#7D8993]">{item.contract}</span><span className="ml-2 text-[10px] text-[#9AA4AB]">{item.sector}</span></span><span className="shrink-0 font-mono text-[11px] text-[#65737E]">{cached?.last_price == null ? "--" : formatNumber(cached.last_price)}</span>
            </button>;
          }) : <div className="px-3 py-8 text-center text-xs text-[#8B969F]">没有匹配的合约</div>}</div>
          <div className="flex items-center justify-between border-t border-[#E6EBEF] px-3 py-2 text-[10px] text-[#97A1A8]"><span>↑↓ 选择 · Enter 切换 · Esc 关闭</span><span>{commandMatches.length} 个合约</span></div>
        </div>
      </div>}
      {compareSector && <div className="fixed inset-0 z-50 grid place-items-center bg-[#253041]/25 px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompareSector(null); }}>
        <div role="dialog" aria-modal="true" aria-label={`${compareSector}合约比较`} className="w-full max-w-[620px] overflow-hidden rounded-lg border border-[#D8E0E6] bg-white shadow-[0_18px_60px_rgba(37,48,65,0.24)]">
          <div className="flex items-center justify-between border-b border-[#E6EBEF] px-4 py-3"><div><h2 className="text-sm font-semibold text-[#344652]">{compareSector} · 合约比较</h2><p className="mt-0.5 text-[10px] text-[#8B969F]">最新价与涨跌幅来自自选报价快照；不含缺失字段的推算。</p></div><button type="button" onClick={() => setCompareSector(null)} className="rounded px-2 py-1 text-xs text-[#7C8892] hover:bg-[#F1F4F5]">关闭</button></div>
          <div className="overflow-x-auto p-3"><table className="w-full text-left text-xs"><thead><tr className="border-b border-[#E6EBEF] text-[10px] text-[#89949C]"><th className="px-2 py-2 font-medium">合约</th><th className="px-2 py-2 text-right font-medium">最新价</th><th className="px-2 py-2 text-right font-medium">涨跌幅</th><th className="px-2 py-2 text-right font-medium">报价时间</th></tr></thead><tbody>{comparedContracts.map((item) => {
            const cached = quoteCache[item.contract];
            return <tr key={item.contract} className="border-b border-[#EDF0F2] last:border-0"><td className="px-2 py-2"><button type="button" onClick={() => { setContract(item.contract); setCompareSector(null); }} className="text-left hover:text-[#527989]"><span className="font-medium text-[#40515D]">{item.name}</span><span className="ml-2 font-mono text-[10px] text-[#89949C]">{item.contract}</span></button></td><td className="px-2 py-2 text-right font-mono text-[#40515D]">{cached?.last_price == null ? "--" : formatNumber(cached.last_price)}</td><td className={`px-2 py-2 text-right font-mono ${cached?.change_percent == null ? "text-[#9AA3AA]" : cached.change_percent >= 0 ? "text-[#6E8794]" : "text-[#9A9183]"}`}>{cached?.change_percent == null ? "--" : `${cached.change_percent >= 0 ? "+" : ""}${cached.change_percent.toFixed(2)}%`}</td><td className="px-2 py-2 text-right font-mono text-[10px] text-[#89949C]">{cached?.quote_time?.slice(11, 19) ?? "--"}</td></tr>;
          })}</tbody></table></div>
        </div>
      </div>}
    </main>
  );
}
