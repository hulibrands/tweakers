#!/usr/bin/env node
"use strict";

/* Minimal MCP stdio wrapper for the Better Browser Agent local bridge socket. */

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const DEFAULT_SOCKET_PATH = path.join(os.tmpdir(), "better-browser-agent", "devtools-copilot.sock");
const DEFAULT_BRIDGE_TIMEOUT_MS = 1500;
const PROTOCOL_VERSION = "2024-11-05";

const TOOL_TO_BRIDGE_METHOD = Object.freeze({
  capture_browser_screenshot: "captureBrowserScreenshot",
  create_evidence_bundle: "createEvidenceBundle",
  get_accessibility_summary: "getAccessibilitySummary",
  get_active_browser_tab: "getActiveBrowserTab",
  get_browser_health: "getBrowserHealth",
  get_console_messages: "getConsoleMessages",
  get_dom_summary: "getDomSummary",
  get_network_failures: "getNetworkFailures",
  get_performance_summary: "getPerformanceSummary",
  list_browser_tabs: "listBrowserTabs",
});

const UNSAFE_TOOL_PATTERNS = Object.freeze([
  /cookies?/i,
  /storage/i,
  /auth[_\s-]*headers?/i,
  /request[_\s-]*bod(?:y|ies)/i,
  /(?:^|[_\s-])click(?:$|[_\s-])/i,
  /(?:^|[_\s-])type(?:$|[_\s-])/i,
  /mutat(?:e|ion)/i,
]);

const tools = Object.freeze(
  Object.keys(TOOL_TO_BRIDGE_METHOD).map((name) =>
    Object.freeze({
      name,
      description: `Read-only Better Browser Agent bridge call: ${TOOL_TO_BRIDGE_METHOD[name]}.`,
      inputSchema: {
        type: "object",
        additionalProperties: true,
        properties: {
          limit: { type: "number", description: "Optional maximum number of records to return." },
          tabId: { type: ["number", "string"], description: "Optional browser tab or webContents id." },
          webContentsId: { type: ["number", "string"], description: "Optional Electron webContents id." },
        },
      },
    }),
  ),
);

class BridgeUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "BridgeUnavailableError";
    this.code = "bridge-unavailable";
    this.cause = cause;
  }
}

function getSocketPath(env = process.env) {
  return env.BETTER_BROWSER_AGENT_MCP_SOCKET || DEFAULT_SOCKET_PATH;
}

function isUnsafeToolName(name) {
  if (typeof name !== "string") return false;
  return UNSAFE_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

function createUnsafeRefusal(name) {
  return {
    ok: false,
    refused: true,
    code: "unsafe-tool-refused",
    toolName: name,
    message:
      "Better Browser Agent MCP is read-only. It refuses cookies, storage, auth headers, request bodies, and click/type/mutation tools.",
  };
}

function textResult(value, options = {}) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    ...(options.isError ? { isError: true } : {}),
  };
}

function normalizeBridgeResponse(response) {
  if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "error")) {
    const message = response.error?.message || response.error || "Better Browser Agent bridge returned an error.";
    const error = new Error(String(message));
    error.code = response.error?.code || "bridge-error";
    error.data = response.error?.data;
    throw error;
  }
  if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "result")) {
    return response.result;
  }
  return response;
}

function bridgeUnavailable(cause) {
  const detail = cause && typeof cause === "object" && "message" in cause ? cause.message : String(cause || "");
  const message = detail
    ? `Better Browser Agent bridge is unavailable: ${detail}`
    : "Better Browser Agent bridge is unavailable.";
  return new BridgeUnavailableError(message, cause);
}

function callBridgeMethod(method, params = {}, options = {}) {
  const socketPath = options.socketPath || getSocketPath(options.env);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_BRIDGE_TIMEOUT_MS;
  const request = {
    id: options.requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    method,
    params,
  };

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    let buffer = "";

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      fn(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      if (!line) return;
      try {
        finish(resolve, normalizeBridgeResponse(JSON.parse(line)));
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.once("timeout", () => {
      finish(reject, bridgeUnavailable(new Error(`timed out after ${timeoutMs}ms`)));
    });
    socket.once("error", (error) => {
      finish(reject, bridgeUnavailable(error));
    });
    socket.once("end", () => {
      if (!settled) finish(reject, bridgeUnavailable(new Error("socket closed before a response")));
    });
  });
}

async function handleMcpRequest(message, options = {}) {
  if (!message || typeof message !== "object") throw new Error("Invalid JSON-RPC message.");

  if (message.method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "better-browser-agent", version: "0.1.0" },
    };
  }

  if (message.method === "notifications/initialized") return undefined;
  if (message.method === "tools/list") return { tools };

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};

    if (isUnsafeToolName(name)) return textResult(createUnsafeRefusal(name), { isError: true });

    const bridgeMethod = TOOL_TO_BRIDGE_METHOD[name];
    if (!bridgeMethod) throw new Error(`Unknown tool: ${name}`);

    const result = await callBridgeMethod(bridgeMethod, args, options);
    return textResult(result);
  }

  return {};
}

function errorResponse(id, error) {
  const isBridgeUnavailable = error?.code === "bridge-unavailable";
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: isBridgeUnavailable ? -32001 : -32000,
      message: isBridgeUnavailable ? "bridge-unavailable" : error instanceof Error ? error.message : String(error),
      data: isBridgeUnavailable
        ? {
            code: "bridge-unavailable",
            message: error.message,
          }
        : error?.data,
    },
  };
}

async function handleJsonRpcMessage(message, options = {}) {
  const id = message && typeof message === "object" ? message.id : null;
  const isNotification = message && typeof message === "object" && !Object.prototype.hasOwnProperty.call(message, "id");

  try {
    const result = await handleMcpRequest(message, options);
    if (isNotification) return null;
    if (typeof result === "undefined") return null;
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (isNotification) return null;
    return errorResponse(id, error);
  }
}

async function handleJsonRpcLine(line, options = {}) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    return errorResponse(null, error);
  }
  return handleJsonRpcMessage(message, options);
}

function startStdioServer(options = {}) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    const response = await handleJsonRpcLine(line, options);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  return rl;
}

module.exports = {
  __test: {
    BridgeUnavailableError,
    DEFAULT_SOCKET_PATH,
    TOOL_TO_BRIDGE_METHOD,
    callBridgeMethod,
    createUnsafeRefusal,
    errorResponse,
    getSocketPath,
    handleJsonRpcLine,
    handleJsonRpcMessage,
    handleMcpRequest,
    isUnsafeToolName,
    textResult,
    tools,
  },
};

if (require.main === module) {
  startStdioServer();
}
