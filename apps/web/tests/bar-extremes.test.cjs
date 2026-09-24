const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/bar-extremes.ts");
const extremesModule = new Module(sourcePath, module);
extremesModule.filename = sourcePath;
extremesModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
if (fs.existsSync(sourcePath)) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  extremesModule._compile(compiled, sourcePath);
} else {
  extremesModule.exports = {};
}
const { buildBarExtremeMarkers, rankRecentBarExtremes } = extremesModule.exports;

function bar(time, volume, open, close, is_closed = true) {
  return { time, volume, open, close, is_closed };
}

test("ranks the last 45 closed bars and ignores older and forming bars", () => {
  assert.equal(typeof rankRecentBarExtremes, "function", "bar extremes ranking is implemented");
  if (typeof rankRecentBarExtremes !== "function") return;
  const bars = [bar("old", 999, 0, 1000)];
  for (let index = 1; index <= 45; index += 1) {
    bars.push(bar(`closed-${index}`, index, 100, 100 + 46 - index));
  }
  bars.push(bar("forming", 10_000, 0, 10_000, false));

  assert.deepEqual(rankRecentBarExtremes(bars), [
    { time: "closed-1", volume: 1, bodySize: 45, bodyRank: 1 },
    { time: "closed-2", volume: 2, bodySize: 44, bodyRank: 2 },
    { time: "closed-3", volume: 3, bodySize: 43, bodyRank: 3 },
    { time: "closed-43", volume: 43, bodySize: 3, volumeRank: 3 },
    { time: "closed-44", volume: 44, bodySize: 2, volumeRank: 2 },
    { time: "closed-45", volume: 45, bodySize: 1, volumeRank: 1 },
  ]);
});

test("ranks equal values deterministically and allows one bar to qualify twice", () => {
  if (typeof rankRecentBarExtremes !== "function") return;
  assert.deepEqual(rankRecentBarExtremes([
    bar("a", 100, 10, 14),
    bar("b", 100, 10, 18),
    bar("c", 100, 10, 18),
  ], 29, 2), [
    { time: "b", volume: 100, bodySize: 8, volumeRank: 2, bodyRank: 2 },
    { time: "c", volume: 100, bodySize: 8, volumeRank: 1, bodyRank: 1 },
  ]);
});

test("turns rankings into text-free markers, preserving both categories on one bar", () => {
  assert.equal(typeof buildBarExtremeMarkers, "function", "text-free marker data is available");
  if (typeof buildBarExtremeMarkers !== "function") return;

  assert.deepEqual(buildBarExtremeMarkers([
    { time: "a", volume: 300, bodySize: 8, volumeRank: 1, bodyRank: 2 },
    { time: "b", volume: 200, bodySize: 9, bodyRank: 1 },
  ]), [
    { time: "a", kind: "volume", rank: 1 },
    { time: "a", kind: "body", rank: 2 },
    { time: "b", kind: "body", rank: 1 },
  ]);
});
