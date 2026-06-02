const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { __test } = require("../index.cjs");

test("validateProjectPath rejects missing paths without creating them", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-path-validation-"));
  const missingPath = path.join(parent, "missing-project");

  assert.equal(fs.existsSync(missingPath), false);

  const result = __test.validateProjectPath(missingPath);

  assert.equal(result.ok, false);
  assert.match(result.error, /does not exist/i);
  assert.equal(fs.existsSync(missingPath), false);
});

test("validateProjectPath accepts existing directories", () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-existing-project-"));

  const result = __test.validateProjectPath(projectPath);

  assert.deepEqual(result, { ok: true, path: path.resolve(projectPath) });
});
