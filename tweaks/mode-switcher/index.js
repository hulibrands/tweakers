/**
 * Mode Switcher tweak.
 *
 * Adds a "Mode" section above "ShadGPT Updates" in the ShadGPT Config page
 * with a two-segment pill (Codex / ShadGPT). Flipping the pill toggles every
 * OTHER user tweak between enabled and disabled, then relaunches Codex so the
 * change takes effect for both main- and renderer-scope tweaks.
 *
 * Why a tweak instead of a runtime patch: tweaks live under
 *   ~/Library/Application Support/<ShadGPT support dir>/tweaks/
 * which is OUTSIDE the ShadGPT source dir, so ShadGPT
 * self-updates (which atomically rename the source root) leave it untouched.
 *
 * Coordination: when going to "Codex" mode, we snapshot every other tweak's
 * current `enabled` state into our own data dir, then write `enabled: false`
 * for each in the runtime's config.json. When going back to "ShadGPT", we
 * restore the snapshot. We do NOT use the v0.1.3 `safeMode` flag, because
 * that would also disable us — leaving no UI to flip back from.
 *
 * Renderer code path uses ONLY DOM APIs and `api.ipc.invoke`. The renderer
 * runs in Codex's sandboxed context (sandbox: true) where Node's `require`
 * is unavailable, so all `require()` calls live inside the main half.
 */

const SELF_ID = "co.thomashulihan.mode-switcher";
const MODE_SECTION_SELECTOR = "[data-codexpp-mode-switcher]";
const MODE_SECTION_LOCK = "__codexppModeSwitcherInjecting";
// After a real mode change the main half relaunches Codex so every tweak
// (main- AND renderer-scope) re-evaluates against the rewritten config.json.
// A bare location.reload() only re-runs the renderer, leaving main-scope tweak
// effects from the previous mode active — which is why switching felt like it
// "didn't restart Codex". RELAUNCH_DELAY_MS gives the set-mode IPC reply time
// to flush; RENDERER_RELOAD_FALLBACK_MS only fires if the relaunch was a no-op.
const RELAUNCH_DELAY_MS = 250;
const RENDERER_RELOAD_FALLBACK_MS = 1500;

let mainTeardown = null;
let rendererTeardown = null;

module.exports = {
  start(api) {
    if (api.process === "main") {
      return startMain(api);
    }
    return startRenderer(api);
  },
  stop() {
    runTeardown("renderer");
    runTeardown("main");
  },
};

function runTeardown(scope) {
  const teardown = scope === "main" ? mainTeardown : rendererTeardown;
  if (typeof teardown !== "function") return;
  if (scope === "main") {
    mainTeardown = null;
  } else {
    rendererTeardown = null;
  }
  teardown();
}

// ────────────────────────────────────────────────────────── main half ──

function startMain(api) {
  const path = require("node:path");
  const fs = require("node:fs");
  const os = require("node:os");

  const FALLBACK_ROOT_DIR = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "ShadGPT",
    "TweakerLibrary",
  );
  let rootInfoCache = null;

  api.log.info("[mode-switcher] main provider active");
  runTeardown("main");
  removeModeSwitcherIpcHandlers(api);

  api.ipc.handle("get-mode", async () => {
    const paths = await getRuntimePaths();
    return {
      mode: readState(paths).mode,
      supportRootFallback: paths.supportRootFallback,
      supportRootFallbackReason: paths.supportRootFallbackReason,
    };
  });

  api.ipc.handle("set-mode", async (mode) => {
    const paths = await getRuntimePaths();
    const next = mode === "regular" ? "regular" : "plusplus";
    const state = readState(paths);
    if (state.mode === next) return { mode: next, changed: false };

    const cfg = readConfig(paths);
    const otherTweaks = listTweaksExcludingSelf(paths);
    const modeChange = prepareModeChange(next, state, cfg, otherTweaks);

    applyModeTransaction(paths, state, cfg, modeChange.state, modeChange.config);
    touchReloadSentinel(paths);
    api.log.info(
      `[mode-switcher] mode set to ${next} (others affected: ${modeChange.otherIds.length})`,
    );
    const relaunch = modeChange.mainScopeAffected
      ? scheduleRelaunch()
      : { relaunchScheduled: false, restartRequired: false };
    return {
      mode: next,
      changed: true,
      mainScopeAffected: modeChange.mainScopeAffected,
      relaunchScheduled: relaunch.relaunchScheduled,
      restartRequired: relaunch.restartRequired,
      reason: relaunch.reason || null,
      supportRootFallback: paths.supportRootFallback,
      supportRootFallbackReason: paths.supportRootFallbackReason,
    };
  });

  const cleanup = () => {
    removeModeSwitcherIpcHandlers(api);
    if (mainTeardown === cleanup) mainTeardown = null;
  };
  mainTeardown = cleanup;
  return cleanup;

  async function getRuntimePaths() {
    const rootInfo = await getRootInfo();
    const rootDir = rootInfo.rootDir;
    const tweaksDir = path.join(rootDir, "tweaks");
    return {
      rootDir,
      configPath: path.join(rootDir, "config.json"),
      tweaksDir,
      dataDir: path.join(rootDir, "tweak-data", SELF_ID),
      statePath: path.join(rootDir, "tweak-data", SELF_ID, "state.json"),
      transactionPath: path.join(
        rootDir,
        "tweak-data",
        SELF_ID,
        "mode-change.transaction.json",
      ),
      reloadSentinel: path.join(tweaksDir, ".codexpp-safe-mode-reload"),
      supportRootFallback: rootInfo.fallback,
      supportRootFallbackReason: rootInfo.reason || null,
    };
  }

  async function getRootInfo() {
    if (rootInfoCache) return rootInfoCache;

    const runtimeRoot = await discoverRuntimeSupportRoot();
    if (runtimeRoot) {
      rootInfoCache = { rootDir: runtimeRoot, fallback: false, reason: null };
      return rootInfoCache;
    }

    const envRoot =
      cleanAbsolutePath(process.env.SHADGPT_USER_ROOT) ||
      cleanAbsolutePath(process.env.SHADGPT_TWEAKER_LIBRARY_HOME) ||
      cleanAbsolutePath(process.env.CODEX_PLUSPLUS_USER_ROOT);
    if (envRoot) {
      rootInfoCache = { rootDir: envRoot, fallback: false, reason: null };
      return rootInfoCache;
    }

    const reason =
      "Runtime support directory API is unavailable; using the ShadGPT support path.";
    api.log.warn(`[mode-switcher] ${reason} (${FALLBACK_ROOT_DIR})`);
    rootInfoCache = { rootDir: FALLBACK_ROOT_DIR, fallback: true, reason };
    return rootInfoCache;
  }

  async function discoverRuntimeSupportRoot() {
    try {
      const getUserPaths = api.codex?.tweaks?.getUserPaths;
      if (typeof getUserPaths !== "function") return null;
      const paths = await getUserPaths();
      return cleanAbsolutePath(paths?.userRoot);
    } catch (error) {
      api.log.warn("[mode-switcher] failed to discover runtime support directory", String(error));
      return null;
    }
  }

  function cleanAbsolutePath(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) return null;
    return trimmed;
  }

  function listTweaksExcludingSelf(paths) {
    let entries;
    try {
      entries = fs.readdirSync(paths.tweaksDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const tweaks = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name.endsWith(".bak")) continue;
      const tweakDir = path.join(paths.tweaksDir, entry.name);
      if (!entry.isDirectory() && !isDirectorySymlink(tweakDir, entry)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(
            path.join(tweakDir, "manifest.json"),
            "utf8",
          ),
        );
        if (typeof manifest.id === "string" && manifest.id !== SELF_ID) {
          tweaks.push({ id: manifest.id, scope: manifest.scope });
        }
      } catch {
        /* skip unreadable manifests */
      }
    }
    return tweaks;
  }

  function isMainScopeTweak(tweak) {
    return tweak.scope === "main" || tweak.scope === "both";
  }

  function readConfig(paths) {
    try {
      return JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
    } catch {
      return {};
    }
  }

  function writeConfig(paths, cfg) {
    writeJsonAtomic(paths.configPath, cfg, paths.rootDir);
  }

  function readState(paths) {
    recoverModeTransaction(paths);
    try {
      const raw = JSON.parse(fs.readFileSync(paths.statePath, "utf8"));
      return normalizeState(raw);
    } catch {
      return { mode: "plusplus", snapshot: {} };
    }
  }

  function writeState(paths, state) {
    writeJsonAtomic(paths.statePath, normalizeState(state), paths.dataDir);
  }

  function prepareModeChange(next, state, cfg, otherTweaks) {
    const otherIds = otherTweaks.map((tweak) => tweak.id);
    const nextConfig = cloneConfig(cfg);
    nextConfig.tweaks =
      nextConfig.tweaks && typeof nextConfig.tweaks === "object"
        ? nextConfig.tweaks
        : {};
    const nextState = cloneState(state);

    if (next === "regular") {
      const snapshot = {};
      for (const id of otherIds) {
        const tweakConfig = nextConfig.tweaks[id] || {};
        const enabled = tweakConfig.enabled !== false; // default true
        snapshot[id] = enabled;
        nextConfig.tweaks[id] = Object.assign({}, tweakConfig, { enabled: false });
      }
      nextState.snapshot = snapshot;
    } else {
      const snapshot = state.snapshot || {};
      for (const id of otherIds) {
        const wasEnabled = id in snapshot ? snapshot[id] : true;
        nextConfig.tweaks[id] = Object.assign({}, nextConfig.tweaks[id], {
          enabled: wasEnabled,
        });
      }
      nextState.snapshot = {};
    }

    nextState.mode = next;
    return {
      config: nextConfig,
      state: nextState,
      otherIds,
      mainScopeAffected: otherTweaks.some(isMainScopeTweak),
    };
  }

  function applyModeTransaction(
    paths,
    previousState,
    previousConfig,
    nextState,
    nextConfig,
  ) {
    writeModeTransaction(paths, {
      version: 1,
      previousConfig: cloneConfig(previousConfig),
      previousState: cloneState(previousState),
    });

    try {
      writeSnapshot(paths, nextState);
      writeConfig(paths, nextConfig);
      commitState(paths, nextState);
      removeModeTransaction(paths);
    } catch (error) {
      rollbackModeTransaction(paths, previousState, previousConfig);
      throw error;
    }
  }

  function writeSnapshot(paths, state) {
    writeState(paths, state);
  }

  function commitState(paths, state) {
    writeState(paths, state);
  }

  function writeModeTransaction(paths, transaction) {
    writeJsonAtomic(paths.transactionPath, transaction, paths.dataDir);
  }

  function recoverModeTransaction(paths) {
    const transaction = readModeTransaction(paths);
    if (!transaction) return;
    api.log.warn("[mode-switcher] recovering interrupted mode change");
    rollbackModeTransaction(paths, transaction.previousState, transaction.previousConfig);
  }

  function rollbackModeTransaction(paths, previousState, previousConfig) {
    try {
      if (previousConfig && typeof previousConfig === "object") {
        writeConfig(paths, previousConfig);
      }
    } catch (error) {
      api.log.warn("[mode-switcher] failed to roll back config", String(error));
    }

    try {
      writeState(paths, previousState);
    } catch (error) {
      api.log.warn("[mode-switcher] failed to roll back mode state", String(error));
    }

    removeModeTransaction(paths);
  }

  function readModeTransaction(paths) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths.transactionPath, "utf8"));
      if (!raw || typeof raw !== "object") return null;
      if (!raw.previousConfig || typeof raw.previousConfig !== "object") return null;
      return {
        previousConfig: raw.previousConfig,
        previousState: normalizeState(raw.previousState),
      };
    } catch {
      return null;
    }
  }

  function removeModeTransaction(paths) {
    try {
      fs.unlinkSync(paths.transactionPath);
    } catch {
      /* best-effort */
    }
  }

  function writeJsonAtomic(filePath, value, dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, filePath);
  }

  function cloneConfig(cfg) {
    return cfg && typeof cfg === "object"
      ? JSON.parse(JSON.stringify(cfg))
      : {};
  }

  function cloneState(state) {
    return normalizeState(JSON.parse(JSON.stringify(state || {})));
  }

  function normalizeState(raw) {
    return {
      mode: raw?.mode === "regular" ? "regular" : "plusplus",
      snapshot:
        raw?.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : {},
    };
  }

  function touchReloadSentinel(paths) {
    try {
      fs.mkdirSync(paths.tweaksDir, { recursive: true });
      fs.writeFileSync(paths.reloadSentinel, String(Date.now()), "utf8");
    } catch {
      /* best-effort */
    }
  }

  function scheduleRelaunch() {
    if (!canRelaunchRuntime()) {
      return {
        relaunchScheduled: false,
        restartRequired: true,
        reason: "Runtime relaunch is unavailable; restart Codex to finish switching modes.",
      };
    }

    // Do NOT use Electron app.relaunch(): on macOS it re-execs the bundle
    // directly (posix_spawn, not LaunchServices) and its detached relauncher
    // child races the dying primary — the fresh instance can boot before the
    // old one releases its single-instance lock, log "Exiting second desktop
    // instance", and app.exit(0) cleanly. Net effect: the old instance exits,
    // nothing comes back, and the whole app vanishes to the desktop (a clean
    // exit, so no crash report). Mirror the installer's proven external-open
    // path (clean-restart.ts / alerts.ts openCodex): spawn a DETACHED shell
    // that WAITS until no Codex main process remains (lock released), then
    // `open -b` brings up exactly ONE fresh instance. Then exit ourselves so
    // that wait completes.
    setTimeout(() => {
      try {
        spawnDetachedRestart();
      } catch (error) {
        api.log.warn("[mode-switcher] failed to spawn restart", String(error));
      }
      try {
        const { app } = require("electron");
        app.exit(0);
      } catch (error) {
        api.log.warn("[mode-switcher] failed to exit for relaunch", String(error));
      }
    }, RELAUNCH_DELAY_MS);

    return { relaunchScheduled: true, restartRequired: false };
  }

  function canRelaunchRuntime() {
    if (process.platform !== "darwin") return false;
    try {
      require("node:child_process");
      require("electron");
      return true;
    } catch {
      return false;
    }
  }

  function spawnDetachedRestart() {
    const { spawn } = require("node:child_process");
    // The Electron main process execPath is <appRoot>/Contents/MacOS/<binary>. The
    // managed mirror renames that binary off "Codex", so derive it from execPath.
    const appRoot = path.dirname(path.dirname(path.dirname(process.execPath)));
    const mainBin = path.basename(process.execPath);
    // Never fall back to com.openai.codex: opening stock Codex by bundle id is
    // how a mode switch "switched from ShadGPT to Codex" and left the managed
    // mirror deferring in the background. If the mirror's bundle id can't be
    // read, the script opens APP_ROOT (the mirror) by path instead.
    const bundleId = readBundleId(appRoot) || "";
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
# This script runs fully detached after the app exits, so "open" launches the
# app but does NOT bring it to the foreground — it comes up hidden behind
# whatever is now frontmost. Force activation so a mode switch returns to the
# front instead of running in the background.
if [ -n "$BUNDLE_ID" ]; then
  for _attempt in 1 2 3 4 5; do
    /usr/bin/osascript -e "tell application id \\"$BUNDLE_ID\\" to activate" >/dev/null 2>&1 && break
    /bin/sleep 1
  done
fi
`;
    const child = spawn(
      "/bin/sh",
      ["-c", script, "codexpp-mode-switcher-restart", appRoot, bundleId],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
  }

  function readBundleId(appRoot) {
    try {
      const { execFileSync } = require("node:child_process");
      const out = execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleIdentifier", path.join(appRoot, "Contents", "Info.plist")],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  function removeModeSwitcherIpcHandlers(api) {
    try {
      const { ipcMain } = require("electron");
      ipcMain.removeHandler(`codexpp:${SELF_ID}:get-mode`);
      ipcMain.removeHandler(`codexpp:${SELF_ID}:set-mode`);
    } catch (error) {
      api.log.warn("[mode-switcher] failed to clear stale IPC handlers", String(error));
    }
  }

  function isDirectorySymlink(tweakDir, entry) {
    if (!entry.isSymbolicLink()) return false;
    try {
      return fs.statSync(tweakDir).isDirectory();
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────── renderer half ──

function startRenderer(api) {
  api.log.info("[mode-switcher] renderer provider active");
  runTeardown("renderer");

  const pageHandle = registerModeSettingsPage(api);

  // Coalesce mutation-driven reinjection. Settings pages re-render in bursts,
  // and running tryInject() synchronously on each mutation can saturate the
  // renderer main thread. Collapse every mutation within a frame into one pass.
  let injectScheduled = false;
  let injectRaf = 0;
  let observedSettingsRoot = null;
  const scheduleInject = () => {
    if (injectScheduled) return;
    injectScheduled = true;
    injectRaf = requestAnimationFrame(() => {
      injectScheduled = false;
      injectRaf = 0;
      void tryInject();
    });
  };

  // Eager refresh so first paint matches state.
  api.ipc
    .invoke("get-mode")
    .then(() => {
      scheduleInject();
    })
    .catch(() => {});

  const scheduleSettingsRefresh = () => {
    refreshSettingsObserver();
    scheduleInject();
  };
  const settingsObserver = new MutationObserver(scheduleInject);
  const rootObserver = new MutationObserver(scheduleSettingsRefresh);
  rootObserver.observe(findSettingsObserverRoot(), { childList: true });
  document.addEventListener("click", scheduleSettingsRefresh, true);
  document.addEventListener("focusin", scheduleSettingsRefresh, true);
  window.addEventListener("hashchange", scheduleSettingsRefresh);
  window.addEventListener("popstate", scheduleSettingsRefresh);
  refreshSettingsObserver();

  async function tryInject() {
    if (window[MODE_SECTION_LOCK]) return;

    refreshSettingsObserver();
    const settingsRoot = observedSettingsRoot || findSettingsRoot();
    if (!settingsRoot) return;

    const anchorSection = findUpdatesSection(settingsRoot);
    if (!anchorSection) return;

    if (cleanupModeSections(anchorSection)) return;

    window[MODE_SECTION_LOCK] = true;
    try {
      const modeResult = await api.ipc.invoke("get-mode");
      const currentMode = normalizeMode(modeResult);
      if (!anchorSection.isConnected) return;
      if (cleanupModeSections(anchorSection)) return;
      const section = buildModeSection(currentMode, (next) =>
        applyModeChange(api, next),
      );
      applySupportRootFallbackStatus(section, modeResult);
      insertModeSection(anchorSection, section);
    } catch (e) {
      api.log.warn("[mode-switcher] inject failed", String(e));
    } finally {
      window[MODE_SECTION_LOCK] = false;
    }
  }

  function refreshSettingsObserver() {
    const nextRoot = findSettingsRoot();
    if (nextRoot === observedSettingsRoot) return;
    settingsObserver.disconnect();
    observedSettingsRoot = nextRoot;
    if (observedSettingsRoot) {
      settingsObserver.observe(observedSettingsRoot, { childList: true, subtree: true });
    }
  }

  const cleanup = () => {
    rootObserver.disconnect();
    settingsObserver.disconnect();
    document.removeEventListener("click", scheduleSettingsRefresh, true);
    document.removeEventListener("focusin", scheduleSettingsRefresh, true);
    window.removeEventListener("hashchange", scheduleSettingsRefresh);
    window.removeEventListener("popstate", scheduleSettingsRefresh);
    if (injectRaf) cancelAnimationFrame(injectRaf);
    injectScheduled = false;
    pageHandle?.unregister?.();
    document.querySelectorAll(MODE_SECTION_SELECTOR).forEach((node) => node.remove());
    if (rendererTeardown === cleanup) rendererTeardown = null;
  };
  rendererTeardown = cleanup;
  return cleanup;
}

async function applyModeChange(api, next) {
  const result = normalizeModeChangeResult(await api.ipc.invoke("set-mode", next));
  if (!result.changed) return result;

  if (result.relaunchScheduled) {
    // The main half relaunches Codex right after a real change (see
    // scheduleRelaunch). Keep a renderer reload as a fallback in case the
    // relaunch is a no-op, so the UI never gets stuck showing the old mode.
    setTimeout(() => {
      try {
        location.reload();
      } catch (_) {
        /* best-effort */
      }
    }, RENDERER_RELOAD_FALLBACK_MS);
    return result;
  }

  if (result.restartRequired) return result;

  setTimeout(() => {
    try {
      location.reload();
    } catch (_) {
      /* best-effort */
    }
  }, 0);
  return result;
}

function normalizeMode(modeResult) {
  const mode = typeof modeResult === "object" && modeResult
    ? modeResult.mode
    : modeResult;
  return mode === "regular" ? "regular" : "plusplus";
}

function normalizeModeChangeResult(result) {
  if (!result || typeof result !== "object") {
    return { mode: "plusplus", changed: true, restartRequired: true };
  }
  return {
    mode: result.mode === "regular" ? "regular" : "plusplus",
    changed: result.changed !== false,
    mainScopeAffected: Boolean(result.mainScopeAffected),
    relaunchScheduled: Boolean(result.relaunchScheduled),
    restartRequired: Boolean(result.restartRequired),
    reason: typeof result.reason === "string" ? result.reason : null,
    supportRootFallback: Boolean(result.supportRootFallback),
    supportRootFallbackReason:
      typeof result.supportRootFallbackReason === "string"
        ? result.supportRootFallbackReason
        : null,
  };
}

function registerModeSettingsPage(api) {
  if (typeof api.settings?.registerPage !== "function") return null;
  return api.settings.registerPage({
    id: "main",
    title: "Mode",
    description: "Switch between stock Codex and ShadGPT tweaks.",
    render(root) {
      renderModeSettingsPage(root, api);
    },
  });
}

function renderModeSettingsPage(root, api) {
  root.textContent = "";
  const loading = document.createElement("div");
  loading.className = "text-sm text-token-text-secondary";
  loading.textContent = "Loading mode...";
  root.appendChild(loading);

  api.ipc
    .invoke("get-mode")
    .then((modeResult) => {
      if (!root.isConnected) return;
      root.textContent = "";
      const section = buildModeSection(
        normalizeMode(modeResult),
        (next) =>
          applyModeChange(api, next),
      );
      applySupportRootFallbackStatus(section, modeResult);
      root.appendChild(section);
    })
    .catch((error) => {
      root.textContent = "";
      const message = document.createElement("div");
      message.className = "text-sm text-red-500";
      message.textContent = `Mode settings unavailable: ${String(error)}`;
      root.appendChild(message);
    });
}

function cleanupModeSections(anchorSection) {
  const modeSections = findModeSectionsBefore(anchorSection);
  if (modeSections.length === 0) return false;

  const keep = modeSections[modeSections.length - 1];
  keep.dataset.codexppModeSwitcher = "true";
  for (const section of modeSections) {
    if (section !== keep) section.remove();
  }
  return true;
}

function findModeSectionsBefore(anchorSection) {
  const modeSections = [];
  for (
    let node = anchorSection.previousElementSibling;
    node;
    node = node.previousElementSibling
  ) {
    if (node.matches?.(MODE_SECTION_SELECTOR) || isModeSection(node)) {
      modeSections.unshift(node);
    }
  }
  return modeSections;
}

function isModeSection(node) {
  const text = (node.textContent || "").replace(/\s+/g, " ").trim();
  return (
    text.includes("Mode") &&
    text.includes("Experience") &&
    text.includes("Switch between stock Codex and your ShadGPT tweaks.")
  );
}

function findSettingsObserverRoot() {
  return (
    document.querySelector("#root, #__next, [data-testid='app-shell']") ||
    document.documentElement
  );
}

function findSettingsRoot() {
  const nav = document.querySelector(
    'nav[aria-label="Settings"], nav[aria-label="Preferences"]',
  );
  const navRoot = nav ? closestSettingsContainer(nav) : null;
  if (navRoot) return navRoot;

  const modalRoot = document.querySelector('[role="dialog"], [aria-modal="true"]');
  if (modalRoot && findUpdatesSection(modalRoot)) return modalRoot;

  return null;
}

function closestSettingsContainer(node) {
  return (
    node.closest?.('[role="dialog"], [aria-modal="true"]') ||
    node.closest?.("main") ||
    node.closest?.("section") ||
    node.parentElement ||
    null
  );
}

function findUpdatesSection(root) {
  const sections = root.querySelectorAll("section");
  for (const sec of sections) {
    const hits = sec.querySelectorAll("div, h1, h2, h3, span");
    for (const node of hits) {
      const t = (node.textContent || "").trim();
      if (t === "ShadGPT Updates") return sec;
    }
  }
  return null;
}

function insertModeSection(anchorSection, section) {
  section.dataset.codexppModeSwitcher = "true";
  anchorSection.parentElement?.insertBefore(section, anchorSection);
}

function buildModeSection(currentMode, onChange) {
  const section = document.createElement("section");
  section.className = "flex flex-col gap-2";

  const headWrap = document.createElement("div");
  headWrap.className =
    "flex h-toolbar items-center justify-between gap-2 px-0 py-0";
  const head = document.createElement("div");
  head.className = "flex min-w-0 flex-1 flex-col gap-1";
  const heading = document.createElement("div");
  heading.className = "text-base font-medium text-token-text-primary";
  heading.textContent = "Mode";
  head.appendChild(heading);
  headWrap.appendChild(head);
  section.appendChild(headWrap);

  const card = document.createElement("div");
  card.className =
    "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border";
  card.style.backgroundColor =
    "var(--color-background-panel, var(--color-token-bg-fog))";

  const row = document.createElement("div");
  row.className = "flex items-center justify-between gap-4 p-3";

  const left = document.createElement("div");
  left.className = "flex min-w-0 flex-col gap-1";
  const rowTitle = document.createElement("div");
  rowTitle.className = "min-w-0 text-sm text-token-text-primary";
  rowTitle.textContent = "Experience";
  const rowDesc = document.createElement("div");
  rowDesc.className = "text-token-text-secondary min-w-0 text-sm";
  rowDesc.textContent =
    "Switch between stock Codex and your ShadGPT tweaks. Restarts Codex.";
  left.appendChild(rowTitle);
  left.appendChild(rowDesc);
  const status = document.createElement("div");
  status.className = "text-token-text-secondary min-w-0 text-xs";
  status.hidden = true;
  status.dataset.codexppModeSwitcherStatus = "true";
  left.appendChild(status);
  row.appendChild(left);
  row.appendChild(buildSegmentedPill(currentMode, onChange, status));
  card.appendChild(row);
  section.appendChild(card);

  return section;
}

function buildSegmentedPill(initial, onChange, status) {
  const group = document.createElement("div");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Mode");
  group.className =
    "inline-flex shrink-0 items-center rounded-full bg-token-foreground/10 p-0.5 text-sm";

  const options = [
    { value: "regular", label: "Codex" },
    { value: "plusplus", label: "ShadGPT" },
  ];
  const buttons = [];
  let current = initial;
  let busy = false;

  const apply = (value) => {
    current = value;
    for (const b of buttons) {
      const on = b.dataset.value === value;
      b.setAttribute("aria-checked", String(on));
      b.dataset.state = on ? "checked" : "unchecked";
      b.tabIndex = on ? 0 : -1;
      b.className =
        "rounded-full px-3 py-1 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border " +
        (on
          ? "bg-token-charts-blue text-white shadow-sm"
          : "text-token-text-secondary hover:text-token-text-primary");
    }
  };

  const activate = async (btn) => {
    if (busy) return;
    const next = btn.dataset.value;
    if (next === current) return;
    busy = true;
    apply(next);
    for (const b of buttons) b.disabled = true;
    try {
      setModeStatus(status, "Applying mode change...");
      const result = await onChange(next);
      renderModeChangeStatus(status, result);
    } catch (error) {
      setModeStatus(status, `Mode switch failed: ${String(error)}`);
    } finally {
      busy = false;
      for (const b of buttons) b.disabled = false;
    }
  };

  const focusAndActivate = (index) => {
    const btn = buttons[index];
    if (!btn) return;
    btn.focus();
    void activate(btn);
  };

  group.addEventListener("keydown", (e) => {
    const keys = [
      "ArrowLeft",
      "ArrowUp",
      "ArrowRight",
      "ArrowDown",
      "Home",
      "End",
      " ",
      "Spacebar",
      "Enter",
    ];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    const activeIndex = buttons.includes(document.activeElement)
      ? buttons.indexOf(document.activeElement)
      : buttons.findIndex((button) => button.dataset.value === current);
    const index = activeIndex < 0 ? 0 : activeIndex;

    if (e.key === "Home") {
      focusAndActivate(0);
    } else if (e.key === "End") {
      focusAndActivate(buttons.length - 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      focusAndActivate((index - 1 + buttons.length) % buttons.length);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      focusAndActivate((index + 1) % buttons.length);
    } else {
      focusAndActivate(index);
    }
  });

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await activate(btn);
    });
    buttons.push(btn);
    group.appendChild(btn);
  }

  apply(initial);
  return group;
}

function applySupportRootFallbackStatus(section, modeResult) {
  const normalized = normalizeModeChangeResult({
    mode: normalizeMode(modeResult),
    changed: false,
    supportRootFallback: Boolean(modeResult?.supportRootFallback),
    supportRootFallbackReason:
      typeof modeResult?.supportRootFallbackReason === "string"
        ? modeResult.supportRootFallbackReason
        : null,
  });
  if (!normalized.supportRootFallback) return;
  const status = section.querySelector?.("[data-codexpp-mode-switcher-status]");
  setModeStatus(
    status,
    normalized.supportRootFallbackReason ||
      "Using the ShadGPT support path because runtime support directory discovery is unavailable.",
  );
}

function setModeStatus(status, message) {
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
}

function renderModeChangeStatus(status, result) {
  if (!status) return;
  const normalized = normalizeModeChangeResult(result);
  if (!normalized.changed) {
    setModeStatus(status, "Mode is already current.");
  } else if (normalized.restartRequired) {
    setModeStatus(
      status,
      normalized.reason ||
        "Restart Codex to finish switching modes. Main-scope tweaks stay active until restart.",
    );
  } else if (normalized.relaunchScheduled) {
    setModeStatus(status, "Restarting Codex to finish switching modes...");
  } else {
    setModeStatus(status, "Reloading window to finish switching modes...");
  }
}
