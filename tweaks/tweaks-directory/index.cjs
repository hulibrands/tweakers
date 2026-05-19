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
};

const STORE_FILTERS = [
  { key: "all", label: "All" },
  { key: "installed", label: "Installed" },
  { key: "store", label: "Store" },
  { key: "updates", label: "Updates" },
];

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
  };

  injectStyles();
  installRescueButton(state);
  scanForMount(state);
  state.observer = new MutationObserver(() => {
    mountWhenReady(state);
    // If the directory subtree was torn down (user navigated away via
    // sidebar / hotkey / pushState), our captured `state.root` becomes
    // disconnected. Restore any nodes we hid before React recycles them
    // for the next route's scroll wrappers.
    if (state.active && shouldAutoDeactivate(state)) {
      state.api.log.info("Tweaks Directory auto-deactivate: directory subtree gone");
      deactivate(state);
    }
  });
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
  installMountRescans(state);
  installRouteChangeListeners(state);

  return () => {
    state.observer && state.observer.disconnect();
    clearMountTimers(state);
    for (const cleanup of state.mountListeners) cleanup();
    deactivate(state);
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
  const onNav = () => {
    if (!state.active) return;
    if (shouldAutoDeactivate(state)) {
      state.api.log.info("Tweaks Directory deactivate on route change");
      deactivate(state);
      return;
    }
    syncDetailFromLocation(state, true);
    render(state);
  };
  for (const eventName of ["popstate", "hashchange", "codexpp-pushState", "codexpp-replaceState"]) {
    win.addEventListener(eventName, onNav);
    state.mountListeners.push(() => win.removeEventListener(eventName, onNav));
  }
}

function shouldAutoDeactivate(state) {
  if (!state.active) return false;
  if (!state.root || !state.root.isConnected) return true;
  if (state.tab && !state.tab.isConnected) return true;
  if (!isPluginsDirectorySurface(state.root)) return true;
  return false;
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
  mountWhenReady(state);
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
  const buttons = tabCandidates();
  const plugins = buttons.find((button) => compactText(button.textContent) === "Plugins");
  const skills = buttons.find((button) => compactText(button.textContent) === "Skills");
  if (!plugins || !skills) return null;
  const parent = commonTabParent(plugins, skills);
  if (!parent) return null;
  if (parent.querySelector("[data-codexpp-tweaks-directory-tab]")) return null;
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
  state.tab = tab;
  const livePair = resolveLivePair(pair, tab);
  state.nativeButtons = [livePair.plugins, livePair.skills];
  state.root = livePair.root || findDirectoryRoot(livePair.tabRow);
  ensurePanel(state, livePair.tabRow);
  if (state.floatingPanel) {
    state.api.log.warn("Tweaks Directory using floating fallback because the native Plugins root is unsafe", {
      root: describeForLog(state.root),
      tabRowParent: describeForLog(livePair && livePair.tabRow && livePair.tabRow.parentElement),
    });
  } else {
    hideNativeDirectoryContent(state, livePair.tabRow);
  }
  logHiddenNodes(state);
  logActivationContext(state, livePair);
  setTabVisualState(state, true);
  render(state);
  scrollPanelIntoView(state);
  loadData(state, false);
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
  // Fallback: prefer the tab row's parent over document.body. If that parent
  // is itself viewport-sized (i.e., we're really stuck), still return it but
  // the activation log will surface the bad rect for diagnosis.
  return tabRow.parentElement || document.body;
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
  let score = 0;
  if (text.includes("Make Codex work your way")) score += 4;
  if (hasNativeDirectorySearch(node)) score += 4;
  if (text.includes("Recommended") || text.includes("Featured")) score += 2;
  if (text.includes("PDF") || text.includes("Playwright") || text.includes("Computer Use")) score += 1;
  return score;
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
  if (rect.height < viewportH * 0.85 || Math.abs(rect.top) > 24) return false;
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
  if (state.panel && state.panel.isConnected) {
    state.panel.hidden = false;
    return;
  }
  const panel = document.createElement("section");
  panel.dataset.codexppTweaksDirectoryPanel = "true";
  panel.dataset.slot = "page";
  if (isUnsafeDirectoryRoot(state.root, tabRow)) {
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
  if (root && root.contains && root.contains(tabRow)) return tabRow;
  return null;
}

function isUnsafeDirectoryRoot(root, tabRow) {
  if (!root || root === document.body || root === document.documentElement) return true;
  if (isCompactDirectoryHeader(root, tabRow)) return true;
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
}

function isSafeDirectoryRoot(root) {
  if (!root || root === document.body || root === document.documentElement) return false;
  if (isViewportSized(root)) return false;
  if (isAppContentColumn(root)) return false;
  if (looksLikeAppSidebar(root)) return false;
  return true;
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

function hideNativeRegistryNodes(state, tabRow) {
  const roots = [state.root].filter(Boolean);
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
    for (const node of Array.from(root.querySelectorAll(selectors))) {
      if (seen.has(node)) continue;
      seen.add(node);
      if (shouldKeepNode(state, tabRow, node)) continue;
      if (!isNativePluginsRegistryNode(node)) continue;
      const target = nativeRegistryHideTarget(state, tabRow, node);
      if (target && !shouldKeepNode(state, tabRow, target)) hideNode(state, target);
    }
  }
}

function shouldKeepNode(state, tabRow, node) {
  if (!node) return true;
  if (node === tabRow || node === state.panel || node.dataset.codexppTweaksDirectoryTab === "true") return true;
  if (state.panel && state.panel.contains && state.panel.contains(node)) return true;
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
  if (text.includes("Read and manage Slack")) return true;
  if (text.includes("Read and manage Gmail")) return true;
  if (text.includes("Draft replies for every email")) return true;
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
  if (!text) return false;
  if (text.includes("New chat") || text.includes("Projects") || text.includes("Settings")) return false;
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
  const details = state.hiddenNodes.map((node) => describeNode(node)).join(" | ") || "(none)";
  state.api.log.info(`Tweaks Directory hidden native nodes: ${details}`);
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
    hiddenNodes: state.hiddenNodes.map((node) => ({
      description: describeNode(node),
      display: node.style.display || "",
      text: compactText(node.textContent || "").slice(0, 400),
    })),
    panelConnected: Boolean(state.panel && state.panel.isConnected),
    tabConnected: Boolean(state.tab && state.tab.isConnected),
  };
}

function setTabVisualState(state, active) {
  applyTweaksTabShell(state.tab);
  if (state.tab) {
    state.tab.setAttribute("aria-pressed", active ? "true" : "false");
    state.tab.classList.toggle("codexpp-tweaks-directory-tab-active", active);
    state.tab.dataset.state = active ? "active" : "inactive";
  }
  // Use a tab-row delegate (re-attached on every activation) instead of the
  // old `{once: true, capture: true}` listener per button — React may swap
  // the underlying button DOM nodes, which would lose a per-node listener
  // and leave our hidden-children pinned with `display:none` after the
  // user clicks Plugins / Skills.
  if (active) installTabRowDelegate(state);
}

async function loadData(state, forceStore) {
  if (!state.active) return;
  state.loading = true;
  render(state);
  try {
    const [installed, paths] = await Promise.all([
      state.api.ipc.invoke(CHANNELS.listInstalled),
      state.api.ipc.invoke(CHANNELS.getUserPaths).catch(() => null),
    ]);
    state.installed = Array.isArray(installed) ? installed : [];
    state.paths = paths;
    if (!state.store || forceStore) {
      state.store = await state.api.ipc.invoke(CHANNELS.getStore, Boolean(forceStore));
    }
    syncDetailFromLocation(state, false);
    state.status = "";
  } catch (error) {
    state.status = error && error.message ? error.message : String(error);
  } finally {
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
  const storeEntries = state.store && Array.isArray(state.store.entries) ? state.store.entries : [];
  const rows = [];

  for (const item of state.installed) {
    const storeEntry = storeEntries.find((entry) => entry.id === item.manifest.id) || null;
    rows.push({ type: "installed", installed: item, store: storeEntry, manifest: item.manifest });
  }

  for (const entry of storeEntries) {
    if (installedById.has(entry.id)) continue;
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
  headerActions.dataset.slot = "button-group";
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
    history.pushState(null, "", url.toString());
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
    state.status = "This Codex++ runtime cannot open tweak settings pages from the Plugins directory.";
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
    .codexpp-tweaks-directory, .codexpp-tweaks-directory * { box-sizing: border-box; }
    .codexpp-tweaks-directory {
      --codexpp-td-background: var(--background, var(--bg-primary, #fff));
      --codexpp-td-foreground: var(--foreground, var(--text-primary, #111));
      --codexpp-td-muted: var(--muted-foreground, var(--text-secondary, rgba(0,0,0,.54)));
      --codexpp-td-border: var(--border, var(--border-light, rgba(0,0,0,.12)));
      --codexpp-td-muted-bg: var(--muted, rgba(0,0,0,.035));
      --codexpp-td-ring: var(--ring, var(--codexpp-shadcn-ui-accent, #2563eb));
      width: 100%;
      max-width: min(704px, calc(100% - 96px));
      max-height: calc(100vh - 88px);
      margin: 58px auto 32px;
      padding: 0 1px 42px;
      color: var(--codexpp-td-foreground);
      font-size: 14px;
      line-height: 1.35;
      overflow: auto;
      overscroll-behavior: contain;
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
    }
  `;
}
