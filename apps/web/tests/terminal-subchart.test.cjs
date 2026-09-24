const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/terminal-subchart.ts");
const subchartModule = new Module(sourcePath, module);
subchartModule.filename = sourcePath;
subchartModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
if (fs.existsSync(sourcePath)) {
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  subchartModule._compile(compiled, sourcePath);
}
const { terminalStatusTooltip } = subchartModule.exports;

test("keeps quote freshness details available in the status tooltip", () => {
  assert.equal(terminalStatusTooltip(null), "等待行情连接");
  const tooltip = terminalStatusTooltip({
    source: "TQSDK",
    timeframe_label: "日线",
    fetched_at: "2026-09-24T08:48:09.000Z",
    quote: { quote_time: "2026-09-24 14:59:59" },
  });
  assert.match(tooltip, /TQSDK · 日线/);
  assert.match(tooltip, /快照/);
  assert.match(tooltip, /报价 2026-09-24 14:59:59/);
});
