const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { GLOBAL_SERVICE_KEY, IPC_HANDLER_KEY, IPC_CHANNEL } = require("../src/constants");

function resetGlobals() {
  delete globalThis[GLOBAL_SERVICE_KEY];
  delete globalThis[IPC_HANDLER_KEY];
}

test("main IPC handler is disposed and service cleared on stop", () => {
  resetGlobals();
  delete require.cache[require.resolve("../index")];
  const tweak = require("../index");
  const disposed = [];
  const channels = [];

  tweak.start({
    process: "main",
    log: { info() {}, warn() {} },
    ipc: {
      handle(channel) {
        channels.push(channel);
        return () => disposed.push(channel);
      },
    },
  });

  assert.deepEqual(channels, [IPC_CHANNEL]);
  assert.equal(typeof globalThis[GLOBAL_SERVICE_KEY]?.handle, "function");

  tweak.stop();

  assert.deepEqual(disposed, [IPC_CHANNEL]);
  assert.equal(globalThis[GLOBAL_SERVICE_KEY], undefined);
  assert.equal(globalThis[IPC_HANDLER_KEY], undefined);
});

test("macOS relaunch uses detached open helper instead of direct app relaunch", () => {
  const actions = fs.readFileSync(path.join(__dirname, "..", "src", "account", "actions.js"), "utf8");
  const bundled = fs.readFileSync(path.join(__dirname, "..", "index.bundled.js"), "utf8");
  assert.match(actions, /scheduleDetachedRelaunch/);
  assert.match(actions, /codexpp-account-switcher-restart/);
  assert.doesNotMatch(actions, /setTimeout\(\(\) => \{\s*app\.relaunch\(\);\s*app\.exit\(0\);/);
  assert.match(bundled, /scheduleDetachedRelaunch/);
  assert.match(bundled, /codexpp-account-switcher-restart/);
  assert.doesNotMatch(bundled, /setTimeout\(\(\) => \{\s*app\.relaunch\(\);\s*app\.exit\(0\);/);
});

test("renderer entry does not load main-only account service before process check", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const bundled = fs.readFileSync(path.join(__dirname, "..", "index.bundled.js"), "utf8");
  const sourceEntry = source.slice(0, source.indexOf("function startMain"));
  const bundledEntry = bundled.slice(bundled.indexOf("// index.js"), bundled.indexOf("function startMain"));

  assert.doesNotMatch(sourceEntry, /src\/account\/service|createAccountService/);
  assert.doesNotMatch(bundledEntry, /require_service\(\)|createAccountService/);
});
