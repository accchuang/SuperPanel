export type Overview = {
  symbol: string;
  date: string;
  long_change: number;
  short_change: number;
  oi_change: number;
  net_change: number;
  long_short_score: number;
  trend_state: "Bullish" | "Neutral" | "Bearish";
  top5_concentration: number;
  top10_concentration: number;
};

export type LeaderboardRow = {
  broker: string;
  rank: number;
  long_position: number;
  long_change: number;
  short_position: number;
  short_change: number;
  net_position: number;
  net_change: number;
  consecutive_long_add_days: number;
  consecutive_long_reduce_days: number;
};

export type BrokerTrend = {
  broker: string;
  points: { date: string; broker: string; net_position: number; long_change: number; short_change: number }[];
};

export type Strength = {
  long: number;
  short: number;
  net: number;
  net_long: number;
  net_short: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export type Evolution = {
  symbol: string;
  dates: string[];
  daily: { date: string; net_long: number; net_short: number; net: number; count: number; change: number | null }[];
  brokers: { broker: string; values: (number | null)[]; change: number | null; coverage: number }[];
};

export type CtaContract = {
  variety: string; contract: string; exchange: string; multiplier: number; tick_size: number;
  first_notice_date: string | null; last_trade_date: string | null; margin_rate: number; limit_ratio: number; is_active: boolean;
};

export type CtaNode = {
  node_name: string; status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN"; score: number | null; direction: string;
  positive_evidence: string[]; negative_evidence: string[]; missing_conditions: string[]; raw_metrics: Record<string, unknown>;
  conclusion: string; data_quality: string;
};

export type CtaReport = {
  id: string | null; contract: string; variety: string; generated_at: string; snapshot_time: string | null; rule_version: string;
  direction: string; trend_stage: string; trend_score: number | null; structure_score: number | null; entry_score: number | null; risk_score: number | null;
  system_state: string; data_quality: string; blocking_reasons: string[]; warnings: string[]; nodes: CtaNode[]; summary: string;
  entry: { pattern: string | null; entry_price: number | null; stop_price: number | null; target_price: number | null; rr_ratio: number | null } | null;
};

export type HumanDecision = { id: number; report_id: string; operator: string; decision: string; side: string | null; note: string; decided_at: string };

export type CtaBacktestPerformance = {
  horizon_trading_days: number; exit_date: string | null; entry_price: number; exit_price: number | null;
  raw_return_percent: number | null; directional_return_percent: number | null;
  outcome: "WIN" | "LOSS" | "FLAT" | "NOT_TRIGGERED" | "UNKNOWN";
};

export type CtaBacktest = {
  contract: string; variety: string; as_of_date: string; report: CtaReport; performance: CtaBacktestPerformance[];
};

export type LiveQuote = {
  variety: string; name: string; contract: string; exchange: string; sector: string; last_price: number | null;
  instrument_type?: "ACTUAL"; tq_symbol?: string | null; trading_day?: string | null;
  price_source?: "QUOTE" | "BAR_CLOSE" | "UNAVAILABLE";
  change: number | null; change_percent: number | null; volume: number | null; open_interest: number | null;
  open_interest_change: number | null; timeframe: MarketTimeframe;
  quote_time: string | null; status: "LIVE" | "CLOSED" | "DELAYED";
  price_points: { time: string; price: number }[];
  oi_points: { time: string; open_interest: number; change: number }[];
  bars?: { time: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; open_interest: number | null; oi_change: number | null; is_closed: boolean }[];
  daily_bars?: { time: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; open_interest: number | null; oi_change?: number | null; is_closed: boolean }[];
};

export type MarketTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "1d" | "3d";
export type LiveQuotes = {
  source: string; fetched_at: string; cache_age_seconds: number | null; connection_error: string | null;
  timeframe: MarketTimeframe; timeframe_label: string; data_mode: "LIVE" | "STATIC" | "WAITING"; quotes: LiveQuote[];
};
export type TerminalQuote = {
  source: string; fetched_at: string; cache_age_seconds: number | null; connection_error: string | null;
  timeframe: MarketTimeframe; timeframe_label: string; data_mode: "LIVE" | "STATIC" | "WAITING"; quote: LiveQuote;
};
export type WatchlistQuote = {
  contract: string; last_price: number | null; change_percent: number | null;
  quote_time: string | null; status: "LIVE" | "CLOSED" | "DELAYED";
};
export type WatchlistQuotes = {
  source: string; fetched_at: string; cache_age_seconds: number | null; connection_error: string | null;
  data_mode: "LIVE" | "STATIC" | "WAITING"; quotes: WatchlistQuote[];
};

export type PanoramaQuote = {
  variety: string; name: string; contract: string; exchange: string; sector: string; tq_symbol: string;
  trading_day: string | null; last_price: number | null; day_change_percent: number | null;
  five_day_change_percent: number | null; price_history: number[]; quote_time: string | null;
  price_source: "QUOTE" | "BAR_CLOSE" | "UNAVAILABLE"; status: "LIVE" | "CLOSED" | "DELAYED";
};
export type PanoramaQuotes = {
  source: string; fetched_at: string; cache_age_seconds: number | null; connection_error: string | null;
  data_mode: "LIVE" | "STATIC" | "WAITING"; universe_name: string; universe_size: number; quotes: PanoramaQuote[];
};

export type TrendPoint = { date: string; close: number; volume: number; open_interest: number };
export type TrendInstrument = {
  variety: string; name: string; contract: string; exchange: string; sector: string;
  direction: "UP" | "DOWN" | "SIDEWAYS" | "NEUTRAL" | "UNKNOWN";
  short_direction: "UP" | "DOWN" | "SIDEWAYS" | "UNKNOWN";
  setup_state: "CONTINUATION" | "PULLBACK" | "CONSOLIDATION" | "NEUTRAL" | "UNKNOWN";
  classification: "CONFIRMED_STEADY_UP" | "CONFIRMED_STEADY_DOWN" | "UPTREND_PULLBACK" | "DOWNTREND_PULLBACK" | "UPTREND_CONTINUATION" | "DOWNTREND_CONTINUATION" | "UPTREND_CONSOLIDATION" | "DOWNTREND_CONSOLIDATION" | "VOLUME_OI_RISING" | "STEADY_UP" | "STEADY_DOWN" | "OBSERVE" | "DATA_INCOMPLETE";
  data_quality: "COMPLETE" | "INCOMPLETE";
  is_steady: boolean; volume_rising: boolean; open_interest_rising: boolean;
  volume_signal: "THREE_DAY_RISING_AND_ABOVE_AVERAGE" | "THREE_DAY_RISING" | "ABOVE_RECENT_AVERAGE" | "NONE";
  open_interest_signal: "THREE_DAY_RISING_AND_ABOVE_AVERAGE" | "THREE_DAY_RISING" | "ABOVE_RECENT_AVERAGE" | "NONE";
  volume_relative_to_average: number | null; open_interest_relative_to_average: number | null;
  three_day_return: number | null; volume_growth: number | null; open_interest_growth: number | null;
  volume_baseline: number | null; open_interest_baseline: number | null;
  range_percent: number | null; stability_score: number | null;
  trend_score: number | null; score_breakdown: Record<string, number>;
  evidence: string[]; warnings: string[]; points: TrendPoint[];
};
export type TrendTracker = {
  source: string; fetched_at: string; cache_age_seconds: number | null; data_mode: "LIVE" | "STATIC" | "WAITING";
  connection_error: string | null; universe_name: string; universe_size: number; commodity_count: number;
  excluded_chemical_count: number; excluded_varieties: string[]; rubber_exceptions: string[]; sector_counts: Record<string, number>;
  lookback_days: number; completed_only: boolean; instruments: TrendInstrument[];
};

export type TrendBacktestSymbol = { variety: string; name: string; contract: string; exchange: string; sector: string };
export type TrendBacktestPerformance = {
  horizon_trading_days: number; exit_date: string | null; raw_return_percent: number | null;
  directional_return_percent: number | null; outcome: "WIN" | "LOSS" | "FLAT" | "NOT_TRIGGERED" | "UNKNOWN";
};
export type TrendBacktestStat = { sample_count: number; win_rate: number | null; average_directional_return: number | null };
export type TrendBacktestSummary = {
  variety: string; name: string; from_date: string | null; to_date: string | null; observations: number;
  price_structure_count: number; volume_oi_confirmed_count: number;
  horizons: { horizon_trading_days: number; price_structure: TrendBacktestStat; volume_oi_confirmed: TrendBacktestStat }[];
};
export type TrendBacktest = {
  source: string; fetched_at: string; data_mode: string; variety: string; name: string; contract: string; sector: string;
  as_of_date: string; signal_active: boolean; signal: TrendInstrument; performance: TrendBacktestPerformance[];
};

async function get<T>(path: string, timeoutMs = 20000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error("无法连接数据服务，请确认后端已启动后刷新重试。");
  }
  if (!response.ok) {
    throw new Error(`数据请求失败（HTTP ${response.status}），请检查后端服务后刷新重试。`);
  }
  return response.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("无法连接数据服务，请确认后端已启动后刷新重试。");
  }
  if (!response.ok) throw new Error(`数据请求失败（HTTP ${response.status}），请检查后端服务后刷新重试。`);
  return response.json();
}

export const api = {
  evolution: (symbol: string, days: number, start: string, end: string) =>
    get<Evolution>(`/evolution?${new URLSearchParams({ symbol, days: String(days), ...(start ? { start } : {}), ...(end ? { end } : {}) })}`),
  symbols: () => get<{ symbols: string[] }>("/symbols"),
  dates: (symbol: string) => get<{ dates: string[]; latest: string | null }>(`/dates?symbol=${symbol}`),
  overview: (symbol: string, date?: string) => get<Overview>(`/overview?symbol=${symbol}${date ? `&date=${date}` : ""}`),
  leaderboard: (symbol: string, date?: string) =>
    get<LeaderboardRow[]>(`/leaderboard?${new URLSearchParams({ symbol, limit: "50", ...(date ? { date } : {}) })}`),
  trend: (symbol: string, date?: string) => get<BrokerTrend[]>(`/trend?symbol=${symbol}${date ? `&date=${date}` : ""}`),
  strength: (symbol: string, date?: string) =>
    get<Strength>(`/strength?symbol=${symbol}${date ? `&date=${date}` : ""}`),
  summary: (symbol: string, date?: string) =>
    get<{ symbol: string; date: string; summary: string }>(`/summary?symbol=${symbol}${date ? `&date=${date}` : ""}`),
  ctaContracts: () => get<CtaContract[]>("/cta/contracts"),
  ctaLatestReport: (contract: string) => get<CtaReport | null>(`/cta/reports/latest?contract=${encodeURIComponent(contract)}`),
  ctaEvaluate: (contract: string) => post<CtaReport>(`/cta/evaluate?contract=${encodeURIComponent(contract)}`),
  ctaBacktestDates: (contract: string) => get<{ contract: string; dates: string[] }>(`/cta/backtest/dates?contract=${encodeURIComponent(contract)}`),
  ctaBacktest: (contract: string, asOf: string) => get<CtaBacktest>(`/cta/backtest?${new URLSearchParams({ contract, as_of: asOf })}`),
  ctaHumanDecisions: (reportId: string) => get<HumanDecision[]>(`/cta/reports/${reportId}/human-decisions`),
  ctaRecordDecision: (reportId: string, decision: { operator: string; decision: string; side: string | null; note: string }) => post<HumanDecision>(`/cta/reports/${reportId}/human-decisions`, decision),
  liveQuotes: (timeframe: MarketTimeframe) => get<LiveQuotes>(`/market/live?timeframe=${timeframe}`, 35000),
  terminalQuote: (contract: string, timeframe: MarketTimeframe) => get<TerminalQuote>(`/market/terminal?${new URLSearchParams({ contract, timeframe })}`, 35000),
  watchlistQuotes: () => get<WatchlistQuotes>("/market/watchlist", 35000),
  marketPanorama: () => get<PanoramaQuotes>("/market/panorama", 35000),
  trendTracker: () => get<TrendTracker>("/market/trends", 35000),
  trendBacktestSymbols: () => get<{ source: string; fetched_at: string; data_mode: string; history_days: number; symbols: TrendBacktestSymbol[] }>("/market/trends/backtest/symbols", 35000),
  trendBacktestDates: (variety: string) => get<{ variety: string; dates: string[] }>(`/market/trends/backtest/dates?variety=${encodeURIComponent(variety)}`, 35000),
  trendBacktestSummary: (variety: string) => get<TrendBacktestSummary>(`/market/trends/backtest/summary?variety=${encodeURIComponent(variety)}`, 35000),
  trendBacktest: (variety: string, asOf: string) => get<TrendBacktest>(`/market/trends/backtest?${new URLSearchParams({ variety, as_of: asOf })}`, 35000),
};
