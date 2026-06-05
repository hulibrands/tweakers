const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const tweak = require("../index.js").__test;
const routing = require("../chrome-routing");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "projects-tweak-"));
}

test("project discovery uses Codex sidebar projects as the source of truth", () => {
  const home = tempDir();
  const trr = path.join(home, "Projects", "TRR");
  const plugins = path.join(home, "Projects", "PLUGINS");
  const local = path.join(home, "Projects", "Local App");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(trr, ".git"), { recursive: true });
  fs.mkdirSync(path.join(plugins, ".git"), { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "package.json"), "{}", "utf8");
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), `[projects."${trr}"]\ntrust_level = "trusted"\n`, "utf8");

  const projects = tweak.projectCandidates({
    fs,
    path,
    home,
    sidebarProjects: [
      { name: "TRR", projectPath: trr },
      { name: "Cloud Only", projectPath: "cloud:abc" },
      { name: "Virtual", projectPath: "codex-sidebar://virtual" },
      { name: "PLUGINS", projectPath: "codex-sidebar://plugins" },
    ],
  });

  assert.equal(projects.filter((project) => project.projectPath === trr).length, 1);
  assert.ok(projects.some((project) => project.projectPath === plugins));
  assert.ok(projects.every((project) => project.projectPath !== local));
  assert.ok(projects.every((project) => !project.projectPath.startsWith("cloud:")));
  assert.ok(projects.every((project) => !project.projectPath.startsWith("codex-sidebar://")));
  assert.deepEqual(projects.map((project) => project.name), ["TRR", "PLUGINS"]);
});

test("project discovery stays empty until the sidebar has been scanned", () => {
  const home = tempDir();
  const trr = path.join(home, "Projects", "TRR");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(trr, ".git"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), `[projects."${trr}"]\ntrust_level = "trusted"\n`, "utf8");

  const projects = tweak.projectCandidates({ fs, path, home, sidebarProjects: [] });

  assert.deepEqual(projects, []);
});

test("active project context detector maps conversation cwd to the saved sidebar project", () => {
  const projects = [
    { name: "ShadGPT", projectPath: "/Users/thomashulihan/Projects/shadgpt" },
    { name: "THB-BBL", projectPath: "/Users/thomashulihan/Projects/THB-BBL" },
  ];

  const active = tweak.detectActiveProjectFromConversationContext({
    visibleText: "environment_context\ncwd: /Users/thomashulihan/Projects/shadgpt/packages/installer",
    sidebarProjects: projects,
  });
  const missing = tweak.detectActiveProjectFromConversationContext({
    visibleText: "cwd: /Users/thomashulihan/Projects/Other",
    sidebarProjects: projects,
  });

  assert.equal(active.name, "ShadGPT");
  assert.equal(missing, null);
  assert.equal(
    tweak.extractProjectPathFromVisibleText("workspace: `/Users/thomashulihan/Projects/THB-BBL`"),
    "/Users/thomashulihan/Projects/THB-BBL",
  );
});

test("project discovery follows saved sidebar project order", () => {
  const home = tempDir();
  const trr = path.join(home, "Projects", "TRR");
  const thb = path.join(home, "Projects", "THB-BBL");
  const skills = path.join(home, "Projects", "SKILLS MANAGER");
  fs.mkdirSync(path.join(trr, ".git"), { recursive: true });
  fs.mkdirSync(path.join(thb, ".git"), { recursive: true });
  fs.mkdirSync(path.join(skills, ".git"), { recursive: true });

  const projects = tweak.projectCandidates({
    fs,
    path,
    home,
    sidebarProjects: [
      { name: "TRR", projectPath: trr },
      { name: "THB-BBL", projectPath: thb },
      { name: "SKILLS MANAGER", projectPath: skills },
    ],
    projectOrder: [thb, trr],
  });

  assert.deepEqual(projects.map((project) => project.name), ["THB-BBL", "TRR", "SKILLS MANAGER"]);
});

test("sidebar project reorder moves a folder block with its visible chat rows", () => {
  const restoreHTMLElement = global.HTMLElement;
  global.HTMLElement = FakeElement;
  try {
    const list = new FakeElement("div");
    const trr = projectRow("TRR", "/Users/thomashulihan/Projects/TRR");
    const trrChat = chatRow("Locate Twitter/X scraping paths");
    const thb = projectRow("THB-BBL", "/Users/thomashulihan/Projects/THB-BBL");
    const thbChat = chatRow("Grade revised plan");
    const plugins = projectRow("PLUGINS", "/Users/thomashulihan/Projects/PLUGINS");
    const chats = chatRow("Chats");
    list.append(trr, trrChat, thb, thbChat, plugins, chats);

    tweak.moveSidebarProjectBlock(thb, trr, "before", [trr, thb, plugins]);
    assert.deepEqual(list.children.map((node) => node.getAttribute("aria-label") || node.textContent), [
      "THB-BBL",
      "Grade revised plan",
      "TRR",
      "Locate Twitter/X scraping paths",
      "PLUGINS",
      "Chats",
    ]);

    const savedOrder = tweak.normalizeSidebarProjectOrder([thb, trr, plugins].map(tweak.sidebarProjectDomKey));
    const restoredList = new FakeElement("div");
    const trr2 = projectRow("TRR", "/Users/thomashulihan/Projects/TRR");
    const trrChat2 = chatRow("Locate Twitter/X scraping paths");
    const thb2 = projectRow("THB-BBL", "/Users/thomashulihan/Projects/THB-BBL");
    const thbChat2 = chatRow("Grade revised plan");
    const plugins2 = projectRow("PLUGINS", "/Users/thomashulihan/Projects/PLUGINS");
    const chats2 = chatRow("Chats");
    restoredList.append(trr2, trrChat2, thb2, thbChat2, plugins2, chats2);

    tweak.applySidebarProjectOrder([trr2, thb2, plugins2], savedOrder);
    assert.deepEqual(restoredList.children.map((node) => node.getAttribute("aria-label") || node.textContent), [
      "THB-BBL",
      "Grade revised plan",
      "TRR",
      "Locate Twitter/X scraping paths",
      "PLUGINS",
      "Chats",
    ]);
  } finally {
    global.HTMLElement = restoreHTMLElement;
  }
});

test("Chrome assignments write Projects storage and mirror legacy storage for routing", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  const preferencesPath = path.join(userRoot, "Chrome", "Profile 7", "Preferences");
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(preferencesPath, "{}", "utf8");

  const assignment = tweak.saveChromeAssignmentToStorage(
    {
      projectPath,
      projectName: "Repo",
      preferencesPaths: [preferencesPath],
    },
    {
      userRoot,
      fs,
      path,
      home: userRoot,
      profiles: [{ preferencesPath, name: "Work", directory: "Profile 7", email: "work@example.com" }],
    },
  );

  const stored = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });
  const legacy = tweak.readStorageFile("co.thomashulihan.project-chrome-profile", { userRoot, fs, path });
  assert.equal(assignment.profileDirectory, "Profile 7");
  assert.equal(stored.chromeAssignments[projectPath].preferencesPath, preferencesPath);
  assert.deepEqual(stored.chromeAssignments[projectPath].preferencesPaths, [preferencesPath]);
  assert.deepEqual(stored.chromeAssignments[projectPath].preferredProfiles.map((profile) => profile.profileName), ["Work"]);
  assert.deepEqual(stored.chromeAssignments[projectPath].profileAliases, ["work@example.com"]);
  assert.equal(legacy.assignments[projectPath].preferencesPath, preferencesPath);
  assert.deepEqual(legacy.assignments[projectPath].profileAliases, ["work@example.com"]);
});

test("active Chrome profile signal writes a validated project route", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  const preferencesPath = path.join(userRoot, "Library", "Application Support", "Google", "Chrome", "Profile 7", "Preferences");
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(preferencesPath, "{}", "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.project-chrome-profile.json"), JSON.stringify({
    assignments: {
      [projectPath]: {
        projectPath,
        profileDirectory: "Profile 7",
        profileName: "Work",
        preferencesPath,
      },
    },
  }), "utf8");

  const write = routing.writeActiveChromeProfileSignal({ projectPath }, { userRoot, home: userRoot });
  const signal = routing.readActiveChromeProfileSignal({ userRoot, home: userRoot });

  assert.equal(write.skipped, false);
  assert.equal(signal.projectPath, projectPath);
  assert.equal(signal.profileDirectory, "Profile 7");
  assert.equal(signal.preferencesPath, preferencesPath);
});

test("Chrome routing patch prefers cwd project assignment before active signal", () => {
  const source = [
    "function resolveChromeProfileDirectory(userDataDirectory) {",
    "  const localStateProfile =",
    "    resolveChromeProfileDirectoryFromLocalState(userDataDirectory);",
    "  if (localStateProfile) return localStateProfile;",
    "}",
    "",
    "function resolveChromeProfileDirectoryFromLocalState(userDataDirectory) {",
    "  return null;",
    "}",
  ].join("\n");

  const patched = routing.patchChromeScriptSource(source);
  const cwdIndex = patched.indexOf("const cwdAssignment = resolveProjectAssignment(store, process.cwd());");
  const activeIndex = patched.indexOf("const activeProfile = activeChromeProjectProfile(userDataDirectory, process.cwd(), Boolean(cwdAssignment));");

  assert.match(patched, /SHADGPT_PROJECT_CHROME_ROUTING_PATCH_V3/);
  assert.ok(cwdIndex > -1);
  assert.ok(activeIndex > -1);
  assert.ok(cwdIndex < activeIndex);
  assert.match(patched, /Ignoring active Chrome profile/);
});

test("active Chrome profile tile state distinguishes project, default, and unset routes", () => {
  const project = { projectPath: "/repo", name: "Repo" };
  const projectState = tweak.activeChromeProfileTileState(project, {
    chromeRouting: { source: "project", profileName: "Work", profileDirectory: "Profile 7" },
    activeChromeProfile: { projectPath: "/repo", profileDirectory: "Profile 7" },
  });
  const defaultState = tweak.activeChromeProfileTileState(project, {
    chromeRouting: { source: "default", profileName: "Codex", profileDirectory: "Profile 13" },
    activeChromeProfile: null,
  });
  const unsetState = tweak.activeChromeProfileTileState(project, {
    chromeRouting: {},
    activeChromeProfile: null,
  });

  assert.equal(projectState.label, "Active");
  assert.equal(projectState.activeMatches, true);
  assert.equal(defaultState.label, "Default");
  assert.equal(defaultState.chipClass, "is-muted");
  assert.equal(unsetState.label, "Unset");
  assert.equal(unsetState.chipClass, "is-danger");
});

test("Chrome assignments migrate from legacy Plugin Profiles storage into Projects storage", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  const preferencesPath = path.join(userRoot, "Chrome", "Profile 4", "Preferences");
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.writeFileSync(preferencesPath, "{}", "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.project-chrome-profile.json"), JSON.stringify({
    assignments: {
      [projectPath]: {
        projectPath,
        profileDirectory: "Profile 4",
        profileName: "Legacy Work",
        preferencesPath,
      },
    },
  }), "utf8");

  const migrated = tweak.readChromeStorage(userRoot, { userRoot, fs, path });
  const stored = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });

  assert.equal(migrated.assignments[projectPath].profileName, "Legacy Work");
  assert.equal(stored.chromeAssignments[projectPath].migratedFrom, "co.thomashulihan.project-chrome-profile");
  assert.equal(stored.chromeAssignments[projectPath].preferencesPath, preferencesPath);
});

test("Project Settings writes managed AGENTS.md plugin profile blocks", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  const preferencesPath = path.join(userRoot, "Chrome", "Profile 7", "Preferences");
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.mkdirSync(path.join(projectPath, ".codex"), { recursive: true });
  fs.writeFileSync(preferencesPath, "{}", "utf8");
  fs.writeFileSync(path.join(projectPath, "AGENTS.md"), "# Repo\n", "utf8");
  fs.writeFileSync(path.join(projectPath, ".codex", "config.toml"), [
    "[mcp_servers.supabase]",
    'project_id = "trrproject"',
    'bearer_token_env_var = "SUPABASE_ACCESS_TOKEN"',
    "",
  ].join("\n"), "utf8");

  tweak.saveChromeAssignmentToStorage(
    { projectPath, projectName: "Repo", preferencesPaths: [preferencesPath] },
    {
      userRoot,
      fs,
      path,
      home: userRoot,
      profiles: [{ preferencesPath, name: "codex@thereality.report", directory: "Profile 7" }],
    },
  );
  const google = tweak.saveGoogleWorkspaceAccountToStorage(
    { name: "TRR", email: "codex@thereality.report" },
    { userRoot, fs, path },
  );
  tweak.saveGoogleWorkspaceAssignmentToStorage(
    { projectPath, service: "gmail", accountId: google.id },
    { userRoot, fs, path, home: userRoot },
  );
  tweak.saveGoogleWorkspaceAssignmentToStorage(
    { projectPath, service: "google-drive", accountId: google.id },
    { userRoot, fs, path, home: userRoot },
  );
  const modal = tweak.saveModalWorkspaceAccountToStorage(
    { name: "TRR Modal", profile: "admin-56995", workspace: "admin-56995" },
    { userRoot, fs, path },
  );
  tweak.saveModalWorkspaceAssignmentToStorage(
    { projectPath, accountId: modal.id },
    { userRoot, fs, path, home: userRoot },
  );
  const decodo = tweak.saveDecodoAccountToStorage(
    { name: "TRR Decodo", username: "decodo-trr" },
    { userRoot, fs, path },
  );
  tweak.saveDecodoAssignmentToStorage(
    { projectPath, accountId: decodo.id },
    { userRoot, fs, path, home: userRoot },
  );

  const result = tweak.syncProjectConnectionInstructions(
    { projectPath, projectName: "Repo" },
    { userRoot, fs, path, home: userRoot },
  );
  const agents = fs.readFileSync(path.join(projectPath, "AGENTS.md"), "utf8");

  assert.equal(result.changed, true);
  assert.equal(result.connectionCount, 6);
  assert.match(agents, /<!-- codex-plugin-profiles:start -->/);
  assert.match(agents, /## Project Settings/);
  assert.doesNotMatch(agents, /## Plugin Profiles/);
  assert.match(agents, /\[@Chrome\]\(plugin:\/\/chrome@openai-bundled\)/);
  assert.match(agents, /CODEX_CHROME_PREFERENCES_PATH="/);
  assert.match(agents, /\[@gmail\]\(plugin:\/\/gmail@openai-curated\): use codex@thereality\.report/);
  assert.match(agents, /\[@google-drive\]\(plugin:\/\/google-drive@openai-curated\): use codex@thereality\.report/);
  assert.match(agents, /\[@modal-platform\]\(plugin:\/\/modal-platform@local-plugins\): use admin-56995 \/ admin-56995/);
  assert.match(agents, /\[@decodo\]\(plugin:\/\/decodo@local-plugins\): use TRR Decodo \/ decodo-trr/);
  assert.match(agents, /\[@supabase\]\(plugin:\/\/supabase@openai-curated\): use project trrproject with SUPABASE_ACCESS_TOKEN/);

  const unchanged = tweak.syncProjectConnectionInstructions(
    { projectPath, projectName: "Repo" },
    { userRoot, fs, path, home: userRoot },
  );
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.reason, "unchanged");
});

test("Project Settings previews and filters AGENTS.md blocks per plugin", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  const preferencesPath = path.join(userRoot, "Chrome", "Profile 7", "Preferences");
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(preferencesPath, "{}", "utf8");

  tweak.saveChromeAssignmentToStorage(
    { projectPath, projectName: "Repo", preferencesPaths: [preferencesPath] },
    {
      userRoot,
      fs,
      path,
      home: userRoot,
      profiles: [{ preferencesPath, name: "Chrome Work", directory: "Profile 7" }],
    },
  );
  const decodo = tweak.saveDecodoAccountToStorage(
    { name: "Decodo Ops", username: "ops-decodo" },
    { userRoot, fs, path },
  );
  tweak.saveDecodoAssignmentToStorage(
    { projectPath, accountId: decodo.id },
    { userRoot, fs, path, home: userRoot },
  );

  const before = tweak.previewProjectConnectionInstructions(
    { projectPath, projectName: "Repo" },
    { userRoot, fs, path, home: userRoot },
  );
  assert.match(before.blockText, /\[@Chrome\]\(plugin:\/\/chrome@openai-bundled\)/);
  assert.match(before.blockText, /\[@decodo\]\(plugin:\/\/decodo@local-plugins\)/);

  tweak.setProjectAgentsInstructionPluginWriteDisabled(
    { projectPath, pluginId: "decodo", disabled: true },
    { userRoot, fs, path, home: userRoot },
  );
  const after = tweak.previewProjectConnectionInstructions(
    { projectPath, projectName: "Repo" },
    { userRoot, fs, path, home: userRoot },
  );

  assert.match(after.blockText, /\[@Chrome\]\(plugin:\/\/chrome@openai-bundled\)/);
  assert.doesNotMatch(after.blockText, /\[@decodo\]/);
  assert.deepEqual(after.pluginWriteDisabled, ["decodo"]);
  assert.equal(after.connectionCount, 1);
});

test("Project Settings can disable AGENTS.md writes per project", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  const preferencesPath = path.join(userRoot, "Chrome", "Profile 7", "Preferences");
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(preferencesPath, "{}", "utf8");
  fs.writeFileSync(path.join(projectPath, "AGENTS.md"), "# Repo\n", "utf8");

  tweak.saveChromeAssignmentToStorage(
    { projectPath, projectName: "Repo", preferencesPaths: [preferencesPath] },
    {
      userRoot,
      fs,
      path,
      home: userRoot,
      profiles: [{ preferencesPath, name: "Work", directory: "Profile 7" }],
    },
  );

  const preference = tweak.setProjectAgentsInstructionWriteDisabled(
    { projectPath, disabled: true },
    { userRoot, fs, path, home: userRoot },
  );
  const result = tweak.syncProjectConnectionInstructions(
    { projectPath, projectName: "Repo" },
    { userRoot, fs, path, home: userRoot },
  );

  assert.equal(preference.disabled, true);
  assert.equal(tweak.isProjectAgentsInstructionWriteDisabled(projectPath, { userRoot, fs, path, home: userRoot }), true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "disabled");
  assert.equal(fs.readFileSync(path.join(projectPath, "AGENTS.md"), "utf8"), "# Repo\n");
});

test("Project Settings persists Chrome verifier results per project", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  fs.mkdirSync(projectPath, { recursive: true });

  const saved = tweak.saveChromeVerifierResult(projectPath, {
    summary: "profile routing: ok; extension: ok; native backend: ok; shared locks: ok",
    sections: { profile: true, extension: true, backend: true, locks: true },
    fixes: [{ section: "all", status: "ok", action: "No Chrome routing fixes needed." }],
    routing: {
      project: {
        source: "project",
        profileDirectory: "Profile 11",
        profileName: "admin@thereality.report",
        preferencesPath: "/tmp/Profile 11/Preferences",
      },
    },
  }, { userRoot, fs, path });
  const read = tweak.readChromeVerifierResult(projectPath, { userRoot, fs, path });
  const history = tweak.readChromeVerifierHistory(projectPath, { userRoot, fs, path });

  assert.equal(saved.sections.profile, true);
  assert.equal(read.routing.project.profileName, "admin@thereality.report");
  assert.equal(read.fixes[0].action, "No Chrome routing fixes needed.");
  assert.match(read.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(history.length, 1);
  assert.equal(history[0].routing.project.profileName, "admin@thereality.report");
});

test("Chrome profile listing only includes profiles with the Codex Chrome Extension enabled", () => {
  const userRoot = tempDir();
  const chromeRoot = path.join(userRoot, "Chrome");
  const extensionId = "codexextensionid";
  const previousChromeRoot = process.env.CODEX_CHROME_USER_DATA_DIR;
  const previousExtensionId = process.env.CODEX_CHROME_EXTENSION_ID;
  process.env.CODEX_CHROME_USER_DATA_DIR = chromeRoot;
  process.env.CODEX_CHROME_EXTENSION_ID = extensionId;
  try {
    fs.mkdirSync(path.join(chromeRoot, "Default", "Extensions", extensionId, "1.0.0_0"), { recursive: true });
    fs.mkdirSync(path.join(chromeRoot, "Profile 2", "Extensions", extensionId, "1.0.0_0"), { recursive: true });
    fs.mkdirSync(path.join(chromeRoot, "Profile 3"), { recursive: true });
    fs.writeFileSync(path.join(chromeRoot, "Local State"), JSON.stringify({
      profile: {
        profiles_order: ["Default", "Profile 2", "Profile 3"],
        info_cache: {
          Default: { name: "Work", user_name: "work@example.com" },
          "Profile 2": { user_name: "disabled@example.com" },
          "Profile 3": { user_name: "missing@example.com" },
        },
      },
    }), "utf8");
    fs.writeFileSync(path.join(chromeRoot, "Default", "Preferences"), JSON.stringify({
      account_info: [{ email: "alias@example.com" }],
    }), "utf8");
    fs.writeFileSync(path.join(chromeRoot, "Default", "Secure Preferences"), JSON.stringify({
      extensions: { settings: { [extensionId]: { state: 1 } } },
    }), "utf8");
    fs.writeFileSync(path.join(chromeRoot, "Profile 2", "Preferences"), "{}", "utf8");
    fs.writeFileSync(path.join(chromeRoot, "Profile 2", "Secure Preferences"), JSON.stringify({
      extensions: { settings: { [extensionId]: { state: 0 } } },
    }), "utf8");
    fs.writeFileSync(path.join(chromeRoot, "Profile 3", "Preferences"), "{}", "utf8");

    const profiles = tweak.listChromeProfilesFromDisk({ fs, os, path });

    assert.deepEqual(profiles.map((profile) => profile.email), ["work@example.com"]);
    assert.equal(profiles[0].name, "Work");
    assert.deepEqual(profiles[0].profileAliases, ["work@example.com", "alias@example.com"]);
  } finally {
    if (previousChromeRoot === undefined) delete process.env.CODEX_CHROME_USER_DATA_DIR;
    else process.env.CODEX_CHROME_USER_DATA_DIR = previousChromeRoot;
    if (previousExtensionId === undefined) delete process.env.CODEX_CHROME_EXTENSION_ID;
    else process.env.CODEX_CHROME_EXTENSION_ID = previousExtensionId;
  }
});

test("GitHub repositories and local Git identity remain read-only project metadata", () => {
  const home = tempDir();
  const projectPath = path.join(home, "repo");
  fs.mkdirSync(path.join(projectPath, ".git"), { recursive: true });
  const childProcess = {
    execFileSync(command, args) {
      assert.equal(command, "git");
      if (args.includes("rev-parse")) return `${projectPath}\n`;
      if (args.includes("remote")) {
        return [
          "origin\thttps://github.com/hulibrands/tweakers.git (fetch)",
          "origin\thttps://github.com/hulibrands/tweakers.git (push)",
          "upstream\tgit@github.com:openai/codex.git (fetch)",
          "upstream\tgit@github.com:openai/codex.git (push)",
        ].join("\n");
      }
      if (args.includes("user.name")) return "Thomas\n";
      if (args.includes("user.email")) return "284474179+hulibrands@users.noreply.github.com\n";
      if (args.includes("github.user")) return "hulibrands\n";
      return "";
    },
  };

  const repos = tweak.gitRepositoriesForProject(projectPath, { fs, path, home, childProcess });
  const identity = tweak.gitIdentityForProject(projectPath, { fs, path, home, childProcess });

  assert.deepEqual(repos.map((repo) => repo.fullName), ["hulibrands/tweakers", "openai/codex"]);
  assert.deepEqual(repos[0].remotes, ["origin"]);
  assert.equal(repos[0].url, "https://github.com/hulibrands/tweakers");
  assert.equal(identity.username, "hulibrands");
  assert.equal(identity.email, "284474179+hulibrands@users.noreply.github.com");
});

test("Google Workspace accounts and assignments are project scoped", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  fs.mkdirSync(projectPath, { recursive: true });

  const seeded = tweak.googleWorkspaceAccountsForProject(projectPath, {
    userRoot,
    fs,
    os,
    path,
    home: userRoot,
    chromeProfiles: [
      { email: "thomas@hulibrands.com", avatarUrl: "file:///avatar.png" },
      { email: "codex@thereality.report" },
    ],
  });
  assert.deepEqual(seeded.map((account) => account.email), ["thomas@hulibrands.com", "codex@thereality.report"]);

  const account = tweak.saveGoogleWorkspaceAccountToStorage(
    { name: "TRR", email: "codex@thereality.report" },
    { userRoot, fs, path },
  );
  const gmail = tweak.saveGoogleWorkspaceAssignmentToStorage(
    { projectPath, service: "gmail", accountId: account.id },
    { userRoot, fs, path, home: userRoot },
  );
  const drive = tweak.saveGoogleWorkspaceAssignmentToStorage(
    { projectPath, service: "google-drive", accountId: account.id },
    { userRoot, fs, path, home: userRoot },
  );
  const stored = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });

  assert.equal(gmail.email, "codex@thereality.report");
  assert.equal(drive.service, "google-drive");
  assert.equal(stored.googleWorkspaceAssignments[projectPath].gmail.accountId, account.id);
  assert.equal(stored.googleWorkspaceAssignments[projectPath]["google-drive"].email, "codex@thereality.report");

  tweak.clearGoogleWorkspaceAssignmentFromStorage({ projectPath, service: "gmail" }, { userRoot, fs, path, home: userRoot });
  const cleared = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });
  assert.equal(cleared.googleWorkspaceAssignments[projectPath].gmail, undefined);
  assert.equal(cleared.googleWorkspaceAssignments[projectPath]["google-drive"].accountId, account.id);
});

test("Modal workspace accounts and assignments are project scoped", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  fs.mkdirSync(projectPath, { recursive: true });

  const seeded = tweak.modalWorkspaceAccountsForProject(projectPath, { userRoot, fs, path });
  assert.deepEqual(seeded, []);

  const account = tweak.saveModalWorkspaceAccountToStorage(
    { name: "TRR Modal", profile: "admin-56995", workspace: "admin-56995" },
    { userRoot, fs, path },
  );
  const assignment = tweak.saveModalWorkspaceAssignmentToStorage(
    { projectPath, accountId: account.id },
    { userRoot, fs, path, home: userRoot },
  );
  const stored = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });

  assert.equal(assignment.profile, "admin-56995");
  assert.equal(assignment.workspace, "admin-56995");
  assert.equal(stored.modalWorkspaceAssignments[projectPath].accountId, account.id);

  const edited = tweak.saveModalWorkspaceAccountToStorage(
    { id: account.id, name: "TRR Backend Jobs", profile: "trr-admin", workspace: "trr-backend-jobs" },
    { userRoot, fs, path },
  );
  const editedAssignment = tweak.saveModalWorkspaceAssignmentToStorage(
    { projectPath, accountId: edited.id },
    { userRoot, fs, path, home: userRoot },
  );
  assert.equal(editedAssignment.profile, "trr-admin");
  assert.equal(editedAssignment.workspace, "trr-backend-jobs");

  tweak.clearModalWorkspaceAssignmentFromStorage({ projectPath }, { userRoot, fs, path, home: userRoot });
  const cleared = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });
  assert.equal(cleared.modalWorkspaceAssignments[projectPath], undefined);
});

test("Decodo accounts and assignments are project scoped", () => {
  const userRoot = tempDir();
  const projectPath = path.join(userRoot, "repo");
  fs.mkdirSync(projectPath, { recursive: true });

  const account = tweak.saveDecodoAccountToStorage(
    { name: "TRR Decodo", username: "decodo-trr" },
    { userRoot, fs, path },
  );
  const assignment = tweak.saveDecodoAssignmentToStorage(
    { projectPath, accountId: account.id },
    { userRoot, fs, path, home: userRoot },
  );
  const stored = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });

  assert.equal(assignment.accountName, "TRR Decodo");
  assert.equal(assignment.username, "decodo-trr");
  assert.equal(stored.decodoAssignments[projectPath].accountId, account.id);

  tweak.clearDecodoAssignmentFromStorage({ projectPath }, { userRoot, fs, path, home: userRoot });
  const cleared = tweak.readStorageFile("co.thomashulihan.projects", { userRoot, fs, path });
  assert.equal(cleared.decodoAssignments[projectPath], undefined);
});

test("Modal workspace context detects active CLI profile conflicts", () => {
  const home = tempDir();
  const projectPath = path.join(home, "repo");
  const python = path.join(projectPath, ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "", "utf8");
  const childProcess = {
    execFileSync(command, args, options) {
      assert.equal(command, python);
      assert.deepEqual(args, ["-m", "modal", "profile", "list", "--json"]);
      assert.equal(options.cwd, projectPath);
      return JSON.stringify([
        { name: "thb-bbl", workspace: "tommy-hulihan-basketball", active: true },
      ]);
    },
  };

  const cliContext = tweak.activeModalWorkspaceContext(projectPath, {
    fs,
    path,
    childProcess,
    env: {},
  });
  const conflict = tweak.modalWorkspaceConflict(
    { profile: "admin-56995", workspace: "admin-56995" },
    cliContext,
  );

  assert.equal(cliContext.profile, "thb-bbl");
  assert.equal(cliContext.workspace, "tommy-hulihan-basketball");
  assert.deepEqual(conflict, {
    expectedProfile: "admin-56995",
    expectedWorkspace: "admin-56995",
    activeProfile: "thb-bbl",
    activeWorkspace: "tommy-hulihan-basketball",
  });
});

test("Google Workspace accounts can be detected from connector metadata", () => {
  const home = tempDir();
  const gmailPlugin = path.join(home, ".codex", "plugins", "cache", "openai-curated", "gmail", "abc");
  const drivePlugin = path.join(home, ".codex", "plugins", "cache", "openai-curated", "google-drive", "abc");
  const cacheDir = path.join(home, ".codex", "cache", "codex_apps_tools");
  fs.mkdirSync(gmailPlugin, { recursive: true });
  fs.mkdirSync(drivePlugin, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(gmailPlugin, ".app.json"), JSON.stringify({
    apps: { gmail: { id: "connector_gmail" } },
  }), "utf8");
  fs.writeFileSync(path.join(drivePlugin, ".app.json"), JSON.stringify({
    apps: { "google-drive": { id: "connector_drive" } },
  }), "utf8");
  fs.writeFileSync(path.join(cacheDir, "tools.json"), JSON.stringify({
    gmailProfile: {
      resource_uri: "/connector_gmail/link_1/get_profile",
      profile: { email: "codex@thereality.report" },
    },
    driveProfile: {
      resource_uri: "/connector_drive/link_2/get_profile",
      profile: { email: "thomas@hulibrands.com" },
    },
    driveDocs: {
      resource_uri: "/connector_drive/link_2/search",
      description: "Example filters mention user@domain.com and alice@example.com.",
    },
    unrelated: {
      profile: { email: "ignore@example.com" },
    },
  }), "utf8");

  const accounts = tweak.googleWorkspaceConnectorAccountsFromMetadata({ fs, os, path, home });

  assert.deepEqual(accounts.map((account) => account.email).sort(), [
    "codex@thereality.report",
    "thomas@hulibrands.com",
  ]);
  assert.ok(accounts.every((account) => !account.email.includes("ignore")));
});

test("project sidebar colors write the existing UI Improvements color schema", () => {
  const userRoot = tempDir();
  const saved = tweak.saveProjectColorToStorage(
    { projectName: "THB-BBL", colorId: "green" },
    { userRoot, fs, path },
  );
  const stored = tweak.readStorageFile("co.thomashulihan.ui-improvements", { userRoot, fs, path });

  assert.equal(saved.projectKey, "thb-bbl");
  assert.equal(stored["sidebar-project-backgrounds:colors"]["thb-bbl"], "green");

  tweak.saveProjectColorToStorage({ projectName: "THB-BBL", colorId: "auto" }, { userRoot, fs, path });
  const cleared = tweak.readStorageFile("co.thomashulihan.ui-improvements", { userRoot, fs, path });
  assert.equal(cleared["sidebar-project-backgrounds:colors"]["thb-bbl"], undefined);
});

test("project chat-row overlays write the UI Improvements overlay schema", () => {
  const userRoot = tempDir();
  const saved = tweak.saveProjectOverlayToStorage(
    { projectName: "THB-BBL", overlayIntensity: "strong" },
    { userRoot, fs, path },
  );
  const stored = tweak.readStorageFile("co.thomashulihan.ui-improvements", { userRoot, fs, path });

  assert.equal(saved.projectKey, "thb-bbl");
  assert.equal(stored["sidebar-project-backgrounds:overlays"]["thb-bbl"], "strong");

  tweak.saveProjectOverlayToStorage({ projectName: "THB-BBL", overlayIntensity: "medium" }, { userRoot, fs, path });
  const cleared = tweak.readStorageFile("co.thomashulihan.ui-improvements", { userRoot, fs, path });
  assert.equal(cleared["sidebar-project-backgrounds:overlays"]["thb-bbl"], undefined);
});

test("renderer source keeps project color controls in Projects and avoids retired GitHub account settings", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /function projectColorRow/);
  assert.match(source, /saveProjectColor/);
  assert.match(source, /saveProjectOverlay/);
  assert.match(source, /overlay-segmented/);
  assert.match(source, /PROJECT_COLOR_EVENT/);
  assert.match(source, /profile-dropdown/);
  assert.match(source, /setActiveChromeProject/);
  assert.match(source, /activeChromeProfileStatusTile/);
  assert.match(source, /chrome-active-status-card/);
  assert.match(source, /chromeProfileHasEnabledCodexExtension/);
  assert.match(source, /gitHubMetadataRow/);
  assert.match(source, /gitRepositoriesForProject/);
  assert.doesNotMatch(source, /githubConnectionRow/);
  assert.doesNotMatch(source, /saveGithubAssignment/);
  assert.match(source, /googleWorkspaceConnectionRow/);
  assert.match(source, /modalWorkspaceConnectionRow/);
  assert.match(source, /modalWorkspaceInlineEditor/);
  assert.match(source, /Edit Modal workspace/);
  assert.match(source, /modalWorkspaceProjectChip/);
  assert.match(source, /Active Modal CLI is/);
  assert.match(source, /connection-warning/);
  assert.match(source, /Modal Workspace/);
  assert.doesNotMatch(source, /DEFAULT_MODAL_WORKSPACE_ACCOUNT/);
  assert.match(source, /Google Drive Account/);
  assert.match(source, /Gmail Account/);
  assert.match(source, /connection-card-grid/);
  assert.match(source, /connection-key-list/);
  assert.match(source, /unique keys/);
  assert.match(source, /getProjectEnvInventory/);
  assert.match(source, /getProjectEnvScanTimeout/);
  assert.match(source, /saveProjectEnvScanTimeout/);
  assert.match(source, /compactEnvInventorySummary/);
  assert.match(source, /envInventoryLoadingState/);
  assert.match(source, /env-loading-skeleton/);
  assert.match(source, /Project \.env inventory timed out/);
  assert.doesNotMatch(source, /Boolean\(overview\.chromeAssignment\?\.preferencesPaths \|\| \[\]\)\.includes/);
});

test("project env scan timeout is clamped to safe bounds", () => {
  assert.equal(tweak.normalizeProjectEnvScanTimeout("nope"), 8000);
  assert.equal(tweak.normalizeProjectEnvScanTimeout(10), 1000);
  assert.equal(tweak.normalizeProjectEnvScanTimeout(65000), 60000);
  assert.equal(tweak.normalizeProjectEnvScanTimeout(1234.4), 1234);
});

test("env key classifier prefers specific providers before broad Git and OAuth patterns", () => {
  assert.equal(tweak.categoryForEnvKey("VERCEL_GIT_COMMIT_SHA"), "Vercel");
  assert.equal(tweak.categoryForEnvKey("REDDIT_CLIENT_ID"), "Reddit");
  assert.equal(tweak.categoryForEnvKey("REDDIT_CLIENT_SECRET"), "Reddit");
  assert.equal(tweak.categoryForEnvKey("REDDIT_USER_AGENT"), "Reddit");
  assert.equal(tweak.categoryForEnvKey("FIREBASE_DATABASE_URL"), "Firebase");
  assert.equal(tweak.categoryForEnvKey("NEXT_PUBLIC_FIREBASE_API_KEY"), "Firebase");
  assert.equal(tweak.categoryForEnvKey("HF_API_TOKEN"), "OpenAI/Anthropic/AI");
  assert.equal(tweak.categoryForEnvKey("HUGGINGFACE_HUB_TOKEN"), "OpenAI/Anthropic/AI");
  assert.equal(tweak.categoryForEnvKey("OBJECT_STORAGE_SECRET_ACCESS_KEY"), "Object Storage");
  assert.equal(tweak.categoryForEnvKey("SCREENALYTICS_OBJECT_STORE_ENDPOINT"), "Object Storage");
  assert.equal(tweak.categoryForEnvKey("S3_AUTO_CREATE"), "Object Storage");
  assert.equal(tweak.categoryForEnvKey("CLOUDFLARE_API_TOKEN"), "Cloudflare");
  assert.equal(tweak.categoryForEnvKey("RENDER_API_KEY"), "Render");
  assert.equal(tweak.categoryForEnvKey("APIFY_API_TOKEN"), "Apify");
  assert.equal(tweak.categoryForEnvKey("BETTER_STACK_API_TOKEN"), "Better Stack");
  assert.equal(tweak.categoryForEnvKey("BRANDFETCH_API_KEY"), "Brandfetch");
  assert.equal(tweak.categoryForEnvKey("FIRECRAWL_API_KEY"), "Firecrawl");
  assert.equal(tweak.categoryForEnvKey("TMDB_API_KEY"), "Media APIs");
  assert.equal(tweak.categoryForEnvKey("DECODO_PASSWORD"), "Decodo");
  assert.equal(tweak.categoryForEnvKey("INSTAGRAM_USERNAME"), "Social Platforms");
  assert.equal(tweak.categoryForEnvKey("TRR_DB_POOL_MAXCONN"), "Database/Postgres");
  assert.equal(tweak.categoryForEnvKey("DB_URL"), "Database/Postgres");
  assert.equal(tweak.categoryForEnvKey("SPREADSHEET_ID"), "Google Drive");
  assert.equal(tweak.categoryForEnvKey("TURBO_CACHE"), "Build/Turbo");
  assert.equal(tweak.categoryForEnvKey("NX_DAEMON"), "Build/Turbo");
  assert.equal(tweak.categoryForEnvKey("SCREENALYTICS_SERVICE_TOKEN"), "Screenalytics");
  assert.equal(tweak.categoryForEnvKey("ADMIN_EMAIL_ALLOWLIST"), "Admin/Auth");
  assert.equal(tweak.categoryForEnvKey("TRR_JOB_PLANE_MODE"), "TRR/Internal");
});

test("Supabase config update preserves unrelated config", () => {
  const input = [
    "[profile.default]",
    'model = "gpt-5"',
    "",
    "[mcp_servers.supabase]",
    'url = "https://mcp.supabase.com/mcp?project_ref=oldref&features=database,docs"',
    'bearer_token_env_var = "OLD_TOKEN"',
    "",
    "[mcp_servers.github]",
    'command = "gh"',
    "",
  ].join("\n");

  const output = tweak.upsertSupabaseConfigToml(input, {
    name: "New",
    projectRef: "newref",
    bearerTokenEnvVar: "NEW_TOKEN",
    features: ["database", "docs"],
  });
  const parsed = tweak.parseSupabaseConfigToml(output);

  assert.match(output, /\[profile\.default\]/);
  assert.match(output, /\[mcp_servers\.github\]/);
  assert.equal(parsed.projectRef, "newref");
  assert.equal(parsed.bearerTokenEnvVar, "NEW_TOKEN");
  assert.deepEqual(parsed.features, ["database", "docs"]);
});

test("dotenv parser groups, redacts, and reveals values only on demand", () => {
  const projectPath = tempDir();
  const envPath = path.join(projectPath, ".env.local");
  const dynamicEnvPath = path.join(projectPath, ".vercel", ".env.preview.local");
  const exampleEnvPath = path.join(projectPath, "apps", "web", ".env.local.example");
  fs.writeFileSync(
    envPath,
    [
      "# ignored",
      "export SUPABASE_URL=https://example.supabase.co",
      'OPENAI_API_KEY="sk-secret"',
      "DATABASE_URL=postgres://user:pass@localhost/db # local database",
      "GMAIL_LABEL_ID=Label_123",
      "GOOGLE_DRIVE_FOLDER_ID=folder_123",
      "VERCEL_GIT_COMMIT_SHA=abc123",
      "REDDIT_CLIENT_ID=reddit-client",
      "FIREBASE_DATABASE_URL=https://example.firebaseio.com",
      "PLAIN=value#kept",
    ].join("\n"),
    "utf8",
  );
  fs.mkdirSync(path.dirname(dynamicEnvPath), { recursive: true });
  fs.writeFileSync(dynamicEnvPath, "VERCEL_ENV=preview\n", "utf8");
  fs.mkdirSync(path.dirname(exampleEnvPath), { recursive: true });
  fs.writeFileSync(exampleEnvPath, "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\n", "utf8");
  fs.writeFileSync(path.join(projectPath, ".env.backup"), "SHOULD_NOT_APPEAR=true\n", "utf8");
  fs.mkdirSync(path.join(projectPath, ".worktrees", "scratch"), { recursive: true });
  fs.writeFileSync(path.join(projectPath, ".worktrees", "scratch", ".env.example"), "SCRATCH_SECRET=ignored\n", "utf8");

  const parsed = tweak.parseDotenv(fs.readFileSync(envPath, "utf8"), envPath);
  const inventory = tweak.scanEnvInventory(projectPath, { fs, path });
  const reveal = tweak.revealEnvValueFromDisk({ projectPath, filePath: envPath, key: "OPENAI_API_KEY" }, { fs, path, home: projectPath });
  const dynamicReveal = tweak.revealEnvValueFromDisk({ projectPath, filePath: dynamicEnvPath, key: "VERCEL_ENV" }, { fs, path, home: projectPath });
  const update = tweak.updateEnvValueOnDisk({ projectPath, filePath: envPath, key: "OPENAI_API_KEY", value: "sk-new" }, { fs, path, home: projectPath });
  const dynamicUpdate = tweak.updateEnvValueOnDisk({ projectPath, filePath: dynamicEnvPath, key: "VERCEL_ENV", value: "production" }, { fs, path, home: projectPath });

  assert.equal(parsed.find((entry) => entry.key === "SUPABASE_URL").category, "Supabase");
  assert.equal(parsed.find((entry) => entry.key === "GMAIL_LABEL_ID").category, "Gmail");
  assert.equal(parsed.find((entry) => entry.key === "GOOGLE_DRIVE_FOLDER_ID").category, "Google Drive");
  assert.equal(parsed.find((entry) => entry.key === "VERCEL_GIT_COMMIT_SHA").category, "Vercel");
  assert.equal(parsed.find((entry) => entry.key === "REDDIT_CLIENT_ID").category, "Reddit");
  assert.equal(parsed.find((entry) => entry.key === "FIREBASE_DATABASE_URL").category, "Firebase");
  assert.equal(parsed.find((entry) => entry.key === "OPENAI_API_KEY").category, "OpenAI/Anthropic/AI");
  assert.equal(parsed.find((entry) => entry.key === "DATABASE_URL").value, "postgres://user:pass@localhost/db");
  assert.equal(parsed.find((entry) => entry.key === "PLAIN").value, "value#kept");
  assert.deepEqual(inventory.files.map((file) => file.relativePath), [".env.local", ".vercel/.env.preview.local"]);
  assert.equal(inventory.files[0].entries.find((entry) => entry.key === "OPENAI_API_KEY").redactedValue, "[redacted]");
  assert.doesNotMatch(JSON.stringify(inventory), /sk-secret/);
  assert.equal(reveal.value, "sk-secret");
  assert.equal(dynamicReveal.value, "preview");
  assert.equal(update.value, "[redacted]");
  assert.equal(dynamicUpdate.value, "[redacted]");
  assert.equal(tweak.revealEnvValueFromDisk({ projectPath, filePath: envPath, key: "OPENAI_API_KEY" }, { fs, path, home: projectPath }).value, "sk-new");
  assert.equal(tweak.revealEnvValueFromDisk({ projectPath, filePath: dynamicEnvPath, key: "VERCEL_ENV" }, { fs, path, home: projectPath }).value, "production");
});

test("env reveal and edit reject symlink escapes outside the project", (t) => {
  const projectPath = tempDir();
  const outside = tempDir();
  const outsideEnv = path.join(outside, ".env.local");
  const symlinkEnv = path.join(projectPath, ".env.local");
  fs.writeFileSync(outsideEnv, "OPENAI_API_KEY=outside\n", "utf8");

  try {
    fs.symlinkSync(outsideEnv, symlinkEnv);
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("symlinks are unavailable in this environment");
      return;
    }
    throw error;
  }

  assert.throws(
    () => tweak.revealEnvValueFromDisk({ projectPath, filePath: symlinkEnv, key: "OPENAI_API_KEY" }, { fs, path, home: projectPath }),
    /cannot be a symlink/,
  );
  assert.throws(
    () => tweak.updateEnvValueOnDisk({ projectPath, filePath: symlinkEnv, key: "OPENAI_API_KEY", value: "changed" }, { fs, path, home: projectPath }),
    /cannot be a symlink/,
  );
  assert.equal(fs.readFileSync(outsideEnv, "utf8"), "OPENAI_API_KEY=outside\n");
});

test("env reveal rejects files whose real path is outside the project", (t) => {
  const projectPath = tempDir();
  const outside = tempDir();
  const outsideEnvDir = path.join(outside, "linked");
  const linkedDir = path.join(projectPath, "linked");
  fs.mkdirSync(outsideEnvDir, { recursive: true });
  fs.writeFileSync(path.join(outsideEnvDir, ".env.local"), "OPENAI_API_KEY=outside\n", "utf8");

  try {
    fs.symlinkSync(outsideEnvDir, linkedDir, "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("directory symlinks are unavailable in this environment");
      return;
    }
    throw error;
  }

  assert.throws(
    () => tweak.resolveProjectEnvFile({ projectPath, filePath: path.join(linkedDir, ".env.local") }, { fs, path, home: projectPath }),
    /must be inside the project/,
  );
});

test("renderer source registers Projects settings page and accordion markers", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.githubRepo, "hulibrands/tweakers");
  assert.match(source, /api\.settings\.registerPage\(\{/);
  assert.match(source, /title:\s*"Projects"/);
  assert.match(source, /groupTitle:\s*"Projects"/);
  assert.match(source, /parentPage:\s*true/);
  assert.match(source, /listProjectSettingsPages/);
  assert.match(source, /sidebarAccentColor/);
  assert.match(source, /sidebarAccentTextColor/);
  assert.match(source, /sidebarProjectAccentFromNode/);
  assert.match(source, /projectAccentChildLight/);
  assert.match(source, /projectSettingsSidebarAccent/);
  assert.match(source, /renderProjectSettingsPage/);
  assert.match(source, /chromeHealthDashboard/);
  assert.match(source, /data-chrome-verifier-status-path/);
  assert.match(source, /runProjectChromeVerifier/);
  assert.match(source, /dataset\.projectsAccordion/);
  assert.match(source, /dataset\.projectsEnvRedacted/);
  assert.match(source, /compactText\(node\.textContent\) === "Chats"/);
  assert.match(source, /Managed by Projects for this project\./);
  assert.doesNotMatch(source, /existing Plugin Profiles assignment store/);
  assert.doesNotMatch(source, /sk-secret|postgres:\/\/user:pass/);
});

test("project page sync backs off while main IPC handlers are unavailable", () => {
  const missingHandlerMessage =
    "Error invoking remote method 'codexpp:co.thomashulihan.projects:listProjects': Error: No handler registered for 'codexpp:co.thomashulihan.projects:listProjects'";

  assert.equal(tweak.projectPageSyncDelayMs(missingHandlerMessage), 15_000);
  assert.equal(tweak.projectPageSyncDelayMs("temporary read failure"), 8_000);

  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /project settings page sync waiting for main handlers/);
  assert.match(source, /state\.nextAllowedAt = now \+ delayMs/);
  assert.match(source, /state\.lastErrorMessage !== message/);
});

test("renderer source evaluates without CommonJS require", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.doesNotThrow(() => vm.runInNewContext(source, {
    module: { exports: {} },
  }));
});

function projectRow(name, projectPath) {
  const row = new FakeElement("div");
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-label", name);
  const button = new FakeElement("button");
  button.setAttribute("data-app-action-sidebar-project-id", projectPath);
  button.setAttribute("data-app-action-sidebar-project-label", name);
  button.setAttribute("aria-label", name);
  row.appendChild(button);
  return row;
}

function chatRow(label) {
  const row = new FakeElement("div");
  row.textContent = label;
  row.setAttribute("aria-label", label);
  return row;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this._textContent = "";
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    if (node.parentElement) node.remove();
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  insertBefore(node, reference) {
    if (node === reference) return node;
    if (node.parentElement) node.remove();
    node.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, node);
    else this.children.push(node);
    return node;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] || null : null;
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.walk()) {
      if (matchesSelector(child, selector)) matches.push(child);
    }
    return matches;
  }

  *walk() {
    for (const child of this.children) {
      yield child;
      yield* child.walk();
    }
  }
}

function matchesSelector(element, selector) {
  const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (!attr) return false;
  const [, name, value] = attr;
  const actual = element.getAttribute(name);
  return value === undefined ? actual !== null : actual === value;
}
