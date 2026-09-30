const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/back-to-back-signals.ts");
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const signalsModule = new Module(sourcePath, module);
signalsModule.filename = sourcePath;
signalsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
signalsModule._compile(compiled, sourcePath);

const {
  detectBackToBackSignals,
  buildBackToBackKeyLevels,
  buildBackToBackVolatilityEligibility,
} = signalsModule.exports;

function candle(time, open, high, low, close, is_closed = true) {
  return { time, open, high, low, close, is_closed };
}

test("marks the second candle of an opposing pair with over half body overlap at a key level", () => {
  assert.equal(typeof detectBackToBackSignals, "function", "back-to-back detection is implemented");
  const bars = [candle("down", 110, 112, 98, 100), candle("up", 103, 115, 101, 113)];
  assert.deepEqual(detectBackToBackSignals(bars, [
    { levels: [], tolerance: 1 },
    { levels: [101], tolerance: 0 },
  ]), [{ time: "up", direction: "bullish", overlapRatio: 0.7, keyLevel: 101 }]);

  assert.deepEqual(detectBackToBackSignals([
    candle("up", 100, 112, 99, 110),
    candle("down", 113, 115, 101, 103),
  ], [{ levels: [], tolerance: 1 }, { levels: [110], tolerance: 0 }]), [
    { time: "down", direction: "bearish", overlapRatio: 0.7, keyLevel: 110 },
  ]);
});

test("requires strictly more than 50 percent overlap and proximity to a key level", () => {
  assert.equal(typeof detectBackToBackSignals, "function", "back-to-back detection is implemented");
  const exactHalf = [candle("down", 110, 112, 98, 100), candle("up", 105, 116, 104, 115)];
  assert.deepEqual(detectBackToBackSignals(exactHalf, [
    { levels: [], tolerance: 1 }, { levels: [104], tolerance: 0 },
  ]), []);

  const noNearbyLevel = [candle("down", 110, 112, 98, 100), candle("up", 103, 115, 101, 113)];
  assert.deepEqual(detectBackToBackSignals(noNearbyLevel, [
    { levels: [], tolerance: 1 }, { levels: [200], tolerance: 1 },
  ]), []);
});

test("measures overlap against the longer candle body", () => {
  const longBody = candle("up", 100, 122, 99, 120);
  const containedShortBody = candle("small-down", 110, 111, 104, 105);
  assert.deepEqual(detectBackToBackSignals([longBody, containedShortBody], [
    { levels: [], tolerance: 0 }, { levels: [110], tolerance: 0 },
  ]), []);

  const enoughOverlap = candle("down", 115, 116, 101, 102);
  assert.deepEqual(detectBackToBackSignals([longBody, enoughOverlap], [
    { levels: [], tolerance: 0 }, { levels: [110], tolerance: 0 },
  ]), [{ time: "down", direction: "bearish", overlapRatio: 0.65, keyLevel: 110 }]);
});

test("does not count wick overlap toward the candle body overlap ratio", () => {
  const bars = [
    candle("up", 100, 150, 90, 110),
    candle("down", 120, 140, 95, 115),
  ];
  assert.deepEqual(detectBackToBackSignals(bars, [
    { levels: [], tolerance: 0 }, { levels: [120], tolerance: 0 },
  ]), []);
});

test("ignores same-direction, doji, and still-forming bars", () => {
  assert.equal(typeof detectBackToBackSignals, "function", "back-to-back detection is implemented");
  const levels = Array.from({ length: 4 }, () => ({ levels: [100], tolerance: 100 }));
  assert.deepEqual(detectBackToBackSignals([
    candle("a", 100, 112, 98, 110),
    candle("b", 101, 114, 99, 111),
    candle("c", 100, 110, 100, 100),
    candle("forming", 103, 115, 101, 113, false),
  ], levels), []);
});

test("builds MA20, MA60, channel and prior 20-bar swing levels with a half-ATR tolerance", () => {
  assert.equal(typeof buildBackToBackKeyLevels, "function", "key level construction is implemented");
  const bars = Array.from({ length: 61 }, (_, index) => {
    const close = index + 100;
    return candle(String(index), close, close + 1, close - 1, close);
  });
  const channels = bars.map(() => ({ upper: 170, lower: 90, atr: 8 }));
  const keyLevels = buildBackToBackKeyLevels(bars, channels);

  assert.deepEqual(keyLevels[60], {
    levels: [170, 90, 150.5, 130.5, 159, 138],
    tolerance: 4,
  });
});

test("detects a valid reversal when the prior swing high is within half an ATR", () => {
  const bars = Array.from({ length: 61 }, (_, index) => candle(String(index), 0, index === 50 ? 147 : 0, 0, 0));
  bars[59] = candle("up", 90, 101, 89, 100);
  bars[60] = candle("down", 101, 102, 91, 92);
  const channels = bars.map(() => ({ upper: 1000, lower: -1000, atr: 100 }));

  const levels = buildBackToBackKeyLevels(bars, channels);
  assert.deepEqual(detectBackToBackSignals(bars, levels), [
    { time: "down", direction: "bearish", overlapRatio: 0.8, keyLevel: 147 },
  ]);
});

test("filters low relative volatility using the prior 60 bars while keeping a volatility rebound", () => {
  assert.equal(typeof buildBackToBackVolatilityEligibility, "function");
  const bars = Array.from({ length: 62 }, (_, index) => candle(String(index), 100, 110, 90, 100));
  bars[60] = candle("up", 100, 110, 90, 110);
  bars[61] = candle("down", 109, 110, 100, 101);
  const keyLevels = bars.map(() => ({ levels: [105], tolerance: 0 }));

  const quietEligibility = buildBackToBackVolatilityEligibility(bars);
  assert.equal(quietEligibility[59], false);
  assert.equal(quietEligibility[61], false);
  assert.deepEqual(detectBackToBackSignals(bars, keyLevels, quietEligibility), []);

  const rebound = [...bars];
  rebound[61] = { ...bars[61], high: 120, low: 80 };
  const reboundEligibility = buildBackToBackVolatilityEligibility(rebound);
  assert.equal(reboundEligibility[61], true);
  assert.deepEqual(detectBackToBackSignals(rebound, keyLevels, reboundEligibility), [
    { time: "down", direction: "bearish", overlapRatio: 0.8, keyLevel: 105 },
  ]);

  const scaled = rebound.map((bar) => ({
    ...bar,
    open: bar.open * 10,
    high: bar.high * 10,
    low: bar.low * 10,
    close: bar.close * 10,
  }));
  assert.deepEqual(buildBackToBackVolatilityEligibility(scaled), reboundEligibility);
});
