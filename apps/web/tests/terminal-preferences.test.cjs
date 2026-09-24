const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/terminal-preferences.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const preferencesModule = new Module(sourcePath, module);
preferencesModule.filename = sourcePath;
preferencesModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
preferencesModule._compile(compiled, sourcePath);

const { resolveTerminalPreferences } = preferencesModule.exports;
const defaults = { contract: "P2701", timeframe: "1d", subchartMode: "oi" };
const contracts = ["P2701", "OI2701"];
const timeframes = ["15m", "30m", "1h", "1d", "3d"];

test("restores a valid contract, timeframe and subplot mode", () => {
  const saved = JSON.stringify({ contract: "OI2701", timeframe: "3d", subchartMode: "volume" });
  assert.deepEqual(resolveTerminalPreferences(saved, defaults, contracts, timeframes), {
    contract: "OI2701", timeframe: "3d", subchartMode: "volume",
  });
});

test("ignores removed contracts and periods while preserving valid choices", () => {
  const saved = JSON.stringify({ contract: "OLD2701", timeframe: "5m", subchartMode: "volume" });
  assert.deepEqual(resolveTerminalPreferences(saved, defaults, contracts, timeframes), {
    contract: "P2701", timeframe: "1d", subchartMode: "volume",
  });
});

test("uses defaults for malformed or empty preferences", () => {
  assert.deepEqual(resolveTerminalPreferences("{broken", defaults, contracts, timeframes), defaults);
  assert.deepEqual(resolveTerminalPreferences(null, defaults, contracts, timeframes), defaults);
  assert.deepEqual(resolveTerminalPreferences("[]", defaults, contracts, timeframes), defaults);
});
