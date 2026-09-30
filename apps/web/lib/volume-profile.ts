export type VolumeProfileBar = {
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type VolumeProfileBin = {
  low: number;
  high: number;
  volume: number;
};

export type VolumeProfile = {
  bins: VolumeProfileBin[];
  totalVolume: number;
  poc: number;
  vah: number;
  val: number;
};

const DEFAULT_BIN_COUNT = 48;
const MAX_BIN_COUNT = 160;
const INITIAL_VISIBLE_BAR_COUNT = 180;

export function selectVisibleProfileBars<T>(
  bars: T[],
  range: { from: number; to: number } | null,
): T[] {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return bars.slice(-INITIAL_VISIBLE_BAR_COUNT);
  }
  const firstIndex = Math.max(0, Math.floor(Math.min(range.from, range.to)));
  const lastIndex = Math.min(bars.length - 1, Math.ceil(Math.max(range.from, range.to)));
  return lastIndex < firstIndex ? [] : bars.slice(firstIndex, lastIndex + 1);
}

/**
 * Estimate volume-at-price from OHLCV bars by assigning each bar's volume to
 * its typical price. This is not tick-level volume-at-price or position cost.
 */
export function buildVolumeProfile(
  bars: VolumeProfileBar[],
  requestedBinCount = DEFAULT_BIN_COUNT,
  valueAreaRatio = 0.7,
): VolumeProfile | null {
  const validBars = bars.flatMap((bar) => {
    const { high, low, close, volume } = bar;
    if (
      high == null || low == null || volume == null ||
      !Number.isFinite(high) || !Number.isFinite(low) ||
      !Number.isFinite(close) || !Number.isFinite(volume) ||
      high < low || close < low || close > high || volume <= 0
    ) return [];
    return [{ high, low, typicalPrice: (high + low + close) / 3, volume }];
  });
  if (!validBars.length) return null;

  const binCount = Number.isFinite(requestedBinCount)
    ? Math.max(1, Math.min(MAX_BIN_COUNT, Math.floor(requestedBinCount)))
    : DEFAULT_BIN_COUNT;
  const minimumPrice = Math.min(...validBars.map((bar) => bar.low));
  const maximumPrice = Math.max(...validBars.map((bar) => bar.high));
  const totalVolume = validBars.reduce((total, bar) => total + bar.volume, 0);
  const ratio = Number.isFinite(valueAreaRatio) ? Math.max(0, Math.min(1, valueAreaRatio)) : 0.7;

  if (maximumPrice === minimumPrice) {
    return {
      bins: [{ low: minimumPrice, high: maximumPrice, volume: totalVolume }],
      totalVolume,
      poc: minimumPrice,
      vah: maximumPrice,
      val: minimumPrice,
    };
  }

  const priceStep = (maximumPrice - minimumPrice) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    low: minimumPrice + priceStep * index,
    high: index === binCount - 1 ? maximumPrice : minimumPrice + priceStep * (index + 1),
    volume: 0,
  }));
  for (const bar of validBars) {
    const index = Math.min(binCount - 1, Math.floor((bar.typicalPrice - minimumPrice) / priceStep));
    bins[index].volume += bar.volume;
  }

  let pocIndex = 0;
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index].volume > bins[pocIndex].volume) pocIndex = index;
  }

  let lowerIndex = pocIndex;
  let upperIndex = pocIndex;
  let valueAreaVolume = bins[pocIndex].volume;
  const targetVolume = totalVolume * ratio;
  while (valueAreaVolume < targetVolume && (lowerIndex > 0 || upperIndex < bins.length - 1)) {
    const lowerVolume = lowerIndex > 0 ? bins[lowerIndex - 1].volume : -1;
    const upperVolume = upperIndex < bins.length - 1 ? bins[upperIndex + 1].volume : -1;
    if (upperVolume >= lowerVolume) {
      upperIndex += 1;
      valueAreaVolume += bins[upperIndex].volume;
    } else {
      lowerIndex -= 1;
      valueAreaVolume += bins[lowerIndex].volume;
    }
  }

  return {
    bins,
    totalVolume,
    poc: (bins[pocIndex].low + bins[pocIndex].high) / 2,
    vah: bins[upperIndex].high,
    val: bins[lowerIndex].low,
  };
}
