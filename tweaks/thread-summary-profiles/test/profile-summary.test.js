const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tweak = require("../index.js").__test;

test("source cleanup runs before repeated starts install new observers", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /function stopActiveCleanup\(\)/);
  assert.match(source, /start\(api\) \{\s+stopActiveCleanup\(\);/);
});

test("resolver emits project-scoped profile rows in stable order with local metadata", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(projectPath, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(projectPath, ".railway"), { recursive: true });
  fs.mkdirSync(path.join(projectPath, ".git"), { recursive: true });
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.writeFileSync(path.join(projectPath, ".codex", "config.toml"), [
    "[mcp_servers.supabase]",
    "\"ignored\" = \"secret-looking text is ignored\"",
    "url = \"https://mcp.supabase.com/mcp?project_ref=abc123&features=database,docs\"",
    "bearer_token_env_var = \"SUPABASE_ACCESS_TOKEN\"",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(projectPath, ".railway", "project.json"), JSON.stringify({
    projectId: "railway-project-1",
    projectName: "Railway Project",
  }), "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.project-chrome-profile.json"), JSON.stringify({
    assignments: {
      [projectPath]: {
        profileName: "Work",
        profileDirectory: "Profile 7",
        preferredProfiles: [{ profileName: "Work", profileDirectory: "Profile 7", preferencesPath: "/Chrome/Profile 7/Preferences" }],
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
    },
  }), "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    googleWorkspaceAssignments: {
      [projectPath]: {
        gmail: { email: "mail@example.test", source: "manual", updatedAt: "2026-05-28T12:00:00.000Z" },
        "google-drive": { email: "drive@example.test", source: "manual", updatedAt: "2026-05-28T12:00:00.000Z" },
      },
    },
    modalWorkspaceAssignments: {
      [projectPath]: {
        profile: "admin-56995",
        workspace: "admin-56995",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
    },
    decodoAssignments: {
      [projectPath]: {
        accountName: "Repo Decodo",
        username: "repo-decodo",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
    },
  }), "utf8");

  const childProcess = {
    execFileSync(command, args) {
      if (command === "git" && args.includes("rev-parse")) return `${projectPath}\n`;
      if (command === "git" && args.includes("remote")) {
        return "origin\thttps://github.com/hulibrands/codex-plusplus.git (fetch)\n";
      }
      if (args.includes("modal")) {
        return JSON.stringify([{ name: "admin-56995", workspace: "admin-56995", active: true }]);
      }
      return "";
    },
  };

  const summary = tweak.buildThreadProfileSummary({ projectPath, projectName: "Repo" }, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    childProcess,
  });

  assert.deepEqual(summary.rows.map((row) => row.id), tweak.ROW_ORDER);
  assert.deepEqual(summary.rows.map((row) => row.label), ["Chrome", "Supabase", "GitHub", "Google Drive", "Gmail", "Modal", "Decodo", "Railway"]);
  assert.equal(summary.rows[0].value, "Work");
  assert.equal(summary.rows[1].value, "abc123");
  assert.equal(summary.rows[1].detail, "database, docs");
  assert.equal(summary.rows[2].value, "hulibrands/codex-plusplus");
  assert.equal(summary.rows[3].value, "drive@example.test");
  assert.equal(summary.rows[4].value, "mail@example.test");
  assert.equal(summary.rows[5].status, "CLI checked");
  assert.equal(summary.rows[6].value, "Repo Decodo");
  assert.equal(summary.rows[7].value, "Railway Project");
  assert.ok(summary.rows.every((row) => row.action));
  assert.doesNotMatch(JSON.stringify(summary), /SUPABASE_ACCESS_TOKEN|bearer|token/i);
});

test("resolver uses safe fallback rows when nothing is configured", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(projectPath, { recursive: true });

  const summary = tweak.buildThreadProfileSummary({ projectPath }, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    skipModalCli: true,
    childProcess: { execFileSync: () => "" },
  });

  assert.deepEqual(summary.rows, []);
});

test("resolver hides saved provider accounts without project assignment or project config", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    supabaseProfiles: [{ name: "Saved Supabase", projectRef: "global-supabase", bearerTokenEnvVar: "SUPABASE_ACCESS_TOKEN" }],
    modalWorkspaceAccounts: [{ id: "modal-global", name: "Global Modal", profile: "global", workspace: "global" }],
    decodoAccounts: [{ id: "decodo-global", name: "Global Decodo", username: "global-decodo" }],
  }), "utf8");

  const summary = tweak.buildThreadProfileSummary({ projectPath }, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    skipModalCli: true,
    childProcess: { execFileSync: () => "" },
  });

  assert.deepEqual(summary.rows, []);
  assert.doesNotMatch(JSON.stringify(summary), /Global|global-supabase|global-decodo/);
});

test("resolver shows Railway only from project-local Railway config", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(projectPath, ".railway"), { recursive: true });
  fs.writeFileSync(path.join(projectPath, ".railway", "environment.json"), JSON.stringify({
    projectId: "railway-project-1",
    environmentName: "production",
  }), "utf8");

  const summary = tweak.buildThreadProfileSummary({ projectPath }, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    skipModalCli: true,
    childProcess: { execFileSync: () => "" },
  });
  const railway = summary.rows.find((row) => row.id === "railway");

  assert.equal(railway.value, "railway-project-1");
  assert.equal(railway.detail, "production");
  assert.equal(railway.status, "Project config detected");
});

test("resolver infers the only configured project when renderer context is missing", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.project-chrome-profile.json"), JSON.stringify({
    assignments: {
      [projectPath]: {
        profileName: "Only Profile",
        profileDirectory: "Profile 1",
      },
    },
  }), "utf8");

  const summary = tweak.buildThreadProfileSummary({}, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    skipModalCli: true,
    childProcess: { execFileSync: () => "" },
  });

  assert.equal(summary.projectPath, projectPath);
  assert.equal(summary.rows[0].value, "Only Profile");
});

test("resolver uses the current working directory when renderer context is missing and multiple projects exist", () => {
  const root = tempDir();
  const firstProject = path.join(root, "Projects", "first");
  const secondProject = path.join(root, "Projects", "second");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(firstProject, { recursive: true });
  fs.mkdirSync(secondProject, { recursive: true });
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.project-chrome-profile.json"), JSON.stringify({
    assignments: {
      [firstProject]: { profileName: "First Profile", profileDirectory: "Profile 1" },
      [secondProject]: { profileName: "Second Profile", profileDirectory: "Profile 2" },
    },
  }), "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    sidebarProjects: [
      { name: "First", projectPath: firstProject },
      { name: "Second", projectPath: secondProject },
    ],
  }), "utf8");

  const summary = tweak.buildThreadProfileSummary({}, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    cwd: path.join(secondProject, "nested"),
    skipModalCli: true,
    childProcess: { execFileSync: () => "" },
  });

  assert.equal(summary.projectPath, secondProject);
  assert.equal(summary.rows[0].value, "Second Profile");
});

test("modal row warns when active CLI context differs from assignment", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    modalWorkspaceAssignments: {
      [projectPath]: { profile: "expected", workspace: "expected-workspace" },
    },
  }), "utf8");
  const childProcess = {
    execFileSync(command, args) {
      if (args.includes("modal")) return JSON.stringify([{ name: "actual", workspace: "actual-workspace", active: true }]);
      return "";
    },
  };

  const summary = tweak.buildThreadProfileSummary({ projectPath }, { fs, os, path, userRoot, home: root, childProcess });
  const modal = summary.rows.find((row) => row.id === "modal");

  assert.equal(modal.state, "warning");
  assert.equal(modal.status, "CLI conflict");
  assert.match(modal.detail, /actual \/ actual-workspace/);
});

test("summary cache reuses project rows during short renderer reinjection bursts", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  const summaryCache = new Map();
  let modalCalls = 0;
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    modalWorkspaceAssignments: {
      [projectPath]: { profile: "expected", workspace: "expected-workspace" },
    },
  }), "utf8");
  const childProcess = {
    execFileSync(command, args) {
      if (args.includes("modal")) {
        modalCalls += 1;
        return JSON.stringify([{ name: "expected", workspace: "expected-workspace", active: true }]);
      }
      return "";
    },
  };
  const options = { fs, os, path, userRoot, home: root, childProcess, summaryCache, modalCliCache: false, now: 1000 };

  const first = tweak.getCachedThreadProfileSummary({ projectPath }, options);
  options.now = 2000;
  const second = tweak.getCachedThreadProfileSummary({ projectPath }, options);
  options.now = 8000;
  const third = tweak.getCachedThreadProfileSummary({ projectPath }, options);

  assert.equal(modalCalls, 2);
  assert.deepEqual(first.rows, second.rows);
  assert.equal(third.rows.find((row) => row.id === "modal").status, "CLI checked");
});

test("modal CLI cache keeps conflict checks out of summary rebuilds and shows age", () => {
  const root = tempDir();
  const projectPath = path.join(root, "repo");
  const userRoot = path.join(root, "codex-plusplus");
  const modalCliCache = new Map();
  let modalCalls = 0;
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    modalWorkspaceAssignments: {
      [projectPath]: { profile: "expected", workspace: "expected-workspace" },
    },
  }), "utf8");
  const childProcess = {
    execFileSync(command, args) {
      if (args.includes("modal")) {
        modalCalls += 1;
        return JSON.stringify([{ name: "actual", workspace: "actual-workspace", active: true }]);
      }
      return "";
    },
  };
  const options = { fs, os, path, userRoot, home: root, childProcess, modalCliCache, now: 1000 };

  tweak.buildThreadProfileSummary({ projectPath }, options);
  options.now = 12000;
  const summary = tweak.buildThreadProfileSummary({ projectPath }, options);
  const modal = summary.rows.find((row) => row.id === "modal");

  assert.equal(modalCalls, 1);
  assert.equal(modal.state, "warning");
  assert.match(modal.detail, /checked 11s ago/);
});

test("GitHub remote parsing supports common local remote formats", () => {
  assert.deepEqual(tweak.parseGithubRemote("https://github.com/hulibrands/codex-plusplus.git"), {
    owner: "hulibrands",
    name: "codex-plusplus",
  });
  assert.deepEqual(tweak.parseGithubRemote("git@github.com:openai/codex.git"), {
    owner: "openai",
    name: "codex",
  });
  assert.deepEqual(tweak.parseGithubRemote("gh:owner/repo"), {
    owner: "owner",
    name: "repo",
  });
});

test("GitHub remote parsing rejects token-bearing URL tails", () => {
  assert.equal(tweak.parseGithubRemote("https://github.com/owner/repo?token=SECRET"), null);
  assert.equal(tweak.parseGithubRemote("https://oauth:SECRET@github.com/owner/repo.git"), null);
  assert.equal(tweak.parseGithubRemote("https://github.com/owner/repo.git#bearer"), null);
});

test("resolver maps visible TRR workspace context to configured rows only", () => {
  const root = tempDir();
  const projectPath = path.join(root, "Projects", "TRR");
  const userRoot = path.join(root, "codex-plusplus");
  fs.mkdirSync(path.join(projectPath, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(projectPath, "profiles"), { recursive: true });
  fs.mkdirSync(path.join(projectPath, ".git"), { recursive: true });
  fs.mkdirSync(path.join(userRoot, "storage"), { recursive: true });
  fs.writeFileSync(path.join(projectPath, ".codex", "config.toml"), [
    "[mcp_servers.supabase]",
    "url = \"https://mcp.supabase.com/mcp?project_ref=vwxfvzutyufrkhfgoeaa&features=database\"",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(projectPath, "profiles", "local-full.env"), [
    "WORKSPACE_TRR_REMOTE_EXECUTOR=modal",
    "WORKSPACE_TRR_MODAL_ENABLED=1",
    "WORKSPACE_TRR_MODAL_APP_NAME=trr-backend-jobs",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.project-chrome-profile.json"), JSON.stringify({
    assignments: {
      [projectPath]: {
        profileName: "admin@thereality.report",
        profileDirectory: "Profile 11",
      },
    },
  }), "utf8");
  fs.writeFileSync(path.join(userRoot, "storage", "co.thomashulihan.projects.json"), JSON.stringify({
    sidebarProjects: [{ name: "TRR", projectPath }],
  }), "utf8");
  const childProcess = {
    execFileSync(command, args) {
      if (command === "git" && args.includes("rev-parse")) return `${projectPath}\n`;
      if (command === "git" && args.includes("remote")) return "origin\thttps://github.com/therealityreport/trr-workspace.git (fetch)\n";
      return "";
    },
  };

  const summary = tweak.buildThreadProfileSummary({ projectName: "TRR" }, {
    fs,
    os,
    path,
    userRoot,
    home: root,
    skipModalCli: true,
    childProcess,
  });

  assert.equal(summary.projectPath, projectPath);
  assert.deepEqual(summary.rows.map((row) => row.id), ["chrome", "supabase", "github"]);
  assert.deepEqual(summary.rows.map((row) => row.value), [
    "admin@thereality.report",
    "vwxfvzutyufrkhfgoeaa",
    "therealityreport/trr-workspace",
  ]);
});

test("Supabase config parsing returns only non-secret project metadata", () => {
  const binding = tweak.parseSupabaseConfigToml([
    "[mcp_servers.supabase]",
    "url = \"https://mcp.supabase.com/mcp?project_ref=abc123&features=database,docs\"",
    "bearer_token_env_var = \"SUPABASE_ACCESS_TOKEN\"",
  ].join("\n"));

  assert.deepEqual(binding, { projectRef: "abc123", features: ["database", "docs"] });
  assert.doesNotMatch(JSON.stringify(binding), /SUPABASE_ACCESS_TOKEN|bearer|token/i);
});

test("action normalization rejects unsafe external and secret-looking targets", () => {
  assert.deepEqual(tweak.sanitizeAction({ type: "external", target: "https://github.com/hulibrands/codex-plusplus" }), {
    type: "external",
    target: "https://github.com/hulibrands/codex-plusplus",
  });
  assert.equal(tweak.sanitizeAction({ type: "external", target: "https://example.com/repo" }), null);
  assert.equal(tweak.sanitizeAction({ type: "file", target: "/tmp/oauth-token.txt" }), null);
});

test("source and packaged default thread summary profile copies stay in sync", () => {
  const repoRoot = findRepoRoot(__dirname);
  const sourceRoot = path.join(repoRoot, "tweaks", "base", "thomashulihan-thread-summary-profiles");
  const defaultRoot = path.join(repoRoot, "packages", "installer", "assets", "default-tweaks", "co.thomashulihan.thread-summary-profiles");

  assert.deepEqual(snapshotDirectory(defaultRoot), snapshotDirectory(sourceRoot));
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "thread-summary-profiles-"));
}

function findRepoRoot(start) {
  let current = start;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "tweaks"))) return current;
    current = path.dirname(current);
  }
  throw new Error("Could not find repository root.");
}

function snapshotDirectory(root) {
  const entries = {};
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const filePath = path.join(dir, name);
      const rel = path.relative(root, filePath).replace(/\\/g, "/");
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        visit(filePath);
      } else {
        entries[rel] = fs.readFileSync(filePath, "utf8");
      }
    }
  };
  visit(root);
  return entries;
}
