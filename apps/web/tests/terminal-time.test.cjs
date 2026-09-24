const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/terminal-time.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const timeModule = new Module(sourcePath, module);
timeModule.filename = sourcePath;
timeModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
timeModule._compile(compiled, sourcePath);
const { terminalChartTime } = timeModule.exports;

test("daily and three-day bars use their trading date instead of midnight timestamps", () => {
  assert.equal(terminalChartTime("2026-09-23 00:00:00", "1d"), "2026-09-23");
  assert.equal(terminalChartTime("2026-09-22 00:00:00", "3d"), "2026-09-22");
});

test("intraday bars preserve the real China trading session time", () => {
  const expected = Date.UTC(2026, 8, 22, 22, 0, 0) / 1000;
  assert.equal(terminalChartTime("2026-09-22 22:00:00", "30m"), expected);
  assert.equal(terminalChartTime("2026-09-23 09:30:00", "1h"), Date.UTC(2026, 8, 23, 9, 30, 0) / 1000);
});

test("invalid bar dates are ignored", () => {
  assert.equal(terminalChartTime("not-a-time", "15m"), null);
  assert.equal(terminalChartTime("2026-02-30 00:00:00", "1d"), null);
});
