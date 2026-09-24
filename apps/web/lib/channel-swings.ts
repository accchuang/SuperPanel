export type ChannelSwingCandle<TTime> = {
  time: TTime;
  high: number;
  low: number;
};

export type ChannelSwingBand = {
  upper: number;
  lower: number;
  atr: number;
};

export type ChannelSwingPoint<TTime> = {
  time: TTime;
  value: number;
  rail: "upper" | "lower";
};

function validBand(band: ChannelSwingBand) {
  return Number.isFinite(band.upper)
    && Number.isFinite(band.lower)
    && Number.isFinite(band.atr)
    && band.atr >= 0;
}

export function buildChannelSwingPath<TTime>(
  candles: ChannelSwingCandle<TTime>[],
  bands: ChannelSwingBand[],
): ChannelSwingPoint<TTime>[] {
  const path: ChannelSwingPoint<TTime>[] = [];
  let active: ChannelSwingPoint<TTime> | null = null;

  for (let index = 0; index < Math.min(candles.length, bands.length); index += 1) {
    const candle = candles[index];
    const band = bands[index];
    if (!validBand(band) || !Number.isFinite(candle.low) || !Number.isFinite(candle.high)) continue;

    const touchesLower = candle.low <= band.lower + band.atr;
    const touchesUpper = candle.high >= band.upper - band.atr;
    if (!active) {
      if (touchesLower === touchesUpper) continue;
      active = touchesLower
        ? { time: candle.time, value: candle.low, rail: "lower" }
        : { time: candle.time, value: candle.high, rail: "upper" };
      continue;
    }

    if (active.rail === "lower") {
      if (touchesLower && candle.low < active.value) {
        active = { time: candle.time, value: candle.low, rail: "lower" };
      }
      if (touchesUpper && !touchesLower) {
        path.push(active);
        active = { time: candle.time, value: candle.high, rail: "upper" };
      }
      continue;
    }

    if (touchesUpper && candle.high > active.value) {
      active = { time: candle.time, value: candle.high, rail: "upper" };
    }
    if (touchesLower && !touchesUpper) {
      path.push(active);
      active = { time: candle.time, value: candle.low, rail: "lower" };
    }
  }

  return active ? [...path, active] : path;
}
