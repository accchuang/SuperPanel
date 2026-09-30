export type SignalBubbleDirection = "bullish" | "bearish";
export type SignalBubbleFactorKind = "volume" | "body" | "oi" | "backToBack";

export type SignalBubbleFactor = {
  time: string;
  kind: SignalBubbleFactorKind;
  label: string;
  detail: string;
  color: string;
  direction?: SignalBubbleDirection;
};

export type SignalBubble = {
  time: string;
  factors: Omit<SignalBubbleFactor, "time">[];
  direction: SignalBubbleDirection | null;
  position: "above" | "below";
};

export function measureSignalBubble(labelWidths: number[]) {
  const rowHeight = 12;
  const paddingX = 6;
  const paddingY = 4;
  return {
    width: Math.max(0, ...labelWidths) + paddingX * 2,
    height: labelWidths.length * rowHeight + paddingY * 2,
    rowCenters: labelWidths.map((_, index) => paddingY + rowHeight * index + rowHeight / 2),
  };
}

export function selectSignalFactors(
  factors: SignalBubbleFactor[],
  selectedKinds: readonly SignalBubbleFactorKind[],
): SignalBubbleFactor[] {
  const selected = new Set(selectedKinds);
  return factors.filter((factor) => selected.has(factor.kind));
}

export function mergeSignalBubbles(factors: SignalBubbleFactor[]): SignalBubble[] {
  const bubbles = new Map<string, SignalBubble>();
  for (const factor of factors) {
    let bubble = bubbles.get(factor.time);
    if (!bubble) {
      bubble = { time: factor.time, factors: [], direction: null, position: "above" };
      bubbles.set(factor.time, bubble);
    }
    bubble.factors.push({
      kind: factor.kind,
      label: factor.label,
      detail: factor.detail,
      color: factor.color,
      ...(factor.direction ? { direction: factor.direction } : {}),
    });
    if (factor.kind === "backToBack" && factor.direction) {
      bubble.direction = factor.direction;
      bubble.position = factor.direction === "bullish" ? "below" : "above";
    }
  }
  return [...bubbles.values()];
}
