"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.BETTER_BROWSER_TEST = "1";

const {
  __test: exported = {},
} = require("../index");

const createDevToolsSessionManager = exported.createDevToolsSessionManager;
const createBetterBrowserBridgeApi =
  exported.createBetterBrowserBridgeApi ?? exported.createBrowserAgentBridge;
const createBridgeEventBuffers =
  exported.createBridgeEventBuffers ?? exported.createBridgeRingBuffer;
const redactBridgeValue = exported.redactBridgeValue ?? exported.redactBridgePayload;
const refuseUnsupportedBridgeMethod =
  exported.refuseUnsupportedBridgeMethod ?? exported.isUnsafeBridgeRequest;
const selectBrowserTabForBridge = exported.selectBrowserTabForBridge;
const truncateBridgeValue = exported.truncateBridgeValue;

function makeFakeState() {
  return {
    browserTabRegistry: new Map(),
    devToolsSessionManager: null,
  };
}

function makeFakeWebContents({ id = 101, commandResult, commandError } = {}) {
  const listeners = new Map();
  let attached = false;
  const sentCommands = [];

  return {
    id,
    debugger: {
      attach(version) {
        assert.equal(version, "1.3");
        attached = true;
      },
      detach() {
        attached = false;
      },
      isAttached() {
        return attached;
      },
      on(name, listener) {
        listeners.set(name, listener);
      },
      off(name, listener) {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
      sendCommand(method, params) {
        sentCommands.push({ method, params });
        if (commandError) throw commandError;
        return commandResult;
      },
    },
    getTitle() {
      return "Fixture tab";
    },
    getURL() {
      return "https://example.test/dashboard";
    },
    isDestroyed() {
      return false;
    },
    __sentCommands: sentCommands,
  };
}

function requireExport(t, name, value) {
  if (typeof value !== "function") {
    t.skip(`missing Better Browser Agent test export: ${name}`);
    return null;
  }
  return value;
}

function stringify(value) {
  return JSON.stringify(value);
}

function assertNoSecrets(value) {
  const serialized = stringify(value);
  assert.doesNotMatch(serialized, /raw-token-secret/);
  assert.doesNotMatch(serialized, /raw-cookie-secret/);
  assert.doesNotMatch(serialized, /raw-auth-secret/);
  assert.doesNotMatch(serialized, /raw-body-secret/);
  assert.doesNotMatch(serialized, /raw-api-key-secret/);
  assert.doesNotMatch(serialized, /raw-session-secret/);
}

function getBufferEntries(buffer) {
  if (typeof buffer.entries === "function") return buffer.entries();
  if (typeof buffer.toJSON === "function") return buffer.toJSON().entries ?? buffer.toJSON().items ?? [];
  if (typeof buffer.snapshot === "function") return buffer.snapshot().entries ?? buffer.snapshot().items ?? [];
  if (typeof buffer.getEntries === "function") return buffer.getEntries();
  return buffer.entries ?? buffer.items ?? [];
}

function getBufferSnapshot(buffer) {
  if (typeof buffer.snapshot === "function") return buffer.snapshot();
  if (typeof buffer.toJSON === "function") return buffer.toJSON();
  return {
    entries: getBufferEntries(buffer),
    partialHistory: buffer.partialHistory,
    truncated: buffer.truncated,
  };
}

function pushBufferEntry(buffer, entry) {
  if (typeof buffer.push === "function") return buffer.push(entry);
  if (typeof buffer.record === "function") return buffer.record(entry);
  if (typeof buffer.add === "function") return buffer.add(entry);
  if (typeof buffer.addEntry === "function") return buffer.addEntry(entry);
  throw new TypeError("bridge ring buffer must expose push, record, or add");
}

function makeEventBuffers(makeBuffers, options) {
  const buffers = makeBuffers(options);
  if (buffers?.console || buffers?.network) return buffers;
  if (buffers?.consoleMessages || buffers?.networkFailures) return buffers;
  return { console: buffers, network: buffers };
}

function getConsoleBuffer(buffers) {
  return buffers.console ?? buffers.consoleMessages ?? buffers.getConsoleBuffer?.();
}

function getNetworkBuffer(buffers) {
  return buffers.network ?? buffers.networkFailures ?? buffers.getNetworkBuffer?.();
}

test("required Phase 1-4 bridge primitive exports are present or intentionally aliased", () => {
  const required = {
    createBetterBrowserBridgeApi,
    createBridgeEventBuffers,
    createDevToolsSessionManager,
    redactBridgeValue,
    refuseUnsupportedBridgeMethod,
    truncateBridgeValue,
  };

  assert.deepEqual(
    Object.entries(required)
      .filter(([, value]) => typeof value !== "function")
      .map(([name]) => name),
    [],
  );
});

test("DevTools session manager sendCommand awaits and returns command result data", async () => {
  const state = makeFakeState();
  const manager = createDevToolsSessionManager({ log: { warn() {} } }, state);
  state.devToolsSessionManager = manager;
  const expected = { result: { type: "string", value: "ready" } };
  const wc = makeFakeWebContents({
    commandResult: Promise.resolve(expected),
  });

  const actual = await manager.sendCommand(wc, "Runtime.evaluate", { expression: "window.__ready" });

  assert.deepEqual(actual, expected);
  assert.deepEqual(wc.__sentCommands, [
    {
      method: "Runtime.evaluate",
      params: { expression: "window.__ready" },
    },
  ]);
  assert.equal(manager.getSnapshot(wc).lastCommand, "Runtime.evaluate");
  assert.equal(manager.getSnapshot(wc).lastError, null);
});

test("tab selection is deterministic and explains the selected target", (t) => {
  const select = requireExport(t, "selectBrowserTabForBridge", selectBrowserTabForBridge);
  if (!select) return;

  const tabs = [
    { webContentsId: 31, url: "https://example.test/older", title: "older", isVisible: true },
    { webContentsId: 11, url: "https://example.test/focused", title: "focused", isFocused: true },
    { webContentsId: 21, url: "https://example.test/devtools", title: "devtools", devToolsOpen: true },
  ];

  const focused = select(tabs, {});
  assert.equal(focused.tab.webContentsId, 11);
  assert.match(focused.reason, /focus/i);

  const preferred = select(tabs, { preferredWebContentsId: 21 });
  assert.equal(preferred.tab.webContentsId, 21);
  assert.match(preferred.reason, /preferred|requested|explicit/i);

  const tied = select([
    { webContentsId: 9, isVisible: true, lastUpdatedAt: 200 },
    { webContentsId: 4, isVisible: true, lastUpdatedAt: 200 },
  ]);
  assert.equal(tied.tab.webContentsId, 4);
  assert.match(tied.reason, /deterministic|visible|tie/i);
});

test("console and network buffers truncate, redact, and mark partial history", (t) => {
  const makeBuffers = requireExport(t, "createBridgeEventBuffers", createBridgeEventBuffers);
  const redact = requireExport(t, "redactBridgeValue", redactBridgeValue);
  if (!makeBuffers || !redact) return;

  const buffers = makeEventBuffers(makeBuffers, {
    consoleLimit: 2,
    limits: { console: 2, network: 1 },
    networkLimit: 1,
    partialHistory: true,
    redact,
  });
  const consoleBuffer = getConsoleBuffer(buffers);
  const networkBuffer = getNetworkBuffer(buffers);
  assert.ok(consoleBuffer, "expected console event buffer");
  assert.ok(networkBuffer, "expected network event buffer");

  pushBufferEntry(consoleBuffer, {
    level: "info",
    text: "loaded",
    timestamp: 1,
    url: "https://example.test/?token=raw-token-secret",
  });
  pushBufferEntry(consoleBuffer, {
    level: "warn",
    text: "cookie raw-cookie-secret",
    timestamp: 2,
  });
  pushBufferEntry(consoleBuffer, {
    level: "error",
    text: "Authorization: Bearer raw-auth-secret",
    timestamp: 3,
  });

  const consoleSnapshot = getBufferSnapshot(consoleBuffer);
  const consoleEntries = getBufferEntries(consoleBuffer);
  assert.equal(consoleEntries.length, 2);
  assert.equal(consoleEntries[0].timestamp, 2);
  assert.equal(consoleEntries[1].timestamp, 3);
  assert.equal(consoleSnapshot.partialHistory, true);
  assert.equal(consoleSnapshot.truncated, true);
  assertNoSecrets(consoleSnapshot);

  pushBufferEntry(networkBuffer, {
    method: "POST",
    requestBody: "raw-body-secret",
    status: 500,
    url: "https://api.example.test/fail?api_key=raw-api-key-secret&session_id=raw-session-secret",
  });
  pushBufferEntry(networkBuffer, {
    headers: { Cookie: "session=raw-cookie-secret" },
    method: "GET",
    status: 404,
    url: "https://api.example.test/missing",
  });

  const networkSnapshot = getBufferSnapshot(networkBuffer);
  assert.equal(getBufferEntries(networkBuffer).length, 1);
  assert.equal(networkSnapshot.partialHistory, true);
  assert.equal(networkSnapshot.truncated, true);
  assertNoSecrets(networkSnapshot);
});

test("redaction removes sensitive headers, body-like fields, and URL parameters", (t) => {
  const redact = requireExport(t, "redactBridgeValue", redactBridgeValue);
  if (!redact) return;

  const redacted = redact({
    body: "raw-body-secret",
    headers: {
      Authorization: "Bearer raw-auth-secret",
      Cookie: "session=raw-cookie-secret",
      "X-Trace": "safe-trace",
    },
    nested: {
      postData: "raw-body-secret",
      url: "https://example.test/path?token=raw-token-secret&safe=1",
    },
    url: "https://example.test/path?api_key=raw-api-key-secret&session_id=raw-session-secret&view=ok",
  });

  assertNoSecrets(redacted);
  assert.match(stringify(redacted), /redacted/i);
  assert.match(stringify(redacted), /safe-trace/);
  assert.match(stringify(redacted), /view=ok|safe=1/);
});

test("disabled and read-only bridge mode refuse mutation, storage, cookie, and body requests", (t) => {
  const createBridge = requireExport(t, "createBetterBrowserBridgeApi", createBetterBrowserBridgeApi);
  const refuseUnsafe = requireExport(t, "refuseUnsupportedBridgeMethod", refuseUnsupportedBridgeMethod);
  if (!createBridge || !refuseUnsafe) return;

  const state = makeFakeState();
  state.bridgeEnabled = false;
  state.bridgeMode = "read-only";
  const bridge = createBridge(state, { now: () => 1_715_708_800_000 });

  const disabledResult = bridge.listBrowserTabs();
  assert.equal(disabledResult.ok, false);
  assert.match(disabledResult.error?.code ?? disabledResult.code, /disabled/i);

  for (const request of [
    { toolName: "clickElement", params: { selector: "button" } },
    { toolName: "getCookies", params: { url: "https://example.test" } },
    { toolName: "readLocalStorage", params: { key: "token" } },
    { toolName: "getNetworkRequestBody", params: { requestId: "1" } },
    { toolName: "setInputValue", params: { selector: "input", value: "raw-token-secret" } },
  ]) {
    const refusal = refuseUnsafe(request, { enabled: true, mode: "read-only" });
    assert.equal(refusal.allowed, false, request.toolName);
    assert.match(refusal.code, /read.?only|unsafe|refus/i);
    assertNoSecrets(refusal);
  }
});

test("audit metadata records counts and statuses without sensitive values", (t) => {
  const createBridge = requireExport(t, "createBetterBrowserBridgeApi", createBetterBrowserBridgeApi);
  if (!createBridge) return;

  const state = makeFakeState();
  state.bridgeEnabled = true;
  state.bridgeMode = "read-only";
  const bridge = createBridge(state, { now: () => 1_715_708_800_000 });
  assert.equal(typeof bridge.recordAuditEntry, "function");
  assert.equal(typeof bridge.getAuditLog, "function");

  bridge.recordAuditEntry({
    durationMs: 12,
    error: "Authorization failed with raw-auth-secret",
    origin: "codex",
    params: {
      headers: { Cookie: "session=raw-cookie-secret" },
      url: "https://example.test/?token=raw-token-secret",
    },
    redactionCount: 3,
    resultCounts: { console: 2, network: 1 },
    status: "refused",
    tabId: "browser:1",
    toolName: "getNetworkRequestBody",
  });

  const entries = bridge.getAuditLog();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].toolName, "getNetworkRequestBody");
  assert.equal(entries[0].status, "refused");
  assert.deepEqual(entries[0].resultCounts, { console: 2, network: 1 });
  assert.equal(entries[0].redactionCount, 3);
  assertNoSecrets(entries);
  assert.equal(entries[0].params, undefined);
  assert.equal(entries[0].result, undefined);
});

test("bridge call failures are redacted before returning or auditing", (t) => {
  const createBridge = requireExport(t, "createBetterBrowserBridgeApi", createBetterBrowserBridgeApi);
  if (!createBridge) return;

  const state = makeFakeState();
  state.bridgeEnabled = true;
  state.bridgeMode = "read-only";
  state.webContentsEntries = {
    values() {
      throw new Error("Authorization failed with raw-auth-secret and raw-token-secret");
    },
  };
  const bridge = createBridge(state);

  const result = bridge.listBrowserTabs();

  assert.equal(result.ok, false);
  assertNoSecrets(result);
  assertNoSecrets(bridge.getAuditLog());
});
