import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  IChartApi,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { MarketTimeframe } from "./api";
import { terminalChartTime } from "./terminal-time";
import type { TradingSessionSpan } from "./trading-sessions";

export const TRADING_SESSION_BACKGROUND_COLORS = {
  night: "rgba(255, 220, 195, 0.25)",
  day: "rgba(195, 235, 255, 0.25)",
} as const;

export type TradingSessionBackgroundColors = {
  night: string;
  day: string;
};

export class TradingSessionBackground implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private spans: TradingSessionSpan[] = [];
  private timeframe: MarketTimeframe;
  private readonly renderer: IPrimitivePaneRenderer;
  private readonly views: IPrimitivePaneView[];
  private colors: TradingSessionBackgroundColors;

  constructor(timeframe: MarketTimeframe, colors: TradingSessionBackgroundColors = TRADING_SESSION_BACKGROUND_COLORS) {
    this.timeframe = timeframe;
    this.colors = colors;
    this.renderer = {
      draw: () => undefined,
      drawBackground: (target) => this.drawBackground(target),
    };
    this.views = [{ zOrder: () => "bottom", renderer: () => this.renderer }];
  }

  setSpans(spans: TradingSessionSpan[], timeframe = this.timeframe) {
    this.spans = spans;
    this.timeframe = timeframe;
    this.requestUpdate?.();
  }

  setColors(colors: TradingSessionBackgroundColors) {
    this.colors = colors;
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  private drawBackground(target: CanvasRenderingTarget2D) {
    if (!this.chart || !this.spans.length) return;
    const timeScale = this.chart.timeScale();
    const barWidth = Math.max(1, timeScale.options().barSpacing / 2);
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      for (const span of this.spans) {
        const startTime = terminalChartTime(span.startTime, this.timeframe);
        const endTime = terminalChartTime(span.endTime, this.timeframe);
        if (startTime == null || endTime == null) continue;
        const start = timeScale.timeToCoordinate(startTime);
        const end = timeScale.timeToCoordinate(endTime);
        if (start == null || end == null) continue;
        const left = Math.max(0, Math.min(start, end) - barWidth);
        const right = Math.min(mediaSize.width, Math.max(start, end) + barWidth);
        if (right <= left) continue;
        context.fillStyle = this.colors[span.kind];
        context.fillRect(left, 0, right - left, mediaSize.height);
      }
    });
  }
}
