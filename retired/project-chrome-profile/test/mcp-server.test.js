"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SERVER = path.join(__dirname, "..", "mcp-server.js");

async function runServer(lines, store) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-chrome-profile-mcp-"));
  await fs.mkdir(path.join(root, "storage"), { recursive: true });
  await fs.writeFile(
    path.join(root, "storage", "co.thomashulihan.project-chrome-profile.json"),
    JSON.stringify(store),
  );

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CODEX_PLUSPLUS_USER_ROOT: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  for (const line of lines) child.stdin.write(`${line}\n`);
  child.stdin.end();

  const code = await new Promise((resolve) => child.on("close", resolve));
  await fs.rm(root, { recursive: true, force: true });
  return {
    code,
    messages: stdout.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line)),
  };
}

test("MCP server reports malformed JSON without crashing", async () => {
  const result = await runServer(["{"], {});

  assert.equal(result.code, 0);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, null);
  assert.match(result.messages[0].error.message, /JSON|Unexpected|Expected/i);
});

test("MCP resolver does not treat an empty project path as cwd", async () => {
  const preferencesPath = path.join(os.tmpdir(), "Chrome", "Default", "Preferences");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "project_chrome_profile_resolve",
          arguments: { projectPath: "" },
        },
      }),
    ],
    {
      assignments: {
        [process.cwd()]: {
          projectPath: process.cwd(),
          preferencesPath,
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.matched, false);
});
