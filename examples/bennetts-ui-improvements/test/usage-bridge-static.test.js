"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("usage request bridge dispatches through the injected page bridge before fallback", () => {
  assert.match(source, /let usageBridgeReady = false;/);
  assert.match(source, /dispatchReady\(true\);/);
  assert.match(source, /dispatchReady\(false\);/);
  assert.match(source, /if \(usageBridgeReady\) return;/);
});

test("usage bridge ready event is reusable across hot reloads", () => {
  const listenerOptions = source.match(
    /window\.addEventListener\(\s*"codexpp-usage-bridge-ready",[\s\S]*?\n\s*\);/,
  )?.[0] ?? "";

  assert.doesNotMatch(listenerOptions, /once:\s*true/);
});

test("sidebar project color bridge uses shadcn 700 color families", () => {
  assert.match(source, /id: "blue", label: "Blue", value: "#1d4ed8"/);
  assert.match(source, /id: "rose", label: "Rose", value: "#be123c"/);
  assert.match(source, /id: "mauve", label: "Mauve", value: "#524959"/);
  assert.doesNotMatch(source, /id: "primary",\s*label: "Primary"/);
});
