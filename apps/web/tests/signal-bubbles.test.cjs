const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/signal-bubbles.ts");
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const bubblesModule = new Module(sourcePath, module);
bubblesModule.filename = sourcePath;
bubblesModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
bubblesModule._compile(compiled, sourcePath);

const { mergeSignalBubbles, measureSignalBubble, selectSignalFactors } = bubblesModule.exports;

test("combines all signal factors on one candle into one direction-aware bubble", () => {
  assert.equal(typeof mergeSignalBubbles, "function");
  const factors = [
    { time: "2026-09-16", kind: "volume", label: "量1", detail: "成交量第1：100手", color: "blue" },
    { time: "2026-09-16", kind: "oi", label: "OI↑", detail: "持仓量变化第2：增加20手", color: "green" },
    { time: "2026-09-16", kind: "backToBack", label: "背↓", detail: "背靠背看跌", color: "red", direction: "bearish" },
    { time: "2026-09-17", kind: "body", label: "实体2", detail: "实体第2：50点", color: "gold" },
  ];

  assert.deepEqual(mergeSignalBubbles(factors), [
    {
      time: "2026-09-16",
      factors: [
        { kind: "volume", label: "量1", detail: "成交量第1：100手", color: "blue" },
        { kind: "oi", label: "OI↑", detail: "持仓量变化第2：增加20手", color: "green" },
        { kind: "backToBack", label: "背↓", detail: "背靠背看跌", color: "red", direction: "bearish" },
      ],
      direction: "bearish",
      position: "above",
    },
    {
      time: "2026-09-17",
      factors: [{ kind: "body", label: "实体2", detail: "实体第2：50点", color: "gold" }],
      direction: null,
      position: "above",
    },
  ]);
});

test("lays multiple factor labels out on separate rows inside a compact bubble", () => {
  assert.equal(typeof measureSignalBubble, "function");
  assert.deepEqual(measureSignalBubble([18, 24, 12]), {
    width: 36,
    height: 44,
    rowCenters: [10, 22, 34],
  });
});

test("shows only selected signal categories and removes every factor when cleared", () => {
  const factors = [
    { time: "2026-09-16", kind: "volume", label: "量1", detail: "成交量", color: "blue" },
    { time: "2026-09-16", kind: "body", label: "实体1", detail: "实体", color: "gold" },
    { time: "2026-09-17", kind: "oi", label: "OI+", detail: "持仓量变化", color: "green" },
    { time: "2026-09-17", kind: "backToBack", label: "背↑", detail: "背靠背", color: "red", direction: "bullish" },
  ];

  assert.deepEqual(selectSignalFactors(factors, ["body", "backToBack"]), [factors[1], factors[3]]);
  assert.deepEqual(selectSignalFactors(factors, []), []);
});
