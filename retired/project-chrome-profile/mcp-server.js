#!/usr/bin/env node
/* Minimal MCP stdio server for resolving project Chrome profile assignments. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const STORAGE_FILE = path.join(
  process.env.CODEX_PLUSPLUS_USER_ROOT ||
    path.join(os.homedir(), "Library", "Application Support", "codex-plusplus"),
  "storage",
  `${TWEAK_ID}.json`,
);

const tools = [
  {
    name: "project_chrome_profile_resolve",
    description: "Resolve the Chrome profile assignment for a project path.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute project path or cwd." },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "project_chrome_profile_list_assignments",
    description: "List configured project-to-Chrome-profile assignments.",
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
  return entries[0] || null;
}

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "project-chrome-profile", version: "0.1.0" },
    };
  }
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (name === "project_chrome_profile_resolve") {
      const match = resolveProject(args.projectPath);
      const allowedProfiles = normalizeAssignmentProfiles(match);
      return text({
        matched: Boolean(match),
        assignment: match,
        allowedProfiles,
        env: match ? { CODEX_CHROME_PREFERENCES_PATH: allowedProfiles[0]?.preferencesPath || match.preferencesPath } : {},
      });
    }
    if (name === "project_chrome_profile_list_assignments") {
      return text({ storageFile: STORAGE_FILE, assignments: Object.values(assignments()) });
    }
    throw new Error(`Unknown tool: ${name}`);
  }
  return {};
}

function normalizeAssignmentProfiles(assignment) {
  if (!assignment) return [];
  if (Array.isArray(assignment.allowedProfiles) && assignment.allowedProfiles.length) {
    return assignment.allowedProfiles;
  }
  if (Array.isArray(assignment.preferencesPaths) && assignment.preferencesPaths.length) {
    return assignment.preferencesPaths.map((preferencesPath, index) => ({
      profileDirectory: Array.isArray(assignment.profileDirectories)
        ? assignment.profileDirectories[index]
        : path.basename(path.dirname(preferencesPath)),
      profileName: Array.isArray(assignment.profileNames)
        ? assignment.profileNames[index]
        : path.basename(path.dirname(preferencesPath)),
      preferencesPath,
      userDataDir: path.dirname(path.dirname(preferencesPath)),
    }));
  }
  return [{
    profileDirectory: assignment.profileDirectory,
    profileName: assignment.profileName,
    preferencesPath: assignment.preferencesPath,
    userDataDir: assignment.userDataDir,
  }];
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
