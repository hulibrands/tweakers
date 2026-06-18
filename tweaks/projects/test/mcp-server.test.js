"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SERVER = path.join(__dirname, "..", "mcp-server.js");

async function runServer(lines, store, chromeStore = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projects-mcp-"));
  await fs.mkdir(path.join(root, "storage"), { recursive: true });
  await fs.writeFile(path.join(root, "storage", "co.thomashulihan.projects.json"), JSON.stringify(store));
  if (chromeStore) {
    await fs.writeFile(
      path.join(root, "storage", "co.thomashulihan.project-chrome-profile.json"),
      JSON.stringify(chromeStore),
    );
  }

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

test("Projects MCP resolves Gmail and Google Drive assignments for cwd children", async () => {
  const projectPath = path.join(os.tmpdir(), "projects-mcp-repo");
  const childPath = path.join(projectPath, "apps", "web");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "projects_google_workspace_resolve",
          arguments: { projectPath: childPath },
        },
      }),
    ],
    {
      googleWorkspaceAccounts: [
        { id: "trr", name: "TRR", email: "codex@thereality.report" },
        { id: "hulibrands", name: "Huli Brands", email: "thomas@hulibrands.com" },
      ],
      googleWorkspaceAssignments: {
        [projectPath]: {
          gmail: { projectPath, service: "gmail", accountId: "trr", email: "codex@thereality.report" },
          "google-drive": { projectPath, service: "google-drive", accountId: "hulibrands", email: "thomas@hulibrands.com" },
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.matched, true);
  assert.equal(payload.assignment.projectPath, projectPath);
  assert.equal(payload.assignment.services.gmail.email, "codex@thereality.report");
  assert.equal(payload.assignment.services["google-drive"].email, "thomas@hulibrands.com");
  assert.equal(payload.env.CODEX_PROJECT_GMAIL_ACCOUNT, "codex@thereality.report");
  assert.equal(payload.env.CODEX_PROJECT_GOOGLE_DRIVE_ACCOUNT, "thomas@hulibrands.com");
  assert.match(payload.instructions.join("\n"), /@gmail/);
  assert.match(payload.instructions.join("\n"), /@google-drive/);
});

test("Projects MCP can resolve a single Google Workspace service", async () => {
  const projectPath = path.join(os.tmpdir(), "projects-mcp-single");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "projects_google_workspace_resolve",
          arguments: { projectPath, service: "gmail" },
        },
      }),
    ],
    {
      googleWorkspaceAccounts: [{ id: "personal", email: "tommyhulihan@gmail.com" }],
      googleWorkspaceAssignments: {
        [projectPath]: {
          gmail: { projectPath, service: "gmail", accountId: "personal", email: "tommyhulihan@gmail.com" },
          "google-drive": { projectPath, service: "google-drive", accountId: "personal", email: "tommyhulihan@gmail.com" },
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.assignment.services.gmail.email, "tommyhulihan@gmail.com");
  assert.equal(payload.assignment.services["google-drive"], undefined);
});

test("Projects MCP resolves Chrome profile assignments from the legacy Chrome store", async () => {
  const projectPath = path.join(os.tmpdir(), "projects-mcp-chrome");
  const childPath = path.join(projectPath, "apps", "web");
  const preferencesPath = path.join(os.tmpdir(), "Chrome", "Profile 7", "Preferences");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "projects_chrome_profile_resolve",
          arguments: { projectPath: childPath },
        },
      }),
    ],
    {},
    {
      assignments: {
        [projectPath]: {
          projectPath,
          profileDirectory: "Profile 7",
          profileName: "TRR",
          profileAliases: ["codex@thereality.report", "TRR"],
          preferencesPath,
          preferredProfiles: [{
            profileDirectory: "Profile 7",
            profileName: "TRR",
            preferencesPath,
          }],
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.matched, true);
  assert.equal(payload.assignment.projectPath, projectPath);
  assert.equal(payload.preferredProfiles[0].preferencesPath, preferencesPath);
  assert.deepEqual(payload.preferredProfiles[0].profileAliases, ["codex@thereality.report", "TRR"]);
  assert.equal(payload.env.CODEX_CHROME_PREFERENCES_PATH, preferencesPath);
});

test("Projects MCP resolves Chrome profile assignments from Projects storage", async () => {
  const projectPath = path.join(os.tmpdir(), "projects-mcp-owned-chrome");
  const preferencesPath = path.join(os.tmpdir(), "Chrome", "Profile 9", "Preferences");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "projects_chrome_profile_resolve",
          arguments: { projectPath },
        },
      }),
    ],
    {
      chromeAssignments: {
        [projectPath]: {
          projectPath,
          profileDirectory: "Profile 9",
          profileName: "Projects Owned",
          profileAliases: ["projects@example.com", "Projects Alias"],
          preferencesPath,
          preferredProfiles: [{
            profileDirectory: "Profile 9",
            profileName: "Projects Owned",
            preferencesPath,
          }],
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.messages[0].result.content[0].text);
  assert.equal(payload.matched, true);
  assert.equal(payload.assignment.projectPath, projectPath);
  assert.equal(payload.preferredProfiles[0].preferencesPath, preferencesPath);
  assert.deepEqual(payload.preferredProfiles[0].profileAliases, ["projects@example.com", "Projects Alias"]);
  assert.equal(payload.env.CODEX_CHROME_PREFERENCES_PATH, preferencesPath);
});

test("Projects MCP list tools require a project and redact broad account metadata by default", async () => {
  const projectPath = path.join(os.tmpdir(), "projects-mcp-list");
  const preferencesPath = path.join(os.tmpdir(), "Chrome", "Profile 9", "Preferences");
  const result = await runServer(
    [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "projects_google_workspace_list_assignments",
          arguments: { projectPath },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "projects_chrome_profile_list_assignments",
          arguments: { projectPath },
        },
      }),
    ],
    {
      googleWorkspaceAccounts: [{ id: "personal", email: "tommyhulihan@gmail.com" }],
      googleWorkspaceAssignments: {
        [projectPath]: {
          gmail: { projectPath, service: "gmail", accountId: "personal", email: "tommyhulihan@gmail.com" },
        },
      },
      chromeAssignments: {
        [projectPath]: {
          projectPath,
          profileDirectory: "Profile 9",
          profileName: "Projects Owned",
          profileAliases: ["projects@example.com", "Projects Alias"],
          preferencesPath,
          preferredProfiles: [{
            profileDirectory: "Profile 9",
            profileName: "Projects Owned",
            preferencesPath,
          }],
        },
      },
    },
  );

  assert.equal(result.code, 0);
  const googlePayload = JSON.parse(result.messages[0].result.content[0].text);
  const chromePayload = JSON.parse(result.messages[1].result.content[0].text);
  assert.equal(googlePayload.assignments[0].projectName, path.basename(projectPath));
  assert.equal(googlePayload.assignments[0].services.gmail.email, "[redacted-email]");
  assert.equal(googlePayload.assignments[0].services.gmail.accountId, "[redacted]");
  assert.equal(chromePayload.assignments[0].preferencesPath, `[redacted]/${path.basename(preferencesPath)}`);
  assert.deepEqual(chromePayload.assignments[0].profileAliases, ["[redacted-email]", "Projects Alias"]);
  assert.doesNotMatch(JSON.stringify({ googlePayload, chromePayload }), /tommyhulihan|projects@example\.com|Chrome\/Profile 9/);
});
