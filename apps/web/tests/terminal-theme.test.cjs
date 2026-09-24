const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/terminal-theme.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const themeModule = new Module(sourcePath, module);
themeModule.filename = sourcePath;
themeModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
themeModule._compile(compiled, sourcePath);

const { resolveTerminalTheme, terminalChartPalette, terminalUiPalette } = themeModule.exports;

test("restores only supported terminal themes", () => {
  assert.equal(resolveTerminalTheme("dark"), "dark");
  assert.equal(resolveTerminalTheme("light"), "light");
  assert.equal(resolveTerminalTheme("system"), "light");
  assert.equal(resolveTerminalTheme(null), "light");
});

test("provides distinct chart palettes for light and dark themes", () => {
  const light = terminalChartPalette("light");
  const dark = terminalChartPalette("dark");

  assert.equal(light.background, "#FFFFFF");
  assert.equal(dark.background, "#0D141C");
  assert.notEqual(light.grid, dark.grid);
  assert.notEqual(light.sessionBackground.day, dark.sessionBackground.day);
});

test("provides a visible swing-path color for both terminal themes", () => {
  const light = terminalChartPalette("light");
  const dark = terminalChartPalette("dark");

  assert.match(light.swingPath, /^#/);
  assert.match(dark.swingPath, /^#/);
});

test("uses TradingView classic candle colors in the dark chart theme", () => {
  const dark = terminalChartPalette("dark");

  assert.deepEqual(
    {
      up: dark.candleUp,
      upBorder: dark.candleBorderUp,
      down: dark.candleDown,
      downBorder: dark.candleBorderDown,
      breakoutUp: dark.breakoutUp,
      breakoutDown: dark.breakoutDown,
    },
    {
      up: "#26A69A",
      upBorder: "#26A69A",
      down: "#EF5350",
      downBorder: "#EF5350",
      breakoutUp: "#26A69A",
      breakoutDown: "#EF5350",
    },
  );
});

test("uses subdued surfaces and readable text for dark terminal lists", () => {
  const dark = terminalUiPalette("dark");

  assert.deepEqual(
    dark,
    {
      watchlistSurface: "#0D151D",
      watchlistSection: "#101B24",
      watchlistBorder: "#1D2C35",
      watchlistDivider: "#18252D",
      watchlistActive: "#14262D",
      watchlistIndicator: "#3F9289",
      leaderboardSurface: "#0F1820",
      leaderboardRow: "#111E27",
      leaderboardBorder: "#1B2A33",
      leaderboardPosition: "#356F65",
      leaderboardIncrease: "#B85F55",
      leaderboardDecrease: "#3C8D76",
      leaderboardText: "#D1DCE2",
      leaderboardValue: "#EDF3F6",
    },
  );
});
