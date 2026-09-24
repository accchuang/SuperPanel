const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/channel-swings.ts");
const swingsModule = new Module(sourcePath, module);
swingsModule.filename = sourcePath;
swingsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
if (fs.existsSync(sourcePath)) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  swingsModule._compile(compiled, sourcePath);
} else {
  swingsModule.exports = {};
}
const { buildChannelSwingPath } = swingsModule.exports;

const channel = [
  { upper: 110, lower: 90, atr: 5 },
  { upper: 110, lower: 90, atr: 5 },
  { upper: 110, lower: 90, atr: 5 },
  { upper: 110, lower: 90, atr: 5 },
];

test("connects alternating channel extremes when the target rail is within one ATR", () => {
  assert.equal(typeof buildChannelSwingPath, "function", "channel swing detection is implemented");
  if (typeof buildChannelSwingPath !== "function") return;

  assert.deepEqual(buildChannelSwingPath([
    { time: "a", low: 88, high: 96 },
    { time: "b", low: 84, high: 98 },
    { time: "c", low: 99, high: 105 },
    { time: "d", low: 96, high: 104 },
  ], channel), [
    { time: "b", value: 84, rail: "lower" },
    { time: "c", value: 105, rail: "upper" },
  ]);
});

test("does not create duplicate chart times when one K touches both channel rails", () => {
  assert.deepEqual(buildChannelSwingPath([
    { time: "a", low: 88, high: 96 },
    { time: "b", low: 83, high: 107 },
    { time: "c", low: 96, high: 105 },
  ], channel), [
    { time: "b", value: 83, rail: "lower" },
    { time: "c", value: 105, rail: "upper" },
  ]);
});
