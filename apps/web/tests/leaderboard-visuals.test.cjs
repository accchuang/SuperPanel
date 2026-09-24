const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/leaderboard-visuals.ts");
const visualsModule = new Module(sourcePath, module);
visualsModule.filename = sourcePath;
visualsModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
if (fs.existsSync(sourcePath)) {
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  visualsModule._compile(compiled, sourcePath);
}
const { netPositionBarValues } = visualsModule.exports;

test("shows absolute net position and directionally correct daily change for each side", () => {
  assert.equal(typeof netPositionBarValues, "function");
  assert.deepEqual(netPositionBarValues(1200, 200), { position: 1200, change: 200 });
  assert.deepEqual(netPositionBarValues(-1200, -200), { position: 1200, change: 200 });
  assert.deepEqual(netPositionBarValues(-1200, 150), { position: 1200, change: -150 });
});
