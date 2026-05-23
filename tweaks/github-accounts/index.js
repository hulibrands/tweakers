/* GitHub Accounts
 *
 * Lets the user map Codex projects to GitHub identities. Saving an assignment
 * writes a managed project instruction block and can apply repo-local Git
 * commit identity through `.git/config`.
 */

const ACCOUNTS_KEY = "accounts";
const ASSIGNMENTS_KEY = "assignments";
const SIDEBAR_PROJECTS_KEY = "sidebarProjects";
const CLOUD_PROJECT_PREFIX = "cloud:";
const EXCLUDED_SIDEBAR_PROJECT_NAMES = new Set(["trr-app", "screenalytics"]);

let activeCleanup = [];

module.exports = {
  start(api) {
    activeCleanup = [];
    if (api.process === "main") {
      try {
        startMain(api, activeCleanup);
      } catch (error) {
        api.log?.error?.("[github-accounts] main startup failed", error?.stack || error?.message || String(error));
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

  const safeExec = (command, args, options = {}) => {
    try {
      return childProcess.execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        ...options,
      }).trim();
    } catch {
      return "";
    }
  };

  const gitRootForProject = (projectPath) => {
    if (!projectPath || projectPath.startsWith("codex-sidebar://")) return null;
    const resolved = normalizeProjectPath(projectPath);
    const root = safeExec("git", ["-C", resolved, "rev-parse", "--show-toplevel"]);
    if (root) return path.resolve(root);
    let current = resolved;
    while (current && current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, ".git"))) return current;
      current = path.dirname(current);
    }
    return null;
  };

  const gitLocalValue = (gitRoot, key) => safeExec("git", ["-C", gitRoot, "config", "--local", "--get", key]);

  const runGitConfig = (gitRoot, key, value) => {
    try {
      childProcess.execFileSync("git", ["-C", gitRoot, "config", "--local", key, value], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, key };
    } catch (error) {
      return { ok: false, key, error: formatExecError(error) };
    }
  };

  const formatExecError = (error) => {
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    const stdout = error?.stdout ? String(error.stdout).trim() : "";
    const details = [stderr, stdout, error?.message ? String(error.message) : ""].filter(Boolean);
    return details[0] || "git config failed.";
  };

  const readGitIdentity = (projectPath) => {
    const gitRoot = gitRootForProject(projectPath);
    if (!gitRoot) return { gitRoot: null, hasGitRepo: false };
    return {
      gitRoot,
      hasGitRepo: true,
      name: gitLocalValue(gitRoot, "user.name") || "",
      email: gitLocalValue(gitRoot, "user.email") || "",
      username: gitLocalValue(gitRoot, "github.user") || "",
    };
  };

  const applyGitIdentity = (projectPath, account) => {
    const gitRoot = gitRootForProject(projectPath);
    if (!gitRoot) {
      return { applied: false, reason: "No Git repository found for this project." };
    }
    const results = [
      runGitConfig(gitRoot, "user.name", account.name),
      runGitConfig(gitRoot, "user.email", account.email),
    ];
    if (account.username) {
      results.push(runGitConfig(gitRoot, "github.user", account.username));
    }
    const failures = results.filter((result) => !result.ok);
    if (failures.length) {
      return {
        applied: false,
        gitRoot,
        reason: `Git config failed for ${failures.map((failure) => failure.key).join(", ")}.`,
        errors: failures,
      };
    }
    return { applied: true, gitRoot };
  };

  const globalGitAccount = () => {
    const name = safeExec("git", ["config", "--global", "--get", "user.name"]);
    const email = safeExec("git", ["config", "--global", "--get", "user.email"]);
    const username = safeExec("git", ["config", "--global", "--get", "github.user"]);
    if (!name && !email && !username) return null;
    return {
      id: slugify(username || email || name || "global"),
      name: name || username || "Global Git",
      username,
      email,
      source: "global-git",
      updatedAt: new Date().toISOString(),
    };
  };

  const getAccounts = () => {
    const allStorage = typeof api.storage.all === "function" ? api.storage.all() : {};
    if (Object.prototype.hasOwnProperty.call(allStorage, ACCOUNTS_KEY)) {
      const stored = api.storage.get(ACCOUNTS_KEY, []);
      return Array.isArray(stored) ? stored.filter(isAccount) : [];
    }
    const seeded = globalGitAccount();
    if (seeded) setAccounts([seeded]);
    return seeded ? [seeded] : [];
  };

  const setAccounts = (accounts) => {
    api.storage.set(ACCOUNTS_KEY, accounts.filter(isAccount));
    api.storage.set("updatedAt", new Date().toISOString());
  };

  const saveAccount = (input) => {
    const name = String(input?.name || "").trim();
    const email = String(input?.email || "").trim();
    const username = String(input?.username || "").trim().replace(/^@/, "");
    if (!name) throw new Error("Account name is required.");
    if (!email) throw new Error("Commit email is required.");
    if (!isValidCommitEmail(email)) throw new Error(`Commit email is invalid: ${email}`);
    const id = String(input?.id || slugify(username || email || name)).trim();
    const accounts = getAccounts();
    const existing = accounts.findIndex((account) => account.id === id);
    const next = {
      id,
      name,
      email,
      username,
      updatedAt: new Date().toISOString(),
    };
    if (existing >= 0) accounts[existing] = next;
    else accounts.push(next);
    setAccounts(accounts);
    return next;
  };

  const deleteAccount = (accountId) => {
    const id = String(accountId || "");
    const accounts = getAccounts().filter((account) => account.id !== id);
    const assignments = getAssignments();
    for (const key of Object.keys(assignments)) {
      if (assignments[key]?.accountId === id) {
        removeProjectInstruction(assignments[key].projectPath || key);
        delete assignments[key];
      }
    }
    setAccounts(accounts);
    setAssignments(assignments);
    return true;
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
    const accountId = String(input?.accountId || "");
    const account = getAccounts().find((candidate) => candidate.id === accountId);
    if (!account) throw new Error("Select a GitHub account first.");
    const assignments = getAssignments();
    const projectName = String(input?.projectName || projectLabel(projectPath));
    const applyGit = input?.applyGit !== false;
    const gitResult = applyGit ? applyGitIdentity(projectPath, account) : { applied: false, skipped: true };
    const instructionFile = writeProjectInstruction(projectPath, projectName, account, gitResult);
    assignments[projectPath] = {
      projectPath,
      projectName,
      accountId: account.id,
      accountName: account.name,
      githubUsername: account.username,
      email: account.email,
      gitRoot: gitResult.gitRoot || readGitIdentity(projectPath).gitRoot || null,
      gitIdentityApplied: Boolean(gitResult.applied),
      instructionFile,
      updatedAt: new Date().toISOString(),
    };
    setAssignments(assignments);
    return { assignment: assignments[projectPath], gitResult, instructionFile };
  };

  const deleteAssignment = (projectPathInput) => {
    const projectPath = normalizeProjectPath(projectPathInput);
    const assignments = getAssignments();
    delete assignments[projectPath];
    setAssignments(assignments);
    removeProjectInstruction(projectPath);
    return true;
  };

  const resolveForProject = (projectPathInput) => {
    const project = normalizeProjectPath(projectPathInput);
    const assignments = getAssignments();
    const matches = Object.values(assignments)
      .filter((entry) => entry && typeof entry.projectPath === "string")
      .filter((entry) => project === entry.projectPath || project.startsWith(`${entry.projectPath}${path.sep}`))
      .sort((a, b) => b.projectPath.length - a.projectPath.length);
    const assignment = matches[0] || null;
    if (!assignment) return null;
    const account = getAccounts().find((candidate) => candidate.id === assignment.accountId) || null;
    return { ...assignment, account };
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
    Codex: path.join(os.homedir(), "Applications", "codex"),
    ShadGPT: path.join(os.homedir(), "Applications", ["codex", "plusplus"].join("-")),
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

  const projectCandidates = () => {
    const candidates = [];
    const add = (projectPath, name, source = "local", allowVirtual = false) => {
      if (!projectPath || typeof projectPath !== "string") return;
      const resolved = normalizeProjectPath(projectPath);
      if (!allowVirtual && !resolved.startsWith("codex-sidebar://") && !fs.existsSync(resolved)) return;
      candidates.push({
        name: name || projectLabel(resolved),
        projectPath: resolved,
        source,
        git: readGitIdentity(resolved),
      });
    };

    for (const entry of getSidebarProjects()) {
      if (!entry?.name) continue;
      if (isExcludedSidebarProjectName(entry.name) || isCloudProjectPath(entry.projectPath)) continue;
      add(entry.projectPath || sidebarProjectKey(entry.name), entry.name, "sidebar", true);
    }
    for (const projectPath of readCodexProjectConfigPaths()) add(projectPath, path.basename(projectPath), "config");
    for (const [name, projectPath] of Object.entries(knownProjectPaths())) add(projectPath, name, "known");

    const commonRoots = [
      path.join(os.homedir(), "Projects"),
      path.join(os.homedir(), "Applications"),
      path.join(os.homedir(), "Documents", "Codex"),
    ];
    const codexSourceDir = "codex";
    const shadGPTSourceDir = ["codex", "plusplus"].join("-");
    const interesting = new RegExp(
      `^(TRR|THB-BBL|PLUGINS|SKILLS MANAGER|${escapeRegExp(codexSourceDir)}|${escapeRegExp(shadGPTSourceDir)})$`,
      "i",
    );
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
      const current = byPath.get(candidate.projectPath);
      if (!current || sourceScore(candidate.source) < sourceScore(current.source)) {
        byPath.set(candidate.projectPath, candidate);
      }
    }
    return [...byPath.values()].sort((a, b) => {
      return sourceScore(a.source) - sourceScore(b.source) || a.name.localeCompare(b.name);
    });
  };

  const writeProjectInstruction = (projectPathInput, projectName, account, gitResult) => {
    if (!projectPathInput || projectPathInput.startsWith("codex-sidebar://")) return null;
    const projectPath = normalizeProjectPath(projectPathInput);
    if (!fs.existsSync(projectPath)) return null;
    const agentsFile = path.join(projectPath, "AGENTS.md");
    const target = agentsFile;
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    const usernamePart = account.username ? ` GitHub username: @${account.username}.` : "";
    const gitPart = gitResult?.applied
      ? ` Project-local Git identity was applied in ${gitResult.gitRoot}.`
      : ` Project-local Git identity was not applied automatically${gitResult?.reason ? `: ${singleLine(gitResult.reason)}` : ""}.`;
    const block =
      "<!-- codex-github-accounts:start -->\n" +
      "## GitHub Account Assignment\n" +
      `- For GitHub work in this project, use the GitHub account "${account.name}".${usernamePart}\n` +
      `- Use commit identity: ${account.name} <${account.email}>.\n` +
      "- Before creating commits, pull requests, releases, or GitHub issues from this project, verify the active GitHub CLI/auth account matches this assignment.\n" +
      `- Assignment source: ShadGPT GitHub Accounts tweak for "${projectName || projectLabel(projectPath)}".${gitPart}\n` +
      "<!-- codex-github-accounts:end -->";
    const pattern = /<!-- codex-github-accounts:start -->[\s\S]*?<!-- codex-github-accounts:end -->/;
    const next = pattern.test(existing)
      ? existing.replace(pattern, block)
      : `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n\n" : ""}${block}\n`;
    fs.writeFileSync(target, next);
    removeLegacyProjectInstruction(projectPath);
    return target;
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
      .replace(/\n{0,2}<!-- codex-github-accounts:start -->[\s\S]*?<!-- codex-github-accounts:end -->\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .replace(/\s+$/, (match) => (match.includes("\n") ? "\n" : ""));
  };

  const singleLine = (value) => String(value || "").replace(/\s+/g, " ").trim();

  cleanup.push(api.ipc.handle("listAccounts", () => getAccounts()));
  cleanup.push(api.ipc.handle("saveAccount", (input) => saveAccount(input)));
  cleanup.push(api.ipc.handle("deleteAccount", (accountId) => deleteAccount(accountId)));
  cleanup.push(api.ipc.handle("listProjects", () => projectCandidates()));
  cleanup.push(api.ipc.handle("cacheSidebarProjects", (projects) => saveSidebarProjects(projects)));
  cleanup.push(api.ipc.handle("getAssignments", () => getAssignments()));
  cleanup.push(api.ipc.handle("saveAssignment", (input) => saveAssignment(input)));
  cleanup.push(api.ipc.handle("deleteAssignment", (projectPathInput) => deleteAssignment(projectPathInput)));
  cleanup.push(api.ipc.handle("resolveForProject", (projectPathInput) => resolveForProject(projectPathInput)));

  function projectLabel(projectPath) {
    return projectPath.startsWith("codex-sidebar://") ? projectPath.replace("codex-sidebar://", "") : path.basename(projectPath);
  }

  function sidebarProjectKey(name) {
    const slug = slugify(name || "project");
    return `codex-sidebar://${slug || "project"}`;
  }
}

function startRenderer(api, cleanup) {
  const projectScan = startSidebarProjectScanner(api);
  cleanup.push(projectScan);

  if (typeof api.settings?.registerPage !== "function") {
    api.log?.warn?.("[github-accounts] registerPage unavailable; settings UI not mounted.");
    return;
  }

  const handle = api.settings.registerPage({
    id: "main",
    title: "GITHUB ACCOUNTS",
    description: "Assign each Codex project to the GitHub account it should use.",
    iconSvg:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M10 2.5a7.5 7.5 0 0 0-2.37 14.62c.37.07.5-.16.5-.36v-1.4c-2.05.45-2.48-.86-2.48-.86-.34-.86-.82-1.09-.82-1.09-.67-.46.05-.45.05-.45.74.05 1.13.76 1.13.76.66 1.12 1.72.8 2.14.61.07-.48.26-.8.47-.99-1.64-.19-3.36-.82-3.36-3.64 0-.8.29-1.46.76-1.98-.08-.18-.33-.94.07-1.95 0 0 .62-.2 2.04.76A7 7 0 0 1 10 6.79c.63 0 1.26.08 1.85.25 1.42-.96 2.04-.76 2.04-.76.4 1.01.15 1.77.07 1.95.47.52.76 1.18.76 1.98 0 2.83-1.73 3.45-3.38 3.63.27.23.51.69.51 1.39v1.53c0 .2.13.43.51.36A7.5 7.5 0 0 0 10 2.5Z" fill="currentColor"/>' +
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

  const [accounts, assignments, projects] = await Promise.all([
    api.ipc.invoke("listAccounts"),
    api.ipc.invoke("getAssignments"),
    api.ipc.invoke("listProjects"),
  ]);
  const status = statusLine();
  const rerender = () => renderPage(root, api);

  root.appendChild(sectionTitle("Accounts", "Add the GitHub identities Codex should use for commits and GitHub work."));
  root.appendChild(renderAccountsCard(api, accounts, status, rerender));
  root.appendChild(sectionTitle("Project assignments", "Choose the account for each Codex project."));
  root.appendChild(renderAssignmentsCard(api, accounts, assignments, projects, status, rerender));
  root.appendChild(status);
}

function renderAccountsCard(api, accounts, status, rerender) {
  const card = groupedCard();
  const list = document.createElement("div");
  list.className = "flex flex-col";
  card.appendChild(list);

  if (!accounts.length) {
    const empty = document.createElement("div");
    empty.className = "p-3 text-sm text-token-text-secondary";
    empty.textContent = "No GitHub accounts saved yet.";
    list.appendChild(empty);
  }

  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-4 p-3";
    const left = document.createElement("div");
    left.className = "flex min-w-0 flex-col gap-1";
    const title = document.createElement("div");
    title.className = "min-w-0 truncate text-sm text-token-text-primary";
    title.textContent = account.name;
    const desc = document.createElement("div");
    desc.className = "text-token-text-secondary min-w-0 truncate text-sm";
    desc.textContent = [account.username ? `@${account.username}` : "", account.email].filter(Boolean).join(" · ");
    left.append(title, desc);
    const remove = dangerPill("Delete");
    remove.addEventListener("click", async () => {
      await api.ipc.invoke("deleteAccount", account.id);
      status.textContent = `Deleted ${account.name}.`;
      await rerender();
    });
    row.append(left, remove);
    list.appendChild(row);
  }

  const form = document.createElement("div");
  form.className = "flex flex-wrap items-center gap-2 p-3";
  const name = input("Display name", "Display name");
  const username = input("GitHub username", "GitHub username");
  const email = input("Commit email", "Commit email");
  const save = button("Add account");
  save.addEventListener("click", async () => {
    const account = await api.ipc.invoke("saveAccount", {
      name: name.value,
      username: username.value,
      email: email.value,
    });
    status.textContent = `Saved ${account.name}.`;
    await rerender();
  });
  form.append(name, username, email, save);
  list.appendChild(form);

  return card;
}

function renderAssignmentsCard(api, accounts, assignments, projects, status, rerender) {
  const card = groupedCard();
  const list = document.createElement("div");
  list.className = "flex flex-col";
  card.appendChild(list);

  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "p-3 text-sm text-token-text-secondary";
    empty.textContent = "No Codex sidebar projects found yet. Go back to the app once, then reopen this page.";
    list.appendChild(empty);
    return card;
  }

  for (const projectEntry of projects) {
    const assignment = assignments[projectEntry.projectPath];
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-4 p-3";

    const left = document.createElement("div");
    left.className = "flex min-w-0 flex-col gap-1";
    const project = document.createElement("div");
    project.className = "min-w-0 truncate text-sm text-token-text-primary";
    project.textContent = projectEntry.name;
    const detail = document.createElement("div");
    detail.className = "text-token-text-secondary min-w-0 truncate text-sm";
    const git = projectEntry.git?.hasGitRepo
      ? `Git: ${projectEntry.git.name || "no local name"} <${projectEntry.git.email || "no local email"}>`
      : "No Git repo detected";
    detail.textContent = `${projectEntry.projectPath.startsWith("codex-sidebar://") ? "Sidebar project" : projectEntry.projectPath} · ${git}`;
    left.append(project, detail);

    const controls = document.createElement("div");
    controls.className = "flex shrink-0 flex-wrap items-center justify-end gap-2";
    const select = accountSelectControl(accounts, assignment?.accountId);
    const applyLabel = document.createElement("label");
    applyLabel.className = "flex items-center gap-2 text-sm text-token-text-secondary";
    const applyGit = document.createElement("input");
    applyGit.type = "checkbox";
    applyGit.checked = true;
    applyLabel.append(applyGit, document.createTextNode("Apply Git identity"));
    const save = button("Save");
    save.disabled = !accounts.length;
    save.addEventListener("click", async () => {
      if (!select.value) return;
      const result = await api.ipc.invoke("saveAssignment", {
        projectPath: projectEntry.projectPath,
        projectName: projectEntry.name,
        accountId: select.value,
        applyGit: applyGit.checked,
      });
      const gitStatus = result.gitResult?.applied
        ? " Git identity applied."
        : result.gitResult?.reason
          ? ` Git identity not applied: ${result.gitResult.reason}`
          : "";
      status.textContent = `Saved ${projectEntry.name}.${gitStatus}`;
      await rerender();
    });
    controls.append(select, applyLabel, save);
    if (assignment) {
      const clear = dangerPill("Clear");
      clear.addEventListener("click", async () => {
        await api.ipc.invoke("deleteAssignment", projectEntry.projectPath);
        status.textContent = `Cleared ${projectEntry.name}.`;
        await rerender();
      });
      controls.appendChild(clear);
    }

    row.append(left, controls);
    list.appendChild(row);
  }

  return card;
}

function accountSelectControl(accounts, selected) {
  const select = document.createElement("select");
  select.className =
    "border-token-border bg-token-foreground/5 h-token-button-composer max-w-[320px] rounded-md border px-3 text-sm text-token-text-primary";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = accounts.length ? "Select GitHub account" : "Add an account first";
  select.appendChild(empty);
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = account.username ? `${account.name} (@${account.username})` : account.name;
    select.appendChild(option);
  }
  if (selected) select.value = selected;
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
  return String(value || "").replace(new RegExp(token, "gi"), "ShadGPT");
}

function sectionTitle(titleText, subtitleText) {
  const titleRow = document.createElement("div");
  titleRow.className = "flex h-toolbar items-center justify-between gap-2 px-0 py-0";
  const inner = document.createElement("div");
  inner.className = "flex min-w-0 flex-1 flex-col gap-1";
  const title = document.createElement("div");
  title.className = "text-base font-medium text-token-text-primary";
  title.textContent = titleText;
  const subtitle = document.createElement("div");
  subtitle.className = "text-token-text-secondary text-sm";
  subtitle.textContent = subtitleText;
  inner.append(title, subtitle);
  titleRow.appendChild(inner);
  return titleRow;
}

function groupedCard() {
  const card = document.createElement("div");
  card.className = "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border";
  card.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";
  return card;
}

function input(label, placeholder) {
  const el = document.createElement("input");
  el.type = "text";
  el.placeholder = placeholder || label;
  el.setAttribute("aria-label", label);
  el.className =
    "border-token-border bg-token-foreground/5 h-token-button-composer min-w-[220px] rounded-md border px-3 text-sm text-token-text-primary";
  return el;
}

function button(label) {
  const el = document.createElement("button");
  el.type = "button";
  el.className =
    "h-token-button-composer rounded-md bg-token-text-primary px-3 text-sm font-medium text-token-main-surface-primary cursor-interaction disabled:opacity-50";
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

function statusLine() {
  const el = document.createElement("div");
  el.className = "min-h-5 text-sm text-token-text-secondary";
  return el;
}

function guessProjectPath(name) {
  const explicit = {
    "Menu Bar": "/Users/thomashulihan/Projects/Menu Bar",
    TRR: "/Users/thomashulihan/Projects/TRR",
    "THB-BBL": "/Users/thomashulihan/Projects/THB-BBL",
    PLUGINS: "/Users/thomashulihan/Projects/PLUGINS",
    "Google Takeout Visualization": "/Users/thomashulihan/Documents/New project",
    "SKILLS MANAGER": "/Users/thomashulihan/Projects/SKILLS MANAGER",
    Codex: "/Users/thomashulihan/Applications/codex",
    ShadGPT: `/Users/thomashulihan/Applications/${["codex", "plusplus"].join("-")}`,
  };
  if (explicit[name]) return explicit[name];
  const slug = slugify(name || "project");
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

function slugify(value) {
  return String(value || "account")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "account";
}

function sourceScore(source) {
  return source === "sidebar" ? 0 : source === "config" ? 1 : source === "known" ? 2 : 3;
}

function isAccount(value) {
  return Boolean(value && typeof value.id === "string" && typeof value.name === "string" && typeof value.email === "string");
}

function isValidCommitEmail(value) {
  const email = String(value || "").trim();
  if (email.length > 254 || /[\s<>]/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) &&
    /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(domain);
}
