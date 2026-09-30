const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/chart-drawings.ts");
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const drawingsModule = new Module(sourcePath, module);
drawingsModule.filename = sourcePath;
drawingsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
drawingsModule._compile(compiled, sourcePath);

const { placeChartDrawing, parseChartDrawings, chartDrawingsStorageKey, undoChartDrawing } = drawingsModule.exports;

test("horizontal click creates a full-width line at the selected price", () => {
  assert.equal(typeof placeChartDrawing, "function", "chart drawing placement is implemented");
  const result = placeChartDrawing([], "horizontal", { time: 10, price: 4050 }, null, "line-1");
  assert.deepEqual(result, {
    drawings: [{ id: "line-1", kind: "horizontal", price: 4050 }],
    pendingPoint: null,
  });
});

test("trendline is committed only after two chart points are selected", () => {
  assert.equal(typeof placeChartDrawing, "function", "chart drawing placement is implemented");
  const first = { time: 10, price: 4050 };
  const second = { time: 20, price: 4125 };
  const pending = placeChartDrawing([], "trendline", first, null, "unused");
  assert.deepEqual(pending, { drawings: [], pendingPoint: first });
  assert.deepEqual(placeChartDrawing(pending.drawings, "trendline", second, pending.pendingPoint, "line-2"), {
    drawings: [{ id: "line-2", kind: "trendline", start: first, end: second }],
    pendingPoint: null,
  });
});

test("saved drawings are validated and isolated by contract and timeframe", () => {
  assert.equal(typeof parseChartDrawings, "function", "saved chart drawings are parsed");
  const saved = JSON.stringify([
    { id: "line-1", kind: "horizontal", price: 4050 },
    { id: "broken", kind: "trendline", start: { time: 10, price: 12 }, end: { time: "bad", price: 13 } },
  ]);
  assert.deepEqual(parseChartDrawings(saved), [{ id: "line-1", kind: "horizontal", price: 4050 }]);
  assert.equal(chartDrawingsStorageKey("MA2611", "30m"), "market-terminal.drawings.v1:MA2611:30m");
});

test("undo removes only the most recently added drawing", () => {
  assert.equal(typeof undoChartDrawing, "function", "chart drawing undo is implemented");
  const lines = [
    { id: "line-1", kind: "horizontal", price: 4050 },
    { id: "line-2", kind: "horizontal", price: 4100 },
  ];
  assert.deepEqual(undoChartDrawing(lines), [lines[0]]);
  assert.deepEqual(undoChartDrawing([]), []);
});
