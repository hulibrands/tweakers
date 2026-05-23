"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  __test: {
    TOOL_TO_BRIDGE_METHOD,
    handleJsonRpcMessage,
    tools,
  },
} = require("../mcp-server");

async function makeSocketPath(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    socketPath: path.join(dir, "bridge.sock"),
  };
}

async function withFakeBridge(t, handler, fn) {
  const { dir, socketPath } = await makeSocketPath("better-browser-agent-mcp-");
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const request = JSON.parse(line);
          socket.write(`${JSON.stringify(handler(request))}\n`);
        }
        newline = buffer.indexOf("\n");
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  return fn(socketPath);
}

function toolResultPayload(response) {
  return JSON.parse(response.result.content[0].text);
}

test("MCP server lists read-only browser tools", async () => {
  const response = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  assert.equal(response.error, undefined);
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name).sort(),
    Object.keys(TOOL_TO_BRIDGE_METHOD).sort(),
  );
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "capture_browser_screenshot",
      "create_evidence_bundle",
      "get_accessibility_summary",
      "get_active_browser_tab",
      "get_browser_health",
      "get_console_messages",
      "get_dom_summary",
      "get_network_failures",
      "get_performance_summary",
      "list_browser_tabs",
    ].sort(),
  );
});

test("safe MCP tool calls are mapped to bridge socket methods", async (t) => {
  const seen = [];

  await withFakeBridge(t, (request) => {
    seen.push(request);
    return {
      id: request.id,
      result: {
        ok: true,
        method: request.method,
        params: request.params,
      },
    };
  }, async (socketPath) => {
    const response = await handleJsonRpcMessage(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_console_messages",
          arguments: { limit: 5, webContentsId: 101 },
        },
      },
      { socketPath, timeoutMs: 500 },
    );

    assert.equal(response.error, undefined);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "getConsoleMessages");
    assert.deepEqual(seen[0].params, { limit: 5, webContentsId: 101 });
    assert.deepEqual(toolResultPayload(response), {
      ok: true,
      method: "getConsoleMessages",
      params: { limit: 5, webContentsId: 101 },
    });
  });
});

test("unsafe or sensitive tool calls are refused without hitting the bridge", async (t) => {
  let bridgeCalls = 0;

  await withFakeBridge(t, () => {
    bridgeCalls += 1;
    return { result: { ok: true } };
  }, async (socketPath) => {
    const response = await handleJsonRpcMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "click_browser_button",
          arguments: { selector: "#danger" },
        },
      },
      { socketPath, timeoutMs: 500 },
    );

    assert.equal(response.error, undefined);
    assert.equal(response.result.isError, true);
    assert.equal(bridgeCalls, 0);
    assert.deepEqual(toolResultPayload(response), {
      ok: false,
      refused: true,
      code: "unsafe-tool-refused",
      toolName: "click_browser_button",
      message:
        "Better Browser Agent MCP is read-only. It refuses cookies, storage, auth headers, request bodies, and click/type/mutation tools.",
    });
  });
});

test("bridge failures fail closed with bridge-unavailable JSON-RPC errors", async () => {
  const { dir, socketPath } = await makeSocketPath("better-browser-agent-missing-");

  try {
    const response = await handleJsonRpcMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "get_browser_health",
          arguments: {},
        },
      },
      { socketPath, timeoutMs: 100 },
    );

    assert.equal(response.result, undefined);
    assert.equal(response.error.code, -32001);
    assert.equal(response.error.message, "bridge-unavailable");
    assert.equal(response.error.data.code, "bridge-unavailable");
    assert.match(response.error.data.message, /Better Browser Agent bridge is unavailable/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
