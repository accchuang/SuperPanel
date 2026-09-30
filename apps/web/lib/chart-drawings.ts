import type { Time } from "lightweight-charts";

export type DrawingTool = "trendline" | "horizontal" | "vertical" | "rangeCircle";
export type DrawingAnchor = { time: Time; price: number };
export type RangeCircleBounds = { startTime: Time; endTime: Time; high: number; low: number };
export type ChartDrawing =
  | { id: string; kind: "horizontal"; price: number }
  | { id: string; kind: "vertical"; time: Time }
  | { id: string; kind: "trendline"; start: DrawingAnchor; end: DrawingAnchor }
  | ({ id: string; kind: "rangeCircle" } & RangeCircleBounds);

export const CHART_DRAWINGS_KEY = "market-terminal.drawings.v1";

export function chartDrawingsStorageKey(contract: string, timeframe: string) {
  return `${CHART_DRAWINGS_KEY}:${contract}:${timeframe}`;
}

function isTime(value: unknown): value is Time {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  if (!value || typeof value !== "object") return false;
  const date = value as Record<string, unknown>;
  if (!Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)
      || Number(date.month) < 1 || Number(date.month) > 12 || Number(date.day) < 1) return false;
  const timestamp = Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day));
  if (!Number.isFinite(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 10)
    === `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function isAnchor(value: unknown): value is DrawingAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Record<string, unknown>;
  return isTime(anchor.time)
    && typeof anchor.price === "number" && Number.isFinite(anchor.price);
}

function isDrawing(value: unknown): value is ChartDrawing {
  if (!value || typeof value !== "object") return false;
  const drawing = value as Record<string, unknown>;
  if (typeof drawing.id !== "string" || !drawing.id) return false;
  if (drawing.kind === "horizontal") return typeof drawing.price === "number" && Number.isFinite(drawing.price);
  if (drawing.kind === "vertical") return isTime(drawing.time);
  if (drawing.kind === "trendline") return isAnchor(drawing.start) && isAnchor(drawing.end);
  return drawing.kind === "rangeCircle"
    && isTime(drawing.startTime) && isTime(drawing.endTime)
    && typeof drawing.high === "number" && Number.isFinite(drawing.high)
    && typeof drawing.low === "number" && Number.isFinite(drawing.low)
    && drawing.low <= drawing.high;
}

export function parseChartDrawings(raw: string | null): ChartDrawing[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isDrawing) : [];
  } catch {
    return [];
  }
}

export function placeChartDrawing(
  drawings: ChartDrawing[],
  tool: DrawingTool,
  anchor: DrawingAnchor,
  pendingPoint: DrawingAnchor | null,
  id: string,
  rangeCircleBounds?: RangeCircleBounds,
): { drawings: ChartDrawing[]; pendingPoint: DrawingAnchor | null } {
  if (!isAnchor(anchor)) {
    return { drawings, pendingPoint };
  }
  if (tool === "horizontal") {
    return { drawings: [...drawings, { id, kind: "horizontal", price: anchor.price }], pendingPoint: null };
  }
  if (tool === "vertical") {
    return { drawings: [...drawings, { id, kind: "vertical", time: anchor.time }], pendingPoint: null };
  }
  if (tool === "rangeCircle") {
    if (!pendingPoint) return { drawings, pendingPoint: anchor };
    if (!rangeCircleBounds) return { drawings, pendingPoint };
    return {
      drawings: [...drawings, { id, kind: "rangeCircle", ...rangeCircleBounds }],
      pendingPoint: null,
    };
  }
  if (!pendingPoint) return { drawings, pendingPoint: anchor };
  return {
    drawings: [...drawings, { id, kind: "trendline", start: pendingPoint, end: anchor }],
    pendingPoint: null,
  };
}

export function undoChartDrawing(drawings: ChartDrawing[]): ChartDrawing[] {
  return drawings.slice(0, -1);
}
