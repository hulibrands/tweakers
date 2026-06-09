#!/usr/bin/env node
/* Project connection resolver for ShadGPT Projects assignments. */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const TWEAK_ID = "co.thomashulihan.projects";
const CHROME_TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const USER_ROOT = process.env.CODEX_PLUSPLUS_USER_ROOT ||
  path.join(os.homedir(), "Library", "Application Support", "codex-plusplus");
const STORAGE_FILE = path.join(USER_ROOT, "storage", `${TWEAK_ID}.json`);
const LEGACY_CHROME_STORAGE_FILE = path.join(USER_ROOT, "storage", `${CHROME_TWEAK_ID}.json`);
const CHROME_ASSIGNMENTS_KEY = "chromeAssignments";
const CHROME_CLEARED_ASSIGNMENTS_KEY = "chromeAssignmentClears";

const tools = [
  {
    name: "projects_google_workspace_resolve",
    description: "Resolve project-local Gmail and Google Drive account assignments before using those plugins.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute project path or cwd." },
        service: { type: "string", enum: ["gmail", "google-drive"], description: "Optional service to resolve." },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "projects_google_workspace_list_assignments",
    description: "List configured per-project Gmail and Google Drive assignments.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "projects_chrome_profile_resolve",
    description: "Resolve the Chrome profile assignment for a project path from Projects-managed Chrome assignments.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Absolute project path or cwd." },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "projects_chrome_profile_list_assignments",
    description: "List configured project-to-Chrome-profile assignments.",
    inputSchema: { type: "object", properties: {} },
  },
];

function readStore(file = STORAGE_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function accounts() {
  const value = readStore().googleWorkspaceAccounts;
  return Array.isArray(value) ? value : [];
}

function assignments() {
  const value = readStore().googleWorkspaceAssignments;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function chromeStore() {
  const value = readStore();
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function chromeAssignments() {
  const store = chromeStore();
  const value = store[CHROME_ASSIGNMENTS_KEY];
  const cleared = store[CHROME_CLEARED_ASSIGNMENTS_KEY];
  const legacy = readStore(LEGACY_CHROME_STORAGE_FILE).assignments;
  const merged = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  const clearedMap = cleared && typeof cleared === "object" && !Array.isArray(cleared) ? cleared : {};
  const legacyMap = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy : {};
  for (const [projectPath, assignment] of Object.entries(legacyMap)) {
    if (Object.prototype.hasOwnProperty.call(merged, projectPath)) continue;
    if (Object.prototype.hasOwnProperty.call(clearedMap, projectPath)) continue;
    merged[projectPath] = assignment;
  }
  return merged;
}

function defaultChromeProfile() {
  const value = chromeStore().defaultProfile || readStore(LEGACY_CHROME_STORAGE_FILE).defaultProfile;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeService(service) {
  const value = String(service || "").trim().toLowerCase();
  if (!value) return "";
  if (value === "gmail") return "gmail";
  if (value === "google-drive" || value === "googledrive" || value === "drive") return "google-drive";
  throw new Error("service must be gmail or google-drive.");
}

function resolveProject(projectPath, service = "") {
  if (typeof projectPath !== "string" || projectPath.trim() === "") return null;
  const normalized = path.resolve(projectPath.trim());
  const entries = Object.entries(assignments())
    .filter(([key, value]) => key && value && typeof value === "object" && !Array.isArray(value))
    .filter(([key]) => normalized === key || normalized.startsWith(`${key}${path.sep}`))
    .sort((a, b) => b[0].length - a[0].length);
  const match = entries[0];
  if (!match) return null;
  const requested = normalizeService(service);
  const services = requested ? [requested] : ["gmail", "google-drive"];
  const accountList = accounts();
  const resolved = {};
  for (const item of services) {
    const assignment = match[1][item] || null;
    if (!assignment) {
      resolved[item] = null;
      continue;
    }
    const account = accountList.find((candidate) => candidate.id === assignment.accountId) || null;
    resolved[item] = { ...assignment, account };
  }
  return { projectPath: match[0], services: resolved };
}

function envFor(result) {
  const env = {};
  const gmail = result?.services?.gmail;
  const drive = result?.services?.["google-drive"];
  if (gmail?.email) {
    env.CODEX_PROJECT_GMAIL_ACCOUNT = gmail.email;
    env.GMAIL_ACCOUNT_EMAIL = gmail.email;
  }
  if (drive?.email) {
    env.CODEX_PROJECT_GOOGLE_DRIVE_ACCOUNT = drive.email;
    env.GOOGLE_DRIVE_ACCOUNT_EMAIL = drive.email;
  }
  return env;
}

function instructionsFor(result) {
  const lines = [];
  const gmail = result?.services?.gmail;
  const drive = result?.services?.["google-drive"];
  if (gmail?.email) {
    lines.push(`Before using [@gmail](plugin://gmail@openai-curated) for this project, use the Gmail connector account ${gmail.email}.`);
  }
  if (drive?.email) {
    lines.push(`Before using [@google-drive](plugin://google-drive@openai-curated) for this project, use the Google Drive connector account ${drive.email}.`);
  }
  return lines;
}

function listAssignments() {
  const accountList = accounts();
  return Object.entries(assignments()).map(([projectPath, services]) => ({
    projectPath,
    services: Object.fromEntries(Object.entries(services || {}).map(([service, assignment]) => [
      service,
      {
        ...assignment,
        account: accountList.find((candidate) => candidate.id === assignment?.accountId) || null,
      },
    ])),
  }));
}

function resolveChromeProject(projectPath) {
  if (typeof projectPath !== "string" || projectPath.trim() === "") return null;
  const normalized = path.resolve(projectPath.trim());
  const entries = Object.values(chromeAssignments())
    .filter((entry) => entry && typeof entry.projectPath === "string")
    .filter((entry) => normalized === entry.projectPath || normalized.startsWith(`${entry.projectPath}${path.sep}`))
    .sort((a, b) => b.projectPath.length - a.projectPath.length);
  return entries[0] || null;
}

function normalizePreferredProfiles(assignment) {
  if (!assignment) return [];
  if (Array.isArray(assignment.preferredProfiles) && assignment.preferredProfiles.length) {
    return assignment.preferredProfiles.map((profile, index) => normalizePreferredProfileEntry(assignment, profile, index));
  }
  if (Array.isArray(assignment.allowedProfiles) && assignment.allowedProfiles.length) {
    return assignment.allowedProfiles.map((profile, index) => normalizePreferredProfileEntry(assignment, profile, index));
  }
  if (Array.isArray(assignment.preferencesPaths) && assignment.preferencesPaths.length) {
    return assignment.preferencesPaths.map((preferencesPath, index) => ({
      profileDirectory: Array.isArray(assignment.profileDirectories)
        ? assignment.profileDirectories[index]
        : path.basename(path.dirname(preferencesPath)),
      profileName: Array.isArray(assignment.profileNames)
        ? assignment.profileNames[index]
        : path.basename(path.dirname(preferencesPath)),
      profileAliases: profileAliasesAtIndex(assignment, index),
      preferencesPath,
      userDataDir: path.dirname(path.dirname(preferencesPath)),
    }));
  }
  return assignment.profileDirectory || assignment.preferencesPath ? [{
    profileDirectory: assignment.profileDirectory,
    profileName: assignment.profileName,
    profileAliases: normalizeProfileAliases(assignment.profileAliases),
    preferencesPath: assignment.preferencesPath,
    userDataDir: assignment.userDataDir,
  }] : [];
}

function normalizePreferredProfileEntry(assignment, profile, index) {
  const preferencesPath = typeof profile?.preferencesPath === "string" ? profile.preferencesPath : "";
  return {
    ...profile,
    profileDirectory: profile?.profileDirectory || (preferencesPath ? path.basename(path.dirname(preferencesPath)) : ""),
    profileName: profile?.profileName || profile?.profileDirectory || (preferencesPath ? path.basename(path.dirname(preferencesPath)) : ""),
    profileAliases: normalizeProfileAliases([
      ...profileAliasesAtIndex(assignment, index),
      ...normalizeProfileAliases(profile?.profileAliases),
    ]),
    preferencesPath,
    userDataDir: profile?.userDataDir || (preferencesPath ? path.dirname(path.dirname(preferencesPath)) : ""),
  };
}

function normalizeProfileAliases(input) {
  const values = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))];
}

function profileAliasesAtIndex(assignment, index) {
  const aliases = assignment?.profileAliases;
  if (Array.isArray(aliases?.[index])) return normalizeProfileAliases(aliases[index]);
  if (index === 0) return normalizeProfileAliases(aliases);
  return [];
}

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "projects", version: "1.0.0" },
    };
  }
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (name === "projects_google_workspace_resolve") {
      const result = resolveProject(args.projectPath, args.service);
      return text({
        matched: Boolean(result),
        assignment: result,
        env: envFor(result),
        instructions: instructionsFor(result),
      });
    }
    if (name === "projects_google_workspace_list_assignments") {
      return text({ storageFile: STORAGE_FILE, assignments: listAssignments() });
    }
    if (name === "projects_chrome_profile_resolve") {
      const match = resolveChromeProject(args.projectPath);
      const fallback = match ? null : defaultChromeProfile();
      const resolved = match || fallback;
      const preferredProfiles = normalizePreferredProfiles(resolved);
      return text({
        matched: Boolean(match),
        assignment: match,
        defaultProfile: fallback,
        preferredProfiles,
        env: resolved ? { CODEX_CHROME_PREFERENCES_PATH: preferredProfiles[0]?.preferencesPath || resolved.preferencesPath } : {},
      });
    }
    if (name === "projects_chrome_profile_list_assignments") {
      return text({ storageFile: STORAGE_FILE, legacyStorageFile: LEGACY_CHROME_STORAGE_FILE, assignments: Object.values(chromeAssignments()) });
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
