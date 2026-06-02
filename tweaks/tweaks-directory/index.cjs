const TWEAK_ID = "co.thomashulihan.tweaks-directory";

const CHANNELS = {
  listInstalled: "list-installed",
  getStore: "get-store",
  installStoreTweak: "install-store-tweak",
  setEnabled: "set-enabled",
  reload: "reload",
  readIconAsset: "read-icon-asset",
  revealTweaksFolder: "reveal-tweaks-folder",
  openExternal: "open-external",
  prepareStoreSubmission: "prepare-store-submission",
  getUserPaths: "get-user-paths",
  getTweakFileTree: "get-tweak-file-tree",
  getPluginFileTree: "get-plugin-file-tree",
  getPluginStatuses: "get-plugin-statuses",
};

const STORE_FILTERS = [
  { key: "all", label: "All" },
  { key: "installed", label: "Installed" },
  { key: "store", label: "Store" },
  { key: "updates", label: "Updates" },
];

const DOM_SCAN_LIMIT = 650;
const DEBUG_NODE_SAMPLE_LIMIT = 8;
const DEBUG_NODE_TEXT_LIMIT = 160;
const PREF_KEYS = {
  nativePatchesSafeMode: "native-patches-safe-mode",
  nativePluginStatusBadges: "native-plugin-status-badges",
};
const DEFAULT_PREFS = {
  nativePatchesSafeMode: false,
  nativePluginStatusBadges: true,
};

/** @type {import("@codex-plusplus/sdk").Tweak} */
module.exports = {
  start(api) {
    if (api.process === "main") return startMain(api);
    return startRenderer(api);
  },
};

function startMain(api) {
  const manager = api.codex && api.codex.tweaks;
  if (!manager || typeof api.ipc.handle !== "function") {
    api.log.warn("codex.tweaks API unavailable; Tweaks Directory renderer will run read-only.");
    return undefined;
  }
  if (typeof manager.getTweakFileTree !== "function") {
    api.log.warn("Tweaks Directory Files UI is newer than the loaded ShadGPT runtime; restart Codex to enable installed tweak file trees.");
  }
  if (typeof manager.getPluginFileTree !== "function") {
    api.log.warn("Tweaks Directory native plugin Files insertion is newer than the loaded ShadGPT runtime; restart Codex to enable plugin file trees.");
  }

  const cleanups = [
    api.ipc.handle(CHANNELS.listInstalled, () => manager.listInstalled()),
    api.ipc.handle(CHANNELS.getStore, (force) => manager.getStore(Boolean(force))),
    api.ipc.handle(CHANNELS.installStoreTweak, (id) => manager.installStoreTweak(String(id || ""))),
    api.ipc.handle(CHANNELS.setEnabled, (id, enabled) => manager.setEnabled(String(id || ""), Boolean(enabled))),
    api.ipc.handle(CHANNELS.reload, () => manager.reload()),
    api.ipc.handle(CHANNELS.readIconAsset, (id, relPath) => readInstalledTweakIconAsset(manager, id, relPath)),
    api.ipc.handle(CHANNELS.revealTweaksFolder, () => manager.revealTweaksFolder()),
    api.ipc.handle(CHANNELS.openExternal, (url) => manager.openExternal(String(url || ""))),
    api.ipc.handle(CHANNELS.prepareStoreSubmission, (repo) => manager.prepareStoreSubmission(String(repo || ""))),
    api.ipc.handle(CHANNELS.getUserPaths, () => manager.getUserPaths()),
    api.ipc.handle(CHANNELS.getTweakFileTree, (id, options) => {
      if (typeof manager.getTweakFileTree !== "function") {
        return {
          status: "error",
          rootLabel: String(id || ""),
          sourceKind: "unavailable",
          message: "This ShadGPT runtime cannot resolve installed tweak files yet.",
        };
      }
      return manager.getTweakFileTree(String(id || ""), options && typeof options === "object" ? options : {});
    }),
    api.ipc.handle(CHANNELS.getPluginFileTree, (id, options) => {
      if (typeof manager.getPluginFileTree !== "function") {
        return {
          status: "error",
          rootLabel: String(id || ""),
          sourceKind: "unavailable",
          message: "This ShadGPT runtime cannot resolve plugin files yet. Restart Codex after updating ShadGPT.",
        };
      }
      return manager.getPluginFileTree(String(id || ""), options && typeof options === "object" ? options : {});
    }),
    api.ipc.handle(CHANNELS.getPluginStatuses, () => getRuntimePluginStatuses()),
  ];

  return () => cleanups.forEach((cleanup) => cleanup());
}

function readInstalledTweakIconAsset(manager, id, relPath) {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const tweakId = String(id || "");
    const rel = String(relPath || "").replace(/^\.?\//, "");
    if (!tweakId || !rel || rel.startsWith("../") || path.isAbsolute(rel)) return null;
    const installed = manager.listInstalled().find((item) => item && item.manifest && item.manifest.id === tweakId);
    if (!installed || !installed.dir) return null;
    const root = fs.realpathSync(installed.dir);
    const full = path.resolve(root, rel);
    const real = fs.realpathSync(full);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const ext = path.extname(real).toLowerCase();
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    }[ext] || "application/octet-stream";
    return `data:${mime};base64,${fs.readFileSync(real).toString("base64")}`;
  } catch {
    return null;
  }
}

function getRuntimePluginStatuses(options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const os = options.os || require("node:os");
  const home = options.home || os.homedir();
  const configPath = path.join(home, ".codex", "config.toml");
  const config = safeReadText(fs, configPath);
  const configured = parseConfiguredPlugins(config);
  const byKey = Object.create(null);
  const items = [];
  for (const entry of configured) {
    const meta = readPluginMetadataForConfigKey(entry.key, { fs, path, home });
    const item = {
      key: entry.key,
      id: meta.id || entry.id,
      slug: entry.id,
      source: entry.source,
      name: meta.name || meta.displayName || titleFromSlug(entry.id),
      displayName: meta.displayName || meta.name || titleFromSlug(entry.id),
      enabled: entry.enabled !== false,
      configured: true,
      configPath,
    };
    items.push(item);
    for (const key of pluginStatusKeys(item)) byKey[key] = item;
  }
  return { status: "ok", configPath, items, byKey };
}

function parseConfiguredPlugins(config) {
  const text = String(config || "");
  const entries = [];
  const section = /^\[plugins\."([^"]+)"\]([\s\S]*?)(?=^\[|(?![\s\S]))/gm;
  let match;
  while ((match = section.exec(text))) {
    const key = match[1];
    const body = match[2] || "";
    const enabledMatch = /^\s*enabled\s*=\s*(true|false)\s*$/im.exec(body);
    const [id, source = ""] = key.split("@");
    entries.push({
      key,
      id,
      source,
      enabled: enabledMatch ? enabledMatch[1] === "true" : true,
    });
  }
  return entries;
}

function readPluginMetadataForConfigKey(key, deps) {
  const [id, source = ""] = String(key || "").split("@");
  const roots = pluginMetadataRoots(id, source, deps);
  for (const root of roots) {
    const meta = readPluginMetadata(root, deps);
    if (meta) return meta;
  }
  return {};
}

function pluginMetadataRoots(id, source, deps) {
  const { path, home } = deps;
  const codexRoot = path.join(home, ".codex", "plugins");
  const roots = [];
  if (!id) return roots;
  if (source === "local-plugins") {
    roots.push(path.join(codexRoot, "cache", "local-plugins", id));
    roots.push(path.join(codexRoot, id));
  } else if (source === "openai-curated") {
    roots.push(path.join(codexRoot, "cache", "openai-curated", id));
  } else if (source === "openai-bundled") {
    roots.push(path.join(codexRoot, "cache", "openai-bundled", id));
  } else if (source === "openai-primary-runtime") {
    roots.push(path.join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "plugins", "openai-primary-runtime", id));
  }
  roots.push(path.join(codexRoot, id));
  return roots;
}

function readPluginMetadata(root, deps) {
  const { fs, path } = deps;
  try {
    if (!fs.existsSync(root)) return null;
    const candidates = [];
    const entries = fs.statSync(root).isDirectory() ? fs.readdirSync(root, { withFileTypes: true }) : [];
    candidates.push(root);
    for (const entry of entries) {
      if (entry.isDirectory()) candidates.push(path.join(root, entry.name));
    }
    for (const dir of candidates) {
      for (const file of [
        path.join(dir, ".codex-plugin", "plugin.json"),
        path.join(dir, "plugin.json"),
        path.join(dir, ".app.json"),
        path.join(dir, "package.json"),
      ]) {
        const json = safeReadJson(fs, file);
        if (!json) continue;
        const nested = json.plugin && typeof json.plugin === "object" ? json.plugin : json;
        return {
          id: nested.id || nested.name,
          name: nested.title || nested.displayName || nested.name,
          displayName: nested.displayName || nested.title || nested.name,
        };
      }
    }
  } catch {}
  return null;
}

function safeReadText(fs, file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function safeReadJson(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function titleFromSlug(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pluginStatusKeys(item) {
  return [
    item.key,
    item.id,
    item.slug,
    item.name,
    item.displayName,
  ].filter(Boolean).map((value) => compactText(String(value)).toLowerCase());
}

function startRenderer(api) {
  const state = {
    api,
    active: false,
    query: "",
    filter: "installed",
    installed: [],
    store: null,
    paths: null,
    loading: false,
    root: null,
    panel: null,
    tab: null,
    rescueButton: null,
    errorBanner: null,
    floatingPanel: false,
    nativeButtons: [],
    hiddenNodes: [],
    observer: null,
    mountTimers: [],
    mountListeners: [],
    status: "",
    detailRowKey: null,
    detailMenuOpen: null,
    detailBreadcrumb: null,
    tabRowDelegate: null,
    tabRowDelegateRow: null,
    nativeTabRestoreListeners: [],
    nativeTabVisualRestore: [],
    scrollRepairs: [],
    fileTrees: Object.create(null),
    nativePluginFiles: {
      key: "",
      section: null,
    },
    preferences: readPreferences(api),
    pluginStatuses: { status: "idle", items: [], byKey: Object.create(null) },
    pluginStatusToken: 0,
    observerTimer: null,
    loadToken: 0,
    settingsPageHandle: null,
  };

  injectStyles();
  registerSettingsPage(state);
  installRescueButton(state);
  scanForMount(state);
  syncNativePluginIncludesIcons(state);
  void loadPluginStatuses(state).then(() => syncNativePluginStatusBadges(state));
  state.observer = new MutationObserver((mutations) => {
    if (mutations && mutations.length > 0 && mutations.every((mutation) => isOwnedPanelMutation(state, mutation))) return;
    scheduleObserverWork(state);
  });
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
  installMountRescans(state);
  installRouteChangeListeners(state);
  syncNativePluginFilesSection(state, false);

  return () => {
    state.observer && state.observer.disconnect();
    clearObserverTimer(state);
    clearMountTimers(state);
    for (const cleanup of state.mountListeners) cleanup();
    deactivate(state);
    removeNativePluginFilesSection(state);
    removeNativePluginStatusBadges();
    removeNativePluginInheritedIcons();
    unregisterSettingsPage(state);
    removeNativeTabRestoreListeners(state);
    state.tab && state.tab.remove();
    if (state.panel) state.panel.remove();
    if (state.rescueButton) state.rescueButton.remove();
    if (state.errorBanner) state.errorBanner.remove();
    api.codex && api.codex.setSettingsTweaksFallbackHidden && api.codex.setSettingsTweaksFallbackHidden(false);
  };
}

function installRouteChangeListeners(state) {
  const win = getWindow();
  if (!win) return;
  const onNav = (event) => {
    if (!state.active) return;
    // Entries we own carry { codexpp: true } in history.state — see
    // writeDetailToLocation. Skip the auto-deactivate / re-render
    // round-trip for our own writes so we don't ping-pong with Codex's
    // routing or the settings injector.
    if (event && event.state && event.state.codexpp === true) return;
    if (shouldAutoDeactivate(state)) {
      state.api.log.info("Tweaks Directory deactivate on route change");
      deactivate(state);
      return;
    }
    syncDetailFromLocation(state, true);
    render(state);
    syncNativePluginFilesSection(state, false);
  };
  for (const eventName of ["popstate", "hashchange", "codexpp-pushState", "codexpp-replaceState"]) {
    win.addEventListener(eventName, onNav);
    state.mountListeners.push(() => win.removeEventListener(eventName, onNav));
  }
  const onSettingsSurface = (event) => {
    if (!state.active) return;
    if (!event || !event.detail || event.detail.visible !== true) return;
    state.api.log.info("Tweaks Directory deactivate: settings surface opened");
    deactivate(state);
  };
  win.addEventListener("codexpp:settings-surface", onSettingsSurface);
  state.mountListeners.push(() => win.removeEventListener("codexpp:settings-surface", onSettingsSurface));
}

function registerSettingsPage(state) {
  const api = state.api;
  if (typeof api.settings?.registerPage !== "function") {
    api.log.warn("Tweaks Directory settings page unavailable: registerPage is missing.");
    return;
  }
  state.settingsPageHandle = api.settings.registerPage({
    id: "main",
    title: "Tweaks Directory",
    description: "Control native Plugins and Skills page patches.",
    iconSvg:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M4 5.5h12M4 10h12M4 14.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M14 13l2 2 3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>",
    render(root) {
      renderTweaksDirectorySettings(root, state);
    },
  });
}

function unregisterSettingsPage(state) {
  try {
    const handle = state.settingsPageHandle;
    if (handle && typeof handle.unregister === "function") handle.unregister();
    else if (handle && typeof handle.dispose === "function") handle.dispose();
  } catch {}
  state.settingsPageHandle = null;
}

function renderTweaksDirectorySettings(root, state) {
  root.innerHTML = "";
  root.className = "codexpp-td-settings";
  const style = document.createElement("style");
  style.textContent = settingsCss();
  root.appendChild(style);
  root.appendChild(tweaksHealthPanel(state));
  const card = document.createElement("section");
  card.className = "codexpp-td-settings-card";
  const safeModeExplanation = settingsNotice("");
  card.appendChild(settingsToggle(
    state,
    "nativePatchesSafeMode",
    "Native page safe mode",
    "Use only the standalone Tweaks tab. Disables native Plugins/Skills page patches: status badges, inherited icons, file-tree insertion, and detail-row cleanup.",
    () => updateSafeModeExplanation(safeModeExplanation, state),
  ));
  updateSafeModeExplanation(safeModeExplanation, state);
  card.appendChild(safeModeExplanation);
  card.appendChild(settingsToggle(
    state,
    "nativePluginStatusBadges",
    "Plugin detail status badges",
    "Show disabled plugin status from Codex config on plugin detail pages.",
  ));
  root.appendChild(card);
}

function settingsToggle(state, pref, title, description, onChange) {
  const row = document.createElement("label");
  row.className = "codexpp-td-settings-row";
  const text = document.createElement("span");
  text.className = "codexpp-td-settings-text";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("span");
  small.textContent = description;
  text.append(strong, small);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = readPreference(state, pref);
  input.addEventListener("change", () => {
    setPreference(state, pref, input.checked);
    applyNativePatchPreferences(state);
    if (typeof onChange === "function") onChange(input.checked);
  });
  row.append(text, input);
  return row;
}

function settingsNotice(text) {
  const node = document.createElement("div");
  node.className = "codexpp-td-settings-notice";
  node.textContent = text;
  return node;
}

function updateSafeModeExplanation(node, state) {
  if (!node) return;
  if (nativePatchesSafeMode(state)) {
    node.textContent = "Safe mode is active. Native Plugins/Skills patches are disabled: detail status badges, inherited plugin icons, plugin file tree insertion, and native detail-page cleanup. The Tweaks tab, installed-tweak files, and Settings pages still work.";
    node.classList.add("is-warning");
    return;
  }
  node.textContent = "Safe mode is off. Tweaks Directory may patch native Plugins/Skills detail pages to show status badges, inherited icons, and file trees.";
  node.classList.remove("is-warning");
}

function tweaksHealthPanel(state) {
  const card = document.createElement("section");
  card.className = "codexpp-td-settings-card codexpp-td-health-card";
  const header = document.createElement("div");
  header.className = "codexpp-td-health-header";
  const text = document.createElement("span");
  text.className = "codexpp-td-settings-text";
  const title = document.createElement("strong");
  title.textContent = "Tweaks health";
  const summary = document.createElement("span");
  summary.textContent = "Checking loaded, failed, and main-only tweaks...";
  text.append(title, summary);
  const repair = document.createElement("button");
  repair.type = "button";
  repair.className = "codexpp-td-settings-button";
  repair.textContent = "Repair missing pages";
  repair.disabled = true;
  header.append(text, repair);
  const list = document.createElement("div");
  list.className = "codexpp-td-health-list";
  list.textContent = "Loading tweak health...";
  card.append(header, list);
  repair.addEventListener("click", () => repairMissingRegisteredSettingsPages(state, repair, summary));
  void loadTweaksHealth(state, summary, list, repair);
  return card;
}

async function loadTweaksHealth(state, summary, list, repair) {
  try {
    const installed = await state.api.ipc.invoke(CHANNELS.listInstalled);
    state.installed = Array.isArray(installed) ? installed : state.installed;
    const pages = registeredTweakPages(state);
    const health = buildTweaksHealth(state.installed, pages);
    renderTweaksHealth(summary, list, repair, health);
  } catch (error) {
    summary.textContent = "Tweak health could not load.";
    summary.classList.add("is-error");
    list.textContent = errorMessage(error);
    repair.disabled = false;
  }
}

function registeredTweakPages(state) {
  try {
    if (!state.api.codex || typeof state.api.codex.listRegisteredTweakPages !== "function") return [];
    const pages = state.api.codex.listRegisteredTweakPages();
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

function buildTweaksHealth(installed, pages) {
  const pageCounts = new Map();
  for (const page of pages || []) {
    const tweakId = String(page && page.tweakId || "");
    if (!tweakId) continue;
    pageCounts.set(tweakId, (pageCounts.get(tweakId) || 0) + 1);
  }
  const rows = [];
  for (const item of Array.isArray(installed) ? installed : []) {
    const manifest = item && item.manifest || {};
    const id = String(manifest.id || "");
    if (!id) continue;
    const name = String(manifest.name || id);
    const scope = String(manifest.scope || "renderer");
    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const enabled = item.enabled !== false;
    const pageCount = pageCounts.get(id) || 0;
    let status = "loaded";
    let detail = pageCount ? `${pageCount} registered settings page${pageCount === 1 ? "" : "s"}` : "Renderer/main entry loaded without a settings page.";
    let repairable = false;
    if (!enabled) {
      status = "disabled";
      detail = "Installed but disabled.";
    } else if (item.entryExists === false) {
      status = "failed";
      detail = "Entry file is missing from disk.";
    } else if (scope === "main") {
      status = "main-only";
      detail = "Runs in the main process and does not register renderer Settings UI.";
    } else if (permissions.includes("settings") && pageCount === 0) {
      status = "failed";
      detail = "Expected a Settings page, but none is registered in the renderer.";
      repairable = true;
    }
    rows.push({ id, name, scope, status, detail, repairable });
  }
  const counts = {
    loaded: rows.filter((row) => row.status === "loaded").length,
    failed: rows.filter((row) => row.status === "failed").length,
    mainOnly: rows.filter((row) => row.status === "main-only").length,
    disabled: rows.filter((row) => row.status === "disabled").length,
    repairable: rows.filter((row) => row.repairable).length,
  };
  return { counts, rows };
}

function renderTweaksHealth(summary, list, repair, health) {
  const counts = health.counts;
  summary.textContent = `${counts.loaded} loaded, ${counts.failed} failed, ${counts.mainOnly} main-only${counts.disabled ? `, ${counts.disabled} disabled` : ""}`;
  summary.classList.toggle("is-error", counts.failed > 0);
  repair.disabled = counts.repairable === 0;
  repair.title = counts.repairable
    ? "Reload installed tweaks and refresh this window so missing Settings pages can register again."
    : "No missing registered settings pages were found.";
  list.innerHTML = "";
  const groups = [
    ["failed", "Failed"],
    ["loaded", "Loaded"],
    ["main-only", "Main-only"],
    ["disabled", "Disabled"],
  ];
  for (const [status, label] of groups) {
    const rows = health.rows.filter((row) => row.status === status);
    if (!rows.length) continue;
    const group = document.createElement("div");
    group.className = "codexpp-td-health-group";
    const heading = document.createElement("strong");
    heading.textContent = label;
    group.appendChild(heading);
    for (const row of rows) group.appendChild(tweaksHealthRow(row));
    list.appendChild(group);
  }
  if (!list.children.length) list.textContent = "No installed tweaks found.";
}

function tweaksHealthRow(row) {
  const item = document.createElement("div");
  item.className = `codexpp-td-health-row is-${row.status}`;
  const name = document.createElement("span");
  name.className = "codexpp-td-health-name";
  name.textContent = row.name;
  const detail = document.createElement("span");
  detail.className = "codexpp-td-health-detail";
  detail.textContent = `${row.id} - ${row.detail}`;
  item.append(name, detail);
  return item;
}

async function repairMissingRegisteredSettingsPages(state, repair, summary) {
  repair.disabled = true;
  repair.textContent = "Repairing...";
  summary.textContent = "Reloading installed tweaks and refreshing this window...";
  try {
    await state.api.ipc.invoke(CHANNELS.reload);
    location.reload();
  } catch (error) {
    repair.textContent = "Repair missing pages";
    repair.disabled = false;
    summary.textContent = `Could not repair missing pages: ${errorMessage(error)}`;
    summary.classList.add("is-error");
  }
}

function settingsCss() {
  return `
    .codexpp-td-settings { display: flex; flex-direction: column; gap: 14px; }
    .codexpp-td-settings-card { border: 1px solid var(--border-subtle, rgba(128,128,128,.25)); border-radius: 8px; overflow: hidden; }
    .codexpp-td-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; border-bottom: 1px solid var(--border-subtle, rgba(128,128,128,.18)); }
    .codexpp-td-settings-row:last-child { border-bottom: 0; }
    .codexpp-td-settings-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .codexpp-td-settings-text strong { font-size: 13px; font-weight: 600; }
    .codexpp-td-settings-text span { color: var(--text-secondary, rgba(0,0,0,.56)); font-size: 12px; line-height: 1.35; }
    .codexpp-td-settings-row input { flex: 0 0 auto; }
    .codexpp-td-settings-notice { padding: 10px 12px; border-bottom: 1px solid var(--border-subtle, rgba(128,128,128,.18)); color: var(--text-secondary, rgba(0,0,0,.56)); font-size: 12px; line-height: 1.4; }
    .codexpp-td-settings-notice.is-warning { color: #92400e; background: rgba(146,64,14,.06); }
    .codexpp-td-health-card { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .codexpp-td-health-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .codexpp-td-settings-button { flex: 0 0 auto; min-height: 30px; border: 1px solid var(--border-subtle, rgba(128,128,128,.35)); border-radius: 6px; background: var(--background-primary, #fff); color: inherit; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
    .codexpp-td-settings-button:disabled { cursor: default; opacity: .55; }
    .codexpp-td-health-list { display: flex; flex-direction: column; gap: 10px; color: var(--text-secondary, rgba(0,0,0,.56)); font-size: 12px; }
    .codexpp-td-health-group { display: flex; flex-direction: column; gap: 5px; }
    .codexpp-td-health-group > strong { color: inherit; font-size: 12px; font-weight: 650; }
    .codexpp-td-health-row { display: grid; grid-template-columns: minmax(140px, 220px) minmax(0, 1fr); gap: 8px; align-items: start; min-height: 26px; padding: 6px 8px; border: 1px solid var(--border-subtle, rgba(128,128,128,.18)); border-radius: 6px; }
    .codexpp-td-health-row.is-failed { color: #b42318; border-color: rgba(180,35,24,.28); }
    .codexpp-td-health-row.is-main-only { color: #475569; }
    .codexpp-td-health-name { color: inherit; font-weight: 600; }
    .codexpp-td-health-detail { min-width: 0; overflow-wrap: anywhere; }
    .is-error { color: #b42318 !important; }
    @media (max-width: 720px) {
      .codexpp-td-health-header { align-items: stretch; flex-direction: column; }
      .codexpp-td-settings-button { width: 100%; }
      .codexpp-td-health-row { grid-template-columns: 1fr; }
    }
  `;
}

function readPreferences(api) {
  return {
    nativePatchesSafeMode: readStoredBoolean(api, PREF_KEYS.nativePatchesSafeMode, DEFAULT_PREFS.nativePatchesSafeMode),
    nativePluginStatusBadges: readStoredBoolean(api, PREF_KEYS.nativePluginStatusBadges, DEFAULT_PREFS.nativePluginStatusBadges),
  };
}

function readStoredBoolean(api, key, fallback) {
  try {
    if (!api.storage || typeof api.storage.get !== "function") return fallback;
    return Boolean(api.storage.get(key, fallback));
  } catch {
    return fallback;
  }
}

function readPreference(state, pref) {
  return Boolean((state.preferences || DEFAULT_PREFS)[pref]);
}

function setPreference(state, pref, value) {
  state.preferences = { ...state.preferences, [pref]: Boolean(value) };
  const key = PREF_KEYS[pref];
  try {
    if (key && state.api.storage && typeof state.api.storage.set === "function") {
      state.api.storage.set(key, Boolean(value));
    }
  } catch (error) {
    state.api.log.warn(`Tweaks Directory could not save setting ${pref}: ${errorMessage(error)}`);
  }
}

function nativePatchesSafeMode(state) {
  return readPreference(state, "nativePatchesSafeMode");
}

function applyNativePatchPreferences(state) {
  if (nativePatchesSafeMode(state)) {
    removeNativePluginFilesSection(state);
    removeNativePluginStatusBadges();
    removeNativePluginInheritedIcons();
    state.api.log.info("Tweaks Directory native page patches disabled by safe mode.");
    return;
  }
  syncNativePluginFilesSection(state, true);
  syncNativePluginIncludesIcons(state);
  void loadPluginStatuses(state).then(() => syncNativePluginStatusBadges(state));
}

function shouldAutoDeactivate(state) {
  if (!state.active) return false;
  if (!state.root || !state.root.isConnected) return true;
  if (state.tab && !state.tab.isConnected) return true;
  if (!isPluginsDirectorySurface(state.root)) return true;
  return false;
}

function scheduleObserverWork(state) {
  if (state.observerTimer) return;
  const timerHost = getTimerHost();
  const run = () => {
    state.observerTimer = null;
    mountWhenReady(state);
    syncNativePluginFilesSection(state, false);
    syncNativePluginIncludesIcons(state);
    void loadPluginStatuses(state).then(() => syncNativePluginStatusBadges(state));
    // If the directory subtree was torn down (user navigated away via
    // sidebar / hotkey / pushState), our captured `state.root` becomes
    // disconnected. Restore any nodes we hid before React recycles them
    // for the next route's scroll wrappers.
    if (state.active && shouldAutoDeactivate(state)) {
      state.api.log.info("Tweaks Directory auto-deactivate: directory subtree gone");
      deactivate(state);
    }
  };
  if (!timerHost) {
    run();
    return;
  }
  state.observerTimer = timerHost.setTimeout(run, 40);
}

function clearObserverTimer(state) {
  if (!state.observerTimer) return;
  const timerHost = getTimerHost();
  if (timerHost) timerHost.clearTimeout(state.observerTimer);
  state.observerTimer = null;
}

async function loadPluginStatuses(state, attempt = 0) {
  if (nativePatchesSafeMode(state)) return state.pluginStatuses;
  const token = state.pluginStatusToken + 1;
  state.pluginStatusToken = token;
  try {
    const result = await state.api.ipc.invoke(CHANNELS.getPluginStatuses);
    if (state.pluginStatusToken !== token) return state.pluginStatuses;
    state.pluginStatuses = normalizePluginStatuses(result);
    return state.pluginStatuses;
  } catch (error) {
    if (state.pluginStatusToken !== token) return state.pluginStatuses;
    // The main-process IPC handler registers a few ms after the renderer first
    // calls during cold start / hot reload. Treat an early "no handler" miss as
    // transient and retry briefly before surfacing an error badge, so the first
    // status load doesn't get stuck in a hard-error state until a DOM mutation
    // happens to retrigger it.
    const transient = /no handler registered/i.test(errorMessage(error));
    const timerHost = getTimerHost();
    if (transient && attempt < 5 && timerHost) {
      await new Promise((resolve) => timerHost.setTimeout(resolve, 200));
      if (state.pluginStatusToken !== token) return state.pluginStatuses;
      return loadPluginStatuses(state, attempt + 1);
    }
    state.pluginStatuses = { status: "error", items: [], byKey: Object.create(null), message: errorMessage(error) };
    state.api.log.warn(`Tweaks Directory plugin status load failed: ${errorMessage(error)}`);
    return state.pluginStatuses;
  }
}

function normalizePluginStatuses(result) {
  const items = Array.isArray(result && result.items) ? result.items : [];
  const byKey = Object.create(null);
  for (const item of items) {
    const normalized = {
      key: String(item.key || ""),
      id: String(item.id || item.slug || ""),
      slug: String(item.slug || item.id || ""),
      source: String(item.source || ""),
      name: String(item.name || item.displayName || item.id || ""),
      displayName: String(item.displayName || item.name || item.id || ""),
      enabled: item.enabled !== false,
      configured: item.configured !== false,
    };
    for (const key of pluginStatusKeys(normalized)) byKey[key] = normalized;
  }
  return { status: result && result.status || "ok", items, byKey };
}

function nativePluginStatusForDetail(state, detail) {
  const map = state.pluginStatuses && state.pluginStatuses.byKey;
  if (!map || !detail) return null;
  const candidates = [
    detail.candidate,
    detail.title,
    detail.key && String(detail.key).replace(/^native-plugin:/, ""),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const key = compactText(String(candidate)).toLowerCase();
    if (map[key]) return map[key];
  }
  return null;
}

function isOwnedPanelMutation(state, mutation) {
  if (!state.panel || !mutation) return false;
  if (nodeBelongsToPanel(state.panel, mutation.target)) return true;
  const nodes = [];
  if (mutation.addedNodes) nodes.push(...Array.from(mutation.addedNodes));
  if (mutation.removedNodes) nodes.push(...Array.from(mutation.removedNodes));
  return nodes.length > 0 && nodes.every((node) => nodeBelongsToPanel(state.panel, node));
}

function nodeBelongsToPanel(panel, node) {
  if (!panel || !node) return false;
  if (node === panel) return true;
  if (typeof panel.contains === "function" && panel.contains(node)) return true;
  return Boolean(node.contains && node.contains(panel));
}

function syncNativePluginFilesSection(state, force) {
  if (nativePatchesSafeMode(state)) {
    removeNativePluginFilesSection(state);
    logNativePluginShape(state, "files-skip-safe-mode", null);
    return;
  }
  if (state.active) {
    removeNativePluginFilesSection(state);
    return;
  }
  const detail = findNativePluginDetailSurface();
  if (!detail) {
    removeNativePluginFilesSection(state);
    return;
  }
  if (!force && state.nativePluginFiles.section && state.nativePluginFiles.section.isConnected && state.nativePluginFiles.key === detail.key) {
    return;
  }
  removeNativePluginFilesSection(state);
  const section = renderNativePluginFilesSection(state, detail);
  if (!section) return;
  detail.anchor.insertAdjacentElement("afterend", section);
  state.nativePluginFiles.key = detail.key;
  state.nativePluginFiles.section = section;
  logNativePluginShape(state, "files-mounted", detail);
}

function syncNativePluginIncludesIcons(state) {
  if (nativePatchesSafeMode(state)) {
    removeNativePluginInheritedIcons();
    return;
  }
  if (state.active) return;
  const detail = findNativePluginDetailSurface();
  if (!detail) return;
  const pluginIcon = findNativePluginHeroImage(detail.container);
  if (!pluginIcon) return;
  for (const row of nativePluginSkillIncludeRows(detail.container)) {
    if (row.querySelector("img")) continue;
    const iconSlot = nativeIncludeIconSlot(row);
    if (!iconSlot) continue;
    if (iconSlot.dataset && iconSlot.dataset.codexppPluginInheritedIconSlotText === undefined) {
      iconSlot.dataset.codexppPluginInheritedIconSlotText = iconSlot.textContent || "";
    }
    iconSlot.textContent = "";
    const inheritedIcon = pluginIcon.cloneNode(true);
    inheritedIcon.dataset.codexppPluginInheritedIcon = "true";
    inheritedIcon.setAttribute("alt", "");
    iconSlot.appendChild(inheritedIcon);
    row.dataset.codexppPluginInheritedIcon = "true";
    row.dataset.codexppPluginInheritedIconRow = "true";
  }
}

function syncNativePluginStatusBadges(state) {
  if (nativePatchesSafeMode(state) || !readPreference(state, "nativePluginStatusBadges")) {
    removeNativePluginStatusBadges();
    return;
  }
  if (state.active) {
    removeNativePluginStatusBadges();
    return;
  }
  const detail = findNativePluginDetailSurface();
  if (!detail) {
    removeNativePluginStatusBadges();
    return;
  }
  const status = nativePluginStatusForDetail(state, detail);
  if (!status || status.enabled !== false) {
    removeNativePluginStatusBadges();
    return;
  }
  const anchor = detail.anchor || detail.container;
  if (!anchor || typeof anchor.insertAdjacentElement !== "function") return;
  let badge = document.querySelector("[data-codexpp-native-plugin-status-badge]");
  if (!badge) {
    badge = document.createElement("span");
    badge.dataset.codexppNativePluginStatusBadge = "true";
    badge.className = "codexpp-native-plugin-status-badge";
    badge.textContent = "Disabled";
    badge.title = "Plugin disabled in Codex config";
    anchor.insertAdjacentElement("afterend", badge);
  }
  badge.dataset.codexppNativePluginStatusKey = status.key || "";
  logNativePluginShape(state, "status-badge-mounted", detail, { statusKey: status.key });
}

function removeNativePluginStatusBadges() {
  for (const badge of Array.from(document.querySelectorAll("[data-codexpp-native-plugin-status-badge]"))) {
    badge.remove();
  }
}

function removeNativePluginInheritedIcons() {
  for (const img of Array.from(document.querySelectorAll("[data-codexpp-plugin-inherited-icon]"))) {
    const slot = img.parentElement;
    img.remove();
    if (slot && slot.dataset && slot.dataset.codexppPluginInheritedIconSlotText !== undefined) {
      slot.textContent = slot.dataset.codexppPluginInheritedIconSlotText;
      delete slot.dataset.codexppPluginInheritedIconSlotText;
    }
  }
  for (const row of Array.from(document.querySelectorAll("[data-codexpp-plugin-inherited-icon-row]"))) {
    delete row.dataset.codexppPluginInheritedIconRow;
    delete row.dataset.codexppPluginInheritedIcon;
  }
}

function findNativePluginHeroImage(container) {
  const title = nativePluginDetailTitle(container);
  const images = Array.from(container.querySelectorAll("img"));
  if (images.length === 0) return null;
  if (!title || typeof title.compareDocumentPosition !== "function") return images[0];
  const beforeTitle = images.filter((image) => {
    try {
      return Boolean(image.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING);
    } catch {
      return false;
    }
  });
  return beforeTitle[0] || images[0];
}

function nativePluginSkillIncludeRows(container) {
  return Array.from(container.querySelectorAll("div")).filter((node) => {
    const text = compactText(node.textContent || "");
    if (!/\bSkill\b/.test(text) || /\bMCP server\b/.test(text)) return false;
    return Boolean(nativeIncludeIconSlot(node));
  });
}

function nativeIncludeIconSlot(row) {
  const firstChild = row && row.children && row.children[0];
  if (!firstChild || typeof firstChild.querySelector !== "function") return null;
  if (firstChild.querySelector("img")) return null;
  return firstChild.querySelector("svg") ? firstChild : null;
}

function removeNativePluginFilesSection(state) {
  if (state.nativePluginFiles && state.nativePluginFiles.section) {
    state.nativePluginFiles.section.remove();
  }
  if (state.nativePluginFiles) {
    state.nativePluginFiles.key = "";
    state.nativePluginFiles.section = null;
  }
}

function findNativePluginDetailSurface() {
  const tryInChat = Array.from(document.querySelectorAll("button")).find((button) => compactText(button.textContent) === "Try in chat");
  if (!tryInChat || !isVisibleTabCandidate(tryInChat)) return null;
  let container = tryInChat.parentElement;
  let selected = null;
  while (container && container !== document.body) {
    const title = nativePluginDetailTitle(container);
    if (title) {
      selected = { container, title };
      break;
    }
    container = container.parentElement;
  }
  if (!selected) return null;
  const candidate = compactText(selected.title.textContent || "");
  if (!candidate || candidate === "Make Codex work your way" || candidate === "Plugins" || candidate === "Skills") return null;
  const anchor = nativePluginFilesAnchor(selected.container, tryInChat);
  if (!anchor || typeof anchor.insertAdjacentElement !== "function") return null;
  return {
    container: selected.container,
    anchor,
    candidate,
    title: candidate,
    key: `native-plugin:${candidate}`,
  };
}

function nativePluginDetailTitle(container) {
  if (!container || typeof container.querySelectorAll !== "function") return null;
  const titles = Array.from(container.querySelectorAll("h1,h2,h3"));
  return titles.find((title) => {
    const text = compactText(title.textContent || "");
    return text && text !== "Make Codex work your way" && text !== "Plugins" && text !== "Skills";
  }) || null;
}

function nativePluginFilesAnchor(container, tryInChat) {
  let node = tryInChat.parentElement;
  while (node && node.parentElement && node.parentElement !== container && node !== container) {
    node = node.parentElement;
  }
  if (node && node !== container) return node;
  const title = nativePluginDetailTitle(container);
  return title || tryInChat;
}

function installMountRescans(state) {
  const win = getWindow();
  if (!win) return;
  const rescan = () => scanForMount(state);
  for (const eventName of ["focus", "pointerdown", "keydown"]) {
    win.addEventListener(eventName, rescan, true);
    state.mountListeners.push(() => win.removeEventListener(eventName, rescan, true));
  }
}

function scanForMount(state) {
  clearMountTimers(state);
  // Fast path: once the Tweaks tab is mounted and still connected, we have
  // nothing to re-scan for. Every pointerdown / keydown was triggering 6
  // DOM scans (one immediate + a 5-stage timer fan-out) for no benefit.
  if (state.tab && state.tab.isConnected) return;
  mountWhenReady(state);
  if (state.tab && state.tab.isConnected) return;
  const timerHost = getTimerHost();
  if (!timerHost) return;
  for (const delay of [80, 200, 500, 1000, 1800]) {
    state.mountTimers.push(timerHost.setTimeout(() => {
      mountWhenReady(state);
    }, delay));
  }
}

function clearMountTimers(state) {
  const timerHost = getTimerHost();
  for (const timer of state.mountTimers) {
    if (timerHost) timerHost.clearTimeout(timer);
  }
  state.mountTimers = [];
}

function getWindow() {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined" && globalThis.window) return globalThis.window;
  return null;
}

function getTimerHost() {
  const win = getWindow();
  if (win && typeof win.setTimeout === "function" && typeof win.clearTimeout === "function") return win;
  if (typeof globalThis !== "undefined" && typeof globalThis.setTimeout === "function" && typeof globalThis.clearTimeout === "function") {
    return globalThis;
  }
  return null;
}

function mountWhenReady(state) {
  if (state.tab && !state.tab.isConnected) {
    deactivate(state);
    state.tab = null;
    removeNativeTabRestoreListeners(state);
    state.nativeButtons = [];
    if (state.panel && !state.panel.isConnected) state.panel = null;
  }
  if (state.tab && state.tab.isConnected) return;
  const pair = findPluginsSkillsTabs();
  if (!pair) return;

  const tab = createTweaksTab(pair.skills);
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      activate(state, pair, tab);
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      state.api.log.error("Tweaks Directory activation failed", message);
      deactivate(state);
      showRescueButton(state);
      showErrorBanner(state, "Tweaks Directory could not open", errorMessage(error));
    }
  });

  pair.skills.insertAdjacentElement("afterend", tab);
  state.tab = tab;
  state.nativeButtons = [pair.plugins, pair.skills];
  installNativeTabRestoreListeners(state, state.nativeButtons);
  applyTweaksTabShell(tab);
  state.api.codex && state.api.codex.setSettingsTweaksFallbackHidden && state.api.codex.setSettingsTweaksFallbackHidden(false);
  state.api.log.info("Tweaks tab inserted in Plugins directory");
}

function createTweaksTab(sourceTab) {
  const tab = document.createElement("button");
  tab.type = "button";
  if (typeof sourceTab.className === "string") tab.className = sourceTab.className;
  tab.dataset.codexppTweaksDirectoryTab = "true";
  tab.textContent = "Tweaks";
  tab.setAttribute("aria-label", "Tweaks");
  return tab;
}

function applyTweaksTabShell(tab) {
  if (!tab) return;
  tab.dataset.codexppTweaksDirectoryTabTrigger = "true";
  tab.dataset.slot = "tabs-trigger";
  if (!tab.getAttribute("aria-label")) tab.setAttribute("aria-label", "Tweaks");
}

function findPluginsSkillsTabs() {
  const pair = findPluginsSkillsTabPair();
  if (!pair) return null;
  if (pair.tabRow.querySelector("[data-codexpp-tweaks-directory-tab]")) return null;
  return pair;
}

function findPluginsSkillsTabPair() {
  const buttons = tabCandidates();
  const plugins = buttons.find((button) => compactText(button.textContent) === "Plugins");
  const skills = buttons.find((button) => compactText(button.textContent) === "Skills");
  if (!plugins || !skills) return null;
  const parent = commonTabParent(plugins, skills);
  if (!parent) return null;
  const root = findDirectoryRoot(parent);
  if (!isPluginsDirectorySurface(root)) return null;
  return { plugins, skills, tabRow: parent, root };
}

function tabCandidates() {
  const selector = [
    "button",
    "a",
    "[role='tab']",
    "[role='button']",
    "[tabindex]",
    "button span",
    "a span",
    "[role='tab'] span",
    "[role='button'] span",
    "[tabindex] span",
  ].join(",");
  const seen = new Set();
  const candidates = [];
  for (const node of Array.from(document.querySelectorAll(selector))) {
    const text = compactText(node.textContent);
    if (text !== "Plugins" && text !== "Skills") continue;
    const target = normalizeTabCandidate(node, text);
    if (!isVisibleTabCandidate(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    candidates.push(target);
  }
  return candidates;
}

function normalizeTabCandidate(node, text) {
  let target = closestInteractive(node) || node;
  while (
    target.parentElement &&
    target.parentElement !== document.body &&
    compactText(target.parentElement.textContent) === text
  ) {
    target = target.parentElement;
  }
  return target;
}

function closestInteractive(node) {
  if (typeof node.closest !== "function") return null;
  return node.closest("button,a,[role='tab'],[role='button'],[tabindex]");
}

function isVisibleTabCandidate(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return true;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (node.hidden || node.style && (node.style.display === "none" || node.style.visibility === "hidden")) return false;
  const win = getWindow();
  if (!win) return true;
  const viewportW = win.innerWidth || 0;
  const viewportH = win.innerHeight || 0;
  if (viewportW <= 0 || viewportH <= 0) return true;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportH || rect.left > viewportW) return false;
  if (!node.ownerDocument || !node.ownerDocument.defaultView || typeof node.ownerDocument.defaultView.getComputedStyle !== "function") return true;
  try {
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  } catch {}
  return true;
}

function commonTabParent(left, right) {
  if (left.parentElement && left.parentElement === right.parentElement) return left.parentElement;
  const leftAncestors = [];
  let node = left.parentElement;
  while (node && node !== document.body) {
    leftAncestors.push(node);
    node = node.parentElement;
  }
  node = right.parentElement;
  while (node && node !== document.body) {
    if (leftAncestors.includes(node) && compactText(node.textContent).includes("Plugins") && compactText(node.textContent).includes("Skills")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function activate(state, pair, tab) {
  state.active = true;
  removeNativePluginFilesSection(state);
  state.tab = tab;
  const livePair = resolveLivePair(pair, tab);
  state.nativeButtons = [livePair.plugins, livePair.skills];
  state.root = livePair.root || findDirectoryRoot(livePair.tabRow);
  ensurePanel(state, livePair.tabRow);
  if (state.floatingPanel) {
    hideFloatingNativePluginSiblings(state, livePair.tabRow);
    state.api.log.warn("Tweaks Directory using floating fallback because the native Plugins root is unsafe", {
      root: describeForLog(state.root),
      tabRowParent: describeForLog(livePair && livePair.tabRow && livePair.tabRow.parentElement),
    });
  } else {
    hideNativeDirectoryContent(state, livePair.tabRow);
    hideNativeDirectorySiblingsAroundPanel(state, livePair.tabRow);
  }
  applyDirectoryScrollRepair(state, livePair.tabRow);
  logHiddenNodes(state);
  logActivationContext(state, livePair);
  setTabVisualState(state, true);
  render(state);
  scrollPanelIntoView(state);
  void loadData(state, false);
}

function resolveLivePair(pair, tab) {
  const tabRow = tab && tab.parentElement ? tab.parentElement : pair.tabRow;
  const plugins = findTabInRow(tabRow, "Plugins") || pair.plugins;
  const skills = findTabInRow(tabRow, "Skills") || pair.skills;
  const root = findDirectoryRoot(tabRow);
  return { plugins, skills, tabRow, root };
}

function findTabInRow(tabRow, label) {
  if (!tabRow || typeof tabRow.querySelectorAll !== "function") return null;
  for (const node of Array.from(tabRow.querySelectorAll("button,a,[role='tab'],[role='button'],[tabindex]"))) {
    if (node.dataset && node.dataset.codexppTweaksDirectoryTab === "true") continue;
    if (compactText(node.textContent || "") === label) return node;
  }
  return null;
}

function scrollPanelIntoView(state) {
  if (!state.panel || typeof state.panel.scrollIntoView !== "function") return;
  try {
    state.panel.scrollIntoView({ block: "start", inline: "nearest" });
  } catch {
    try {
      state.panel.scrollIntoView();
    } catch {}
  }
}

function logActivationContext(state, pair) {
  try {
    const win = getWindow();
    const viewport = win
      ? { w: win.innerWidth || 0, h: win.innerHeight || 0 }
      : { w: 0, h: 0 };
    state.api.log.info(
      `Tweaks Directory activation context: ${JSON.stringify({
        viewport,
        root: describeForLog(state.root),
        panelParent: describeForLog(state.panel && state.panel.parentElement),
        tabRowParent: describeForLog(pair && pair.tabRow && pair.tabRow.parentElement),
        bodyOverflow: readStyleHints(document.body),
        htmlOverflow: readStyleHints(document.documentElement),
      })}`,
    );
  } catch (error) {
    state.api.log.warn(
      `Tweaks Directory activation log failed: ${error && error.message ? error.message : String(error)}`,
    );
  }
}

function logNativePluginShape(state, reason, detail, extra) {
  try {
    const pair = findPluginsSkillsTabPair();
    const payload = {
      reason,
      safeMode: nativePatchesSafeMode(state),
      statusBadges: readPreference(state, "nativePluginStatusBadges"),
      root: describeForLog(pair && pair.root),
      tabRow: describeForLog(pair && pair.tabRow),
      detail: detail ? {
        candidate: detail.candidate,
        container: describeForLog(detail.container),
        anchor: describeForLog(detail.anchor),
      } : null,
      pluginStatusCount: state.pluginStatuses && Array.isArray(state.pluginStatuses.items) ? state.pluginStatuses.items.length : 0,
      ...(extra || {}),
    };
    state.api.log.info(`Tweaks Directory native plugin shape: ${JSON.stringify(payload)}`);
  } catch (error) {
    state.api.log.warn(`Tweaks Directory native plugin shape log failed: ${errorMessage(error)}`);
  }
}

function describeForLog(node) {
  if (!node) return null;
  let tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "node";
  if (tag === "#document") tag = "document";
  const cls =
    typeof node.className === "string"
      ? node.className.trim().split(/\s+/).slice(0, 3).join(".")
      : "";
  let rect = null;
  if (typeof node.getBoundingClientRect === "function") {
    const r = node.getBoundingClientRect();
    rect = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
  }
  return { tag, cls: cls || undefined, rect };
}

function readStyleHints(node) {
  if (!node || !node.ownerDocument || typeof node.ownerDocument.defaultView !== "object") return null;
  const view = node.ownerDocument.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return null;
  try {
    const cs = view.getComputedStyle(node);
    return { overflow: cs.overflow, overflowX: cs.overflowX, overflowY: cs.overflowY, position: cs.position };
  } catch {
    return null;
  }
}

function deactivate(state) {
  state.active = false;
  state.loadToken += 1;
  state.loading = false;
  clearObserverTimer(state);
  restoreDirectoryScrollRepair(state);
  // Restore each hidden node only if it is still connected. When React
  // recycles a node we previously hid into a *different* part of the tree
  // (e.g. a chat scroll wrapper after the user navigates away), leaving
  // `display:none` on it freezes that surface's scroll. Verifying it is
  // still in our captured root prevents collateral damage either way.
  for (const node of state.hiddenNodes) {
    if (!node || !node.dataset) continue;
    const prevDisplay = node.dataset.codexppTweaksDirectoryDisplay || "";
    delete node.dataset.codexppTweaksDirectoryHidden;
    delete node.dataset.codexppTweaksDirectoryDisplay;
    if (!node.isConnected) continue;
    if (state.root && state.root.isConnected && !state.root.contains(node)) {
      // Node was recycled out of our root by React; clear our display:none
      // anyway so we don't freeze whatever surface now owns it.
      if (node.style && node.style.display === "none") {
        node.style.display = prevDisplay;
      }
      continue;
    }
    if (node.style) node.style.display = prevDisplay;
  }
  state.hiddenNodes = [];
  if (state.panel) state.panel.hidden = true;
  restoreNativeTabRow(state);
  removeTabRowDelegate(state);
  setTabVisualState(state, false);
  hideRescueButton(state);
  exposeDebugState(state);
}

function applyDirectoryScrollRepair(state, tabRow) {
  restoreDirectoryScrollRepair(state);
  if (!state.panel || state.floatingPanel) return;
  for (const node of directoryScrollRepairTargets(state, tabRow)) {
    if (!node || !node.style) continue;
    state.scrollRepairs.push({
      node,
      overflowX: node.style.overflowX || "",
      overflowY: node.style.overflowY || "",
      minHeight: node.style.minHeight || "",
      maxHeight: node.style.maxHeight || "",
      overscrollBehavior: node.style.overscrollBehavior || "",
    });
    if (node.dataset) node.dataset.codexppTweaksDirectoryScrollRepair = "true";
    node.style.overflowY = "auto";
    if (!node.style.overflowX || node.style.overflowX === "visible") node.style.overflowX = "hidden";
    node.style.minHeight = "0";
    node.style.overscrollBehavior = "contain";
    const maxHeight = directoryScrollRepairMaxHeight(node);
    if (maxHeight) node.style.maxHeight = maxHeight;
  }
}

function restoreDirectoryScrollRepair(state) {
  for (const repair of state.scrollRepairs || []) {
    const node = repair && repair.node;
    if (!node || !node.style) continue;
    node.style.overflowX = repair.overflowX;
    node.style.overflowY = repair.overflowY;
    node.style.minHeight = repair.minHeight;
    node.style.maxHeight = repair.maxHeight;
    node.style.overscrollBehavior = repair.overscrollBehavior;
    if (node.dataset) delete node.dataset.codexppTweaksDirectoryScrollRepair;
  }
  state.scrollRepairs = [];
}

function directoryScrollRepairTargets(state, tabRow) {
  const targets = [];
  const seen = new Set();
  let node = state.panel && state.panel.parentElement;
  while (node && node !== document.body && node !== document.documentElement && targets.length < 4) {
    if (!seen.has(node) && isDirectoryScrollRepairTarget(state, tabRow, node)) {
      targets.push(node);
      seen.add(node);
    }
    node = node.parentElement;
  }
  return targets;
}

function isDirectoryScrollRepairTarget(state, tabRow, node) {
  if (!node || node === state.panel || !state.panel) return false;
  if (looksLikeAppSidebar(node) || hasShellNavigationSibling(node, tabRow)) return false;
  if (typeof node.contains === "function" && !node.contains(state.panel)) return false;
  if (!hasUsefulDirectoryContentBox(node)) return false;
  if (node === state.panel.parentElement) return true;
  if (isDirectoryContentColumnForTab(node, tabRow)) return true;
  if (isAppContentColumn(node)) return true;
  if (!isSafeDirectoryRoot(node) && !isViewportSized(node)) return false;
  return hasDirectoryLayoutBox(node);
}

function directoryScrollRepairMaxHeight(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return "";
  const win = getWindow();
  const viewportH = win && win.innerHeight ? win.innerHeight : 0;
  if (viewportH <= 0) return "";
  const rect = node.getBoundingClientRect();
  if (rect.top < 0 || rect.top >= viewportH) return "";
  const top = Math.max(0, Math.round(rect.top));
  return `calc(100vh - ${top}px)`;
}

function installTabRowDelegate(state) {
  if (!state.tab) return;
  const row = state.tab.parentElement;
  if (!row) return;
  if (state.tabRowDelegate && state.tabRowDelegateRow === row) return;
  removeTabRowDelegate(state);
  const handler = (event) => {
    if (!state.active) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const interactive = target.closest("button,a,[role='tab'],[role='button'],[tabindex]");
    if (!interactive) return;
    if (interactive === state.tab) return;
    if (interactive.dataset && interactive.dataset.codexppTweaksDirectoryTab === "true") return;
    const label = compactText(interactive.textContent || "");
    if (label !== "Plugins" && label !== "Skills") return;
    deactivate(state);
  };
  row.addEventListener("click", handler, true);
  state.tabRowDelegate = handler;
  state.tabRowDelegateRow = row;
}

function removeTabRowDelegate(state) {
  if (state.tabRowDelegate && state.tabRowDelegateRow) {
    try {
      state.tabRowDelegateRow.removeEventListener("click", state.tabRowDelegate, true);
    } catch {}
  }
  state.tabRowDelegate = null;
  state.tabRowDelegateRow = null;
}

function installNativeTabRestoreListeners(state, buttons) {
  removeNativeTabRestoreListeners(state);
  for (const button of buttons) {
    if (!button || typeof button.addEventListener !== "function") continue;
    const handler = () => {
      if (state.active) deactivate(state);
    };
    button.addEventListener("click", handler, true);
    state.nativeTabRestoreListeners.push({ button, handler });
  }
}

function removeNativeTabRestoreListeners(state) {
  for (const entry of state.nativeTabRestoreListeners || []) {
    try {
      entry.button.removeEventListener("click", entry.handler, true);
    } catch {}
  }
  state.nativeTabRestoreListeners = [];
}

function findDirectoryRoot(tabRow) {
  let node = tabRow.parentElement;
  let firstSurface = null;
  while (node && node !== document.body) {
    if (isPluginsDirectorySurface(node) && !hasShellNavigationSibling(node, tabRow)) {
      if (!firstSurface) firstSurface = node;
      if (
        !isViewportSized(node) &&
        !isAppContentColumn(node) &&
        !isCompactDirectoryHeader(node, tabRow)
      ) {
        return node;
      }
    }
    node = node.parentElement;
  }
  const contentRoot = findDirectoryContentRoot(tabRow, firstSurface);
  if (contentRoot) return contentRoot;
  const layoutRoot = findDirectoryLayoutRoot(tabRow);
  if (layoutRoot) return layoutRoot;
  // Fallback: prefer the tab row's parent over document.body. If that parent
  // is itself viewport-sized (i.e., we're really stuck), still return it but
  // the activation log will surface the bad rect for diagnosis.
  return tabRow.parentElement || document.body;
}

function findDirectoryLayoutRoot(tabRow) {
  let node = tabRow && tabRow.parentElement;
  while (node && node !== document.body) {
    if (
      node.contains &&
      node.contains(tabRow) &&
      !isCompactDirectoryHeader(node, tabRow) &&
      !looksLikeAppSidebar(node) &&
      !hasShellNavigationSibling(node, tabRow) &&
      hasDirectoryTabRow(node, tabRow) &&
      hasDirectoryLayoutBox(node)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function hasDirectoryTabRow(root, tabRow) {
  if (!root || !tabRow || !root.contains || !root.contains(tabRow)) return false;
  const text = compactText(tabRow.textContent || "");
  return text.includes("Plugins") && text.includes("Skills");
}

function hasDirectoryLayoutBox(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return false;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const win = getWindow();
  const viewportW = win && win.innerWidth ? win.innerWidth : 0;
  const viewportH = win && win.innerHeight ? win.innerHeight : 0;
  const minWidth = viewportW > 0 ? Math.min(720, viewportW * 0.42) : 640;
  const minHeight = viewportH > 0 ? Math.min(520, viewportH * 0.42) : 420;
  return rect.width >= minWidth && rect.height >= minHeight;
}

function findDirectoryContentRoot(tabRow, surfaceRoot) {
  const scope = surfaceRoot && typeof surfaceRoot.querySelectorAll === "function" ? surfaceRoot : document;
  const candidates = [];
  const selector = "main,section,article,div";
  for (const node of Array.from(scope.querySelectorAll(selector))) {
    if (!node || node === surfaceRoot) continue;
    if (node === tabRow || (node.contains && node.contains(tabRow))) continue;
    if (!isPluginsDirectorySurface(node)) continue;
    if (looksLikeAppSidebar(node)) continue;
    if (isViewportSized(node) || isAppContentColumn(node) || isCompactDirectoryHeader(node, tabRow)) continue;
    if (!hasUsefulDirectoryContentBox(node)) continue;
    const score = directoryContentRootScore(node);
    if (score <= 0) continue;
    const rect = typeof node.getBoundingClientRect === "function"
      ? node.getBoundingClientRect()
      : { width: 0, height: 0 };
    candidates.push({
      node,
      score,
      area: Math.max(1, Math.max(0, rect.width) * Math.max(0, rect.height)),
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.area - b.area);
  return candidates.length > 0 ? candidates[0].node : null;
}

function hasUsefulDirectoryContentBox(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return true;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const win = getWindow();
  if (!win) return true;
  const viewportW = win.innerWidth || 0;
  const viewportH = win.innerHeight || 0;
  if (viewportW > 0 && viewportH > 0) {
    if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportH || rect.left > viewportW) {
      return false;
    }
  }
  return rect.width >= 120 && rect.height >= 30;
}

function directoryContentRootScore(node) {
  const text = compactText(node.textContent || "");
  const hasSearch = hasNativeDirectorySearch(node);
  const hasListing = hasNativeDirectoryListingSignal(text);
  const hasTitle = text.includes("Make Codex work your way");
  if (!hasListing) return 0;
  let score = 0;
  if (hasListing) score += 8;
  if (hasSearch) score += 4;
  if (hasTitle) score += 1;
  return score;
}

function hasNativeDirectoryListingSignal(text) {
  if (!text) return false;
  if (text.includes("Recommended") || text.includes("Featured")) return true;
  if (text.includes("PDF") || text.includes("Playwright") || text.includes("Computer Use")) return true;
  if (text.includes("Plan Grader") || text.includes("Use when")) return true;
  if (text.includes("Try in chat")) return true;
  return false;
}

function hasNativeDirectorySearch(root) {
  if (!root || typeof root.querySelectorAll !== "function") return false;
  return Array.from(root.querySelectorAll("input,[placeholder]")).some((node) => {
    const placeholder = typeof node.getAttribute === "function"
      ? compactText(node.getAttribute("placeholder") || "")
      : "";
    return placeholder === "Search plugins" || placeholder === "Search skills";
  });
}

/**
 * True when `node`'s bounding rect covers ≥85% of the viewport area. Such an
 * ancestor is overwhelmingly likely to be Codex's main app shell, not the
 * Plugins page wrapper. Returning it as state.root makes `hideNativeDirectoryContent`
 * walk over the chat / sidebar / directories scroll wrappers, breaking
 * global scroll. The text-based `isPluginsDirectorySurface` heuristic alone
 * can't distinguish the page wrapper from the app shell because both contain
 * the plugins-page text — the size check is the cheap second axis.
 */
function isViewportSized(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return false;
  const win = getWindow();
  const viewportW = win && win.innerWidth ? win.innerWidth : 0;
  const viewportH = win && win.innerHeight ? win.innerHeight : 0;
  if (viewportW <= 0 || viewportH <= 0) return false;
  const rect = node.getBoundingClientRect();
  const viewportArea = viewportW * viewportH;
  const nodeArea = Math.max(0, rect.width) * Math.max(0, rect.height);
  return nodeArea > viewportArea * 0.85;
}

function isAppContentColumn(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return false;
  const win = getWindow();
  const viewportW = win && win.innerWidth ? win.innerWidth : 0;
  const viewportH = win && win.innerHeight ? win.innerHeight : 0;
  if (viewportW <= 0 || viewportH <= 0) return false;
  const rect = node.getBoundingClientRect();
  if (rect.height < viewportH * 0.85) return false;
  // Anchor by both top and bottom proximity so Codex's tall custom titlebar
  // (~47px) still counts as the "app content column". The old `top > 24`
  // check missed this and let the directory broad-hide nuke unrelated
  // surfaces (Settings dialog, chat content) on the same column.
  if (rect.top < 0 || rect.top > viewportH * 0.12) return false;
  if (rect.bottom < viewportH * 0.92) return false;
  return rect.width >= viewportW * 0.42;
}

function isPluginsDirectorySurface(root) {
  if (!root) return false;
  const text = compactText(root.textContent || "");
  if (text.includes("Make Codex work your way")) return true;
  if (text.includes("Featured") && text.includes("Computer Use")) return true;
  return hasNativeDirectorySearch(root);
}

function hasShellNavigationSibling(root, tabRow) {
  let current = tabRow;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current) continue;
      if (looksLikeAppSidebar(sibling)) return true;
    }
    current = parent;
  }
  return false;
}

function looksLikeAppSidebar(node) {
  const text = compactText(node && node.textContent || "");
  return text.includes("New chat") && text.includes("Projects") && text.includes("Settings");
}

function ensurePanel(state, tabRow) {
  const useFloating = isUnsafeDirectoryRoot(state.root, tabRow);
  if (state.panel && state.panel.isConnected) {
    state.panel.hidden = false;
    if (useFloating) {
      state.panel.className = "codexpp-tweaks-directory codexpp-tweaks-directory-floating";
      if (state.panel.parentElement !== document.body) document.body.appendChild(state.panel);
      state.floatingPanel = true;
      return;
    }
    state.panel.className = "codexpp-tweaks-directory";
    const anchor = findPanelAnchor(state.root, tabRow);
    if (anchor && typeof anchor.insertAdjacentElement === "function") {
      anchor.insertAdjacentElement("afterend", state.panel);
    } else if (state.root && typeof state.root.appendChild === "function") {
      state.root.appendChild(state.panel);
    } else {
      document.body.appendChild(state.panel);
    }
    state.floatingPanel = false;
    return;
  }
  const panel = document.createElement("section");
  panel.dataset.codexppTweaksDirectoryPanel = "true";
  panel.dataset.slot = "page";
  if (useFloating) {
    panel.className = "codexpp-tweaks-directory codexpp-tweaks-directory-floating";
    document.body.appendChild(panel);
    state.floatingPanel = true;
  } else {
    panel.className = "codexpp-tweaks-directory";
    const anchor = findPanelAnchor(state.root, tabRow);
    if (anchor && typeof anchor.insertAdjacentElement === "function") {
      anchor.insertAdjacentElement("afterend", panel);
    } else if (state.root && typeof state.root.appendChild === "function") {
      state.root.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
    state.floatingPanel = false;
  }
  state.panel = panel;
}

function findPanelAnchor(root, tabRow) {
  const replacementAnchor = nativeDetailReplacementAnchor(root, tabRow);
  if (replacementAnchor) return replacementAnchor;
  const rootAnchor = rootPanelAnchor(root, tabRow);
  if (rootAnchor) return rootAnchor;
  return null;
}

function rootPanelAnchor(root, tabRow) {
  if (!root || !tabRow || typeof root.contains !== "function" || !root.contains(tabRow)) return null;
  let anchor = tabRow;
  while (anchor.parentElement && anchor.parentElement !== root) {
    anchor = anchor.parentElement;
  }
  return anchor.parentElement === root ? anchor : tabRow;
}

function nativeDetailReplacementAnchor(root, tabRow) {
  if (!isNativeDetailSurface(root) || !tabRow) return null;
  const parent = root.parentElement;
  if (!parent || typeof parent.contains !== "function" || !parent.contains(tabRow)) return null;
  let anchor = tabRow;
  while (anchor.parentElement && anchor.parentElement !== parent) {
    anchor = anchor.parentElement;
  }
  return anchor.parentElement === parent ? anchor : null;
}

function isNativeDetailSurface(node) {
  if (!node) return false;
  const text = compactText(node.textContent || "");
  if (!text.includes("Try in chat")) return false;
  if (hasNativeDirectorySearch(node)) return false;
  if (text.includes("Featured") || text.includes("Recommended")) return false;
  if (looksLikeAppSidebar(node)) return false;
  return true;
}

function isUnsafeDirectoryRoot(root, tabRow) {
  if (!root || root === document.body || root === document.documentElement) return true;
  if (isCompactDirectoryHeader(root, tabRow)) return true;
  if (isDirectoryContentColumnForTab(root, tabRow)) return false;
  if (isAppContentColumn(root)) return true;
  if (!isViewportSized(root)) return false;
  const parent = tabRow && tabRow.parentElement;
  if (root === parent) return true;
  if (looksLikeAppSidebar(root)) return true;
  return compactText(root.textContent || "").includes("New chat");
}

function isCompactDirectoryHeader(root, tabRow) {
  if (!root || !tabRow || root !== tabRow.parentElement) return false;
  if (typeof root.getBoundingClientRect !== "function") return false;
  const cls = typeof root.className === "string" ? root.className : "";
  if (!/\bflex\b/.test(cls) || !/\bitems-center\b/.test(cls)) return false;
  const rect = root.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const win = getWindow();
  const viewportW = win && win.innerWidth ? win.innerWidth : 0;
  const minUsefulWidth = viewportW > 0 ? Math.min(360, viewportW * 0.32) : 320;
  return rect.height < 160 || rect.width < minUsefulWidth;
}

function hideNativeDirectoryContent(state, tabRow) {
  if (!state.root) return;
  state.hiddenNodes = [];
  const keep = new Set([tabRow, state.panel]);
  const rootContainsTabRow = Boolean(state.root.contains && state.root.contains(tabRow));
  if (rootContainsTabRow) {
    let node = tabRow.parentElement;
    while (node && node !== state.root) {
      keep.add(node);
      node = node.parentElement;
    }
  }
  const broadHideAllowed = isSafeDirectoryRoot(state.root);
  if (broadHideAllowed) {
    for (const child of Array.from(state.root.children)) {
      if (keep.has(child)) continue;
      if (child.dataset.codexppTweaksDirectoryPanel === "true") continue;
      hideNode(state, child);
    }
  } else {
    state.api.log.warn("Tweaks Directory skipped broad hide because directory root looks like the app shell");
  }
  for (const heading of Array.from(state.root.querySelectorAll("h1,h2,[class*='text-']"))) {
    if (state.panel && state.panel.contains && state.panel.contains(heading)) continue;
    if (compactText(heading.textContent || "") === "Make Codex work your way") hideNode(state, heading);
  }
  if (broadHideAllowed && rootContainsTabRow) hideNativeSiblingsAlongTabPath(state, tabRow);
  hideNativeRegistryNodes(state, tabRow);
  hideNearbyNativeDirectoryNodes(state, tabRow);
}

function hideNativeDirectorySiblingsAroundPanel(state, tabRow) {
  if (!state.panel || !state.panel.parentElement) return;
  const parent = state.panel.parentElement;
  if (!isSafeDirectoryRoot(parent) && !isDirectoryContentColumnForTab(parent, tabRow)) {
    state.api.log.warn("Tweaks Directory skipped panel-sibling hide because panel parent looks like app shell");
    return;
  }
  for (const child of Array.from(parent.children)) {
    if (shouldKeepNode(state, tabRow, child)) {
      if (child && child.contains && child.contains(tabRow)) {
        hideNativeContentInsideKeptTabAncestor(state, tabRow, child);
      }
      continue;
    }
    if (child === state.errorBanner) continue;
    if (looksLikeAppSidebar(child)) continue;
    hideNode(state, child);
  }
}

function hideNativeContentInsideKeptTabAncestor(state, tabRow, ancestor) {
  if (!ancestor || typeof ancestor.querySelectorAll !== "function") return;
  const selectors = "h1,h2,h3,section,article,div,ul,ol,[role='listitem'],[role='option'],input,[placeholder]";
  const nodes = Array.from(ancestor.querySelectorAll(selectors)).slice(0, DOM_SCAN_LIMIT);
  for (const node of nodes) {
    if (shouldKeepNode(state, tabRow, node)) continue;
    if (looksLikeAppSidebar(node)) continue;
    if (isNativePluginsRegistryNode(node) || isNativeDirectoryHeadingOrListing(node)) {
      const target = nativeRegistryHideTarget(state, tabRow, node);
      if (target && !shouldKeepNode(state, tabRow, target)) hideNode(state, target);
      else hideNode(state, node);
    }
  }
}

function isNativeDirectoryHeadingOrListing(node) {
  if (!node) return false;
  const text = compactText(node.textContent || "");
  if (text === "Make Codex work your way") return true;
  if (text.includes("Make Codex work your way") && (text.includes("Coding") || text.includes("Featured") || text.includes("Recommended"))) return true;
  if (text.includes("Coding") && (text.includes("Hugging Face") || text.includes("Netlify") || text.includes("Superpowers"))) return true;
  return false;
}

function hideFloatingNativePluginSiblings(state, tabRow) {
  if (!tabRow) return;
  let current = tabRow.parentElement || tabRow;
  let depth = 0;
  while (current && current !== document.body && depth < 3) {
    const parent = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current) continue;
      if (shouldKeepNode(state, tabRow, sibling)) continue;
      if (looksLikeAppSidebar(sibling)) continue;
      if (isNativePluginBackdropSibling(sibling)) hideNode(state, sibling);
    }
    current = parent;
    depth += 1;
  }
}

function isSafeDirectoryRoot(root) {
  if (!root || root === document.body || root === document.documentElement) return false;
  if (isViewportSized(root)) return false;
  if (isAppContentColumn(root)) return false;
  if (looksLikeAppSidebar(root)) return false;
  return true;
}

function isDirectoryContentColumnForTab(root, tabRow) {
  if (!root || root === document.body || root === document.documentElement) return false;
  if (!tabRow || typeof root.contains !== "function" || !root.contains(tabRow)) return false;
  if (looksLikeAppSidebar(root)) return false;
  if (hasShellNavigationSibling(root, tabRow)) return false;
  if (!hasDirectoryTabRow(root, tabRow)) return false;
  return hasDirectoryLayoutBox(root) && (isAppContentColumn(root) || isViewportSized(root) || !isSafeDirectoryRoot(root));
}

function hideNativeSiblingsAlongTabPath(state, tabRow) {
  if (!state.root) return;
  let current = tabRow;
  while (current && current !== state.root) {
    const parent = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current) continue;
      if (shouldKeepNode(state, tabRow, sibling)) continue;
      if (looksLikeAppSidebar(sibling)) continue;
      hideNode(state, sibling);
    }
    current = parent;
  }
}

function hideNativeRegistryNodes(state, tabRow, extraRoot) {
  const roots = [state.root, extraRoot].filter(Boolean);
  const selectors = [
    "input",
    "[placeholder]",
    "button",
    "[role='button']",
    "[role='option']",
    "[role='listitem']",
    "h1",
    "h2",
    "h3",
    "section",
    "article",
    "div",
    "ul",
    "ol",
  ].join(",");
  const seen = new Set();
  for (const root of roots) {
    let scanned = 0;
    for (const node of Array.from(root.querySelectorAll(selectors))) {
      if (scanned >= DOM_SCAN_LIMIT) break;
      scanned += 1;
      if (seen.has(node)) continue;
      seen.add(node);
      if (shouldKeepNode(state, tabRow, node)) continue;
      if (!isNativePluginsRegistryNode(node)) continue;
      const target = nativeRegistryHideTarget(state, tabRow, node);
      if (target && !shouldKeepNode(state, tabRow, target)) hideNode(state, target);
    }
  }
}

function hideNearbyNativeDirectoryNodes(state, tabRow) {
  const scope = nearbyDirectoryScope(state, tabRow);
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  const selectors = "h1,h2,h3,section,article,div,input,[placeholder],[role='button'],[role='option'],[role='listitem']";
  let scanned = 0;
  for (const node of Array.from(scope.querySelectorAll(selectors))) {
    if (scanned >= DOM_SCAN_LIMIT) break;
    scanned += 1;
    if (shouldKeepNode(state, tabRow, node)) continue;
    if (looksLikeAppSidebar(node)) continue;
    if (!isNativePluginsRegistryNode(node) && !isNativeDirectoryHeadingOrListing(node)) continue;
    const target = nativeRegistryHideTarget(state, tabRow, node);
    if (target && !shouldKeepNode(state, tabRow, target)) hideNode(state, target);
    else hideNode(state, node);
  }
}

function nearbyDirectoryScope(state, tabRow) {
  if (!state.panel || !tabRow) return null;
  let node = state.panel.parentElement;
  let depth = 0;
  while (node && node !== document.body && depth < 5) {
    if (
      node.contains &&
      node.contains(tabRow) &&
      node.contains(state.panel) &&
      !looksLikeAppSidebar(node) &&
      !hasShellNavigationSibling(node, tabRow)
    ) {
      return node;
    }
    node = node.parentElement;
    depth += 1;
  }
  return null;
}

function shouldKeepNode(state, tabRow, node) {
  if (!node) return true;
  if (node === tabRow || node === state.panel || node.dataset.codexppTweaksDirectoryTab === "true") return true;
  if (state.panel && state.panel.contains && state.panel.contains(node)) return true;
  if (state.panel && node.contains && node.contains(state.panel)) return true;
  if (tabRow.contains && tabRow.contains(node)) return true;
  if (node.contains && node.contains(tabRow)) return true;
  return false;
}

function isNativePluginsRegistryNode(node) {
  const text = compactText(node.textContent || "");
  const placeholder = typeof node.getAttribute === "function" ? compactText(node.getAttribute("placeholder") || "") : "";
  if (placeholder === "Search plugins" || placeholder === "Search skills") return true;
  if (text === "Make Codex work your way" || text === "Featured") return true;
  if (text === "Built by OpenAI" || text === "All") return true;
  if (text.includes("Try in chat")) return true;
  if (text.includes("Control Mac apps from Codex")) return true;
  if (text.includes("Control Chrome with Codex")) return true;
  if (text.includes("Create and edit spreadsheet files")) return true;
  if (text.includes("Plan Grader:") || text.includes("Use when")) return true;
  if (text.includes("Read and manage Slack")) return true;
  if (text.includes("Read and manage Gmail")) return true;
  if (text.includes("Draft replies for every email")) return true;
  return false;
}

function isNativePluginBackdropSibling(node) {
  if (!node) return false;
  const text = compactText(node.textContent || "");
  if (!text) return false;
  if (text.includes("New chat") || text.includes("Projects") || text.includes("Settings")) return false;
  if (text.includes("Featured") && (text.includes("Computer Use") || text.includes("Chrome"))) return true;
  if (text.includes("Search plugins") && (text.includes("Featured") || text.includes("Built by OpenAI"))) return true;
  if (text.includes("Try in chat") && !text.includes("Tweaks")) return true;
  return false;
}

function nativeRegistryHideTarget(state, tabRow, node) {
  let current = node;
  let best = node;
  while (current.parentElement && current.parentElement !== document.body && current.parentElement !== state.root) {
    const parent = current.parentElement;
    if (shouldKeepNode(state, tabRow, parent)) break;
    const text = compactText(parent.textContent || "");
    if (
      text.includes("Plugins") && text.includes("Skills") && text.includes("Tweaks") ||
      text.includes("Settings") && text.includes("Projects") ||
      text.includes("New chat") && text.includes("Projects")
    ) {
      break;
    }
    if (text.length > 0 && text.length < 1800) {
      current = parent;
      if (isBoundedRegistryContainer(current)) best = current;
    }
    else break;
  }
  return best;
}

function isBoundedRegistryContainer(node) {
  if (!node) return false;
  const text = compactText(node.textContent || "");
  if (!text && !hasNativeDirectorySearch(node)) return false;
  if (text.includes("New chat") || text.includes("Projects") || text.includes("Settings")) return false;
  if (hasNativeDirectorySearch(node)) return true;
  if (text.includes("Search plugins") || text.includes("Search skills")) return true;
  if (text.includes("Featured") && (text.includes("Computer Use") || text.includes("Chrome"))) return true;
  if (text.includes("Make Codex work your way") && (text.includes("Try in chat") || text.includes("Featured"))) return true;
  return false;
}

function hideNode(state, node) {
  if (!node || node.dataset.codexppTweaksDirectoryHidden === "true") return;
  node.dataset.codexppTweaksDirectoryHidden = "true";
  node.dataset.codexppTweaksDirectoryDisplay = node.style.display || "";
  node.style.display = "none";
  state.hiddenNodes.push(node);
  exposeDebugState(state);
}

function logHiddenNodes(state) {
  const sample = state.hiddenNodes.slice(0, DEBUG_NODE_SAMPLE_LIMIT).map((node) => describeNode(node)).join(" | ") || "(none)";
  const suffix = state.hiddenNodes.length > DEBUG_NODE_SAMPLE_LIMIT ? `; more=${state.hiddenNodes.length - DEBUG_NODE_SAMPLE_LIMIT}` : "";
  state.api.log.info(`Tweaks Directory hidden native nodes: count=${state.hiddenNodes.length}; sample=${sample}${suffix}`);
  exposeDebugState(state);
}

function describeNode(node) {
  if (!node) return "(missing)";
  const tag = String(node.tagName || "node").toLowerCase();
  const role = typeof node.getAttribute === "function" && node.getAttribute("role") ? `[role="${node.getAttribute("role")}"]` : "";
  const cls = node.className && typeof node.className === "string" ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
  const text = compactText(node.textContent || "").slice(0, 120);
  return `${tag}${role}${cls}${text ? ` "${text}"` : ""}`;
}

function exposeDebugState(state) {
  const win = getWindow();
  if (!win) return;
  win.__codexppTweaksDirectory = {
    active: state.active,
    hiddenNodeCount: state.hiddenNodes.length,
    hiddenNodes: state.hiddenNodes.slice(0, DEBUG_NODE_SAMPLE_LIMIT).map((node) => ({
      description: describeNode(node),
      display: node.style.display || "",
      text: compactText(node.textContent || "").slice(0, DEBUG_NODE_TEXT_LIMIT),
    })),
    panelConnected: Boolean(state.panel && state.panel.isConnected),
    tabConnected: Boolean(state.tab && state.tab.isConnected),
  };
}

function setTabVisualState(state, active) {
  applyTweaksTabShell(state.tab);
  if (state.tab) {
    state.tab.setAttribute("aria-pressed", active ? "true" : "false");
    state.tab.setAttribute("aria-selected", active ? "true" : "false");
    state.tab.classList.toggle("codexpp-tweaks-directory-tab-active", active);
    state.tab.dataset.state = active ? "active" : "inactive";
  }
  if (active) suppressNativeTabVisualState(state);
  else restoreNativeTabVisualState(state);
  // Use a tab-row delegate (re-attached on every activation) instead of the
  // old `{once: true, capture: true}` listener per button — React may swap
  // the underlying button DOM nodes, which would lose a per-node listener
  // and leave our hidden-children pinned with `display:none` after the
  // user clicks Plugins / Skills.
  if (active) installTabRowDelegate(state);
}

function suppressNativeTabVisualState(state) {
  restoreNativeTabVisualState(state);
  state.nativeTabVisualRestore = [];
  for (const button of state.nativeButtons || []) {
    if (!button || !button.dataset || typeof button.setAttribute !== "function") continue;
    state.nativeTabVisualRestore.push({
      button,
      dataState: button.dataset.state,
      ariaSelected: button.getAttribute ? button.getAttribute("aria-selected") : null,
      ariaPressed: button.getAttribute ? button.getAttribute("aria-pressed") : null,
    });
    button.dataset.state = "inactive";
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-pressed", "false");
  }
}

function restoreNativeTabVisualState(state) {
  for (const entry of state.nativeTabVisualRestore || []) {
    const button = entry && entry.button;
    if (!button || !button.dataset || typeof button.setAttribute !== "function") continue;
    if (entry.dataState === undefined) delete button.dataset.state;
    else button.dataset.state = entry.dataState;
    restoreAttribute(button, "aria-selected", entry.ariaSelected);
    restoreAttribute(button, "aria-pressed", entry.ariaPressed);
  }
  state.nativeTabVisualRestore = [];
}

function restoreAttribute(node, name, value) {
  if (!node) return;
  if (value === null || value === undefined) {
    if (typeof node.removeAttribute === "function") node.removeAttribute(name);
    else if (node.attributes) delete node.attributes[name];
    return;
  }
  if (typeof node.setAttribute === "function") node.setAttribute(name, value);
}

async function loadData(state, forceStore) {
  if (!state.active) return;
  const token = state.loadToken + 1;
  state.loadToken = token;
  state.loading = true;
  render(state);
  try {
    const [installed, paths] = await Promise.all([
      state.api.ipc.invoke(CHANNELS.listInstalled),
      state.api.ipc.invoke(CHANNELS.getUserPaths).catch(() => null),
    ]);
    if (!state.active || state.loadToken !== token) return;
    state.installed = Array.isArray(installed) ? installed : [];
    state.paths = paths;
    if (!state.store || forceStore) {
      const store = await state.api.ipc.invoke(CHANNELS.getStore, Boolean(forceStore));
      if (!state.active || state.loadToken !== token) return;
      state.store = store;
    }
    if (!state.active || state.loadToken !== token) return;
    syncDetailFromLocation(state, false);
    state.status = "";
  } catch (error) {
    if (!state.active || state.loadToken !== token) return;
    state.status = error && error.message ? error.message : String(error);
  } finally {
    if (!state.active || state.loadToken !== token) return;
    state.loading = false;
    render(state);
  }
}

function render(state) {
  if (!state.panel) return;
  const panel = state.panel;
  panel.hidden = false;
  panel.innerHTML = "";

  const detailRow = state.detailRowKey ? visibleRows(state).find((row) => rowKey(row) === state.detailRowKey) : null;
  panel.classList.toggle("codexpp-td-detail-mode", Boolean(detailRow));
  syncNativeTabRowBreadcrumb(state, detailRow);
  if (detailRow) {
    renderTweakDetailPage(state, panel, detailRow);
    return;
  }

  const header = document.createElement("div");
  header.className = "codexpp-td-header";
  header.dataset.slot = "page-header";
  const title = document.createElement("h1");
  title.dataset.slot = "page-title";
  title.textContent = "Make Codex work your way";
  header.appendChild(title);

  const toolbar = document.createElement("div");
  toolbar.className = "codexpp-td-toolbar";
  toolbar.dataset.slot = "toolbar";
  toolbar.appendChild(searchInput(state));
  toolbar.appendChild(filterSelect(state));
  header.appendChild(toolbar);
  panel.appendChild(header);

  if (state.status) panel.appendChild(messageCard("Could not load tweaks", state.status));
  if (state.loading) panel.appendChild(messageCard("Loading tweaks", "Refreshing installed tweaks and the live store registry."));

  const rows = visibleRows(state);
  if (rows.length === 0 && !state.loading) {
    panel.appendChild(messageCard("No matching tweaks", "Change the search or filter to see more results."));
  } else {
    const list = document.createElement("div");
    list.className = "codexpp-td-list";
    list.dataset.slot = "list";
    list.setAttribute("role", "list");
    for (const section of groupedRows(rows)) {
      list.appendChild(sectionHeader(section.title));
      const grid = document.createElement("div");
      grid.className = "codexpp-td-grid";
      grid.dataset.slot = "list";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", section.title);
      for (const row of section.rows) grid.appendChild(rowCard(state, row));
      list.appendChild(grid);
    }
    panel.appendChild(list);
  }

  panel.appendChild(directoryActions(state));
}

function searchInput(state) {
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search tweaks";
  input.value = state.query;
  input.className = "codexpp-td-search";
  input.dataset.slot = "input";
  input.addEventListener("input", () => {
    state.query = input.value;
    state.detailRowKey = null;
    render(state);
  });
  return input;
}

function filterSelect(state) {
  const wrap = document.createElement("label");
  wrap.className = "codexpp-td-filter-select";
  wrap.dataset.slot = "select-trigger";
  wrap.title = "Filter tweaks";
  const select = document.createElement("select");
  select.dataset.slot = "select";
  select.setAttribute("aria-label", "Filter tweaks");
  for (const option of STORE_FILTERS) {
    const item = document.createElement("option");
    item.dataset.slot = "select-item";
    item.value = option.key;
    item.textContent = option.label;
    if (state.filter === option.key) item.selected = true;
    select.appendChild(item);
  }
  select.addEventListener("change", () => {
    state.filter = select.value;
    state.detailRowKey = null;
    render(state);
  });
  wrap.appendChild(select);
  const chevron = document.createElement("span");
  chevron.dataset.slot = "select-icon";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  wrap.appendChild(chevron);
  return wrap;
}

function visibleRows(state) {
  const installedById = new Map(state.installed.map((item) => [item.manifest.id, item]));
  const hiddenForkedUpstreamIds = forkedUpstreamIds(state.installed);
  const storeEntries = state.store && Array.isArray(state.store.entries) ? state.store.entries : [];
  const rows = [];

  for (const item of state.installed) {
    if (shouldHideForkedUpstreamRow(item, hiddenForkedUpstreamIds)) continue;
    const storeEntry = storeEntries.find((entry) => entry.id === item.manifest.id) || null;
    rows.push({ type: "installed", installed: item, store: storeEntry, manifest: item.manifest });
  }

  for (const entry of storeEntries) {
    if (installedById.has(entry.id)) continue;
    if (hiddenForkedUpstreamIds.has(entry.id)) continue;
    rows.push({ type: "store", installed: null, store: entry, manifest: entry.manifest });
  }

  const query = state.query.trim().toLowerCase();
  return rows.filter((row) => {
    const update = row.store && row.installed && row.store.manifest.version !== row.installed.manifest.version;
    if (state.filter === "installed" && !row.installed) return false;
    if (state.filter === "store" && row.installed) return false;
    if (state.filter === "updates" && !update) return false;
    if (!query) return true;
    const haystack = [
      row.manifest.name,
      row.manifest.description,
      row.manifest.githubRepo,
      row.manifest.tags && row.manifest.tags.join(" "),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function forkedUpstreamIds(installed) {
  const ids = new Set();
  for (const item of installed || []) {
    const upstreamId = item && item.manifest && item.manifest.forkOf && item.manifest.forkOf.upstreamId;
    if (typeof upstreamId === "string" && upstreamId.trim()) ids.add(upstreamId.trim());
  }
  return ids;
}

function shouldHideForkedUpstreamRow(item, hiddenForkedUpstreamIds) {
  const id = item && item.manifest && item.manifest.id;
  return Boolean(
    id
      && item.enabled === false
      && hiddenForkedUpstreamIds
      && hiddenForkedUpstreamIds.has(id)
  );
}

function groupedRows(rows) {
  const updates = [];
  const installed = [];
  const store = [];
  for (const row of rows) {
    if (row.store && row.installed && row.store.manifest.version !== row.installed.manifest.version) updates.push(row);
    else if (row.installed) installed.push(row);
    else store.push(row);
  }
  return [
    { title: "Updates", rows: updates },
    { title: "Installed", rows: installed },
    { title: "Store", rows: store },
  ].filter((section) => section.rows.length > 0);
}

function sectionHeader(title) {
  const wrap = document.createElement("div");
  wrap.className = "codexpp-td-section";
  wrap.dataset.slot = "section";
  const heading = document.createElement("h2");
  heading.dataset.slot = "section-title";
  heading.textContent = title;
  wrap.appendChild(heading);
  return wrap;
}

function rowCard(state, row) {
  const card = document.createElement("article");
  card.className = "codexpp-td-item";
  card.dataset.slot = "card";
  card.setAttribute("role", "listitem");
  card.tabIndex = 0;
  card.setAttribute("aria-label", `Open ${row.manifest.name || row.manifest.id} details`);
  const left = document.createElement("div");
  left.className = "codexpp-td-item-left";
  left.appendChild(avatar(state, row));

  const body = document.createElement("div");
  body.className = "codexpp-td-item-body";
  body.dataset.slot = "card-content";
  const title = document.createElement("div");
  title.className = "codexpp-td-item-title";
  title.dataset.slot = "card-title";
  title.appendChild(textSpan(row.manifest.name || row.manifest.id));
  body.appendChild(title);
  if (row.manifest.description) {
    const desc = document.createElement("p");
    desc.dataset.slot = "card-description";
    desc.textContent = truncateDescription(row.manifest.description);
    body.appendChild(desc);
  }
  left.appendChild(body);
  card.appendChild(left);

  if (row.manifest.forkOf) {
    const lineage = document.createElement("div");
    lineage.className = "codexpp-td-meta codexpp-td-lineage";
    const upstream = row.manifest.forkOf;
    lineage.textContent =
      "Forked from " + upstream.upstreamId +
      " @ " + (upstream.upstreamVersion || "unknown") +
      " (" + (upstream.upstreamCommitSha ? upstream.upstreamCommitSha.slice(0, 7) : "unpinned") + ")";
    body.appendChild(lineage);
  }

  const actions = document.createElement("div");
  actions.className = "codexpp-td-item-actions";
  actions.dataset.slot = "button-group";
  actions.appendChild(primaryDirectoryAction(state, row));
  card.appendChild(actions);
  const page = firstPageForTweak(state, row.manifest.id);
  card.addEventListener("click", (event) => {
    if (event.target && typeof event.target.closest === "function" && event.target.closest("button,a,select,input,textarea")) return;
    openTweakDetailPage(state, row);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openTweakDetailPage(state, row);
  });
  card.title = `Open ${row.manifest.name || row.manifest.id} details`;
  if (page) card.dataset.codexppHasSettingsPage = "true";
  return card;
}

function rowKey(row) {
  return row.manifest && row.manifest.id || row.store && row.store.id || "";
}

function openTweakDetailPage(state, row) {
  state.detailRowKey = rowKey(row);
  state.detailMenuOpen = null;
  writeDetailToLocation(rowKey(row));
  render(state);
  scrollPanelIntoView(state);
}

function renderTweakDetailPage(state, panel, row) {
  const manifest = row.manifest || {};
  const page = firstPageForTweak(state, manifest.id);
  const hasUpdate = row.store && row.installed && row.store.manifest.version !== row.installed.manifest.version;

  const header = document.createElement("div");
  header.className = "codexpp-td-detail-header";
  header.dataset.slot = "page-header";

  const headerActions = document.createElement("div");
  headerActions.className = "codexpp-td-detail-actions";
  headerActions.dataset.slot = "card-action";
  for (const action of detailActions(state, row, page, hasUpdate)) headerActions.appendChild(action);
  header.appendChild(headerActions);
  panel.appendChild(header);
  if (state.status) panel.appendChild(messageCard("Could not open tweak settings", state.status));

  const main = document.createElement("div");
  main.className = "codexpp-td-detail-main";
  main.dataset.slot = "page";

  const hero = document.createElement("section");
  hero.className = "codexpp-td-detail-hero";
  hero.dataset.slot = "card-header";
  hero.appendChild(avatar(state, row));
  const title = document.createElement("h1");
  title.dataset.slot = "card-title";
  title.textContent = manifest.name || manifest.id || "Tweak";
  hero.appendChild(title);
  if (manifest.description) {
    const description = document.createElement("p");
    description.dataset.slot = "card-description";
    description.textContent = manifest.description;
    hero.appendChild(description);
  }
  main.appendChild(hero);

  const prompt = document.createElement("button");
  prompt.type = "button";
  prompt.className = "codexpp-td-detail-prompt";
  prompt.dataset.slot = "button";
  prompt.appendChild(promptIcon(state, row));
  prompt.appendChild(textSpan(`${manifest.name || manifest.id} show me this tweak`));
  prompt.addEventListener("click", () => {
    state.detailRowKey = null;
    state.detailMenuOpen = null;
    writeDetailToLocation(null);
    render(state);
  });
  main.appendChild(prompt);

  if (manifest.description) {
    const overview = document.createElement("p");
    overview.className = "codexpp-td-detail-overview";
    overview.textContent = manifest.description;
    main.appendChild(overview);
  }

  const includes = document.createElement("section");
  includes.className = "codexpp-td-detail-section";
  includes.dataset.slot = "card";
  includes.appendChild(detailSectionTitle("Includes"));
  const includesCard = document.createElement("div");
  includesCard.className = "codexpp-td-detail-card codexpp-td-detail-includes-card";
  includesCard.dataset.slot = "card-content";
  includesCard.appendChild(detailIncludeItem(state, row, manifest.name || manifest.id || "Tweak", "Tweak", manifest.description || statusText(row, hasUpdate)));
  if (page) includesCard.appendChild(detailIncludeItem(state, row, page.title || "Settings page", "Settings", "Configure this tweak from Codex Settings."));
  includesCard.appendChild(detailIncludeItem(state, row, row.installed ? "Installed package" : "Store package", row.installed ? "Entry" : "Store", row.installed && row.installed.entry ? row.installed.entry : "Available through the tweak store."));
  includes.appendChild(includesCard);
  main.appendChild(includes);

  const filesSection = renderInstalledTweakFilesSection(state, row);
  if (filesSection) main.appendChild(filesSection);

  const info = document.createElement("section");
  info.className = "codexpp-td-detail-section";
  info.dataset.slot = "card";
  info.appendChild(detailSectionTitle("Information"));
  const infoCard = document.createElement("div");
  infoCard.className = "codexpp-td-detail-card";
  infoCard.dataset.slot = "card-content";
  infoCard.appendChild(detailRow("Status", row.installed ? row.installed.enabled ? "Installed, enabled" : "Installed, disabled" : "Available in store"));
  infoCard.appendChild(detailRow("Version", manifest.version || "Unknown"));
  infoCard.appendChild(detailRow("Latest", row.store && row.store.manifest && row.store.manifest.version ? row.store.manifest.version : hasUpdate ? "Update available" : "Current"));
  if (manifest.githubRepo) infoCard.appendChild(detailRow("GitHub", manifest.githubRepo));
  if (manifest.author) infoCard.appendChild(detailRow("Developer", authorText(manifest.author)));
  if (manifest.tags && manifest.tags.length) infoCard.appendChild(detailRow("Tags", manifest.tags.join(", ")));
  if (manifest.scope) infoCard.appendChild(detailRow("Scope", manifest.scope));
  info.appendChild(infoCard);
  main.appendChild(info);

  if (manifest.forkOf) {
    const lineage = document.createElement("section");
    lineage.className = "codexpp-td-detail-section";
    lineage.dataset.slot = "card";
    lineage.appendChild(detailSectionTitle("Lineage"));
    const lineageCard = document.createElement("div");
    lineageCard.className = "codexpp-td-detail-card";
    lineageCard.dataset.slot = "card-content";
    lineageCard.appendChild(detailRow("Forked from", manifest.forkOf.upstreamId || "Unknown"));
    lineageCard.appendChild(detailRow("Upstream version", manifest.forkOf.upstreamVersion || "Unknown"));
    lineageCard.appendChild(detailRow("Pinned commit", manifest.forkOf.upstreamCommitSha || "Unpinned"));
    lineage.appendChild(lineageCard);
    main.appendChild(lineage);
  }

  panel.appendChild(main);
}

function detailActions(state, row, page, hasUpdate) {
  const manifest = row.manifest || {};
  const actions = [];
  if (hasUpdate && row.store) actions.push(button("Update", () => installStoreEntry(state, row.store.id), "primary"));
  else if (row.store && !row.installed) actions.push(button("Install", () => installStoreEntry(state, row.store.id), "primary"));
  else if (row.installed && !row.installed.enabled) actions.push(button("Enable", () => setEnabled(state, manifest.id, true), "primary"));
  else if (page) actions.push(button("Configure", () => openTweakSettingsPage(state, page), "primary"));
  if (row.installed) actions.push(button("Reload tweaks", () => reloadInstalledTweaks(state)));
  if (manifest.homepage) actions.push(button("Homepage", () => state.api.ipc.invoke(CHANNELS.openExternal, manifest.homepage)));
  if (manifest.githubRepo) actions.push(button("GitHub", () => state.api.ipc.invoke(CHANNELS.openExternal, `https://github.com/${manifest.githubRepo}`)));
  actions.push(detailMenu(state, row));
  return actions;
}

function detailMenu(state, row) {
  const manifest = row.manifest || {};
  const wrap = document.createElement("div");
  wrap.className = "codexpp-td-detail-menu-wrap";
  wrap.dataset.slot = "dropdown-menu";
  const trigger = iconButton("…", "More tweak actions", () => {
    state.detailMenuOpen = state.detailMenuOpen === manifest.id ? null : manifest.id;
    render(state);
  });
  wrap.appendChild(trigger);
  if (state.detailMenuOpen !== manifest.id) return wrap;

  const menu = document.createElement("div");
  menu.className = "codexpp-td-detail-menu";
  menu.dataset.slot = "dropdown-menu-content";
  menu.setAttribute("role", "menu");
  menu.appendChild(detailMenuItem("Copy detail link", () => copyDetailLink(state, manifest.id)));
  menu.appendChild(detailMenuItem("Refresh directory", () => loadData(state, true)));
  if (row.installed) menu.appendChild(detailMenuItem("Reload tweaks", () => reloadInstalledTweaks(state)));
  menu.appendChild(detailMenuItem("Open tweaks folder", () => state.api.ipc.invoke(CHANNELS.revealTweaksFolder)));
  if (row.installed && row.installed.enabled) {
    menu.appendChild(detailMenuItem("Disable tweak", () => setEnabled(state, manifest.id, false)));
  } else if (row.installed) {
    menu.appendChild(detailMenuItem("Enable tweak", () => setEnabled(state, manifest.id, true)));
  }
  wrap.appendChild(menu);
  return wrap;
}

function detailMenuItem(label, onClick) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "codexpp-td-detail-menu-item";
  item.dataset.slot = "dropdown-menu-item";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", async () => {
    item.disabled = true;
    try {
      await onClick();
    } finally {
      item.disabled = false;
    }
  });
  return item;
}

function renderInstalledTweakFilesSection(state, row) {
  const manifest = row && row.manifest || {};
  if (!row || !row.installed || !manifest.id) return null;
  const entry = fileTreeStateFor(state, manifest.id);
  if (!entry.loading && !entry.result && !entry.error) {
    void loadTweakFileTree(state, manifest.id, false, false);
  }

  const section = document.createElement("section");
  section.className = "codexpp-td-detail-section codexpp-td-files-section";
  section.dataset.slot = "card";

  const header = document.createElement("div");
  header.className = "codexpp-td-files-header";
  header.appendChild(detailSectionTitle("Files"));

  const source = document.createElement("span");
  source.className = "codexpp-td-files-source";
  source.textContent = fileTreeSourceLabel(entry.result);
  if (entry.result && entry.result.rootPath) source.title = entry.result.rootPath;
  header.appendChild(source);

  const refresh = button("Refresh files", () => loadTweakFileTree(state, manifest.id, true, true));
  refresh.classList.add("codexpp-td-files-refresh");
  refresh.disabled = entry.loading;
  header.appendChild(refresh);
  section.appendChild(header);

  const card = document.createElement("div");
  card.className = "codexpp-td-detail-card codexpp-td-files-card";
  card.dataset.slot = "card-content";

  if (entry.loading && !entry.result) {
    card.appendChild(fileTreeMessage("Loading files", "Reading the installed tweak package."));
  } else if (entry.error) {
    card.appendChild(fileTreeMessage("Could not load files", entry.error));
  } else if (!entry.result || !entry.result.tree) {
    card.appendChild(fileTreeMessage("No files found", fileTreeStatusMessage(entry.result, "The installed tweak did not return a readable file tree.")));
  } else if (isEmptyFileTree(entry.result.tree)) {
    card.appendChild(fileTreeMessage("No files found", fileTreeStatusMessage(entry.result, "This installed tweak folder is empty.")));
  } else {
    if (entry.loading) card.appendChild(fileTreeMessage("Refreshing files", "Keeping the current tree visible while the runtime refreshes it."));
    card.appendChild(renderFileTree(state, manifest.id, entry, entry.result.tree));
  }

  section.appendChild(card);
  return section;
}

function renderNativePluginFilesSection(state, detail) {
  if (!detail || !detail.candidate) return null;
  const treeKey = pluginFileTreeKey(detail.candidate);
  const entry = fileTreeStateFor(state, treeKey);
  if (!entry.loading && !entry.result && !entry.error) {
    void loadPluginFileTree(state, detail.candidate, false, false, detail.key);
  }

  const section = document.createElement("section");
  section.className = "codexpp-td-detail-section codexpp-td-files-section codexpp-td-native-plugin-files";
  section.dataset.codexppPluginFiles = "true";
  section.dataset.slot = "card";

  const header = document.createElement("div");
  header.className = "codexpp-td-files-header";
  header.appendChild(detailSectionTitle("Files"));

  const source = document.createElement("span");
  source.className = "codexpp-td-files-source";
  source.textContent = fileTreeSourceLabel(entry.result || { rootLabel: detail.candidate, sourceKind: "plugin" });
  if (entry.result && entry.result.rootPath) source.title = entry.result.rootPath;
  header.appendChild(source);

  const refresh = button("Refresh files", () => loadPluginFileTree(state, detail.candidate, true, true, detail.key));
  refresh.classList.add("codexpp-td-files-refresh");
  refresh.disabled = entry.loading;
  header.appendChild(refresh);
  section.appendChild(header);

  const card = document.createElement("div");
  card.className = "codexpp-td-detail-card codexpp-td-files-card";
  card.dataset.slot = "card-content";

  if (entry.loading && !entry.result) {
    card.appendChild(fileTreeMessage("Loading files", "Reading the plugin package."));
  } else if (entry.error) {
    card.appendChild(fileTreeMessage("Could not load files", entry.error));
  } else if (!entry.result || !entry.result.tree) {
    const fallback = entry.result && entry.result.status === "ambiguous"
      ? "This plugin matched more than one installed source. Choose a more exact plugin identity."
      : "This plugin did not return a readable file tree.";
    card.appendChild(fileTreeMessage("No files found", fileTreeStatusMessage(entry.result, fallback)));
  } else if (isEmptyFileTree(entry.result.tree)) {
    card.appendChild(fileTreeMessage("No files found", fileTreeStatusMessage(entry.result, "This plugin folder is empty.")));
  } else {
    if (entry.loading) card.appendChild(fileTreeMessage("Refreshing files", "Keeping the current tree visible while the runtime refreshes it."));
    card.appendChild(renderFileTree(state, treeKey, entry, entry.result.tree));
  }

  section.appendChild(card);
  return section;
}

function fileTreeStateFor(state, tweakId) {
  const id = String(tweakId || "");
  if (!state.fileTrees[id]) {
    state.fileTrees[id] = {
      loading: false,
      error: "",
      result: null,
      expanded: new Set(),
      selected: "",
      requestId: 0,
    };
  }
  return state.fileTrees[id];
}

async function loadTweakFileTree(state, tweakId, refresh, renderStart) {
  const id = String(tweakId || "");
  if (!id) return;
  const entry = fileTreeStateFor(state, id);
  const requestId = entry.requestId + 1;
  entry.requestId = requestId;
  entry.loading = true;
  entry.error = "";
  if (renderStart) render(state);
  try {
    const result = await state.api.ipc.invoke(CHANNELS.getTweakFileTree, id, {
      refresh: Boolean(refresh),
      force: Boolean(refresh),
    });
    if (entry.requestId !== requestId) return;
    entry.result = normalizeFileTreeResult(result, id);
    if (entry.result && entry.result.tree) entry.expanded.add(fileTreeNodeId(entry.result.tree));
    if (entry.result && entry.result.status && !isFileTreeReadyStatus(entry.result.status)) {
      entry.error = fileTreeStatusMessage(entry.result, "The runtime returned a non-ready file tree response.");
    }
  } catch (error) {
    if (entry.requestId !== requestId) return;
    entry.error = errorMessage(error);
  } finally {
    if (entry.requestId === requestId) {
      entry.loading = false;
      render(state);
    }
  }
}

async function loadPluginFileTree(state, pluginIdOrName, refresh, renderStart, nativeKey) {
  const id = String(pluginIdOrName || "");
  if (!id) return;
  const treeKey = pluginFileTreeKey(id);
  const entry = fileTreeStateFor(state, treeKey);
  const requestId = entry.requestId + 1;
  entry.requestId = requestId;
  entry.loading = true;
  entry.error = "";
  if (renderStart) syncNativePluginFilesSection(state, true);
  try {
    const result = await state.api.ipc.invoke(CHANNELS.getPluginFileTree, id, {
      refresh: Boolean(refresh),
      force: Boolean(refresh),
    });
    if (entry.requestId !== requestId) return;
    entry.result = normalizeFileTreeResult(result, id);
    if (entry.result && entry.result.tree) entry.expanded.add(fileTreeNodeId(entry.result.tree));
    if (entry.result && entry.result.status && !isFileTreeReadyStatus(entry.result.status)) {
      entry.error = fileTreeStatusMessage(entry.result, "The runtime returned a non-ready plugin file tree response.");
    }
  } catch (error) {
    if (entry.requestId !== requestId) return;
    entry.error = errorMessage(error);
  } finally {
    if (entry.requestId === requestId) {
      entry.loading = false;
      if (nativeKey && state.nativePluginFiles && state.nativePluginFiles.key === nativeKey) {
        syncNativePluginFilesSection(state, true);
      }
    }
  }
}

function pluginFileTreeKey(pluginIdOrName) {
  return `plugin:${String(pluginIdOrName || "").trim().toLowerCase()}`;
}

function normalizeFileTreeResult(result, tweakId) {
  const value = result && typeof result === "object" ? result : {};
  return {
    status: typeof value.status === "string" ? value.status : "ok",
    rootLabel: typeof value.rootLabel === "string" && value.rootLabel ? value.rootLabel : typeof value.label === "string" && value.label ? value.label : tweakId,
    rootPath: typeof value.rootPath === "string" ? value.rootPath : typeof value.root === "string" ? value.root : "",
    sourceKind: typeof value.sourceKind === "string" && value.sourceKind ? value.sourceKind : "installed-tweak",
    tree: value.tree && typeof value.tree === "object" ? value.tree : null,
    message: typeof value.message === "string" ? value.message : "",
    candidates: Array.isArray(value.candidates) ? value.candidates : [],
  };
}

function isFileTreeReadyStatus(status) {
  return status === "ok" || status === "resolved";
}

function fileTreeSourceLabel(result) {
  if (!result) return "Installed source";
  const kind = compactText(String(result.sourceKind || "installed").replace(/[-_]+/g, " "));
  const label = compactText(result.rootLabel || "");
  if (kind && label) return `${kind} · ${label}`;
  return label || kind || "Installed source";
}

function fileTreeStatusMessage(result, fallback) {
  if (result && result.message) return result.message;
  if (result && Array.isArray(result.candidates) && result.candidates.length > 0) {
    return `Checked ${result.candidates.length} candidate location${result.candidates.length === 1 ? "" : "s"}.`;
  }
  return fallback;
}

function isEmptyFileTree(node) {
  if (!node || typeof node !== "object") return true;
  if (node.omittedReason) return false;
  const children = Array.isArray(node.children) ? node.children : [];
  return children.length === 0;
}

function renderFileTree(state, tweakId, entry, rootNode) {
  const tree = document.createElement("div");
  tree.className = "codexpp-td-file-tree";
  tree.setAttribute("role", "tree");
  tree.appendChild(renderFileTreeNode(state, tweakId, entry, rootNode, 0));
  return tree;
}

function renderFileTreeNode(state, tweakId, entry, node, depth) {
  const item = document.createElement("div");
  item.className = "codexpp-td-file-tree-item";
  const nodeId = fileTreeNodeId(node);
  const children = Array.isArray(node.children) ? node.children : [];
  const isFolder = isFileTreeFolder(node);
  const canExpand = isFolder && children.length > 0 && !node.omittedReason;
  const expanded = canExpand && entry.expanded.has(nodeId);

  const row = document.createElement("div");
  row.className = "codexpp-td-file-tree-row";
  row.style.setProperty("--codexpp-td-file-depth", String(Math.max(0, depth)));
  row.dataset.codexppTweakFileNode = nodeId;
  row.setAttribute("role", "treeitem");
  row.tabIndex = 0;
  if (canExpand) row.setAttribute("aria-expanded", expanded ? "true" : "false");
  if (!canExpand && !isFolder && entry.selected === nodeId) row.classList.add("selected");
  if (node.omittedReason) row.classList.add("omitted");

  const disclosure = document.createElement("span");
  disclosure.className = "codexpp-td-file-tree-disclosure";
  disclosure.setAttribute("aria-hidden", "true");
  disclosure.textContent = canExpand ? expanded ? "⌄" : "›" : "";
  row.appendChild(disclosure);

  const icon = document.createElement("span");
  icon.className = "codexpp-td-file-tree-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = isFolder ? "□" : "•";
  row.appendChild(icon);

  const name = document.createElement("span");
  name.className = "codexpp-td-file-tree-name";
  name.textContent = fileTreeNodeName(node);
  row.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "codexpp-td-file-tree-meta";
  meta.textContent = node.omittedReason ? `Omitted: ${node.omittedReason}` : fileTreeNodeMeta(node);
  row.appendChild(meta);

  row.addEventListener("click", () => activateFileTreeRow(state, tweakId, node, canExpand));
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateFileTreeRow(state, tweakId, node, canExpand);
  });

  item.appendChild(row);
  if (expanded) {
    const group = document.createElement("div");
    group.className = "codexpp-td-file-tree-children";
    group.setAttribute("role", "group");
    for (const child of children) group.appendChild(renderFileTreeNode(state, tweakId, entry, child, depth + 1));
    item.appendChild(group);
  }
  return item;
}

function activateFileTreeRow(state, tweakId, node, canExpand) {
  if (canExpand) {
    toggleTweakFileFolder(state, tweakId, node);
    return;
  }
  if (!isFileTreeFolder(node) && !node.omittedReason) selectTweakFile(state, tweakId, node);
}

function toggleTweakFileFolder(state, tweakId, node) {
  const entry = fileTreeStateFor(state, tweakId);
  const id = fileTreeNodeId(node);
  if (entry.expanded.has(id)) entry.expanded.delete(id);
  else entry.expanded.add(id);
  render(state);
}

function selectTweakFile(state, tweakId, node) {
  const entry = fileTreeStateFor(state, tweakId);
  entry.selected = fileTreeNodeId(node);
  render(state);
}

function fileTreeNodeId(node) {
  return String(node && (node.id || node.relPath || node.path || node.name) || ".");
}

function fileTreeNodeName(node) {
  return String(node && (node.name || node.relPath || node.path || node.id) || "(unnamed)");
}

function isFileTreeFolder(node) {
  const kind = String(node && node.kind || "").toLowerCase();
  const type = String(node && node.type || "").toLowerCase();
  return kind === "directory" || kind === "folder" || type === "directory" || type === "folder" || Array.isArray(node && node.children);
}

function fileTreeNodeMeta(node) {
  if (!node || typeof node !== "object") return "";
  const parts = [];
  if (Number.isFinite(node.size)) parts.push(formatFileSize(node.size));
  if (Number.isFinite(node.mtimeMs)) parts.push(formatFileMtime(node.mtimeMs));
  return parts.join(" · ");
}

function formatFileSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function formatFileMtime(mtimeMs) {
  try {
    return new Date(Number(mtimeMs)).toLocaleDateString();
  } catch {
    return "";
  }
}

function fileTreeMessage(title, message) {
  const wrap = document.createElement("div");
  wrap.className = "codexpp-td-file-tree-message";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = message || "";
  wrap.append(heading, text);
  return wrap;
}

function syncNativeTabRowBreadcrumb(state, row) {
  if (!row) {
    restoreNativeTabRow(state);
    return;
  }
  const tabRow = state.tab && state.tab.parentElement;
  if (!tabRow || typeof tabRow.appendChild !== "function") return;

  hideTabRowButton(state, state.nativeButtons && state.nativeButtons[0]);
  hideTabRowButton(state, state.nativeButtons && state.nativeButtons[1]);
  hideTabRowButton(state, state.tab);
  tabRow.dataset.codexppTweaksDirectoryDetailNav = "true";

  if (state.detailBreadcrumb && state.detailBreadcrumb.isConnected) {
    updateNativeDetailBreadcrumb(state.detailBreadcrumb, row, state);
    return;
  }

  const nav = document.createElement("div");
  nav.className = "codexpp-td-native-breadcrumbs";
  nav.dataset.codexppTweaksDirectoryDetailBreadcrumb = "true";
  nav.dataset.slot = "breadcrumb";
  nav.setAttribute("aria-label", "Tweak detail breadcrumb");
  tabRow.appendChild(nav);
  state.detailBreadcrumb = nav;
  updateNativeDetailBreadcrumb(nav, row, state);
}

function updateNativeDetailBreadcrumb(nav, row, state) {
  const manifest = row && row.manifest || {};
  nav.innerHTML = "";
  nav.appendChild(detailCrumb("Tweaks", false, () => {
    if (state) {
      state.detailRowKey = null;
      state.detailMenuOpen = null;
      writeDetailToLocation(null);
      render(state);
    }
  }));
  nav.appendChild(detailChevron());
  nav.appendChild(detailCrumb(manifest.name || manifest.id || "Tweak", true));
}

function hideTabRowButton(state, button) {
  if (!button || !button.style || !button.dataset) return;
  if (button.dataset.codexppTweaksDirectoryDetailDisplay === undefined) {
    button.dataset.codexppTweaksDirectoryDetailDisplay = button.style.display || "";
  }
  button.style.display = "none";
}

function restoreNativeTabRow(state) {
  if (state.detailBreadcrumb) {
    state.detailBreadcrumb.remove();
    state.detailBreadcrumb = null;
  }
  const tabRow = state.tab && state.tab.parentElement || state.tabRowDelegateRow;
  if (tabRow && tabRow.dataset) delete tabRow.dataset.codexppTweaksDirectoryDetailNav;
  for (const button of [
    state.nativeButtons && state.nativeButtons[0],
    state.nativeButtons && state.nativeButtons[1],
    state.tab,
  ]) {
    if (!button || !button.style || !button.dataset) continue;
    if (button.dataset.codexppTweaksDirectoryDetailDisplay !== undefined) {
      button.style.display = button.dataset.codexppTweaksDirectoryDetailDisplay;
      delete button.dataset.codexppTweaksDirectoryDetailDisplay;
    }
  }
}

function detailCrumb(text, active, onClick) {
  const crumb = document.createElement(onClick ? "button" : "span");
  crumb.className = active ? "codexpp-td-detail-crumb active" : "codexpp-td-detail-crumb";
  crumb.dataset.slot = active ? "breadcrumb-page" : "breadcrumb-link";
  crumb.textContent = text;
  if (onClick) {
    crumb.type = "button";
    crumb.addEventListener("click", onClick);
  }
  return crumb;
}

function detailChevron() {
  const el = document.createElement("span");
  el.className = "codexpp-td-detail-chevron";
  el.dataset.slot = "breadcrumb-separator";
  el.textContent = "›";
  return el;
}

function detailSectionTitle(text) {
  const heading = document.createElement("h2");
  heading.className = "codexpp-td-detail-section-title";
  heading.dataset.slot = "card-title";
  heading.textContent = text;
  return heading;
}

function detailRow(label, value) {
  const row = document.createElement("div");
  row.className = "codexpp-td-detail-row";
  row.dataset.slot = "table-row";
  const left = document.createElement("div");
  left.className = "codexpp-td-detail-row-label";
  left.textContent = label;
  const right = document.createElement("div");
  right.className = "codexpp-td-detail-row-value";
  right.textContent = value || "Unknown";
  row.append(left, right);
  return row;
}

function detailIncludeItem(state, row, title, type, description) {
  const item = document.createElement("div");
  item.className = "codexpp-td-detail-include-item";
  item.dataset.slot = "list-item";
  item.appendChild(avatar(state, row));
  const body = document.createElement("div");
  body.className = "codexpp-td-detail-include-body";
  const heading = document.createElement("div");
  heading.className = "codexpp-td-detail-include-title";
  const name = document.createElement("strong");
  name.textContent = title;
  const label = document.createElement("span");
  label.textContent = type;
  heading.append(name, label);
  body.appendChild(heading);
  if (description) {
    const text = document.createElement("p");
    text.textContent = truncateDescription(description);
    body.appendChild(text);
  }
  item.appendChild(body);
  return item;
}

function promptIcon(state, row) {
  const wrap = document.createElement("span");
  wrap.className = "codexpp-td-detail-prompt-icon";
  wrap.dataset.slot = "button-icon";
  wrap.appendChild(avatar(state, row));
  return wrap;
}

function statusText(row, hasUpdate) {
  if (hasUpdate) return "Installed with an approved update available.";
  if (row.installed) return row.installed.enabled ? "Installed and enabled." : "Installed, currently disabled.";
  return "Available in the tweak store.";
}

function authorText(author) {
  if (!author) return "";
  if (typeof author === "string") return author;
  return author.name || "";
}

function syncDetailFromLocation(state, clearWhenMissing) {
  const id = readDetailFromLocation();
  if (!id) {
    if (clearWhenMissing) state.detailRowKey = null;
    return;
  }
  const row = visibleRows(state).find((item) => rowKey(item) === id);
  if (row) state.detailRowKey = rowKey(row);
}

function readDetailFromLocation() {
  const href = location && typeof location.href === "string" ? location.href : "";
  const search = location && typeof location.search === "string" ? location.search : "";
  const hash = location && typeof location.hash === "string" ? location.hash : "";
  try {
    const url = new URL(href || `https://codex.local/${search || ""}${hash || ""}`);
    return cleanDetailId(url.searchParams.get("codexpp-tweak") || url.searchParams.get("tweak") || detailIdFromHash(url.hash));
  } catch {
    return cleanDetailId(detailIdFromHash(hash));
  }
}

function detailIdFromHash(hash) {
  const value = String(hash || "");
  const match = value.match(/(?:^#|[&#])(?:codexpp-tweak|tweak)=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function cleanDetailId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{1,160}$/i.test(id) ? id : "";
}

function writeDetailToLocation(id) {
  const win = getWindow();
  const history = win && win.history;
  if (!history || typeof history.pushState !== "function") return;
  try {
    const url = new URL(location && location.href ? location.href : "https://codex.local/");
    if (id) url.searchParams.set("codexpp-tweak", id);
    else {
      url.searchParams.delete("codexpp-tweak");
      url.searchParams.delete("tweak");
    }
    // Tag entries we own with state.codexpp so onNav can short-circuit
    // and we don't pingpong against Codex's own pushState handlers /
    // settings-injector route listeners.
    history.pushState({ codexpp: true }, "", url.toString());
  } catch {
    // Deep links are a convenience; never block the directory UI if URL state is unavailable.
  }
}

async function copyDetailLink(state, id) {
  const href = detailLinkFor(id);
  const win = getWindow();
  const nav = win && win.navigator ? win.navigator : typeof navigator !== "undefined" ? navigator : null;
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      await nav.clipboard.writeText(href);
      state.status = "Copied tweak detail link.";
    } else {
      state.status = href;
    }
  } catch {
    state.status = href;
  }
  render(state);
}

function detailLinkFor(id) {
  try {
    const url = new URL(location && location.href ? location.href : "https://codex.local/");
    url.searchParams.set("codexpp-tweak", id || "");
    return url.toString();
  } catch {
    return `?codexpp-tweak=${encodeURIComponent(id || "")}`;
  }
}

function primaryDirectoryAction(state, row) {
  const hasUpdate = row.store && row.installed && row.store.manifest.version !== row.installed.manifest.version;
  if (hasUpdate) return directoryIconButton("+", "Update", () => installStoreEntry(state, row.store.id), "primary");
  if (row.store && !row.installed) return directoryIconButton("+", "Install", () => installStoreEntry(state, row.store.id), "primary");
  if (row.installed && row.installed.enabled) return directoryIconButton("✓", "Installed", () => undefined, "status");
  if (row.installed) return directoryIconButton("+", "Enable", () => setEnabled(state, row.installed.manifest.id, true), "primary");
  return directoryIconButton("+", "Install", () => undefined, "primary");
}

function truncateDescription(value) {
  const text = compactText(value);
  return text.length > 96 ? text.slice(0, 93) + "..." : text;
}

function isOwnNamespace(id) {
  if (typeof id !== "string") return false;
  return /^co\.thomashulihan\./.test(id) || /^co\.hulibrands\./.test(id);
}

function showForkCommandHint(state, subcommand, id) {
  const cmd = subcommand === "update-fork"
    ? "codex-plusplus update-fork " + id
    : "codex-plusplus fork-tweak " + id;
  state.status = subcommand === "update-fork"
    ? "Run in your terminal: " + cmd + " — this pulls upstream into your fork via 3-way merge."
    : "Run in your terminal: " + cmd + " — this clones the tweak under co.thomashulihan.* and tracks the upstream commit for future merges.";
  render(state);
}

function firstPageForTweak(state, tweakId) {
  if (!state.api.codex || typeof state.api.codex.listRegisteredTweakPages !== "function") return null;
  return state.api.codex.listRegisteredTweakPages().find((page) => page.tweakId === tweakId) || null;
}

function openTweakSettingsPage(state, page) {
  if (!state.api.codex || typeof state.api.codex.openRegisteredTweakPage !== "function") {
    state.status = "This ShadGPT runtime cannot open tweak settings pages from the Plugins directory.";
    render(state);
    return false;
  }
  if (!isSettingsSurfaceAvailable()) {
    state.status = `Open Codex Settings to configure ${page.title || "this tweak"}. The Plugins directory cannot host that settings page directly.`;
    render(state);
    return false;
  }
  const opened = state.api.codex.openRegisteredTweakPage(page.id);
  if (!opened) {
    state.status = `Open Codex Settings to configure ${page.title || "this tweak"}. The Plugins directory could not host that settings page.`;
    render(state);
  }
  return opened;
}

function isSettingsSurfaceAvailable() {
  const sidebar = document.querySelector("[data-codexpp-settings-sidebar='true']");
  if (!sidebar) return false;
  if (typeof sidebar.getBoundingClientRect !== "function") return true;
  const rect = sidebar.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function setEnabled(state, id, enabled) {
  await state.api.ipc.invoke(CHANNELS.setEnabled, id, enabled);
  await loadData(state, true);
}

async function reloadInstalledTweaks(state) {
  state.status = "Reloading installed tweaks...";
  render(state);
  try {
    await state.api.ipc.invoke(CHANNELS.reload);
    location.reload();
  } catch (error) {
    state.status = `Could not reload installed tweaks: ${errorMessage(error)}`;
    render(state);
  }
}

async function installStoreEntry(state, id) {
  await state.api.ipc.invoke(CHANNELS.installStoreTweak, id);
  await loadData(state, true);
}

async function publishTweak(state) {
  const repo = prompt("GitHub repository to submit, for example owner/repo");
  if (!repo) return;
  const submission = await state.api.ipc.invoke(CHANNELS.prepareStoreSubmission, repo);
  const url = buildPublishIssueUrl(submission);
  await state.api.ipc.invoke(CHANNELS.openExternal, url);
}

function buildPublishIssueUrl(submission) {
  const title = `Tweak store review: ${submission.repo}`;
  const body = [
    "## Tweak repo",
    `https://github.com/${submission.repo}`,
    "",
    "## Commit to review",
    submission.commitSha,
    submission.commitUrl,
    "",
    "Do not approve a different commit. If the author pushes changes, ask them to resubmit.",
    "",
    "## Manifest",
    `- id: ${submission.manifest && submission.manifest.id || "(not detected)"}`,
    `- name: ${submission.manifest && submission.manifest.name || "(not detected)"}`,
    `- version: ${submission.manifest && submission.manifest.version || "(not detected)"}`,
    `- description: ${submission.manifest && submission.manifest.description || "(not detected)"}`,
    `- iconUrl: ${submission.manifest && submission.manifest.iconUrl || "(not detected)"}`,
  ].join("\n");
  const url = new URL("https://github.com/hulibrands/codex-plusplus/issues/new");
  url.searchParams.set("template", "tweak-store-review.md");
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  return url.toString();
}

function avatar(state, row) {
  const el = document.createElement("div");
  el.className = "codexpp-td-avatar";
  el.dataset.slot = "avatar";
  const manifest = row.manifest || {};
  el.textContent = (manifest.name || manifest.id || "?").slice(0, 1).toUpperCase();
  const iconUrl = manifestIconUrl(row);
  if (!iconUrl) return el;

  const img = document.createElement("img");
  img.dataset.slot = "avatar-image";
  img.alt = "";
  img.style.display = "none";
  img.addEventListener("load", () => {
    el.textContent = "";
    img.style.display = "";
    el.appendChild(img);
  });
  img.addEventListener("error", () => img.remove());
  if (iconUrl.kind === "direct") {
    img.src = iconUrl.url;
  } else {
    void state.api.ipc.invoke(CHANNELS.readIconAsset, row.manifest.id, iconUrl.rel).then((url) => {
      if (typeof url === "string" && url) img.src = url;
      else img.remove();
    }).catch(() => img.remove());
  }
  el.appendChild(img);
  return el;
}

function manifestIconUrl(row) {
  const iconUrl = row && row.manifest && typeof row.manifest.iconUrl === "string"
    ? row.manifest.iconUrl.trim()
    : "";
  if (!iconUrl) return null;
  if (/^(https?:|data:)/i.test(iconUrl)) return { kind: "direct", url: iconUrl };
  const rel = iconUrl.replace(/^\.?\//, "");
  if (!rel || rel.startsWith("../")) return null;
  if (row.installed) return { kind: "installed", rel };
  if (row.store && row.store.repo && row.store.approvedCommitSha) {
    return {
      kind: "direct",
      url: `https://raw.githubusercontent.com/${row.store.repo}/${row.store.approvedCommitSha}/${rel}`,
    };
  }
  return null;
}

function button(label, onClick, variant) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.dataset.slot = "button";
  el.className =
    variant === "primary" ? "codexpp-td-button primary" :
    variant === "destructive" ? "codexpp-td-button destructive" :
    "codexpp-td-button";
  el.addEventListener("click", async () => {
    el.disabled = true;
    try {
      await onClick();
    } finally {
      el.disabled = false;
    }
  });
  return el;
}

function directoryIconButton(label, title, onClick, variant) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.dataset.slot = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.className =
    variant === "primary" ? "codexpp-td-directory-action primary" :
    variant === "status" ? "codexpp-td-directory-action status" :
    "codexpp-td-directory-action";
  el.addEventListener("click", async () => {
    el.disabled = true;
    try {
      await onClick();
    } finally {
      el.disabled = false;
    }
  });
  return el;
}

function iconButton(label, title, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.dataset.slot = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.className = "codexpp-td-icon-button";
  el.addEventListener("click", onClick);
  return el;
}

function directoryActions(state) {
  const wrap = document.createElement("div");
  wrap.className = "codexpp-td-directory-actions";
  wrap.dataset.slot = "button-group";
  wrap.appendChild(button("Refresh", () => loadData(state, true)));
  wrap.appendChild(button("Open Folder", () => state.api.ipc.invoke(CHANNELS.revealTweaksFolder)));
  wrap.appendChild(button("Force Reload", () => state.api.ipc.invoke(CHANNELS.reload).finally(() => location.reload())));
  wrap.appendChild(button("Publish Tweak", () => publishTweak(state)));
  return wrap;
}

function installRescueButton(state) {
  if (state.rescueButton && state.rescueButton.isConnected) return;
  const rescue = document.createElement("button");
  rescue.type = "button";
  rescue.textContent = "Disable Tweaks Directory";
  rescue.className = "codexpp-td-rescue";
  rescue.dataset.slot = "button";
  rescue.hidden = true;
  rescue.addEventListener("click", () => disableSelf(state));
  document.body.appendChild(rescue);
  state.rescueButton = rescue;
}

function showRescueButton(state) {
  if (!state.rescueButton) installRescueButton(state);
  if (state.rescueButton) state.rescueButton.hidden = false;
}

function hideRescueButton(state) {
  if (state.rescueButton) {
    state.rescueButton.hidden = true;
    state.rescueButton.disabled = false;
    state.rescueButton.textContent = "Disable Tweaks Directory";
  }
}

function showErrorBanner(state, title, message) {
  if (!state.errorBanner || !state.errorBanner.isConnected) {
    const banner = document.createElement("div");
    banner.className = "codexpp-td-error-banner";
    banner.dataset.slot = "alert";
    banner.setAttribute("role", "alert");
    const body = document.createElement("div");
    body.className = "codexpp-td-error-banner-body";
    const heading = document.createElement("strong");
    const detail = document.createElement("p");
    body.append(heading, detail);
    const actions = document.createElement("div");
    actions.className = "codexpp-td-error-banner-actions";
    actions.dataset.slot = "button-group";
    actions.appendChild(button("Disable", () => disableSelf(state), "destructive"));
    actions.appendChild(button("Reload", () => location.reload()));
    banner.append(body, actions);
    document.body.appendChild(banner);
    state.errorBanner = banner;
  }
  const heading = state.errorBanner.querySelector("strong");
  const detail = state.errorBanner.querySelector("p");
  if (heading) heading.textContent = title;
  if (detail) detail.textContent = message || "The injected Tweaks Directory UI failed before it could finish rendering.";
  state.errorBanner.hidden = false;
  showRescueButton(state);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

async function disableSelf(state) {
  showRescueButton(state);
  if (state.rescueButton) {
    state.rescueButton.disabled = true;
    state.rescueButton.textContent = "Disabling Tweaks Directory...";
  }
  try {
    await state.api.ipc.invoke(CHANNELS.setEnabled, TWEAK_ID, false);
    await state.api.ipc.invoke(CHANNELS.reload);
    location.reload();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    state.status = `Could not disable Tweaks Directory: ${message}`;
    state.api.log.error(state.status);
    if (state.rescueButton) {
      state.rescueButton.disabled = false;
      state.rescueButton.textContent = "Disable Tweaks Directory";
    }
    render(state);
  }
}

function messageCard(title, message) {
  const card = document.createElement("div");
  card.className = "codexpp-td-message";
  card.dataset.slot = "alert";
  const h = document.createElement("strong");
  h.dataset.slot = "alert-title";
  h.textContent = title;
  const p = document.createElement("p");
  p.dataset.slot = "alert-description";
  p.textContent = message;
  card.append(h, p);
  return card;
}

function textSpan(value) {
  const span = document.createElement("span");
  span.dataset.slot = "text";
  span.textContent = value;
  return span;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function injectStyles() {
  let style = document.getElementById("codexpp-tweaks-directory-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "codexpp-tweaks-directory-style";
    document.head.appendChild(style);
  }
  style.textContent = `
    [data-codexpp-tweaks-directory-tab-trigger="true"] {
      position: relative;
      overflow: visible;
      isolation: isolate;
    }
        [data-codexpp-tweaks-directory-tab-trigger="true"]:focus,
        [data-codexpp-tweaks-directory-tab-trigger="true"]:focus-visible {
          outline: none !important;
          box-shadow: inset 0 0 0 2px var(--text-primary, currentColor) !important;
        }
    [data-codexpp-tweaks-directory-tab-trigger="true"][data-state="active"],
    [data-codexpp-tweaks-directory-tab-trigger="true"][aria-selected="true"],
    [data-codexpp-tweaks-directory-tab-trigger="true"].codexpp-tweaks-directory-tab-active {
      background: var(--codexpp-td-background, var(--bg-primary, rgba(0,0,0,.04)));
      color: var(--codexpp-td-foreground, currentColor);
      box-shadow: inset 0 0 0 1px var(--border-light, rgba(0,0,0,.12));
    }
    [data-codexpp-tweaks-directory-detail-nav="true"] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .codexpp-td-native-breadcrumbs {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--codexpp-td-foreground, var(--text-primary, #111));
    }
    .codexpp-native-plugin-status-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 68px;
      max-width: 92px;
      min-height: 24px;
      margin: 8px 0 0;
      white-space: nowrap;
      pointer-events: none;
      border: 1px solid color-mix(in srgb, var(--border, rgba(0,0,0,.16)) 80%, transparent);
      border-radius: 7px;
      padding: 2px 8px;
      background: var(--bg-primary, var(--background, #fff));
      color: var(--text-secondary, var(--muted-foreground, rgba(0,0,0,.58)));
      font: inherit;
      font-size: 12px;
      line-height: 1.2;
      font-weight: 550;
      letter-spacing: 0;
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .codexpp-tweaks-directory, .codexpp-tweaks-directory *, .codexpp-td-native-plugin-files, .codexpp-td-native-plugin-files * { box-sizing: border-box; }
    .codexpp-tweaks-directory, .codexpp-td-native-plugin-files {
      --codexpp-td-background: var(--background, var(--bg-primary, #fff));
      --codexpp-td-foreground: var(--foreground, var(--text-primary, #111));
      --codexpp-td-muted: var(--muted-foreground, var(--text-secondary, rgba(0,0,0,.54)));
      --codexpp-td-border: var(--border, var(--border-light, rgba(0,0,0,.12)));
      --codexpp-td-muted-bg: var(--muted, rgba(0,0,0,.035));
      --codexpp-td-ring: var(--ring, var(--codexpp-shadcn-ui-accent, #2563eb));
    }
    .codexpp-tweaks-directory {
      width: 100%;
      max-width: min(704px, calc(100% - 96px));
      max-height: none;
      margin: 58px auto 32px;
      padding: 0 1px 42px;
      color: var(--codexpp-td-foreground);
      font-size: 14px;
      line-height: 1.35;
      overflow: visible;
      overscroll-behavior: auto;
    }
    .codexpp-tweaks-directory.codexpp-td-detail-mode {
      max-width: calc(100% - 80px);
      margin: 18px 40px 32px;
      padding-bottom: 42px;
    }
    .codexpp-tweaks-directory-floating { position: fixed; z-index: 2147483600; top: 72px; right: 24px; bottom: 24px; left: clamp(320px, 36vw, 620px); width: auto; max-width: none; margin: 0; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--codexpp-td-border); border-radius: 8px; padding: 24px; background: var(--codexpp-td-background); color: var(--codexpp-td-foreground); box-shadow: 0 18px 60px rgba(0,0,0,.18); }
    .codexpp-td-header { display: flex; flex-direction: column; gap: 30px; align-items: stretch; }
    .codexpp-td-header h1 { margin: 0; max-width: 100%; text-align: center; font-size: 30px; line-height: 1.18; font-weight: 400; letter-spacing: 0; overflow-wrap: anywhere; }
    .codexpp-td-toolbar { width: 100%; display: flex; gap: 8px; justify-content: center; align-items: center; }
    .codexpp-td-search { flex: 1 1 auto; min-width: 0; max-width: none; height: 28px; border: 1px solid var(--codexpp-td-border); border-radius: 8px; padding: 0 12px; background: var(--codexpp-td-background); color: inherit; font: inherit; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,.03) inset; }
    .codexpp-td-search::placeholder { color: color-mix(in srgb, var(--codexpp-td-muted) 82%, transparent); }
    .codexpp-td-search:focus-visible,
    .codexpp-td-filter-select:focus-within,
    .codexpp-td-button:focus-visible,
    .codexpp-td-directory-action:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--codexpp-td-ring) 28%, transparent);
      border-color: color-mix(in srgb, var(--codexpp-td-ring) 44%, var(--codexpp-td-border));
    }
    .codexpp-td-filter-select { flex: 0 0 auto; height: 28px; min-width: 96px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--codexpp-td-border); border-radius: 8px; padding: 0 8px 0 10px; background: var(--codexpp-td-muted-bg); color: var(--codexpp-td-foreground); }
    .codexpp-td-filter-select select { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 14px; outline: none; cursor: pointer; }
    .codexpp-td-filter-select span { font-size: 14px; line-height: 1; color: var(--codexpp-td-muted); pointer-events: none; }
    .codexpp-td-button { min-width: 0; max-width: 100%; min-height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--codexpp-td-border); border-radius: 8px; padding: 4px 10px; background: var(--codexpp-td-background); color: inherit; font: inherit; font-size: 13px; cursor: pointer; white-space: normal; }
    .codexpp-td-button.primary { background: var(--primary, var(--codexpp-td-foreground)); color: var(--primary-foreground, var(--codexpp-td-background)); }
    .codexpp-td-button.destructive { border-color: color-mix(in srgb, var(--destructive, #dc2626) 30%, var(--codexpp-td-border)); color: var(--destructive, rgb(185,28,28)); }
    .codexpp-td-rescue { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; min-height: 34px; max-width: min(260px, calc(100vw - 32px)); border: 1px solid rgba(220,38,38,.26); border-radius: 9px; padding: 7px 12px; background: var(--bg-primary, #fff); color: rgb(185,28,28); font: inherit; box-shadow: 0 8px 28px rgba(0,0,0,.18); cursor: pointer; }
    .codexpp-td-rescue[hidden] { display: none !important; }
    .codexpp-td-error-banner { position: fixed; right: 16px; top: 16px; z-index: 2147483647; width: min(420px, calc(100vw - 32px)); display: flex; align-items: flex-start; gap: 12px; border: 1px solid rgba(220,38,38,.26); border-radius: 10px; padding: 12px; background: var(--bg-primary, #fff); color: var(--text-primary, #111); box-shadow: 0 10px 34px rgba(0,0,0,.18); }
    .codexpp-td-error-banner[hidden] { display: none !important; }
    .codexpp-td-error-banner-body { min-width: 0; flex: 1 1 auto; }
    .codexpp-td-error-banner-body strong { color: rgb(185,28,28); font-weight: 600; }
    .codexpp-td-error-banner-body p { margin: 3px 0 0; color: var(--text-secondary, rgba(0,0,0,.58)); font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    .codexpp-td-error-banner-actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .codexpp-td-list { margin: 18px auto 0; width: 100%; display: flex; flex-direction: column; gap: 28px; }
    .codexpp-td-section { border-bottom: 1px solid var(--codexpp-td-border); padding-bottom: 9px; }
    .codexpp-td-section h2 { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 400; letter-spacing: 0; }
    .codexpp-td-grid { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 34px; row-gap: 22px; }
    .codexpp-td-item { min-width: 0; min-height: 40px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: 8px; cursor: pointer; }
    .codexpp-td-item:hover { background: var(--codexpp-td-muted-bg); }
    .codexpp-td-item-left { min-width: 0; display: flex; align-items: center; gap: 12px; }
    .codexpp-td-avatar { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--codexpp-td-border) 70%, transparent); background: linear-gradient(135deg, #ffb04f 0%, #ff7d55 42%, #8b5cf6 43%, #8b5cf6 100%); color: #fff; font-weight: 700; font-size: 12px; }
    .codexpp-td-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .codexpp-td-item-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .codexpp-td-item-title { min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 14px; line-height: 1.2; font-weight: 650; letter-spacing: 0; }
    .codexpp-td-item-title span:first-child { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .codexpp-td-item p, .codexpp-td-meta { margin: 0; color: var(--codexpp-td-muted); font-size: 13px; line-height: 1.25; }
    .codexpp-td-item p { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .codexpp-td-meta { font-size: 12px; }
    .codexpp-td-item-actions { min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--codexpp-td-muted); }
    .codexpp-td-directory-action { flex: 0 0 auto; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--codexpp-td-border); border-radius: 8px; background: var(--codexpp-td-muted-bg); color: var(--codexpp-td-foreground); font: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
    .codexpp-td-directory-action.status { border: 0; background: transparent; color: color-mix(in srgb, var(--codexpp-td-muted) 78%, transparent); font-size: 18px; }
    .codexpp-td-directory-action.primary { background: var(--codexpp-td-muted-bg); color: var(--codexpp-td-foreground); }
    .codexpp-td-directory-action:disabled { opacity: .48; cursor: default; }
    .codexpp-td-directory-actions { margin: 42px auto 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; color: var(--codexpp-td-muted); }
    .codexpp-td-directory-actions .codexpp-td-button { width: auto; min-width: 0; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; border-radius: 8px; font-size: 13px; color: inherit; white-space: nowrap; }
    .codexpp-td-message { width: 100%; max-width: 704px; margin: 18px auto 0; border: 1px solid var(--codexpp-td-border); border-radius: 8px; padding: 12px 14px; }
    .codexpp-td-message p { margin: 4px 0 0; color: var(--codexpp-td-muted); }
    .codexpp-td-icon-button { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--codexpp-td-border); border-radius: 8px; background: var(--codexpp-td-background); color: inherit; font: inherit; cursor: pointer; }
    .codexpp-td-detail-header { display: flex; justify-content: flex-end; align-items: center; gap: 10px; min-height: 34px; margin: 0; width: 100%; }
    .codexpp-td-detail-actions { min-width: 0; display: flex; align-items: center; gap: 6px; }
    .codexpp-td-detail-actions { justify-content: flex-end; flex-wrap: nowrap; }
    .codexpp-td-detail-actions .codexpp-td-button { min-height: 30px; white-space: nowrap; }
    .codexpp-td-detail-menu-wrap { position: relative; flex: 0 0 auto; }
    .codexpp-td-detail-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 4; width: 190px; display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--codexpp-td-border); border-radius: 8px; padding: 5px; background: var(--popover, var(--codexpp-td-background)); color: var(--popover-foreground, inherit); box-shadow: 0 10px 32px rgba(0,0,0,.14); }
    .codexpp-td-detail-menu-item { width: 100%; min-height: 30px; border: 0; border-radius: 6px; padding: 5px 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .codexpp-td-detail-menu-item:hover,
    .codexpp-td-detail-menu-item:focus-visible { outline: none; background: var(--codexpp-td-muted-bg); }
    .codexpp-td-detail-menu-item:disabled { opacity: .52; cursor: default; }
    .codexpp-td-detail-crumb { min-width: 0; max-width: 220px; height: 30px; display: inline-flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid transparent; border-radius: 8px; padding: 0 9px; background: transparent; color: var(--codexpp-td-muted); font: inherit; font-size: 14px; }
    button.codexpp-td-detail-crumb { cursor: pointer; }
    button.codexpp-td-detail-crumb:hover,
    button.codexpp-td-detail-crumb:focus-visible { outline: none; background: var(--codexpp-td-muted-bg); color: var(--codexpp-td-foreground); }
    .codexpp-td-detail-crumb.active { color: var(--codexpp-td-foreground); background: var(--codexpp-td-muted-bg); border-color: var(--codexpp-td-border); }
    .codexpp-td-detail-chevron { color: var(--codexpp-td-muted); }
    .codexpp-td-detail-main { width: min(836px, 100%); margin: 54px auto 0; }
    .codexpp-td-detail-hero { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 10px; }
    .codexpp-td-detail-hero .codexpp-td-avatar { width: 54px; height: 54px; border-radius: 12px; font-size: 17px; }
    .codexpp-td-detail-hero h1 { margin: 18px 0 0; font-size: 26px; line-height: 1.2; font-weight: 650; letter-spacing: 0; overflow-wrap: anywhere; }
    .codexpp-td-detail-hero p { max-width: 760px; margin: 0; color: var(--codexpp-td-muted); font-size: 19px; line-height: 1.35; }
    .codexpp-td-detail-prompt { max-width: min(590px, 100%); display: flex; align-items: center; gap: 6px; margin: 92px auto 74px; border: 1px solid var(--codexpp-td-border); border-radius: 12px; padding: 11px 16px; background: var(--codexpp-td-background); color: inherit; font: inherit; font-size: 16px; line-height: 1.35; text-align: left; cursor: pointer; }
    .codexpp-td-detail-prompt-icon { flex: 0 0 auto; display: inline-grid; place-items: center; }
    .codexpp-td-detail-prompt-icon .codexpp-td-avatar { width: 16px; height: 16px; border-radius: 4px; font-size: 9px; }
    .codexpp-td-detail-overview { max-width: 760px; margin: 0 0 58px; font-size: 17px; line-height: 1.45; color: var(--codexpp-td-foreground); }
    .codexpp-td-detail-section { margin-top: 36px; }
    .codexpp-td-detail-section-title { margin: 0 0 10px; font-size: 15px; line-height: 1.3; font-weight: 650; letter-spacing: 0; }
    .codexpp-td-detail-card { overflow: hidden; border: 1px solid var(--codexpp-td-border); border-radius: 8px; background: var(--codexpp-td-background); }
    .codexpp-td-files-header { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; margin-bottom: 10px; }
    .codexpp-td-files-header .codexpp-td-detail-section-title { margin: 0; }
    .codexpp-td-files-source { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--codexpp-td-muted); font-size: 12px; }
    .codexpp-td-files-refresh { flex: 0 0 auto; }
    .codexpp-td-files-card { padding: 6px; }
    .codexpp-td-file-tree { width: 100%; display: flex; flex-direction: column; gap: 1px; }
    .codexpp-td-file-tree-item { min-width: 0; }
    .codexpp-td-file-tree-children { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .codexpp-td-file-tree-row { min-width: 0; min-height: 30px; display: grid; grid-template-columns: 14px 18px minmax(0, 1fr) auto; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 6px; padding: 4px 8px 4px calc(8px + (var(--codexpp-td-file-depth, 0) * 18px)); color: var(--codexpp-td-foreground); cursor: pointer; }
    .codexpp-td-file-tree-row:hover,
    .codexpp-td-file-tree-row:focus-visible { outline: none; background: var(--codexpp-td-muted-bg); border-color: color-mix(in srgb, var(--codexpp-td-border) 70%, transparent); }
    .codexpp-td-file-tree-row.selected { background: color-mix(in srgb, var(--codexpp-td-ring) 12%, transparent); border-color: color-mix(in srgb, var(--codexpp-td-ring) 36%, var(--codexpp-td-border)); }
    .codexpp-td-file-tree-row.omitted { color: color-mix(in srgb, var(--codexpp-td-muted) 88%, var(--codexpp-td-foreground)); cursor: default; }
    .codexpp-td-file-tree-disclosure,
    .codexpp-td-file-tree-icon { display: inline-grid; place-items: center; color: var(--codexpp-td-muted); font-size: 12px; line-height: 1; }
    .codexpp-td-file-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 1.25; }
    .codexpp-td-file-tree-meta { min-width: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--codexpp-td-muted); font-size: 12px; }
    .codexpp-td-file-tree-message { padding: 10px 12px; }
    .codexpp-td-file-tree-message p { margin: 3px 0 0; color: var(--codexpp-td-muted); }
    .codexpp-td-detail-include-item { min-height: 64px; display: grid; grid-template-columns: 42px minmax(0, 1fr); align-items: center; gap: 14px; padding: 10px 14px; }
    .codexpp-td-detail-include-item + .codexpp-td-detail-include-item { border-top: 1px solid color-mix(in srgb, var(--codexpp-td-border) 62%, transparent); }
    .codexpp-td-detail-include-item .codexpp-td-avatar { width: 34px; height: 34px; border-radius: 999px; background: var(--codexpp-td-background); color: var(--codexpp-td-muted); }
    .codexpp-td-detail-include-body { min-width: 0; }
    .codexpp-td-detail-include-title { min-width: 0; display: flex; align-items: baseline; gap: 7px; }
    .codexpp-td-detail-include-title strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; line-height: 1.25; }
    .codexpp-td-detail-include-title span { color: var(--codexpp-td-muted); font-size: 14px; }
    .codexpp-td-detail-include-body p { margin: 4px 0 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--codexpp-td-muted); font-size: 14px; }
    .codexpp-td-detail-row { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 16px; padding: 13px 16px; border-top: 1px solid var(--codexpp-td-border); }
    .codexpp-td-detail-row:first-child { border-top: 0; }
    .codexpp-td-detail-row-label { color: var(--codexpp-td-muted); }
    .codexpp-td-detail-row-value { min-width: 0; overflow-wrap: anywhere; }
    @media (max-width: 980px) {
      .codexpp-tweaks-directory { max-width: calc(100% - 40px); margin-top: 48px; }
      .codexpp-td-header h1 { font-size: 28px; }
      .codexpp-td-grid { grid-template-columns: 1fr; row-gap: 34px; }
      .codexpp-td-item { padding: 0 10px; }
    }
    @media (max-width: 760px) {
      .codexpp-tweaks-directory { max-width: calc(100% - 20px); margin-top: 20px; }
      .codexpp-tweaks-directory-floating { inset: 62px 10px 10px 10px; padding: 18px; }
      .codexpp-td-header { gap: 22px; }
      .codexpp-td-header h1 { font-size: 26px; }
      .codexpp-td-toolbar { gap: 8px; }
      .codexpp-td-section h2 { font-size: 17px; }
      .codexpp-td-item { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .codexpp-td-item-left { gap: 12px; align-items: flex-start; }
      .codexpp-td-item-actions { justify-content: flex-start; padding-left: 44px; }
      .codexpp-td-detail-header { grid-template-columns: 1fr; }
      .codexpp-td-detail-actions { justify-content: flex-start; flex-wrap: wrap; }
      .codexpp-td-detail-row { grid-template-columns: 1fr; gap: 4px; }
      .codexpp-td-files-header { grid-template-columns: 1fr; align-items: start; }
      .codexpp-td-files-source { white-space: normal; }
      .codexpp-td-file-tree-row { grid-template-columns: 14px 18px minmax(0, 1fr); }
      .codexpp-td-file-tree-meta { grid-column: 3; max-width: 100%; }
    }
  `;
}
