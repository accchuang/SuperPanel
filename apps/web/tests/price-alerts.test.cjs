const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/price-alerts.ts");
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const alertsModule = new Module(sourcePath, module);
alertsModule.filename = sourcePath;
alertsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
alertsModule._compile(compiled, sourcePath);

const { checkPriceAlerts, parsePriceAlerts } = alertsModule.exports;

const rising = { id: "a", contract: "MA2611", price: 3300, direction: "above", armed: true, triggeredAt: null };
const falling = { id: "b", contract: "MA2611", price: 3200, direction: "below", armed: true, triggeredAt: null };
const otherContract = { id: "c", contract: "P2701", price: 9000, direction: "above", armed: true, triggeredAt: null };

test("fires an armed upward price alert once when a newer live quote crosses its level", () => {
  assert.equal(typeof checkPriceAlerts, "function");
  const result = checkPriceAlerts(
    [rising, falling, otherContract],
    { contract: "MA2611", lastPrice: 3298, quoteTime: "2026-09-29 09:00:00", status: "LIVE" },
    { contract: "MA2611", lastPrice: 3302, quoteTime: "2026-09-29 09:00:06", status: "LIVE" },
  );
  assert.deepEqual(result.triggered.map((alert) => alert.id), ["a"]);
  assert.deepEqual(result.alerts, [
    { ...rising, armed: false, triggeredAt: "2026-09-29 09:00:06" },
    falling,
    otherContract,
  ]);
});

test("does not fire on repeated, stale, or non-live quotes", () => {
  const previous = { contract: "MA2611", lastPrice: 3298, quoteTime: "2026-09-29 09:00:06", status: "LIVE" };
  for (const current of [
    { ...previous, lastPrice: 3302 },
    { ...previous, lastPrice: 3302, quoteTime: "2026-09-29 08:59:59" },
    { ...previous, lastPrice: 3302, quoteTime: "2026-09-29 09:00:07", status: "CLOSED" },
  ]) {
    assert.deepEqual(checkPriceAlerts([rising], previous, current), { alerts: [rising], triggered: [] });
  }
});

test("fires a downward crossing but never repeats an already triggered alert", () => {
  const result = checkPriceAlerts(
    [falling, { ...rising, armed: false, triggeredAt: "2026-09-29 09:00:01" }],
    { contract: "MA2611", lastPrice: 3201, quoteTime: "2026-09-29 09:00:06", status: "LIVE" },
    { contract: "MA2611", lastPrice: 3199, quoteTime: "2026-09-29 09:00:07", status: "LIVE" },
  );
  assert.deepEqual(result.triggered.map((alert) => alert.id), ["b"]);
  assert.equal(result.alerts[0].armed, false);
  assert.equal(result.alerts[1].triggeredAt, "2026-09-29 09:00:01");
});

test("restores only valid contract-specific saved alerts", () => {
  assert.equal(typeof parsePriceAlerts, "function");
  assert.deepEqual(parsePriceAlerts(JSON.stringify([
    rising,
    { ...rising, id: "wrong-contract", contract: "OTHER" },
    { ...rising, id: "bad-price", price: -1 },
  ]), ["MA2611", "P2701"]), [rising]);
});
