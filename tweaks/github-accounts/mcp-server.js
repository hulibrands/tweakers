#!/usr/bin/env node
/* Minimal MCP stdio server for resolving project GitHub account assignments. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const TWEAK_ID = "co.thomashulihan.github-accounts";
const STORAGE_FILE = path.join(
  process.env.CODEX_PLUSPLUS_USER_ROOT ||
    path.join(os.homedir(), "Library", "Application Support", "codex-plusplus"),
  "storage",
  `${TWEAK_ID}.json`,
);

const tools = [
  {
    name: "github_accounts_resolve",
    description: "Resolve the GitHub account assignment for a project path.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute project path or cwd." },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "github_accounts_list_assignments",
    description: "List configured project-to-GitHub-account assignments.",
    inputSchema: { type: "object", properties: {} },
  },
];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function accounts() {
  const value = readStore().accounts;
  return Array.isArray(value) ? value : [];
}

function assignments() {
  const value = readStore().assignments;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveProject(projectPath) {
  if (typeof projectPath !== "string" || projectPath.trim() === "") return null;
  const normalized = path.resolve(projectPath.trim());
  const entries = Object.values(assignments())
    .filter((entry) => entry && typeof entry.projectPath === "string")
    .filter((entry) => normalized === entry.projectPath || normalized.startsWith(`${entry.projectPath}${path.sep}`))
    .sort((a, b) => b.projectPath.length - a.projectPath.length);
  const assignment = entries[0] || null;
  if (!assignment) return null;
  const account = accounts().find((candidate) => candidate.id === assignment.accountId) || null;
  return { ...assignment, account };
}

function envFor(match) {
  if (!match?.account) return {};
  return {
    GITHUB_ACCOUNT: match.account.username || match.account.name,
    GIT_AUTHOR_NAME: match.account.name,
    GIT_AUTHOR_EMAIL: match.account.email,
    GIT_COMMITTER_NAME: match.account.name,
    GIT_COMMITTER_EMAIL: match.account.email,
  };
}

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "github-accounts", version: "0.1.0" },
    };
  }
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (name === "github_accounts_resolve") {
      const match = resolveProject(args.projectPath);
      return text({ matched: Boolean(match), assignment: match, env: envFor(match) });
    }
    if (name === "github_accounts_list_assignments") {
      return text({ storageFile: STORAGE_FILE, assignments: Object.values(assignments()) });
    }
    throw new Error(`Unknown tool: ${name}`);
  }
  return {};
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    const result = await handle(request);
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
  } catch (error) {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    }) + "\n");
  }
});
