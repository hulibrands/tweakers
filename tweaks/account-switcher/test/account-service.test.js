const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function authWithEmail(email, extra = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return JSON.stringify({
    auth_mode: "chatgpt",
    ...extra,
    tokens: {
      id_token: `${header}.${payload}.`,
      access_token: "access",
      refresh_token: "refresh",
    },
  });
}

async function withTempHome(fn) {
  const originalHome = process.env.HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-account-switcher-"));
  process.env.HOME = home;
  delete require.cache[require.resolve("../src/account/service")];

  try {
    return await fn(home);
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function touch(filePath, isoDate) {
  const date = new Date(isoDate);
  await fs.utimes(filePath, date, date);
}

test("state includes saved account email metadata", async () => {
  const originalHome = process.env.HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-account-switcher-"));
  process.env.HOME = home;
  delete require.cache[require.resolve("../src/account/service")];

  try {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(accountsDir, "work.json"), authWithEmail("work@example.com"));
    await fs.writeFile(path.join(accountsDir, "personal.json"), authWithEmail("me@example.com"));
    await fs.writeFile(path.join(codexDir, "auth.json"), authWithEmail("work@example.com"));

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { warn() {} } });
    const result = await service.handle({ action: "state" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accountEmails, {
      personal: "me@example.com",
      work: "work@example.com",
    });
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("state includes cached account usage metadata", async () => {
  const originalHome = process.env.HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-account-switcher-"));
  process.env.HOME = home;
  delete require.cache[require.resolve("../src/account/service")];

  try {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(accountsDir, "work.json"), authWithEmail("work@example.com"));
    await fs.writeFile(path.join(codexDir, "auth.json"), authWithEmail("work@example.com"));
    await fs.writeFile(
      path.join(codexDir, "auth_accounts_usage.json"),
      JSON.stringify({
        work: {
          fiveHour: { label: "5h", pct: 72, resetAt: "8:30 PM" },
          weekly: { label: "Weekly", pct: 91, resetAt: "Sat, 6:00 PM" },
          at: 1777728000000,
        },
      }),
    );

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { warn() {} } });
    const result = await service.handle({ action: "state" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accountUsage, {
      work: {
        fiveHour: { label: "5h", pct: 72, resetAt: "8:30 PM" },
        weekly: { label: "Weekly", pct: 91, resetAt: "Sat, 6:00 PM" },
        at: 1777728000000,
      },
    });
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("destructive account actions require a fresh matching intent", async () => {
  await withTempHome(async (home) => {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(accountsDir, "work.json"), authWithEmail("work@example.com"));

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { info() {}, warn() {} } });

    const denied = await service.handle({ action: "delete", name: "work" });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /fresh confirmation intent/i);
    assert.equal(await fs.readFile(path.join(accountsDir, "work.json"), "utf8"), authWithEmail("work@example.com"));

    const intentResult = await service.handle({ action: "create-intent", intentAction: "delete", name: "work" });
    assert.equal(intentResult.ok, true);
    assert.equal(typeof intentResult.state.intent, "string");

    const wrongName = await service.handle({ action: "delete", name: "personal", intent: intentResult.state.intent });
    assert.equal(wrongName.ok, false);
    assert.match(wrongName.error, /fresh confirmation intent/i);

    const secondIntent = await service.handle({ action: "create-intent", intentAction: "delete", name: "work" });
    const deleted = await service.handle({ action: "delete", name: "work", intent: secondIntent.state.intent });
    assert.equal(deleted.ok, true);
    await assert.rejects(fs.stat(path.join(accountsDir, "work.json")), { code: "ENOENT" });

    const reused = await service.handle({ action: "delete", name: "work", intent: secondIntent.state.intent });
    assert.equal(reused.ok, false);
    assert.match(reused.error, /fresh confirmation intent/i);
  });
});

test("switching writes private backups and prunes stale account-switcher backups", async () => {
  await withTempHome(async (home) => {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), authWithEmail("active@example.com"), { mode: 0o644 });
    await fs.writeFile(path.join(accountsDir, "work.json"), authWithEmail("work@example.com"), { mode: 0o644 });
    await fs.writeFile(path.join(codexDir, "auth.account-switcher-unrelated.txt"), "keep");

    for (let index = 0; index < 10; index += 1) {
      const file = path.join(codexDir, `auth.account-switcher-prev-2026-05-${String(index + 1).padStart(2, "0")}T00-00-00-000Z.json`);
      await fs.writeFile(file, authWithEmail(`old-${index}@example.com`));
      await touch(file, `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
    }

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { info() {}, warn() {} } });
    const intentResult = await service.handle({ action: "create-intent", intentAction: "switch", name: "work" });
    const switched = await service.handle({ action: "switch", name: "work", intent: intentResult.state.intent });

    assert.equal(switched.ok, true);
    const entries = await fs.readdir(codexDir);
    const backups = entries.filter((entry) => /^auth\.account-switcher-(?:prev|backup)-.+\.json$/.test(entry)).sort();
    assert.equal(backups.length, 8);
    assert.equal(entries.includes("auth.account-switcher-unrelated.txt"), true);
    assert.equal(backups.some((entry) => entry.includes("2026-05-01")), false);
    assert.equal(backups.some((entry) => entry.includes("2026-05-02")), false);
    assert.equal(backups.some((entry) => !entry.includes("2026-05-")), true);

    if (process.platform !== "win32") {
      const newestBackup = backups.find((entry) => !entry.includes("2026-05-"));
      assert.ok(newestBackup);
      const backupMode = (await fs.stat(path.join(codexDir, newestBackup))).mode & 0o777;
      const activeMode = (await fs.stat(path.join(codexDir, "auth.json"))).mode & 0o777;
      assert.equal(backupMode, 0o600);
      assert.equal(activeMode, 0o600);
    }
  });
});

test("saving the current account stores the snapshot as a private file", async () => {
  await withTempHome(async (home) => {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), authWithEmail("active@example.com"), { mode: 0o644 });

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { warn() {} } });
    const result = await service.handle({ action: "save", name: "active" });

    assert.equal(result.ok, true);
    if (process.platform !== "win32") {
      const savedMode = (await fs.stat(path.join(accountsDir, "active.json"))).mode & 0o777;
      assert.equal(savedMode, 0o600);
    }
  });
});

test("refresh-usage stores active account usage", async () => {
  const originalHome = process.env.HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-account-switcher-"));
  process.env.HOME = home;
  delete require.cache[require.resolve("../src/account/service")];

  try {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(accountsDir, "work.json"), authWithEmail("work@example.com"));
    await fs.writeFile(path.join(codexDir, "auth.json"), authWithEmail("work@example.com"));

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({
      log: { warn() {} },
      fetchActiveUsage: async () => ({
        fiveHour: { label: "5h", pct: 64, resetAt: "9:00 PM" },
        weekly: { label: "Weekly", pct: 88, resetAt: "Sun, 6:00 PM" },
        at: 1777729000000,
      }),
    });
    const result = await service.handle({ action: "refresh-usage" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accountUsage.work, {
      fiveHour: { label: "5h", pct: 64, resetAt: "9:00 PM" },
      weekly: { label: "Weekly", pct: 88, resetAt: "Sun, 6:00 PM" },
      at: 1777729000000,
    });
    const usageCache = JSON.parse(
      await fs.readFile(path.join(codexDir, "auth_accounts_usage.json"), "utf8"),
    );
    assert.equal(usageCache.work.fiveHour.pct, 64);
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("state hides duplicate email accounts and keeps the active match", async () => {
  await withTempHome(async (home) => {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });

    const oldAuth = authWithEmail("work@example.com", { profile_id: "old" });
    const activeAuth = authWithEmail("work@example.com", { profile_id: "active" });
    await fs.writeFile(path.join(accountsDir, "work-old.json"), oldAuth);
    await fs.writeFile(path.join(accountsDir, "work-current.json"), activeAuth);
    await fs.writeFile(path.join(codexDir, "auth.json"), activeAuth);
    await touch(path.join(accountsDir, "work-old.json"), "2026-05-13T10:00:00.000Z");
    await touch(path.join(accountsDir, "work-current.json"), "2026-05-12T10:00:00.000Z");

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { warn() {} } });
    const result = await service.handle({ action: "state" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["work-current"]);
    assert.equal(result.state.current, "work-current");
    assert.deepEqual(result.state.accountEmails, { "work-current": "work@example.com" });
    assert.deepEqual((await fs.readdir(accountsDir)).sort(), ["work-current.json", "work-old.json"]);
  });
});

test("state refreshes matching saved email instead of creating generic autosave", async () => {
  await withTempHome(async (home) => {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });

    const oldAuth = authWithEmail("work@example.com", { profile_id: "old-token" });
    const refreshedAuth = authWithEmail("work@example.com", { profile_id: "refreshed-token" });
    await fs.writeFile(path.join(accountsDir, "work.json"), oldAuth);
    await fs.writeFile(path.join(codexDir, "auth.json"), refreshedAuth);

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { warn() {} } });
    const result = await service.handle({ action: "state" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["work"]);
    assert.equal(result.state.current, "work");
    assert.equal(await fs.readFile(path.join(accountsDir, "work.json"), "utf8"), refreshedAuth);
    await assert.rejects(fs.stat(path.join(accountsDir, "account.json")), { code: "ENOENT" });
  });
});

test("state hides duplicate email accounts and keeps newest when none is active", async () => {
  await withTempHome(async (home) => {
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });

    await fs.writeFile(path.join(accountsDir, "work-old.json"), authWithEmail("work@example.com", { profile_id: "old" }));
    await fs.writeFile(path.join(accountsDir, "work-new.json"), authWithEmail("work@example.com", { profile_id: "new" }));
    await fs.writeFile(path.join(accountsDir, "other.json"), authWithEmail("other@example.com"));
    await fs.writeFile(path.join(codexDir, "auth.json"), authWithEmail("active@example.com"));
    await touch(path.join(accountsDir, "work-old.json"), "2026-05-12T10:00:00.000Z");
    await touch(path.join(accountsDir, "work-new.json"), "2026-05-13T10:00:00.000Z");

    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({ log: { warn() {} } });
    const result = await service.handle({ action: "state" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["account", "other", "work-new"]);
    assert.equal(result.state.current, "account");
    assert.equal(result.state.accountEmails["work-new"], "work@example.com");
    assert.deepEqual(
      (await fs.readdir(accountsDir)).filter((name) => name.startsWith("work-")).sort(),
      ["work-new.json", "work-old.json"],
    );
  });
});

test("usage summary includes reset time for exhausted windows", () => {
  const { accountUsageSummary } = require("../src/ui-components");
  const originalNow = Date.now;
  Date.now = () => 1777728300000;

  try {
    const summary = accountUsageSummary(
      {
        accountUsage: {
          work: {
            fiveHour: { label: "5h", pct: 0, resetAt: "8:30 PM" },
            weekly: { label: "Weekly", pct: 0, resetAt: "Sat, 6:00 PM" },
            at: 1777728000000,
          },
        },
      },
      "work",
    );

    assert.equal(summary, "5h 0%, resets 8:30 PM · Weekly 0%, resets Sat, 6:00 PM");
  } finally {
    Date.now = originalNow;
  }
});

test("usage summary omits cache age for non-exhausted windows", () => {
  const { accountUsageSummary } = require("../src/ui-components");
  const originalNow = Date.now;
  Date.now = () => 1777728300000;

  try {
    const summary = accountUsageSummary(
      {
        accountUsage: {
          work: {
            fiveHour: { label: "5h", pct: 92, resetAt: "8:30 PM" },
            weekly: { label: "Weekly", pct: 82, resetAt: "Sat, 6:00 PM" },
            at: 1777728000000,
          },
        },
      },
      "work",
    );

    assert.equal(summary, "5h 92% · Weekly 82%");
  } finally {
    Date.now = originalNow;
  }
});

test("service failures do not require a logger", async () => {
  await withTempHome(async () => {
    const { createAccountService } = require("../src/account/service");
    const service = createAccountService({});
    const result = await service.handle({ action: "save", name: "work" });

    assert.equal(result.ok, false);
    assert.match(result.error, /No active Codex auth file/);
  });
});
