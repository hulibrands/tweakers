const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const PROJECTS_TWEAK_ID = "co.thomashulihan.projects";
const STORE_RELATIVE = ["Library", "Application Support", "codex-plusplus", "storage", `${TWEAK_ID}.json`];
const ACTIVE_PROFILE_FILENAME = "active-chrome-profile.json";
const PATCH_VERSION = "SHADGPT_PROJECT_CHROME_ROUTING_PATCH_V3";
const PATCH_BEGIN = `// BEGIN ${PATCH_VERSION}`;
const PATCH_END = `// END ${PATCH_VERSION}`;
const CALLSITE_MARKER = "SHADGPT_PROJECT_CHROME_ROUTING_CALLSITE";
const HELPER_NAME = "resolveChromeProfileDirectoryFromProjectStore";
const CALLSITE_ANCHORS = [
  "function resolveChromeProfileDirectory(userDataDirectory) {\n  const localStateProfile =",
  "function resolveChromeProfileDirectory(userDataDirectory) {\n\n  const localStateProfile =",
  [
    "function resolveChromeProfileDirectory(userDataDirectory) {",
    "  const envProfile = getChromeProfileDirectoryOverride(userDataDirectory);",
    "  if (envProfile) return envProfile;",
    "",
    "  const localStateProfile =",
  ].join("\n"),
  [
    "function resolveChromeProfileDirectory(userDataDirectory) {",
    "  const envProfile = getChromeProfileDirectoryOverride(userDataDirectory);",
    "  if (envProfile) return envProfile;",
    "",
    "",
    "  const localStateProfile =",
  ].join("\n"),
];
const HELPER_ANCHOR = "\nfunction resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {";
const LEGACY_PATCH_MARKER = "PROJECT_CHROME_PROFILE_STORE";

function chromeUserDataDir(options = {}) {
  if (options.env?.CODEX_CHROME_USER_DATA_DIR || process.env.CODEX_CHROME_USER_DATA_DIR) {
    return path.resolve(options.env?.CODEX_CHROME_USER_DATA_DIR || process.env.CODEX_CHROME_USER_DATA_DIR);
  }
  const home = options.home || os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Google", "Chrome");
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Google", "Chrome", "User Data");
  }
  return path.join(home, ".config", "google-chrome");
}

function userRootForHome(home) {
  if (process.env.CODEX_PLUSPLUS_USER_ROOT) return path.resolve(process.env.CODEX_PLUSPLUS_USER_ROOT);
  if (process.env.CODEX_PLUSPLUS_HOME) return path.resolve(process.env.CODEX_PLUSPLUS_HOME);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "codex-plusplus");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codex-plusplus");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "codex-plusplus");
}

function storageFile(options = {}) {
  const home = options.home || os.homedir();
  return path.join(options.userRoot || userRootForHome(home), "storage", `${TWEAK_ID}.json`);
}

function activeChromeProfileFile(options = {}) {
  const home = options.home || os.homedir();
  return path.join(options.userRoot || userRootForHome(home), "storage", ACTIVE_PROFILE_FILENAME);
}

function readJsonFileIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readStore(options = {}) {
  return readJsonFileIfPresent(storageFile(options)) || {};
}

function normalizePreferredProfiles(assignment) {
  if (!assignment || typeof assignment !== "object") return [];
  if (Array.isArray(assignment.preferredProfiles) && assignment.preferredProfiles.length) return assignment.preferredProfiles;
  if (Array.isArray(assignment.allowedProfiles) && assignment.allowedProfiles.length) return assignment.allowedProfiles;
  if (Array.isArray(assignment.preferencesPaths) && assignment.preferencesPaths.length) {
    return assignment.preferencesPaths.map((preferencesPath, index) => ({
      profileDirectory: Array.isArray(assignment.profileDirectories) ? assignment.profileDirectories[index] : path.basename(path.dirname(preferencesPath)),
      profileName: Array.isArray(assignment.profileNames) ? assignment.profileNames[index] : path.basename(path.dirname(preferencesPath)),
      profileAliases: profileAliasesAtIndex(assignment, index),
      preferencesPath,
      userDataDir: path.dirname(path.dirname(preferencesPath)),
    }));
  }
  return assignment.profileDirectory || assignment.preferencesPath ? [{
    profileDirectory: assignment.profileDirectory,
    profileName: assignment.profileName || assignment.profileDirectory,
    profileAliases: normalizeProfileAliases(assignment.profileAliases),
    preferencesPath: assignment.preferencesPath,
    userDataDir: assignment.userDataDir,
  }] : [];
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

function profileAliasesForRoute(assignment, preferredProfiles) {
  return normalizeProfileAliases([
    ...(Array.isArray(assignment?.profileAliases) ? assignment.profileAliases : []),
    ...preferredProfiles.flatMap((profile) => normalizeProfileAliases(profile?.profileAliases)),
  ]);
}

function resolveChromeRouting(projectPathInput, options = {}) {
  const store = readStore(options);
  const userDataDir = chromeUserDataDir(options);
  const projectPath = typeof projectPathInput === "string" && projectPathInput.trim()
    ? path.resolve(projectPathInput)
    : "";
  const assignments = store.assignments && typeof store.assignments === "object" && !Array.isArray(store.assignments)
    ? store.assignments
    : {};
  const match = projectPath
    ? Object.values(assignments)
      .filter((entry) => entry && typeof entry.projectPath === "string")
      .filter((entry) => projectPath === entry.projectPath || projectPath.startsWith(`${entry.projectPath}${path.sep}`))
      .sort((a, b) => b.projectPath.length - a.projectPath.length)[0] || null
    : null;
  const fallback = match ? null : store.defaultProfile || null;
  const assignment = match || fallback;
  const preferredProfiles = normalizePreferredProfiles(assignment);
  const primary = preferredProfiles[0] || null;
  const profileDirectory = primary?.profileDirectory || assignment?.profileDirectory || "";
  const preferencesPath = primary?.preferencesPath || assignment?.preferencesPath || (profileDirectory ? path.join(userDataDir, profileDirectory, "Preferences") : "");
  return {
    projectPath,
    matched: Boolean(match),
    source: match ? "project" : fallback ? "default" : "none",
    assignment: match || null,
    defaultProfile: fallback || null,
    preferredProfiles,
    profileDirectory,
    profileName: primary?.profileName || assignment?.profileName || profileDirectory,
    profileAliases: profileAliasesForRoute(assignment, preferredProfiles),
    preferencesPath,
    userDataDir: primary?.userDataDir || assignment?.userDataDir || userDataDir,
  };
}

function readActiveChromeProfileSignal(options = {}) {
  const signal = readJsonFileIfPresent(activeChromeProfileFile(options));
  if (!signal || typeof signal !== "object") return null;
  return sanitizeActiveChromeProfileSignal(signal, options);
}

function sanitizeActiveChromeProfileSignal(signal, options = {}) {
  const userDataDir = chromeUserDataDir(options);
  const projectPath = typeof signal.projectPath === "string" && signal.projectPath.trim()
    ? path.resolve(signal.projectPath)
    : "";
  const preferencesPath = typeof signal.preferencesPath === "string" && signal.preferencesPath.trim()
    ? path.resolve(signal.preferencesPath)
    : "";
  const profileDirectory = typeof signal.profileDirectory === "string" && signal.profileDirectory.trim()
    ? signal.profileDirectory
    : preferencesPath
      ? path.basename(path.dirname(preferencesPath))
      : "";
  const expectedPreferences = profileDirectory ? path.join(userDataDir, profileDirectory, "Preferences") : "";
  if (!projectPath || !preferencesPath || !profileDirectory) return null;
  if (preferencesPath !== expectedPreferences) return null;
  if (!fs.existsSync(preferencesPath)) return null;
  return {
    projectPath,
    preferencesPath,
    profileDirectory,
    profileName: typeof signal.profileName === "string" ? signal.profileName : profileDirectory,
    profileAliases: normalizeProfileAliases(signal.profileAliases),
    userDataDir,
    source: "active-project",
    updatedAt: typeof signal.updatedAt === "string" ? signal.updatedAt : "",
  };
}

function writeActiveChromeProfileSignal(input, options = {}) {
  const routing = input?.profileDirectory && input?.preferencesPath
    ? sanitizeActiveChromeProfileSignal(input, options)
    : resolveChromeRouting(input?.projectPath || input, options);
  const signal = routing?.profileDirectory && routing?.preferencesPath
    ? sanitizeActiveChromeProfileSignal({
      projectPath: routing.projectPath || input?.projectPath || "",
      preferencesPath: routing.preferencesPath,
      profileDirectory: routing.profileDirectory,
      profileName: routing.profileName,
      profileAliases: routing.profileAliases,
      updatedAt: new Date().toISOString(),
    }, options)
    : null;
  if (!signal) return { changed: false, skipped: true, reason: "no-usable-active-profile", path: activeChromeProfileFile(options) };
  const filePath = activeChromeProfileFile(options);
  const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const next = `${JSON.stringify(signal, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (before !== next) fs.writeFileSync(filePath, next, "utf8");
  return { changed: before !== next, skipped: false, path: filePath, signal };
}

function chromePluginScriptDirs(options = {}) {
  const dirs = [];
  for (const root of chromePluginCacheRoots(options)) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const scriptsDir = path.join(root, entry.name, "scripts");
      if (fs.existsSync(scriptsDir)) dirs.push(scriptsDir);
    }
  }
  return [...new Set(dirs)].sort();
}

function chromePluginCacheRoots(options = {}) {
  const home = options.home || os.homedir();
  return [
    path.join(home, ".codex", "plugins", "cache", "openai-bundled", "chrome"),
    path.join(home, ".codex", ".tmp", "bundled-marketplaces", "openai-bundled", "plugins", "chrome"),
  ];
}

function patchBundledChromeRouting(options = {}) {
  const results = [];
  const logger = options.logger || {};
  for (const scriptsDir of chromePluginScriptDirs(options)) {
    for (const filename of ["check-extension-installed.js", "open-chrome-window.js"]) {
      const filePath = path.join(scriptsDir, filename);
      if (!fs.existsSync(filePath)) continue;
      try {
        const before = fs.readFileSync(filePath, "utf8");
        const after = patchChromeScriptSource(before, { logger, filePath });
        const changed = after !== before;
        if (changed) fs.writeFileSync(filePath, after, "utf8");
        const patched = isFullyPatched(after);
        results.push({
          filePath,
          changed,
          patched,
          skipped: !patched,
          reason: patched ? (changed ? "patched" : "already-patched") : "anchors-missing-or-unpatchable",
        });
      } catch (error) {
        results.push({ filePath, changed: false, patched: false, skipped: true, error: error?.message || String(error) });
      }
    }
  }
  return results;
}

function auditBundledChromeRouting(options = {}) {
  const results = [];
  for (const scripts of currentBundledChromeScripts(options)) {
    for (const filePath of [scripts.checkExtension, scripts.openChromeWindow]) {
      if (!fs.existsSync(filePath)) continue;
      const source = fs.readFileSync(filePath, "utf8");
      const patched = isFullyPatched(source);
      results.push({ filePath, changed: false, patched, skipped: !patched, reason: patched ? "already-patched" : "unpatched-or-partial" });
    }
  }
  return results;
}

function isFullyPatched(source) {
  return Boolean(
    source &&
    source.includes(PATCH_BEGIN) &&
    source.includes(PATCH_END) &&
    source.includes(PATCH_VERSION) &&
    source.includes(HELPER_NAME) &&
    source.includes(CALLSITE_MARKER),
  );
}

function stripInjectedArtifacts(source) {
  let next = source;
  next = next.replace(new RegExp(`\\n?${escapeRegExp(PATCH_BEGIN)}[\\s\\S]*?${escapeRegExp(PATCH_END)}\\n?`, "g"), "\n");
  next = next.replace(new RegExp(`\\n\\s*const projectProfile = ${HELPER_NAME}\\(userDataDirectory\\);\\s*// ${CALLSITE_MARKER}\\n\\s*if \\(projectProfile\\) return projectProfile;\\n?`, "g"), "\n");
  next = next.replace(/\nconst PROJECT_CHROME_PROFILE_STORE = \[[\s\S]*?\];\n?/g, "\n");
  next = next.replace(new RegExp(`\\nfunction ${HELPER_NAME}\\(userDataDirectory\\) \\{[\\s\\S]*?\\nfunction resolveChromeProfileDirectoryFromLocalState\\(userDataDirectory\\) \\{`, "g"), "\nfunction resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {");
  next = next.replace(new RegExp(`\\n\\s*const projectProfile = ${HELPER_NAME}\\(userDataDirectory\\);\\n\\s*if \\(projectProfile\\) return projectProfile;\\n?`, "g"), "\n");
  return next.replace(/\n{3,}/g, "\n\n");
}

function patchChromeScriptSource(source, options = {}) {
  if (isFullyPatched(source)) return source;
  const logger = options.logger || {};
  const stripped = stripInjectedArtifacts(source);
  const callsiteAnchor = CALLSITE_ANCHORS.find((anchor) => stripped.includes(anchor));
  if (!callsiteAnchor) {
    logger.warn?.(`[projects] Chrome routing patch skipped; call-site anchor missing${options.filePath ? ` in ${options.filePath}` : ""}`);
    return source;
  }
  if (!stripped.includes(HELPER_ANCHOR)) {
    logger.warn?.(`[projects] Chrome routing patch skipped; helper anchor missing${options.filePath ? ` in ${options.filePath}` : ""}`);
    return source;
  }
  let next = stripped.replace(
    callsiteAnchor,
    [
      "function resolveChromeProfileDirectory(userDataDirectory) {",
      ...(callsiteAnchor.includes("getChromeProfileDirectoryOverride")
        ? [
          "  const envProfile = getChromeProfileDirectoryOverride(userDataDirectory);",
          "  if (envProfile) return envProfile;",
          "",
        ]
        : []),
      `  const projectProfile = ${HELPER_NAME}(userDataDirectory); // ${CALLSITE_MARKER}`,
      "  if (projectProfile) return projectProfile;",
      "",
      "  const localStateProfile =",
    ].join("\n"),
  );
  next = next.replace(HELPER_ANCHOR, `${projectStoreHelpers()}\n${HELPER_ANCHOR}`);
  return next;
}

function projectStoreHelpers() {
  return `
${PATCH_BEGIN}
function resolveChromeProfileDirectoryFromProjectStore(userDataDirectory) {
  try {
    const envPreferences = process.env?.CODEX_CHROME_PREFERENCES_PATH;
    const envProfile = profileFromPreferencesPath(userDataDirectory, envPreferences);
    if (envProfile) return envProfile.profileDirectory;
    if (envPreferences) warnProjectChromeProfile("Ignoring unusable CODEX_CHROME_PREFERENCES_PATH: " + envPreferences);

    const store = readJsonFileIfPresent(projectChromeProfileStorePath());
    const cwdAssignment = resolveProjectAssignment(store, process.cwd());
    const cwdProfile = firstPreferredProfile(cwdAssignment);
    if (isUsableProjectProfile(userDataDirectory, cwdProfile)) return cwdProfile.profileDirectory;
    if (cwdProfile) {
      warnProjectChromeProfile("Saved Chrome profile for " + (cwdAssignment?.projectPath || "this project") + " is unavailable: " + describeProjectProfile(cwdProfile) + ". Falling back.");
    }

    const activeProfile = activeChromeProjectProfile(userDataDirectory, process.cwd(), Boolean(cwdAssignment));
    if (activeProfile) return activeProfile.profileDirectory;

    const defaultProfile = firstPreferredProfile(store?.defaultProfile);
    if (isUsableProjectProfile(userDataDirectory, defaultProfile)) return defaultProfile.profileDirectory;
    if (defaultProfile) warnProjectChromeProfile("Default Chrome profile is unavailable: " + describeProjectProfile(defaultProfile) + ". Falling back.");
  } catch {}
  return null;
}

function projectChromeUserRoot() {
  if (process.env?.CODEX_PLUSPLUS_USER_ROOT) return path.resolve(process.env.CODEX_PLUSPLUS_USER_ROOT);
  if (process.env?.CODEX_PLUSPLUS_HOME) return path.resolve(process.env.CODEX_PLUSPLUS_HOME);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "codex-plusplus");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "codex-plusplus");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "codex-plusplus");
}

function projectChromeProfileStorePath() {
  return path.join(projectChromeUserRoot(), "storage", "co.thomashulihan.project-chrome-profile.json");
}

function activeChromeProjectProfilePath() {
  return path.join(projectChromeUserRoot(), "storage", "active-chrome-profile.json");
}

function activeChromeProjectProfile(userDataDirectory, currentProjectPath, currentProjectHasAssignment) {
  const signal = readJsonFileIfPresent(activeChromeProjectProfilePath());
  if (!signal || typeof signal !== "object") return null;
  if (typeof signal.projectPath !== "string" || !signal.projectPath.trim()) return null;
  const profile = profileFromPreferencesPath(userDataDirectory, signal.preferencesPath);
  if (!profile) {
    warnProjectChromeProfile("Ignoring unusable active Chrome profile signal for " + signal.projectPath + ".");
    return null;
  }
  if (typeof signal.profileDirectory === "string" && signal.profileDirectory && signal.profileDirectory !== profile.profileDirectory) {
    warnProjectChromeProfile("Ignoring mismatched active Chrome profile signal for " + signal.projectPath + ".");
    return null;
  }
  if (currentProjectHasAssignment && !projectPathMatches(signal.projectPath, currentProjectPath)) {
    warnProjectChromeProfile("Ignoring active Chrome profile from " + signal.projectPath + " while launching from " + currentProjectPath + ".");
    return null;
  }
  return profile;
}

function profileFromPreferencesPath(userDataDirectory, preferencesPath) {
  if (typeof preferencesPath !== "string" || !preferencesPath.trim()) return null;
  const resolved = path.resolve(preferencesPath);
  const profileDirectory = path.basename(path.dirname(resolved));
  const expected = path.join(userDataDirectory, profileDirectory, "Preferences");
  if (resolved !== expected) return null;
  if (!isUsableChromeProfile(userDataDirectory, profileDirectory)) return null;
  return { profileDirectory, preferencesPath: resolved };
}

function isUsableProjectProfile(userDataDirectory, profile) {
  return Boolean(profile?.profileDirectory && isUsableChromeProfile(userDataDirectory, profile.profileDirectory));
}

function projectPathMatches(parentPath, childPath) {
  try {
    const parent = path.resolve(parentPath);
    const child = path.resolve(childPath);
    return child === parent || child.startsWith(parent + path.sep);
  } catch {
    return false;
  }
}

function describeProjectProfile(profile) {
  return [profile?.profileName, profile?.profileDirectory].filter(Boolean).join(" / ") || "unknown profile";
}

function warnProjectChromeProfile(message) {
  try {
    console.warn("[project-chrome-profile] " + message);
  } catch {}
}

function resolveProjectAssignment(store, projectPath) {
  const assignments = store?.assignments;
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) return null;
  let normalized;
  try {
    normalized = path.resolve(projectPath);
  } catch {
    return null;
  }
  return Object.values(assignments)
    .filter((entry) => entry && typeof entry.projectPath === "string")
    .filter((entry) => normalized === entry.projectPath || normalized.startsWith(\`\${entry.projectPath}\${path.sep}\`))
    .sort((a, b) => b.projectPath.length - a.projectPath.length)[0] || null;
}

function firstPreferredProfile(assignment) {
  if (!assignment || typeof assignment !== "object") return null;
  if (Array.isArray(assignment.preferredProfiles) && assignment.preferredProfiles[0]) return assignment.preferredProfiles[0];
  if (Array.isArray(assignment.allowedProfiles) && assignment.allowedProfiles[0]) return assignment.allowedProfiles[0];
  return typeof assignment.profileDirectory === "string" ? assignment : null;
}
${PATCH_END}
`;
}

function currentBundledChromeScripts(options = {}) {
  return chromePluginScriptDirs(options).map((scriptsDir) => ({
    scriptsDir,
    checkExtension: path.join(scriptsDir, "check-extension-installed.js"),
    openChromeWindow: path.join(scriptsDir, "open-chrome-window.js"),
    nativeHostManifest: path.join(scriptsDir, "check-native-host-manifest.js"),
    ...extensionHostPaths(path.dirname(scriptsDir)),
  }));
}

function extensionHostPaths(pluginRoot) {
  const executable = process.platform === "win32" ? "extension-host.exe" : "extension-host";
  const platformDir = process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "windows"
      : "linux";
  const extensionHostBinary = path.join(pluginRoot, "extension-host", platformDir, process.arch, executable);
  return {
    extensionHostBinary,
    extensionHostConfig: path.join(path.dirname(extensionHostBinary), "extension-host-config.json"),
  };
}

function runJson(command, args, options = {}) {
  try {
    const stdout = childProcess.execFileSync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 10000,
    });
    return { ok: true, data: JSON.parse(stdout), stdout };
  } catch (error) {
    let data = null;
    try {
      data = JSON.parse(String(error.stdout || ""));
    } catch {}
    return {
      ok: false,
      exitCode: error.status ?? null,
      data,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
      message: error.message,
    };
  }
}

function verifyBundledChromeRouting(options = {}) {
  const patchResults = options.readOnly
    ? auditBundledChromeRouting(options)
    : patchBundledChromeRouting(options);
  const scripts = currentBundledChromeScripts(options)[0] || null;
  const defaultRouting = resolveChromeRouting("", options);
  const trrPath = options.trrPath || path.join(os.homedir(), "Projects", "TRR");
  const trrRouting = resolveChromeRouting(trrPath, options);
  const projectPath = typeof options.projectPath === "string" && options.projectPath.trim()
    ? path.resolve(options.projectPath)
    : null;
  const projectRouting = projectPath && projectPath !== trrPath
    ? resolveChromeRouting(projectPath, options)
    : null;
  const profileResults = [];
  const driftResults = [];
  if (scripts?.checkExtension && fs.existsSync(scripts.checkExtension)) {
    const routes = [defaultRouting, trrRouting, projectRouting].filter(Boolean);
    for (const routing of routes) {
      const result = runJson(process.execPath, [scripts.checkExtension, "--json"], {
        cwd: routing.projectPath || os.homedir(),
        env: routing.preferencesPath ? { CODEX_CHROME_PREFERENCES_PATH: routing.preferencesPath } : {},
      });
      profileResults.push({ projectPath: routing.projectPath || null, routing, check: result });
      if (routing.projectPath && routing.profileDirectory) {
        const drift = runJson(process.execPath, [scripts.checkExtension, "--json"], {
          cwd: routing.projectPath,
          env: { CODEX_CHROME_PREFERENCES_PATH: "" },
        });
        driftResults.push({
          projectPath: routing.projectPath,
          expectedProfileDirectory: routing.profileDirectory,
          selectedProfileDirectory: drift.data?.selectedProfileDirectory || null,
          ok: drift.ok && drift.data?.selectedProfileDirectory === routing.profileDirectory,
          check: drift,
        });
      }
    }
  }
  const backend = scripts?.nativeHostManifest && fs.existsSync(scripts.nativeHostManifest)
    ? runJson(process.execPath, [scripts.nativeHostManifest, "--json"], {})
    : { ok: false, message: "check-native-host-manifest.js not found" };
  const staleLocks = staleChromeLockReport(options);
  const result = {
    scripts: scripts || null,
    patchResults,
    routing: {
      default: defaultRouting,
      trr: trrRouting,
      project: projectRouting,
    },
    profile: profileResults,
    drift: driftResults,
    activeChromeProfile: readActiveChromeProfileSignal(options),
    backend,
    staleLocks,
    sections: {
      profile: profileResults.every((entry) => entry.routing.profileDirectory && entry.routing.preferencesPath) &&
        patchResults.every((entry) => entry.patched) &&
        driftResults.every((entry) => entry.ok),
      extension: profileResults.every((entry) => entry.check.ok && entry.check.data?.enabled === true),
      backend: backend.ok && backend.data?.correct === true,
      locks: staleLocks.staleSharedLockDirs.length === 0,
    },
  };
  result.fixes = chromeVerifierFixes(result);
  result.summary = chromeVerifierSummary(result);
  return result;
}

function chromeVerifierSummary(result) {
  const sections = result?.sections || {};
  const labels = [
    ["profile", "profile routing"],
    ["extension", "extension"],
    ["backend", "native backend"],
    ["locks", "shared locks"],
  ];
  return labels.map(([key, label]) => `${label}: ${sections[key] ? "ok" : "problem"}`).join("; ");
}

function chromeVerifierFixes(result) {
  const fixes = [];
  if (!result?.sections?.profile) {
    const unpatched = (result?.patchResults || []).filter((entry) => !entry.patched).length;
    const drifted = (result?.drift || []).filter((entry) => !entry.ok);
    fixes.push({
      section: "profile",
      status: "problem",
      action: unpatched
        ? "Run Chrome control repair so bundled @Chrome scripts receive the Project profile routing patch."
        : drifted.length
          ? `Chrome routing drifted from the saved project profile (${drifted.map((entry) => `${entry.expectedProfileDirectory} expected, ${entry.selectedProfileDirectory || "none"} selected`).join("; ")}).`
          : "Open Project Settings > Chrome Profile and save a valid profile for this project, or set the default Chrome profile.",
    });
  }
  if (!result?.sections?.extension) {
    const failed = (result?.profile || []).filter((entry) => !entry.check?.ok || entry.check?.data?.enabled !== true);
    const profileNames = failed.map((entry) => entry.routing?.profileName || entry.routing?.profileDirectory).filter(Boolean).join(", ");
    fixes.push({
      section: "extension",
      status: "problem",
      action: `Enable the Codex Chrome Extension in the selected profile${profileNames ? ` (${profileNames})` : ""}, then rerun the verifier.`,
    });
  }
  if (!result?.sections?.backend) {
    fixes.push({
      section: "backend",
      status: "problem",
      action: "Open Codex plugin settings, reinstall the @Chrome plugin, then rerun the verifier so the native host manifest is restored.",
    });
  }
  if (!result?.sections?.locks) {
    fixes.push({
      section: "locks",
      status: "problem",
      action: "Use the Repair stale locks button in Project Settings, then rerun the verifier.",
    });
  }
  if (!fixes.length) {
    fixes.push({
      section: "all",
      status: "ok",
      action: "No Chrome routing fixes needed.",
    });
  }
  return fixes;
}

function staleChromeLockReport(options = {}) {
  const home = options.home || os.homedir();
  const runtimeDir = options.runtimeDir || path.join(home, ".codex", "tmp", "chrome-devtools-global", "runtime");
  const dirLock = path.join(runtimeDir, "shared.lock.d");
  const pidFile = path.join(dirLock, "pid");
  const owner = fs.existsSync(pidFile) ? String(fs.readFileSync(pidFile, "utf8")).trim() : "";
  const stale = fs.existsSync(dirLock) && (!owner || !processExists(owner));
  return {
    runtimeDir,
    staleSharedLockDirs: stale ? [dirLock] : [],
  };
}

function repairStaleChromeLocks(options = {}) {
  const report = staleChromeLockReport(options);
  const removed = [];
  for (const dirPath of report.staleSharedLockDirs) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    removed.push(dirPath);
  }
  return {
    ...staleChromeLockReport(options),
    removed,
  };
}

function startChromePluginCacheWatcher(options = {}) {
  const home = options.home || os.homedir();
  const debounceMs = Number(options.debounceMs || 300);
  const logger = options.logger || {};
  const cleanup = [];
  let timer = null;
  const runPatch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const results = patchBundledChromeRouting({ home, logger });
        const changed = results.filter((result) => result.changed).length;
        if (changed) logger.info?.(`[projects] patched ${changed} bundled Chrome routing scripts after cache change`);
      } catch (error) {
        logger.warn?.("[projects] bundled Chrome routing watcher failed", error?.message || String(error));
      }
    }, debounceMs);
  };
  for (const root of [...chromePluginCacheRoots({ home }), ...chromePluginScriptDirs({ home })]) {
    try {
      fs.mkdirSync(root, { recursive: true });
      const watcher = fs.watch(root, { persistent: false }, runPatch);
      cleanup.push(() => watcher.close());
    } catch (error) {
      logger.warn?.(`[projects] could not watch Chrome plugin cache ${root}`, error?.message || String(error));
    }
  }
  cleanup.push(() => clearTimeout(timer));
  return () => {
    for (const stop of cleanup) {
      try {
        stop();
      } catch {}
    }
  };
}

function processExists(pid) {
  if (!/^[0-9]+$/.test(String(pid || ""))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  ACTIVE_PROFILE_FILENAME,
  CALLSITE_MARKER,
  PATCH_VERSION,
  activeChromeProfileFile,
  auditBundledChromeRouting,
  chromePluginCacheRoots,
  chromePluginScriptDirs,
  chromeVerifierFixes,
  chromeVerifierSummary,
  currentBundledChromeScripts,
  isFullyPatched,
  patchBundledChromeRouting,
  patchChromeScriptSource,
  readActiveChromeProfileSignal,
  repairStaleChromeLocks,
  resolveChromeRouting,
  stableActiveChromeProfileSignal: sanitizeActiveChromeProfileSignal,
  staleChromeLockReport,
  startChromePluginCacheWatcher,
  stripInjectedArtifacts,
  verifyBundledChromeRouting,
  writeActiveChromeProfileSignal,
};
