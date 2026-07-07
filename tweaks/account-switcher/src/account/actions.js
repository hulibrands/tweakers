const { t } = require("../i18n");
const {
  nodeDeps,
  codexAuthPaths,
  normalizeAccountName,
  accountPath,
  ensureDir,
  pathExists,
} = require("../node-utils");
const { readState } = require("./state");
const { getCurrentAccountName, listAccountNames } = require("./storage");
const { fetchActiveUsageSnapshot, writeAccountUsage } = require("./usage");

const BACKUP_FILE_PATTERN = /^auth\.account-switcher-(?:prev|backup)-.+\.json$/;
const BACKUP_RETENTION_COUNT = 8;
const AUTH_RELAUNCH_DELAY_MS = 250;

let authRelaunchScheduled = false;

async function saveCurrentAccount(rawName) {
  const { fsp } = nodeDeps();
  const { AUTH_PATH, ACCOUNTS_DIR, CURRENT_NAME_PATH } = codexAuthPaths();
  const name = normalizeAccountName(rawName);
  if (!(await pathExists(AUTH_PATH))) {
    throw new Error(`No active Codex auth file found at ${AUTH_PATH}`);
  }
  await ensureDir(ACCOUNTS_DIR);
  const target = accountPath(name);
  await copyPrivateFile(AUTH_PATH, target);
  await fsp.writeFile(CURRENT_NAME_PATH, `${name}\n`, "utf8");
  return readState({ notice: t("service.saved", { name }) });
}

async function switchAccount(rawName, api) {
  const { fsp, path } = nodeDeps();
  const { CODEX_DIR, AUTH_PATH, CURRENT_NAME_PATH } = codexAuthPaths();
  const name = normalizeAccountName(rawName);
  const source = accountPath(name);
  if (!(await pathExists(source))) throw new Error(`Saved account not found: ${name}`);
  await ensureDir(CODEX_DIR);
  // Atomic + recoverable: (1) copy current AUTH_PATH to a timestamped
  // pre-switch backup so a crash mid-switch can be undone, (2) write the
  // new content to a sibling temp file, (3) rename atomically over
  // AUTH_PATH so a power-loss between truncate and write never leaves an
  // empty auth.json. Same-filesystem rename is atomic on macOS APFS.
  if (await pathExists(AUTH_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await copyPrivateFile(AUTH_PATH, path.join(CODEX_DIR, `auth.account-switcher-prev-${stamp}.json`));
      await pruneAuthBackups(api);
    } catch (error) {
      // Best-effort: a missing backup is OK (we still have the source
      // account file under accountPath(name)); fall through to the
      // atomic rename below.
      api?.log?.warn?.(`[account-switcher] pre-switch backup failed: ${error && error.message ? error.message : String(error)}`);
    }
  }
  const tmp = `${AUTH_PATH}.codexpp-switch-tmp`;
  await copyPrivateFile(source, tmp);
  await fsp.rename(tmp, AUTH_PATH);
  await fsp.writeFile(CURRENT_NAME_PATH, `${name}\n`, "utf8");
  api?.log?.info?.("[account-switcher] switched auth file; scheduling ShadGPT relaunch");
  scheduleAuthRelaunch(api, "switch");
  return readState({
    notice: t("service.switched", { name }),
    requiresAppRelaunch: true,
    relaunchScheduled: true,
  });
}

async function deleteAccount(rawName) {
  const { fsp } = nodeDeps();
  const { CURRENT_NAME_PATH } = codexAuthPaths();
  const name = normalizeAccountName(rawName);
  await fsp.rm(accountPath(name), { force: true });

  try {
    const raw = await fsp.readFile(CURRENT_NAME_PATH, "utf8");
    if (raw.trim() === name) {
      await fsp.rm(CURRENT_NAME_PATH, { force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return readState({ notice: t("service.removed", { name }) });
}

async function clearActiveAuth(api) {
  const { fsp, path } = nodeDeps();
  const { CODEX_DIR, AUTH_PATH, CURRENT_NAME_PATH } = codexAuthPaths();
  await ensureDir(CODEX_DIR);
  if (await pathExists(AUTH_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyPrivateFile(AUTH_PATH, path.join(CODEX_DIR, `auth.account-switcher-backup-${stamp}.json`));
    await pruneAuthBackups(api);
    await fsp.rm(AUTH_PATH, { force: true });
  }
  await fsp.rm(CURRENT_NAME_PATH, { force: true });
  api?.log?.info?.("[account-switcher] cleared active auth file; scheduling ShadGPT relaunch");
  scheduleAuthRelaunch(api, "clear-active");
  return readState({
    notice: t("service.sessionCleared"),
    requiresAppRelaunch: true,
    relaunchScheduled: true,
  });
}

function scheduleAuthRelaunch(api, reason, deps = {}) {
  if (authRelaunchScheduled) {
    api?.log?.info?.(`[account-switcher] ShadGPT relaunch already scheduled; ignoring duplicate ${reason}`);
    return;
  }
  const setTimeoutFn = deps.setTimeout || setTimeout;
  const relaunch = deps.relaunchCodex || relaunchCodex;
  authRelaunchScheduled = true;
  setTimeoutFn(() => {
    Promise.resolve()
      .then(() => relaunch(api))
      .catch((error) => {
        api?.log?.warn?.("[account-switcher] scheduled ShadGPT relaunch failed", error?.message || String(error));
      })
      .finally(() => {
        authRelaunchScheduled = false;
      });
  }, AUTH_RELAUNCH_DELAY_MS);
}

function resetAuthRelaunchState() {
  authRelaunchScheduled = false;
}

async function copyPrivateFile(source, target) {
  const { fsp } = nodeDeps();
  await fsp.copyFile(source, target);
  await markPrivateFile(target);
}

async function markPrivateFile(target) {
  if (process.platform === "win32") return;
  const { fsp } = nodeDeps();
  await fsp.chmod(target, 0o600);
}

async function pruneAuthBackups(api, keep = BACKUP_RETENTION_COUNT) {
  const { fsp, path } = nodeDeps();
  const { CODEX_DIR } = codexAuthPaths();
  let entries;
  try {
    entries = await fsp.readdir(CODEX_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    api?.log?.warn?.(`[account-switcher] backup retention scan failed: ${error?.message || String(error)}`);
    return;
  }

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !BACKUP_FILE_PATTERN.test(entry.name)) continue;
    const filePath = path.join(CODEX_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      backups.push({ filePath, mtimeMs: stat.mtimeMs, name: entry.name });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        api?.log?.warn?.(`[account-switcher] backup stat failed: ${error?.message || String(error)}`);
      }
    }
  }

  backups.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  for (const stale of backups.slice(Math.max(0, keep))) {
    try {
      await fsp.rm(stale.filePath, { force: true });
    } catch (error) {
      api?.log?.warn?.(`[account-switcher] backup retention failed: ${error?.message || String(error)}`);
    }
  }
}

async function refreshActiveUsage(api) {
  const accounts = await listAccountNames();
  const current = await getCurrentAccountName(accounts);
  if (!current) return readState();
  const snapshot = await fetchActiveUsageSnapshot(api);
  await writeAccountUsage(current, snapshot);
  return readState();
}

async function relaunchCodex(api) {
  api?.log?.info?.("[account-switcher] relaunch requested");
  const electronRequire = eval("require");
  const { app } = electronRequire("electron");
  if (!app || (typeof app.quit !== "function" && typeof app.exit !== "function")) {
    throw new Error("Electron app runtime is not available for relaunch.");
  }
  const relaunch = scheduleDetachedRelaunch(api);
  setTimeout(() => {
    try {
      relaunch();
    } catch (error) {
      api?.log?.warn?.("[account-switcher] failed to spawn detached relaunch", error?.message || String(error));
    }
    try {
      if (typeof app.quit === "function") app.quit();
      else app.exit(0);
      if (typeof app.exit === "function") setTimeout(() => app.exit(0), 1500).unref?.();
    } catch {
      if (typeof app.exit === "function") app.exit(0);
    }
  }, 100);
  return readState({ notice: t("service.relaunching") });
}

function scheduleDetachedRelaunch(api) {
  if (process.platform !== "darwin") {
    return () => {
      const electronRequire = eval("require");
      const { app } = electronRequire("electron");
      app.relaunch();
    };
  }
  const { spawn, execFileSync } = require("node:child_process");
  const { path } = nodeDeps();
  const appRoot = path.dirname(path.dirname(path.dirname(process.execPath)));
  // The managed mirror renames its main binary off "Codex"; derive it from execPath.
  const mainBin = path.basename(process.execPath);
  // Never fall back to com.openai.codex: opening stock Codex by bundle id is how an
  // account switch could reopen the wrong app. If the mirror's bundle id can't be
  // read, the script opens APP_ROOT (the mirror) by path instead.
  const bundleId = readBundleId(appRoot, execFileSync, path) || "";
  return () => {
    const script = `
APP_ROOT=$1
BUNDLE_ID=$2
MAIN_PATTERN="$APP_ROOT/Contents/MacOS/${mainBin}"
has_main() { /usr/bin/pgrep -f "$MAIN_PATTERN" >/dev/null 2>&1; }
wait_gone() {
  deadline=$(( $(/bin/date +%s) + $1 ))
  while has_main; do
    [ "$(/bin/date +%s)" -ge "$deadline" ] && return 1
    /bin/sleep 0.25
  done
  return 0
}
if ! wait_gone 10; then
  /usr/bin/pkill -TERM -f "$MAIN_PATTERN" >/dev/null 2>&1 || true
  wait_gone 4 || true
fi
if has_main; then
  /usr/bin/pkill -KILL -f "$MAIN_PATTERN" >/dev/null 2>&1 || true
  wait_gone 4 || true
fi
/usr/bin/open -b "$BUNDLE_ID" >/dev/null 2>&1 || /usr/bin/open "$APP_ROOT" >/dev/null 2>&1 || true
`;
    const child = spawn(
      "/bin/sh",
      ["-c", script, "codexpp-account-switcher-restart", appRoot, bundleId],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
  };
}

function readBundleId(appRoot, execFileSync, path) {
  try {
    return execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleIdentifier", path.join(appRoot, "Contents", "Info.plist")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() || null;
  } catch {
    return null;
  }
}

module.exports = {
  saveCurrentAccount,
  switchAccount,
  deleteAccount,
  clearActiveAuth,
  refreshActiveUsage,
  relaunchCodex,
  resetAuthRelaunchState,
  __test: {
    BACKUP_RETENTION_COUNT,
    getAuthRelaunchScheduled: () => authRelaunchScheduled,
    markPrivateFile,
    pruneAuthBackups,
    scheduleAuthRelaunch,
  },
};
