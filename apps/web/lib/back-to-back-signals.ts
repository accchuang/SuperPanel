export type BackToBackCandle<TTime = string | number> = {
  time: TTime;
  open: number;
  high: number;
  low: number;
  close: number;
  is_closed?: boolean;
};

export type BackToBackChannel = { upper: number; lower: number; atr: number };
export type BackToBackKeyLevels = { levels: number[]; tolerance: number };
export type BackToBackSignal<TTime = string | number> = {
  time: TTime;
  direction: "bullish" | "bearish";
  overlapRatio: number;
  keyLevel: number;
};

const VOLATILITY_ATR_PERIOD = 14;
const VOLATILITY_LOOKBACK = 60;
const VOLATILITY_PERCENTILE_INDEX = Math.ceil(VOLATILITY_LOOKBACK * 0.3) - 1;

export function buildBackToBackVolatilityEligibility<TTime>(candles: BackToBackCandle<TTime>[]): boolean[] {
  const multiplier = 2 / (VOLATILITY_ATR_PERIOD + 1);
  let averageTrueRange: number | null = null;
  const normalizedAtr = candles.map((candle, index) => {
    const previousClose = index === 0 ? candle.close : candles[index - 1].close;
    if (![candle.high, candle.low, candle.close, previousClose].every(Number.isFinite)
      || candle.high < candle.low || candle.close <= 0 || previousClose <= 0) {
      averageTrueRange = null;
      return null;
    }
    const trueRange = index === 0
      ? candle.high - candle.low
      : Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
    averageTrueRange = averageTrueRange == null
      ? trueRange
      : trueRange * multiplier + averageTrueRange * (1 - multiplier);
    return averageTrueRange / candle.close;
  });

  return normalizedAtr.map((value, index) => {
    if (index < VOLATILITY_LOOKBACK || value == null) return false;
    const history = normalizedAtr.slice(index - VOLATILITY_LOOKBACK, index)
      .filter((historical): historical is number => historical != null);
    if (history.length !== VOLATILITY_LOOKBACK) return false;
    history.sort((left, right) => left - right);
    return value >= history[VOLATILITY_PERCENTILE_INDEX];
  });
}

function movingAverage<TTime>(candles: BackToBackCandle<TTime>[], endIndex: number, period: number) {
  const startIndex = endIndex - period + 1;
  if (startIndex < 0) return null;
  let sum = 0;
  for (let index = startIndex; index <= endIndex; index += 1) sum += candles[index].close;
  return sum / period;
}

export function buildBackToBackKeyLevels<TTime>(
  candles: BackToBackCandle<TTime>[],
  channel: BackToBackChannel[],
  swingLookback = 20,
): BackToBackKeyLevels[] {
  return candles.map((candle, index) => {
    const bands = channel[index];
    const levels = [
      bands?.upper,
      bands?.lower,
      movingAverage(candles, index, 20),
      movingAverage(candles, index, 60),
    ];
    const priorStart = Math.max(0, index - swingLookback - 1);
    const priorEnd = Math.max(0, index - 1);
    if (priorEnd > priorStart) {
      let swingHigh = Number.NEGATIVE_INFINITY;
      let swingLow = Number.POSITIVE_INFINITY;
      for (let priorIndex = priorStart; priorIndex < priorEnd; priorIndex += 1) {
        swingHigh = Math.max(swingHigh, candles[priorIndex].high);
        swingLow = Math.min(swingLow, candles[priorIndex].low);
      }
      levels.push(swingHigh, swingLow);
    }
    return {
      levels: levels.filter((level): level is number => typeof level === "number" && Number.isFinite(level)),
      tolerance: Number.isFinite(bands?.atr) ? Math.max(0, bands.atr * 0.5) : 0,
    };
  });
}

export function detectBackToBackSignals<TTime>(
  candles: BackToBackCandle<TTime>[],
  keyLevels: BackToBackKeyLevels[],
  volatilityEligibility?: readonly boolean[],
): BackToBackSignal<TTime>[] {
  const signals: BackToBackSignal<TTime>[] = [];
  for (let index = 1; index < Math.min(candles.length, keyLevels.length); index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (previous.is_closed === false || current.is_closed === false) continue;
    if (volatilityEligibility && volatilityEligibility[index] !== true) continue;
    if (![previous.open, previous.close, current.open, current.close, current.high, current.low].every(Number.isFinite)) continue;

    const previousDirection = Math.sign(previous.close - previous.open);
    const currentDirection = Math.sign(current.close - current.open);
    if (previousDirection === 0 || currentDirection === 0 || previousDirection === currentDirection) continue;

    const previousBodyLow = Math.min(previous.open, previous.close);
    const previousBodyHigh = Math.max(previous.open, previous.close);
    const currentBodyLow = Math.min(current.open, current.close);
    const currentBodyHigh = Math.max(current.open, current.close);
    const longerBody = Math.max(previousBodyHigh - previousBodyLow, currentBodyHigh - currentBodyLow);
    if (longerBody <= 0) continue;
    const overlap = Math.max(0, Math.min(previousBodyHigh, currentBodyHigh) - Math.max(previousBodyLow, currentBodyLow));
    const overlapRatio = overlap / longerBody;
    if (overlapRatio <= 0.5) continue;

    const location = keyLevels[index];
    if (!Number.isFinite(location.tolerance) || location.tolerance < 0) continue;
    const keyLevel = location.levels.find((level) => Number.isFinite(level)
      && level >= current.low - location.tolerance
      && level <= current.high + location.tolerance);
    if (keyLevel == null) continue;

    signals.push({
      time: current.time,
      direction: currentDirection > 0 ? "bullish" : "bearish",
      overlapRatio,
      keyLevel,
    });
  }
  return signals;
}
