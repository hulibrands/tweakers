/* Project Chrome Profiles
 *
 * Persists a map of project paths to Chrome profile preferences files. The
 * Chrome plugin already honors CODEX_CHROME_PREFERENCES_PATH, so the managed
 * MCP helper can resolve the right value for agent/browser workflows.
 */

const TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const ASSIGNMENTS_KEY = "assignments";
const SIDEBAR_PROJECTS_KEY = "sidebarProjects";
const EXCLUDED_SIDEBAR_PROJECT_NAMES = new Set(["trr-app", "screenalytics"]);
const CLOUD_PROJECT_PREFIX = "cloud:";
let activeCleanup = [];

module.exports = {
  start(api) {
    activeCleanup = [];
    if (api.process === "main") {
      try {
        startMain(api, activeCleanup);
      } catch (error) {
        api.log?.error?.("[project-chrome-profile] main startup failed", error?.stack || error?.message || String(error));
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
};

function startMain(api, cleanup) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const childProcess = require("node:child_process");

  const normalizeProjectPath = (input) => {
    if (typeof input !== "string" || input.trim() === "") {
      throw new Error("Project path is required.");
    }
    if (input.startsWith("codex-sidebar://")) return input;
    return path.resolve(input.replace(/^~(?=$|\/|\\)/, os.homedir()));
  };

  const chromeUserDataDir = () => {
    if (process.env.CODEX_CHROME_USER_DATA_DIR) {
      return path.resolve(process.env.CODEX_CHROME_USER_DATA_DIR);
    }
    if (process.platform === "darwin") {
      return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
    }
    if (process.platform === "win32") {
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        "Google",
        "Chrome",
        "User Data",
      );
    }
    return path.join(os.homedir(), ".config", "google-chrome");
  };

  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };

  const listProfiles = () => {
    const userDataDir = chromeUserDataDir();
    const localState = readJson(path.join(userDataDir, "Local State"));
    const infoCache = localState?.profile?.info_cache || {};
    const ordered = Array.isArray(localState?.profile?.profiles_order)
      ? localState.profile.profiles_order
      : Object.keys(infoCache);
    const seen = new Set();
    const profiles = [];

    for (const directory of [...ordered, ...Object.keys(infoCache), "Default"]) {
      if (typeof directory !== "string" || seen.has(directory)) continue;
      seen.add(directory);
      const preferencesPath = path.join(userDataDir, directory, "Preferences");
      if (!fs.existsSync(preferencesPath)) continue;
      const metadata = infoCache[directory] || {};
      const email = typeof metadata.user_name === "string" ? metadata.user_name.trim() : "";
      const displayName = email || "guest";
      profiles.push({
        userDataDir,
        directory,
        name: displayName,
        email,
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
        profiles.push({
          userDataDir,
          directory: entry.name,
          name: entry.name === "Profile 21" ? "guest" : entry.name,
          email: "",
          preferencesPath,
          isLastUsed: false,
        });
      }
    }

    return profiles;
  };

  const sidebarProjectKey = (name) => {
    const slug = String(name || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `codex-sidebar://${slug || "project"}`;
  };

  const projectCandidates = () => {
    const candidates = [];
    const add = (projectPath, name, source = "local", allowVirtual = false) => {
      if (!projectPath || typeof projectPath !== "string") return;
      const resolved = normalizeProjectPath(projectPath);
      if (!allowVirtual && !resolved.startsWith("codex-sidebar://") && !fs.existsSync(resolved)) return;
      const label = name || (resolved.startsWith("codex-sidebar://") ? resolved.replace("codex-sidebar://", "") : path.basename(resolved));
      candidates.push({ name: label, projectPath: resolved, source });
    };

    const sidebarProjects = getSidebarProjects().filter((entry) => {
      if (!entry?.name) return false;
      if (isExcludedSidebarProjectName(entry.name)) return false;
      if (isCloudProjectPath(entry.projectPath)) return false;
      if (knownProjectPaths()[entry.name]) return true;
      return typeof entry.projectPath === "string" && !entry.projectPath.startsWith("codex-sidebar://");
    });
    if (sidebarProjects.length) {
      for (const entry of sidebarProjects) {
        const projectPath = entry.projectPath || sidebarProjectKey(entry.name);
        add(projectPath, entry.name, "sidebar", true);
      }
      const byPath = new Map();
      for (const candidate of candidates) byPath.set(candidate.projectPath, candidate);
      return [...byPath.values()];
    }

    for (const projectPath of readCodexProjectConfigPaths()) add(projectPath, path.basename(projectPath), "config");

    const commonRoots = [
      path.join(os.homedir(), "Projects"),
      path.join(os.homedir(), "Applications"),
      path.join(os.homedir(), "Documents", "Codex"),
      path.join(os.homedir(), "Downloads"),
    ];
    const interesting = /^(TRR|THB-BBL|PLUGINS|SKILLS MANAGER|codex-plusplus)$/i;
    for (const root of commonRoots) {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && interesting.test(entry.name)) {
          add(path.join(root, entry.name), entry.name, "local");
        }
      }
    }
    const byPath = new Map();
    for (const candidate of candidates) {
      if (!byPath.has(candidate.projectPath) || byPath.get(candidate.projectPath).source !== "sidebar") {
        byPath.set(candidate.projectPath, candidate);
      }
    }
    return [...byPath.values()].sort((a, b) => {
      const sourceScore = (v) => v.source === "sidebar" ? 0 : v.source === "config" ? 1 : 2;
      return sourceScore(a) - sourceScore(b) || a.name.localeCompare(b.name);
    });
  };

  const readCodexProjectConfigPaths = () => {
    const configPath = path.join(os.homedir(), ".codex", "config.toml");
    try {
      const config = fs.readFileSync(configPath, "utf8");
      return [...config.matchAll(/^\[projects\."([^"]+)"\]/gm)].map((match) => match[1]);
    } catch {
      return [];
    }
  };

  const knownProjectPaths = () => ({
    TRR: path.join(os.homedir(), "Projects", "TRR"),
    "THB-BBL": path.join(os.homedir(), "Projects", "THB-BBL"),
    PLUGINS: path.join(os.homedir(), "Projects", "PLUGINS"),
    "Google Takeout Visualization": path.join(os.homedir(), "Documents", "New project"),
    "SKILLS MANAGER": path.join(os.homedir(), "Projects", "SKILLS MANAGER"),
    "codex-plusplus": path.join(os.homedir(), "Applications", "codex-plusplus"),
  });

  const getSidebarProjects = () => {
    const value = api.storage.get(SIDEBAR_PROJECTS_KEY, []);
    return Array.isArray(value) ? value : [];
  };

  const saveSidebarProjects = (projects) => {
    const normalized = Array.isArray(projects)
      ? projects
          .filter((project) =>
            project &&
            typeof project.name === "string" &&
            !isExcludedSidebarProjectName(project.name) &&
            !isCloudProjectPath(project.projectPath)
          )
          .map((project) => ({
            name: project.name,
            projectPath: typeof project.projectPath === "string" ? project.projectPath : "",
            updatedAt: new Date().toISOString(),
          }))
      : [];
    api.storage.set(SIDEBAR_PROJECTS_KEY, normalized);
    return normalized;
  };

  const getAssignments = () => {
    const value = api.storage.get(ASSIGNMENTS_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };

  const setAssignments = (assignments) => {
    api.storage.set(ASSIGNMENTS_KEY, assignments);
    api.storage.set("updatedAt", new Date().toISOString());
  };

  const saveAssignment = (input) => {
    const projectPath = normalizeProjectPath(input?.projectPath);
    const preferencesPaths = normalizePreferencesPaths(input?.preferencesPaths || input?.preferencesPath);
    for (const preferencesPath of preferencesPaths) validatePreferencesPath(preferencesPath);
    const profiles = listProfiles();
    const allowedProfiles = preferencesPaths.map((preferencesPath) => {
      const profileDirectory = path.basename(path.dirname(preferencesPath));
      const profile = profiles.find((candidate) => candidate.preferencesPath === preferencesPath);
      return {
        profileDirectory,
        profileName: profile?.name || profileDirectory,
        preferencesPath,
        userDataDir: path.dirname(path.dirname(preferencesPath)),
      };
    });
    const primary = allowedProfiles[0];
    const assignments = getAssignments();
    assignments[projectPath] = {
      projectPath,
      profileDirectory: primary.profileDirectory,
      profileName: primary.profileName,
      preferencesPath: primary.preferencesPath,
      userDataDir: primary.userDataDir,
      profileDirectories: allowedProfiles.map((profile) => profile.profileDirectory),
      profileNames: allowedProfiles.map((profile) => profile.profileName),
      preferencesPaths,
      allowedProfiles,
      updatedAt: new Date().toISOString(),
    };
    setAssignments(assignments);
    const instructionFile = writeProjectInstruction(assignments[projectPath]);
    return { assignment: assignments[projectPath], instructionFile };
  };

  const resolveForProject = (projectPath) => {
    const project = normalizeProjectPath(projectPath);
    const assignments = getAssignments();
    const matches = Object.values(assignments)
      .filter((entry) => entry && typeof entry.projectPath === "string")
      .filter((entry) => project === entry.projectPath || project.startsWith(`${entry.projectPath}${path.sep}`))
      .sort((a, b) => b.projectPath.length - a.projectPath.length);
    return matches[0] || null;
  };

  cleanup.push(api.ipc.handle("listProfiles", () => listProfiles()));
  cleanup.push(api.ipc.handle("listProjects", () => projectCandidates()));
  cleanup.push(api.ipc.handle("cacheSidebarProjects", (projects) => saveSidebarProjects(projects)));
  cleanup.push(api.ipc.handle("getAssignments", () => getAssignments()));
  cleanup.push(api.ipc.handle("setAssignment", (input) => saveAssignment(input).assignment));
  cleanup.push(api.ipc.handle("saveAssignment", (input) => saveAssignment(input)));
  cleanup.push(api.ipc.handle("deleteAssignment", (projectPathInput) => {
    const projectPath = normalizeProjectPath(projectPathInput);
    const assignments = getAssignments();
    delete assignments[projectPath];
    setAssignments(assignments);
    removeProjectInstruction(projectPath);
    return true;
  }));
  cleanup.push(api.ipc.handle("resolveForProject", (projectPath) => resolveForProject(projectPath)));
  cleanup.push(api.ipc.handle("createProfileForProject", (input) => {
    const projectPath = normalizeProjectPath(input?.projectPath);
    const projectName = String(input?.projectName || (projectPath.startsWith("codex-sidebar://") ? projectPath.replace("codex-sidebar://", "") : path.basename(projectPath)));
    const profiles = listProfiles();
    const nextNumber = profiles.reduce((max, profile) => {
      const match = /^Profile (\d+)$/.exec(profile.directory);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const profileDirectory = `Profile ${nextNumber}`;
    const userDataDir = chromeUserDataDir();
    const preferencesPath = path.join(userDataDir, profileDirectory, "Preferences");
    openChromeProfile(profileDirectory);
    const assignments = getAssignments();
    assignments[projectPath] = {
      projectPath,
      profileDirectory,
      profileName: projectName,
      preferencesPath,
      userDataDir,
      profileDirectories: [profileDirectory],
      profileNames: [projectName],
      preferencesPaths: [preferencesPath],
      allowedProfiles: [{ profileDirectory, profileName: projectName, preferencesPath, userDataDir }],
      pendingCreation: true,
      updatedAt: new Date().toISOString(),
    };
    setAssignments(assignments);
    return assignments[projectPath];
  }));

  const openChromeProfile = (profileDirectory) => {
    const args = [`--profile-directory=${profileDirectory}`, "--new-window", "chrome://settings/manageProfile"];
    if (process.platform === "darwin") {
      childProcess.spawn("open", ["-n", "-a", "Google Chrome", "--args", ...args], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return;
    }
    const command = process.platform === "win32" ? "chrome.exe" : "google-chrome";
    childProcess.spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  };

  const writeProjectInstruction = (assignment) => {
    if (!assignment?.projectPath || assignment.projectPath.startsWith("codex-sidebar://")) {
      throw new Error("This sidebar project does not have a local project path yet. Go back to the Codex projects sidebar once, then reopen PLUGIN PROFILES.");
    }
    const projectPath = normalizeProjectPath(assignment.projectPath);
    const agentsFile = path.join(projectPath, "AGENTS.md");
    const target = agentsFile;
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    const allowedProfiles = normalizeAssignmentProfiles(assignment);
    const profileList = allowedProfiles
      .map((profile) => `"${profile.profileName}" (${profile.profileDirectory})`)
      .join(", ");
    const primary = allowedProfiles[0];
    const block =
      "<!-- codex-plugin-profiles:start -->\n" +
      "## Plugin Profiles\n" +
      `- For any Codex [@Chrome](plugin://chrome@openai-bundled), [@gmail](plugin://gmail@openai-curated), [@google-drive](plugin://google-drive@openai-curated), or other Google Workspace tool session in this project, use one of these allowed Chrome profiles: ${profileList}.\n` +
      `- Set CODEX_CHROME_PREFERENCES_PATH="${primary.preferencesPath}" before launching Chrome-backed tools unless the user asks for another allowed profile.\n` +
      "- This project-level profile assignment applies broadly to @Chrome usage from this project, not only to any one scraper or workflow.\n" +
      "<!-- codex-plugin-profiles:end -->";
    const pattern = /<!-- codex-plugin-profiles:start -->[\s\S]*?<!-- codex-plugin-profiles:end -->/;
    const next = pattern.test(existing)
      ? existing.replace(pattern, block)
      : `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n\n" : ""}${block}\n`;
    fs.writeFileSync(target, next);
    removeLegacyProjectInstruction(projectPath);
    return target;
  };

  const normalizePreferencesPath = (input) => {
    if (typeof input !== "string" || input.trim() === "") {
      throw new Error("Chrome Preferences file is required.");
    }
    return path.resolve(input.trim().replace(/^~(?=$|\/|\\)/, os.homedir()));
  };

  const normalizePreferencesPaths = (input) => {
    const values = Array.isArray(input) ? input : [input];
    const normalized = [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map(normalizePreferencesPath))];
    if (normalized.length === 0) throw new Error("At least one Chrome Preferences file is required.");
    return normalized;
  };

  const normalizeAssignmentProfiles = (assignment) => {
    if (Array.isArray(assignment?.allowedProfiles) && assignment.allowedProfiles.length) {
      return assignment.allowedProfiles;
    }
    return [{
      profileDirectory: assignment.profileDirectory,
      profileName: assignment.profileName,
      preferencesPath: assignment.preferencesPath,
      userDataDir: assignment.userDataDir,
    }];
  };

  const validatePreferencesPath = (preferencesPath) => {
    if (path.basename(preferencesPath) !== "Preferences") {
      throw new Error(`Chrome Preferences path must end with "Preferences": ${preferencesPath}`);
    }
    let stat;
    try {
      stat = fs.statSync(preferencesPath);
    } catch {
      throw new Error(`Chrome Preferences file does not exist: ${preferencesPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Chrome Preferences path must be a file, not a directory: ${preferencesPath}`);
    }
  };

  const removeProjectInstruction = (projectPathInput) => {
    if (!projectPathInput || projectPathInput.startsWith("codex-sidebar://")) return null;
    const projectPath = normalizeProjectPath(projectPathInput);
    const files = [path.join(projectPath, "AGENTS.md"), path.join(projectPath, "RULES.md")];
    let changed = false;
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const existing = fs.readFileSync(file, "utf8");
      const next = removeManagedInstructionBlock(existing);
      if (next === existing) continue;
      fs.writeFileSync(file, next);
      changed = true;
    }
    return changed;
  };

  const removeLegacyProjectInstruction = (projectPath) => {
    const rulesFile = path.join(projectPath, "RULES.md");
    if (!fs.existsSync(rulesFile)) return false;
    const existing = fs.readFileSync(rulesFile, "utf8");
    const next = removeManagedInstructionBlock(existing);
    if (next === existing) return false;
    fs.writeFileSync(rulesFile, next);
    return true;
  };

  const removeManagedInstructionBlock = (content) => {
    return String(content || "")
      .replace(/\n{0,2}<!-- codex-plugin-profiles:start -->[\s\S]*?<!-- codex-plugin-profiles:end -->\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .replace(/\s+$/, (match) => (match.includes("\n") ? "\n" : ""));
  };

}

function startRenderer(api, cleanup) {
  const projectScan = startSidebarProjectScanner(api);
  cleanup.push(projectScan);

  if (typeof api.settings?.registerPage !== "function") {
    api.log?.warn?.("[project-chrome-profile] registerPage unavailable; settings UI not mounted.");
    return;
  }

  const handle = api.settings.registerPage({
    id: "main",
    title: "PLUGIN PROFILES",
    description: "Route Chrome-backed Google work through the right local profile.",
    iconSvg:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M10 17a7 7 0 0 0 6.06-3.5H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M3.94 6.5 7.5 12.66" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M16.06 6.5H8.94" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>',
    render(root) {
      renderPage(root, api).catch((error) => {
        root.textContent = error instanceof Error ? error.message : String(error);
      });
    },
  });
  cleanup.push(() => handle.unregister());
}

async function renderPage(root, api) {
  root.innerHTML = "";
  root.className = "flex flex-col gap-4";

  const [profiles, assignments, projects] = await Promise.all([
    api.ipc.invoke("listProfiles"),
    api.ipc.invoke("getAssignments"),
    api.ipc.invoke("listProjects"),
  ]);

  const titleRow = document.createElement("div");
  titleRow.className = "flex h-toolbar items-center justify-between gap-2 px-0 py-0";
  const titleInner = document.createElement("div");
  titleInner.className = "flex min-w-0 flex-1 flex-col gap-1";
  const title = document.createElement("div");
  title.className = "text-base font-medium text-token-text-primary";
  title.textContent = "Assignments";
  const subtitle = document.createElement("div");
  subtitle.className = "text-token-text-secondary text-sm";
  subtitle.textContent = "Each Codex sidebar project can allow one or more Chrome accounts.";
  titleInner.append(title, subtitle);
  titleRow.appendChild(titleInner);
  root.appendChild(titleRow);

  const card = document.createElement("div");
  card.className =
    "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border";
  card.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";
  root.appendChild(card);

  const list = document.createElement("div");
  list.className = "flex flex-col";
  card.appendChild(list);

  const rerender = () => renderPage(root, api);

  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "p-3 text-sm text-token-text-secondary";
    empty.textContent = "No Codex sidebar projects found yet. Go back to the app once, then reopen this page.";
    list.appendChild(empty);
    return;
  }

  for (const projectEntry of projects) {
    const assignment = assignments[projectEntry.projectPath];
    const item = document.createElement("div");
    item.className = "flex items-center justify-between gap-4 p-3";
    const left = document.createElement("div");
    left.className = "flex min-w-0 flex-col gap-1";
    const project = document.createElement("div");
    project.className = "min-w-0 truncate text-sm text-token-text-primary";
    project.textContent = projectEntry.name;
    const profile = document.createElement("div");
    profile.className = "text-token-text-secondary min-w-0 truncate text-sm";
    profile.textContent = projectEntry.projectPath.startsWith("codex-sidebar://")
      ? "Sidebar project"
      : projectEntry.projectPath;
    left.append(project, profile);

    const controls = document.createElement("div");
    controls.className = "flex shrink-0 flex-wrap items-center justify-end gap-2";
    const selectedProfiles = assignment?.preferencesPaths || (assignment?.preferencesPath ? [assignment.preferencesPath] : []);
    const select = profileSelectControl(profiles, selectedProfiles);
    const save = button("Save");
    save.addEventListener("click", async () => {
      const preferencesPaths = [...select.selectedOptions].map((option) => option.value).filter(Boolean);
      if (!preferencesPaths.length) return;
      await api.ipc.invoke("saveAssignment", {
        projectPath: projectEntry.projectPath,
        preferencesPaths,
      });
      await rerender();
    });
    const add = button("Add profile");
    add.addEventListener("click", async () => {
      await api.ipc.invoke("createProfileForProject", {
        projectPath: projectEntry.projectPath,
        projectName: projectEntry.name,
      });
      await rerender();
    });
    controls.append(select, save, add);
    if (assignment) {
      const remove = dangerPill("Clear");
      remove.addEventListener("click", async () => {
        await api.ipc.invoke("deleteAssignment", projectEntry.projectPath);
        await rerender();
      });
      controls.appendChild(remove);
    }
    item.append(left, controls);
    list.appendChild(item);
  }
}

function profileSelectControl(profiles, selected) {
  const select = document.createElement("select");
  const selectedValues = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
  select.className =
    "border-token-border bg-token-foreground/5 min-h-token-button-composer max-w-[320px] rounded-md border px-3 py-1 text-sm text-token-text-primary";
  select.multiple = true;
  select.size = Math.min(Math.max(profiles.length, 2), 6);
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select Chrome accounts";
  empty.disabled = true;
  select.appendChild(empty);
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.preferencesPath;
    option.textContent = profile.name;
    if (selectedValues.has(profile.preferencesPath)) option.selected = true;
    select.appendChild(option);
  }
  return select;
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

function scanSidebarProjectsFromDom() {
  const headers = Array.from(document.querySelectorAll("div,span,p"))
    .filter((el) => compactText(el.textContent) === "Projects");
  for (const header of headers) {
    const projects = [];
    const seen = new Set();
    for (const node of sidebarProjectNodesForHeader(header)) {
      const project = projectFromSidebarNode(node);
      if (project && !seen.has(project.projectPath)) {
        seen.add(project.projectPath);
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
    .filter((el) => ["Chats", "Settings"].includes(compactText(el.textContent)))
    .map((el) => ({ el, rect: el.getBoundingClientRect?.() }))
    .filter(({ rect }) => rect && rect.height > 0 && rect.top >= (headerRect?.bottom ?? 0))
    .sort((a, b) => a.rect.top - b.rect.top)[0];
  if (headerRect && boundary?.rect) {
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
    if (text === "Chats" || text === "Settings") break;
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
    projectPath: projectId && !projectId.startsWith("cloud:") ? projectId : guessProjectPath(name),
  };
}

function cleanProjectLabel(value, projectPath = "") {
  let label = normalizeLegacyBrandText(compactText(value)).replace(/\s+New project$/, "");
  if (projectPath && !projectPath.startsWith("codex-sidebar://")) {
    const basename = projectPath.split(/[\\/]/).filter(Boolean).pop();
    if (basename) {
      label = label.replace(new RegExp(`\\s+${escapeRegExp(basename)}$`, "i"), "");
    }
  }
  return label;
}

function normalizeLegacyBrandText(value) {
  const token = ["Code", "MAXXER"].join("");
  return String(value || "").replace(new RegExp(token, "gi"), "Codex++");
}

function guessProjectPath(name) {
  const explicit = {
    "Menu Bar": "/Users/thomashulihan/Projects/Menu Bar",
    TRR: "/Users/thomashulihan/Projects/TRR",
    "THB-BBL": "/Users/thomashulihan/Projects/THB-BBL",
    PLUGINS: "/Users/thomashulihan/Projects/PLUGINS",
    "Google Takeout Visualization": "/Users/thomashulihan/Documents/New project",
    "SKILLS MANAGER": "/Users/thomashulihan/Projects/SKILLS MANAGER",
    "codex-mogger": "/Users/thomashulihan/Applications/codex-plusplus",
    "codex-plusplus": "/Users/thomashulihan/Applications/codex-plusplus",
  };
  if (explicit[name]) return explicit[name];
  const slug = String(name || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `codex-sidebar://${slug || "project"}`;
}

function isExcludedSidebarProjectName(name) {
  return EXCLUDED_SIDEBAR_PROJECT_NAMES.has(String(name || "").trim().toLowerCase());
}

function isCloudProjectPath(projectPath) {
  return typeof projectPath === "string" && projectPath.trim().toLowerCase().startsWith(CLOUD_PROJECT_PREFIX);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function input(label, placeholder) {
  const el = document.createElement("input");
  el.type = "text";
  el.placeholder = placeholder || label;
  el.setAttribute("aria-label", label);
  el.className =
    "border-token-border bg-token-foreground/5 h-token-button-composer min-w-[280px] rounded-md border px-3 text-sm text-token-text-primary";
  return el;
}

function button(label) {
  const el = document.createElement("button");
  el.type = "button";
  el.className =
    "h-token-button-composer rounded-md bg-token-text-primary px-3 text-sm font-medium text-token-main-surface-primary cursor-interaction";
  el.textContent = label;
  return el;
}

function dangerPill(label) {
  const el = document.createElement("button");
  el.type = "button";
  el.className =
    "rounded-full px-2 py-0.5 text-sm bg-token-charts-red/10 text-token-charts-red hover:bg-token-charts-red/20 cursor-interaction";
  el.textContent = label;
  return el;
}
