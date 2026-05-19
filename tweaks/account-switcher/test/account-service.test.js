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
