const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../lib/leaderboard-contract.ts");
const contractModule = new Module(sourcePath, module);
contractModule.filename = sourcePath;
contractModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
if (fs.existsSync(sourcePath)) {
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  contractModule._compile(compiled, sourcePath);
}
const { leaderboardContractCode } = contractModule.exports;

test("leaderboard lookup requires and preserves the complete contract code", () => {
  assert.equal(leaderboardContractCode("P2701"), "P2701");
  assert.equal(leaderboardContractCode("ma2610"), "MA2610");
  assert.equal(leaderboardContractCode("P"), null);
});
