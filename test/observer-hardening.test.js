"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repo = path.resolve(__dirname, "..");
const tweakBase = path.join(repo, "tweaks");

function activeEntrySources() {
  return readdirSync(tweakBase)
    .map((name) => path.join(tweakBase, name))
    .filter((dir) => statSync(dir).isDirectory())
    .map((dir) => ["index.js", "index.cjs"].map((file) => path.join(dir, file)).find(existsSync))
    .filter(Boolean)
    .map((file) => ({
      file: path.relative(repo, file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8"),
    }));
}

test("active tweak observers do not subscribe to streaming character data", () => {
  const offenders = activeEntrySources()
    .filter(({ text }) => /characterData\s*:\s*true/.test(text))
    .map(({ file }) => file);

  assert.deepEqual(offenders, []);
});

test("active tweak menu item scans do not include bare div fallbacks", () => {
  const offenders = activeEntrySources()
    .filter(({ text }) =>
      /\[role=["']menuitem["']\],\s*\[data-radix-collection-item\],\s*button,\s*div/.test(text) ||
      /button,\s*\[role=["']button["']\],\s*\[role=["']menuitem["']\],\s*\[data-radix-collection-item\],\s*div/.test(text)
    )
    .map(({ file }) => file);

  assert.deepEqual(offenders, []);
});

test("active tweak sidebar heading scans are scoped before broad element selectors", () => {
  const offenders = activeEntrySources()
    .filter(({ text }) => /document\.querySelectorAll\(["'`]div,span,p["'`]\)/.test(text))
    .map(({ file }) => file);

  assert.deepEqual(offenders, []);
});

test("active tweak intervals avoid sub-second polling", () => {
  const offenders = activeEntrySources()
    .flatMap(({ file, text }) => {
      const matches = [...text.matchAll(/setInterval\([^,]+,\s*([0-9_]+)\b/g)];
      return matches
        .map((match) => Number(String(match[1]).replaceAll("_", "")))
        .filter((ms) => Number.isFinite(ms) && ms > 0 && ms < 1000)
        .map((ms) => `${file}:${ms}`);
    });

  assert.deepEqual(offenders, []);
});

test("Tweaks Directory observer refreshes native IPC data only behind a signature gate", () => {
  const text = readFileSync(path.join(repo, "tweaks/tweaks-directory/index.cjs"), "utf8");
  const scheduleStart = text.indexOf("function scheduleObserverWork");
  const scheduleEnd = text.indexOf("function clearObserverTimer");
  const scheduleBody = text.slice(scheduleStart, scheduleEnd);

  assert.match(text, /const OBSERVER_WORK_DELAY_MS = 120/);
  assert.match(text, /const NATIVE_OBSERVER_REFRESH_MS = 10_000/);
  assert.match(text, /function nativeObserverWorkSignature/);
  assert.match(text, /function shouldRefreshNativeObserverData/);
  assert.match(scheduleBody, /refreshNativeObserverData\(state\)/);
  assert.doesNotMatch(scheduleBody, /loadPluginStatuses\(state\)/);
  assert.doesNotMatch(scheduleBody, /loadNativeDirectoryMeta\(state\)/);
});

test("UI Improvements pinned chat labels use observer signatures before DOM writes", () => {
  const text = readFileSync(path.join(repo, "tweaks/ui-improvements/index.js"), "utf8");

  assert.match(text, /let lastRenderedSignature = ""/);
  assert.match(text, /const pinnedChatProjectLabelsSignature = /);
  assert.match(text, /if \(signature === lastRenderedSignature\) return/);
  assert.match(text, /lastRenderedSignature = signature/);
});
