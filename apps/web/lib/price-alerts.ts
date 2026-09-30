export type PriceAlertDirection = "above" | "below";

export type PriceAlert = {
  id: string;
  contract: string;
  price: number;
  direction: PriceAlertDirection;
  armed: boolean;
  triggeredAt: string | null;
};

export type PriceSample = {
  contract: string;
  lastPrice: number | null;
  quoteTime: string | null;
  status: "LIVE" | "CLOSED" | "DELAYED";
};

export const PRICE_ALERTS_KEY = "market-terminal.price-alerts.v1";

export function parsePriceAlerts(raw: string | null, contracts: readonly string[]): PriceAlert[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PriceAlert => {
      if (!entry || typeof entry !== "object") return false;
      const alert = entry as Record<string, unknown>;
      return typeof alert.id === "string" && alert.id.length > 0
        && typeof alert.contract === "string" && contracts.includes(alert.contract)
        && typeof alert.price === "number" && Number.isFinite(alert.price) && alert.price > 0
        && (alert.direction === "above" || alert.direction === "below")
        && typeof alert.armed === "boolean"
        && (alert.triggeredAt === null || typeof alert.triggeredAt === "string");
    }).slice(0, 100);
  } catch {
    return [];
  }
}

export function checkPriceAlerts(
  alerts: PriceAlert[],
  previous: PriceSample | null,
  current: PriceSample,
): { alerts: PriceAlert[]; triggered: PriceAlert[] } {
  if (!previous || previous.contract !== current.contract || current.status !== "LIVE"
    || !previous.quoteTime || !current.quoteTime || current.quoteTime <= previous.quoteTime
    || previous.lastPrice == null || current.lastPrice == null
    || !Number.isFinite(previous.lastPrice) || !Number.isFinite(current.lastPrice)) {
    return { alerts, triggered: [] };
  }

  const triggered: PriceAlert[] = [];
  const updated = alerts.map((alert) => {
    if (!alert.armed || alert.contract !== current.contract) return alert;
    const crossed = alert.direction === "above"
      ? previous.lastPrice! < alert.price && current.lastPrice! >= alert.price
      : previous.lastPrice! > alert.price && current.lastPrice! <= alert.price;
    if (!crossed) return alert;
    const hit = { ...alert, armed: false, triggeredAt: current.quoteTime };
    triggered.push(hit);
    return hit;
  });
  return { alerts: triggered.length ? updated : alerts, triggered };
}
