const PROJECTS_TWEAK_ID = "co.thomashulihan.projects";
const CHROME_TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const CHROME_ASSIGNMENTS_KEY = "chromeAssignments";
const GOOGLE_WORKSPACE_ASSIGNMENTS_KEY = "googleWorkspaceAssignments";
const MODAL_WORKSPACE_ASSIGNMENTS_KEY = "modalWorkspaceAssignments";
const DECODO_ASSIGNMENTS_KEY = "decodoAssignments";
const AGENTS_WRITE_DISABLED_PROJECTS_KEY = "agentsInstructionWriteDisabledProjects";
const AGENTS_PLUGIN_WRITE_DISABLED_KEY = "agentsInstructionPluginWriteDisabled";
const AGENTS_BLOCK_START = "<!-- codex-plugin-profiles:start -->";
const AGENTS_BLOCK_END = "<!-- codex-plugin-profiles:end -->";
const AGENTS_BLOCK_PATTERN = /<!-- codex-plugin-profiles:start -->[\s\S]*?<!-- codex-plugin-profiles:end -->/;
const AGENTS_PLUGIN_IDS = Object.freeze(["chrome", "gmail", "google-drive", "modal-platform", "supabase", "decodo"]);

function syncProjectConnectionInstructions(input, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const projectPath = normalizeProjectPath(input?.projectPath || input, options);
  assertKnownProjectPath(projectPath, options);
  if (isProjectAgentsInstructionWriteDisabled(projectPath, options)) {
    return agentsInstructionResult(projectPath, {
      path,
      changed: false,
      skipped: true,
      reason: "disabled",
      connectionCount: 0,
    });
  }
  const summary = projectConnectionInstructionSummary({
    projectPath,
    projectName: input?.projectName || input?.name,
  }, options);
  return writeProjectConnectionInstructions(summary, { ...options, fs, path });
}

function projectConnectionInstructionSummary(input, options = {}) {
  const path = options.path || require("node:path");
  const projectPath = normalizeProjectPath(input?.projectPath || input, options);
  assertKnownProjectPath(projectPath, options);
  const projectStorage = readStorageFile(PROJECTS_TWEAK_ID, options);
  const chromeStorage = readStorageFile(CHROME_TWEAK_ID, options);
  const projectChromeAssignments = projectStorage[CHROME_ASSIGNMENTS_KEY] || {};
  const legacyChromeAssignments = chromeStorage.assignments || {};
  return {
    projectPath,
    projectName: String(input?.projectName || input?.name || path.basename(projectPath)).trim(),
    chromeAssignment: projectChromeAssignments[projectPath] || legacyChromeAssignments[projectPath] || null,
    googleWorkspaceAssignments: projectStorage[GOOGLE_WORKSPACE_ASSIGNMENTS_KEY]?.[projectPath] || {},
    modalWorkspaceAssignment: projectStorage[MODAL_WORKSPACE_ASSIGNMENTS_KEY]?.[projectPath] || null,
    decodoAssignment: projectStorage[DECODO_ASSIGNMENTS_KEY]?.[projectPath] || null,
    supabaseBinding: readSupabaseBinding(projectPath, options),
    pluginWriteDisabled: projectAgentsInstructionPluginWriteDisabled(projectPath, options),
  };
}

function previewProjectConnectionInstructions(input, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const projectPath = normalizeProjectPath(input?.projectPath || input, options);
  assertKnownProjectPath(projectPath, options);
  const summary = projectConnectionInstructionSummary(input, options);
  const block = buildProjectConnectionInstructionBlock(summary, options);
  const target = projectPath && !projectPath.startsWith("codex-sidebar://") ? path.join(projectPath, "AGENTS.md") : "";
  const existing = target && fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  return {
    instructionFile: target,
    blockText: block.text,
    connectionCount: block.connectionCount,
    hasManagedBlock: AGENTS_BLOCK_PATTERN.test(existing),
    writesDisabled: isProjectAgentsInstructionWriteDisabled(projectPath, options),
    pluginWriteDisabled: projectAgentsInstructionPluginWriteDisabled(projectPath, options),
  };
}

function writeProjectConnectionInstructions(summary, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const projectPath = normalizeProjectPath(summary?.projectPath, options);
  assertKnownProjectPath(projectPath, options);
  if (projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) {
    return agentsInstructionResult(projectPath, {
      path,
      changed: false,
      skipped: true,
      reason: "not-local",
      connectionCount: 0,
    });
  }
  const target = path.join(projectPath, "AGENTS.md");
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const block = buildProjectConnectionInstructionBlock({ ...summary, projectPath }, options);
  const connectionCount = block.connectionCount;
  const next = block.text
    ? upsertAgentsBlock(existing, block.text)
    : removeAgentsBlock(existing);
  if (next === existing) {
    return {
      instructionFile: target,
      changed: false,
      skipped: false,
      reason: block.text ? "unchanged" : "absent",
      connectionCount,
    };
  }
  if (!next.trim()) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } else {
    fs.writeFileSync(target, next, "utf8");
  }
  return {
    instructionFile: target,
    changed: true,
    skipped: false,
    reason: block.text ? "updated" : "removed",
    connectionCount,
  };
}

function buildProjectConnectionInstructionBlock(summary, options = {}) {
  const path = options.path || require("node:path");
  const lines = [];
  const disabled = new Set(normalizePluginIds(summary.pluginWriteDisabled));
  const enabled = (pluginId) => !disabled.has(pluginId);
  const chromeProfiles = normalizePreferredProfiles(summary.chromeAssignment);
  if (enabled("chrome") && chromeProfiles.length) {
    const profileList = chromeProfiles
      .map((profile) => `"${profile.profileName}" (${profile.profileDirectory})`)
      .join(", ");
    const primary = chromeProfiles[0];
    lines.push(`- [@Chrome](plugin://chrome@openai-bundled): prefer ${chromeProfiles.length === 1 ? "this saved Chrome profile" : "one of these saved Chrome profiles"} for this project: ${profileList}.`);
    if (primary.preferencesPath) {
      lines.push(`- Set CODEX_CHROME_PREFERENCES_PATH="${primary.preferencesPath}" before launching Chrome-backed tools unless the user asks for a different Chrome profile.`);
    }
    lines.push("- This project-level profile preference chooses the default browser identity for new tool launches; it does not block other Chrome profiles from reaching local servers or pages.");
  }

  const google = summary.googleWorkspaceAssignments || {};
  if (enabled("gmail") && google.gmail?.email) {
    lines.push(`- [@gmail](plugin://gmail@openai-curated): use ${google.gmail.email} for Gmail work in this project.`);
  }
  if (enabled("google-drive") && google["google-drive"]?.email) {
    lines.push(`- [@google-drive](plugin://google-drive@openai-curated): use ${google["google-drive"].email} for Drive, Docs, Sheets, and Slides work in this project.`);
  }

  const modal = summary.modalWorkspaceAssignment || null;
  if (enabled("modal-platform") && (modal?.workspace || modal?.profile)) {
    const label = [modal.profile, modal.workspace].filter(Boolean).join(" / ");
    lines.push(`- [@modal-platform](plugin://modal-platform@local-plugins): use ${label} for Modal work in this project.`);
  }

  const supabase = summary.supabaseBinding || null;
  if (enabled("supabase") && supabase?.projectRef) {
    const tokenText = supabase.bearerTokenEnvVar ? ` with ${supabase.bearerTokenEnvVar}` : "";
    lines.push(`- [@supabase](plugin://supabase@openai-curated): use project ${supabase.projectRef}${tokenText} for Supabase work in this project.`);
  }

  const decodo = summary.decodoAssignment || null;
  if (enabled("decodo") && (decodo?.accountName || decodo?.username)) {
    const label = [decodo.accountName, decodo.username].filter(Boolean).join(" / ");
    lines.push(`- [@decodo](plugin://decodo@local-plugins): use ${label} for Decodo scraping and proxy work in this project.`);
  }

  if (!lines.length) return { text: "", connectionCount: 0 };
  const projectName = String(summary.projectName || path.basename(summary.projectPath || "") || "this project").trim();
  return {
    text: [
      AGENTS_BLOCK_START,
      "## Project Settings",
      `Project Settings manages these plugin account defaults for ${projectName}.`,
      ...lines,
      AGENTS_BLOCK_END,
    ].join("\n"),
    connectionCount: lines.filter((line) => /^\- \[@/.test(line)).length,
  };
}

function setProjectAgentsInstructionWriteDisabled(input, options = {}) {
  const projectPath = normalizeProjectPath(input?.projectPath || input, options);
  assertKnownProjectPath(projectPath, options);
  const disabled = Boolean(input?.disabled);
  const storage = readStorageFile(PROJECTS_TWEAK_ID, options);
  const current = normalizeDisabledProjects(storage[AGENTS_WRITE_DISABLED_PROJECTS_KEY]);
  const next = new Set(current);
  if (disabled) next.add(projectPath);
  else next.delete(projectPath);
  storage[AGENTS_WRITE_DISABLED_PROJECTS_KEY] = [...next].sort();
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(PROJECTS_TWEAK_ID, storage, options);
  return { projectPath, disabled };
}

function setProjectAgentsInstructionPluginWriteDisabled(input, options = {}) {
  const projectPath = normalizeProjectPath(input?.projectPath || input, options);
  assertKnownProjectPath(projectPath, options);
  const pluginId = normalizePluginId(input?.pluginId);
  const disabled = Boolean(input?.disabled);
  const storage = readStorageFile(PROJECTS_TWEAK_ID, options);
  const current = normalizePluginDisabledMap(storage[AGENTS_PLUGIN_WRITE_DISABLED_KEY]);
  const nextPlugins = new Set(current[projectPath] || []);
  if (disabled) nextPlugins.add(pluginId);
  else nextPlugins.delete(pluginId);
  if (nextPlugins.size) current[projectPath] = [...nextPlugins].sort();
  else delete current[projectPath];
  storage[AGENTS_PLUGIN_WRITE_DISABLED_KEY] = current;
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(PROJECTS_TWEAK_ID, storage, options);
  return { projectPath, pluginId, disabled, pluginWriteDisabled: current[projectPath] || [] };
}

function isProjectAgentsInstructionWriteDisabled(projectPathInput, options = {}) {
  const projectPath = normalizeProjectPath(projectPathInput, options);
  assertKnownProjectPath(projectPath, options);
  const storage = readStorageFile(PROJECTS_TWEAK_ID, options);
  return normalizeDisabledProjects(storage[AGENTS_WRITE_DISABLED_PROJECTS_KEY]).includes(projectPath);
}

function projectAgentsInstructionPluginWriteDisabled(projectPathInput, options = {}) {
  const projectPath = normalizeProjectPath(projectPathInput, options);
  assertKnownProjectPath(projectPath, options);
  const storage = readStorageFile(PROJECTS_TWEAK_ID, options);
  return normalizePluginDisabledMap(storage[AGENTS_PLUGIN_WRITE_DISABLED_KEY])[projectPath] || [];
}

function normalizeDisabledProjects(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].sort();
}

function normalizePluginDisabledMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [projectPath, pluginIds] of Object.entries(value)) {
    const ids = normalizePluginIds(pluginIds);
    if (ids.length) normalized[projectPath] = ids;
  }
  return normalized;
}

function normalizePluginIds(input) {
  const values = Array.isArray(input) ? input : [input];
  const ids = [];
  for (const value of values) {
    try {
      const id = normalizePluginId(value);
      if (id) ids.push(id);
    } catch {}
  }
  return [...new Set(ids)].sort();
}

function normalizePluginId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!id) return "";
  if (id === "modal") return "modal-platform";
  if (id === "drive" || id === "google-drive") return "google-drive";
  if (id === "chrome" || id === "gmail" || id === "modal-platform" || id === "supabase" || id === "decodo") return id;
  throw new Error("Unknown AGENTS.md plugin toggle.");
}

function normalizePreferredProfiles(assignment) {
  if (!assignment || typeof assignment !== "object") return [];
  const preferred = Array.isArray(assignment.preferredProfiles) ? assignment.preferredProfiles : [];
  if (preferred.length) {
    return preferred.map((profile) => ({
      profileDirectory: String(profile.profileDirectory || "").trim(),
      profileName: String(profile.profileName || profile.profileDirectory || "Chrome profile").trim(),
      preferencesPath: String(profile.preferencesPath || "").trim(),
    })).filter((profile) => profile.profileDirectory || profile.preferencesPath);
  }
  const preferencesPaths = Array.isArray(assignment.preferencesPaths)
    ? assignment.preferencesPaths
    : [assignment.preferencesPath];
  const profileDirectories = Array.isArray(assignment.profileDirectories)
    ? assignment.profileDirectories
    : [assignment.profileDirectory];
  const profileNames = Array.isArray(assignment.profileNames)
    ? assignment.profileNames
    : [assignment.profileName];
  return preferencesPaths.map((preferencesPath, index) => ({
    preferencesPath: String(preferencesPath || "").trim(),
    profileDirectory: String(profileDirectories[index] || "").trim(),
    profileName: String(profileNames[index] || profileDirectories[index] || "Chrome profile").trim(),
  })).filter((profile) => profile.profileDirectory || profile.preferencesPath);
}

function readSupabaseBinding(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const projectPath = normalizeProjectPath(projectPathInput, options);
  const configPath = path.join(projectPath, ".codex", "config.toml");
  if (!fs.existsSync(configPath)) return null;
  const text = fs.readFileSync(configPath, "utf8");
  const block = findTomlTableBlock(text, "mcp_servers.supabase") || text;
  const projectRef =
    firstTomlString(block, "project_id") ||
    firstTomlString(block, "projectRef") ||
    projectRefFromSupabaseMcpUrl(firstTomlString(block, "url"));
  const bearerTokenEnvVar = firstTomlString(block, "bearer_token_env_var") || firstTomlString(block, "bearerTokenEnvVar");
  if (!projectRef && !bearerTokenEnvVar) return null;
  return { projectRef, bearerTokenEnvVar };
}

function firstTomlString(text, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m");
  const match = pattern.exec(String(text || ""));
  return match ? match[1] : "";
}

function projectRefFromSupabaseMcpUrl(url) {
  try {
    return new URL(String(url || "")).searchParams.get("project_ref") || "";
  } catch {
    return "";
  }
}

function findTomlTableBlock(content, tableName) {
  const text = String(content || "");
  const header = new RegExp(`^\\s*\\[${escapeRegExp(tableName)}\\]\\s*$`, "m");
  const match = header.exec(text);
  if (!match) return "";
  const bodyStart = match.index + match[0].length;
  const rest = text.slice(bodyStart);
  const next = /^\s*\[[^\]]+\]\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertAgentsBlock(existing, block) {
  if (AGENTS_BLOCK_PATTERN.test(existing)) return existing.replace(AGENTS_BLOCK_PATTERN, block);
  return `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n\n" : ""}${block}\n`;
}

function removeAgentsBlock(existing) {
  return String(existing || "")
    .replace(/\n{0,2}<!-- codex-plugin-profiles:start -->[\s\S]*?<!-- codex-plugin-profiles:end -->\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, (match) => (match.includes("\n") ? "\n" : ""));
}

function agentsInstructionResult(projectPath, details) {
  const path = details.path || require("node:path");
  return {
    instructionFile: projectPath && !projectPath.startsWith("codex-sidebar://") ? path.join(projectPath, "AGENTS.md") : "",
    changed: Boolean(details.changed),
    skipped: Boolean(details.skipped),
    reason: details.reason || "",
    connectionCount: Number(details.connectionCount || 0),
  };
}

function storageFileFor(tweakId, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const userRoot = options.userRoot || userRootForPlatform(home, path);
  return path.join(userRoot, "storage", `${tweakId}.json`);
}

function readStorageFile(tweakId, options = {}) {
  const fs = options.fs || require("node:fs");
  try {
    const value = JSON.parse(fs.readFileSync(storageFileFor(tweakId, options), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStorageFile(tweakId, value, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const file = storageFileFor(tweakId, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function normalizeProjectPath(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  if (typeof input !== "string" || input.trim() === "") throw new Error("Project path is required.");
  if (input.startsWith("codex-sidebar://")) return input;
  return path.resolve(input.replace(/^~(?=$|\/|\\)/, home));
}

function assertKnownProjectPath(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(projectPathInput, { home, path });
  if (projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) {
    throw new Error("This project needs a local path before Projects can update AGENTS.md.");
  }
  if (!Array.isArray(options.allowedProjectPaths)) return projectPath;
  const allowed = normalizeAllowedProjectPaths(options.allowedProjectPaths, { fs, path, home });
  if (!allowed.length) {
    throw new Error("Project path must be one of the known Codex projects before Projects can update AGENTS.md.");
  }
  const realProjectPath = realpathOrResolved(projectPath, { fs, path });
  if (!allowed.includes(realProjectPath)) {
    throw new Error("Project path must be one of the known Codex projects before Projects can update AGENTS.md.");
  }
  return realProjectPath;
}

function normalizeAllowedProjectPaths(values, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value.trim() || value.startsWith("codex-sidebar://")) continue;
    try {
      const projectPath = normalizeProjectPath(value, { home, path });
      if (!fs.existsSync(projectPath)) continue;
      normalized.push(realpathOrResolved(projectPath, { fs, path }));
    } catch {}
  }
  return [...new Set(normalized)].sort();
}

function realpathOrResolved(value, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function userRootForPlatform(home, path) {
  if (process.env.CODEX_PLUSPLUS_USER_ROOT) return path.resolve(process.env.CODEX_PLUSPLUS_USER_ROOT);
  if (process.env.CODEX_PLUSPLUS_HOME) return path.resolve(process.env.CODEX_PLUSPLUS_HOME);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "codex-plusplus");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codex-plusplus");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "codex-plusplus");
}

module.exports = {
  AGENTS_BLOCK_START,
  AGENTS_BLOCK_END,
  AGENTS_PLUGIN_IDS,
  AGENTS_PLUGIN_WRITE_DISABLED_KEY,
  AGENTS_WRITE_DISABLED_PROJECTS_KEY,
  buildProjectConnectionInstructionBlock,
  isProjectAgentsInstructionWriteDisabled,
  previewProjectConnectionInstructions,
  projectAgentsInstructionPluginWriteDisabled,
  projectConnectionInstructionSummary,
  setProjectAgentsInstructionWriteDisabled,
  setProjectAgentsInstructionPluginWriteDisabled,
  syncProjectConnectionInstructions,
  writeProjectConnectionInstructions,
};
