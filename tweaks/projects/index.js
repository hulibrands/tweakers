/* ShadGPT Projects
 *
 * Coordinates project-local connection assignments without replacing the
 * existing Chrome Profile tweak. Chrome writes intentionally target that
 * tweak's storage file so its MCP helper keeps resolving the same schema.
 */

const TWEAK_ID = "co.thomashulihan.projects";
const CHROME_TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const UI_IMPROVEMENTS_TWEAK_ID = "co.thomashulihan.ui-improvements";
const SUPABASE_PROFILES_KEY = "supabaseProfiles";
const GOOGLE_WORKSPACE_ACCOUNTS_KEY = "googleWorkspaceAccounts";
const GOOGLE_WORKSPACE_ASSIGNMENTS_KEY = "googleWorkspaceAssignments";
const MODAL_WORKSPACE_ACCOUNTS_KEY = "modalWorkspaceAccounts";
const MODAL_WORKSPACE_ASSIGNMENTS_KEY = "modalWorkspaceAssignments";
const DECODO_ACCOUNTS_KEY = "decodoAccounts";
const DECODO_ASSIGNMENTS_KEY = "decodoAssignments";
const SIDEBAR_PROJECTS_KEY = "sidebarProjects";
const SIDEBAR_PROJECT_ORDER_KEY = "sidebarProjectOrder";
const PROJECT_ENV_SCAN_TIMEOUT_KEY = "projectEnvScanTimeoutMs";
const CHROME_VERIFIER_RESULTS_KEY = "chromeVerifierResults";
const CHROME_VERIFIER_HISTORY_KEY = "chromeVerifierHistory";
const MAX_CHROME_VERIFIER_HISTORY = 20;
const PROJECT_COLOR_STORAGE_KEY = "sidebar-project-backgrounds:colors";
const PROJECT_OVERLAY_STORAGE_KEY = "sidebar-project-backgrounds:overlays";
const PROJECT_COLOR_EVENT = "codexpp-ui-improvements-project-color-changed";
const SIDEBAR_REORDER_ATTR = "data-codexpp-projects-sidebar-reorder";
const SIDEBAR_REORDER_STYLE_ID = "codexpp-projects-sidebar-reorder-style";
const CLOUD_PROJECT_PREFIX = "cloud:";
const EXCLUDED_SIDEBAR_PROJECT_NAMES = new Set(["trr-app", "screenalytics"]);
const EXACT_ENV_FILE_NAMES = new Set([".env", ".envrc"]);
const EXCLUDED_ENV_FILE_SUFFIXES = [".bak", ".backup", ".old", ".orig", ".tmp", ".swp"];
const EXCLUDED_ENV_DIRS = new Set([".git", ".worktrees", "node_modules", ".next", "dist", "build", "coverage", ".turbo", "archive", "archives", "backup", "backups"]);
const MAX_ENV_SCAN_DEPTH = 6;
const DEFAULT_PROJECT_ENV_SCAN_TIMEOUT_MS = 8000;
const MIN_PROJECT_ENV_SCAN_TIMEOUT_MS = 1000;
const MAX_PROJECT_ENV_SCAN_TIMEOUT_MS = 60000;
const PROJECT_COLOR_OPTIONS = Object.freeze([
  { id: "auto", label: "Auto", value: "#71717a" },
  { id: "neutral", label: "Neutral", value: "#404040" },
  { id: "stone", label: "Stone", value: "#44403c" },
  { id: "zinc", label: "Zinc", value: "#3f3f46" },
  { id: "slate", label: "Slate", value: "#334155" },
  { id: "gray", label: "Gray", value: "#374151" },
  { id: "mauve", label: "Mauve", value: "#524959" },
  { id: "olive", label: "Olive", value: "#435147" },
  { id: "mist", label: "Mist", value: "#3d5155" },
  { id: "taupe", label: "Taupe", value: "#554b3e" },
  { id: "red", label: "Red", value: "#b91c1c" },
  { id: "orange", label: "Orange", value: "#c2410c" },
  { id: "amber", label: "Amber", value: "#b45309" },
  { id: "yellow", label: "Yellow", value: "#a16207" },
  { id: "lime", label: "Lime", value: "#4d7c0f" },
  { id: "green", label: "Green", value: "#15803d" },
  { id: "emerald", label: "Emerald", value: "#047857" },
  { id: "teal", label: "Teal", value: "#0f766e" },
  { id: "cyan", label: "Cyan", value: "#0e7490" },
  { id: "sky", label: "Sky", value: "#0369a1" },
  { id: "blue", label: "Blue", value: "#1d4ed8" },
  { id: "indigo", label: "Indigo", value: "#4338ca" },
  { id: "violet", label: "Violet", value: "#6d28d9" },
  { id: "purple", label: "Purple", value: "#7e22ce" },
  { id: "fuchsia", label: "Fuchsia", value: "#a21caf" },
  { id: "pink", label: "Pink", value: "#be185d" },
  { id: "rose", label: "Rose", value: "#be123c" },
]);
const PROJECT_OVERLAY_OPTIONS = Object.freeze([
  { id: "off", label: "Off" },
  { id: "subtle", label: "Subtle" },
  { id: "medium", label: "Medium" },
  { id: "strong", label: "Strong" },
]);
const DEFAULT_PROJECT_OVERLAY_INTENSITY = "medium";
const DEFAULT_MODAL_WORKSPACE_ACCOUNT = Object.freeze({
  id: "modal-admin-56995",
  name: "TRR Modal",
  profile: "admin-56995",
  workspace: "admin-56995",
  source: "default",
});
const agentsWriter = loadAgentsWriter() || {};
const chromeRouting = loadChromeRouting();

let activeCleanup = [];
let rendererProjectEnvScanTimeoutMs = DEFAULT_PROJECT_ENV_SCAN_TIMEOUT_MS;

module.exports = {
  start(api) {
    activeCleanup = [];
    if (api.process === "main") {
      try {
        startMain(api, activeCleanup);
      } catch (error) {
        api.log?.error?.("[projects] main startup failed", error?.stack || error?.message || String(error));
        throw error;
      }
    }
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
    categoryForEnvKey,
    parseDotenv,
    redactValue,
    parseSupabaseConfigToml,
    upsertSupabaseConfigToml,
    projectCandidates,
    saveChromeAssignmentToStorage,
    clearChromeAssignmentFromStorage,
    googleWorkspaceAccountsForProject,
    googleWorkspaceConnectorAccountsFromMetadata,
    saveGoogleWorkspaceAccountToStorage,
    saveGoogleWorkspaceAssignmentToStorage,
    clearGoogleWorkspaceAssignmentFromStorage,
    modalWorkspaceAccountsForProject,
    saveModalWorkspaceAccountToStorage,
    saveModalWorkspaceAssignmentToStorage,
    clearModalWorkspaceAssignmentFromStorage,
    decodoAccountsForProject,
    saveDecodoAccountToStorage,
    saveDecodoAssignmentToStorage,
    clearDecodoAssignmentFromStorage,
    activeModalWorkspaceContext,
    modalWorkspaceConflict,
    gitRepositoriesForProject,
    gitIdentityForProject,
    listChromeProfilesFromDisk,
    scanEnvInventory,
    normalizeProjectEnvScanTimeout,
    resolveProjectEnvFile,
    revealEnvValueFromDisk,
    updateEnvValueOnDisk,
    normalizeProjectColorKey,
    normalizeSidebarProjectOrder,
    sidebarProjectOrderKey,
    sortProjectsBySavedOrder,
    applySidebarProjectOrder,
    moveSidebarProjectBlock,
    sidebarProjectBlockNodes,
    sidebarProjectDomKey,
    readProjectColorStorage,
    readProjectOverlayStorage,
    saveProjectColorToStorage,
    saveProjectOverlayToStorage,
    readChromeVerifierResult,
    readChromeVerifierHistory,
    saveChromeVerifierResult,
    buildProjectConnectionInstructionBlock: agentsWriter.buildProjectConnectionInstructionBlock,
    isProjectAgentsInstructionWriteDisabled: agentsWriter.isProjectAgentsInstructionWriteDisabled,
    previewProjectConnectionInstructions: agentsWriter.previewProjectConnectionInstructions,
    projectAgentsInstructionPluginWriteDisabled: agentsWriter.projectAgentsInstructionPluginWriteDisabled,
    projectConnectionInstructionSummary: agentsWriter.projectConnectionInstructionSummary,
    setProjectAgentsInstructionWriteDisabled: agentsWriter.setProjectAgentsInstructionWriteDisabled,
    setProjectAgentsInstructionPluginWriteDisabled: agentsWriter.setProjectAgentsInstructionPluginWriteDisabled,
    syncProjectConnectionInstructions: agentsWriter.syncProjectConnectionInstructions,
    writeProjectConnectionInstructions: agentsWriter.writeProjectConnectionInstructions,
    storageFileFor,
    readStorageFile,
  },
};

function startMain(api, cleanup) {
  const handlers = createMainHandlers(api);
  cleanup.push(api.ipc.handle("listProjects", () => handlers.listProjects()));
  cleanup.push(api.ipc.handle("cacheSidebarProjects", (projects) => handlers.cacheSidebarProjects(projects)));
  cleanup.push(api.ipc.handle("getSidebarProjectOrder", () => handlers.getSidebarProjectOrder()));
  cleanup.push(api.ipc.handle("saveSidebarProjectOrder", (order) => handlers.saveSidebarProjectOrder(order)));
  cleanup.push(api.ipc.handle("getProjectEnvScanTimeout", () => handlers.getProjectEnvScanTimeout()));
  cleanup.push(api.ipc.handle("saveProjectEnvScanTimeout", (timeoutMs) => handlers.saveProjectEnvScanTimeout(timeoutMs)));
  cleanup.push(api.ipc.handle("getProjectOverview", (projectPath) => handlers.getProjectOverview(projectPath)));
  cleanup.push(api.ipc.handle("setAgentsInstructionWritePreference", (input) => handlers.setAgentsInstructionWritePreference(input)));
  cleanup.push(api.ipc.handle("setAgentsInstructionPluginWritePreference", (input) => handlers.setAgentsInstructionPluginWritePreference(input)));
  cleanup.push(api.ipc.handle("previewProjectAgentsInstruction", (input) => handlers.previewProjectAgentsInstruction(input)));
  cleanup.push(api.ipc.handle("repairProjectAgentsInstruction", (input) => handlers.repairProjectAgentsInstruction(input)));
  cleanup.push(api.ipc.handle("runChromeRoutingVerifier", (input) => handlers.runChromeRoutingVerifier(input)));
  cleanup.push(api.ipc.handle("repairChromeSharedLocks", (input) => handlers.repairChromeSharedLocks(input)));
  cleanup.push(api.ipc.handle("getProjectEnvInventory", (projectPath) => handlers.getProjectEnvInventory(projectPath)));
  cleanup.push(api.ipc.handle("listChromeProfiles", () => handlers.listChromeProfiles()));
  cleanup.push(api.ipc.handle("saveChromeAssignment", (input) => handlers.saveChromeAssignment(input)));
  cleanup.push(api.ipc.handle("clearChromeAssignment", (projectPath) => handlers.clearChromeAssignment(projectPath)));
  cleanup.push(api.ipc.handle("listGoogleWorkspaceAccounts", () => handlers.listGoogleWorkspaceAccounts()));
  cleanup.push(api.ipc.handle("saveGoogleWorkspaceAccount", (input) => handlers.saveGoogleWorkspaceAccount(input)));
  cleanup.push(api.ipc.handle("saveGoogleWorkspaceAssignment", (input) => handlers.saveGoogleWorkspaceAssignment(input)));
  cleanup.push(api.ipc.handle("clearGoogleWorkspaceAssignment", (input) => handlers.clearGoogleWorkspaceAssignment(input)));
  cleanup.push(api.ipc.handle("listModalWorkspaceAccounts", () => handlers.listModalWorkspaceAccounts()));
  cleanup.push(api.ipc.handle("saveModalWorkspaceAccount", (input) => handlers.saveModalWorkspaceAccount(input)));
  cleanup.push(api.ipc.handle("saveModalWorkspaceAssignment", (input) => handlers.saveModalWorkspaceAssignment(input)));
  cleanup.push(api.ipc.handle("clearModalWorkspaceAssignment", (input) => handlers.clearModalWorkspaceAssignment(input)));
  cleanup.push(api.ipc.handle("listDecodoAccounts", () => handlers.listDecodoAccounts()));
  cleanup.push(api.ipc.handle("saveDecodoAccount", (input) => handlers.saveDecodoAccount(input)));
  cleanup.push(api.ipc.handle("saveDecodoAssignment", (input) => handlers.saveDecodoAssignment(input)));
  cleanup.push(api.ipc.handle("clearDecodoAssignment", (input) => handlers.clearDecodoAssignment(input)));
  cleanup.push(api.ipc.handle("listSupabaseProfiles", () => handlers.listSupabaseProfiles()));
  cleanup.push(api.ipc.handle("saveSupabaseProfile", (input) => handlers.saveSupabaseProfile(input)));
  cleanup.push(api.ipc.handle("applySupabaseProfile", (input) => handlers.applySupabaseProfile(input)));
  cleanup.push(api.ipc.handle("revealEnvValue", (input) => handlers.revealEnvValue(input)));
  cleanup.push(api.ipc.handle("updateEnvValue", (input) => handlers.updateEnvValue(input)));
  cleanup.push(api.ipc.handle("saveProjectColor", (input) => handlers.saveProjectColor(input)));
  cleanup.push(api.ipc.handle("saveProjectOverlay", (input) => handlers.saveProjectOverlay(input)));
}

function createMainHandlers(api) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const childProcess = require("node:child_process");

  const home = os.homedir();
  const userRoot = userRootForPlatform(home);

  const listProjects = () => projectCandidates({
    home,
    fs,
    path,
    sidebarProjects: readSidebarProjects(api),
    projectOrder: readSidebarProjectOrder(api),
  });

  const cacheSidebarProjects = (projects) => {
    const normalized = normalizeSidebarProjects(projects);
    api.storage.set(SIDEBAR_PROJECTS_KEY, normalized);
    return normalized;
  };

  const getSidebarProjectOrder = () => readSidebarProjectOrder(api);

  const saveSidebarProjectOrder = (order) => {
    const normalized = normalizeSidebarProjectOrder(order);
    api.storage.set(SIDEBAR_PROJECT_ORDER_KEY, normalized);
    api.storage.set("updatedAt", new Date().toISOString());
    return normalized;
  };

  const getProjectEnvScanTimeout = () => normalizeProjectEnvScanTimeout(
    api.storage.get(PROJECT_ENV_SCAN_TIMEOUT_KEY, DEFAULT_PROJECT_ENV_SCAN_TIMEOUT_MS),
  );

  const saveProjectEnvScanTimeout = (timeoutMs) => {
    const normalized = normalizeProjectEnvScanTimeout(timeoutMs);
    api.storage.set(PROJECT_ENV_SCAN_TIMEOUT_KEY, normalized);
    api.storage.set("updatedAt", new Date().toISOString());
    return normalized;
  };

  const listChromeProfiles = () => listChromeProfilesFromDisk({ fs, os, path });

  const listGoogleWorkspaceAccounts = () => googleWorkspaceAccountsForProject("", {
    userRoot,
    fs,
    os,
    path,
    chromeProfiles: listChromeProfiles(),
  });

  const listModalWorkspaceAccounts = () => modalWorkspaceAccountsForProject("", { userRoot });
  const listDecodoAccounts = () => decodoAccountsForProject("", { userRoot });

  const listSupabaseProfiles = () => {
    const value = api.storage.get(SUPABASE_PROFILES_KEY, []);
    return Array.isArray(value) ? value.filter(isSupabaseProfile) : [];
  };

  const saveSupabaseProfile = (input) => {
    const next = normalizeSupabaseProfile(input);
    const profiles = listSupabaseProfiles();
    const index = profiles.findIndex((profile) => profile.id === next.id);
    if (index >= 0) profiles[index] = next;
    else profiles.push(next);
    api.storage.set(SUPABASE_PROFILES_KEY, profiles);
    api.storage.set("updatedAt", new Date().toISOString());
    return next;
  };

  const applySupabaseProfile = (input) => {
    const projectPath = normalizeProjectPath(input?.projectPath, { home, path });
    assertLocalProjectPath(projectPath, { fs, path });
    const profile = input?.profile || listSupabaseProfiles().find((candidate) => candidate.id === String(input?.profileId || ""));
    const normalized = normalizeSupabaseProfile(profile);
    const codexDir = path.join(projectPath, ".codex");
    const configPath = path.join(codexDir, "config.toml");
    fs.mkdirSync(codexDir, { recursive: true });
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const next = upsertSupabaseConfigToml(current, normalized);
    fs.writeFileSync(configPath, next, "utf8");
    return { configPath, binding: parseSupabaseConfigToml(next) };
  };

  const syncAgentsInstruction = (input) => agentsWriter.syncProjectConnectionInstructions(input, { userRoot, fs, path, home });

  const withAgentsInstruction = (payload, input) => ({
    ...payload,
    agentsInstruction: syncAgentsInstruction(input),
  });

  const setAgentsInstructionWritePreference = (input) => {
    const preference = agentsWriter.setProjectAgentsInstructionWriteDisabled(input, { userRoot, fs, path, home });
    return {
      ...preference,
      agentsInstruction: preference.disabled
        ? {
            instructionFile: path.join(preference.projectPath, "AGENTS.md"),
            changed: false,
            skipped: true,
            reason: "disabled",
            connectionCount: 0,
          }
        : syncAgentsInstruction(input),
    };
  };

  const setAgentsInstructionPluginWritePreference = (input) => {
    const preference = agentsWriter.setProjectAgentsInstructionPluginWriteDisabled(input, { userRoot, fs, path, home });
    return {
      ...preference,
      preview: agentsWriter.previewProjectConnectionInstructions(input, { userRoot, fs, path, home }),
      agentsInstruction: syncAgentsInstruction(input),
    };
  };

  const previewProjectAgentsInstruction = (input) => agentsWriter.previewProjectConnectionInstructions(input, { userRoot, fs, path, home });

  const runChromeRoutingVerifier = (input = {}) => {
    if (!chromeRouting?.verifyBundledChromeRouting) {
      return {
        summary: "Chrome routing verifier unavailable.",
        fixes: [{ section: "verifier", status: "problem", action: "Reinstall the Project Chrome Profiles tweak so chrome-routing.js is available." }],
        sections: { profile: false, extension: false, backend: false, locks: false },
      };
    }
    const projectPath = input?.projectPath ? normalizeProjectPath(input.projectPath, { home, path }) : "";
    const result = chromeRouting.verifyBundledChromeRouting({
      userRoot,
      home,
      projectPath,
    });
    return projectPath ? saveChromeVerifierResult(projectPath, result, { userRoot }) : result;
  };

  const repairChromeSharedLocks = (input = {}) => {
    const repair = chromeRouting?.repairStaleChromeLocks
      ? chromeRouting.repairStaleChromeLocks({ home })
      : { removed: [], staleSharedLockDirs: [] };
    const verifier = runChromeRoutingVerifier(input);
    return { repair, verifier };
  };

  const repairProjectAgentsInstruction = (input) => ({
    agentsInstruction: syncAgentsInstruction(input),
    preview: agentsWriter.previewProjectConnectionInstructions(input, { userRoot, fs, path, home }),
    chromeVerifier: runChromeRoutingVerifier(input),
  });

  const getProjectOverview = (projectPathInput) => {
    const projectName = typeof projectPathInput?.name === "string" ? projectPathInput.name : "";
    const rawProjectPath = typeof projectPathInput?.projectPath === "string" ? projectPathInput.projectPath : projectPathInput;
    const projectPath = normalizeProjectPath(rawProjectPath, { home, path });
    const chromeStorage = readChromeStorage(userRoot);
    const chromeAssignment = chromeStorage.assignments[projectPath] || null;
    const googleWorkspaceStorage = readGoogleWorkspaceStorage(userRoot);
    const modalWorkspaceStorage = readModalWorkspaceStorage(userRoot);
    const decodoStorage = readDecodoStorage(userRoot);
    const modalWorkspaceAssignment = modalWorkspaceStorage.assignments[projectPath] || null;
    const modalWorkspaceCliContext = activeModalWorkspaceContext(projectPath, { fs, path, childProcess, env: process.env });
    const gitRepositories = gitRepositoriesForProject(projectPath, { fs, path, childProcess, home });
    const gitIdentity = gitIdentityForProject(projectPath, { fs, path, childProcess, home });
    const projectColorStorage = readProjectColorStorage(userRoot);
    const projectOverlayStorage = readProjectOverlayStorage(userRoot);
    const projectColorKey = normalizeProjectColorKey(projectName || projectLabel(projectPath, path));
    const supabaseBinding = readSupabaseBinding(projectPath, { fs, path });
    return {
      projectPath,
      chromeAssignment,
      chromeRouting: chromeRoutingSummary(projectPath, chromeStorage, { userRoot, home, path }),
      chromeVerifierLastResult: readChromeVerifierResult(projectPath, { userRoot }),
      chromeVerifierHistory: readChromeVerifierHistory(projectPath, { userRoot }),
      gitRepositories,
      gitIdentity,
      googleWorkspaceAssignments: googleWorkspaceStorage.assignments[projectPath] || {},
      modalWorkspaceAssignment,
      modalWorkspaceAccounts: listModalWorkspaceAccounts(),
      decodoAssignment: decodoStorage.assignments[projectPath] || null,
      decodoAccounts: listDecodoAccounts(),
      modalWorkspaceCliContext,
      modalWorkspaceConflict: modalWorkspaceConflict(modalWorkspaceAssignment, modalWorkspaceCliContext),
      supabaseBinding,
      supabaseProfiles: listSupabaseProfiles(),
      agentsInstructionWritesDisabled: agentsWriter.isProjectAgentsInstructionWriteDisabled(projectPath, { userRoot, fs, path, home }),
      agentsInstructionPluginWriteDisabled: agentsWriter.projectAgentsInstructionPluginWriteDisabled(projectPath, { userRoot, fs, path, home }),
      agentsInstructionPreview: agentsWriter.previewProjectConnectionInstructions({ projectPath, projectName }, { userRoot, fs, path, home }),
      projectColor: projectColorStorage[projectColorKey] || "auto",
      projectOverlayIntensity: projectOverlayStorage[projectColorKey] || DEFAULT_PROJECT_OVERLAY_INTENSITY,
      projectColorKey,
    };
  };

  const getProjectEnvInventory = (projectPathInput) => {
    const rawProjectPath = typeof projectPathInput?.projectPath === "string" ? projectPathInput.projectPath : projectPathInput;
    const projectPath = normalizeProjectPath(rawProjectPath, { home, path });
    return scanEnvInventory(projectPath, { fs, path });
  };

  return {
    listProjects,
    cacheSidebarProjects,
    getSidebarProjectOrder,
    saveSidebarProjectOrder,
    setAgentsInstructionWritePreference,
    setAgentsInstructionPluginWritePreference,
    previewProjectAgentsInstruction,
    repairProjectAgentsInstruction,
    runChromeRoutingVerifier,
    repairChromeSharedLocks,
    getProjectEnvScanTimeout,
    saveProjectEnvScanTimeout,
    getProjectOverview,
    getProjectEnvInventory,
    listChromeProfiles,
    saveChromeAssignment: (input) => {
      const assignment = saveChromeAssignmentToStorage(input, { userRoot, profiles: listChromeProfiles(), home, path, fs });
      return withAgentsInstruction({ assignment }, { projectPath: assignment.projectPath, projectName: input?.projectName || input?.name });
    },
    clearChromeAssignment: (projectPathInput) => {
      const projectPath = normalizeProjectPath(projectPathInput?.projectPath || projectPathInput, { home, path });
      clearChromeAssignmentFromStorage(projectPath, { userRoot, home, path });
      return withAgentsInstruction({ cleared: true }, { projectPath, projectName: projectPathInput?.projectName || projectPathInput?.name });
    },
    listGoogleWorkspaceAccounts,
    listModalWorkspaceAccounts,
    listDecodoAccounts,
    saveGoogleWorkspaceAccount: (input) => saveGoogleWorkspaceAccountToStorage(input, { userRoot }),
    saveGoogleWorkspaceAssignment: (input) => {
      let account = readGoogleWorkspaceStorage(userRoot).accounts.find((candidate) => candidate.id === String(input?.accountId || ""));
      if (!account) {
        account = listGoogleWorkspaceAccounts().find((candidate) => candidate.id === String(input?.accountId || ""));
        if (account) saveGoogleWorkspaceAccountToStorage(account, { userRoot });
      }
      if (!account) throw new Error("Select a Google account first.");
      const assignment = saveGoogleWorkspaceAssignmentToStorage(input, { userRoot, home, path });
      return withAgentsInstruction({ assignment }, { projectPath: assignment.projectPath, projectName: input?.projectName || input?.name });
    },
    clearGoogleWorkspaceAssignment: (input) => {
      const projectPath = normalizeProjectPath(input?.projectPath || input, { home, path });
      clearGoogleWorkspaceAssignmentFromStorage(input, { userRoot, home, path });
      return withAgentsInstruction({ cleared: true }, { projectPath, projectName: input?.projectName || input?.name });
    },
    saveModalWorkspaceAccount: (input) => saveModalWorkspaceAccountToStorage(input, { userRoot }),
    saveModalWorkspaceAssignment: (input) => {
      let account = readModalWorkspaceStorage(userRoot).accounts.find((candidate) => candidate.id === String(input?.accountId || ""));
      if (!account) {
        account = listModalWorkspaceAccounts().find((candidate) => candidate.id === String(input?.accountId || ""));
        if (account) saveModalWorkspaceAccountToStorage(account, { userRoot });
      }
      if (!account) throw new Error("Select a Modal workspace first.");
      const assignment = saveModalWorkspaceAssignmentToStorage(input, { userRoot, home, path });
      return withAgentsInstruction({ assignment }, { projectPath: assignment.projectPath, projectName: input?.projectName || input?.name });
    },
    clearModalWorkspaceAssignment: (input) => {
      const projectPath = normalizeProjectPath(input?.projectPath || input, { home, path });
      clearModalWorkspaceAssignmentFromStorage(input, { userRoot, home, path });
      return withAgentsInstruction({ cleared: true }, { projectPath, projectName: input?.projectName || input?.name });
    },
    saveDecodoAccount: (input) => saveDecodoAccountToStorage(input, { userRoot }),
    saveDecodoAssignment: (input) => {
      let account = readDecodoStorage(userRoot).accounts.find((candidate) => candidate.id === String(input?.accountId || ""));
      if (!account) {
        account = listDecodoAccounts().find((candidate) => candidate.id === String(input?.accountId || ""));
        if (account) saveDecodoAccountToStorage(account, { userRoot });
      }
      if (!account) throw new Error("Select a Decodo account first.");
      const assignment = saveDecodoAssignmentToStorage(input, { userRoot, home, path });
      return withAgentsInstruction({ assignment }, { projectPath: assignment.projectPath, projectName: input?.projectName || input?.name });
    },
    clearDecodoAssignment: (input) => {
      const projectPath = normalizeProjectPath(input?.projectPath || input, { home, path });
      clearDecodoAssignmentFromStorage(input, { userRoot, home, path });
      return withAgentsInstruction({ cleared: true }, { projectPath, projectName: input?.projectName || input?.name });
    },
    listSupabaseProfiles,
    saveSupabaseProfile,
    applySupabaseProfile: (input) => withAgentsInstruction(applySupabaseProfile(input), {
      projectPath: input?.projectPath,
      projectName: input?.projectName || input?.name,
    }),
    revealEnvValue: (input) => revealEnvValueFromDisk(input, { fs, path, home }),
    updateEnvValue: (input) => updateEnvValueOnDisk(input, { fs, path, home }),
    saveProjectColor: (input) => saveProjectColorToStorage(input, { userRoot }),
    saveProjectOverlay: (input) => saveProjectOverlayToStorage(input, { userRoot }),
  };
}

function userRootForPlatform(home) {
  const path = require("node:path");
  if (process.env.CODEX_PLUSPLUS_USER_ROOT) return path.resolve(process.env.CODEX_PLUSPLUS_USER_ROOT);
  if (process.env.CODEX_PLUSPLUS_HOME) return path.resolve(process.env.CODEX_PLUSPLUS_HOME);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "codex-plusplus");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codex-plusplus");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "codex-plusplus");
}

function loadAgentsWriter() {
  if (typeof require !== "function") return null;
  return require("./agents-writer");
}

function loadChromeRouting() {
  if (typeof require !== "function") return null;
  for (const candidate of [
    "../co.thomashulihan.project-chrome-profile/chrome-routing",
    "../thomashulihan-project-chrome-profile/chrome-routing",
  ]) {
    try {
      return require(candidate);
    } catch {}
  }
  return null;
}

function chromeRoutingSummary(projectPath, chromeStorage, options = {}) {
  if (chromeRouting?.resolveChromeRouting) {
    try {
      return chromeRouting.resolveChromeRouting(projectPath, options);
    } catch {}
  }
  const match = chromeStorage.assignments?.[projectPath] || null;
  const fallback = match ? null : chromeStorage.defaultProfile || null;
  const assignment = match || fallback;
  const preferredProfiles = normalizeChromePreferredProfiles(assignment);
  const primary = preferredProfiles[0] || null;
  return {
    projectPath,
    matched: Boolean(match),
    source: match ? "project" : fallback ? "default" : "none",
    assignment: match,
    defaultProfile: fallback,
    preferredProfiles,
    profileDirectory: primary?.profileDirectory || assignment?.profileDirectory || "",
    profileName: primary?.profileName || assignment?.profileName || "",
    preferencesPath: primary?.preferencesPath || assignment?.preferencesPath || "",
  };
}

function normalizeChromePreferredProfiles(assignment) {
  const path = require("node:path");
  if (!assignment || typeof assignment !== "object") return [];
  if (Array.isArray(assignment.preferredProfiles) && assignment.preferredProfiles.length) return assignment.preferredProfiles;
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

function storageFileFor(tweakId, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const userRoot = options.userRoot || userRootForPlatform(home);
  return path.join(userRoot, "storage", `${tweakId}.json`);
}

function readStorageFile(tweakId, options = {}) {
  const fs = options.fs || require("node:fs");
  const file = storageFileFor(tweakId, options);
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
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

function readChromeVerifierResult(projectPath, options = {}) {
  const storage = readStorageFile(TWEAK_ID, options);
  const results = storage[CHROME_VERIFIER_RESULTS_KEY];
  if (!results || typeof results !== "object" || Array.isArray(results)) return null;
  const result = results[projectPath];
  return result && typeof result === "object" && !Array.isArray(result) ? result : null;
}

function readChromeVerifierHistory(projectPath, options = {}) {
  const storage = readStorageFile(TWEAK_ID, options);
  const historyByProject = storage[CHROME_VERIFIER_HISTORY_KEY];
  if (!historyByProject || typeof historyByProject !== "object" || Array.isArray(historyByProject)) return [];
  const history = historyByProject[projectPath];
  return Array.isArray(history) ? history.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
}

function saveChromeVerifierResult(projectPath, result, options = {}) {
  if (!projectPath) return null;
  const storage = readStorageFile(TWEAK_ID, options);
  const results = storage[CHROME_VERIFIER_RESULTS_KEY] && typeof storage[CHROME_VERIFIER_RESULTS_KEY] === "object" && !Array.isArray(storage[CHROME_VERIFIER_RESULTS_KEY])
    ? { ...storage[CHROME_VERIFIER_RESULTS_KEY] }
    : {};
  const historyByProject = storage[CHROME_VERIFIER_HISTORY_KEY] && typeof storage[CHROME_VERIFIER_HISTORY_KEY] === "object" && !Array.isArray(storage[CHROME_VERIFIER_HISTORY_KEY])
    ? { ...storage[CHROME_VERIFIER_HISTORY_KEY] }
    : {};
  const sanitized = sanitizeChromeVerifierResult(result);
  const history = Array.isArray(historyByProject[projectPath]) ? historyByProject[projectPath].filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
  history.push(sanitized);
  results[projectPath] = sanitized;
  historyByProject[projectPath] = history.slice(-MAX_CHROME_VERIFIER_HISTORY);
  storage[CHROME_VERIFIER_RESULTS_KEY] = results;
  storage[CHROME_VERIFIER_HISTORY_KEY] = historyByProject;
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(TWEAK_ID, storage, options);
  return results[projectPath];
}

function sanitizeChromeVerifierResult(result) {
  const sections = result?.sections || {};
  return {
    checkedAt: new Date().toISOString(),
    summary: String(result?.summary || ""),
    sections: {
      profile: Boolean(sections.profile),
      extension: Boolean(sections.extension),
      backend: Boolean(sections.backend),
      locks: Boolean(sections.locks),
    },
    fixes: Array.isArray(result?.fixes)
      ? result.fixes.map((fix) => ({
          section: String(fix?.section || ""),
          status: String(fix?.status || ""),
          action: String(fix?.action || ""),
        }))
      : [],
    routing: {
      default: chromeVerifierRouteSummary(result?.routing?.default),
      trr: chromeVerifierRouteSummary(result?.routing?.trr),
      project: chromeVerifierRouteSummary(result?.routing?.project),
    },
  };
}

function chromeVerifierRouteSummary(route) {
  if (!route || typeof route !== "object") return null;
  return {
    source: String(route.source || ""),
    profileDirectory: String(route.profileDirectory || ""),
    profileName: String(route.profileName || ""),
    preferencesPath: String(route.preferencesPath || ""),
  };
}

function readChromeStorage(userRoot) {
  const value = readStorageFile(CHROME_TWEAK_ID, { userRoot });
  return {
    ...value,
    assignments: isPlainObject(value.assignments) ? value.assignments : {},
  };
}

function readGoogleWorkspaceStorage(userRoot) {
  const value = readStorageFile(TWEAK_ID, { userRoot });
  return {
    ...value,
    [GOOGLE_WORKSPACE_ACCOUNTS_KEY]: Array.isArray(value[GOOGLE_WORKSPACE_ACCOUNTS_KEY])
      ? value[GOOGLE_WORKSPACE_ACCOUNTS_KEY].filter(isGoogleWorkspaceAccount)
      : [],
    [GOOGLE_WORKSPACE_ASSIGNMENTS_KEY]: isPlainObject(value[GOOGLE_WORKSPACE_ASSIGNMENTS_KEY])
      ? value[GOOGLE_WORKSPACE_ASSIGNMENTS_KEY]
      : {},
    get accounts() {
      return this[GOOGLE_WORKSPACE_ACCOUNTS_KEY];
    },
    get assignments() {
      return this[GOOGLE_WORKSPACE_ASSIGNMENTS_KEY];
    },
  };
}

function readModalWorkspaceStorage(userRoot) {
  const value = readStorageFile(TWEAK_ID, { userRoot });
  return {
    ...value,
    [MODAL_WORKSPACE_ACCOUNTS_KEY]: Array.isArray(value[MODAL_WORKSPACE_ACCOUNTS_KEY])
      ? value[MODAL_WORKSPACE_ACCOUNTS_KEY].filter(isModalWorkspaceAccount)
      : [],
    [MODAL_WORKSPACE_ASSIGNMENTS_KEY]: isPlainObject(value[MODAL_WORKSPACE_ASSIGNMENTS_KEY])
      ? value[MODAL_WORKSPACE_ASSIGNMENTS_KEY]
      : {},
    get accounts() {
      return this[MODAL_WORKSPACE_ACCOUNTS_KEY];
    },
    get assignments() {
      return this[MODAL_WORKSPACE_ASSIGNMENTS_KEY];
    },
  };
}

function readDecodoStorage(userRoot) {
  const value = readStorageFile(TWEAK_ID, { userRoot });
  return {
    ...value,
    [DECODO_ACCOUNTS_KEY]: Array.isArray(value[DECODO_ACCOUNTS_KEY])
      ? value[DECODO_ACCOUNTS_KEY].filter(isDecodoAccount)
      : [],
    [DECODO_ASSIGNMENTS_KEY]: isPlainObject(value[DECODO_ASSIGNMENTS_KEY])
      ? value[DECODO_ASSIGNMENTS_KEY]
      : {},
    get accounts() {
      return this[DECODO_ACCOUNTS_KEY];
    },
    get assignments() {
      return this[DECODO_ASSIGNMENTS_KEY];
    },
  };
}

function writeGoogleWorkspaceStorage(storage, options = {}) {
  const next = { ...storage };
  delete next.accounts;
  delete next.assignments;
  writeStorageFile(TWEAK_ID, next, options);
  return next;
}

function writeModalWorkspaceStorage(storage, options = {}) {
  const next = { ...storage };
  delete next.accounts;
  delete next.assignments;
  writeStorageFile(TWEAK_ID, next, options);
  return next;
}

function writeDecodoStorage(storage, options = {}) {
  const next = { ...storage };
  delete next.accounts;
  delete next.assignments;
  writeStorageFile(TWEAK_ID, next, options);
  return next;
}

function googleWorkspaceAccountsForProject(projectPathInput, options = {}) {
  const storage = readGoogleWorkspaceStorage(options.userRoot);
  const accounts = [...storage.accounts];
  for (const account of googleWorkspaceConnectorAccountsFromMetadata(options)) {
    if (!accounts.some((candidate) => candidate.email.toLowerCase() === account.email.toLowerCase())) {
      accounts.push(account);
    }
  }
  const profiles = Array.isArray(options.chromeProfiles)
    ? options.chromeProfiles
    : listChromeProfilesFromDisk({ fs: options.fs, os: options.os, path: options.path });
  for (const profile of profiles) {
    const email = String(profile?.email || "").trim();
    if (!email || accounts.some((account) => account.email.toLowerCase() === email.toLowerCase())) continue;
    accounts.push({
      id: slugify(email),
      name: email,
      email,
      avatarUrl: profile.avatarUrl || "",
      source: "chrome-profile",
      updatedAt: new Date().toISOString(),
    });
  }
  return accounts;
}

function modalWorkspaceAccountsForProject(_projectPathInput, options = {}) {
  const storage = readModalWorkspaceStorage(options.userRoot);
  const accounts = [...storage.accounts];
  if (!accounts.some((account) => account.workspace === DEFAULT_MODAL_WORKSPACE_ACCOUNT.workspace)) {
    accounts.unshift({ ...DEFAULT_MODAL_WORKSPACE_ACCOUNT });
  }
  return accounts;
}

function decodoAccountsForProject(_projectPathInput, options = {}) {
  return [...readDecodoStorage(options.userRoot).accounts];
}

function activeModalWorkspaceContext(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const projectPath = typeof projectPathInput === "string" ? projectPathInput : "";
  const env = { ...process.env, ...(options.env || {}) };
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
      const payload = JSON.parse(stdout || "[]");
      const rows = Array.isArray(payload) ? payload : [];
      const active = rows.find((row) => row && typeof row === "object" && row.active === true);
      return {
        profile: String(active?.name || "").trim() || null,
        workspace: String(active?.workspace || "").trim() || null,
        source: candidate.label,
        error: null,
      };
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }
  return {
    profile: null,
    workspace: null,
    source: null,
    error: lastError || "Modal CLI profile unavailable.",
  };
}

function modalPythonCommandCandidates(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const env = options.env || process.env;
  const candidates = [];
  const add = (command, args = [], label = command) => {
    if (!command || candidates.some((candidate) => candidate.command === command && candidate.args.join(" ") === args.join(" "))) return;
    candidates.push({ command, args, label });
  };
  if (env.CODEX_PROJECTS_MODAL_PYTHON) add(env.CODEX_PROJECTS_MODAL_PYTHON, [], env.CODEX_PROJECTS_MODAL_PYTHON);
  if (projectPath) {
    for (const candidate of [
      path.join(projectPath, ".venv", "bin", "python"),
      path.join(projectPath, "TRR-Backend", ".venv", "bin", "python"),
    ]) {
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
  return {
    expectedProfile,
    expectedWorkspace,
    activeProfile,
    activeWorkspace,
  };
}

function googleWorkspaceConnectorAccountsFromMetadata(options = {}) {
  const fs = options.fs || require("node:fs");
  const os = options.os || require("node:os");
  const path = options.path || require("node:path");
  const home = options.home || os.homedir();
  const codexRoot = path.join(home, ".codex");
  const appIds = {
    gmail: connectorIdFromAppManifest(path.join(codexRoot, "plugins", "cache", "openai-curated", "gmail"), fs, path),
    "google-drive": connectorIdFromAppManifest(path.join(codexRoot, "plugins", "cache", "openai-curated", "google-drive"), fs, path),
  };
  const cacheDirs = [
    path.join(codexRoot, "cache", "codex_apps_tools"),
    path.join(codexRoot, "cache", "codex_app_directory"),
  ];
  const accountsByEmail = new Map();
  for (const cacheDir of cacheDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const metadata = readJson(path.join(cacheDir, entry.name), fs);
      if (!metadata) continue;
      const text = JSON.stringify(metadata);
      for (const [service, connectorId] of Object.entries(appIds)) {
        if (!connectorId || !text.includes(connectorId)) continue;
        const emails = new Set();
        collectEmailsFromConnectorMetadata(metadata, connectorId, emails);
        for (const email of emails) {
          if (isPlaceholderConnectorEmail(email)) continue;
          const key = email.toLowerCase();
          if (accountsByEmail.has(key)) continue;
          accountsByEmail.set(key, {
            id: slugify(`${service}-${email}`),
            name: email,
            email,
            avatarUrl: "",
            source: `${service}-connector-metadata`,
            services: [service],
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  return [...accountsByEmail.values()];
}

function connectorIdFromAppManifest(pluginDir, fs, path) {
  let candidates = [];
  try {
    candidates = fs.readdirSync(pluginDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(pluginDir, entry.name, ".app.json"));
  } catch {
    return "";
  }
  for (const candidate of candidates) {
    const value = readJson(candidate, fs);
    const apps = value?.apps && typeof value.apps === "object" ? value.apps : {};
    for (const app of Object.values(apps)) {
      if (typeof app?.id === "string" && app.id.startsWith("connector_")) return app.id;
    }
  }
  return "";
}

function collectEmailsFromConnectorMetadata(value, connectorId, emails, insideConnector = false) {
  if (value == null) return false;
  if (typeof value === "string") {
    const isConnectorString = value.includes(connectorId);
    if (insideConnector) {
      for (const match of value.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        if (!isPlaceholderConnectorEmail(match[0])) emails.add(match[0]);
      }
    }
    return isConnectorString;
  }
  if (Array.isArray(value)) {
    let found = insideConnector;
    for (const item of value) {
      if (collectEmailsFromConnectorMetadata(item, connectorId, emails, insideConnector)) found = true;
    }
    return found;
  }
  if (typeof value !== "object") return false;
  const directConnectorObject = Object.values(value).some((child) => typeof child === "string" && child.includes(connectorId));
  const nextInside = insideConnector || directConnectorObject;
  let found = nextInside;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /email|mail|account|profile|user/i.test(key) && nextInside) {
      for (const match of child.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        if (!isPlaceholderConnectorEmail(match[0])) emails.add(match[0]);
      }
    }
    if (collectEmailsFromConnectorMetadata(child, connectorId, emails, nextInside)) found = true;
  }
  return found;
}

function isPlaceholderConnectorEmail(emailInput) {
  const email = String(emailInput || "").trim().toLowerCase();
  if (!email) return true;
  const domain = email.split("@")[1] || "";
  if (["example.com", "example.org", "example.net", "domain.com", "test.com", "email.com"].includes(domain)) return true;
  if (/^(user|alice|bob|name|you|me)@/.test(email)) return true;
  return false;
}

function saveGoogleWorkspaceAccountToStorage(input, options = {}) {
  const email = String(input?.email || "").trim();
  const name = String(input?.name || email).trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Google account email is required.");
  const id = String(input?.id || slugify(email)).trim();
  const storage = readGoogleWorkspaceStorage(options.userRoot);
  const next = {
    id,
    name,
    email,
    avatarUrl: String(input?.avatarUrl || "").trim(),
    source: String(input?.source || "manual"),
    updatedAt: new Date().toISOString(),
  };
  const index = storage.accounts.findIndex((account) => account.id === id || account.email.toLowerCase() === email.toLowerCase());
  if (index >= 0) storage.accounts[index] = next;
  else storage.accounts.push(next);
  storage.updatedAt = new Date().toISOString();
  writeGoogleWorkspaceStorage(storage, options);
  return next;
}

function saveGoogleWorkspaceAssignmentToStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath, { home, path });
  const service = normalizeGoogleWorkspaceService(input?.service);
  const accountId = String(input?.accountId || "").trim();
  const storage = readGoogleWorkspaceStorage(options.userRoot);
  const account = storage.accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("Select a Google account first.");
  const projectAssignments = isPlainObject(storage.assignments[projectPath]) ? { ...storage.assignments[projectPath] } : {};
  projectAssignments[service] = {
    projectPath,
    service,
    accountId: account.id,
    accountName: account.name,
    email: account.email,
    source: account.source || "manual",
    updatedAt: new Date().toISOString(),
  };
  storage.assignments[projectPath] = projectAssignments;
  storage.updatedAt = new Date().toISOString();
  writeGoogleWorkspaceStorage(storage, options);
  return projectAssignments[service];
}

function normalizeModalWorkspaceAccount(input) {
  const workspace = String(input?.workspace || "").trim();
  const profile = String(input?.profile || workspace).trim();
  const name = String(input?.name || workspace || profile).trim();
  if (!workspace) throw new Error("Modal workspace is required.");
  if (!profile) throw new Error("Modal profile is required.");
  return {
    id: String(input?.id || slugify(`modal-${workspace}`)).trim(),
    name,
    profile,
    workspace,
    source: String(input?.source || "manual").trim() || "manual",
    updatedAt: new Date().toISOString(),
  };
}

function saveModalWorkspaceAccountToStorage(input, options = {}) {
  const next = normalizeModalWorkspaceAccount(input);
  const storage = readModalWorkspaceStorage(options.userRoot);
  const index = storage.accounts.findIndex((account) => account.id === next.id || account.workspace === next.workspace);
  if (index >= 0) storage.accounts[index] = next;
  else storage.accounts.push(next);
  storage.updatedAt = new Date().toISOString();
  writeModalWorkspaceStorage(storage, options);
  return next;
}

function saveModalWorkspaceAssignmentToStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath, { home, path });
  const accountId = String(input?.accountId || "").trim();
  const storage = readModalWorkspaceStorage(options.userRoot);
  const account = storage.accounts.find((candidate) => candidate.id === accountId)
    || modalWorkspaceAccountsForProject(projectPath, options).find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("Select a Modal workspace first.");
  storage.assignments[projectPath] = {
    projectPath,
    accountId: account.id,
    accountName: account.name,
    profile: account.profile,
    workspace: account.workspace,
    source: account.source || "manual",
    updatedAt: new Date().toISOString(),
  };
  if (!storage.accounts.some((candidate) => candidate.id === account.id || candidate.workspace === account.workspace)) {
    storage.accounts.push(normalizeModalWorkspaceAccount(account));
  }
  storage.updatedAt = new Date().toISOString();
  writeModalWorkspaceStorage(storage, options);
  return storage.assignments[projectPath];
}

function normalizeDecodoAccount(input) {
  const username = String(input?.username || input?.email || "").trim();
  const name = String(input?.name || username || "Decodo").trim();
  return {
    id: String(input?.id || slugify(`decodo-${username || name}`)).trim(),
    name,
    username,
    source: String(input?.source || "manual").trim() || "manual",
    updatedAt: new Date().toISOString(),
  };
}

function saveDecodoAccountToStorage(input, options = {}) {
  const next = normalizeDecodoAccount(input);
  if (!next.name && !next.username) throw new Error("Decodo account name is required.");
  const storage = readDecodoStorage(options.userRoot);
  const index = storage.accounts.findIndex((account) => account.id === next.id || (next.username && account.username === next.username));
  if (index >= 0) storage.accounts[index] = next;
  else storage.accounts.push(next);
  storage.updatedAt = new Date().toISOString();
  writeDecodoStorage(storage, options);
  return next;
}

function saveDecodoAssignmentToStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath, { home, path });
  const accountId = String(input?.accountId || "").trim();
  const storage = readDecodoStorage(options.userRoot);
  const account = storage.accounts.find((candidate) => candidate.id === accountId)
    || decodoAccountsForProject(projectPath, options).find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("Select a Decodo account first.");
  storage.assignments[projectPath] = {
    projectPath,
    accountId: account.id,
    accountName: account.name,
    username: account.username,
    source: account.source || "manual",
    updatedAt: new Date().toISOString(),
  };
  if (!storage.accounts.some((candidate) => candidate.id === account.id || (account.username && candidate.username === account.username))) {
    storage.accounts.push(normalizeDecodoAccount(account));
  }
  storage.updatedAt = new Date().toISOString();
  writeDecodoStorage(storage, options);
  return storage.assignments[projectPath];
}

function clearModalWorkspaceAssignmentFromStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath || input, { home, path });
  const storage = readModalWorkspaceStorage(options.userRoot);
  delete storage.assignments[projectPath];
  storage.updatedAt = new Date().toISOString();
  writeModalWorkspaceStorage(storage, options);
  return true;
}

function clearDecodoAssignmentFromStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath || input, { home, path });
  const storage = readDecodoStorage(options.userRoot);
  delete storage.assignments[projectPath];
  storage.updatedAt = new Date().toISOString();
  writeDecodoStorage(storage, options);
  return true;
}

function clearGoogleWorkspaceAssignmentFromStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath || input, { home, path });
  const service = normalizeGoogleWorkspaceService(input?.service);
  const storage = readGoogleWorkspaceStorage(options.userRoot);
  if (isPlainObject(storage.assignments[projectPath])) {
    delete storage.assignments[projectPath][service];
    if (!Object.keys(storage.assignments[projectPath]).length) delete storage.assignments[projectPath];
  }
  storage.updatedAt = new Date().toISOString();
  writeGoogleWorkspaceStorage(storage, options);
  return true;
}

function normalizeGoogleWorkspaceService(value) {
  const service = String(value || "").trim().toLowerCase();
  if (service === "gmail") return "gmail";
  if (service === "google-drive" || service === "googledrive" || service === "drive") return "google-drive";
  throw new Error("Google Workspace service must be gmail or google-drive.");
}

function isGoogleWorkspaceAccount(account) {
  return account && typeof account === "object" && typeof account.id === "string" && typeof account.email === "string";
}

function isModalWorkspaceAccount(account) {
  return account && typeof account === "object" && typeof account.id === "string" && typeof account.workspace === "string";
}

function isDecodoAccount(account) {
  return account && typeof account === "object" && typeof account.id === "string" && typeof account.name === "string";
}

function gitRepositoriesForProject(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const home = options.home || require("node:os").homedir();
  if (typeof projectPathInput !== "string" || !projectPathInput.trim()) return [];
  const projectPath = normalizeProjectPath(projectPathInput, { home, path });
  if (projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) return [];
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

function gitIdentityForProject(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const home = options.home || require("node:os").homedir();
  if (typeof projectPathInput !== "string" || !projectPathInput.trim()) return null;
  const projectPath = normalizeProjectPath(projectPathInput, { home, path });
  if (projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) return null;
  const gitRoot = gitRootForProject(projectPath, { fs, path, childProcess });
  if (!gitRoot) return null;
  const name = safeExec("git", ["-C", gitRoot, "config", "--local", "--get", "user.name"], childProcess) ||
    safeExec("git", ["-C", gitRoot, "config", "--global", "--get", "user.name"], childProcess);
  const email = safeExec("git", ["-C", gitRoot, "config", "--local", "--get", "user.email"], childProcess) ||
    safeExec("git", ["-C", gitRoot, "config", "--global", "--get", "user.email"], childProcess);
  const username = safeExec("git", ["-C", gitRoot, "config", "--local", "--get", "github.user"], childProcess) ||
    safeExec("git", ["-C", gitRoot, "config", "--global", "--get", "github.user"], childProcess) ||
    githubUsernameFromNoreply(email);
  if (!name && !email && !username) return null;
  return { name, email, username, gitRoot };
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
  const value = String(remoteUrl || "").trim().replace(/\.git$/i, "");
  const ssh = /^git@github\.com:([^/]+)\/(.+)$/.exec(value);
  if (ssh) return { owner: ssh[1], name: ssh[2] };
  const https = /^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(value);
  if (https) return { owner: https[1], name: https[2] };
  const gh = /^gh:([^/]+)\/(.+)$/.exec(value);
  if (gh) return { owner: gh[1], name: gh[2] };
  return null;
}

function safeExec(command, args, childProcess) {
  try {
    return childProcess.execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function githubUsernameFromNoreply(email) {
  const match = /^[0-9]+\+([^@\s]+)@users\.noreply\.github\.com$/i.exec(String(email || ""));
  return match ? match[1] : "";
}

function normalizeProjectColorKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeProjectColorId(value) {
  const id = String(value || "auto").trim().toLowerCase();
  return PROJECT_COLOR_OPTIONS.some((option) => option.id === id) ? id : "auto";
}

function normalizeProjectOverlayIntensity(value) {
  const id = String(value || DEFAULT_PROJECT_OVERLAY_INTENSITY).trim().toLowerCase();
  return PROJECT_OVERLAY_OPTIONS.some((option) => option.id === id)
    ? id
    : DEFAULT_PROJECT_OVERLAY_INTENSITY;
}

function readProjectColorStorage(userRoot) {
  const value = readStorageFile(UI_IMPROVEMENTS_TWEAK_ID, { userRoot })[PROJECT_COLOR_STORAGE_KEY];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readProjectOverlayStorage(userRoot) {
  const value = readStorageFile(UI_IMPROVEMENTS_TWEAK_ID, { userRoot })[PROJECT_OVERLAY_STORAGE_KEY];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function saveProjectColorToStorage(input, options = {}) {
  const projectKey = normalizeProjectColorKey(input?.projectKey || input?.projectName || input?.name);
  const colorId = normalizeProjectColorId(input?.colorId);
  if (!projectKey) throw new Error("Project color key is required.");
  const storage = readStorageFile(UI_IMPROVEMENTS_TWEAK_ID, options);
  const prefs = storage[PROJECT_COLOR_STORAGE_KEY] && typeof storage[PROJECT_COLOR_STORAGE_KEY] === "object" && !Array.isArray(storage[PROJECT_COLOR_STORAGE_KEY])
    ? { ...storage[PROJECT_COLOR_STORAGE_KEY] }
    : {};
  if (colorId === "auto") delete prefs[projectKey];
  else prefs[projectKey] = colorId;
  storage[PROJECT_COLOR_STORAGE_KEY] = prefs;
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(UI_IMPROVEMENTS_TWEAK_ID, storage, options);
  return { projectKey, colorId, colors: prefs };
}

function saveProjectOverlayToStorage(input, options = {}) {
  const projectKey = normalizeProjectColorKey(input?.projectKey || input?.projectName || input?.name);
  const overlayIntensity = normalizeProjectOverlayIntensity(input?.overlayIntensity || input?.intensity);
  if (!projectKey) throw new Error("Project overlay key is required.");
  const storage = readStorageFile(UI_IMPROVEMENTS_TWEAK_ID, options);
  const prefs = storage[PROJECT_OVERLAY_STORAGE_KEY] && typeof storage[PROJECT_OVERLAY_STORAGE_KEY] === "object" && !Array.isArray(storage[PROJECT_OVERLAY_STORAGE_KEY])
    ? { ...storage[PROJECT_OVERLAY_STORAGE_KEY] }
    : {};
  if (overlayIntensity === DEFAULT_PROJECT_OVERLAY_INTENSITY) delete prefs[projectKey];
  else prefs[projectKey] = overlayIntensity;
  storage[PROJECT_OVERLAY_STORAGE_KEY] = prefs;
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(UI_IMPROVEMENTS_TWEAK_ID, storage, options);
  return { projectKey, overlayIntensity, overlays: prefs };
}

function saveChromeAssignmentToStorage(input, options = {}) {
  const path = options.path || require("node:path");
  const fs = options.fs || require("node:fs");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath, { home, path });
  const preferencesPaths = normalizePreferencesPaths(input?.preferencesPaths || input?.preferencesPath);
  if (!preferencesPaths.length) throw new Error("Select at least one Chrome profile.");
  for (const preferencesPath of preferencesPaths) validatePreferencesPath(preferencesPath, { fs, path });
  const profiles = Array.isArray(options.profiles) ? options.profiles : [];
  const preferredProfiles = preferencesPaths.map((preferencesPath) => {
    const profileDirectory = path.basename(path.dirname(preferencesPath));
    const profile = profiles.find((candidate) => candidate.preferencesPath === preferencesPath);
    return {
      profileDirectory,
      profileName: profile?.name || input?.projectName || profileDirectory,
      preferencesPath,
      userDataDir: path.dirname(path.dirname(preferencesPath)),
    };
  });
  const primary = preferredProfiles[0];
  const storage = readChromeStorage(options.userRoot);
  storage.assignments[projectPath] = {
    projectPath,
    profileDirectory: primary.profileDirectory,
    profileName: primary.profileName,
    preferencesPath: primary.preferencesPath,
    userDataDir: primary.userDataDir,
    profileDirectories: preferredProfiles.map((profile) => profile.profileDirectory),
    profileNames: preferredProfiles.map((profile) => profile.profileName),
    preferencesPaths: preferredProfiles.map((profile) => profile.preferencesPath),
    preferredProfiles,
    updatedAt: new Date().toISOString(),
  };
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(CHROME_TWEAK_ID, storage, options);
  return storage.assignments[projectPath];
}

function clearChromeAssignmentFromStorage(projectPathInput, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(projectPathInput, { home, path });
  const storage = readChromeStorage(options.userRoot);
  delete storage.assignments[projectPath];
  storage.updatedAt = new Date().toISOString();
  writeStorageFile(CHROME_TWEAK_ID, storage, options);
  return true;
}

function normalizePreferencesPaths(input) {
  const values = Array.isArray(input) ? input : [input];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function validatePreferencesPath(preferencesPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  if (path.basename(preferencesPath) !== "Preferences") {
    throw new Error("Chrome profile path must point to a Preferences file.");
  }
  if (!fs.existsSync(preferencesPath)) {
    throw new Error(`Chrome Preferences file was not found: ${preferencesPath}`);
  }
}

function listChromeProfilesFromDisk(options = {}) {
  const fs = options.fs || require("node:fs");
  const os = options.os || require("node:os");
  const path = options.path || require("node:path");
  const { pathToFileURL } = require("node:url");
  const userDataDir = chromeUserDataDir({ os, path });
  const extensionId = codexChromeExtensionId({ fs, os, path });
  const localState = readJson(path.join(userDataDir, "Local State"), fs);
  const infoCache = localState?.profile?.info_cache || {};
  const ordered = Array.isArray(localState?.profile?.profiles_order) ? localState.profile.profiles_order : Object.keys(infoCache);
  const profiles = [];
  const seen = new Set();

  for (const directory of [...ordered, ...Object.keys(infoCache), "Default"]) {
    if (typeof directory !== "string" || seen.has(directory)) continue;
    seen.add(directory);
    const preferencesPath = path.join(userDataDir, directory, "Preferences");
    if (!fs.existsSync(preferencesPath)) continue;
    if (!chromeProfileHasEnabledCodexExtension(userDataDir, directory, extensionId, { fs, path })) continue;
    const metadata = infoCache[directory] || {};
    const email = typeof metadata.user_name === "string" ? metadata.user_name.trim() : "";
    const avatarPath = path.join(userDataDir, directory, "Google Profile Picture.png");
    profiles.push({
      userDataDir,
      directory,
      name: email || metadata.name || (directory === "Default" ? "Default" : directory),
      email,
      avatarUrl: fs.existsSync(avatarPath) ? pathToFileURL(avatarPath).href : "",
      preferencesPath,
      isLastUsed: localState?.profile?.last_used === directory,
    });
  }

  if (profiles.length === 0 && fs.existsSync(userDataDir)) {
    for (const entry of fs.readdirSync(userDataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== "Default" && !/^Profile \d+$/.test(entry.name)) continue;
      const preferencesPath = path.join(userDataDir, entry.name, "Preferences");
      if (!fs.existsSync(preferencesPath) || seen.has(entry.name)) continue;
      if (!chromeProfileHasEnabledCodexExtension(userDataDir, entry.name, extensionId, { fs, path })) continue;
      const avatarPath = path.join(userDataDir, entry.name, "Google Profile Picture.png");
      profiles.push({
        userDataDir,
        directory: entry.name,
        name: entry.name,
        email: "",
        avatarUrl: fs.existsSync(avatarPath) ? pathToFileURL(avatarPath).href : "",
        preferencesPath,
        isLastUsed: false,
      });
    }
  }

  return profiles;
}

function chromeUserDataDir(options = {}) {
  const os = options.os || require("node:os");
  const path = options.path || require("node:path");
  if (process.env.CODEX_CHROME_USER_DATA_DIR) return path.resolve(process.env.CODEX_CHROME_USER_DATA_DIR);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Google", "Chrome", "User Data");
  }
  return path.join(os.homedir(), ".config", "google-chrome");
}

function codexChromeExtensionId(options = {}) {
  const fs = options.fs || require("node:fs");
  const os = options.os || require("node:os");
  const path = options.path || require("node:path");
  const explicit = process.env.CODEX_CHROME_EXTENSION_ID;
  if (explicit) return explicit;
  const chromePluginRoot = path.join(os.homedir(), ".codex", "plugins", "cache", "openai-bundled", "chrome");
  try {
    const versions = fs.readdirSync(chromePluginRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const config = readJson(path.join(chromePluginRoot, version, "scripts", "extension-id.json"), fs);
      if (typeof config?.extensionId === "string" && config.extensionId) return config.extensionId;
    }
  } catch {}
  return "hehggadaopoacecdllhhajmbjkdcmajg";
}

function chromeProfileHasEnabledCodexExtension(userDataDir, directory, extensionId, options = {}) {
  if (!extensionId) return false;
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const profilePath = path.join(userDataDir, directory);
  const extensionPath = path.join(profilePath, "Extensions", extensionId);
  const versions = fs.existsSync(extensionPath) && fs.statSync(extensionPath).isDirectory()
    ? fs.readdirSync(extensionPath, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const preferences = chromeExtensionPreferences(profilePath, extensionId, { fs, path });
  const unpackedInstalled = preferences.path && fs.existsSync(preferences.path);
  const installed = versions.length > 0 || Boolean(unpackedInstalled);
  return installed && preferences.registered && preferences.state !== 0 && preferences.disableReasons.length === 0;
}

function chromeExtensionPreferences(profilePath, extensionId, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  for (const fileName of ["Secure Preferences", "Preferences"]) {
    const preferencesPath = path.join(profilePath, fileName);
    const preferences = readJson(preferencesPath, fs);
    const settings = preferences?.extensions?.settings?.[extensionId];
    if (!settings || typeof settings !== "object") continue;
    const disableReasons = Array.isArray(settings.disable_reasons)
      ? settings.disable_reasons
      : typeof settings.disable_reasons === "number" && settings.disable_reasons !== 0
        ? [settings.disable_reasons]
        : [];
    return {
      registered: true,
      state: typeof settings.state === "number" ? settings.state : null,
      path: typeof settings.path === "string" ? settings.path : null,
      disableReasons,
    };
  }
  return { registered: false, state: null, path: null, disableReasons: [] };
}

function readJson(file, fs) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readSidebarProjects(api) {
  const value = api.storage.get(SIDEBAR_PROJECTS_KEY, []);
  return Array.isArray(value) ? value : [];
}

function readSidebarProjectOrder(api) {
  return normalizeSidebarProjectOrder(api.storage.get(SIDEBAR_PROJECT_ORDER_KEY, []));
}

function normalizeSidebarProjects(projects) {
  return Array.isArray(projects)
    ? projects
        .filter((project) => project && typeof project.name === "string" && !isExcludedSidebarProjectName(project.name) && !isCloudProjectPath(project.projectPath))
        .map((project) => ({
          name: project.name,
          projectPath: typeof project.projectPath === "string" ? project.projectPath : "",
          updatedAt: new Date().toISOString(),
        }))
    : [];
}

function normalizeSidebarProjectOrder(order) {
  if (!Array.isArray(order)) return [];
  const seen = new Set();
  const normalized = [];
  for (const value of order) {
    const key = sidebarProjectOrderKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function sidebarProjectOrderKey(project) {
  const value = typeof project === "string"
    ? project
    : project?.projectPath || project?.name || project?.label || "";
  return compactText(value).toLowerCase();
}

function sortProjectsBySavedOrder(projects, projectOrder) {
  const order = normalizeSidebarProjectOrder(projectOrder);
  if (!order.length || !Array.isArray(projects) || projects.length < 2) return projects;
  const indexByKey = new Map(order.map((key, index) => [key, index]));
  return [...projects].sort((a, b) => {
    const aIndex = indexByKey.get(sidebarProjectOrderKey(a));
    const bIndex = indexByKey.get(sidebarProjectOrderKey(b));
    if (aIndex === undefined && bIndex === undefined) return 0;
    if (aIndex === undefined) return 1;
    if (bIndex === undefined) return -1;
    return aIndex - bIndex;
  });
}

function projectCandidates(options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const sidebarProjects = Array.isArray(options.sidebarProjects) ? options.sidebarProjects : [];
  const candidates = [];
  const known = knownProjectPaths(home, path);

  const add = (projectPathInput, name, source) => {
    if (!projectPathInput || typeof projectPathInput !== "string") return;
    if (isCloudProjectPath(projectPathInput)) return;
    if (projectPathInput.startsWith("codex-sidebar://")) return;
    const projectPath = normalizeProjectPath(projectPathInput, { home, path });
    if (!fs.existsSync(projectPath)) return;
    const label = name || path.basename(projectPath);
    candidates.push({ name: label, projectPath, source });
  };

  for (const project of sidebarProjects) {
    if (!project?.name || isExcludedSidebarProjectName(project.name)) continue;
    const projectPath = resolveSidebarProjectPath(project, known, { fs, path, home });
    add(projectPath, project.name, "sidebar");
  }

  const byPath = new Map();
  for (const candidate of candidates) {
    if (!byPath.has(candidate.projectPath)) byPath.set(candidate.projectPath, candidate);
  }
  return sortProjectsBySavedOrder([...byPath.values()], options.projectOrder);
}

function resolveSidebarProjectPath(project, known, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const name = String(project?.name || "").trim();
  const explicit = typeof project?.projectPath === "string" ? project.projectPath.trim() : "";
  if (explicit && !explicit.startsWith("codex-sidebar://") && !isCloudProjectPath(explicit)) {
    const resolved = normalizeProjectPath(explicit, { home, path });
    if (fs.existsSync(resolved)) return resolved;
  }
  const knownPath = known[name];
  if (knownPath && fs.existsSync(knownPath)) return knownPath;
  return "";
}

function readCodexProjectConfigPaths(options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  try {
    const config = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    return [...config.matchAll(/^\[projects\."([^"]+)"\]/gm)].map((match) => match[1]);
  } catch {
    return [];
  }
}

function knownProjectPaths(home, path) {
  return {
    TRR: path.join(home, "Projects", "TRR"),
    "THB-BBL": path.join(home, "Projects", "THB-BBL"),
    PLUGINS: path.join(home, "Projects", "PLUGINS"),
    "SKILLS MANAGER": path.join(home, "Projects", "SKILLS MANAGER"),
    Codex: path.join(home, "Applications", "codex"),
    ShadGPT: path.join(home, "Applications", ["codex", "plusplus"].join("-")),
  };
}

function scanCommonProjectRoots(options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const roots = [path.join(home, "Projects"), path.join(home, "Applications"), path.join(home, "Documents", "Codex")];
  const projects = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(root, entry.name);
      if (looksLikeLocalProject(projectPath, { fs, path })) projects.push({ name: entry.name, projectPath });
    }
  }
  return projects;
}

function looksLikeLocalProject(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  return [".git", ".codex", "package.json", "AGENTS.md", "manifest.json"].some((name) => fs.existsSync(path.join(projectPath, name))) ||
    scanEnvFiles(projectPath, { fs, path, maxDepth: 1 }).length > 0;
}

function isCloudProjectPath(projectPath) {
  return typeof projectPath === "string" && projectPath.startsWith(CLOUD_PROJECT_PREFIX);
}

function isExcludedSidebarProjectName(name) {
  return EXCLUDED_SIDEBAR_PROJECT_NAMES.has(String(name || "").toLowerCase());
}

function normalizeProjectPath(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  if (typeof input !== "string" || input.trim() === "") throw new Error("Project path is required.");
  if (input.startsWith("codex-sidebar://")) return input;
  return path.resolve(input.replace(/^~(?=$|\/|\\)/, home));
}

function assertLocalProjectPath(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  if (projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) {
    throw new Error("This project needs a local path before Projects can update connections.");
  }
}

function scanEnvInventory(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(projectPathInput, { home, path });
  if (projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) return { fileCount: 0, keyCount: 0, files: [] };
  const files = scanEnvFiles(projectPath, { fs, path, maxDepth: options.maxDepth ?? MAX_ENV_SCAN_DEPTH })
    .filter((filePath) => !isExampleEnvFileName(path.basename(filePath)))
    .map((filePath) => {
      const entries = parseDotenv(fs.readFileSync(filePath, "utf8"), filePath).map((entry) => ({
        key: entry.key,
        category: entry.category,
        redactedValue: redactValue(entry.value),
        sourceFile: filePath,
      }));
      return {
        path: filePath,
        relativePath: path.relative(projectPath, filePath) || path.basename(filePath),
        categories: groupEnvEntriesByCategory(entries),
        entries,
      };
    })
    .filter((file) => file.entries.length > 0);
  return {
    fileCount: files.length,
    keyCount: files.reduce((total, file) => total + file.entries.length, 0),
    files,
  };
}

function normalizeProjectEnvScanTimeout(input) {
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return DEFAULT_PROJECT_ENV_SCAN_TIMEOUT_MS;
  return Math.max(
    MIN_PROJECT_ENV_SCAN_TIMEOUT_MS,
    Math.min(MAX_PROJECT_ENV_SCAN_TIMEOUT_MS, Math.round(numeric)),
  );
}

function scanEnvFiles(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const maxDepth = options.maxDepth ?? MAX_ENV_SCAN_DEPTH;
  const files = [];

  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_ENV_DIRS.has(entry.name.toLowerCase())) walk(filePath, depth + 1);
      } else if (entry.isFile() && isSupportedEnvFileName(entry.name)) {
        files.push(filePath);
      }
    }
  };

  walk(projectPath, 0);
  return files.sort();
}

function isSupportedEnvFileName(fileNameInput) {
  const fileName = String(fileNameInput || "");
  if (isExampleEnvFileName(fileName)) return true;
  if (EXACT_ENV_FILE_NAMES.has(fileName)) return true;
  if (!fileName.startsWith(".env.")) return false;
  const lower = fileName.toLowerCase();
  return !EXCLUDED_ENV_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isExampleEnvFileName(fileNameInput) {
  const lower = String(fileNameInput || "").toLowerCase();
  return lower === ".env.example" || lower.endsWith(".example");
}

function parseDotenv(content, filePath = "") {
  const entries = [];
  const lines = String(content || "").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDotenvLine(line);
    if (!parsed) continue;
    entries.push({
      key: parsed.key,
      value: parsed.value,
      category: categoryForEnvKey(parsed.key),
      sourceFile: filePath,
    });
  }
  return entries;
}

function parseDotenvLine(line) {
  let input = String(line || "").trim();
  if (!input || input.startsWith("#")) return null;
  if (input.startsWith("export ")) input = input.slice("export ".length).trim();
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(input);
  if (!match) return null;
  const key = match[1];
  let value = match[2] || "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const quote = value[0];
    value = value.slice(1, -1);
    if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  } else {
    value = stripInlineComment(value).trim();
  }
  return { key, value };
}

function stripInlineComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (char === "'" && !inDouble && previous !== "\\") inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble && /\s/.test(previous || "")) return value.slice(0, index);
  }
  return value;
}

function categoryForEnvKey(keyInput) {
  const key = String(keyInput || "").toUpperCase();
  if (/(SUPABASE|POSTGREST|GOTRUE)/.test(key)) return "Supabase";
  if (/VERCEL/.test(key)) return "Vercel";
  if (/MODAL/.test(key)) return "Modal";
  if (/REDDIT/.test(key)) return "Reddit";
  if (/FIREBASE/.test(key)) return "Firebase";
  if (/(GMAIL|GOOGLE_MAIL|MAIL_GOOGLE)/.test(key)) return "Gmail";
  if (/(GOOGLE_DRIVE|GDRIVE|DRIVE_FOLDER|DRIVE_FILE|GOOGLE_DOC|GOOGLE_SHEET|GOOGLE_SLIDE)/.test(key)) return "Google Drive";
  if (/(GITHUB|GH_|GIT_|GITLAB)/.test(key)) return "GitHub";
  if (/(DATABASE|POSTGRES|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PRISMA|^DB_URL$|^TRR_DB_)/.test(key)) return "Database/Postgres";
  if (/(S3_|OBJECT_STORAGE|STORAGE_BACKEND|STORAGE_DELETE_LOCAL_AFTER_SYNC|OBJECT_STORE)/.test(key)) return "Object Storage";
  if (/(OPENAI|ANTHROPIC|CLAUDE|AI_|MODEL|LLM|GEMINI|MISTRAL|GROQ|DEEPSEEK|HUGGINGFACE|HUGGINGFACEHUB|HF_|PYANNOTE|ARCFACE|RETINAFACE|ELEVENLABS|VISION_|DEFAULT_DETECTOR|DEFAULT_TRACKER)/.test(key)) return "OpenAI/Anthropic/AI";
  if (/(CHROME|GOOGLE|GCP_|GCLOUD|OAUTH|CLIENT_ID|CLIENT_SECRET)/.test(key)) return "Chrome/Google";
  if (/CLOUDFLARE/.test(key)) return "Cloudflare";
  if (/RENDER/.test(key)) return "Render";
  if (/APIFY/.test(key)) return "Apify";
  if (/BETTER_STACK/.test(key)) return "Better Stack";
  if (/FIRECRAWL/.test(key)) return "Firecrawl";
  if (/BRANDFETCH/.test(key)) return "Brandfetch";
  if (/(TMDB|TVDB|THETVDB|IMDB|GETTY)/.test(key)) return "Media APIs";
  if (/DECODO/.test(key)) return "Decodo";
  if (/(INSTAGRAM|FACEBOOK|TIKTOK|TWITTER|THREADS|SOCIALBLADE|TWIKIT|SOCIAL_)/.test(key)) return "Social Platforms";
  if (/(SPREADSHEET_ID|SPREADSHEET_NAME)/.test(key)) return "Google Drive";
  if (/(TURBO_|NX_DAEMON)/.test(key)) return "Build/Turbo";
  if (/(SCREENALYTICS_|SHOW_SCRIBE_|UI_ORIGIN|API_BASE_URL)/.test(key)) return "Screenalytics";
  if (/(ADMIN_EMAIL|NEXT_PUBLIC_ADMIN_EMAILS|ALLOWLIST|TRR_INTERNAL_ADMIN)/.test(key)) return "Admin/Auth";
  if (/(^TRR_|CRON_SECRET|REQUEST_DELAY)/.test(key)) return "TRR/Internal";
  if (/LINEAR/.test(key)) return "Linear";
  if (/STRIPE/.test(key)) return "Stripe";
  return "Other";
}

function groupEnvEntriesByCategory(entries) {
  const categories = {};
  for (const entry of entries) {
    const category = entry.category || "Other";
    if (!categories[category]) categories[category] = [];
    categories[category].push(entry);
  }
  return categories;
}

function redactValue(value) {
  if (value === "") return "";
  return "[redacted]";
}

function revealEnvValueFromDisk(input, options = {}) {
  const fs = options.fs || require("node:fs");
  const key = String(input?.key || "");
  if (!key) throw new Error("Environment key is required.");
  const { filePath } = resolveProjectEnvFile(input, options, "revealed");
  const entries = parseDotenv(fs.readFileSync(filePath, "utf8"), filePath);
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Environment key was not found: ${key}`);
  return { key, value: entry.value, sourceFile: filePath };
}

function updateEnvValueOnDisk(input, options = {}) {
  const fs = options.fs || require("node:fs");
  const key = String(input?.key || "");
  const value = String(input?.value ?? "");
  if (!key) throw new Error("Environment key is required.");
  const { filePath } = resolveProjectEnvFile(input, options, "edited");
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.split(/\r?\n/);
  let changed = false;
  const next = lines.map((line) => {
    const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/.exec(line);
    if (!match || match[2] !== key) return line;
    changed = true;
    return `${match[1]}${match[2]}${match[3]}${formatDotenvValue(value, match[4])}`;
  });
  if (!changed) throw new Error(`Environment key was not found: ${key}`);
  fs.writeFileSync(filePath, next.join("\n"), "utf8");
  return { key, value: redactValue(value), sourceFile: filePath };
}

function resolveProjectEnvFile(input, options = {}, action = "used") {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(input?.projectPath, { home, path });
  const requestedPath = path.resolve(String(input?.filePath || ""));
  const stat = fs.lstatSync(requestedPath);
  if (stat.isSymbolicLink()) throw new Error("Environment file cannot be a symlink.");
  if (!stat.isFile()) throw new Error("Environment path must be a file.");
  const realProjectPath = fs.realpathSync(projectPath);
  const realFilePath = fs.realpathSync(requestedPath);
  const relative = path.relative(realProjectPath, realFilePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Environment file must be inside the project.");
  if (!isSupportedEnvFileName(path.basename(requestedPath))) throw new Error(`Only project .env files can be ${action}.`);
  return { projectPath: realProjectPath, filePath: realFilePath };
}

function formatDotenvValue(value, previousRaw = "") {
  const trimmed = String(previousRaw || "").trim();
  const quote = trimmed.startsWith("'") ? "'" : trimmed.startsWith('"') ? '"' : "";
  if (quote === "'") return `'${String(value).replace(/'/g, "\\'")}'`;
  if (quote === '"') return `"${String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')}"`;
  if (/[\s#"'\\\n]/.test(value)) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function readSupabaseBinding(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  try {
    const configPath = path.join(projectPathInput, ".codex", "config.toml");
    const binding = parseSupabaseConfigToml(fs.readFileSync(configPath, "utf8"));
    return binding ? { ...binding, configPath } : null;
  } catch {
    return null;
  }
}

function parseSupabaseConfigToml(content) {
  const block = findTomlTableBlock(String(content || ""), "mcp_servers.supabase");
  if (!block) return null;
  const url = tomlStringValue(block.body, "url");
  const bearerTokenEnvVar = tomlStringValue(block.body, "bearer_token_env_var");
  let projectRef = "";
  let features = [];
  if (url) {
    try {
      const parsed = new URL(url);
      projectRef = parsed.searchParams.get("project_ref") || "";
      features = (parsed.searchParams.get("features") || "").split(",").map((value) => value.trim()).filter(Boolean);
    } catch {}
  }
  return { url, projectRef, bearerTokenEnvVar, features };
}

function upsertSupabaseConfigToml(content, profileInput) {
  const profile = normalizeSupabaseProfile(profileInput);
  const block = formatSupabaseTomlBlock(profile);
  const text = String(content || "").replace(/\s+$/g, "");
  const existing = findTomlTableBlock(text, "mcp_servers.supabase");
  if (!existing) return `${text ? `${text}\n\n` : ""}${block}\n`;
  return `${text.slice(0, existing.start).replace(/\s+$/g, "")}\n\n${block}\n\n${text.slice(existing.end).replace(/^\s+/g, "")}`.replace(/\n{3,}/g, "\n\n");
}

function formatSupabaseTomlBlock(profile) {
  const query = [`project_ref=${encodeURIComponent(profile.projectRef)}`];
  if (profile.features.length) query.push(`features=${profile.features.map((feature) => encodeURIComponent(feature)).join(",")}`);
  const url = `https://mcp.supabase.com/mcp?${query.join("&")}`;
  return [
    "[mcp_servers.supabase]",
    `url = "${escapeTomlString(url)}"`,
    `bearer_token_env_var = "${escapeTomlString(profile.bearerTokenEnvVar)}"`,
  ].join("\n");
}

function findTomlTableBlock(content, tableName) {
  const header = `[${tableName}]`;
  const start = content.indexOf(header);
  if (start < 0) return null;
  const rest = content.slice(start + header.length);
  const nextMatch = /\n\[[^\]]+\]/.exec(rest);
  const end = nextMatch ? start + header.length + nextMatch.index + 1 : content.length;
  return {
    start,
    end,
    body: content.slice(start + header.length, end),
  };
}

function tomlStringValue(blockBody, key) {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*$`, "m").exec(blockBody);
  if (!match) return "";
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function normalizeSupabaseProfile(input) {
  const name = String(input?.name || "").trim();
  const projectRef = String(input?.projectRef || "").trim();
  const bearerTokenEnvVar = String(input?.bearerTokenEnvVar || "").trim();
  const features = normalizeFeatureList(input?.features);
  if (!name) throw new Error("Supabase profile name is required.");
  if (!projectRef) throw new Error("Supabase project ref is required.");
  if (!bearerTokenEnvVar) throw new Error("Supabase bearer token env var is required.");
  return {
    id: String(input?.id || slugify(`${name}-${projectRef}`)).trim(),
    name,
    projectRef,
    bearerTokenEnvVar,
    features,
    updatedAt: new Date().toISOString(),
  };
}

function isSupabaseProfile(profile) {
  return Boolean(profile && typeof profile.id === "string" && typeof profile.name === "string" && typeof profile.projectRef === "string");
}

function normalizeFeatureList(input) {
  const values = Array.isArray(input) ? input : String(input || "").split(",");
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function projectLabel(projectPath, path) {
  return projectPath.startsWith("codex-sidebar://") ? projectPath.replace("codex-sidebar://", "") : path.basename(projectPath);
}

function projectColorKeyForProject(project, overview) {
  return normalizeProjectColorKey(overview?.projectColorKey || project?.name || project?.projectPath);
}

function projectColorOption(colorId) {
  return PROJECT_COLOR_OPTIONS.find((option) => option.id === colorId) || PROJECT_COLOR_OPTIONS[0];
}

function slugify(value) {
  return String(value || "profile")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "profile";
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTomlString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function startRenderer(api, cleanup) {
  const projectScan = startSidebarProjectScanner(api);
  cleanup.push(projectScan);
  const projectReorder = startSidebarProjectReorder(api);
  cleanup.push(projectReorder);
  const projectPageHandles = new Map();

  if (typeof api.settings?.registerPage !== "function") {
    api.log?.warn?.("[projects] registerPage unavailable; settings UI not mounted.");
    return;
  }

  const handle = api.settings.registerPage({
    id: "main",
    title: "Projects",
    groupTitle: "Projects",
    parentPage: true,
    description: "Assign project connections and inspect redacted .env inventory.",
    iconSvg:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h3l1.2 1.5h6.8A1.5 1.5 0 0 1 17 6v8.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-10Z" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
      '<path d="M6 8h8M6 11h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      "</svg>",
    render(root) {
      renderProjectsPage(root, api);
    },
  });
  if (handle && typeof handle.dispose === "function") cleanup.push(() => handle.dispose());
  if (handle && typeof handle.unregister === "function") cleanup.push(() => handle.unregister());
  cleanup.push(() => {
    for (const childHandle of projectPageHandles.values()) unregisterSettingsHandle(childHandle);
    projectPageHandles.clear();
  });
  syncProjectSettingsPages(api, projectPageHandles);
  const pageSyncTimer = setInterval(() => syncProjectSettingsPages(api, projectPageHandles), 4000);
  cleanup.push(() => clearInterval(pageSyncTimer));
}

async function syncProjectSettingsPages(api, handles) {
  try {
    const projects = await api.ipc.invoke("listProjects");
    const wanted = new Set();
    for (const project of projects) {
      const pageId = `project-${slugify(project.name || project.projectPath)}`;
      wanted.add(pageId);
      if (handles.has(pageId)) continue;
      const handle = api.settings.registerPage({
        id: pageId,
        title: project.name,
        groupTitle: "Projects",
        description: project.projectPath,
        iconSvg:
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
          '<path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h3l1.2 1.5H15A1.5 1.5 0 0 1 16.5 7v7A1.5 1.5 0 0 1 15 15.5H5A1.5 1.5 0 0 1 3.5 14v-8.5Z" stroke="currentColor" stroke-width="1.5"/>' +
          "</svg>",
        render(root) {
          renderProjectSettingsPage(root, api, project);
        },
      });
      handles.set(pageId, handle);
    }
    for (const [pageId, handle] of handles) {
      if (wanted.has(pageId)) continue;
      unregisterSettingsHandle(handle);
      handles.delete(pageId);
    }
  } catch (error) {
    api.log?.warn?.("[projects] failed to sync project settings pages", error?.message || String(error));
  }
}

function unregisterSettingsHandle(handle) {
  try {
    if (handle && typeof handle.unregister === "function") handle.unregister();
    else if (handle && typeof handle.dispose === "function") handle.dispose();
  } catch {}
}

async function renderProjectsPage(root, api) {
  root.innerHTML = "";
  root.className = "shadgpt-projects-settings";
  const styles = document.createElement("style");
  styles.textContent = projectsCss();
  root.appendChild(styles);

  const frame = el("div", "projects-frame");
  frame.appendChild(sectionTitle("Projects", "Select a project sub-page in the Settings sidebar to edit its connections and environment fields."));
  const chromeHeaderSlot = el("div", "projects-header-chrome-status", "Loading Chrome profile assignments...");
  frame.appendChild(chromeHeaderSlot);
  frame.appendChild(envScanTimeoutSettings(api));
  const chromeHealthSlot = el("div");
  frame.appendChild(chromeHealthSlot);
  const status = el("div", "projects-status", "Loading projects...");
  frame.appendChild(status);
  const list = el("div", "projects-accordion");
  list.dataset.projectsAccordion = "true";
  frame.appendChild(list);
  root.appendChild(frame);

  try {
    const [projects, chromeProfiles, googleWorkspaceAccounts, modalWorkspaceAccounts, decodoAccounts, supabaseProfiles] = await Promise.all([
      api.ipc.invoke("listProjects"),
      api.ipc.invoke("listChromeProfiles"),
      api.ipc.invoke("listGoogleWorkspaceAccounts"),
      api.ipc.invoke("listModalWorkspaceAccounts"),
      api.ipc.invoke("listDecodoAccounts"),
      api.ipc.invoke("listSupabaseProfiles"),
    ]);
    status.textContent = projects.length ? `${projects.length} sidebar projects found` : "No Codex sidebar projects found yet.";
    renderProjectsChromeHeaderStatus(chromeHeaderSlot, projects, api);
    chromeHealthSlot.replaceWith(chromeHealthDashboard(projects, api));
    list.innerHTML = "";
    for (const project of projects) {
      list.appendChild(projectSummaryCard(project, { api, chromeProfiles, googleWorkspaceAccounts, modalWorkspaceAccounts, decodoAccounts, supabaseProfiles }));
    }
  } catch (error) {
    status.textContent = error?.message || "Projects failed to load.";
    status.classList.add("is-error");
  }
}

async function renderProjectSettingsPage(root, api, project) {
  root.innerHTML = "";
  root.className = "shadgpt-projects-settings";
  const styles = document.createElement("style");
  styles.textContent = projectsCss();
  root.appendChild(styles);
  const frame = el("div", "projects-frame");
  const status = el("div", "projects-status", "Loading project fields...");
  frame.appendChild(status);
  root.appendChild(frame);
  try {
    const [overview, chromeProfiles, googleWorkspaceAccounts, modalWorkspaceAccounts, decodoAccounts, supabaseProfiles] = await Promise.all([
      api.ipc.invoke("getProjectOverview", project),
      api.ipc.invoke("listChromeProfiles"),
      api.ipc.invoke("listGoogleWorkspaceAccounts"),
      api.ipc.invoke("listModalWorkspaceAccounts"),
      api.ipc.invoke("listDecodoAccounts"),
      api.ipc.invoke("listSupabaseProfiles"),
    ]);
    status.remove();
    frame.appendChild(projectPanel(project, overview, { api, chromeProfiles, googleWorkspaceAccounts, modalWorkspaceAccounts, decodoAccounts, supabaseProfiles }));
  } catch (error) {
    status.textContent = error?.message || "Project failed to load.";
    status.classList.add("is-error");
  }
}

function projectSummaryCard(project, context) {
  const wrap = el("div", "project-card");
  const row = el("div", "project-summary");
  const chips = appendProjectSummary(row, project);
  setChips(chips, null);
  context.api.ipc.invoke("getProjectOverview", project)
    .then((overview) => setChips(chips, overview))
    .catch(() => {});
  wrap.appendChild(row);
  return wrap;
}

function projectAccordionRow(project, context) {
  const wrap = el("div", "project-card");
  const button = el("button", "project-summary");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  const chips = appendProjectSummary(button, project);
  const panel = el("div", "project-panel");
  panel.hidden = true;
  wrap.append(button, panel);

  setChips(chips, null);

  button.addEventListener("click", async () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    panel.hidden = expanded;
    if (!expanded && !panel.dataset.loaded) {
      panel.textContent = "Loading project...";
      try {
        const overview = await context.api.ipc.invoke("getProjectOverview", project);
        panel.dataset.loaded = "true";
        setChips(chips, overview);
        panel.replaceChildren(projectPanel(project, overview, context));
      } catch (error) {
        panel.textContent = error?.message || "Project failed to load.";
      }
    }
  });

  return wrap;
}

function setChips(target, overview) {
  const envSummary = target.dataset.projectEnvSummary || "load";
  const values = overview
    ? [
        chromeRoutingProjectChip(overview),
        gitHubProjectChip(overview),
        ["Gmail", overview.googleWorkspaceAssignments?.gmail ? "set" : "unset"],
        ["Drive", overview.googleWorkspaceAssignments?.["google-drive"] ? "set" : "unset"],
        modalWorkspaceProjectChip(overview),
        ["Decodo", overview.decodoAssignment ? "set" : "unset"],
        ["Supabase", overview.supabaseBinding ? "set" : "unset"],
        agentsInstructionProjectChip(overview),
        chromeVerifierProjectChip(overview),
        ["Env", envSummary, null, envSummary === "load" ? "is-muted" : "", "env"],
      ].filter(Boolean)
    : [["Chrome", "..."], ["Gmail", "..."], ["Drive", "..."], ["Modal", "..."], ["Decodo", "..."], ["Supabase", "..."], ["AGENTS", "..."], ["Chrome Check", "..."], ["Env", envSummary, null, "is-muted", "env"]];
  target.replaceChildren(...values.map((value) => {
    const [label, chipValue, href, extraClass, kind] = value;
    const chip = el(
      href ? "a" : "span",
      `status-chip ${chipValue === "unset" ? "is-danger" : ""} ${extraClass || ""}`.trim(),
      `${label}: ${chipValue}`,
    );
    if (kind === "env") chip.dataset.projectEnvChip = "true";
    if (href) {
      chip.href = href;
      chip.target = "_blank";
      chip.rel = "noreferrer";
      chip.title = `Open ${chipValue}`;
    }
    return chip;
  }));
}

function gitHubProjectChip(overview) {
  const repo = overview.gitRepositories?.[0];
  if (!repo) return null;
  return ["GitHub", repo.fullName, repo.url];
}

function chromeRoutingProjectChip(overview) {
  const routing = overview.chromeRouting || null;
  if (!routing?.profileDirectory) return ["Chrome", "unset"];
  const label = String(routing.profileName || routing.profileDirectory || "set").trim() || "set";
  return ["Chrome", routing.source === "default" ? `${label} default` : label, null, routing.source === "default" ? "is-muted" : ""];
}

function modalWorkspaceProjectChip(overview) {
  const assignment = overview.modalWorkspaceAssignment || null;
  if (!assignment) return ["Modal", "unset"];
  const workspace = String(assignment.workspace || assignment.profile || "set").trim() || "set";
  return ["Modal", workspace, null, overview.modalWorkspaceConflict ? "is-warning" : ""];
}

function agentsInstructionProjectChip(overview) {
  if (overview.agentsInstructionWritesDisabled) return ["AGENTS", "off", null, "is-warning"];
  const count = Number(overview.agentsInstructionPreview?.connectionCount || 0);
  return ["AGENTS", count ? `${count} set` : "empty", null, count ? "" : "is-muted"];
}

function chromeVerifierProjectChip(overview) {
  const result = overview.chromeVerifierLastResult || null;
  if (!result) return ["Chrome Check", "not run", null, "is-muted"];
  const sections = result.sections || {};
  const ok = sections.profile && sections.extension && sections.backend && sections.locks;
  const age = compactVerifierAge(result.checkedAt);
  return ["Chrome Check", `${ok ? "ok" : "fix"} ${age}`.trim(), null, ok ? "" : "is-warning"];
}

function compactVerifierAge(checkedAt) {
  const timestamp = Date.parse(String(checkedAt || ""));
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  try {
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "unknown";
  }
}

function projectPanel(project, overview, context) {
  const wrap = el("div", "panel-stack");
  wrap.appendChild(connectionRows(project, overview, context));
  wrap.appendChild(lazyEnvInventoryView(project, context.api));
  return wrap;
}

function envScanTimeoutSettings(api) {
  const card = el("div", "settings-card compact-settings-card");
  const row = settingRow("Env Scan Timeout", "Controls how long Projects waits before showing the .env retry action.");
  const control = row.querySelector(".row-control");
  const inputNode = input("8000", String(Math.round(rendererProjectEnvScanTimeoutMs / 1000)));
  inputNode.type = "number";
  inputNode.min = String(MIN_PROJECT_ENV_SCAN_TIMEOUT_MS / 1000);
  inputNode.max = String(MAX_PROJECT_ENV_SCAN_TIMEOUT_MS / 1000);
  inputNode.step = "1";
  inputNode.setAttribute("aria-label", "Env scan timeout in seconds");
  const unit = el("span", "inline-help", "seconds");
  const status = el("span", "inline-help", "");
  const save = actionButton("Save", async () => {
    const timeoutMs = normalizeProjectEnvScanTimeout(Number(inputNode.value) * 1000);
    const saved = await api.ipc.invoke("saveProjectEnvScanTimeout", timeoutMs);
    rendererProjectEnvScanTimeoutMs = normalizeProjectEnvScanTimeout(saved);
    inputNode.value = String(Math.round(rendererProjectEnvScanTimeoutMs / 1000));
    status.textContent = "Saved";
    save.textContent = "Saved";
  });
  control.append(inputNode, unit, save, status);
  card.appendChild(row);
  api.ipc.invoke("getProjectEnvScanTimeout")
    .then((timeoutMs) => {
      rendererProjectEnvScanTimeoutMs = normalizeProjectEnvScanTimeout(timeoutMs);
      inputNode.value = String(Math.round(rendererProjectEnvScanTimeoutMs / 1000));
    })
    .catch(() => {});
  return card;
}

function renderProjectsChromeHeaderStatus(target, projects, api) {
  const loading = target;
  loading.className = "projects-header-chrome-status";
  loading.textContent = "Loading Chrome profile assignments...";
  Promise.all((projects || []).map((project) => api.ipc.invoke("getProjectOverview", project)))
    .then((overviews) => {
      loading.replaceChildren(projectsChromeHeaderStatus(overviews));
    })
    .catch((error) => {
      loading.textContent = error?.message || "Chrome profile assignments failed to load.";
      loading.classList.add("is-error");
    });
}

function projectsChromeHeaderStatus(overviews) {
  const wrap = el("div", "projects-header-chrome-inner");
  const assigned = [];
  const defaults = [];
  const unset = [];
  for (const overview of overviews || []) {
    const routing = overview.chromeRouting || {};
    if (!routing.profileDirectory) unset.push(overview);
    else if (routing.source === "default") defaults.push(overview);
    else assigned.push(overview);
  }
  const copy = `${assigned.length} project-specific, ${defaults.length} using default, ${unset.length} unset`;
  wrap.append(
    profileFavicon("chrome.google.com", "Chrome"),
    twoLineText("Chrome Profiles", copy, "projects-header-chrome-copy"),
  );
  const chips = el("span", "project-chips projects-header-chrome-chips");
  const chipValues = [
    ["Project", assigned.length, assigned.length ? "" : "is-muted"],
    ["Default", defaults.length, defaults.length ? "is-muted" : "is-muted"],
    ["Unset", unset.length, unset.length ? "is-danger" : "is-muted"],
  ];
  chips.replaceChildren(...chipValues.map(([label, value, extraClass]) => {
    const chip = el("span", `status-chip ${extraClass || ""}`.trim(), `${label}: ${value}`);
    return chip;
  }));
  wrap.appendChild(chips);
  return wrap;
}

function chromeHealthDashboard(projects, api) {
  const card = el("div", "settings-card chrome-health-card");
  card.dataset.chromeHealthDashboard = "true";
  const header = sectionTitle("Chrome Health", "Global profile routing, verifier recency, and native backend status across projects.");
  const actions = el("div", "agents-preview-actions");
  const status = el("span", "inline-help", "Loading Chrome health...");
  const rows = el("div", "connection-detail-list chrome-health-rows");
  const renderRows = (overviews) => {
    rows.innerHTML = "";
    if (!overviews.length) {
      rows.appendChild(el("div", "connection-detail-empty", "No projects available."));
      status.textContent = "No projects available";
      return;
    }
    for (const overview of overviews) rows.appendChild(chromeHealthDashboardRow(overview));
    const failing = overviews.filter((overview) => !chromeVerifierOk(overview.chromeVerifierLastResult)).length;
    status.textContent = failing
      ? `${failing} project${failing === 1 ? "" : "s"} need Chrome attention`
      : "All saved Chrome checks are ok";
  };
  const load = () => Promise.all((projects || []).map((project) => api.ipc.invoke("getProjectOverview", project)))
    .then(renderRows)
    .catch((error) => {
      status.textContent = error?.message || "Chrome health failed to load.";
      status.classList.add("is-error");
    });
  const runAll = actionButton("Run all Chrome checks", async () => {
    status.textContent = "Running Chrome checks...";
    const overviews = [];
    for (const project of projects || []) {
      await api.ipc.invoke("runChromeRoutingVerifier", {
        projectPath: project.projectPath,
        projectName: project.name,
      });
      overviews.push(await api.ipc.invoke("getProjectOverview", project));
    }
    renderRows(overviews);
  }, "secondary");
  actions.append(runAll, status);
  card.append(header, actions, rows);
  load();
  return card;
}

function chromeHealthDashboardRow(overview) {
  const item = el("div", "connection-detail-item chrome-health-row");
  const result = overview.chromeVerifierLastResult || null;
  const ok = chromeVerifierOk(result);
  const routing = overview.chromeRouting || {};
  const projectName = overview.projectPath?.split(/[\\/]/).filter(Boolean).pop() || "Project";
  const profile = routing.profileName || routing.profileDirectory || "unset";
  const check = result ? `${ok ? "ok" : "fix"} ${compactVerifierAge(result.checkedAt)}` : "not run";
  item.append(
    profileFavicon("chrome.google.com", "Chrome"),
    twoLineText(projectName, `${profile} - Chrome Check: ${check}`),
  );
  if (!ok) item.classList.add("is-warning");
  return item;
}

function chromeVerifierOk(result) {
  const sections = result?.sections || {};
  return Boolean(sections.profile && sections.extension && sections.backend && sections.locks);
}

function connectionRows(project, overview, context) {
  const card = el("div", "settings-card");
  card.appendChild(sectionTitle("Connections", "Editable project assignments."));
  card.appendChild(projectColorRow(project, overview, context));
  card.appendChild(agentsInstructionWriteRow(project, overview, context));
  card.appendChild(agentsInstructionPreviewPanel(project, overview, context));
  card.appendChild(chromeConnectionRow(project, overview, context));
  card.appendChild(chromeRoutingVerifierRow(project, overview, context));
  card.appendChild(gitHubMetadataRow(overview));
  card.appendChild(googleWorkspaceConnectionRow("gmail", project, overview, context));
  card.appendChild(googleWorkspaceConnectionRow("google-drive", project, overview, context));
  card.appendChild(modalWorkspaceConnectionRow(project, overview, context));
  card.appendChild(decodoConnectionRow(project, overview, context));
  card.appendChild(supabaseConnectionRow(project, overview, context));
  return card;
}

function agentsInstructionWriteRow(project, overview, context) {
  const row = settingRow("AGENTS.md Updates", "Writes this project's plugin account defaults into its managed AGENTS.md block.");
  const label = el("label", "toggle-option");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !overview.agentsInstructionWritesDisabled;
  const status = el("span", "inline-help", checkbox.checked ? "Enabled" : "Disabled");
  label.append(checkbox, twoLineText("Update AGENTS.md on save", "Disable this only when project instructions are managed somewhere else."));
  checkbox.addEventListener("change", async () => {
    const result = await context.api.ipc.invoke("setAgentsInstructionWritePreference", {
      projectPath: project.projectPath,
      projectName: project.name,
      disabled: !checkbox.checked,
    });
    status.textContent = checkbox.checked
      ? agentsInstructionStatusText(result.agentsInstruction)
      : "AGENTS.md writes disabled";
    refreshAgentsPreview(project, context.api);
  });
  const pluginToggles = el("div", "agents-plugin-toggle-list");
  const disabledPlugins = new Set(overview.agentsInstructionPluginWriteDisabled || []);
  for (const plugin of agentsPluginToggleOptions()) {
    const pluginLabel = el("label", "toggle-option compact-toggle-option");
    const pluginCheckbox = document.createElement("input");
    pluginCheckbox.type = "checkbox";
    pluginCheckbox.checked = !disabledPlugins.has(plugin.id);
    pluginLabel.append(pluginCheckbox, twoLineText(plugin.label, plugin.description));
    pluginCheckbox.addEventListener("change", async () => {
      const result = await context.api.ipc.invoke("setAgentsInstructionPluginWritePreference", {
        projectPath: project.projectPath,
        projectName: project.name,
        pluginId: plugin.id,
        disabled: !pluginCheckbox.checked,
      });
      status.textContent = pluginCheckbox.checked
        ? `${plugin.label} writes enabled`
        : `${plugin.label} writes disabled`;
      updateAgentsPreviewNode(project, result.preview);
    });
    pluginToggles.appendChild(pluginLabel);
  }
  row.querySelector(".row-control").append(label, pluginToggles, status);
  return row;
}

function agentsInstructionPreviewPanel(project, overview, context) {
  const row = settingRow("AGENTS.md Preview", "Shows the managed plugin profile block Project Settings will write.");
  const details = el("details", "agents-preview-panel");
  const summary = el("summary", "", "Preview managed block");
  const preview = el("pre", "agents-preview-text", agentsPreviewText(overview.agentsInstructionPreview));
  preview.dataset.agentsPreviewPath = project.projectPath;
  const status = el("span", "inline-help", "");
  const refresh = actionButton("Refresh", async () => {
    const next = await context.api.ipc.invoke("previewProjectAgentsInstruction", {
      projectPath: project.projectPath,
      projectName: project.name,
    });
    updateAgentsPreviewNode(project, next);
    status.textContent = "Preview refreshed";
  }, "secondary");
  const repair = actionButton("Repair", async () => {
    const result = await context.api.ipc.invoke("repairProjectAgentsInstruction", {
      projectPath: project.projectPath,
      projectName: project.name,
    });
    updateAgentsPreviewNode(project, result.preview);
    status.textContent = [
      agentsInstructionStatusText(result.agentsInstruction),
      chromeVerifierStatusText(result.chromeVerifier),
    ].filter(Boolean).join("; ");
  });
  details.append(summary, preview, el("div", "agents-preview-actions", refresh, repair, status));
  row.querySelector(".row-control").append(details);
  return row;
}

function agentsPreviewText(preview) {
  if (preview?.writesDisabled) return "AGENTS.md writes are disabled for this project.";
  return preview?.blockText || "No plugin account defaults are currently selected for this project's managed AGENTS.md block.";
}

function updateAgentsPreviewNode(project, preview) {
  const selector = `[data-agents-preview-path="${cssEscape(project.projectPath)}"]`;
  for (const node of document.querySelectorAll(selector)) node.textContent = agentsPreviewText(preview);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function refreshAgentsPreview(project, api) {
  api.ipc.invoke("previewProjectAgentsInstruction", {
    projectPath: project.projectPath,
    projectName: project.name,
  })
    .then((preview) => updateAgentsPreviewNode(project, preview))
    .catch(() => {});
}

function agentsPluginToggleOptions() {
  return [
    { id: "chrome", label: "Chrome", description: "Chrome profile block" },
    { id: "gmail", label: "Gmail", description: "Gmail account block" },
    { id: "google-drive", label: "Drive", description: "Google Drive account block" },
    { id: "modal-platform", label: "Modal", description: "Modal workspace block" },
    { id: "supabase", label: "Supabase", description: "Supabase project block" },
    { id: "decodo", label: "Decodo", description: "Decodo account block" },
  ];
}

function projectColorRow(project, overview, context) {
  const row = settingRow("Sidebar Color", "Controls this project's folder and chat-row color in the main sidebar.");
  const key = projectColorKeyForProject(project, overview);
  const selected = normalizeProjectColorId(overview.projectColor);
  const selectedOverlay = normalizeProjectOverlayIntensity(overview.projectOverlayIntensity);
  const group = el("div", "color-grid");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `${project.name} sidebar color`);
  for (const option of PROJECT_COLOR_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch";
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    button.setAttribute("aria-pressed", String(option.id === selected));
    button.style.setProperty("--project-swatch", option.value);
    button.appendChild(el("span", "swatch-dot"));
    button.addEventListener("click", async () => {
      await context.api.ipc.invoke("saveProjectColor", {
        projectKey: key,
        projectName: project.name,
        colorId: option.id,
      });
      for (const item of group.querySelectorAll(".color-swatch")) item.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      window.dispatchEvent(new CustomEvent(PROJECT_COLOR_EVENT, { detail: { projectKey: key, colorId: option.id } }));
    });
    group.appendChild(button);
  }
  const overlayGroup = el("div", "overlay-segmented");
  overlayGroup.setAttribute("role", "group");
  overlayGroup.setAttribute("aria-label", `${project.name} chat row overlay`);
  for (const option of PROJECT_OVERLAY_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overlay-segment";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(option.id === selectedOverlay));
    button.addEventListener("click", async () => {
      await context.api.ipc.invoke("saveProjectOverlay", {
        projectKey: key,
        projectName: project.name,
        overlayIntensity: option.id,
      });
      for (const item of overlayGroup.querySelectorAll(".overlay-segment")) item.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      window.dispatchEvent(new CustomEvent(PROJECT_COLOR_EVENT, { detail: { projectKey: key, overlayIntensity: option.id } }));
    });
    overlayGroup.appendChild(button);
  }
  const control = row.querySelector(".row-control");
  control.append(group, overlayGroup);
  return row;
}

function chromeConnectionRow(project, overview, context) {
  const row = settingRow("Chrome Profile", "Uses the existing Plugin Profiles assignment store.");
  const selected = new Set(overview.chromeAssignment?.preferencesPaths || []);
  const dropdown = el("details", "profile-dropdown");
  const summary = el("summary", "profile-dropdown-summary");
  const summaryText = el("span", "profile-dropdown-text");
  const menu = el("div", "profile-dropdown-menu");
  const checks = [];
  const updateSummary = () => {
    const picked = checks.filter((checkbox) => checkbox.checked);
    if (!picked.length) {
      summaryText.textContent = "Select Chrome profiles";
      return;
    }
    summaryText.textContent = picked.length === 1
      ? picked[0].dataset.profileLabel
      : `${picked.length} Chrome profiles selected`;
  };
  for (const profile of context.chromeProfiles) {
    const label = chromeProfileLabel(profile);
    const option = el("label", "profile-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = profile.preferencesPath;
    checkbox.checked = selected.has(profile.preferencesPath);
    checkbox.dataset.profileLabel = label;
    checkbox.addEventListener("change", updateSummary);
    checks.push(checkbox);
    option.append(checkbox, profileAvatar(profile), twoLineText(label, profile.email || "No email found", "profile-option-copy"));
    menu.appendChild(option);
  }
  if (!context.chromeProfiles.length) menu.appendChild(el("div", "empty-state", "No Chrome profiles found."));
  summary.append(profileFavicon("chrome.google.com", "Chrome"), summaryText);
  dropdown.append(summary, menu);
  updateSummary();
  const save = actionButton("Save", async () => {
    const result = await context.api.ipc.invoke("saveChromeAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
      preferencesPaths: checks.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value),
    });
    save.textContent = "Saved";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
    const verifier = await runProjectChromeVerifier(project, context.api);
    instructionStatus.textContent = [agentsInstructionStatusText(result?.agentsInstruction), chromeVerifierStatusText(verifier)].filter(Boolean).join("; ");
  });
  const clear = actionButton("Clear", async () => {
    const result = await context.api.ipc.invoke("clearChromeAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
    });
    for (const checkbox of checks) checkbox.checked = false;
    updateSummary();
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
    const verifier = await runProjectChromeVerifier(project, context.api);
    instructionStatus.textContent = [agentsInstructionStatusText(result?.agentsInstruction), chromeVerifierStatusText(verifier)].filter(Boolean).join("; ");
  }, "secondary");
  const instructionStatus = el("span", "inline-help", "");
  row.querySelector(".row-control").append(dropdown, chromeRoutingDetail(overview.chromeRouting), save, clear, instructionStatus);
  return row;
}

function chromeRoutingVerifierRow(project, overview, context) {
  const row = settingRow("Chrome Routing Verifier", "Checks profile routing, extension readiness, native backend, and stale shared locks.");
  const status = el("span", "inline-help", overview.chromeVerifierLastResult ? chromeVerifierStatusText(overview.chromeVerifierLastResult) : "");
  const output = el("pre", "agents-preview-text chrome-verifier-output", overview.chromeVerifierLastResult ? chromeVerifierDetailsText(overview.chromeVerifierLastResult) : "Verifier has not run yet.");
  const history = el("div", "connection-detail-list chrome-verifier-history");
  status.dataset.chromeVerifierStatusPath = project.projectPath;
  output.dataset.chromeVerifierOutputPath = project.projectPath;
  history.dataset.chromeVerifierHistoryPath = project.projectPath;
  renderChromeVerifierHistory(history, overview.chromeVerifierHistory || []);
  const run = actionButton("Run verifier", async () => {
    await runProjectChromeVerifier(project, context.api);
  });
  const repairLocks = actionButton("Repair stale locks", async () => {
    const result = await context.api.ipc.invoke("repairChromeSharedLocks", {
      projectPath: project.projectPath,
      projectName: project.name,
    });
    updateChromeVerifierNodes(project, result.verifier, `${result.repair?.removed?.length || 0} stale locks removed; `);
    refreshChromeVerifierHistory(project, context.api);
  }, "secondary");
  row.querySelector(".row-control").append(run, repairLocks, status, nativeHostRepairGuidance(), output, history);
  return row;
}

async function runProjectChromeVerifier(project, api) {
  const result = await api.ipc.invoke("runChromeRoutingVerifier", {
    projectPath: project.projectPath,
    projectName: project.name,
  });
  updateChromeVerifierNodes(project, result);
  refreshChromeVerifierHistory(project, api);
  return result;
}

function updateChromeVerifierNodes(project, result, prefix = "") {
  const statusSelector = `[data-chrome-verifier-status-path="${cssEscape(project.projectPath)}"]`;
  const outputSelector = `[data-chrome-verifier-output-path="${cssEscape(project.projectPath)}"]`;
  for (const node of document.querySelectorAll(statusSelector)) {
    node.textContent = `${prefix}${chromeVerifierStatusText(result)}`;
  }
  for (const node of document.querySelectorAll(outputSelector)) {
    node.textContent = chromeVerifierDetailsText(result);
  }
}

function refreshChromeVerifierHistory(project, api) {
  api.ipc.invoke("getProjectOverview", project)
    .then((overview) => {
      const selector = `[data-chrome-verifier-history-path="${cssEscape(project.projectPath)}"]`;
      for (const node of document.querySelectorAll(selector)) renderChromeVerifierHistory(node, overview.chromeVerifierHistory || []);
    })
    .catch(() => {});
}

function renderChromeVerifierHistory(target, history) {
  target.innerHTML = "";
  const recent = Array.isArray(history) ? history.slice(-5).reverse() : [];
  if (!recent.length) {
    target.appendChild(el("div", "connection-detail-empty", "No Chrome verifier history yet."));
    return;
  }
  target.appendChild(el("div", "connection-detail-empty", "Recent Chrome checks"));
  for (const result of recent) {
    const item = el("div", `connection-detail-item ${chromeVerifierOk(result) ? "" : "is-warning"}`.trim());
    item.append(
      profileFavicon("chrome.google.com", "Chrome Check"),
      twoLineText(
        `${chromeVerifierOk(result) ? "OK" : "Fix"} - ${compactVerifierAge(result.checkedAt)}`,
        result.summary || chromeVerifierStatusText(result),
      ),
    );
    target.appendChild(item);
  }
}

function nativeHostRepairGuidance() {
  const wrap = el("div", "connection-detail-empty native-host-repair-links");
  wrap.append(
    document.createTextNode("Native backend fix: open "),
    linkNode("plugin://chrome@openai-bundled", "@Chrome plugin settings"),
    document.createTextNode(", choose Reinstall or Repair, then rerun this verifier. Extension fix: open "),
    linkNode("chrome://extensions/", "Chrome Extensions"),
    document.createTextNode(" and enable the Codex Chrome Extension in the selected profile."),
  );
  return wrap;
}

function linkNode(href, text) {
  const node = document.createElement("a");
  node.href = href;
  node.textContent = text;
  node.rel = "noreferrer";
  return node;
}

function chromeVerifierStatusText(result) {
  if (!result) return "";
  if (result.summary) return `Chrome verifier: ${result.summary}`;
  const sections = result.sections || {};
  const ok = sections.profile && sections.extension && sections.backend && sections.locks;
  return ok ? "Chrome verifier: all checks ok" : "Chrome verifier: action needed";
}

function chromeVerifierDetailsText(result) {
  if (!result) return "No Chrome verifier result.";
  const lines = [
    `Checked: ${result.checkedAt ? `${new Date(result.checkedAt).toLocaleString()} (${compactVerifierAge(result.checkedAt)})` : "not saved"}`,
    `Default: ${result.routing?.default?.profileName || "unset"} (${result.routing?.default?.profileDirectory || "none"})`,
    `TRR: ${result.routing?.trr?.profileName || "unset"} (${result.routing?.trr?.profileDirectory || "none"})`,
  ];
  if (result.routing?.project) {
    lines.push(`Project: ${result.routing.project.profileName || "unset"} (${result.routing.project.profileDirectory || "none"})`);
  }
  lines.push(`Profile routing: ${result.sections?.profile ? "ok" : "problem"}`);
  lines.push(`Extension selected profiles: ${result.sections?.extension ? "ok" : "problem"}`);
  lines.push(`Native backend: ${result.sections?.backend ? "ok" : "problem"}`);
  lines.push(`Shared locks: ${result.sections?.locks ? "ok" : "problem"}`);
  lines.push("");
  lines.push("Next fixes:");
  for (const fix of result.fixes || []) lines.push(`- ${fix.section}: ${fix.action}`);
  if (!result.sections?.backend) {
    lines.push("");
    lines.push("Native-host repair links:");
    lines.push("- @Chrome plugin settings: plugin://chrome@openai-bundled");
    lines.push("- Chrome Extensions: chrome://extensions/");
  }
  return lines.join("\n");
}

function chromeRoutingDetail(routing) {
  if (!routing?.profileDirectory) return el("div", "connection-detail-empty", "No active Chrome routing found.");
  const source = routing.source === "default" ? "Default Chrome route" : "Project Chrome route";
  const item = el("div", "connection-detail-item");
  item.append(profileFavicon("chrome.google.com", "Chrome"), twoLineText(
    routing.profileName || routing.profileDirectory,
    `${source}: ${routing.profileDirectory}`,
  ));
  return item;
}

function gitHubMetadataRow(overview) {
  const row = settingRow("GitHub Repository", "Read-only local Git remotes and commit identity.");
  row.querySelector(".row-control").appendChild(gitHubMetadataView(overview));
  return row;
}

function gitHubMetadataView(overview) {
  const wrap = el("div", "connection-detail-list");
  const repositories = Array.isArray(overview.gitRepositories) ? overview.gitRepositories : [];
  const identity = overview.gitIdentity || null;
  if (!repositories.length && !identity) {
    wrap.appendChild(el("div", "connection-detail-empty", "No GitHub repository or local Git identity detected."));
    return wrap;
  }
  for (const repo of repositories) {
    const item = el("a", "connection-detail-item");
    item.href = repo.url;
    item.target = "_blank";
    item.rel = "noreferrer";
    item.append(profileFavicon("github.com", "GitHub"), twoLineText(repo.fullName, repo.remotes.join(", ")));
    wrap.appendChild(item);
  }
  if (identity) {
    const username = identity.username ? `@${identity.username}` : "";
    const label = [username, identity.email].filter(Boolean).join(" - ") || identity.name || "Local Git identity";
    const item = el("div", "connection-detail-item");
    item.append(profileFavicon("github.com", "Git identity"), twoLineText(label, identity.name || "Configured in local Git"));
    wrap.appendChild(item);
  }
  return wrap;
}

function googleWorkspaceConnectionRow(service, project, overview, context) {
  const meta = googleWorkspaceServiceMeta(service);
  const row = settingRow(meta.title, meta.description);
  const assignment = overview.googleWorkspaceAssignments?.[meta.service] || null;
  const select = el("select", "native-select");
  select.appendChild(new Option("Unset", ""));
  const selectedAccountId = assignment?.accountId || "";
  for (const account of context.googleWorkspaceAccounts || []) {
    const option = new Option(googleWorkspaceAccountLabel(account), account.id);
    option.selected = selectedAccountId === account.id;
    select.appendChild(option);
  }
  const save = actionButton("Save", async () => {
    const result = await context.api.ipc.invoke("saveGoogleWorkspaceAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
      service: meta.service,
      accountId: select.value,
    });
    save.textContent = "Saved";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  });
  const clear = actionButton("Clear", async () => {
    const result = await context.api.ipc.invoke("clearGoogleWorkspaceAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
      service: meta.service,
    });
    select.value = "";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  }, "secondary");
  const instructionStatus = el("span", "inline-help", "");
  row.querySelector(".row-control").append(select, googleWorkspaceAssignmentHint(assignment, meta), save, clear, googleWorkspaceQuickAdd(context.api, select), instructionStatus);
  return row;
}

function googleWorkspaceServiceMeta(service) {
  if (service === "gmail") {
    return {
      service: "gmail",
      title: "Gmail Account",
      description: "Project-local default for Gmail plugin work.",
      domain: "mail.google.com",
    };
  }
  return {
    service: "google-drive",
    title: "Google Drive Account",
    description: "Project-local default for Drive, Docs, Sheets, and Slides plugin work.",
    domain: "drive.google.com",
  };
}

function googleWorkspaceAccountLabel(account) {
  const email = String(account?.email || "").trim();
  const name = String(account?.name || "").trim();
  if (name && name !== email) return `${name} - ${email}`;
  return email || name || "Google account";
}

function googleWorkspaceAssignmentHint(assignment, meta) {
  if (!assignment) return el("div", "connection-detail-empty", `No ${meta.title.toLowerCase()} assigned for this project.`);
  const item = el("div", "connection-detail-item");
  item.append(profileFavicon(meta.domain, meta.title), twoLineText(assignment.email, `Project ${meta.title.toLowerCase()}`));
  return item;
}

function googleWorkspaceQuickAdd(api, select) {
  const details = el("details", "quick-add");
  const summary = el("summary", "", "Add Google account");
  const name = input("Name");
  const email = input("Email");
  const save = actionButton("Add", async () => {
    const account = await api.ipc.invoke("saveGoogleWorkspaceAccount", { name: name.value, email: email.value });
    const option = new Option(googleWorkspaceAccountLabel(account), account.id);
    option.selected = true;
    select.appendChild(option);
    details.open = false;
  });
  details.append(summary, name, email, save);
  return details;
}

function modalWorkspaceConnectionRow(project, overview, context) {
  const row = settingRow("Modal Workspace", "Project-local default for Modal deploys, readiness checks, and operator scripts.");
  const assignment = overview.modalWorkspaceAssignment || null;
  const select = el("select", "native-select");
  select.appendChild(new Option("Unset", ""));
  const selectedAccountId = assignment?.accountId || "";
  for (const account of context.modalWorkspaceAccounts || []) {
    const option = new Option(modalWorkspaceAccountLabel(account), account.id);
    option.selected = selectedAccountId === account.id;
    select.appendChild(option);
  }
  const save = actionButton("Save", async () => {
    const result = await context.api.ipc.invoke("saveModalWorkspaceAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
      accountId: select.value,
    });
    save.textContent = "Saved";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  });
  const clear = actionButton("Clear", async () => {
    const result = await context.api.ipc.invoke("clearModalWorkspaceAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
    });
    select.value = "";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  }, "secondary");
  const instructionStatus = el("span", "inline-help", "");
  row.querySelector(".row-control").append(
    select,
    modalWorkspaceAssignmentHint(assignment, overview.modalWorkspaceCliContext),
    save,
    clear,
    modalWorkspaceInlineEditor(project, assignment, context, select, instructionStatus),
    modalWorkspaceQuickAdd(context.api, select),
    instructionStatus,
  );
  return row;
}

function modalWorkspaceAccountLabel(account) {
  const workspace = String(account?.workspace || "").trim();
  const profile = String(account?.profile || "").trim();
  const name = String(account?.name || "").trim();
  const label = workspace && profile && workspace !== profile ? `${profile} / ${workspace}` : workspace || profile;
  if (name && label && name !== label) return `${name} - ${label}`;
  return label || name || "Modal workspace";
}

function modalWorkspaceAssignmentHint(assignment, cliContext) {
  if (!assignment) return el("div", "connection-detail-empty", "No Modal workspace assigned for this project.");
  const wrap = el("div", "connection-detail-list");
  const item = el("div", "connection-detail-item");
  item.append(profileFavicon("modal.com", "Modal Workspace"), twoLineText(assignment.workspace, `Profile ${assignment.profile}`));
  wrap.appendChild(item);
  const conflict = modalWorkspaceConflict(assignment, cliContext);
  if (conflict) {
    wrap.appendChild(el(
      "div",
      "connection-warning",
      `Active Modal CLI is ${conflict.activeProfile}/${conflict.activeWorkspace}; project expects ${conflict.expectedProfile}/${conflict.expectedWorkspace}.`,
    ));
  }
  return wrap;
}

function modalWorkspaceInlineEditor(project, assignment, context, select, instructionStatus) {
  const details = el("details", "quick-add modal-workspace-editor");
  const selectedAccount = (context.modalWorkspaceAccounts || []).find((account) => account.id === assignment?.accountId) || assignment || {};
  const summary = el("summary", "", assignment ? "Edit Modal workspace" : "Create Modal workspace");
  const name = input("Name", selectedAccount.accountName || selectedAccount.name || "TRR Modal");
  const profile = input("Profile", selectedAccount.profile || "admin-56995");
  const workspace = input("Workspace", selectedAccount.workspace || "admin-56995");
  const save = actionButton("Save workspace", async () => {
    const account = await context.api.ipc.invoke("saveModalWorkspaceAccount", {
      name: name.value,
      profile: profile.value,
      workspace: workspace.value,
    });
    upsertSelectOption(select, account.id, modalWorkspaceAccountLabel(account), true);
    const result = await context.api.ipc.invoke("saveModalWorkspaceAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
      accountId: account.id,
    });
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
    details.open = false;
  });
  details.append(summary, name, profile, workspace, save);
  return details;
}

function modalWorkspaceQuickAdd(api, select) {
  const details = el("details", "quick-add");
  const summary = el("summary", "", "Add Modal workspace");
  const name = input("Name", "TRR Modal");
  const profile = input("Profile", "admin-56995");
  const workspace = input("Workspace", "admin-56995");
  const save = actionButton("Add", async () => {
    const account = await api.ipc.invoke("saveModalWorkspaceAccount", { name: name.value, profile: profile.value, workspace: workspace.value });
    const option = new Option(modalWorkspaceAccountLabel(account), account.id);
    option.selected = true;
    select.appendChild(option);
    details.open = false;
  });
  details.append(summary, name, profile, workspace, save);
  return details;
}

function upsertSelectOption(select, value, label, selected = false) {
  let option = Array.from(select.options || []).find((candidate) => candidate.value === value);
  if (!option) {
    option = new Option(label, value);
    select.appendChild(option);
  }
  option.textContent = label;
  option.value = value;
  option.selected = selected;
  if (selected) select.value = value;
  return option;
}

function decodoConnectionRow(project, overview, context) {
  const row = settingRow("Decodo Account", "Project-local default for Decodo scraping and proxy work.");
  const assignment = overview.decodoAssignment || null;
  const select = el("select", "native-select");
  select.appendChild(new Option("Unset", ""));
  const selectedAccountId = assignment?.accountId || "";
  for (const account of context.decodoAccounts || []) {
    const option = new Option(decodoAccountLabel(account), account.id);
    option.selected = selectedAccountId === account.id;
    select.appendChild(option);
  }
  const save = actionButton("Save", async () => {
    const result = await context.api.ipc.invoke("saveDecodoAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
      accountId: select.value,
    });
    save.textContent = "Saved";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  });
  const clear = actionButton("Clear", async () => {
    const result = await context.api.ipc.invoke("clearDecodoAssignment", {
      projectPath: project.projectPath,
      projectName: project.name,
    });
    select.value = "";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  }, "secondary");
  const instructionStatus = el("span", "inline-help", "");
  row.querySelector(".row-control").append(
    select,
    decodoAssignmentHint(assignment),
    save,
    clear,
    decodoQuickAdd(context.api, select),
    instructionStatus,
  );
  return row;
}

function decodoAccountLabel(account) {
  const username = String(account?.username || "").trim();
  const name = String(account?.name || "").trim();
  if (name && username && name !== username) return `${name} - ${username}`;
  return username || name || "Decodo account";
}

function decodoAssignmentHint(assignment) {
  if (!assignment) return el("div", "connection-detail-empty", "No Decodo account assigned for this project.");
  const item = el("div", "connection-detail-item");
  item.append(profileFavicon("decodo.com", "Decodo"), twoLineText(assignment.accountName || assignment.username || "Decodo", assignment.username || "Project Decodo account"));
  return item;
}

function decodoQuickAdd(api, select) {
  const details = el("details", "quick-add");
  const summary = el("summary", "", "Add Decodo account");
  const name = input("Name", "Decodo");
  const username = input("Username or label");
  const save = actionButton("Add", async () => {
    const account = await api.ipc.invoke("saveDecodoAccount", { name: name.value, username: username.value });
    const option = new Option(decodoAccountLabel(account), account.id);
    option.selected = true;
    select.appendChild(option);
    details.open = false;
  });
  details.append(summary, name, username, save);
  return details;
}

function supabaseConnectionRow(project, overview, context) {
  const row = settingRow("Supabase Profile", "Optional; only writes the project .codex/config.toml Supabase MCP block.");
  const select = el("select", "native-select");
  select.appendChild(new Option("Select saved profile", ""));
  for (const profile of context.supabaseProfiles) {
    const option = new Option(`${profile.name} (${profile.projectRef})`, profile.id);
    option.selected = overview.supabaseBinding?.projectRef === profile.projectRef;
    select.appendChild(option);
  }
  const detected = overview.supabaseBinding;
  const name = input("Profile name", detected?.projectRef ? `${project.name} Supabase` : "");
  const projectRef = input("Project ref", detected?.projectRef || "");
  const tokenEnv = input("Token env var", detected?.bearerTokenEnvVar || "");
  const features = input("Features", (detected?.features || []).join(","));
  const configure = el("details", "quick-add optional-connection");
  configure.open = Boolean(detected);
  configure.appendChild(el("summary", "", detected ? "Edit Supabase" : "Configure Supabase"));
  const saveProfile = actionButton("Save profile", async () => {
    const profile = await context.api.ipc.invoke("saveSupabaseProfile", {
      name: name.value,
      projectRef: projectRef.value,
      bearerTokenEnvVar: tokenEnv.value,
      features: features.value,
    });
    const option = new Option(`${profile.name} (${profile.projectRef})`, profile.id);
    option.selected = true;
    select.appendChild(option);
  });
  const apply = actionButton("Apply", async () => {
    const result = await context.api.ipc.invoke("applySupabaseProfile", {
      projectPath: project.projectPath,
      projectName: project.name,
      profileId: select.value,
      profile: select.value ? null : { name: name.value, projectRef: projectRef.value, bearerTokenEnvVar: tokenEnv.value, features: features.value },
    });
    apply.textContent = "Applied";
    instructionStatus.textContent = agentsInstructionStatusText(result?.agentsInstruction);
    refreshAgentsPreview(project, context.api);
  });
  const instructionStatus = el("span", "inline-help", "");
  configure.append(select, name, projectRef, tokenEnv, features, saveProfile, apply, instructionStatus);
  row.querySelector(".row-control").append(configure);
  return row;
}

function agentsInstructionStatusText(result) {
  if (!result) return "";
  if (result.skipped && result.reason === "disabled") return "AGENTS.md writes disabled";
  if (result.skipped) return "AGENTS.md skipped";
  if (result.changed && result.reason === "removed") return "AGENTS.md block removed";
  if (result.changed) return "AGENTS.md updated";
  if (result.reason === "absent") return "AGENTS.md unchanged";
  return "AGENTS.md unchanged";
}

function envConnectionCategories(inventory) {
  const categories = new Map();
  for (const file of inventory?.files || []) {
    for (const [category, entries] of Object.entries(file.categories || {})) {
      const current = categories.get(category) || { category, entryCount: 0, keys: new Map(), files: new Set() };
      current.entryCount += entries.length;
      current.files.add(file.relativePath);
      for (const entry of entries) {
        const files = current.keys.get(entry.key) || new Set();
        files.add(file.relativePath);
        current.keys.set(entry.key, files);
      }
      categories.set(category, current);
    }
  }
  return [...categories.values()];
}

function otherConnectionsView(connections) {
  if (!connections.length) return el("div", "connection-detail-empty", "None detected");
  const wrap = el("div", "connection-card-grid");
  for (const connection of connections.sort((a, b) => connectionSortScore(a.category) - connectionSortScore(b.category) || a.category.localeCompare(b.category))) {
    const domain = domainForConnectionCategory(connection.category);
    const uniqueKeyCount = connection.keys?.size || 0;
    const entryCount = connection.entryCount || 0;
    const duplicateCount = Math.max(0, entryCount - uniqueKeyCount);
    const card = el("details", "connection-card");
    const summary = el("summary", "connection-card-summary");
    if (domain) summary.appendChild(profileFavicon(domain, connection.category));
    summary.appendChild(twoLineText(
      connectionLabelForCategory(connection.category),
      `${uniqueKeyCount} unique keys, ${entryCount} entries, ${connection.files.size} files${duplicateCount ? `, ${duplicateCount} duplicate file entries` : ""}`,
    ));
    const list = el("div", "connection-key-list");
    for (const [key, files] of [...(connection.keys || new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const item = el("div", "connection-key-item");
      item.append(el("code", "", key), el("small", "", [...files].sort().join(", ")));
      list.appendChild(item);
    }
    card.append(summary, list);
    wrap.appendChild(card);
  }
  return wrap;
}

function connectionSortScore(category) {
  const label = String(category || "");
  if (/GitHub/i.test(label)) return 0;
  if (/Gmail/i.test(label)) return 1;
  if (/Google Drive/i.test(label)) return 2;
  if (/Vercel/i.test(label)) return 3;
  if (/Modal/i.test(label)) return 4;
  if (/Decodo/i.test(label)) return 5;
  if (/Supabase/i.test(label)) return 6;
  if (/Firebase/i.test(label)) return 7;
  if (/Database|Postgres/i.test(label)) return 8;
  if (/Reddit/i.test(label)) return 9;
  if (/TRR|Screenalytics|Admin|Build/i.test(label)) return 20;
  return 10;
}

function connectionLabelForCategory(category) {
  if (/Gmail/i.test(category)) return "Gmail";
  if (/Google Drive/i.test(category)) return "Google Drive";
  if (/Modal/i.test(category)) return "Modal Platform";
  if (/Decodo/i.test(category)) return "Decodo";
  if (/Vercel/i.test(category)) return "Vercel";
  if (/Database|Postgres/i.test(category)) return "Database/Postgres";
  if (/OpenAI|Anthropic|AI/i.test(category)) return "AI Providers";
  if (/Build|Turbo/i.test(category)) return "Build/Turbo";
  if (/Admin|Auth/i.test(category)) return "Admin/Auth";
  return category;
}

function envInventoryView(project, inventory, api) {
  const card = el("div", "settings-card env-card");
  card.dataset.projectsEnvRedacted = "true";
  card.appendChild(sectionTitle(".env Inventory", `${inventory?.fileCount || 0} files, ${inventory?.keyCount || 0} keys. Values are redacted until revealed.`));
  const connections = envConnectionCategories(inventory);
  if (connections.length) {
    const detected = el("div", "env-detected-connections");
    detected.append(sectionTitle("Detected Connections", "Read-only groups detected from .env files."), otherConnectionsView(connections));
    card.appendChild(detected);
  }
  if (!inventory?.files?.length) {
    card.appendChild(el("div", "empty-state", "No project .env files found."));
    return card;
  }
  for (const file of inventory.files) {
    const fileBlock = el("details", "env-file");
    fileBlock.open = true;
    fileBlock.appendChild(el("summary", "", `${file.relativePath} (${file.entries.length})`));
    for (const [category, entries] of Object.entries(file.categories)) {
      const group = el("div", "env-category");
      group.appendChild(el("div", "env-category-title", category));
      for (const entry of entries) {
        const line = el("div", "env-key-row");
        const value = el("code", "env-value", entry.redactedValue);
        const editor = input("New value");
        editor.type = "password";
        editor.autocomplete = "off";
        const reveal = actionButton("Reveal", async () => {
          const result = await api.ipc.invoke("revealEnvValue", { projectPath: project.projectPath, filePath: file.path, key: entry.key });
          value.textContent = result.value;
          editor.value = result.value;
          reveal.textContent = "Revealed";
        }, "secondary");
        const save = actionButton("Save", async () => {
          const result = await api.ipc.invoke("updateEnvValue", { projectPath: project.projectPath, filePath: file.path, key: entry.key, value: editor.value });
          value.textContent = result.value;
          editor.value = "";
          save.textContent = "Saved";
        });
        line.append(el("code", "env-key", entry.key), value, editor, reveal, save);
        group.appendChild(line);
      }
      fileBlock.appendChild(group);
    }
    card.appendChild(fileBlock);
  }
  return card;
}

function lazyEnvInventoryView(project, api) {
  const card = el("div", "settings-card env-card");
  card.dataset.projectsEnvRedacted = "true";
  card.setAttribute("aria-busy", "true");
  card.appendChild(sectionTitle(".env Inventory", "Loading only when this project page is opened. Values stay redacted until revealed."));
  const status = envInventoryLoadingState();
  card.appendChild(status);
  let slowTimer = null;
  let timedOut = false;
  loadProjectEnvScanTimeout(api).then((timeoutMs) => {
    slowTimer = setTimeout(() => {
      const message = status.querySelector("[data-env-loading-message]");
      if (message) message.textContent = "Still scanning project .env files...";
    }, Math.min(900, Math.max(300, Math.round(timeoutMs / 3))));
    return invokeProjectEnvInventory(api, project, timeoutMs);
  })
    .then((inventory) => {
      if (timedOut) return;
      clearTimeout(slowTimer);
      updateProjectEnvSummary(project, inventory);
      card.replaceWith(envInventoryView(project, inventory, api));
    })
    .catch((error) => {
      timedOut = true;
      clearTimeout(slowTimer);
      card.setAttribute("aria-busy", "false");
      status.replaceChildren(envInventoryErrorState(project, api, error));
      status.classList.add("is-error");
    });
  return card;
}

function loadProjectEnvScanTimeout(api) {
  return api.ipc.invoke("getProjectEnvScanTimeout")
    .then((timeoutMs) => {
      rendererProjectEnvScanTimeoutMs = normalizeProjectEnvScanTimeout(timeoutMs);
      return rendererProjectEnvScanTimeoutMs;
    })
    .catch(() => rendererProjectEnvScanTimeoutMs);
}

function invokeProjectEnvInventory(api, project, timeoutMs) {
  return new Promise((resolve, reject) => {
    const normalized = normalizeProjectEnvScanTimeout(timeoutMs);
    const timeout = setTimeout(() => {
      reject(new Error(`Project .env inventory timed out after ${Math.round(normalized / 1000)}s. Increase the timeout or retry.`));
    }, normalized);
    api.ipc.invoke("getProjectEnvInventory", project)
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

function updateProjectEnvSummary(project, inventory) {
  const summary = compactEnvInventorySummary(inventory);
  for (const chips of document.querySelectorAll("[data-project-env-summary-path]")) {
    if (chips.dataset.projectEnvSummaryPath !== project.projectPath) continue;
    chips.dataset.projectEnvSummary = summary;
    const chip = chips.querySelector("[data-project-env-chip]");
    if (chip) {
      chip.textContent = `Env: ${summary}`;
      chip.classList?.remove?.("is-muted");
    }
  }
}

function compactEnvInventorySummary(inventory) {
  const files = Number(inventory?.fileCount || 0);
  const keys = Number(inventory?.keyCount || 0);
  if (!files) return "0 files";
  return `${files} ${files === 1 ? "file" : "files"} / ${keys} ${keys === 1 ? "key" : "keys"}`;
}

function envInventoryLoadingState() {
  const wrap = el("div", "env-loading-state");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  const spinner = el("span", "env-loading-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const copy = el("span", "env-loading-copy");
  const title = el("span", "env-loading-title", "Loading project .env inventory");
  const message = el("span", "env-loading-message", "Scanning filenames and keys without revealing values.");
  message.dataset.envLoadingMessage = "true";
  copy.append(title, message);
  const skeleton = el("div", "env-loading-skeleton");
  skeleton.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) skeleton.appendChild(el("span", "env-loading-line"));
  wrap.append(spinner, copy, skeleton);
  return wrap;
}

function envInventoryErrorState(project, api, error) {
  const wrap = el("div", "env-loading-error");
  const message = el("span", "", error?.message || "Project .env inventory failed to load.");
  const retry = actionButton("Retry", async () => {
    const next = lazyEnvInventoryView(project, api);
    wrap.closest(".env-card")?.replaceWith(next);
  }, "secondary");
  wrap.append(message, retry);
  return wrap;
}

function chromeProfileLabel(profile) {
  const email = String(profile?.email || "").trim();
  if (email) return email;
  const name = String(profile?.name || "").trim();
  if (!name || name === profile?.directory || /^Profile \d+$/i.test(name) || name === "Default") return "Chrome profile";
  return name;
}

function profileAvatar(profile) {
  if (profile?.avatarUrl) {
    const image = document.createElement("img");
    image.className = "profile-avatar";
    image.alt = "";
    image.src = profile.avatarUrl;
    image.loading = "lazy";
    return image;
  }
  const fallback = el("span", "profile-avatar profile-avatar-fallback", initialsForProfile(profile));
  fallback.setAttribute("aria-hidden", "true");
  return fallback;
}

function initialsForProfile(profile) {
  const label = chromeProfileLabel(profile);
  const match = label.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : "C";
}

function profileFavicon(domain, label) {
  const image = document.createElement("img");
  image.className = "connection-favicon";
  image.alt = "";
  image.src = faviconUrl(domain);
  image.title = label;
  image.loading = "lazy";
  return image;
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function domainForConnectionTitle(title) {
  if (/Chrome/i.test(title)) return "chrome.google.com";
  if (/GitHub/i.test(title)) return "github.com";
  if (/Gmail/i.test(title)) return "mail.google.com";
  if (/Google Drive/i.test(title)) return "drive.google.com";
  if (/Modal/i.test(title)) return "modal.com";
  if (/Supabase/i.test(title)) return "supabase.com";
  if (/Decodo/i.test(title)) return "decodo.com";
  return "";
}

function domainForConnectionCategory(category) {
  if (/Supabase/i.test(category)) return "supabase.com";
  if (/Database|Postgres|Prisma/i.test(category)) return "postgresql.org";
  if (/GitHub/i.test(category)) return "github.com";
  if (/Gmail/i.test(category)) return "mail.google.com";
  if (/Google Drive/i.test(category)) return "drive.google.com";
  if (/Firebase/i.test(category)) return "firebase.google.com";
  if (/Reddit/i.test(category)) return "reddit.com";
  if (/Chrome|Google/i.test(category)) return "google.com";
  if (/OpenAI/i.test(category)) return "openai.com";
  if (/Anthropic|Claude/i.test(category)) return "anthropic.com";
  if (/Vercel/i.test(category)) return "vercel.com";
  if (/Modal/i.test(category)) return "modal.com";
  if (/Object Storage/i.test(category)) return "aws.amazon.com";
  if (/Cloudflare/i.test(category)) return "cloudflare.com";
  if (/Render/i.test(category)) return "render.com";
  if (/Apify/i.test(category)) return "apify.com";
  if (/Better Stack/i.test(category)) return "betterstack.com";
  if (/Firecrawl/i.test(category)) return "firecrawl.dev";
  if (/Brandfetch/i.test(category)) return "brandfetch.com";
  if (/Media APIs/i.test(category)) return "themoviedb.org";
  if (/Decodo/i.test(category)) return "decodo.com";
  if (/Social Platforms/i.test(category)) return "instagram.com";
  if (/Build|Turbo/i.test(category)) return "turbo.build";
  if (/Screenalytics/i.test(category)) return "screenalytics.com";
  if (/TRR/i.test(category)) return "therealityreport.com";
  if (/Admin|Auth/i.test(category)) return "authjs.dev";
  if (/Linear/i.test(category)) return "linear.app";
  if (/Stripe/i.test(category)) return "stripe.com";
  return "";
}

function settingRow(title, description) {
  const row = el("div", "setting-row");
  const domain = domainForConnectionTitle(title);
  const label = el("div", "row-label");
  const strong = el("strong");
  if (domain) strong.appendChild(profileFavicon(domain, title));
  strong.appendChild(el("span", "", title));
  label.append(strong, el("span", "", description));
  row.append(label, el("div", "row-control"));
  return row;
}

function sectionTitle(title, description) {
  const wrap = el("div", "section-title");
  wrap.append(el("div", "section-heading", title), el("div", "section-description", description));
  return wrap;
}

function actionButton(label, onClick, variant = "primary") {
  const button = el("button", `action-button ${variant}`);
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    const original = button.textContent;
    button.disabled = true;
    try {
      await onClick();
    } catch (error) {
      button.textContent = error?.message || "Failed";
    } finally {
      setTimeout(() => {
        button.disabled = false;
        if (button.textContent !== original && button.textContent !== "Saved" && button.textContent !== "Applied" && button.textContent !== "Revealed") {
          button.textContent = original;
        }
      }, 1400);
    }
  });
  return button;
}

function input(placeholder, value = "") {
  const node = document.createElement("input");
  node.className = "native-input";
  node.placeholder = placeholder;
  node.value = value;
  return node;
}

function appendProjectSummary(target, project) {
  const chips = el("span", "project-chips");
  chips.dataset.projectChips = "true";
  chips.dataset.projectEnvSummaryPath = project.projectPath;
  target.append(
    el("span", "project-name", project.name),
    el("span", "project-path", project.projectPath),
    chips,
  );
  return chips;
}

function twoLineText(primary, secondary, className = "") {
  const wrap = el("span", className);
  wrap.append(el("strong", "", primary), el("span", "", secondary));
  return wrap;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "" && text != null) node.textContent = String(text);
  return node;
}

function projectsCss() {
  return `
    .shadgpt-projects-settings { display: block; }
    .projects-frame { display: flex; flex-direction: column; gap: 14px; max-width: 1040px; }
    .section-title { display: flex; flex-direction: column; gap: 3px; }
    .section-heading { font-size: 15px; font-weight: 650; }
    .section-description, .projects-status, .row-label span, .project-path { color: var(--text-secondary, #6b7280); font-size: 12px; line-height: 1.35; }
    .projects-status.is-error { color: #b42318; }
    .projects-header-chrome-status { min-height: 42px; display: flex; align-items: center; color: var(--text-secondary, #6b7280); font-size: 12px; }
    .projects-header-chrome-status.is-error { color: #b42318; }
    .projects-header-chrome-inner { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--border-subtle, rgba(128,128,128,.25)); border-radius: 8px; background: var(--background-primary, transparent); }
    .projects-header-chrome-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .projects-header-chrome-copy strong { color: inherit; font-size: 13px; }
    .projects-header-chrome-copy span { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .projects-header-chrome-chips { justify-content: flex-end; }
    .projects-accordion, .panel-stack { display: flex; flex-direction: column; gap: 10px; }
    .project-card, .settings-card { border: 1px solid var(--border-subtle, rgba(128,128,128,.25)); border-radius: 8px; background: var(--background-primary, transparent); }
    .project-summary { width: 100%; display: grid; grid-template-columns: minmax(120px, 220px) minmax(180px, 1fr) auto; gap: 12px; align-items: center; padding: 12px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .project-name { font-weight: 650; }
    .project-chips, .connection-pills { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .status-chip, .connection-pills span { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-subtle, rgba(128,128,128,.25)); border-radius: 999px; padding: 2px 8px; font-size: 11px; white-space: nowrap; color: inherit; text-decoration: none; }
    a.status-chip:hover { text-decoration: underline; }
    .status-chip.is-danger { color: #b42318; border-color: rgba(180,35,24,.25); }
    .status-chip.is-warning { color: #92400e; border-color: rgba(146,64,14,.28); }
    .status-chip.is-muted { color: var(--text-secondary, #6b7280); }
    .project-panel { padding: 0 12px 12px; }
    .settings-card { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .compact-settings-card { padding: 10px 12px; }
    .setting-row { display: grid; grid-template-columns: minmax(160px, 240px) 1fr; gap: 12px; padding-top: 12px; border-top: 1px solid var(--border-subtle, rgba(128,128,128,.18)); }
    .setting-row:first-of-type { border-top: 0; padding-top: 0; }
    .row-label { display: flex; flex-direction: column; gap: 4px; }
    .row-label strong { display: inline-flex; align-items: center; gap: 7px; }
    .row-control { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .native-select, .native-input { min-height: 30px; border: 1px solid var(--border-subtle, rgba(128,128,128,.35)); border-radius: 6px; background: var(--background-primary, #fff); color: inherit; padding: 4px 8px; }
    .native-select { min-width: 220px; }
    .native-input { width: 180px; }
    .connection-detail-list { width: 100%; display: flex; flex-direction: column; gap: 6px; }
    .connection-detail-item, .connection-detail-empty { display: inline-flex; align-items: center; gap: 8px; min-height: 30px; color: inherit; text-decoration: none; }
    .connection-detail-item span { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .connection-detail-item small, .connection-detail-empty { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .connection-warning { width: 100%; color: #92400e; font-size: 12px; line-height: 1.35; }
    .connection-card-grid { width: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
    .connection-card { min-height: 48px; border: 1px solid var(--border-subtle, rgba(128,128,128,.25)); border-radius: 8px; padding: 0; }
    .connection-card-summary { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; min-height: 48px; padding: 8px 10px; cursor: pointer; list-style: none; }
    .connection-card-summary::-webkit-details-marker { display: none; }
    .connection-card-summary::after { content: "⌄"; color: var(--text-secondary, #6b7280); justify-self: end; grid-column: 2; grid-row: 1; }
    .connection-card[open] .connection-card-summary::after { content: "⌃"; }
    .connection-card span { min-width: 0; display: flex; flex-direction: column; gap: 1px; padding-right: 18px; }
    .connection-card small { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .connection-key-list { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px 34px; }
    .connection-key-item { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .connection-key-item code { font-size: 11px; white-space: normal; overflow-wrap: anywhere; }
    .connection-favicon { width: 16px; height: 16px; border-radius: 4px; flex: 0 0 auto; vertical-align: -3px; }
    .profile-dropdown { position: relative; min-width: min(100%, 420px); }
    .profile-dropdown-summary { min-height: 32px; display: inline-flex; align-items: center; gap: 8px; width: 100%; border: 1px solid var(--border-subtle, rgba(128,128,128,.35)); border-radius: 6px; background: var(--background-primary, #fff); color: inherit; padding: 4px 10px; cursor: pointer; list-style: none; }
    .profile-dropdown-summary::-webkit-details-marker { display: none; }
    .profile-dropdown-summary::after { content: "⌄"; margin-left: auto; color: var(--text-secondary, #6b7280); }
    .profile-dropdown[open] .profile-dropdown-summary::after { content: "⌃"; }
    .profile-dropdown-menu { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: min(520px, 90vw); max-height: 300px; overflow: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px; border: 1px solid var(--border-subtle, rgba(128,128,128,.28)); border-radius: 8px; background: var(--background-primary, #fff); box-shadow: 0 14px 40px rgba(15,23,42,.18); }
    .profile-option { display: grid; grid-template-columns: auto 28px minmax(0, 1fr); gap: 8px; align-items: center; padding: 7px; border-radius: 6px; cursor: pointer; }
    .profile-option:hover { background: rgba(128,128,128,.10); }
    .toggle-option { display: inline-grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: center; padding: 7px; border-radius: 6px; cursor: pointer; }
    .toggle-option:hover { background: rgba(128,128,128,.10); }
    .toggle-option > span { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .toggle-option > span span { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .compact-toggle-option { min-width: 150px; }
    .agents-plugin-toggle-list { width: 100%; display: flex; flex-wrap: wrap; gap: 4px; }
    .agents-preview-panel { width: min(100%, 720px); }
    .agents-preview-panel summary { cursor: pointer; color: var(--text-secondary, #6b7280); font-size: 12px; }
    .agents-preview-text { max-width: 100%; max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--border-subtle, rgba(128,128,128,.25)); border-radius: 8px; padding: 10px; background: rgba(128,128,128,.06); font-size: 12px; line-height: 1.45; }
    .chrome-verifier-output { width: min(100%, 720px); }
    .agents-preview-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .profile-avatar { width: 28px; height: 28px; border-radius: 999px; object-fit: cover; background: rgba(128,128,128,.16); }
    .profile-avatar-fallback { display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 650; }
    .profile-option-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .profile-option-copy strong, .profile-option-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .profile-option-copy span { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .color-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 6px; width: min(100%, 560px); }
    .color-swatch { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 30px; border: 1px solid var(--border-subtle, rgba(128,128,128,.28)); border-radius: 6px; background: transparent; cursor: pointer; }
    .color-swatch[aria-pressed="true"] { border-color: var(--color-token-text-primary, currentColor); box-shadow: 0 0 0 1px var(--color-token-text-primary, currentColor); }
    .swatch-dot { width: 16px; height: 16px; border-radius: 999px; background: var(--project-swatch); border: 1px solid rgba(0,0,0,.12); }
    .overlay-segmented { display: inline-grid; grid-template-columns: repeat(4, minmax(0, auto)); gap: 0; border: 1px solid var(--border-subtle, rgba(128,128,128,.28)); border-radius: 6px; overflow: hidden; }
    .overlay-segment { min-height: 30px; border: 0; border-right: 1px solid var(--border-subtle, rgba(128,128,128,.22)); background: transparent; color: inherit; padding: 4px 9px; font-size: 12px; cursor: pointer; }
    .overlay-segment:last-child { border-right: 0; }
    .overlay-segment[aria-pressed="true"] { background: color-mix(in srgb, currentColor 10%, transparent); font-weight: 650; }
    .inline-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary, #6b7280); }
    .inline-help { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .action-button { border: 1px solid var(--border-subtle, rgba(128,128,128,.35)); border-radius: 6px; padding: 5px 10px; background: var(--button-primary-background, #111827); color: var(--button-primary-foreground, #fff); cursor: pointer; }
    .action-button.secondary { background: transparent; color: inherit; }
    .quick-add { width: 100%; }
    .quick-add summary { cursor: pointer; font-size: 12px; color: var(--text-secondary, #6b7280); }
    .quick-add[open] { display: flex; flex-wrap: wrap; gap: 8px; }
    .optional-connection { width: 100%; }
    .env-loading-state { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px 12px; align-items: center; border: 1px solid var(--border-subtle, rgba(128,128,128,.18)); border-radius: 8px; padding: 12px; }
    .env-loading-spinner { width: 16px; height: 16px; border: 2px solid rgba(128,128,128,.25); border-top-color: currentColor; border-radius: 999px; animation: projects-env-spin 900ms linear infinite; }
    .env-loading-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .env-loading-title { font-size: 12px; font-weight: 650; }
    .env-loading-message { color: var(--text-secondary, #6b7280); font-size: 12px; }
    .env-loading-skeleton { grid-column: 1 / -1; display: grid; gap: 6px; }
    .env-loading-line { display: block; height: 10px; max-width: 100%; border-radius: 999px; background: color-mix(in srgb, currentColor 10%, transparent); }
    .env-loading-line:nth-child(2) { width: 76%; }
    .env-loading-line:nth-child(3) { width: 52%; }
    .env-loading-error { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    @keyframes projects-env-spin { to { transform: rotate(360deg); } }
    .env-file { border-top: 1px solid var(--border-subtle, rgba(128,128,128,.18)); padding-top: 10px; }
    .env-file summary { cursor: pointer; font-weight: 650; font-size: 13px; }
    .env-category { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .env-category-title { font-size: 12px; color: var(--text-secondary, #6b7280); text-transform: uppercase; letter-spacing: 0; }
    .env-key-row { display: grid; grid-template-columns: minmax(150px, 220px) minmax(80px, .7fr) minmax(120px, 1fr) auto auto; gap: 8px; align-items: center; }
    .env-key, .env-value { overflow-wrap: anywhere; }
    .empty-state { color: var(--text-secondary, #6b7280); font-size: 13px; }
    @media (max-width: 720px) {
      .project-summary, .setting-row, .env-key-row { grid-template-columns: 1fr; }
      .projects-header-chrome-inner { grid-template-columns: auto minmax(0, 1fr); }
      .projects-header-chrome-chips { grid-column: 1 / -1; justify-content: flex-start; }
      .project-chips { justify-content: flex-start; }
      .native-select, .native-input { width: 100%; min-width: 0; }
      .profile-dropdown, .profile-dropdown-menu { width: 100%; min-width: 0; }
    }
  `;
}

function startSidebarProjectScanner(api) {
  let lastKey = "";
  const scan = () => {
    const projects = scanSidebarProjectsFromDom();
    const key = JSON.stringify(projects);
    if (!projects.length || key === lastKey) return;
    lastKey = key;
    api.ipc.invoke("cacheSidebarProjects", projects).catch(() => {});
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scan();
  const timer = setInterval(scan, 2000);
  return () => {
    observer.disconnect();
    clearInterval(timer);
  };
}

function startSidebarProjectReorder(api) {
  let disposed = false;
  let scheduled = false;
  let applyingOrder = false;
  let projectOrder = [];
  let draggingKey = "";

  installSidebarReorderStyle();

  const loadOrder = async () => {
    try {
      projectOrder = normalizeSidebarProjectOrder(await api.ipc.invoke("getSidebarProjectOrder"));
      scheduleApply();
    } catch (error) {
      api.log?.warn?.("[projects] failed to load sidebar project order", error?.message || String(error));
    }
  };

  const saveCurrentOrder = async () => {
    const rows = scanSidebarProjectRowsFromDom();
    const nextOrder = normalizeSidebarProjectOrder(rows.map(sidebarProjectDomKey));
    projectOrder = nextOrder;
    try {
      await api.ipc.invoke("saveSidebarProjectOrder", nextOrder);
      const projects = rows.map(projectFromSidebarNode).filter(Boolean);
      if (projects.length) await api.ipc.invoke("cacheSidebarProjects", projects);
    } catch (error) {
      api.log?.warn?.("[projects] failed to save sidebar project order", error?.message || String(error));
    }
  };

  const apply = () => {
    if (disposed || applyingOrder) return;
    const rows = scanSidebarProjectRowsFromDom();
    if (!rows.length) return;
    applyingOrder = true;
    try {
      applySidebarProjectOrder(rows, projectOrder);
      markSidebarProjectRows(scanSidebarProjectRowsFromDom());
    } finally {
      applyingOrder = false;
    }
  };

  const scheduleApply = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      apply();
    }, 40);
  };

  const onDragStart = (event) => {
    const row = closestSidebarReorderRow(event.target);
    if (!row) return;
    draggingKey = sidebarProjectDomKey(row);
    if (!draggingKey) return;
    row.setAttribute(SIDEBAR_REORDER_ATTR, "dragging");
    try {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggingKey);
    } catch {}
  };

  const onDragOver = (event) => {
    if (!draggingKey) return;
    const target = closestSidebarReorderRow(event.target);
    if (!target || sidebarProjectDomKey(target) === draggingKey) {
      clearSidebarDropTargets();
      return;
    }
    event.preventDefault();
    const position = sidebarDropPosition(target, event.clientY);
    clearSidebarDropTargets(target);
    target.setAttribute(SIDEBAR_REORDER_ATTR, `drop-${position}`);
    try {
      event.dataTransfer.dropEffect = "move";
    } catch {}
  };

  const onDrop = async (event) => {
    if (!draggingKey) return;
    const target = closestSidebarReorderRow(event.target);
    clearSidebarDropTargets();
    if (!target) return;
    event.preventDefault();
    const rows = scanSidebarProjectRowsFromDom();
    const draggingRow = rows.find((row) => sidebarProjectDomKey(row) === draggingKey);
    if (!draggingRow || draggingRow === target) return;
    moveSidebarProjectBlock(draggingRow, target, sidebarDropPosition(target, event.clientY), rows);
    markSidebarProjectRows(scanSidebarProjectRowsFromDom());
    await saveCurrentOrder();
  };

  const onDragEnd = () => {
    draggingKey = "";
    clearSidebarDropTargets();
    document.querySelectorAll(`[${SIDEBAR_REORDER_ATTR}="dragging"]`).forEach((row) => {
      if (row instanceof HTMLElement) row.setAttribute(SIDEBAR_REORDER_ATTR, "row");
    });
  };

  loadOrder();
  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "aria-label",
      "class",
      "data-app-action-sidebar-project-id",
      "data-app-action-sidebar-project-label",
      "role",
    ],
    childList: true,
    subtree: true,
  });
  const retryTimers = [0, 250, 1000, 2500].map((delay) => window.setTimeout(scheduleApply, delay));
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("dragend", onDragEnd, true);

  return () => {
    disposed = true;
    observer.disconnect();
    retryTimers.forEach((timer) => window.clearTimeout(timer));
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("dragend", onDragEnd, true);
    clearSidebarDropTargets();
    document.getElementById(SIDEBAR_REORDER_STYLE_ID)?.remove();
    document.querySelectorAll(`[${SIDEBAR_REORDER_ATTR}]`).forEach((row) => {
      row.removeAttribute(SIDEBAR_REORDER_ATTR);
      row.removeAttribute("draggable");
    });
  };
}

function installSidebarReorderStyle() {
  document.getElementById(SIDEBAR_REORDER_STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = SIDEBAR_REORDER_STYLE_ID;
  style.textContent = `
    [${SIDEBAR_REORDER_ATTR}="row"] {
      cursor: grab;
    }

    [${SIDEBAR_REORDER_ATTR}="dragging"] {
      cursor: grabbing;
      opacity: .58;
    }

    [${SIDEBAR_REORDER_ATTR}="drop-before"],
    [${SIDEBAR_REORDER_ATTR}="drop-after"] {
      position: relative !important;
    }

    [${SIDEBAR_REORDER_ATTR}="drop-before"]::before,
    [${SIDEBAR_REORDER_ATTR}="drop-after"]::after {
      content: "";
      position: absolute;
      left: 10px;
      right: 10px;
      height: 2px;
      border-radius: 999px;
      background: var(--color-token-text-link-foreground, var(--color-token-foreground, currentColor));
      pointer-events: none;
      z-index: 2;
    }

    [${SIDEBAR_REORDER_ATTR}="drop-before"]::before { top: 0; }
    [${SIDEBAR_REORDER_ATTR}="drop-after"]::after { bottom: 0; }
  `;
  document.head.appendChild(style);
}

function scanSidebarProjectRowsFromDom() {
  const headers = Array.from(document.querySelectorAll("div,span,p"))
    .filter((node) => compactText(node.textContent) === "Projects");
  for (const header of headers) {
    const rows = sidebarProjectNodesForHeader(header)
      .filter((node) => projectFromSidebarNode(node));
    if (rows.length) return rows;
  }
  return [];
}

function markSidebarProjectRows(rows) {
  const active = new Set(rows);
  document.querySelectorAll(`[${SIDEBAR_REORDER_ATTR}]`).forEach((node) => {
    if (!(node instanceof HTMLElement) || active.has(node)) return;
    node.removeAttribute(SIDEBAR_REORDER_ATTR);
    node.removeAttribute("draggable");
  });
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (row.getAttribute(SIDEBAR_REORDER_ATTR) !== "dragging") {
      row.setAttribute(SIDEBAR_REORDER_ATTR, "row");
    }
    row.setAttribute("draggable", "true");
  }
}

function closestSidebarReorderRow(target) {
  const row = target?.closest?.(`[${SIDEBAR_REORDER_ATTR}]`);
  return row instanceof HTMLElement ? row : null;
}

function sidebarProjectDomKey(row) {
  const project = projectFromSidebarNode(row);
  return sidebarProjectOrderKey(project);
}

function sidebarDropPosition(row, clientY) {
  const rect = row.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  return clientY < midpoint ? "before" : "after";
}

function clearSidebarDropTargets(except = null) {
  document.querySelectorAll(
    `[${SIDEBAR_REORDER_ATTR}="drop-before"], [${SIDEBAR_REORDER_ATTR}="drop-after"]`,
  ).forEach((row) => {
    if (row instanceof HTMLElement && row !== except) row.setAttribute(SIDEBAR_REORDER_ATTR, "row");
  });
}

function applySidebarProjectOrder(rows, order) {
  const normalizedOrder = normalizeSidebarProjectOrder(order);
  if (!normalizedOrder.length || rows.length < 2) return;
  const orderIndex = new Map(normalizedOrder.map((key, index) => [key, index]));
  const sortedRows = [...rows].sort((a, b) => {
    const aIndex = orderIndex.get(sidebarProjectDomKey(a));
    const bIndex = orderIndex.get(sidebarProjectDomKey(b));
    if (aIndex === undefined && bIndex === undefined) return 0;
    if (aIndex === undefined) return 1;
    if (bIndex === undefined) return -1;
    return aIndex - bIndex;
  });
  if (rows.map(sidebarProjectDomKey).join("\n") === sortedRows.map(sidebarProjectDomKey).join("\n")) return;
  const rowSet = new Set(rows);
  const parent = rows[0]?.parentElement;
  if (!(parent instanceof HTMLElement) || rows.some((row) => row.parentElement !== parent)) return;
  const lastBlock = sidebarProjectBlockNodes(rows[rows.length - 1], rowSet);
  const anchor = lastBlock[lastBlock.length - 1]?.nextElementSibling || null;
  for (const row of sortedRows) {
    for (const node of sidebarProjectBlockNodes(row, rowSet)) parent.insertBefore(node, anchor);
  }
}

function moveSidebarProjectBlock(row, target, position, rows) {
  const rowSet = new Set(rows);
  const parent = row.parentElement;
  if (!(parent instanceof HTMLElement) || target.parentElement !== parent) return;
  const block = sidebarProjectBlockNodes(row, rowSet);
  const targetBlock = sidebarProjectBlockNodes(target, rowSet);
  if (block.includes(target)) return;
  const reference = position === "before"
    ? target
    : targetBlock[targetBlock.length - 1]?.nextElementSibling || null;
  for (const node of block) parent.insertBefore(node, reference);
}

function sidebarProjectBlockNodes(row, rowSet) {
  const nodes = [row];
  let node = row.nextElementSibling;
  while (node && !rowSet.has(node) && !isSidebarProjectBoundaryNode(node)) {
    nodes.push(node);
    node = node.nextElementSibling;
  }
  return nodes;
}

function isSidebarProjectBoundaryNode(node) {
  return compactText(node?.textContent) === "Chats";
}

function scanSidebarProjectsFromDom() {
  const headers = Array.from(document.querySelectorAll("div,span,p"))
    .filter((node) => compactText(node.textContent) === "Projects");
  for (const header of headers) {
    const projects = [];
    const seen = new Set();
    for (const node of sidebarProjectNodesForHeader(header)) {
      const project = projectFromSidebarNode(node);
      if (project && !seen.has(project.name)) {
        seen.add(project.name);
        projects.push(project);
      }
    }
    if (projects.length) return projects;
  }
  return [];
}

function sidebarProjectNodesForHeader(header) {
  const headerRect = header.getBoundingClientRect?.();
  const boundary = Array.from(document.querySelectorAll("div,span,p"))
    .filter((node) => compactText(node.textContent) === "Chats")
    .map((node) => ({ node, rect: node.getBoundingClientRect?.() }))
    .filter(({ rect }) => rect && rect.height > 0 && rect.top >= (headerRect?.bottom ?? 0))
    .sort((a, b) => a.rect.top - b.rect.top)[0];
  if (!boundary?.rect) return [];

  if (headerRect) {
    const sidebar = header.closest("aside") || document.body;
    const nodes = Array.from(sidebar.querySelectorAll("[data-app-action-sidebar-project-id]"))
      .map((node) => node.closest?.("div[role='listitem']") || node)
      .filter((node, index, all) => node instanceof HTMLElement && all.indexOf(node) === index)
      .filter((node) => {
        const rect = node.getBoundingClientRect?.();
        return rect && rect.height > 0 && rect.bottom > headerRect.bottom && rect.top < boundary.rect.top;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (nodes.length) return nodes;
  }

  const nodes = [];
  let node = header.nextElementSibling;
  while (node) {
    const text = compactText(node.textContent);
    if (text === "Chats") break;
    const nested = node.matches?.("div[role='listitem']")
      ? [node]
      : Array.from(node.querySelectorAll?.("div[role='listitem'], [data-app-action-sidebar-project-id]") || []);
    nodes.push(...nested.map((entry) => entry.closest?.("div[role='listitem']") || entry));
    node = node.nextElementSibling;
  }
  return nodes.filter((node, index, all) => node instanceof HTMLElement && all.indexOf(node) === index);
}

function projectFromSidebarNode(node) {
  if (!(node instanceof HTMLElement)) return null;
  const action = node.querySelector("[data-app-action-sidebar-project-id]");
  const projectId = action instanceof HTMLElement
    ? compactText(action.getAttribute("data-app-action-sidebar-project-id"))
    : "";
  if (isCloudProjectPath(projectId)) return null;
  const name = cleanProjectLabel(
    action instanceof HTMLElement
      ? action.getAttribute("data-app-action-sidebar-project-label") ||
          action.getAttribute("aria-label") ||
          node.getAttribute("aria-label") ||
          node.textContent
      : node.getAttribute("aria-label") || node.textContent,
    projectId,
  );
  if (!name || name === "New project" || /^Chats\b/.test(name) || isExcludedSidebarProjectName(name)) return null;
  return {
    name,
    projectPath: projectId && !projectId.startsWith("cloud:") ? projectId : sidebarProjectKey(name),
  };
}

function cleanProjectLabel(value, projectPath = "") {
  let label = normalizeLegacyBrandText(compactText(value)).replace(/\s+New project$/, "");
  if (projectPath && !projectPath.startsWith("codex-sidebar://")) {
    const basename = projectPath.split(/[\\/]/).filter(Boolean).pop();
    if (basename) label = label.replace(new RegExp(`\\s+${escapeRegExp(basename)}$`, "i"), "");
  }
  label = label.replace(/^ShadGPT\s+codex-plusplus$/i, "ShadGPT");
  return label;
}

function sidebarProjectKey(name) {
  const slug = slugify(name || "project");
  return `codex-sidebar://${slug || "project"}`;
}

function normalizeLegacyBrandText(value) {
  const token = ["Code", "MAXXER"].join("");
  return String(value || "").replace(new RegExp(token, "gi"), "ShadGPT");
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
