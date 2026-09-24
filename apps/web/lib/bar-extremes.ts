export type MarketBarForRanking = {
  time: string;
  open: number | null;
  close: number;
  volume: number | null;
  oi_change?: number | null;
  is_closed: boolean;
};

export type RankedBarExtreme = {
  time: string;
  volume: number | null;
  bodySize: number | null;
  volumeRank?: number;
  bodyRank?: number;
};

export type BarExtremeMarker = {
  time: string;
  kind: "volume" | "body";
  rank: number;
};

export type OpenInterestExtreme = {
  time: string;
  change: number;
  rank: number;
};

type Candidate = { index: number; value: number };

function topRanks(candidates: Candidate[], topCount: number) {
  return candidates
    .sort((left, right) => right.value - left.value || right.index - left.index)
    .slice(0, topCount);
}

export function rankRecentBarExtremes(
  bars: MarketBarForRanking[],
  lookback = 45,
  topCount = 3,
): RankedBarExtreme[] {
  if (lookback <= 0 || topCount <= 0) return [];
  const closedBars = bars.filter((bar) => bar.is_closed).slice(-lookback);
  const volumes: Candidate[] = [];
  const bodies: Candidate[] = [];

  closedBars.forEach((bar, index) => {
    if (typeof bar.volume === "number" && Number.isFinite(bar.volume) && bar.volume >= 0) {
      volumes.push({ index, value: bar.volume });
    }
    if (typeof bar.open === "number" && Number.isFinite(bar.open) && Number.isFinite(bar.close)) {
      bodies.push({ index, value: Math.abs(bar.close - bar.open) });
    }
  });

  const ranks = new Map<number, { volumeRank?: number; bodyRank?: number }>();
  topRanks(volumes, topCount).forEach(({ index }, rank) => {
    ranks.set(index, { ...ranks.get(index), volumeRank: rank + 1 });
  });
  topRanks(bodies, topCount).forEach(({ index }, rank) => {
    ranks.set(index, { ...ranks.get(index), bodyRank: rank + 1 });
  });

  return [...ranks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, barRanks]) => {
      const bar = closedBars[index];
      const bodySize = typeof bar.open === "number" && Number.isFinite(bar.open) && Number.isFinite(bar.close)
        ? Math.abs(bar.close - bar.open)
        : null;
      return {
        time: bar.time,
        volume: typeof bar.volume === "number" && Number.isFinite(bar.volume) ? bar.volume : null,
        bodySize,
        ...barRanks,
      };
    });
}

export function buildBarExtremeMarkers(rankedBars: RankedBarExtreme[]): BarExtremeMarker[] {
  return rankedBars.flatMap((bar) => [
    ...(bar.volumeRank == null ? [] : [{ time: bar.time, kind: "volume" as const, rank: bar.volumeRank }]),
    ...(bar.bodyRank == null ? [] : [{ time: bar.time, kind: "body" as const, rank: bar.bodyRank }]),
  ]);
}

export function rankRecentOpenInterestChanges(
  bars: MarketBarForRanking[],
  lookback = 45,
  topCount = 3,
): OpenInterestExtreme[] {
  if (lookback <= 0 || topCount <= 0) return [];
  const closedBars = bars.filter((bar) => bar.is_closed).slice(-lookback);
  const candidates = closedBars.flatMap((bar, index) =>
    typeof bar.oi_change === "number" && Number.isFinite(bar.oi_change) && bar.oi_change !== 0
      ? [{ index, value: Math.abs(bar.oi_change) }]
      : []
  );
  return topRanks(candidates, topCount).map(({ index }, rank) => ({
    time: closedBars[index].time,
    change: closedBars[index].oi_change as number,
    rank: rank + 1,
  }));
}
