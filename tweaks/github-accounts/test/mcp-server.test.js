"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SERVER = path.join(__dirname, "..", "mcp-server.js");
const STORE_FILE = "co.thomashulihan.github-accounts.json";

async function runServer(lines, store, rootEnvName = "SHADGPT_USER_ROOT") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "github-accounts-mcp-"));
  await fs.mkdir(path.join(root, "storage"), { recursive: true });
  await fs.writeFile(
    path.join(root, "storage", STORE_FILE),
    JSON.stringify(store),
  );

  const env = { ...process.env };
  delete env.SHADGPT_USER_ROOT;
  delete env.SHADGPT_TWEAKER_LIBRARY_HOME;
  delete env.CODEX_PLUSPLUS_USER_ROOT;
  env[rootEnvName] = root;
  const child = spawn(process.execPath, [SERVER], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  for (const line of lines) child.stdin.write(`${line}\n`);
  child.stdin.end();

  const code = await new Promise((resolve) => child.on("close", resolve));
  await fs.rm(root, { recursive: true, force: true });
  return {
    code,
    root,
    stderr,
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
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "github_accounts_resolve",
          arguments: { projectPath: "" },
        },
      }),
    ],
    {
      accounts: [{ id: "work", name: "Work", username: "work", email: "work@example.com" }],
      assignments: {
        [process.cwd()]: {
          projectPath: process.cwd(),
          accountId: "work",
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.matched, false);
});

test("MCP resolver returns the longest matching assignment", async () => {
  const projectRoot = path.join(os.tmpdir(), "github-accounts-project");
  const nestedRoot = path.join(projectRoot, "packages", "app");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "github_accounts_resolve",
          arguments: { projectPath: path.join(nestedRoot, "src", "index.js") },
        },
      }),
    ],
    {
      accounts: [
        { id: "base", name: "Base", username: "base", email: "base@example.com" },
        { id: "work", name: "Work", username: "work", email: "work@example.com" },
      ],
      assignments: {
        base: { projectPath: projectRoot, accountId: "base" },
        work: { projectPath: nestedRoot, accountId: "work" },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.matched, true);
  assert.equal(payload.assignment.accountId, "work");
  assert.equal(payload.assignment.account.name, "Work");
  assert.deepEqual(payload.env, {
    GITHUB_ACCOUNT: "work",
    GIT_AUTHOR_NAME: "Work",
    GIT_AUTHOR_EMAIL: "work@example.com",
    GIT_COMMITTER_NAME: "Work",
    GIT_COMMITTER_EMAIL: "work@example.com",
  });
});

test("MCP server reads storage from SHADGPT_USER_ROOT", async () => {
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "github_accounts_list_assignments",
          arguments: {},
        },
      }),
    ],
    {
      assignments: {
        one: { projectPath: "/tmp/one", accountId: "work" },
      },
    },
    "SHADGPT_USER_ROOT",
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.storageFile, path.join(result.root, "storage", STORE_FILE));
  assert.equal(payload.assignments.length, 1);
  assert.equal(payload.assignments[0].projectPath, "/tmp/one");
});

test("MCP server lists assignments", async () => {
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "github_accounts_list_assignments",
          arguments: {},
        },
      }),
    ],
    {
      assignments: {
        one: { projectPath: "/tmp/one", accountId: "work" },
        two: { projectPath: "/tmp/two", accountId: "personal" },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.deepEqual(payload.assignments.map((entry) => entry.projectPath).sort(), ["/tmp/one", "/tmp/two"]);
});
