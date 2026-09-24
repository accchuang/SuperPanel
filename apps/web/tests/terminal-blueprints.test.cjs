const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/terminal-blueprints.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const blueprintsModule = new Module(sourcePath, module);
blueprintsModule.filename = sourcePath;
blueprintsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
blueprintsModule._compile(compiled, sourcePath);
const { resolveTerminalBlueprints, updateTerminalBlueprint } = blueprintsModule.exports;

test("restores only valid blueprints for contracts still in the watchlist", () => {
  assert.equal(typeof resolveTerminalBlueprints, "function");
  const saved = JSON.stringify({
    P2701: { direction: "LONG", trigger: "突破", invalidation: "跌破" },
    OLD2701: { direction: "SHORT", trigger: "跌破", invalidation: "站回" },
    OI2701: { direction: "BUY", trigger: "", invalidation: "" },
  });
  assert.deepEqual(resolveTerminalBlueprints(saved, ["P2701", "OI2701"]), {
    P2701: { direction: "LONG", trigger: "突破", invalidation: "跌破" },
  });
  assert.deepEqual(resolveTerminalBlueprints("{bad", ["P2701"]), {});
});

test("editing one contract preserves another contract's blueprint", () => {
  assert.equal(typeof updateTerminalBlueprint, "function");
  const first = { P2701: { direction: "LONG", trigger: "突破", invalidation: "跌破" } };
  assert.deepEqual(updateTerminalBlueprint(first, "OI2701", { direction: "WATCH", trigger: "等待", invalidation: "" }), {
    P2701: first.P2701,
    OI2701: { direction: "WATCH", trigger: "等待", invalidation: "" },
  });
});
