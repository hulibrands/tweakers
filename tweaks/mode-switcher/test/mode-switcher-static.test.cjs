const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

function assertInOrder(haystack, needles) {
  let index = -1;
  for (const needle of needles) {
    const nextIndex = haystack.indexOf(needle, index + 1);
    assert.notEqual(nextIndex, -1, `Expected ${JSON.stringify(needle)} after offset ${index}`);
    index = nextIndex;
  }
}

test("ShadGPT mode switcher prefers runtime support-directory discovery", () => {
  assert.match(source, /async function getRuntimePaths\(\)/);
  assert.match(source, /async function getRootInfo\(\)/);
  assert.match(source, /async function discoverRuntimeSupportRoot\(\)/);
  assert.match(source, /api\.codex\?\.tweaks\?\.getUserPaths/);
  assert.match(source, /SHADGPT_USER_ROOT/);
  assert.match(source, /Runtime support directory API is unavailable; using the ShadGPT support path\./);
});

test("fallback support path is visible in renderer settings", () => {
  assert.match(source, /supportRootFallback: paths\.supportRootFallback/);
  assert.match(source, /supportRootFallbackReason: paths\.supportRootFallbackReason/);
  assert.match(source, /function applySupportRootFallbackStatus\(section, modeResult\)/);
  assert.match(source, /data-codexpp-mode-switcher-status/);
  assert.match(source, /Using the ShadGPT support path because runtime support directory discovery is unavailable\./);
});

test("mode changes distinguish main-scope tweaks and return restart outcomes", () => {
  assert.match(source, /function listTweaksExcludingSelf\(paths\)/);
  assert.match(source, /tweaks\.push\(\{ id: manifest\.id, scope: manifest\.scope \}\)/);
  assert.match(source, /function isMainScopeTweak\(tweak\)/);
  assert.match(source, /mainScopeAffected: otherTweaks\.some\(isMainScopeTweak\)/);
  assert.match(source, /relaunchScheduled: relaunch\.relaunchScheduled/);
  assert.match(source, /restartRequired: relaunch\.restartRequired/);
});

test("mode changes preserve config snapshot and restore semantics", () => {
  assert.match(source, /function prepareModeChange\(next, state, cfg, otherTweaks\)/);
  assert.match(source, /const snapshot = \{\}/);
  assert.match(source, /snapshot\[id\] = enabled/);
  assert.match(source, /nextState\.snapshot = snapshot/);
  assert.match(source, /const snapshot = state\.snapshot \|\| \{\}/);
  assert.match(source, /const wasEnabled = id in snapshot \? snapshot\[id\] : true/);
  assert.match(source, /nextState\.snapshot = \{\}/);
  assert.match(source, /applyModeTransaction\(paths, state, cfg, modeChange\.state, modeChange\.config\)/);
});

test("mode changes write snapshot state before config and keep rollback state", () => {
  assert.match(source, /transactionPath: path\.join\(\s*rootDir,\s*"tweak-data",\s*SELF_ID,\s*"mode-change\.transaction\.json",\s*\)/);
  assert.match(source, /function applyModeTransaction\(\s*paths,\s*previousState,\s*previousConfig,\s*nextState,\s*nextConfig,\s*\)/);
  assert.match(source, /function writeModeTransaction\(paths, transaction\)/);
  assert.match(source, /function rollbackModeTransaction\(paths, previousState, previousConfig\)/);
  assert.match(source, /function recoverModeTransaction\(paths\)/);
  assertInOrder(source, [
    "writeModeTransaction(paths, {",
    "writeSnapshot(paths, nextState);",
    "writeConfig(paths, nextConfig);",
    "commitState(paths, nextState);",
    "removeModeTransaction(paths);",
  ]);
  assert.match(source, /rollbackModeTransaction\(paths, previousState, previousConfig\)/);
});

test("renderer scopes legacy settings injection to a settings root", () => {
  assert.match(source, /requestAnimationFrame\(\(\) => \{/);
  assert.match(source, /function findSettingsRoot\(\)/);
  assert.match(source, /function findSettingsObserverRoot\(\)/);
  assert.match(source, /const settingsRoot = observedSettingsRoot \|\| findSettingsRoot\(\)/);
  assert.match(source, /const anchorSection = findUpdatesSection\(settingsRoot\)/);
  assert.match(source, /settingsObserver\.observe\(observedSettingsRoot, \{ childList: true, subtree: true \}\)/);
  assert.match(source, /rootObserver\.observe\(findSettingsObserverRoot\(\), \{ childList: true \}\)/);
  assert.match(source, /document\.addEventListener\("click", scheduleSettingsRefresh, true\)/);
  assert.doesNotMatch(source, /findUpdatesSection\(\);\n/);
  assert.doesNotMatch(source, /observe\(document\.body/);
  assert.doesNotMatch(source, /rootObserver\.observe\(findSettingsObserverRoot\(\), \{ childList: true, subtree: true \}\)/);
});

test("renderer preserves restart-required state", () => {
  assert.match(source, /if \(result\.restartRequired\) return result/);
  assert.match(source, /Restart Codex to finish switching modes\. Main-scope tweaks stay active until restart\./);
});

test("segmented radio supports keyboard operation", () => {
  assert.match(source, /group\.setAttribute\("role", "radiogroup"\)/);
  assert.match(source, /group\.setAttribute\("aria-label", "Mode"\)/);
  assert.match(source, /btn\.setAttribute\("role", "radio"\)/);
  assert.match(source, /b\.tabIndex = on \? 0 : -1/);
  assert.match(source, /group\.addEventListener\("keydown"/);
  assert.match(source, /"ArrowLeft"/);
  assert.match(source, /"ArrowRight"/);
  assert.match(source, /"Home"/);
  assert.match(source, /"End"/);
  assert.match(source, /focusAndActivate/);
});

test("mode-switch restart targets the managed app and foregrounds it", () => {
  // Never reopen stock Codex on a mode switch: opening com.openai.codex by
  // bundle id is how a switch "switched from ShadGPT to Codex" and left the
  // managed mirror deferring in the background.
  assert.doesNotMatch(source, /readBundleId\(appRoot\) \|\| "com\.openai\.codex"/);
  assert.match(source, /const bundleId = readBundleId\(appRoot\) \|\| ""/);
  // The detached relaunch must bring the app to the front, not leave it hidden.
  assert.match(source, /osascript -e "tell application id .* to activate"/);
});
