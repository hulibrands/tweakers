const TWEAK_ID = "co.thomashulihan.thread-summary-profiles";
const PROJECTS_TWEAK_ID = "co.thomashulihan.projects";
const CHROME_TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const IPC_GET_SUMMARY = "getThreadProfileSummary";
const IPC_OPEN_ACTION = "openThreadProfileAction";
const SECTION_ATTR = "data-codexpp-thread-summary-profiles";
const ROW_ORDER = Object.freeze(["chrome", "supabase", "github", "google-drive", "gmail", "modal"]);

let activeCleanup = [];

module.exports = {
  start(api) {
    activeCleanup = [];
    if (api.process === "main") startMain(api, activeCleanup);
    if (api.process === "renderer") startRenderer(api, activeCleanup);
  },

  stop() {
    for (const cleanup of activeCleanup) {
      try {
        cleanup();
      } catch {}
    }
    activeCleanup = [];
  },

  __test: {
    SECTION_ATTR,
    ROW_ORDER,
    buildThreadProfileSummary,
    buildProfileRows,
    normalizeProfileRow,
    parseGithubRemote,
    parseSupabaseConfigToml,
    sanitizeAction,
    inferRendererProjectContext,
    extractProjectPathFromVisibleText,
    injectProfilesSection,
    findThreadSummaryPanels,
    createProfilesSection,
  },
};

function startMain(api, cleanup) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const childProcess = require("node:child_process");
  const home = os.homedir();
  const userRoot = userRootForPlatform(home, path);

  cleanup.push(api.ipc.handle(IPC_GET_SUMMARY, (input = {}) => buildThreadProfileSummary(input, {
    fs,
    os,
    path,
    childProcess,
    home,
    userRoot,
    env: process.env,
  })));
  cleanup.push(api.ipc.handle(IPC_OPEN_ACTION, (action) => openProfileAction(action, { childProcess })));
}

function startRenderer(api, cleanup) {
  installStyles();

  let scheduled = false;
  let raf = 0;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      raf = 0;
      injectProfilesSection(document, api).catch((error) => {
        api.log?.warn?.("[thread-summary-profiles] renderer injection failed", error?.message || String(error));
      });
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(run);
    else setTimeout(run, 0);
  };

  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  cleanup.push(() => {
    observer.disconnect();
    if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    document.querySelectorAll(`[${SECTION_ATTR}="true"]`).forEach((node) => node.remove());
  });
}

function buildThreadProfileSummary(input = {}, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const rawProjectPath = resolveProjectPathInput(input, options);
  const normalizedProjectPath = normalizeProjectPath(rawProjectPath, { path, home, allowEmpty: true });
  const requestedPath = resolveStoredProjectPrefix(normalizedProjectPath, options) || normalizedProjectPath;
  const projectPath = requestedPath || inferSingleConfiguredProjectPath(options);
  const projectName = cleanText(input.projectName || (projectPath ? path.basename(projectPath) : ""), 120) || "Unknown project";
  return {
    projectPath,
    projectName,
    rows: buildProfileRows(projectPath, projectName, options),
  };
}

function buildProfileRows(projectPath, projectName, options = {}) {
  const rows = [
    chromeRow(projectPath, options),
    supabaseRow(projectPath, options),
    githubRow(projectPath, options),
    googleWorkspaceRow(projectPath, "google-drive", options),
    googleWorkspaceRow(projectPath, "gmail", options),
    modalRow(projectPath, options),
  ];
  return rows.map(normalizeProfileRow).filter((row) => row.state !== "unset");
}

function chromeRow(projectPath, options = {}) {
  const assignment = readChromeStorage(options).assignments[projectPath] || null;
  const preferred = normalizeChromePreferredProfiles(assignment);
  const primary = preferred[0] || {};
  if (!assignment) {
    return baseRow("chrome", "Chrome", "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  const value = cleanText(primary.profileName || assignment.profileName || primary.profileDirectory || assignment.profileDirectory || "Set", 120);
  const detail = cleanText(primary.profileDirectory || assignment.profileDirectory || "", 120);
  return baseRow("chrome", "Chrome", value, {
    detail,
    state: "set",
    status: freshness("Assigned locally", assignment.updatedAt),
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function supabaseRow(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const configPath = projectPath ? path.join(projectPath, ".codex", "config.toml") : "";
  let binding = null;
  try {
    binding = parseSupabaseConfigToml(fs.readFileSync(configPath, "utf8"));
  } catch {}
  if (!binding?.projectRef) {
    return baseRow("supabase", "Supabase", "No project", {
      state: "unset",
      status: "Status unknown",
      action: fileAction(configPath || ".codex/config.toml"),
    });
  }
  return baseRow("supabase", "Supabase", binding.projectRef, {
    detail: binding.features.length ? binding.features.join(", ") : ".codex/config.toml",
    state: "set",
    status: "Config detected",
    freshness: configPath,
    action: fileAction(configPath),
  });
}

function githubRow(projectPath, options = {}) {
  const repo = gitRepositoriesForProject(projectPath, options)[0] || null;
  if (!repo) {
    return baseRow("github", "GitHub", "No repo detected", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  return baseRow("github", "GitHub", repo.fullName, {
    detail: repo.remotes.join(", ") || "remote",
    state: "set",
    status: "Remote detected",
    href: repo.url,
    action: externalAction(repo.url),
  });
}

function googleWorkspaceRow(projectPath, service, options = {}) {
  const storage = readProjectsStorage(options);
  const assignment = storage.googleWorkspaceAssignments?.[projectPath]?.[service] || null;
  const label = service === "gmail" ? "Gmail" : "Google Drive";
  if (!assignment) {
    return baseRow(service, label, "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  return baseRow(service, label, assignment.email || assignment.accountName || "Set", {
    detail: assignment.source ? `Source: ${assignment.source}` : "",
    state: "set",
    status: freshness("Project default", assignment.updatedAt),
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function modalRow(projectPath, options = {}) {
  const storage = readProjectsStorage(options);
  const assignment = storage.modalWorkspaceAssignments?.[projectPath] || null;
  if (!assignment) {
    const workspaceConfig = readModalWorkspaceConfig(projectPath, options);
    if (!workspaceConfig) {
      return baseRow("modal", "Modal", "Unset", {
        state: "unset",
        status: "Status unknown",
        action: settingsAction("projects"),
      });
    }
    return baseRow("modal", "Modal", workspaceConfig.appName || "Enabled", {
      detail: workspaceConfig.executor ? `Executor: ${workspaceConfig.executor}` : workspaceConfig.source,
      state: "set",
      status: "Workspace profile",
      freshness: workspaceConfig.source,
      action: settingsAction("projects"),
    });
  }
  const cliContext = activeModalWorkspaceContext(projectPath, options);
  const conflict = modalWorkspaceConflict(assignment, cliContext);
  const value = assignment.workspace || assignment.accountName || assignment.profile || "Set";
  let detail = "Active CLI unavailable";
  let status = assignment.updatedAt ? `Assigned ${shortDate(assignment.updatedAt)}` : "Assigned locally";
  let state = "set";
  if (conflict) {
    detail = `Active CLI: ${conflict.activeProfile} / ${conflict.activeWorkspace}`;
    status = "CLI conflict";
    state = "warning";
  } else if (cliContext.profile || cliContext.workspace) {
    detail = assignment.profile ? `Profile ${assignment.profile}` : "Active CLI matches";
    status = "CLI checked";
  } else if (assignment.profile) {
    detail = `Profile ${assignment.profile}`;
  }
  return baseRow("modal", "Modal", value, {
    detail,
    state,
    status,
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function readModalWorkspaceConfig(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  if (!projectPath) return null;
  for (const rel of ["profiles/local-full.env", "profiles/local-docker.env"]) {
    const filePath = path.join(projectPath, rel);
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const values = parseEnvAssignments(content);
    if (values.WORKSPACE_TRR_MODAL_ENABLED !== "1" && values.TRR_MODAL_ENABLED !== "1") continue;
    return {
      appName: values.WORKSPACE_TRR_MODAL_APP_NAME || values.TRR_MODAL_APP_NAME || "",
      executor: values.WORKSPACE_TRR_REMOTE_EXECUTOR || values.TRR_REMOTE_EXECUTOR || "modal",
      source: rel,
    };
  }
  return null;
}

function baseRow(id, label, value, extra = {}) {
  return { id, label, value, detail: "", status: "Status unknown", freshness: "", href: "", state: "unset", action: null, ...extra };
}

function normalizeProfileRow(row) {
  const id = ROW_ORDER.includes(row?.id) ? row.id : "chrome";
  const state = ["set", "unset", "warning", "error"].includes(row?.state) ? row.state : "unset";
  return {
    id,
    label: cleanText(row?.label || id, 80),
    value: cleanText(row?.value || "Unset", 160),
    detail: cleanText(row?.detail || "", 200),
    status: cleanText(row?.status || "Status unknown", 160),
    freshness: cleanText(row?.freshness || "", 240),
    href: safeExternalUrl(row?.href || ""),
    state,
    action: sanitizeAction(row?.action),
  };
}

async function injectProfilesSection(rootDocument, api) {
  const panels = findThreadSummaryPanels(rootDocument);
  pruneOrphanProfilesSections(rootDocument, panels);
  if (!panels.length) return 0;
  const context = inferRendererProjectContext(rootDocument, panels);
  let summary = null;
  try {
    summary = await api.ipc.invoke(IPC_GET_SUMMARY, context);
  } catch {
    // Renderer fallback: buildProfileRows reads local storage via require("node:fs"),
    // which is undefined in the browser context and threw "require is not defined",
    // aborting every injection. The renderer can't read files anyway — degrade to
    // empty rows (the panel is removed when rows.length === 0).
    summary = { projectPath: context.projectPath || "", projectName: context.projectName || "", rows: [] };
  }
  const rows = Array.isArray(summary.rows) ? summary.rows.map(normalizeProfileRow).filter((row) => row.state !== "unset") : [];
  let count = 0;
  for (const panel of panels) {
    if (!rows.length) {
      panel.querySelector(`[${SECTION_ATTR}="true"]`)?.remove();
      continue;
    }
    const next = createProfilesSection(summary, {
      onAction: (action) => handleRendererAction(api, action),
    });
    const existing = panel.querySelector(`[${SECTION_ATTR}="true"]`);
    if (existing) existing.replaceWith(next);
    else insertProfilesSection(panel, next);
    count += 1;
  }
  return count;
}

function pruneOrphanProfilesSections(rootDocument, panels) {
  const activePanels = new Set(panels || []);
  rootDocument.querySelectorAll(`[${SECTION_ATTR}="true"]`).forEach((node) => {
    if (![...activePanels].some((panel) => panel.contains(node))) node.remove();
  });
}

function findThreadSummaryPanels(rootDocument = document) {
  const candidates = Array.from(rootDocument.querySelectorAll("aside, section, div")).filter((node) => {
    if (!isElement(node) || node.hasAttribute(SECTION_ATTR)) return false;
    const text = normalizeVisibleText(node.textContent);
    if (!text || text.length > 2000) return false;
    const headings = ["environment", "sources", "progress", "subagents"].filter((heading) => text.includes(heading));
    return headings.length >= 2;
  });
  return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
}

function insertProfilesSection(panel, section) {
  const sections = Array.from(panel.children || []).filter(isElement);
  const progress = sections.find((node) => normalizeVisibleText(node.textContent).startsWith("progress"));
  if (progress?.parentElement === panel) panel.insertBefore(section, progress);
  else panel.appendChild(section);
}

function createProfilesSection(summary = {}, options = {}) {
  const section = document.createElement("section");
  section.setAttribute(SECTION_ATTR, "true");
  section.className = "codexpp-thread-summary-profiles";

  const title = document.createElement("div");
  title.className = "codexpp-thread-summary-profiles__title";
  title.textContent = "Profiles";
  section.appendChild(title);

  const rows = Array.isArray(summary.rows) ? summary.rows.map(normalizeProfileRow).filter((row) => row.state !== "unset") : [];
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "codexpp-thread-summary-profiles__empty";
    empty.hidden = true;
    empty.textContent = "No profiles connected";
    section.appendChild(empty);
  }
  for (const row of rows) section.appendChild(createProfileRow(row, options));
  return section;
}

function createProfileRow(row, options = {}) {
  const action = sanitizeAction(row.action);
  const tag = action?.type === "external" && action.target ? "a" : action ? "button" : "div";
  const node = document.createElement(tag);
  node.className = `codexpp-thread-summary-profiles__row is-${row.state}`;
  node.setAttribute("data-profile-row", row.id);
  if (tag === "a") {
    node.href = action.target;
    node.target = "_blank";
    node.rel = "noreferrer";
  } else if (tag === "button") {
    node.type = "button";
    node.addEventListener("click", () => options.onAction?.(action));
  }
  if (action) node.setAttribute("aria-label", `${row.label}: ${row.value}`);

  const icon = document.createElement("span");
  icon.className = `codexpp-thread-summary-profiles__icon icon-${row.id}`;
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "codexpp-thread-summary-profiles__body";
  const main = document.createElement("span");
  main.className = "codexpp-thread-summary-profiles__main";
  const label = document.createElement("span");
  label.className = "codexpp-thread-summary-profiles__label";
  label.textContent = row.label;
  const value = document.createElement("span");
  value.className = "codexpp-thread-summary-profiles__value";
  value.textContent = row.value;
  main.append(label, value);
  const meta = document.createElement("span");
  meta.className = "codexpp-thread-summary-profiles__meta";
  meta.textContent = [row.detail, row.status].filter(Boolean).join(" - ") || "Status unknown";
  body.append(main, meta);
  node.append(icon, body);
  return node;
}

function handleRendererAction(api, action) {
  const safe = sanitizeAction(action);
  if (!safe) return;
  if (safe.type === "settings") {
    try {
      if (api.codex?.openRegisteredTweakPage?.("co.thomashulihan.projects")) return;
    } catch {}
  }
  api.ipc?.invoke?.(IPC_OPEN_ACTION, safe).catch(() => {});
}

function openProfileAction(action, options = {}) {
  const safe = sanitizeAction(action);
  if (!safe) return { ok: false, reason: "unsafe-action" };
  if (safe.type === "external") return openExternal(safe.target, options);
  if (safe.type === "file") return openPath(safe.target, options);
  return { ok: true, reason: "metadata-only" };
}

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const type = String(action.type || "").trim();
  const target = String(action.target || "").trim();
  if (type === "settings" && target === "projects") return { type, target };
  if (type === "external") {
    const href = safeExternalUrl(target);
    return href ? { type, target: href } : null;
  }
  if (type === "file" && isAllowedProfileFileTarget(target)) return { type, target };
  return null;
}

function readChromeStorage(options = {}) {
  const value = readStorageFile(CHROME_TWEAK_ID, options);
  return { ...value, assignments: isPlainObject(value.assignments) ? value.assignments : {} };
}

function readProjectsStorage(options = {}) {
  const value = readStorageFile(PROJECTS_TWEAK_ID, options);
  return {
    ...value,
    googleWorkspaceAssignments: isPlainObject(value.googleWorkspaceAssignments) ? value.googleWorkspaceAssignments : {},
    modalWorkspaceAssignments: isPlainObject(value.modalWorkspaceAssignments) ? value.modalWorkspaceAssignments : {},
  };
}

function readStorageFile(tweakId, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const userRoot = options.userRoot || userRootForPlatform(home, path);
  const file = path.join(userRoot, "storage", `${tweakId}.json`);
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

function normalizeChromePreferredProfiles(assignment) {
  const path = require("node:path");
  if (!isPlainObject(assignment)) return [];
  if (Array.isArray(assignment.preferredProfiles) && assignment.preferredProfiles.length) return assignment.preferredProfiles.filter(isPlainObject);
  if (Array.isArray(assignment.preferencesPaths) && assignment.preferencesPaths.length) {
    return assignment.preferencesPaths.map((preferencesPath, index) => ({
      profileDirectory: Array.isArray(assignment.profileDirectories) ? assignment.profileDirectories[index] : path.basename(path.dirname(preferencesPath)),
      profileName: Array.isArray(assignment.profileNames) ? assignment.profileNames[index] : path.basename(path.dirname(preferencesPath)),
      preferencesPath,
    }));
  }
  return assignment.profileDirectory || assignment.preferencesPath ? [{
    profileDirectory: assignment.profileDirectory,
    profileName: assignment.profileName,
    preferencesPath: assignment.preferencesPath,
  }] : [];
}

function gitRepositoriesForProject(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(projectPathInput, { path, home, allowEmpty: true });
  if (!projectPath || projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) return [];
  const gitRoot = gitRootForProject(projectPath, { fs, path, childProcess });
  if (!gitRoot) return [];
  const output = safeExec("git", ["-C", gitRoot, "remote", "-v"], childProcess);
  const repos = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const repo = parseGithubRemote(match[2]);
    if (!repo) continue;
    const key = `${repo.owner}/${repo.name}`;
    const existing = repos.get(key) || { ...repo, remotes: new Set(), purposes: new Set() };
    existing.remotes.add(match[1]);
    existing.purposes.add(match[3]);
    repos.set(key, existing);
  }
  return [...repos.values()].map((repo) => ({
    owner: repo.owner,
    name: repo.name,
    fullName: `${repo.owner}/${repo.name}`,
    url: `https://github.com/${repo.owner}/${repo.name}`,
    remotes: [...repo.remotes].sort(),
    purposes: [...repo.purposes].sort(),
    gitRoot,
  }));
}

function gitRootForProject(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const root = safeExec("git", ["-C", projectPath, "rev-parse", "--show-toplevel"], childProcess);
  if (root) return path.resolve(root);
  let current = projectPath;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return null;
}

function parseGithubRemote(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!value || looksSecret(value) || /[?#]/.test(value)) return null;
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (ssh) return cleanGithubRepository(ssh[1], ssh[2]);
  const sshUrl = /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (sshUrl) return cleanGithubRepository(sshUrl[1], sshUrl[2]);
  const gh = /^gh:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (gh) return cleanGithubRepository(gh[1], gh[2]);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    return cleanGithubRepository(segments[0], segments[1].replace(/\.git$/i, ""));
  } catch {}
  return null;
}

function cleanGithubRepository(owner, name) {
  const cleanOwner = String(owner || "").trim();
  const cleanName = String(name || "").trim().replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(cleanOwner) || !/^[A-Za-z0-9_.-]+$/.test(cleanName)) return null;
  if (looksSecret(cleanOwner) || looksSecret(cleanName)) return null;
  return { owner: cleanOwner, name: cleanName };
}

function parseSupabaseConfigToml(content) {
  const block = findTomlTableBlock(String(content || ""), "mcp_servers.supabase");
  if (!block) return null;
  const url = tomlStringValue(block.body, "url");
  let projectRef = "";
  let features = [];
  if (url) {
    try {
      const parsed = new URL(url);
      projectRef = parsed.searchParams.get("project_ref") || "";
      features = (parsed.searchParams.get("features") || "").split(",").map((value) => value.trim()).filter(Boolean);
    } catch {}
  }
  return { projectRef, features };
}

function parseEnvAssignments(content) {
  const values = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function activeModalWorkspaceContext(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const env = { ...process.env, ...(options.env || {}) };
  const projectPath = normalizeProjectPath(projectPathInput, { path, home: options.home, allowEmpty: true });
  if (options.skipModalCli) return { profile: null, workspace: null, source: null, error: "Modal CLI skipped." };
  const candidates = modalPythonCommandCandidates(projectPath, { fs, path, env });
  let lastError = "";
  for (const candidate of candidates) {
    try {
      const stdout = childProcess.execFileSync(candidate.command, [...candidate.args, "-m", "modal", "profile", "list", "--json"], {
        cwd: projectPath && fs.existsSync(projectPath) ? projectPath : undefined,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      const rows = JSON.parse(stdout || "[]");
      const active = Array.isArray(rows) ? rows.find((row) => isPlainObject(row) && row.active === true) : null;
      return {
        profile: cleanText(active?.name || "", 120) || null,
        workspace: cleanText(active?.workspace || "", 120) || null,
        source: candidate.label,
        error: null,
      };
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }
  return { profile: null, workspace: null, source: null, error: lastError || "Modal CLI profile unavailable." };
}

function modalPythonCommandCandidates(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const env = options.env || process.env;
  const candidates = [];
  const add = (command, args = [], label = command) => {
    if (command && !candidates.some((candidate) => candidate.command === command && candidate.args.join(" ") === args.join(" "))) {
      candidates.push({ command, args, label });
    }
  };
  if (env.CODEX_PROJECTS_MODAL_PYTHON) add(env.CODEX_PROJECTS_MODAL_PYTHON, [], env.CODEX_PROJECTS_MODAL_PYTHON);
  if (projectPath) {
    for (const candidate of [path.join(projectPath, ".venv", "bin", "python"), path.join(projectPath, "TRR-Backend", ".venv", "bin", "python")]) {
      try {
        if (fs.existsSync(candidate)) add(candidate, [], candidate);
      } catch {}
    }
  }
  add("python3");
  add("python");
  return candidates;
}

function modalWorkspaceConflict(assignment, cliContext) {
  if (!assignment || !cliContext || cliContext.error) return null;
  const expectedProfile = String(assignment.profile || "").trim();
  const expectedWorkspace = String(assignment.workspace || "").trim();
  const activeProfile = String(cliContext.profile || "").trim();
  const activeWorkspace = String(cliContext.workspace || "").trim();
  if (!expectedProfile || !expectedWorkspace || !activeProfile || !activeWorkspace) return null;
  if (expectedProfile === activeProfile && expectedWorkspace === activeWorkspace) return null;
  return { expectedProfile, expectedWorkspace, activeProfile, activeWorkspace };
}

function inferRendererProjectContext(rootDocument = document, panels = null) {
  const context = { projectPath: "", projectName: "" };
  const cwdNode = rootDocument.querySelector("[data-codex-cwd], [data-project-path], [data-codexpp-project-path]");
  context.projectPath = cwdNode?.getAttribute("data-codex-cwd") || cwdNode?.getAttribute("data-project-path") || cwdNode?.getAttribute("data-codexpp-project-path") || "";
  if (!context.projectPath) {
    for (const source of [...(panels || []), rootDocument.body || rootDocument]) {
      context.projectPath = extractProjectPathFromVisibleText(visibleTextWithSeparators(source));
      if (context.projectPath) break;
    }
  }
  const nameNode = rootDocument.querySelector("[data-project-name], [data-codexpp-project-name]");
  context.projectName = nameNode?.getAttribute("data-project-name") || nameNode?.getAttribute("data-codexpp-project-name") || "";
  return context;
}

function inferProjectPath(input) {
  return input.cwd || input.path || input.workspacePath || "";
}

function resolveProjectPathInput(input = {}, options = {}) {
  const direct = input.projectPath || inferProjectPath(input);
  if (direct) return direct;
  const visiblePath = extractProjectPathFromVisibleText(input.visibleText || input.threadText || "");
  if (visiblePath) return visiblePath;
  return projectPathFromStoredProjectName(input.projectName || input.project || "", options);
}

function projectPathFromStoredProjectName(name, options = {}) {
  const wanted = cleanText(name || "", 120).toLowerCase();
  if (!wanted) return "";
  const storage = readProjectsStorage(options);
  const match = (storage.sidebarProjects || []).find((project) => cleanText(project.name || "", 120).toLowerCase() === wanted);
  return match?.projectPath || "";
}

function resolveStoredProjectPrefix(projectPath, options = {}) {
  if (!projectPath) return "";
  const normalized = projectPath.toLowerCase();
  const storage = readProjectsStorage(options);
  const projects = [...(storage.sidebarProjects || [])]
    .map((project) => project.projectPath || "")
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return projects.find((project) => normalized === project.toLowerCase() || normalized.startsWith(`${project.toLowerCase()}/`)) || "";
}

function extractProjectPathFromVisibleText(text) {
  const normalized = String(text || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  const labeled = /(?:^|\n|\b)(?:cwd|workspace|project(?: path)?)\s*[:=]?\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|((?:~?\/|[A-Za-z]:[\\/])[^\n]+))/i.exec(normalized);
  if (labeled) return cleanVisiblePathCandidate(labeled[1] || labeled[2] || labeled[3] || labeled[4] || "");
  const absolute = /((?:~?\/|[A-Za-z]:[\\/])Users\/[^\n]*?\/(?:Projects|Applications)\/[^\s,;:)]+(?:[^\n,;)]*?))/i.exec(normalized);
  return absolute ? cleanVisiblePathCandidate(absolute[1]) : "";
}

function cleanVisiblePathCandidate(value) {
  let text = String(value || "")
    .replace(/\s+(?:environment|sources|progress|subagents|changes|local|main|commit|create pull request)\b.*$/i, "")
    .replace(/[),.;\]]+$/g, "")
    .trim();
  text = text.replace(/\/\.{3}.*$/, "");
  if (!/^(?:~?\/|[A-Za-z]:[\\/])/.test(text) || looksSecret(text)) return "";
  return text;
}

function visibleTextWithSeparators(node) {
  if (!node) return "";
  const children = Array.from(node.childNodes || []);
  if (!children.length) return node.textContent || "";
  return children.map(visibleTextWithSeparators).filter(Boolean).join("\n");
}

function inferSingleConfiguredProjectPath(options = {}) {
  const projects = new Set();
  for (const key of Object.keys(readChromeStorage(options).assignments || {})) {
    if (key) projects.add(key);
  }
  const projectStorage = readProjectsStorage(options);
  for (const group of [
    projectStorage.googleWorkspaceAssignments,
    projectStorage.modalWorkspaceAssignments,
  ]) {
    for (const key of Object.keys(group || {})) {
      if (key) projects.add(key);
    }
  }
  return projects.size === 1 ? [...projects][0] : "";
}

function normalizeProjectPath(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  if (typeof input !== "string" || input.trim() === "") {
    if (options.allowEmpty) return "";
    throw new Error("Project path is required.");
  }
  if (input.startsWith("codex-sidebar://")) return input;
  return path.resolve(input.replace(/^~(?=$|\/|\\)/, home));
}

function userRootForPlatform(home, path = require("node:path")) {
  if (process.env.CODEX_PLUSPLUS_USER_ROOT) return path.resolve(process.env.CODEX_PLUSPLUS_USER_ROOT);
  if (process.env.CODEX_PLUSPLUS_HOME) return path.resolve(process.env.CODEX_PLUSPLUS_HOME);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "codex-plusplus");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codex-plusplus");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "codex-plusplus");
}

function findTomlTableBlock(content, tableName) {
  const header = `[${tableName}]`;
  const start = content.indexOf(header);
  if (start < 0) return null;
  const rest = content.slice(start + header.length);
  const nextMatch = /\n\[[^\]]+\]/.exec(rest);
  const end = nextMatch ? start + header.length + nextMatch.index + 1 : content.length;
  return { start, end, body: content.slice(start + header.length, end) };
}

function tomlStringValue(blockBody, key) {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*$`, "m").exec(blockBody);
  if (!match) return "";
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function safeExec(command, args, childProcess) {
  try {
    return childProcess.execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function openExternal(target, options = {}) {
  try {
    const electron = require("electron");
    if (electron.shell?.openExternal) {
      electron.shell.openExternal(target);
      return { ok: true };
    }
  } catch {}
  return openWithPlatform(target, options);
}

function openPath(target, options = {}) {
  try {
    const electron = require("electron");
    if (electron.shell?.openPath) {
      electron.shell.openPath(target);
      return { ok: true };
    }
  } catch {}
  return openWithPlatform(target, options);
}

function openWithPlatform(target, options = {}) {
  const childProcess = options.childProcess || require("node:child_process");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    childProcess.spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

function installStyles() {
  if (typeof document === "undefined" || document.getElementById("codexpp-thread-summary-profiles-style")) return;
  const style = document.createElement("style");
  style.id = "codexpp-thread-summary-profiles-style";
  style.textContent = `
    [${SECTION_ATTR}="true"] { box-sizing: border-box; width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 14px 28px 16px; border-top: 1px solid var(--border-light, rgba(127,127,127,.18)); }
    .codexpp-thread-summary-profiles__title { font-size: 12px; line-height: 16px; font-weight: 650; color: var(--text-primary, currentColor); padding: 0; }
    .codexpp-thread-summary-profiles__row { box-sizing: border-box; width: 100%; min-width: 0; min-height: 30px; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; align-items: start; border: 0; background: transparent; color: inherit; text-align: left; text-decoration: none; padding: 3px 0; border-radius: 6px; font: inherit; }
    button.codexpp-thread-summary-profiles__row, a.codexpp-thread-summary-profiles__row { cursor: pointer; }
    button.codexpp-thread-summary-profiles__row:hover, a.codexpp-thread-summary-profiles__row:hover, button.codexpp-thread-summary-profiles__row:focus-visible, a.codexpp-thread-summary-profiles__row:focus-visible { background: var(--background-modifier-hover, rgba(127,127,127,.12)); outline: none; }
    .codexpp-thread-summary-profiles__icon { position: relative; width: 14px; height: 14px; margin-top: 2px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; opacity: .9; overflow: hidden; flex: 0 0 auto; }
    .codexpp-thread-summary-profiles__icon::before, .codexpp-thread-summary-profiles__icon::after { content: ""; position: absolute; box-sizing: border-box; }
    .codexpp-thread-summary-profiles__icon.icon-chrome { border-radius: 50%; background: conic-gradient(#e11d48 0 33%, #f59e0b 0 66%, #16a34a 0); }
    .codexpp-thread-summary-profiles__icon.icon-chrome::after { inset: 4px; border-radius: 50%; background: #2563eb; box-shadow: 0 0 0 2px var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__icon.icon-supabase { background: #16a34a; clip-path: polygon(18% 8%, 82% 50%, 18% 92%); }
    .codexpp-thread-summary-profiles__icon.icon-github { border-radius: 50%; background: currentColor; }
    .codexpp-thread-summary-profiles__icon.icon-github::after { width: 8px; height: 4px; left: 3px; bottom: -1px; border-radius: 4px 4px 0 0; background: var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__icon.icon-google-drive { background: conic-gradient(from 30deg, #16a34a 0 33%, #f59e0b 0 66%, #2563eb 0); clip-path: polygon(50% 0, 100% 86%, 0 86%); }
    .codexpp-thread-summary-profiles__icon.icon-gmail { border-radius: 3px; border: 2px solid #dc2626; border-top-color: #f59e0b; background: transparent; }
    .codexpp-thread-summary-profiles__icon.icon-modal { border-radius: 3px; background: currentColor; }
    .codexpp-thread-summary-profiles__icon.icon-modal::after { inset: 3px; border-left: 2px solid var(--background-primary, #fff); border-right: 2px solid var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__body { min-width: 0; display: flex; flex-direction: column; gap: 0; }
    .codexpp-thread-summary-profiles__main { min-width: 0; display: grid; grid-template-columns: minmax(58px, .42fr) minmax(0, 1fr); align-items: baseline; gap: 10px; }
    .codexpp-thread-summary-profiles__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--text-secondary, #6b7280); }
    .codexpp-thread-summary-profiles__value { min-width: 0; max-width: 100%; justify-self: end; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--text-primary, currentColor); }
    .codexpp-thread-summary-profiles__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 15px; color: var(--text-secondary, #6b7280); }
    .codexpp-thread-summary-profiles__empty[hidden] { display: none !important; }
    .codexpp-thread-summary-profiles__row.is-warning .codexpp-thread-summary-profiles__meta { color: #b45309; }
    .codexpp-thread-summary-profiles__row.is-error .codexpp-thread-summary-profiles__meta { color: #b91c1c; }
    @media (max-width: 420px) {
      [${SECTION_ATTR}="true"] { padding-left: 22px; padding-right: 22px; }
      .codexpp-thread-summary-profiles__main { grid-template-columns: minmax(48px, .38fr) minmax(0, 1fr); gap: 8px; }
    }
  `;
  document.head?.appendChild(style);
}

function settingsAction(target) {
  return { type: "settings", target };
}

function fileAction(target) {
  return { type: "file", target };
}

function externalAction(target) {
  return { type: "external", target };
}

function safeExternalUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : "";
  } catch {
    return "";
  }
}

function looksSecret(value) {
  return /(token|cookie|secret|bearer|oauth|password|passwd|credential)/i.test(String(value || ""));
}

function isAllowedProfileFileTarget(target) {
  if (!target || looksSecret(target)) return false;
  const normalized = String(target).replace(/\\/g, "/");
  return normalized === ".codex/config.toml" || normalized.endsWith("/.codex/config.toml");
}

function freshness(prefix, updatedAt) {
  return updatedAt ? `${prefix} ${shortDate(updatedAt)}` : prefix || "Status unknown";
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function cleanText(value, limit) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}...` : text;
}

function normalizeVisibleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isElement(node) {
  return node && typeof node === "object" && node.nodeType === 1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
