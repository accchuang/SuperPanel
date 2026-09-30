const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/volume-profile.ts");
const profileModule = new Module(sourcePath, module);
profileModule.filename = sourcePath;
profileModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
if (fs.existsSync(sourcePath)) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  profileModule._compile(compiled, sourcePath);
} else {
  profileModule.exports = {};
}

const { buildVolumeProfile, selectVisibleProfileBars } = profileModule.exports;

function bar(price, volume) {
  return { low: price - 0.1, high: price + 0.1, close: price, volume };
}

test("bins bar volume at typical price and expands the 70% value area from POC", () => {
  assert.equal(typeof buildVolumeProfile, "function", "volume profile calculation is implemented");

  const profile = buildVolumeProfile([
    bar(99, 10),
    bar(100, 100),
    bar(101, 70),
    bar(102, 20),
  ], 4, 0.7);

  assert.deepEqual(profile?.bins.map((bin) => bin.volume), [10, 100, 70, 20]);
  assert.equal(profile?.totalVolume, 200);
  assert.equal(profile?.poc, 100.1);
  assert.equal(profile?.val, 99.7);
  assert.equal(profile?.vah, 101.3);
});

test("returns null when visible bars contain no usable traded volume", () => {
  assert.equal(typeof buildVolumeProfile, "function", "volume profile calculation is implemented");

  assert.equal(buildVolumeProfile([
    bar(100, 0),
    { ...bar(101, 20), high: Number.NaN },
    { ...bar(102, 30), low: 103 },
    { ...bar(103, 40), volume: null },
  ]), null);
});

test("ignores unusable bars while preserving a valid profile", () => {
  assert.equal(typeof buildVolumeProfile, "function", "volume profile calculation is implemented");

  const profile = buildVolumeProfile([
    bar(100, 50),
    { ...bar(101, 500), volume: Number.POSITIVE_INFINITY },
    { ...bar(102, 900), close: Number.NaN },
  ], 8);

  assert.equal(profile?.totalVolume, 50);
  assert.equal(profile?.bins.reduce((sum, bin) => sum + bin.volume, 0), 50);
});

test("selects only bars intersecting the fractional visible logical range", () => {
  assert.equal(typeof selectVisibleProfileBars, "function", "visible profile range selection is implemented");

  const bars = [0, 1, 2, 3, 4].map((index) => ({ ...bar(100 + index, 1), id: index }));
  assert.deepEqual(
    selectVisibleProfileBars(bars, { from: 1.4, to: 3.2 }).map((item) => item.id),
    [1, 2, 3, 4],
  );
});

test("clamps visible range to available bars and uses the last 180 bars before chart range exists", () => {
  assert.equal(typeof selectVisibleProfileBars, "function", "visible profile range selection is implemented");

  const bars = Array.from({ length: 200 }, (_, index) => ({ ...bar(100 + index, 1), id: index }));
  assert.deepEqual(
    selectVisibleProfileBars(bars, { from: -2, to: 1 }).map((item) => item.id),
    [0, 1],
  );
  assert.deepEqual(
    selectVisibleProfileBars(bars, null).map((item) => item.id),
    Array.from({ length: 180 }, (_, index) => index + 20),
  );
});
