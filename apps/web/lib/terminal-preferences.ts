import type { MarketTimeframe } from "./api";

export type SubchartMode = "oi" | "volume";

export type TerminalPreferences = {
  contract: string;
  timeframe: MarketTimeframe;
  subchartMode: SubchartMode;
};

export const TERMINAL_PREFERENCES_KEY = "market-terminal.preferences.v1";

export function resolveTerminalPreferences(
  raw: string | null,
  defaults: TerminalPreferences,
  validContracts: readonly string[],
  validTimeframes: readonly MarketTimeframe[],
): TerminalPreferences {
  if (!raw) return defaults;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    const values = saved as Record<string, unknown>;
    return {
      contract: typeof values.contract === "string" && validContracts.includes(values.contract)
        ? values.contract : defaults.contract,
      timeframe: typeof values.timeframe === "string" && validTimeframes.includes(values.timeframe as MarketTimeframe)
        ? values.timeframe as MarketTimeframe : defaults.timeframe,
      subchartMode: values.subchartMode === "oi" || values.subchartMode === "volume"
        ? values.subchartMode : defaults.subchartMode,
    };
  } catch {
    return defaults;
  }
}
