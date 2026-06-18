"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createProjectPath,
  validateProjectPath,
} = require("../index.cjs").__test;
const tweak = require("../index.cjs");

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "add-project-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("validation accepts an existing folder without creating anything", (t) => {
  const root = makeTempRoot(t);
  const existing = path.join(root, "existing");
  fs.mkdirSync(existing);

  const result = validateProjectPath(existing);

  assert.equal(result.ok, true);
  assert.equal(result.path, existing);
});

test("validation reports missing folders without creating them", (t) => {
  const root = makeTempRoot(t);
  const missing = path.join(root, "missing", "project");

  const result = validateProjectPath(missing);

  assert.equal(result.ok, false);
  assert.equal(result.code, "missing");
  assert.equal(result.canCreate, true);
  assert.equal(result.path, missing);
  assert.equal(fs.existsSync(missing), false);
});

test("explicit create action creates a missing folder", (t) => {
  const root = makeTempRoot(t);
  const missing = path.join(root, "missing", "project");

  const result = createProjectPath(missing);

  assert.equal(result.ok, true);
  assert.equal(result.path, missing);
  assert.equal(result.created, true);
  assert.equal(fs.statSync(missing).isDirectory(), true);
});

test("relative paths are rejected", () => {
  const result = validateProjectPath("relative/project");

  assert.equal(result.ok, false);
  assert.match(result.error, /absolute path/i);
});

test("file paths are rejected", (t) => {
  const root = makeTempRoot(t);
  const filePath = path.join(root, "project.txt");
  fs.writeFileSync(filePath, "not a folder");

  const result = validateProjectPath(filePath);

  assert.equal(result.ok, false);
  assert.match(result.error, /file already exists/i);
});

test("symlink paths are rejected", (t) => {
  const root = makeTempRoot(t);
  const real = path.join(root, "real");
  const link = path.join(root, "link");
  fs.mkdirSync(real);

  try {
    fs.symlinkSync(real, link, "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("symlink creation is not available in this environment");
      return;
    }
    throw error;
  }

  const result = validateProjectPath(link);

  assert.equal(result.ok, false);
  assert.match(result.error, /symlink/i);
});

test("unreadable folders are rejected when permissions can be enforced", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root can bypass directory permissions");
    return;
  }

  const root = makeTempRoot(t);
  const locked = path.join(root, "locked");
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o000);

  try {
    const result = validateProjectPath(locked);

    assert.equal(result.ok, false);
    assert.match(result.error, /permission|read/i);
  } finally {
    fs.chmodSync(locked, 0o700);
  }
});

test("main IPC handlers are disposed on stop", () => {
  delete globalThis.__codexppAddProjectByPathMainHandler;
  const disposed = [];
  const channels = [];
  tweak.start({
    process: "main",
    log: { info() {} },
    ipc: {
      handle(channel) {
        channels.push(channel);
        return () => disposed.push(channel);
      },
    },
  });

  assert.deepEqual(channels.sort(), ["create-project-path", "validate-project-path"]);
  tweak.stop();
  assert.deepEqual(disposed.sort(), ["create-project-path", "validate-project-path"]);
  assert.equal(globalThis.__codexppAddProjectByPathMainHandler, undefined);
});

test("path entry modal traps tab focus and restores previous focus", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.cjs"), "utf8");
  assert.match(source, /function trapModalFocus/);
  assert.match(source, /function modalFocusableElements/);
  assert.match(source, /previousFocus\?\.focus\?\.\(\)/);
  assert.match(source, /event\.key === "Tab"/);
});
