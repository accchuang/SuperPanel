const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/terminal-research.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const researchModule = new Module(sourcePath, module);
researchModule.filename = sourcePath;
researchModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
researchModule._compile(compiled, sourcePath);
const { selectLinkedResearch, describeCtaReportProvenance, terminalQuoteMode } = researchModule.exports;

test("links research only when its actual contract matches the selected contract", () => {
  assert.equal(typeof selectLinkedResearch, "function");
  const trend = { contract: "P2701", direction: "UP", classification: "UPTREND_CONTINUATION" };
  const otherTrend = { contract: "P2705", direction: "DOWN" };
  const report = { contract: "P2701", system_state: "WATCH" };

  assert.deepEqual(selectLinkedResearch("P2701", [otherTrend, trend], ["P2701"], report), {
    trend, ctaConfigured: true, ctaReport: report,
  });
  assert.deepEqual(selectLinkedResearch("P2705", [trend], ["P2701"], report), {
    trend: null, ctaConfigured: false, ctaReport: null,
  });
});

test("does not display a stale CTA report for a newly selected contract", () => {
  assert.equal(typeof selectLinkedResearch, "function");
  assert.deepEqual(selectLinkedResearch("OI2701", [], ["OI2701"], { contract: "P2701", system_state: "READY" }), {
    trend: null, ctaConfigured: true, ctaReport: null,
  });
});

test("CTA report identifies the input data date instead of presenting an old report as live", () => {
  assert.equal(typeof describeCtaReportProvenance, "function");
  assert.equal(describeCtaReportProvenance({ snapshot_time: "2026-09-03T16:00:00" }), "历史校验 · 数据截至 2026-09-03");
  assert.equal(describeCtaReportProvenance({ snapshot_time: null }), "历史校验 · 数据时点未记录");
});

test("terminal live badge requires the selected contract to have a live quote", () => {
  assert.equal(typeof terminalQuoteMode, "function");
  assert.equal(terminalQuoteMode({ data_mode: "LIVE", quote: { status: "LIVE" } }), "LIVE");
  assert.equal(terminalQuoteMode({ data_mode: "LIVE", quote: { status: "CLOSED" } }), "STATIC");
  assert.equal(terminalQuoteMode({ data_mode: "STATIC", quote: { status: "LIVE" } }), "STATIC");
  assert.equal(terminalQuoteMode({ data_mode: "WAITING", quote: { status: "DELAYED" } }), "WAITING");
});
