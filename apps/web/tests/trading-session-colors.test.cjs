const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/trading-session-background.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const backgroundModule = new Module(sourcePath, module);
backgroundModule.filename = sourcePath;
backgroundModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "./terminal-time") return { terminalChartTime: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
try {
  backgroundModule._compile(compiled, sourcePath);
} finally {
  Module._load = originalLoad;
}
const { TRADING_SESSION_BACKGROUND_COLORS } = backgroundModule.exports;

function compositeOnWhite(color) {
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  assert.ok(match, `Expected an rgba session color, received ${color}`);
  const [, red, green, blue, alpha] = match.map(Number);
  return [red, green, blue].map((channel) => 255 + (channel - 255) * alpha);
}

test("day and night session fills are distinguishable but remain light", () => {
  assert.ok(TRADING_SESSION_BACKGROUND_COLORS, "session background palette is exported");
  const night = compositeOnWhite(TRADING_SESSION_BACKGROUND_COLORS.night);
  const day = compositeOnWhite(TRADING_SESSION_BACKGROUND_COLORS.day);
  const distance = Math.hypot(...night.map((channel, index) => channel - day[index]));

  assert.ok(distance >= 8, `Session colors are too similar: ${distance.toFixed(1)}`);
  assert.ok([...night, ...day].every((channel) => channel >= 240), "Session fills should remain pale");
});
