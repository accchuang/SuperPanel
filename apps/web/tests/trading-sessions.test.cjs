const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/trading-sessions.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sessionsModule = new Module(sourcePath, module);
sessionsModule.filename = sourcePath;
sessionsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
sessionsModule._compile(compiled, sourcePath);
const { buildTradingSessionSpans } = sessionsModule.exports;

test("groups night and day bars by exchange trading date", () => {
  const bars = [
    { time: "2026-09-22 21:00:00" },
    { time: "2026-09-22 22:30:00" },
    { time: "2026-09-23 00:30:00" },
    { time: "2026-09-23 09:00:00" },
    { time: "2026-09-23 10:30:00" },
    { time: "2026-09-23 13:30:00" },
    { time: "2026-09-23 15:00:00" },
    { time: "2026-09-23 21:00:00" },
  ];
  assert.deepEqual(buildTradingSessionSpans(bars, "30m"), [
    { kind: "night", tradingDate: "2026-09-23", startTime: "2026-09-22 21:00:00", endTime: "2026-09-23 00:30:00" },
    { kind: "day", tradingDate: "2026-09-23", startTime: "2026-09-23 09:00:00", endTime: "2026-09-23 15:00:00" },
    { kind: "night", tradingDate: "2026-09-24", startTime: "2026-09-23 21:00:00", endTime: "2026-09-23 21:00:00" },
  ]);
});

test("does not shade daily charts or trading breaks", () => {
  assert.deepEqual(buildTradingSessionSpans([{ time: "2026-09-23 00:00:00" }], "1d"), []);
  assert.deepEqual(buildTradingSessionSpans([
    { time: "2026-09-23 16:00:00" },
    { time: "invalid" },
  ], "30m"), []);
});
