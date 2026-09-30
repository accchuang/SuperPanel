"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
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
import { Archive, ArrowLeftRight, CandlestickChart, CircleAlert, Moon, PanelRightClose, PanelRightOpen, RefreshCw, Search, Save, Sun, Wifi, WifiOff } from "lucide-react";
import { api, type LeaderboardRow, type LiveQuote, type MarketTimeframe, type TerminalQuote, type WatchlistQuote } from "@/lib/api";
import { resolveTerminalPreferences, TERMINAL_PREFERENCES_KEY, type SubchartMode } from "@/lib/terminal-preferences";
import { terminalChartTime, type ChartTime } from "@/lib/terminal-time";
import { buildTradingSessionSpans } from "@/lib/trading-sessions";
import { TradingSessionBackground } from "@/lib/trading-session-background";
import { rankRecentBarExtremes, rankRecentOpenInterestChanges } from "@/lib/bar-extremes";
import { buildChannelSwingPath } from "@/lib/channel-swings";
import { formatNumber } from "@/lib/utils";
import { terminalQuoteMode } from "@/lib/terminal-research";
import { resolveTerminalLayouts, TERMINAL_LAYOUTS_KEY, type TerminalLayout } from "@/lib/terminal-workspace";
import { terminalStatusTooltip } from "@/lib/terminal-subchart";
import { netPositionBarValues } from "@/lib/leaderboard-visuals";
import { leaderboardContractCode, leaderboardLookupSymbols } from "@/lib/leaderboard-contract";
import { resolveTerminalTheme, TERMINAL_THEME_KEY, terminalChartPalette, terminalUiPalette, type TerminalTheme } from "@/lib/terminal-theme";
import { buildVolumeProfile, selectVisibleProfileBars } from "@/lib/volume-profile";
import { chartDrawingsStorageKey, parseChartDrawings, placeChartDrawing, undoChartDrawing, type ChartDrawing, type DrawingAnchor, type DrawingTool } from "@/lib/chart-drawings";
import { buildBackToBackKeyLevels, buildBackToBackVolatilityEligibility, detectBackToBackSignals } from "@/lib/back-to-back-signals";
import { measureSignalBubble, mergeSignalBubbles, selectSignalFactors, type SignalBubble, type SignalBubbleFactor, type SignalBubbleFactorKind } from "@/lib/signal-bubbles";
import { checkPriceAlerts, parsePriceAlerts, PRICE_ALERTS_KEY, type PriceAlert, type PriceAlertDirection, type PriceSample } from "@/lib/price-alerts";
import { PriceAlertsMenu } from "@/components/price-alerts-menu";

const CONTRACTS = [
  { contract: "P2701", name: "棕榈油", exchange: "DCE", sector: "油脂油料" },
  { contract: "I2701", name: "铁矿石", exchange: "DCE", sector: "黑色系" },
  { contract: "HC2701", name: "热卷", exchange: "SHFE", sector: "黑色系" },
  { contract: "JM2701", name: "焦煤", exchange: "DCE", sector: "黑色系" },
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
  { contract: "EG2701", name: "乙二醇", exchange: "DCE", sector: "化工" },
  { contract: "MA2611", name: "甲醇", exchange: "CZCE", sector: "化工" },
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

const DEFAULT_VISIBLE_BARS = 50;

const SIGNAL_FILTER_OPTIONS: { kind: SignalBubbleFactorKind; label: string }[] = [
  { kind: "volume", label: "成交量" },
  { kind: "body", label: "实体" },
  { kind: "oi", label: "OI 变化" },
  { kind: "backToBack", label: "背靠背" },
];

const NET_POSITION_COLOR = "#76BFA1";
const NET_POSITION_INCREASE = "#D94727";
const NET_POSITION_DECREASE = "#35A04C";

function signed(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function chartOptions(height: number, palette: ReturnType<typeof terminalChartPalette>, showTimeScale = true) {
  return {
    width: 0,
    height,
    layout: {
      background: { type: ColorType.Solid, color: palette.background },
      textColor: palette.text,
      fontFamily: "Arial, sans-serif",
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { visible: showTimeScale, borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 40 },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: palette.crosshair, width: 1, style: 2 }, horzLine: { color: palette.crosshair, width: 1, style: 2 } },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  } as const;
}

type ChartState = {
  priceChart: IChartApi;
  subchartChart: IChartApi;
  candleSeries: ISeriesApi<"Candlestick">;
  channelUpperSeries: ISeriesApi<"Line">;
  channelLowerSeries: ISeriesApi<"Line">;
  channelMiddleSeries: ISeriesApi<"Line">;
  swingPathSeries: ISeriesApi<"Line">;
  subchartSeries: ISeriesApi<"Histogram">;
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
  is_closed: boolean;
  borderColor?: string;
  wickColor?: string;
};

type ChannelLinePoint = { time: ChartTime; value: number };
type ChartSignalBubble = SignalBubble & { chartTime: ChartTime; anchorPrice: number };
type PriceAlertNotice = { id: string; alert: PriceAlert; observedPrice: number };

function chartTimeKey(time: ChartTime): string {
  if (typeof time === "number" || typeof time === "string") return String(time);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
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
      atr: averageTrueRange[index],
    };
  });
}

function TerminalCharts({
  quote,
  theme,
  subchartMode,
  onSubchartModeChange,
  channelVisible,
  onChannelVisibleChange,
  volumeProfileVisible,
  onVolumeProfileVisibleChange,
  selectedSignalKinds,
  onSelectedSignalKindsChange,
  priceAlerts,
  onAddPriceAlert,
  onTogglePriceAlert,
  onRemovePriceAlert,
}: {
  quote: LiveQuote;
  theme: TerminalTheme;
  subchartMode: SubchartMode;
  onSubchartModeChange: (mode: SubchartMode) => void;
  channelVisible: boolean;
  onChannelVisibleChange: (visible: boolean) => void;
  volumeProfileVisible: boolean;
  onVolumeProfileVisibleChange: (visible: boolean) => void;
  selectedSignalKinds: SignalBubbleFactorKind[];
  onSelectedSignalKindsChange: Dispatch<SetStateAction<SignalBubbleFactorKind[]>>;
  priceAlerts: PriceAlert[];
  onAddPriceAlert: (price: number, direction: PriceAlertDirection) => void;
  onTogglePriceAlert: (id: string) => void;
  onRemovePriceAlert: (id: string) => void;
}) {
  const palette = terminalChartPalette(theme);
  const priceContainer = useRef<HTMLDivElement>(null);
  const profileCanvas = useRef<HTMLCanvasElement>(null);
  const drawingsCanvas = useRef<HTMLCanvasElement>(null);
  const signalCanvas = useRef<HTMLCanvasElement>(null);
  const subchartContainer = useRef<HTMLDivElement>(null);
  const state = useRef<ChartState | null>(null);
  const signalBubblesByTime = useRef(new Map<string, ChartSignalBubble>());
  const initialized = useRef(false);
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [pendingDrawingPoint, setPendingDrawingPoint] = useState<DrawingAnchor | null>(null);
  const [drawingsReady, setDrawingsReady] = useState(false);
  const [visibleRange, setVisibleRange] = useState<LogicalRange | null>(null);
  const [signalBubbles, setSignalBubbles] = useState<ChartSignalBubble[]>([]);
  const [hoveredSignalBubble, setHoveredSignalBubble] = useState<{
    bubble: ChartSignalBubble;
    x: number;
    y: number;
  } | null>(null);
  const drawingToolRef = useRef<DrawingTool | null>(activeDrawingTool);
  const drawingsRef = useRef<ChartDrawing[]>(drawings);
  const candlesRef = useRef<CandlePoint[]>([]);
  const pendingDrawingPointRef = useRef<DrawingAnchor | null>(pendingDrawingPoint);
  drawingToolRef.current = activeDrawingTool;
  drawingsRef.current = drawings;
  pendingDrawingPointRef.current = pendingDrawingPoint;
  const drawingsStorageKey = chartDrawingsStorageKey(quote.contract, quote.timeframe);
  const contractAlerts = useMemo(() => priceAlerts.filter((alert) => alert.contract === quote.contract), [priceAlerts, quote.contract]);
  const horizontalPrices = drawings.flatMap((drawing) => drawing.kind === "horizontal" ? [drawing.price] : []);

  useEffect(() => {
    setDrawings(parseChartDrawings(window.localStorage.getItem(drawingsStorageKey)));
    setPendingDrawingPoint(null);
    setDrawingsReady(true);
  }, [drawingsStorageKey]);

  useEffect(() => {
    if (!drawingsReady) return;
    window.localStorage.setItem(drawingsStorageKey, JSON.stringify(drawings));
  }, [drawings, drawingsReady, drawingsStorageKey]);

  useEffect(() => {
    if (!priceContainer.current || !subchartContainer.current) return;
    initialized.current = false;
    const priceChart = createChart(priceContainer.current, chartOptions(priceContainer.current.clientHeight, palette, false));
    const subchartChart = createChart(subchartContainer.current, chartOptions(subchartContainer.current.clientHeight, palette));
    const candleSeries = priceChart.addSeries(CandlestickSeries, {
      upColor: palette.candleUp,
      downColor: palette.candleDown,
      borderUpColor: palette.candleBorderUp,
      borderDownColor: palette.candleBorderDown,
      wickUpColor: palette.candleBorderUp,
      wickDownColor: palette.candleBorderDown,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const channelUpperSeries = priceChart.addSeries(LineSeries, {
      color: palette.channel,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const channelLowerSeries = priceChart.addSeries(LineSeries, {
      color: palette.channel,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const channelMiddleSeries = priceChart.addSeries(LineSeries, {
      color: palette.channelMiddle,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const swingPathSeries = priceChart.addSeries(LineSeries, {
      color: palette.swingPath,
      lineWidth: 2,
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
    const priceSessionBackground = new TradingSessionBackground("15m", palette.sessionBackground);
    const subchartSessionBackground = new TradingSessionBackground("15m", palette.sessionBackground);
    candleSeries.attachPrimitive(priceSessionBackground);
    subchartSeries.attachPrimitive(subchartSessionBackground);
    state.current = {
      priceChart,
      subchartChart,
      candleSeries,
      channelUpperSeries,
      channelLowerSeries,
      channelMiddleSeries,
      swingPathSeries,
      subchartSeries,
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
    const trackVisibleRange = (range: LogicalRange | null) => setVisibleRange(range);
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(syncPriceRange);
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(trackVisibleRange);
    subchartChart.timeScale().subscribeVisibleLogicalRangeChange(syncSubchartRange);
    const handleCrosshairMove = (param: Parameters<IChartApi["subscribeCrosshairMove"]>[0] extends (event: infer Event) => void ? Event : never) => {
      if (!param.point || param.time == null) {
        setHoveredSignalBubble(null);
        return;
      }
      const bubble = signalBubblesByTime.current.get(chartTimeKey(param.time as ChartTime));
      setHoveredSignalBubble(bubble ? { bubble, x: param.point.x, y: param.point.y } : null);
    };
    priceChart.subscribeCrosshairMove(handleCrosshairMove);
    const handleChartClick = (param: Parameters<IChartApi["subscribeClick"]>[0] extends (event: infer Event) => void ? Event : never) => {
      const tool = drawingToolRef.current;
      const point = param.point;
      const current = state.current;
      const container = priceContainer.current;
      if (!tool || !point || !current || !container) return;
      const plotRight = container.clientWidth - current.priceChart.priceScale("right").width();
      if (point.x < 0 || point.x > plotRight || point.y < 0 || point.y > container.clientHeight) return;
      const price = current.candleSeries.coordinateToPrice(point.y);
      if (price == null || !Number.isFinite(price)) return;
      if ((tool === "trendline" || tool === "vertical" || tool === "rangeCircle") && param.time == null) return;
      const anchor: DrawingAnchor = { time: (param.time ?? 0) as ChartTime, price };
      let rangeCircleBounds: { startTime: ChartTime; endTime: ChartTime; high: number; low: number } | undefined;
      if (tool === "rangeCircle" && pendingDrawingPointRef.current) {
        const candles = candlesRef.current;
        const startIndex = candles.findIndex((candle) => chartTimeKey(candle.time) === chartTimeKey(pendingDrawingPointRef.current!.time as ChartTime));
        const endIndex = candles.findIndex((candle) => chartTimeKey(candle.time) === chartTimeKey(anchor.time as ChartTime));
        if (startIndex < 0 || endIndex < 0) return;
        const firstIndex = Math.min(startIndex, endIndex);
        const lastIndex = Math.max(startIndex, endIndex);
        const selectedCandles = candles.slice(firstIndex, lastIndex + 1);
        rangeCircleBounds = {
          startTime: selectedCandles[0].time,
          endTime: selectedCandles[selectedCandles.length - 1].time,
          high: Math.max(...selectedCandles.map((candle) => candle.high)),
          low: Math.min(...selectedCandles.map((candle) => candle.low)),
        };
      }
      const result = placeChartDrawing(
        drawingsRef.current,
        tool,
        anchor,
        pendingDrawingPointRef.current,
        typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `drawing-${Date.now()}-${Math.random()}`,
        rangeCircleBounds,
      );
      setDrawings(result.drawings);
      setPendingDrawingPoint(result.pendingPoint);
    };
    priceChart.subscribeClick(handleChartClick);

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
      priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(trackVisibleRange);
      subchartChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncSubchartRange);
      priceChart.unsubscribeCrosshairMove(handleCrosshairMove);
      priceChart.unsubscribeClick(handleChartClick);
      subchartExtremeMarkers.detach();
      candleSeries.detachPrimitive(priceSessionBackground);
      subchartSeries.detachPrimitive(subchartSessionBackground);
      priceChart.remove();
      subchartChart.remove();
      state.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = drawingsCanvas.current;
    const current = state.current;
    if (!canvas || !current) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      const pixelRatio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (width < 80 || height < 40) return;

      const plotRight = width - current.priceChart.priceScale("right").width();
      context.save();
      context.beginPath();
      context.rect(0, 0, plotRight, height);
      context.clip();
      context.lineWidth = 1.5;
      context.strokeStyle = theme === "dark" ? "#F2C85C" : "#B66F13";
      context.fillStyle = context.strokeStyle;
      context.setLineDash([]);

      for (const drawing of drawings) {
        if (drawing.kind === "vertical") {
          const x = current.priceChart.timeScale().timeToCoordinate(drawing.time as ChartTime);
          if (x == null) continue;
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, height);
          context.stroke();
          continue;
        }
        if (drawing.kind === "horizontal") {
          const y = current.candleSeries.priceToCoordinate(drawing.price);
          if (y == null) continue;
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(plotRight, y);
          context.stroke();
          continue;
        }
        if (drawing.kind === "rangeCircle") {
          const startX = current.priceChart.timeScale().timeToCoordinate(drawing.startTime as ChartTime);
          const endX = current.priceChart.timeScale().timeToCoordinate(drawing.endTime as ChartTime);
          const highY = current.candleSeries.priceToCoordinate(drawing.high);
          const lowY = current.candleSeries.priceToCoordinate(drawing.low);
          if (startX == null || endX == null || highY == null || lowY == null) continue;
          const left = Math.min(startX, endX);
          const right = Math.max(startX, endX);
          const top = Math.min(highY, lowY);
          const bottom = Math.max(highY, lowY);
          context.beginPath();
          context.ellipse((left + right) / 2, (top + bottom) / 2, Math.max((right - left) / 2, 4), Math.max((bottom - top) / 2, 4), 0, 0, Math.PI * 2);
          context.fillStyle = theme === "dark" ? "rgba(255, 203, 92, 0.16)" : "rgba(232, 157, 43, 0.18)";
          context.fill();
          context.strokeStyle = theme === "dark" ? "rgba(255, 215, 120, 0.86)" : "rgba(176, 104, 24, 0.88)";
          context.stroke();
          context.strokeStyle = theme === "dark" ? "#F2C85C" : "#B66F13";
          continue;
        }
        const startX = current.priceChart.timeScale().timeToCoordinate(drawing.start.time as ChartTime);
        const startY = current.candleSeries.priceToCoordinate(drawing.start.price);
        const endX = current.priceChart.timeScale().timeToCoordinate(drawing.end.time as ChartTime);
        const endY = current.candleSeries.priceToCoordinate(drawing.end.price);
        if (startX == null || startY == null || endX == null || endY == null) continue;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
        for (const [x, y] of [[startX, startY], [endX, endY]]) {
          context.beginPath();
          context.arc(x, y, 2.5, 0, Math.PI * 2);
          context.fill();
        }
      }
      for (const alert of contractAlerts) {
        if (!alert.armed) continue;
        const y = current.candleSeries.priceToCoordinate(alert.price);
        if (y == null || y < 0 || y > height) continue;
        context.beginPath();
        context.setLineDash([5, 4]);
        context.strokeStyle = theme === "dark" ? "#FFD76F" : "#B78546";
        context.lineWidth = 1;
        context.moveTo(0, y);
        context.lineTo(plotRight, y);
        context.stroke();
        context.setLineDash([]);
        const label = `${alert.direction === "above" ? "↑" : "↓"} ${formatNumber(alert.price)}`;
        context.font = "600 10px Arial, sans-serif";
        const labelWidth = context.measureText(label).width + 8;
        context.fillStyle = theme === "dark" ? "#382D1B" : "#FFF9F0";
        context.fillRect(Math.max(2, plotRight - labelWidth - 4), y - 13, labelWidth, 14);
        context.fillStyle = theme === "dark" ? "#FFE18A" : "#936830";
        context.fillText(label, Math.max(6, plotRight - labelWidth), y - 2);
      }
      context.restore();
    };
    const scheduleDraw = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    draw();
    const observer = new ResizeObserver(scheduleDraw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    const interactionSurface = priceContainer.current?.parentElement;
    interactionSurface?.addEventListener("pointerup", scheduleDraw);
    interactionSurface?.addEventListener("wheel", scheduleDraw, { passive: true });
    window.addEventListener("resize", scheduleDraw);
    return () => {
      observer.disconnect();
      interactionSurface?.removeEventListener("pointerup", scheduleDraw);
      interactionSurface?.removeEventListener("wheel", scheduleDraw);
      window.removeEventListener("resize", scheduleDraw);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [drawings, contractAlerts, visibleRange, quote, theme]);

  useEffect(() => {
    const canvas = signalCanvas.current;
    const current = state.current;
    if (!canvas || !current) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      const pixelRatio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (width < 80 || height < 40) return;

      const plotRight = width - current.priceChart.priceScale("right").width();
      context.save();
      context.beginPath();
      context.rect(0, 0, plotRight, height);
      context.clip();
      context.font = "600 9px -apple-system, BlinkMacSystemFont, sans-serif";
      context.textBaseline = "middle";
      const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      for (const bubble of signalBubbles) {
        const x = current.priceChart.timeScale().timeToCoordinate(bubble.chartTime);
        const anchorY = current.candleSeries.priceToCoordinate(bubble.anchorPrice);
        if (x == null || anchorY == null || x < 0 || x > plotRight) continue;

        const labelWidths = bubble.factors.map((factor) => context.measureText(factor.label).width);
        const bubbleLayout = measureSignalBubble(labelWidths);
        const bubbleWidth = bubbleLayout.width;
        const bubbleHeight = bubbleLayout.height;
        const left = Math.max(3, Math.min(x - bubbleWidth / 2, plotRight - bubbleWidth - 3));
        const rawTop = bubble.position === "above" ? anchorY - bubbleHeight - 5 : anchorY + 5;
        const preferredDirection = bubble.position === "above" ? -1 : 1;
        const candidateTops = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]
          .map((step) => rawTop + step * 22)
          .filter((candidate) => candidate >= 2 && candidate + bubbleHeight <= height - 2)
          .sort((a, b) => Math.abs(a - rawTop) - Math.abs(b - rawTop)
            || (Math.sign(a - rawTop) === preferredDirection ? -1 : 1));
        const top = candidateTops.find((candidate) => !occupied.some((rect) =>
          left < rect.right + 3 && left + bubbleWidth + 3 > rect.left
          && candidate < rect.bottom + 3 && candidate + bubbleHeight + 3 > rect.top,
        )) ?? Math.max(2, Math.min(rawTop, height - bubbleHeight - 2));
        occupied.push({ left, right: left + bubbleWidth, top, bottom: top + bubbleHeight });

        const edgeY = top > anchorY ? top : top + bubbleHeight;
        if (Math.abs(edgeY - anchorY) > 24) {
          context.beginPath();
          context.moveTo(x, anchorY);
          context.lineTo(x, edgeY);
          context.strokeStyle = theme === "dark" ? "rgba(212, 187, 117, 0.78)" : "rgba(121, 135, 143, 0.48)";
          context.lineWidth = 1;
          context.stroke();
        }

        context.beginPath();
        context.roundRect(left, top, bubbleWidth, bubbleHeight, 8);
        context.fillStyle = theme === "dark" ? "rgba(39, 36, 29, 0.97)" : "rgba(255, 255, 255, 0.96)";
        context.fill();
        context.strokeStyle = bubble.direction
          ? bubble.direction === "bullish" ? palette.markerOiUp : palette.markerOiDown
          : theme === "dark" ? "#A89B77" : "#BFC9CE";
        context.lineWidth = 1;
        context.stroke();

        bubble.factors.forEach((factor, index) => {
          context.fillStyle = factor.color;
          context.fillText(factor.label, left + 6, top + bubbleLayout.rowCenters[index]);
        });
      }
      context.restore();
    };
    const scheduleDraw = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };
    const handleRangeChange = () => scheduleDraw();

    draw();
    const observer = new ResizeObserver(scheduleDraw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    const interactionSurface = priceContainer.current?.parentElement;
    interactionSurface?.addEventListener("pointerup", scheduleDraw);
    interactionSurface?.addEventListener("wheel", scheduleDraw, { passive: true });
    current.priceChart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    window.addEventListener("resize", scheduleDraw);
    return () => {
      observer.disconnect();
      interactionSurface?.removeEventListener("pointerup", scheduleDraw);
      interactionSurface?.removeEventListener("wheel", scheduleDraw);
      current.priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      window.removeEventListener("resize", scheduleDraw);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [signalBubbles, visibleRange, quote, theme, palette]);

  useEffect(() => {
    const current = state.current;
    if (!current) return;
    const bars = quote.bars?.length ? quote.bars : quote.daily_bars ?? [];
    const rankedExtremes = rankRecentBarExtremes(bars);
    const rankedOiExtremes = rankRecentOpenInterestChanges(bars);
    const oiExtremes = subchartMode === "oi" ? rankedOiExtremes : [];
    current.subchartExtremeMarkers.setMarkers(oiExtremes.flatMap((marker) => {
      const time = terminalChartTime(marker.time, quote.timeframe);
      if (time == null) return [];
      return [{
        time,
        position: "aboveBar" as const,
        shape: marker.change >= 0 ? "arrowUp" as const : "arrowDown" as const,
        color: marker.change >= 0 ? palette.markerOiUp : palette.markerOiDown,
        size: 1.5,
      }];
    }));
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
        is_closed: bar.is_closed,
      }];
    });
    candlesRef.current = candles;
    const sessionSpans = buildTradingSessionSpans(bars, quote.timeframe);
    current.priceSessionBackground.setSpans(sessionSpans, quote.timeframe);
    current.subchartSessionBackground.setSpans(sessionSpans, quote.timeframe);
    const channel = adaptiveChannel(candles);
    const signalLevels = buildBackToBackKeyLevels(candles, channel.map((point) => ({
      upper: point.upper.value,
      lower: point.lower.value,
      atr: point.atr,
    })));
    const volatilityEligibility = buildBackToBackVolatilityEligibility(candles);
    const backToBackSignals = detectBackToBackSignals(candles, signalLevels, volatilityEligibility);
    const signalFactors: SignalBubbleFactor[] = [];
    const addFactor = (time: ChartTime | null, factor: Omit<SignalBubbleFactor, "time">) => {
      if (time != null) signalFactors.push({ time: chartTimeKey(time), ...factor });
    };
    for (const ranked of rankedExtremes) {
      if (ranked.volumeRank != null) {
        addFactor(terminalChartTime(ranked.time, quote.timeframe), {
          kind: "volume",
          label: "量" + ranked.volumeRank,
          detail: "成交量第" + ranked.volumeRank + "：" + (ranked.volume == null ? "--" : formatNumber(ranked.volume) + " 手"),
          color: palette.markerVolume,
        });
      }
      if (ranked.bodyRank != null) {
        addFactor(terminalChartTime(ranked.time, quote.timeframe), {
          kind: "body",
          label: "实体" + ranked.bodyRank,
          detail: "实体第" + ranked.bodyRank + "：" + (ranked.bodySize == null ? "--" : formatNumber(ranked.bodySize)),
          color: palette.markerEntity,
        });
      }
    }
    for (const marker of rankedOiExtremes) {
      addFactor(terminalChartTime(marker.time, quote.timeframe), {
        kind: "oi",
        label: marker.change >= 0 ? "OI+" : "OI−",
        detail: "持仓量变化第" + marker.rank + "：" + (marker.change >= 0 ? "增加 " : "减少 ")
          + formatNumber(Math.abs(marker.change)) + " 手",
        color: marker.change >= 0 ? palette.markerOiUp : palette.markerOiDown,
      });
    }
    for (const signal of backToBackSignals) {
      const bullish = signal.direction === "bullish";
      addFactor(signal.time, {
        kind: "backToBack",
        label: bullish ? "背↑" : "背↓",
        detail: "背靠背" + (bullish ? "看涨" : "看跌") + "：实体重叠 "
          + Math.round(signal.overlapRatio * 100) + "%，关键位 " + formatNumber(signal.keyLevel),
        color: bullish ? palette.markerOiUp : palette.markerOiDown,
        direction: signal.direction,
      });
    }
    const candlesByTime = new Map(candles.map((candle) => [chartTimeKey(candle.time), candle]));
    const bubbles: ChartSignalBubble[] = mergeSignalBubbles(selectSignalFactors(signalFactors, selectedSignalKinds)).flatMap((bubble) => {
      const candle = candlesByTime.get(bubble.time);
      if (!candle) return [];
      return [{
        ...bubble,
        chartTime: candle.time,
        anchorPrice: bubble.position === "above" ? candle.high : candle.low,
      }];
    });
    signalBubblesByTime.current = new Map(bubbles.map((bubble) => [chartTimeKey(bubble.chartTime), bubble]));
    setSignalBubbles(bubbles);
    setHoveredSignalBubble(null);
    const swingPath = channelVisible
      ? buildChannelSwingPath(candles, channel.map((point) => ({
          upper: point.upper.value,
          lower: point.lower.value,
          atr: point.atr,
        }))).map(({ time, value }) => ({ time, value }))
      : [];
    const highlightedCandles = channelVisible
      ? candles.map((candle, index) => {
          const bounds = channel[index];
          if (candle.close > bounds.upper.value && candle.close > candle.open) {
            return { ...candle, borderColor: palette.breakoutUp, wickColor: palette.breakoutUp };
          }
          if (candle.close < bounds.lower.value && candle.close < candle.open) {
            return { ...candle, borderColor: palette.breakoutDown, wickColor: palette.breakoutDown };
          }
          return candle;
        })
      : candles;
    const subchart = bars.flatMap((bar) => {
      const time = terminalChartTime(bar.time, quote.timeframe);
      if (time == null) return [];
      if (subchartMode === "oi") {
        const value = bar.oi_change ?? 0;
        return [{ time, value, color: value >= 0 ? palette.subchartUp : palette.subchartDown }];
      }
      const value = bar.volume ?? 0;
      const isUpCandle = bar.close >= (bar.open ?? bar.close);
      return [{ time, value, color: isUpCandle ? palette.subchartUp : palette.subchartDown }];
    });
    current.candleSeries.setData(highlightedCandles);
    current.channelUpperSeries.setData(channelVisible ? channel.map((point) => point.upper) : []);
    current.channelLowerSeries.setData(channelVisible ? channel.map((point) => point.lower) : []);
    current.channelMiddleSeries.setData(channelVisible ? channel.map((point) => point.middle) : []);
    current.swingPathSeries.setData(swingPath);
    current.subchartSeries.setData(subchart);
    if (!initialized.current && candles.length) {
      const visibleBars = Math.min(candles.length, DEFAULT_VISIBLE_BARS);
      const rightPadding = visibleBars;
      current.priceChart.timeScale().setVisibleLogicalRange({
        from: candles.length - visibleBars - 0.5,
        to: candles.length - 0.5 + rightPadding,
      });
      initialized.current = true;
    }
  }, [quote, channelVisible, subchartMode, selectedSignalKinds]);

  useEffect(() => {
    const canvas = profileCanvas.current;
    const current = state.current;
    if (!canvas || !current) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const bars = quote.bars?.length ? quote.bars : quote.daily_bars ?? [];
    const chartBars = bars.filter((bar) => terminalChartTime(bar.time, quote.timeframe) != null);
    const visibleBars = selectVisibleProfileBars(chartBars, visibleRange);
    const profile = buildVolumeProfile(visibleBars.map(({ high, low, close, volume }) => ({ high, low, close, volume })));
    let frame = 0;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      const pixelRatio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!volumeProfileVisible || !profile || width < 80 || height < 40) return;

      const plotRight = width - current.priceChart.priceScale("right").width();
      if (plotRight < 40) return;
      const profileWidth = Math.min(88, Math.max(36, plotRight * 0.2));
      const maxVolume = Math.max(...profile.bins.map((bin) => bin.volume));
      const pocIndex = profile.bins.findIndex((bin, index) => profile.poc >= bin.low && (profile.poc < bin.high || index === profile.bins.length - 1));

      profile.bins.forEach((bin, index) => {
        if (bin.volume <= 0) return;
        const top = current.candleSeries.priceToCoordinate(bin.high);
        const bottom = current.candleSeries.priceToCoordinate(bin.low);
        if (top == null || bottom == null) return;
        const barWidth = Math.max(1, profileWidth * bin.volume / maxVolume);
        context.fillStyle = index === pocIndex
          ? theme === "dark" ? "rgba(241, 197, 83, 0.75)" : "rgba(207, 139, 35, 0.68)"
          : theme === "dark" ? "rgba(70, 190, 208, 0.58)" : "rgba(79, 123, 147, 0.38)";
        context.fillRect(plotRight - barWidth, top, barWidth, Math.max(1, bottom - top - 1));
      });

      const labelX = Math.max(4, plotRight - profileWidth);
      const drawLevel = (price: number, label: string, color: string, dashed: boolean) => {
        const y = current.candleSeries.priceToCoordinate(price);
        if (y == null || y < 0 || y > height) return;
        context.beginPath();
        context.strokeStyle = color;
        context.lineWidth = label === "POC" ? 1.5 : 1;
        context.setLineDash(dashed ? [3, 2] : []);
        context.moveTo(labelX, y);
        context.lineTo(plotRight, y);
        context.stroke();
        context.setLineDash([]);

        const text = `${label}≈${current.candleSeries.priceFormatter().format(price)}`;
        context.font = "600 9px Arial, sans-serif";
        const tagWidth = Math.ceil(context.measureText(text).width) + 6;
        const tagY = Math.max(10, Math.min(height - 3, y));
        context.fillStyle = theme === "dark" ? "rgba(31, 30, 25, 0.96)" : "rgba(255, 255, 255, 0.92)";
        context.fillRect(labelX, tagY - 9, tagWidth, 12);
        context.fillStyle = color;
        context.textBaseline = "middle";
        context.fillText(text, labelX + 3, tagY - 3);
      };

      drawLevel(profile.vah, "VAH", theme === "dark" ? "#69D2EE" : "#667A83", true);
      drawLevel(profile.val, "VAL", theme === "dark" ? "#69D2EE" : "#667A83", true);
      drawLevel(profile.poc, "POC", theme === "dark" ? "#FFD76F" : "#B66F13", false);
    };
    const scheduleDraw = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    draw();
    const observer = new ResizeObserver(scheduleDraw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    const interactionSurface = priceContainer.current?.parentElement;
    interactionSurface?.addEventListener("pointermove", scheduleDraw);
    interactionSurface?.addEventListener("pointerup", scheduleDraw);
    interactionSurface?.addEventListener("wheel", scheduleDraw, { passive: true });
    window.addEventListener("resize", scheduleDraw);
    return () => {
      observer.disconnect();
      interactionSurface?.removeEventListener("pointermove", scheduleDraw);
      interactionSurface?.removeEventListener("pointerup", scheduleDraw);
      interactionSurface?.removeEventListener("wheel", scheduleDraw);
      window.removeEventListener("resize", scheduleDraw);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [quote, visibleRange, volumeProfileVisible, theme]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#DDE3E8] bg-white">
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#E5E9ED] bg-[#FCFDFE] px-2 text-[11px] text-[#75818C]">
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span>价格 / K线</span>
            <details className="relative z-20 text-[10px]">
              <summary
                aria-label="筛选主图信号"
                title="成交量和实体排名取近45根已完成K线"
                className="cursor-pointer list-none rounded border border-[#CDD7DC] bg-white px-1.5 py-0.5 font-medium text-[#5C707A] hover:bg-[#F2F5F6]"
              >信号 {selectedSignalKinds.length}/{SIGNAL_FILTER_OPTIONS.length} ▾</summary>
              <div role="group" aria-label="选择显示的信号" className="absolute left-0 top-[calc(100%+5px)] w-36 rounded border border-[#D8E0E4] bg-white p-2 text-[#52636D] shadow-md">
                {SIGNAL_FILTER_OPTIONS.map(({ kind, label }) => (
                  <label key={kind} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-[#F2F5F6]">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={selectedSignalKinds.includes(kind)}
                      onChange={() => onSelectedSignalKindsChange((selected) => selected.includes(kind)
                        ? selected.filter((item) => item !== kind)
                        : [...selected, kind])}
                      className="accent-[#607F8A]"
                    />
                    {label}
                  </label>
                ))}
                <div className="mt-1 flex justify-between border-t border-[#E7ECEF] pt-1">
                  <button type="button" aria-label="全选主图信号" onClick={() => onSelectedSignalKindsChange(SIGNAL_FILTER_OPTIONS.map((option) => option.kind))} className="rounded px-1 py-0.5 hover:bg-[#F2F5F6]">全选</button>
                  <button type="button" aria-label="清空主图信号" onClick={() => onSelectedSignalKindsChange([])} className="rounded px-1 py-0.5 hover:bg-[#F2F5F6]">清空</button>
                </div>
              </div>
            </details>
            <details className="relative z-30 text-[10px]">
              <summary
                aria-label="图表标注工具"
                title="趋势线、水平线、垂直线和圆形区间"
                className="cursor-pointer list-none rounded border border-[#CDD7DC] bg-white px-1.5 py-0.5 font-medium text-[#5C707A] hover:bg-[#F2F5F6]"
              >标注{activeDrawingTool && pendingDrawingPoint ? "·选终点" : " ▾"}</summary>
              <div role="group" aria-label="图表标注工具" className="absolute right-0 top-[calc(100%+5px)] w-48 rounded border border-[#D8E0E4] bg-white p-2 text-[#52636D] shadow-md">
                <div className="grid grid-cols-2 gap-1">
                  <button type="button" aria-pressed={activeDrawingTool === "trendline"} title="点击两个K线位置绘制趋势线" onClick={() => { setActiveDrawingTool((tool) => tool === "trendline" ? null : "trendline"); setPendingDrawingPoint(null); }} className={`rounded px-2 py-1 text-left ${activeDrawingTool === "trendline" ? "bg-[#E8EFF2] font-medium text-[#3F5F6B]" : "hover:bg-[#F0F3F4]"}`}>趋势线</button>
                  <button type="button" aria-pressed={activeDrawingTool === "horizontal"} title="点击图表放置水平线" onClick={() => { setActiveDrawingTool((tool) => tool === "horizontal" ? null : "horizontal"); setPendingDrawingPoint(null); }} className={`rounded px-2 py-1 text-left ${activeDrawingTool === "horizontal" ? "bg-[#E8EFF2] font-medium text-[#3F5F6B]" : "hover:bg-[#F0F3F4]"}`}>水平线</button>
                  <button type="button" aria-pressed={activeDrawingTool === "vertical"} title="点击图表标记时间位置" onClick={() => { setActiveDrawingTool((tool) => tool === "vertical" ? null : "vertical"); setPendingDrawingPoint(null); }} className={`rounded px-2 py-1 text-left ${activeDrawingTool === "vertical" ? "bg-[#E8EFF2] font-medium text-[#3F5F6B]" : "hover:bg-[#F0F3F4]"}`}>垂直线</button>
                  <button type="button" aria-pressed={activeDrawingTool === "rangeCircle"} title="依次点击区间起点和终点，按该段K线最高/最低绘制半透明圆形区域" onClick={() => { setActiveDrawingTool((tool) => tool === "rangeCircle" ? null : "rangeCircle"); setPendingDrawingPoint(null); }} className={`rounded px-2 py-1 text-left ${activeDrawingTool === "rangeCircle" ? "bg-[#E8EFF2] font-medium text-[#3F5F6B]" : "hover:bg-[#F0F3F4]"}`}>圆形区间</button>
                </div>
                <div className="my-1 flex items-center gap-2 border-t border-[#E7ECEF] pt-1">
                  <PriceAlertsMenu
                    contract={quote.contract}
                    lastPrice={quote.last_price}
                    alerts={contractAlerts}
                    horizontalPrices={horizontalPrices}
                    onAdd={onAddPriceAlert}
                    onToggle={onTogglePriceAlert}
                    onRemove={onRemovePriceAlert}
                  />
                  <button type="button" title="撤销最后一条划线" disabled={!drawings.length} onClick={() => { setDrawings((items) => undoChartDrawing(items)); setPendingDrawingPoint(null); }} className="rounded px-2 py-1 hover:bg-[#F0F3F4] disabled:cursor-default disabled:opacity-40">撤销</button>
                  <button type="button" title="清除当前合约和周期的全部划线" disabled={!drawings.length} onClick={() => { setDrawings([]); setPendingDrawingPoint(null); }} className="rounded px-2 py-1 hover:bg-[#F0F3F4] disabled:cursor-default disabled:opacity-40">清空</button>
                </div>
              </div>
            </details>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={channelVisible}
              title="EMA(最高/最低, 45) ± EMA(TR, 60) × 1.5；距上下轨 1×ATR 内视为触及，并连接交替极值"
              onClick={() => onChannelVisibleChange(!channelVisible)}
              className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${channelVisible ? "text-[#5E828C] hover:bg-[#EEF3F5]" : "text-[#9AA4AD] hover:bg-[#F0F2F4] hover:text-[#596570]"}`}
            >
              <i className={`inline-block h-px w-3 border-t border-dashed ${channelVisible ? "border-[#6F929A]" : "border-[#AAB3BA]"}`} />
              ATR通道
            </button>
            <button
              type="button"
              aria-label="切换筹码峰估算"
              aria-pressed={volumeProfileVisible}
              title="基于可视窗口 K 线成交量的价位估算，不代表真实持仓成本"
              onClick={() => onVolumeProfileVisibleChange(!volumeProfileVisible)}
              className={`rounded px-1 py-0.5 transition-colors ${volumeProfileVisible ? "bg-[#F4E7D2] text-[#94611E] hover:bg-[#EFE0C6]" : "text-[#9AA4AD] hover:bg-[#F0F2F4] hover:text-[#596570]"}`}
            >
              筹码峰估算
            </button>
            <span><i className="mr-1 inline-block h-px w-3 align-middle" style={{ backgroundColor: palette.swingPath }} />通道轨迹</span>
            {quote.timeframe !== "1d" && quote.timeframe !== "3d" && <>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm ring-1 ring-[#DFE6E9]" style={{ backgroundColor: palette.sessionBackground.night }} />夜盘</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm ring-1 ring-[#ECE7DB]" style={{ backgroundColor: palette.sessionBackground.day }} />日盘</span>
            </>}
            <span className="hidden sm:inline">青绿涨 · 珊瑚红跌</span>
          </div>
        </div>
        <div className="relative min-h-0 w-full flex-1">
          <div ref={priceContainer} className={`absolute inset-0 ${activeDrawingTool ? "cursor-crosshair" : ""}`} />
          <canvas ref={profileCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] h-full w-full" />
          <canvas ref={drawingsCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[6] h-full w-full" />
          <canvas ref={signalCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[7] h-full w-full" />
          {hoveredSignalBubble && <div
            role="tooltip"
            className="pointer-events-none absolute z-10 min-w-[220px] rounded border border-[#DDE3E8] bg-white/95 px-2 py-1.5 text-[10px] leading-4 text-[#4F5D67] shadow-sm"
            style={{
              left: Math.max(4, Math.min(hoveredSignalBubble.x + 14, (priceContainer.current?.clientWidth ?? 260) - 260)),
              top: Math.max(4, Math.min(
                hoveredSignalBubble.y + 14,
                (priceContainer.current?.clientHeight ?? 160) - Math.min(42 + hoveredSignalBubble.bubble.factors.length * 18, 150),
              )),
            }}
          >
            {hoveredSignalBubble.bubble.factors.map((factor, index) => (
              <div key={factor.kind + index} className="flex items-start gap-1.5">
                <span className="shrink-0 font-semibold" style={{ color: factor.color }}>{factor.label}</span>
                <span>{factor.detail}</span>
              </div>
            ))}
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
        <div className="flex h-7 shrink-0 items-center border-b border-[#E5E9ED] bg-[#FCFDFE] px-2 text-[11px] text-[#75818C]"><span>价格 / K线 · ATR 通道 · 通道轨迹</span></div>
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
  const title = terminalStatusTooltip(snapshot);
  if (mode === "LIVE") return <span title={title} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#D6E2DC] bg-[#F1F6F3] px-2 py-1 text-xs text-[#648271]"><Wifi size={13} />盘中实时</span>;
  if (mode === "STATIC") return <span title={title} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#E9E0CD] bg-[#F8F5EC] px-2 py-1 text-xs text-[#927F55]"><Archive size={13} />静态/未更新</span>;
  return <span title={title} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-[#DDE3E8] px-2 py-1 text-xs text-[#7D8994]"><WifiOff size={13} />等待行情</span>;
}

function TerminalContextPanel({ contract }: {
  contract: string;
}) {
  const contractCode = leaderboardContractCode(contract);
  const [leaderboard, setLeaderboard] = useState<{ symbol: string; dataSymbol: string | null; date: string | null; rows: LeaderboardRow[] } | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState(false);

  useEffect(() => {
    let active = true;
    setLeaderboardLoading(true);
    setLeaderboardError(false);
    const lookupSymbols = leaderboardLookupSymbols(contract);
    if (!contractCode || !lookupSymbols.length) {
      setLeaderboard(null);
      setLeaderboardLoading(false);
      return () => { active = false; };
    }
    const load = async () => {
      try {
        for (const symbol of lookupSymbols) {
          const dates = await api.dates(symbol);
          if (!dates.latest) continue;
          const rows = await api.leaderboard(symbol, dates.latest);
          if (!rows.length && symbol !== lookupSymbols.at(-1)) continue;
          if (active) setLeaderboard({ symbol: contractCode, dataSymbol: symbol, date: dates.latest, rows });
          return;
        }
        if (active) setLeaderboard({ symbol: contractCode, dataSymbol: null, date: null, rows: [] });
      } catch {
        if (active) {
          setLeaderboard(null);
          setLeaderboardError(true);
        }
      } finally {
        if (active) setLeaderboardLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [contractCode]);

  const currentLeaderboard = leaderboard?.symbol === contractCode ? leaderboard : null;
  const dataScope = currentLeaderboard?.dataSymbol && currentLeaderboard.dataSymbol !== contractCode
    ? `${contractCode} · ${currentLeaderboard.dataSymbol} 品种级回退`
    : `${contractCode ?? contract} 合约级`;
  const longSeats = (currentLeaderboard?.rows ?? [])
    .filter((row) => row.net_position > 0)
    .sort((left, right) => right.net_position - left.net_position)
    .slice(0, 10);
  const shortSeats = (currentLeaderboard?.rows ?? [])
    .filter((row) => row.net_position < 0)
    .sort((left, right) => left.net_position - right.net_position)
    .slice(0, 10);
  const longValues = longSeats.map((row) => netPositionBarValues(row.net_position, row.net_change));
  const shortValues = shortSeats.map((row) => netPositionBarValues(row.net_position, row.net_change));
  const maxLong = Math.max(1, ...longValues.map((values) => values.position + Math.abs(values.change)));
  const maxShort = Math.max(1, ...shortValues.map((values) => values.position + Math.abs(values.change)));
  const renderLadder = (title: string, rows: LeaderboardRow[], maxValue: number) => {
    return <section className="border-b border-[#E7ECEF] py-2 last:border-0">
      <h3 className="mb-1.5 text-[10px] font-semibold text-[#526674]">{title}</h3>
      {rows.length ? <ol className="grid gap-1">{rows.map((row, index) => {
        const values = netPositionBarValues(row.net_position, row.net_change);
        const changeColor = values.change > 0 ? NET_POSITION_INCREASE : values.change < 0 ? NET_POSITION_DECREASE : "#AEB8BD";
        return <li key={row.broker} className="terminal-leaderboard-row relative flex h-7 items-center overflow-hidden rounded-sm border border-[#E7ECEF] bg-[#FBFCFD] px-2">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 right-0 flex">
          <span className="terminal-leaderboard-position-bar" style={{ width: `${values.position / maxValue * 100}%`, backgroundColor: NET_POSITION_COLOR }} />
          {values.change !== 0 && <span className={`terminal-leaderboard-change-bar min-w-[2px] ${values.change > 0 ? "terminal-leaderboard-change-increase" : "terminal-leaderboard-change-decrease"}`} style={{ width: `${Math.abs(values.change) / maxValue * 100}%`, backgroundColor: changeColor }} />}
        </span>
        <span className="relative flex min-w-0 flex-1 items-center justify-between gap-1 text-[10px]">
          <span className="terminal-leaderboard-broker truncate text-[#53616C]">{index + 1}. {row.broker}</span>
          <span className="shrink-0 font-mono font-medium" title={`净持仓 ${formatNumber(values.position)}，${values.change > 0 ? "增加" : values.change < 0 ? "减少" : "持平"} ${formatNumber(Math.abs(values.change))}`}><span className="terminal-leaderboard-value text-[#537565]">{formatNumber(values.position)}</span><span className={`terminal-leaderboard-change ml-0.5 ${values.change > 0 ? "terminal-leaderboard-change-increase text-[#C5442B]" : values.change < 0 ? "terminal-leaderboard-change-decrease text-[#31864A]" : "text-[#7F8A90]"}`}>/{signed(values.change, 0)}</span></span>
        </span>
      </li>})}</ol> : <p className="py-2 text-center text-[10px] text-[#98A2AA]">暂无上榜席位</p>}
    </section>;
  };

  return <aside aria-label="关键信息" className="terminal-leaderboard flex h-full w-[252px] shrink-0 flex-col overflow-y-auto border-l border-[#E2E7EC] bg-white px-3 py-2.5">
    <div className="flex items-start justify-between gap-1 border-b border-[#E7ECEF] pb-2"><div><h2 className="text-xs font-semibold text-[#344652]">龙虎榜净持仓</h2><div className="mt-0.5 text-[10px] text-[#87939D]">{dataScope}</div></div><span className="text-right text-[9px] leading-4 text-[#9AA5AD]">数据日期<br />{currentLeaderboard?.date ?? "--"}</span></div>
    <div className="flex items-center justify-end gap-1.5 border-b border-[#E7ECEF] py-1 text-[9px] text-[#87939D]"><span>净持仓</span><i aria-hidden="true" className="terminal-leaderboard-position-bar h-2 w-2 rounded-sm bg-[#76BFA1]" /><span>增加</span><i aria-hidden="true" className="terminal-leaderboard-change-increase h-2 w-2 rounded-sm bg-[#D94727]" /><span>减少</span><i aria-hidden="true" className="terminal-leaderboard-change-decrease h-2 w-2 rounded-sm bg-[#35A04C]" /></div>
      {(leaderboardLoading || (!currentLeaderboard && !leaderboardError)) ? <p className="py-5 text-center text-[10px] text-[#98A2AA]">正在读取龙虎榜…</p> : leaderboardError ? <p className="py-5 text-center text-[10px] text-[#98A2AA]">龙虎榜数据暂不可用</p> : !currentLeaderboard?.rows.length ? <p className="py-5 text-center text-[10px] text-[#98A2AA]">该品种暂无已收录数据</p> : <>
        <div className="min-h-0 flex-1 overflow-y-auto pt-1">
          {renderLadder("多头榜 · 净多席位", longSeats, maxLong)}
          {renderLadder("空头榜 · 净空席位", shortSeats, maxShort)}
        </div>
      </>}
    <p className="border-t border-[#E7ECEF] pt-2 text-[9px] leading-4 text-[#95A0A8]">仅统计已收录席位；榜外席位不代表零持仓。</p>
  </aside>;
}

export default function MarketTerminalPage() {
  const [contract, setContract] = useState("P2701");
  const [timeframe, setTimeframe] = useState<MarketTimeframe>("1d");
  const [subchartMode, setSubchartMode] = useState<SubchartMode>("oi");
  const [selectedSignalKinds, setSelectedSignalKinds] = useState<SignalBubbleFactorKind[]>(
    () => SIGNAL_FILTER_OPTIONS.map((option) => option.kind),
  );
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [priceAlertsReady, setPriceAlertsReady] = useState(false);
  const [priceAlertNotices, setPriceAlertNotices] = useState<PriceAlertNotice[]>([]);
  const [theme, setTheme] = useState<TerminalTheme>("light");
  const uiPalette = terminalUiPalette(theme);
  const terminalSurfaceStyle = {
    "--terminal-watchlist-surface": uiPalette.watchlistSurface,
    "--terminal-watchlist-section": uiPalette.watchlistSection,
    "--terminal-watchlist-border": uiPalette.watchlistBorder,
    "--terminal-watchlist-divider": uiPalette.watchlistDivider,
    "--terminal-watchlist-active": uiPalette.watchlistActive,
    "--terminal-watchlist-indicator": uiPalette.watchlistIndicator,
    "--terminal-leaderboard-surface": uiPalette.leaderboardSurface,
    "--terminal-leaderboard-row": uiPalette.leaderboardRow,
    "--terminal-leaderboard-border": uiPalette.leaderboardBorder,
    "--terminal-leaderboard-position": uiPalette.leaderboardPosition,
    "--terminal-leaderboard-increase": uiPalette.leaderboardIncrease,
    "--terminal-leaderboard-decrease": uiPalette.leaderboardDecrease,
    "--terminal-leaderboard-text": uiPalette.leaderboardText,
    "--terminal-leaderboard-value": uiPalette.leaderboardValue,
  } as CSSProperties;
  const [themeReady, setThemeReady] = useState(false);
  const [channelVisible, setChannelVisible] = useState(true);
  const [volumeProfileVisible, setVolumeProfileVisible] = useState(false);
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
  const previousPriceSamples = useRef<Record<string, PriceSample>>({});

  useEffect(() => {
    try {
      setPriceAlerts(parsePriceAlerts(window.localStorage.getItem(PRICE_ALERTS_KEY), CONTRACTS.map((item) => item.contract)));
    } catch {
      setPriceAlerts([]);
    }
    setPriceAlertsReady(true);
  }, []);

  useEffect(() => {
    if (!priceAlertsReady) return;
    try {
      window.localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(priceAlerts));
    } catch {
      // Alerts remain active for this session when browser storage is unavailable.
    }
  }, [priceAlerts, priceAlertsReady]);

  useEffect(() => {
    let nextAlerts = priceAlerts;
    const triggered: PriceAlertNotice[] = [];
    for (const quote of Object.values(quoteCache)) {
      const sample: PriceSample = {
        contract: quote.contract,
        lastPrice: quote.last_price,
        quoteTime: quote.quote_time,
        status: quote.status,
      };
      const previous = previousPriceSamples.current[quote.contract] ?? null;
      const result = checkPriceAlerts(nextAlerts, previous, sample);
      nextAlerts = result.alerts;
      triggered.push(...result.triggered.flatMap((alert) => sample.lastPrice == null ? [] : [{
        id: `${alert.id}:${alert.triggeredAt}`,
        alert,
        observedPrice: sample.lastPrice,
      }]));
      previousPriceSamples.current[quote.contract] = sample;
    }
    if (!priceAlertsReady) return;
    if (nextAlerts !== priceAlerts) setPriceAlerts(nextAlerts);
    if (!triggered.length) return;
    setPriceAlertNotices((current) => [...triggered, ...current].slice(0, 4));
    if ("Notification" in window && Notification.permission === "granted") {
      for (const notice of triggered) {
        new Notification(`${notice.alert.contract} 价格预警`, {
          body: `${notice.alert.direction === "above" ? "上穿" : "下穿"} ${formatNumber(notice.alert.price)}，最新 ${formatNumber(notice.observedPrice)}`,
        });
      }
    }
  }, [quoteCache, priceAlerts, priceAlertsReady]);

  useEffect(() => {
    if (!priceAlertNotices.length) return;
    const timer = window.setTimeout(() => setPriceAlertNotices([]), 10000);
    return () => window.clearTimeout(timer);
  }, [priceAlertNotices]);

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
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(TERMINAL_THEME_KEY);
    } catch {
      // Private browsing or disabled storage keeps the terminal usable with the light theme.
    }
    setTheme(resolveTerminalTheme(saved));
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    try {
      window.localStorage.setItem(TERMINAL_THEME_KEY, theme);
    } catch {
      // The terminal can still operate without browser persistence.
    }
  }, [theme, themeReady]);

  useEffect(() => {
    document.documentElement.dataset.marketTerminalTheme = theme;
    return () => {
      delete document.documentElement.dataset.marketTerminalTheme;
    };
  }, [theme]);

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

  const addPriceAlert = (price: number, direction: PriceAlertDirection) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `alert-${Date.now()}-${Math.random()}`;
    setPriceAlerts((current) => [...current, { id, contract, price, direction, armed: true, triggeredAt: null }]);
  };

  const togglePriceAlert = (id: string) => {
    setPriceAlerts((current) => current.map((alert) => alert.id === id
      ? { ...alert, armed: !alert.armed, triggeredAt: alert.armed ? alert.triggeredAt : null }
      : alert));
  };

  const removePriceAlert = (id: string) => setPriceAlerts((current) => current.filter((alert) => alert.id !== id));

  return (
    <main className={`terminal-theme terminal-theme-${theme} h-full min-h-0 overflow-hidden bg-[#F5F6F7] text-[#253041]`} style={terminalSurfaceStyle}>
      <div className="flex h-full min-h-0">
        <aside className="terminal-watchlist flex h-full w-[230px] shrink-0 flex-col overflow-hidden border-r border-[#E2E7EC] bg-white">
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
              <div className="flex shrink-0 items-center gap-1.5"><StatusBadge snapshot={activeSnapshot} /><button type="button" onClick={() => setCommandOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded border border-[#D6DDE2] px-2 text-[11px] text-[#65737E] hover:bg-[#F3F5F6] hover:text-[#34404C]"><Search size={13} /><span>搜索合约</span><kbd className="hidden rounded border border-[#E0E5E9] px-1 text-[9px] text-[#8B969F] lg:inline">⌘K</kbd></button><button type="button" aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"} title={theme === "dark" ? "切换浅色主题" : "切换深色主题"} aria-pressed={theme === "dark"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[#D6DDE2] text-[#72808B] hover:border-[#AEBAC2] hover:bg-[#F3F5F6] hover:text-[#34404C]"><span className="sr-only">{theme === "dark" ? "浅色主题" : "深色主题"}</span>{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}</button><button type="button" aria-label={contextVisible ? "收起关键数据" : "展开关键数据"} title={contextVisible ? "收起关键数据" : "展开关键数据"} onClick={() => setContextVisible((value) => !value)} className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[#D6DDE2] text-[#72808B] hover:border-[#AEBAC2] hover:bg-[#F3F5F6] hover:text-[#34404C]">{contextVisible ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button><button type="button" aria-label="刷新行情" title="刷新行情" onClick={() => load(true)} disabled={refreshing} className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[#D6DDE2] text-[#72808B] hover:border-[#AEBAC2] hover:bg-[#F3F5F6] hover:text-[#34404C] disabled:opacity-50"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button></div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {TIMEFRAMES.map((item) => <button key={item.value} type="button" onClick={() => setTimeframe(item.value)} className={`rounded px-2.5 py-0.5 text-[11px] transition-colors ${timeframe === item.value ? "bg-[#DFE8EC] font-medium text-[#344F5A]" : "text-[#6F7C87] hover:bg-[#F0F3F5] hover:text-[#34404C]"}`}>{item.label}</button>)}
              <span className="ml-auto hidden text-[11px] text-[#87939D] xl:block">主图 K 线 · ATR 通道 / 通道轨迹 · 副图 OI / 成交量切换</span>
              <div className="ml-auto flex items-center gap-1.5">
                <select aria-label="载入已保存布局" value="" onChange={(event) => applyLayout(event.target.value)} className="h-7 max-w-[150px] rounded border border-[#D6DDE2] bg-white px-1.5 text-[10px] text-[#65737E]"><option value="">布局…</option>{layouts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <input aria-label="布局名称" value={layoutName} onChange={(event) => setLayoutName(event.target.value)} maxLength={32} placeholder="布局名称" className="h-7 w-[92px] rounded border border-[#D6DDE2] px-1.5 text-[10px] text-[#53616D] placeholder:text-[#A6AFB6]" />
                <button type="button" onClick={saveCurrentLayout} title="保存当前合约、周期、副图和面板设置" className="inline-flex h-7 items-center gap-1 rounded border border-[#D6DDE2] px-1.5 text-[10px] text-[#65737E] hover:bg-[#F3F5F6]"><Save size={11} />保存</button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1.5 md:px-4 md:py-2">
            {error && <div role="alert" className="mb-1 flex shrink-0 items-center gap-2 rounded border border-[#E7D3D1] bg-[#FBF6F5] px-3 py-1.5 text-xs text-[#966A66]"><CircleAlert size={14} />{error}</div>}
            {activeSnapshot?.connection_error && <div role="status" className="mb-1 shrink-0 rounded border border-[#E9E0CD] bg-[#F8F5EC] px-3 py-1.5 text-[11px] text-[#927F55]">{activeSnapshot.connection_error}</div>}
            <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
              <div className="h-full min-h-0 min-w-0 flex-1">
                {loading && !quote ? <TerminalChartLoading subchartMode={subchartMode} /> : quote ? <TerminalCharts key={`${contract}-${timeframe}-${theme}`} theme={theme} quote={quote} subchartMode={subchartMode} onSubchartModeChange={setSubchartMode} channelVisible={channelVisible} onChannelVisibleChange={setChannelVisible} volumeProfileVisible={volumeProfileVisible} onVolumeProfileVisibleChange={setVolumeProfileVisible} selectedSignalKinds={selectedSignalKinds} onSelectedSignalKindsChange={setSelectedSignalKinds} priceAlerts={priceAlerts} onAddPriceAlert={addPriceAlert} onTogglePriceAlert={togglePriceAlert} onRemovePriceAlert={removePriceAlert} /> : <TerminalChartLoading subchartMode={subchartMode} />}
              </div>
              {contextVisible && <div className="h-full min-h-0 w-[252px] shrink-0 overflow-hidden rounded border border-[#DDE3E8] bg-white"><TerminalContextPanel contract={contract} /></div>}
            </div>
            <div className="mt-1 hidden shrink-0 flex-wrap items-center justify-between gap-2 text-[10px] text-[#87939D] md:flex"><span>数据来自 TqSdk；休市时使用最后一次持久化快照。</span><span>持仓量变化 = 相邻 K 线收盘持仓量之差，不代表多空方向。</span></div>
          </div>
        </section>
      </div>
      {priceAlertNotices.length > 0 && <div className="fixed top-16 z-50 flex w-72 flex-col gap-1.5" style={{ right: contextVisible ? 268 : 16 }}>
        {priceAlertNotices.map((notice) => <div key={notice.id} role="alert" className="rounded border border-[#E3D6BF] bg-[#FFFCF6] px-3 py-2 text-[11px] text-[#645B4F] shadow-lg">
          <div className="flex items-center justify-between gap-2"><strong className="text-[#765B34]">{notice.alert.contract} {notice.alert.direction === "above" ? "上穿" : "下穿"}预警</strong><button type="button" aria-label="关闭预警提示" onClick={() => setPriceAlertNotices((current) => current.filter((item) => item.id !== notice.id))} className="text-[#8D8376]">×</button></div>
          <div className="mt-0.5">目标 {formatNumber(notice.alert.price)} · 最新 {formatNumber(notice.observedPrice)}</div>
        </div>)}
      </div>}
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
