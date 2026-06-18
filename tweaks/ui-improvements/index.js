/**
 * Bennett's UI Improvements
 *
 * A bag of small, individually-toggleable UI tweaks for Codex. Settings
 * live on a dedicated sidebar entry under the "Tweaks" group.
 *
 * Features
 * --------
 *  • hide-upgrade-prompts  Hides the sidebar "Upgrade" pill and the
 *                          top-bar "Get Plus" button. Pure DOM filter,
 *                          fully reversible.
 *  • show-usage-in-sidebar (experimental) Renders a single usage box where
 *                          the upgrade pill was. Click toggles between
 *                          5h and Weekly; hover replaces content with
 *                          "Resets: HH:MM". Red when <15% remaining.
 *                          Sources data from Codex's authenticated
 *                          /wham/usage app-server endpoint.
 *  • square-sidebar        Flatten the rounded seam between sidebar and
 *                          main content panel.
 *  • match-sidebar-width   Force the settings page sidebar to match the
 *                          main UI sidebar's width, eliminating the
 *                          layout jump when opening/closing Settings.
 *  • sidebar-action-grid   Render the four main sidebar actions as a 2x2
 *                          grid of filled buttons.
 *  • sidebar-project-backgrounds  Add subtle grouped backgrounds behind
 *                                 project/session rows in the main sidebar.
 *  • sidebar-chat-multi-select  Cmd/Ctrl-click sidebar chats to select
 *                               multiple rows and run batch actions.
 *  • show-pinned-chat-project-names  Shows a small project name under
 *                                    pinned sidebar chats.
 *  • clarify-stale-chat-branch-label Rewords sidebar hover text that shows
 *                                    a historical chat branch.
 *  • show-message-metrics-on-hover  Shows Codex token metrics beside
 *                                   assistant messages on hover.
 *
 * Authoring notes
 * ---------------
 *  • Renderer + main; main reads local Codex session JSONL for metrics.
 *  • Each feature returns a `dispose()` so toggling off is clean.
 *  • Match-by-text-content for resilience: Codex's main shell has no
 *    stable testids/aria-labels for these widgets.
 */

const FEATURE_DEFS = Object.freeze([
  {
    id: "hide-upgrade-prompts",
    title: "Hide upgrade prompts",
    description:
      'Hide the "Upgrade" pill in the app sidebar and the "Get Plus" button in the top bar.',
  },
  {
    id: "show-usage-in-sidebar",
    title: "Show usage in sidebar (experimental)",
    description:
      "Render 5-hour and weekly rate limits where the upgrade button was. Open the rate-limits breakdown (account menu -> Rate limits) at least once to seed the values.",
  },
  {
    id: "show-message-metrics-on-hover",
    title: "Show message metrics on hover",
    description: "Show per-turn token usage beside assistant messages.",
  },
  {
    id: "square-sidebar",
    title: "Square sidebar corners",
    description:
      "Remove the rounded inner corners on the main content panel so it sits flush against the sidebar.",
  },
  {
    id: "match-sidebar-width",
    title: "Match settings sidebar width",
    description:
      "Stop the layout jump when opening Settings: the settings sidebar (fixed at 300px) is forced to match the main UI sidebar's current width.",
  },
  {
    id: "sidebar-action-grid",
    title: "Sidebar action grid",
    description:
      "Render New chat, Search, Plugins, and Automations as a compact 2x2 grid of filled buttons.",
  },
  {
    id: "sidebar-project-backgrounds",
    title: "Sidebar project backgrounds",
    description:
      "Add subtle grouped backgrounds behind project/session rows so adjacent work is easier to scan.",
  },
  {
    id: "sidebar-chat-multi-select",
    title: "Multi-select sidebar chats",
    description: "Cmd/Ctrl-click sidebar chats to select multiple rows, then right-click for batch actions.",
  },
  {
    id: "show-pinned-chat-project-names",
    title: "Show project label for pinned chats",
    description: "Show a smaller, subdued project label under pinned chats, and under all chats in chronological list mode.",
  },
  {
    id: "slash-menu-polish",
    title: "Slash menu polish",
    description: "Tighten slash menu rows with calmer section headers and clearer active state.",
  },
  {
    id: "tweak-mention-menu",
    title: "Tweak mention menu",
    description: "Type % in the composer to insert installed tweak mentions like %Projects.",
  },
  {
    id: "browser-annotation-transparent-card",
    title: "Browser annotation transparency",
    description:
      "Keep the annotated page visible behind the in-app browser comment editor while preserving saved-draft comments.",
  },
  {
    id: "clarify-stale-chat-branch-label",
    title: "Clarify stale chat branch labels",
    description: "Reword sidebar hover text so an old chat branch is shown as historical, not the active repo branch.",
  },
]);

const DEFAULT_FEATURE_FLAGS = Object.freeze({
  "hide-upgrade-prompts": true,
  "show-usage-in-sidebar": false,
  "show-message-metrics-on-hover": true,
  "square-sidebar": false,
  "match-sidebar-width": true,
  "sidebar-action-grid": true,
  "sidebar-project-backgrounds": true,
  "sidebar-chat-multi-select": true,
  "show-pinned-chat-project-names": true,
  "slash-menu-polish": false,
  "tweak-mention-menu": true,
  "browser-annotation-transparent-card": true,
  "clarify-stale-chat-branch-label": true,
});

const BRIDGE_EVENT = "codexpp-ui-improvements-setting-changed";
const COLOR_EVENT = "codexpp-ui-improvements-project-color-changed";
const PROJECT_COLOR_STORAGE_KEY = "sidebar-project-backgrounds:colors";
const PROJECT_OVERLAY_STORAGE_KEY = "sidebar-project-backgrounds:overlays";
const PROJECT_OVERLAY_OPTIONS = Object.freeze({
  off: { id: "off", label: "Off", light: 0, dark: 0, hoverLight: 10, hoverDark: 18 },
  subtle: { id: "subtle", label: "Subtle", light: 6, dark: 11, hoverLight: 14, hoverDark: 22 },
  medium: { id: "medium", label: "Medium", light: 10, dark: 18, hoverLight: 18, hoverDark: 26 },
  strong: { id: "strong", label: "Strong", light: 15, dark: 24, hoverLight: 24, hoverDark: 34 },
});
const DEFAULT_PROJECT_OVERLAY_INTENSITY = "medium";
const MAIN_BROWSER_ANNOTATION_COMPOSER_MODE_PATCH_KEY =
  "__codexpp_ui_improvements_browser_annotation_composer_mode_patch__";
const BROWSER_ANNOTATION_DEFAULT_MODE_TARGET = "defaultCreateSubmitMode:`direct`,session:";
const BROWSER_ANNOTATION_DEFAULT_MODE_REPLACEMENT = "defaultCreateSubmitMode:`saved`,session:";
const BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_TARGET =
  "s=i===void 0?`direct`:i,c=o===void 0?!0:o";
const BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_REPLACEMENT =
  "s=i===void 0?`saved`:i,c=o===void 0?!0:o";
const BROWSER_ANNOTATION_DEFAULT_MODE_REWRITES = Object.freeze([
  {
    target: BROWSER_ANNOTATION_DEFAULT_MODE_TARGET,
    replacement: BROWSER_ANNOTATION_DEFAULT_MODE_REPLACEMENT,
    reason: "legacy-direct-submit",
  },
  {
    target: BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_TARGET,
    replacement: BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_REPLACEMENT,
    reason: "thread-panel-direct-submit",
  },
]);
const SESSION_SCAN_LIMITS = Object.freeze({
  projectLabelActiveFiles: 600,
  projectLabelArchivedFiles: 80,
  projectLabelTotalFiles: 680,
  messageMetricsActiveFiles: 20,
  messageMetricsArchivedFiles: 4,
  messageMetricsTotalFiles: 24,
  messageMetricsMaxFileBytes: 12 * 1024 * 1024,
  messageMetricsTotalBytes: 24 * 1024 * 1024,
});

/** @type {import("@codex-plusplus/sdk").Tweak} */
module.exports = {
  start(api) {
    if (api.process === "main") {
      this._mainDisposes = [
        startMainLegacyBrandUiScrubber(api),
        startMainBrowserAnnotationComposerModePatch(api),
        startMainTweakMentionProvider(api),
        startMainMetricsProvider(api),
        startMainUsageProvider(api),
        startMainProjectLabelProvider(api),
        startMainSidebarBatchMenuProvider(api),
      ].filter(Boolean);
      return;
    }

    const state = {
      api,
      features: new Map(/* id -> { dispose } */),
      defaults: DEFAULT_FEATURE_FLAGS,
      bridgeDispose: null,
    };
    this._state = state;
    state.bridgeDispose = installShadcnBridge(state);
    state.legacyBrandDispose = startLegacyBrandUiScrubber(api);

    // ── settings page ──────────────────────────────────────────────────
    // We require `registerPage`. The older `register()` API would render
    // these toggles as a *nested section* inside ShadGPT's built-in
    // "Tweaks" page — that's misleading, since this tweak is supposed to
    // own its own sidebar entry. If the runtime is too old we just log
    // and skip the UI; the features themselves still activate below.
    if (typeof api.settings?.registerPage !== "function") {
      api.log.warn(
        "registerPage unavailable - ShadGPT runtime is too old. " +
          "Restart Codex to pick up the latest preload. Settings UI not mounted.",
      );
    } else {
      this._pageHandle = api.settings.registerPage({
        id: "main",
        title: "UI Improvements",
        description: "Bennett's small quality-of-life tweaks.",
        iconSvg:
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle" aria-hidden="true">' +
          '<path d="M4 6h12M4 10h8M4 14h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<circle cx="14" cy="10" r="1.6" fill="currentColor"/>' +
          "</svg>",
        render: (root) => renderSettings(root, state),
      });
    }

    // ── activate features per stored prefs ─────────────────────────────
    for (const id of Object.keys(state.defaults)) {
      const enabled = readFlag(api, id, state.defaults[id]);
      if (enabled) activateFeature(state, id);
    }
  },

  stop() {
    for (const dispose of this._mainDisposes || []) {
      try {
        dispose?.();
      } catch {
        // Best-effort cleanup for main-process hot reload hooks.
      }
    }
    this._mainDisposes = null;

    const s = this._state;
    if (!s) return;
    for (const [, f] of s.features) {
      try {
        f.dispose?.();
      } catch (e) {
        s.api.log.warn("dispose failed", e);
      }
    }
    s.features.clear();
    s.bridgeDispose?.();
    s.bridgeDispose = null;
    s.legacyBrandDispose?.();
    s.legacyBrandDispose = null;
    this._pageHandle?.unregister();
  },
};

// ─────────────────────────────────────────────────────────── settings UI ──

/**
 * Render the dedicated page. Mirrors Codex's standard form: one
 * `flex flex-col gap-2` section per group, rounded card with rows.
 */
function renderSettings(root, state) {
  root.replaceChildren();
  const section = el("section", "flex flex-col gap-2");
  section.appendChild(sectionTitle("Features"));

  const card = roundedCard();
  for (const f of FEATURE_DEFS) {
    card.appendChild(featureRow(state, f));
  }
  section.appendChild(card);
  root.appendChild(section);
}

/**
 * Heuristic sidebar finder. Codex's left rail is typically a flex column
 * pinned to x=0 with substantial height. We rank candidates by:
 *   • bounding-rect.left near 0
 *   • height > 60% of viewport
 *   • narrow-ish width (< 360px) for collapsed/expanded sidebars
 *   • presence of `nav` or aria-label="Primary"
 * and pick the best. Returns the chosen element + a few selector hints.
 *
 * Currently unused — kept around for ad-hoc DOM debugging during tweak
 * development. Wire it up to a temporary button if needed.
 */
// eslint-disable-next-line no-unused-vars
async function dumpSidebar(api) {
  const candidates = [];
  const all = document.querySelectorAll(
    'aside, nav, [role="navigation"], [data-testid*="sidebar" i], div',
  );
  const vh = window.innerHeight;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.left > 8) continue;
    if (r.height < vh * 0.6) continue;
    if (r.width < 40 || r.width > 420) continue;
    let score = 0;
    if (el.tagName === "ASIDE" || el.tagName === "NAV") score += 5;
    if (el.getAttribute("role") === "navigation") score += 3;
    if (el.querySelector("nav")) score += 1;
    if (/sidebar/i.test(el.getAttribute("data-testid") || "")) score += 4;
    if (/rounded/.test(el.className || "")) score += 2;
    score += Math.max(0, 200 - r.width) / 100; // prefer narrower
    candidates.push({ el, score, rect: r });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  if (!top) return { ok: false, reason: "no candidate" };

  const html = top.el.outerHTML;
  const summary = candidates.slice(0, 5).map((c) => ({
    tag: c.el.tagName.toLowerCase(),
    classes: c.el.className,
    rect: {
      x: Math.round(c.rect.left),
      y: Math.round(c.rect.top),
      w: Math.round(c.rect.width),
      h: Math.round(c.rect.height),
    },
    score: c.score,
  }));

  const payload =
    `<!-- top candidates (best first) -->\n` +
    summary.map((s) => "<!-- " + JSON.stringify(s) + " -->").join("\n") +
    `\n\n<!-- chosen element outerHTML -->\n` +
    html;

  let wrotePath = null;
  try {
    if (typeof api.fs?.write === "function") {
      await api.fs.write("sidebar-dump.html", payload);
      wrotePath = "sidebar-dump.html (in tweak data dir)";
    }
  } catch (e) {
    api.log.warn("fs.write failed", e);
  }

  let copied = false;
  try {
    await navigator.clipboard.writeText(payload);
    copied = true;
  } catch (e) {
    api.log.warn("clipboard write failed", e);
  }

  return { ok: true, copied, wrotePath, summary };
}

function featureRow(state, f) {
  const row = el("div", "flex items-center justify-between gap-4 p-3");

  const left = el("div", "flex min-w-0 flex-col gap-1");
  const label = el("div", "min-w-0 text-sm text-token-text-primary");
  label.textContent = f.title;
  left.appendChild(label);
  if (f.description) {
    const desc = el("div", "text-token-text-secondary min-w-0 text-sm");
    desc.textContent = f.description;
    left.appendChild(desc);
  }
  row.appendChild(left);

  const initial = readFlag(state.api, f.id, state.defaults[f.id]);
  const sw = switchControl(initial, async (next) => {
    writeFlag(state.api, f.id, next);
    window.dispatchEvent(
      new CustomEvent(BRIDGE_EVENT, {
        detail: { id: f.id, value: next, source: "ui-improvements" },
      }),
    );
    if (next) activateFeature(state, f.id);
    else deactivateFeature(state, f.id);
  });
  row.appendChild(sw);
  return row;
}

// ─────────────────────────────────────────────────────────── feature reg ──

function activateFeature(state, id) {
  if (state.features.has(id)) return;
  const fn = FEATURES[id];
  if (!fn) {
    state.api.log.warn("unknown feature", id);
    return;
  }
  try {
    const dispose = fn(state.api);
    state.features.set(id, { dispose });
    state.api.log.info("activated", id);
  } catch (e) {
    state.api.log.error("activate failed", id, e);
  }
}

function deactivateFeature(state, id) {
  const f = state.features.get(id);
  if (!f) return;
  try {
    f.dispose?.();
  } finally {
    state.features.delete(id);
    state.api.log.info("deactivated", id);
  }
}

function installShadcnBridge(state) {
  if (typeof window === "undefined") return () => {};

  const bridge = {
    features: FEATURE_DEFS,
    defaults: state.defaults,
    getFeature(id) {
      if (!(id in state.defaults)) return false;
      return readFlag(state.api, id, state.defaults[id]);
    },
    setFeature(id, on) {
      setFeatureEnabled(state, id, on);
    },
    getProjectColors() {
      return state.api.storage.get(PROJECT_COLOR_STORAGE_KEY, {});
    },
    setProjectColor(projectKey, colorId) {
      setProjectColorPref(state.api, projectKey, colorId);
    },
    getProjectOverlays() {
      return state.api.storage.get(PROJECT_OVERLAY_STORAGE_KEY, {});
    },
    setProjectOverlay(projectKey, intensity) {
      setProjectOverlayPref(state.api, projectKey, intensity);
    },
    getProjectRows() {
      return discoverProjectRows();
    },
  };

  const previous = window.__codexppUiImprovements;
  window.__codexppUiImprovements = bridge;

  const onSettingChanged = (event) => {
    const detail = event?.detail || {};
    if (detail.source === "ui-improvements") return;
    if (typeof detail.id !== "string" || typeof detail.value !== "boolean") return;
    setFeatureEnabled(state, detail.id, detail.value);
  };

  window.addEventListener(BRIDGE_EVENT, onSettingChanged);

  return () => {
    window.removeEventListener(BRIDGE_EVENT, onSettingChanged);
    if (window.__codexppUiImprovements === bridge) {
      if (previous) window.__codexppUiImprovements = previous;
      else delete window.__codexppUiImprovements;
    }
  };
}

function setFeatureEnabled(state, id, on) {
  if (!(id in state.defaults)) return;
  writeFlag(state.api, id, !!on);
  if (on) activateFeature(state, id);
  else deactivateFeature(state, id);
  window.dispatchEvent(
    new CustomEvent(BRIDGE_EVENT, {
      detail: { id, value: !!on, source: "ui-improvements" },
    }),
  );
}

function setProjectColorPref(api, projectKey, colorId) {
  const key = normalizeProjectColorKey(projectKey);
  if (!key) return;
  const prefs = api.storage.get(PROJECT_COLOR_STORAGE_KEY, {});
  const next = prefs && typeof prefs === "object" ? { ...prefs } : {};
  if (!colorId || colorId === "auto") delete next[key];
  else next[key] = colorId;
  api.storage.set(PROJECT_COLOR_STORAGE_KEY, next);
  window.dispatchEvent(
    new CustomEvent(COLOR_EVENT, { detail: { projectKey: key, colorId: colorId || "auto" } }),
  );
}

function normalizeProjectOverlayIntensity(value) {
  const id = String(value || DEFAULT_PROJECT_OVERLAY_INTENSITY).trim().toLowerCase();
  return PROJECT_OVERLAY_OPTIONS[id] ? id : DEFAULT_PROJECT_OVERLAY_INTENSITY;
}

function setProjectOverlayPref(api, projectKey, intensity) {
  const key = normalizeProjectColorKey(projectKey);
  if (!key) return;
  const value = normalizeProjectOverlayIntensity(intensity);
  const prefs = api.storage.get(PROJECT_OVERLAY_STORAGE_KEY, {});
  const next = prefs && typeof prefs === "object" ? { ...prefs } : {};
  if (value === DEFAULT_PROJECT_OVERLAY_INTENSITY) delete next[key];
  else next[key] = value;
  api.storage.set(PROJECT_OVERLAY_STORAGE_KEY, next);
  window.dispatchEvent(
    new CustomEvent(COLOR_EVENT, { detail: { projectKey: key, overlayIntensity: value } }),
  );
}

function discoverProjectRows() {
  const rows = Array.from(document.querySelectorAll("div[role='listitem'][aria-label]"));
  const seen = new Set();
  const projects = [];
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    const label = (row.getAttribute("aria-label") || "").trim();
    const key = normalizeProjectColorKey(label);
    if (!key || seen.has(key)) continue;
    const action = row.querySelector("[data-app-action-sidebar-project-id]");
    const projectId = action instanceof HTMLElement
      ? action.getAttribute("data-app-action-sidebar-project-id") || ""
      : "";
    if (!projectId && !/\bproject\b/i.test(row.className) && row.textContent?.length > 80) continue;
    seen.add(key);
    projects.push({ key, label, projectId });
  }
  return projects.sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeProjectColorKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────── features ──

const FEATURES = {
  /**
   * Codex sidebar hover cards can show the branch that a chat last used.
   * When the PR branch has since been merged/deleted, the native copy reads
   * like the branch is still active. We cannot change Codex's chat metadata
   * from a renderer tweak, but we can make the hover card label truthful.
   */
  "clarify-stale-chat-branch-label"(api) {
    const ORIGINAL =
      "Chat branch reflects active branch when last used; sending a message will update chat branch";
    const REPLACEMENT =
      "Last used chat branch; opening or sending in the chat refreshes it from the current repo branch";
    const MARK_ATTR = "data-codexpp-stale-branch-label-clarified";
    const touched = new Set();
    // Fingerprint guard: skip repeated element attr checks until aria/title
    // changes. This keeps the initial full scan cheap on later scoped passes.
    const processed = new WeakMap();

    const normalize = (text) => String(text || "").replace(/\s+/g, " ").trim();

    const clarifyTextNode = (node) => {
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      const text = normalize(node.nodeValue);
      if (text !== ORIGINAL) return;
      node.nodeValue = REPLACEMENT;
      touched.add(node);
    };

    const clarifyElement = (node) => {
      if (!(node instanceof HTMLElement)) return;
      const fingerprint = `${node.getAttribute("aria-label") || ""}\n${node.getAttribute("title") || ""}`;
      if (processed.get(node) === fingerprint) return;
      let didTouchAttr = false;
      for (const attr of ["aria-label", "title"]) {
        const value = node.getAttribute(attr);
        if (normalize(value) === ORIGINAL) {
          node.setAttribute(attr, REPLACEMENT);
          node.setAttribute(MARK_ATTR, attr);
          touched.add(node);
          didTouchAttr = true;
        }
      }
      processed.set(node, fingerprint);
      for (const child of node.childNodes) clarifyTextNode(child);
    };

    const scanRoot = (root) => {
      if (!root) return;
      if (root.nodeType === Node.TEXT_NODE) {
        clarifyTextNode(root);
        return;
      }
      if (!(root instanceof HTMLElement)) return;
      clarifyElement(root);
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      );
      let node = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) clarifyTextNode(node);
        else clarifyElement(node);
        node = walker.nextNode();
      }
    };

    const pendingRoots = new Set();
    let scheduled = false;
    const scheduleScan = (root) => {
      if (root) pendingRoots.add(root);
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const roots = Array.from(pendingRoots);
        pendingRoots.clear();
        for (const item of roots) scanRoot(item);
      });
    };
    const onMutate = (mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          scheduleScan(mutation.target);
          continue;
        }
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) scheduleScan(node);
        }
      }
    };

    const obs = new MutationObserver(onMutate);
    scanRoot(document.body || document.documentElement);
    // No characterData: the stale-branch label is static chrome reached via
    // childList/attribute changes, so per-streamed-token text mutations should
    // never trigger a full-document re-scan.
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-label", "title"],
      childList: true,
      subtree: true,
    });
    api.log.info("stale chat branch label clarification active");

    return () => {
      obs.disconnect();
      for (const node of touched) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (normalize(node.nodeValue) === REPLACEMENT) {
            node.nodeValue = String(node.nodeValue).replace(REPLACEMENT, ORIGINAL);
          }
          continue;
        }
        if (node instanceof HTMLElement) {
          const attr = node.getAttribute(MARK_ATTR);
          if (attr && normalize(node.getAttribute(attr)) === REPLACEMENT) node.setAttribute(attr, ORIGINAL);
          node.removeAttribute(MARK_ATTR);
        }
      }
      touched.clear();
    };
  },

  /**
   * Hide the "Upgrade" / "Get Plus" buttons. We match by visible text
   * across the document, skipping anything inside Codex's settings shell
   * or our own injected panels. Hidden via inline `display:none` so we
   * can restore it cleanly on dispose.
   */
  "hide-upgrade-prompts"(api) {
    // Two matcher tiers:
    //  • EXACT: short pill labels we trust (case-insensitive, exact match).
    //  • CONTAINS: longer phrases that may appear with trailing icons/arrows
    //    or wrapped in extra spans. We substring-match (case-insensitive).
    const EXACT = new Set([
      "upgrade",
      "get plus",
      "get chatgpt plus",
      "upgrade plan",
      "upgrade your plan",
      "upgrade to plus",
    ]);
    const CONTAINS = ["upgrade for higher limits"];
    const hidden = new Set(/* HTMLElement */);
    // Fingerprint guard: remember the short label last inspected for each
    // candidate. If text/aria/title changes later, the candidate is eligible
    // again without rescanning the whole document synchronously.
    const processed = new WeakMap();

    const isInsideOurShell = (el) => {
      let n = el;
      while (n) {
        if (n instanceof HTMLElement && n.dataset?.codexpp) return true;
        n = n.parentElement;
      }
      return false;
    };

    // Codex sometimes splits the label across icon + text spans, so we use
    // textContent and collapse whitespace.
    const normText = (el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();

    const matches = (text) => {
      if (!text) return false;
      if (EXACT.has(text)) return true;
      for (const c of CONTAINS) if (text.includes(c)) return true;
      return false;
    };

    const scanRoot = (root) => {
      if (!(root instanceof Element)) return;
      const candidates = [];
      if (root.matches?.('button, a, [role="button"], [role="menuitem"]')) {
        candidates.push(root);
      }
      candidates.push(...root.querySelectorAll(
        'button, a, [role="button"], [role="menuitem"]',
      ));
      for (const el of candidates) {
        if (hidden.has(el)) continue;
        if (isInsideOurShell(el)) continue;
        const t = normText(el);
        if (processed.get(el) === t) continue;
        if (t.length === 0) {
          processed.set(el, t);
          continue;
        }
        if (t.length > 80) {
          continue;
        }
        if (!matches(t)) {
          processed.set(el, t);
          continue;
        }
        const host = el.closest('[class*="rounded"], [class*="badge"]') || el;
        if (!(host instanceof HTMLElement)) continue;
        host.dataset.codexppPrevDisplay = host.style.display || "";
        host.style.display = "none";
        hidden.add(host);
        api.log.info("hid upgrade element", { text: t });
      }
    };

    const pendingRoots = new Set();
    let scheduled = false;
    const scheduleScan = (root) => {
      if (root instanceof Element) {
        pendingRoots.add(root.closest?.('button, a, [role="button"], [role="menuitem"]') || root);
      } else if (root?.parentElement) {
        pendingRoots.add(root.parentElement);
      }
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const roots = Array.from(pendingRoots);
        pendingRoots.clear();
        for (const item of roots) scanRoot(item);
      });
    };
    const onMutate = (mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) scheduleScan(node);
        } else if (mutation.type === "attributes") {
          scheduleScan(mutation.target);
        }
      }
    };

    scanRoot(document.body || document.documentElement);
    const obs = new MutationObserver(onMutate);
    // No characterData: hidden-element targeting keys off structure/attributes,
    // so per-streamed-token text mutations should never trigger a re-scan.
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-label", "title"],
      childList: true,
      subtree: true,
    });

    return () => {
      obs.disconnect();
      for (const el of hidden) {
        if ("codexppPrevDisplay" in el.dataset) {
          el.style.display = el.dataset.codexppPrevDisplay;
          delete el.dataset.codexppPrevDisplay;
        }
      }
      hidden.clear();
    };
  },

  /**
   * Surface 5h + Weekly rate limits in the sidebar slot where the "Upgrade"
   * pill lives. Sources its data from Codex's authenticated app-server usage
   * endpoint, with Codex's rendered rate-limit UI as a fallback.
   *
   * Strategy
   * --------
   *  1. Fetch `/wham/usage` through Codex's existing renderer fetch bridge.
   *  2. Parse the expanded/compact rendered labels only when the bridge is
   *     unavailable or the request fails.
   *  3. Persist the latest snapshot and refresh the mounted sidebar box in
   *     place. Re-mount only when Codex replaces the sidebar subtree.
   */
  "show-usage-in-sidebar"(api) {
    /**
     * Persisted snapshot:
     *   { fiveHour:{label,pct,resetAt} | null,
     *     weekly:  {label,pct,resetAt} | null,
     *     at:number }
     * `pct` is REMAINING (Codex displays remaining %, e.g. "100%").
     * `resetAt` is whatever Codex shows verbatim (typically "HH:MM").
     *
     * Data strategy (single usage-fetch path):
     * -----------------------------------------
     * When the analytics tweak (co.thomashulihan.usage-analytics) is present,
     * its main-process IPC handler owns the single "/wham/usage" reader. We
     * source data through the same `api.ipc.invoke("usage-fetch")` IPC channel
     * instead of maintaining a second independent polling loop with a separate
     * renderer bridge. Once IPC succeeds (`ipcUsageConfirmed`), the renderer
     * bridge injection and `window.message` listener are never activated —
     * eliminating the observer-storm risk of a second fetch path.
     *
     * Backward-compat fallback:
     * When IPC fails (analytics absent, older runtime), behaviour is unchanged:
     * DOM scanning (breakdown grid + compact node) and the renderer bridge
     * fallback remain active. No regression, no thrown errors.
     *
     * No characterData observers in this feature. rAF-debounced. Observer-storm
     * rule compliant.
     */
    let snapshot = readSnapshot(api);
    let mounted = null; // HTMLElement currently rendered in the sidebar
    let directUsageAvailable = false;
    let directUsageInFlight = false;
    let directUsageLastAttemptAt = 0;
    let directUsageFailureLogged = false;
    let directUsageSuccessLogged = false;
    // Set true the first time api.ipc.invoke("usage-fetch") succeeds.
    // When true the renderer bridge + message listener are not activated,
    // keeping this tweak on the same single fetch path as usage-analytics.
    let ipcUsageConfirmed = false;
    // Bridge state — only used when IPC is unavailable.
    let usageBridgeReady = false;
    let usageBridgeReadyLogged = false;
    let usageBridgeScriptInjected = false;
    let bridgeRequestSeq = 0;

    const log = (...a) => api.log.info("[usage]", ...a);

    // ── parsing ────────────────────────────────────────────────────────
    const isVisibleElement = (node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      if (node.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const style = window.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const applySnapshot = (partial, source) => {
      if (!partial?.fiveHour && !partial?.weekly) return false;
      const next = {
        fiveHour: partial.fiveHour || snapshot?.fiveHour || null,
        weekly: partial.weekly || snapshot?.weekly || null,
        at: Date.now(),
      };
      const changed =
        JSON.stringify(next.fiveHour) !== JSON.stringify(snapshot?.fiveHour) ||
        JSON.stringify(next.weekly) !== JSON.stringify(snapshot?.weekly);
      snapshot = next;
      writeSnapshot(api, snapshot);
      if (changed) {
        log(`parsed snapshot from ${source}`, snapshot);
        ensureMounted();
      }
      return changed;
    };

    // ── bridge fallback (only activated when IPC path is unavailable) ──

    const ensureUsageBridgeScript = () => {
      if (usageBridgeScriptInjected) return;
      usageBridgeScriptInjected = true;
      window.addEventListener(
        "codexpp-usage-bridge-ready",
        (event) => {
          usageBridgeReady = true;
          if (usageBridgeReadyLogged) return;
          usageBridgeReadyLogged = true;
          api.log.info("[usage] bridge ready", event.detail);
        },
      );
      const script = document.createElement("script");
      script.dataset.codexppUsageBridge = "true";
      script.textContent = `(() => {
        const dispatchReady = (alreadyInstalled) => {
          window.dispatchEvent(new CustomEvent("codexpp-usage-bridge-ready", {
            detail: {
              alreadyInstalled,
              hasElectronBridge: typeof window.electronBridge?.sendMessageFromView === "function",
            },
          }));
        };
        if (window.__codexppUsageBridgeInstalled) {
          dispatchReady(true);
          return;
        }
        window.__codexppUsageBridgeInstalled = true;
        const pending = new Set();
        dispatchReady(false);
        window.addEventListener("codexpp-usage-request", (event) => {
          const message = event.detail;
          if (!message || typeof message !== "object" || !message.requestId) return;
          pending.add(message.requestId);
          let forwarded = false;
          const bridge = window.electronBridge;
          if (typeof bridge?.sendMessageFromView === "function") {
            forwarded = true;
            bridge.sendMessageFromView(message).catch(() => {});
          }
          const forwardedEvent = new CustomEvent("codex-message-from-view", {
            detail: message,
          });
          if (forwarded) forwardedEvent.__codexForwardedViaBridge = true;
          window.dispatchEvent(forwardedEvent);
        });
        window.addEventListener("message", (event) => {
          const data = event.data;
          if (
            !data ||
            typeof data !== "object" ||
            data.type !== "fetch-response" ||
            !pending.has(data.requestId)
          ) {
            return;
          }
          pending.delete(data.requestId);
          window.dispatchEvent(new CustomEvent("codexpp-usage-response", {
            detail: data,
          }));
          window.postMessage({
            type: "codexpp-usage-response",
            detail: data,
          }, "*");
        });
      })();`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    };

    const dispatchCodexViewMessage = (message) => {
      ensureUsageBridgeScript();
      window.dispatchEvent(
        new CustomEvent("codexpp-usage-request", { detail: message }),
      );
      if (usageBridgeReady) return;

      let forwarded = false;
      const bridge = window.electronBridge;
      if (typeof bridge?.sendMessageFromView === "function") {
        forwarded = true;
        bridge.sendMessageFromView(message).catch((e) => {
          if (!directUsageFailureLogged) {
            directUsageFailureLogged = true;
            api.log.warn("[usage] bridge send failed", e);
          }
        });
      }
      const event = new CustomEvent("codex-message-from-view", {
        detail: message,
      });
      if (forwarded) event.__codexForwardedViaBridge = true;
      window.dispatchEvent(event);
    };

    /**
     * Fetch /wham/usage via the renderer bridge (fallback when IPC unavailable).
     * Only called when ipcUsageConfirmed is false and api.ipc.invoke fails.
     */
    const fetchViaRendererBridge = (url, timeoutMs = 10_000) => {
      const hostId =
        new URL(window.location.href).searchParams.get("hostId")?.trim() ||
        "local";
      const requestId = `codexpp-usage-${Date.now()}-${++bridgeRequestSeq}`;

      return new Promise((resolve, reject) => {
        let done = false;
        const cleanup = () => {
          done = true;
          window.removeEventListener("message", onMessage);
          window.removeEventListener("codexpp-usage-response", onBridgeResponse);
          window.clearTimeout(timer);
        };
        const finish = (fn, value) => {
          if (done) return;
          cleanup();
          fn(value);
        };
        const onMessage = (event) => {
          const data =
            event.data?.type === "codexpp-usage-response"
              ? event.data.detail
              : event.data;
          handleResponse(data);
        };
        const onBridgeResponse = (event) => {
          handleResponse(event.detail);
        };
        const handleResponse = (data) => {
          if (
            !data ||
            typeof data !== "object" ||
            data.type !== "fetch-response" ||
            data.requestId !== requestId
          ) {
            return;
          }
          if (data.responseType === "success") {
            try {
              const body = JSON.parse(data.bodyJsonString);
              if (data.status >= 200 && data.status < 300) {
                finish(resolve, body);
              } else {
                finish(reject, new Error(`HTTP ${data.status}`));
              }
            } catch (e) {
              finish(reject, e);
            }
          } else {
            finish(reject, new Error(data.error || "fetch failed"));
          }
        };
        const timer = window.setTimeout(() => {
          dispatchCodexViewMessage({ type: "cancel-fetch", requestId });
          finish(reject, new Error("usage request timed out"));
        }, timeoutMs);
        window.addEventListener("message", onMessage);
        window.addEventListener("codexpp-usage-response", onBridgeResponse);
        dispatchCodexViewMessage({
          type: "fetch",
          hostId,
          requestId,
          method: "GET",
          url,
        });
      });
    };

    const remainingPercent = (usedPercent) => {
      const used = Number(usedPercent);
      if (!Number.isFinite(used)) return null;
      return Math.round(Math.min(Math.max(100 - used, 0), 100));
    };

    const formatResetAt = (epochSeconds) => {
      const seconds = Number(epochSeconds);
      if (!Number.isFinite(seconds)) return null;
      const date = new Date(seconds * 1000);
      if (!Number.isFinite(date.getTime())) return null;
      return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    };

    const normalizeUsageWindow = (window, label) => {
      if (!window || typeof window !== "object") return null;
      const pct = remainingPercent(window.used_percent);
      if (pct == null) return null;
      return {
        label,
        pct,
        resetAt: formatResetAt(window.reset_at),
      };
    };

    const pickClosestWindow = (windows, targetMinutes, predicate) => {
      let best = null;
      let bestDistance = Infinity;
      for (const window of windows) {
        const minutes = Number(window?.limit_window_seconds) / 60;
        if (!Number.isFinite(minutes) || !predicate(minutes)) continue;
        const distance = Math.abs(minutes - targetMinutes);
        if (
          !best ||
          distance < bestDistance ||
          (distance === bestDistance &&
            minutes > Number(best.limit_window_seconds) / 60)
        ) {
          best = window;
          bestDistance = distance;
        }
      }
      return best;
    };

    const snapshotFromUsageStatus = (status) => {
      const limits = [];
      const pushLimit = (rateLimit) => {
        if (!rateLimit || typeof rateLimit !== "object") return;
        if (rateLimit.primary_window) limits.push(rateLimit.primary_window);
        if (rateLimit.secondary_window) limits.push(rateLimit.secondary_window);
      };

      pushLimit(status?.rate_limit);
      if (Array.isArray(status?.additional_rate_limits)) {
        for (const item of status.additional_rate_limits) {
          pushLimit(item?.rate_limit);
        }
      }

      const five = pickClosestWindow(
        limits,
        300,
        (minutes) => minutes > 0 && minutes < 1440,
      );
      const weekly = pickClosestWindow(
        limits,
        7 * 24 * 60,
        (minutes) => minutes >= 1440,
      );

      return {
        fiveHour: normalizeUsageWindow(five, "5h"),
        weekly: normalizeUsageWindow(weekly, "Weekly"),
      };
    };

    const collectUsageWindows = (value, out = [], seen = new WeakSet()) => {
      if (!value || typeof value !== "object") return out;
      if (seen.has(value)) return out;
      seen.add(value);
      if (
        "used_percent" in value &&
        "limit_window_seconds" in value &&
        "reset_at" in value
      ) {
        out.push(value);
      }
      if (Array.isArray(value)) {
        for (const item of value) collectUsageWindows(item, out, seen);
      } else {
        for (const item of Object.values(value)) {
          collectUsageWindows(item, out, seen);
        }
      }
      return out;
    };

    const snapshotFromUsageWindows = (windows) => {
      const five = pickClosestWindow(
        windows,
        300,
        (minutes) => minutes > 0 && minutes < 1440,
      );
      const weekly = pickClosestWindow(
        windows,
        7 * 24 * 60,
        (minutes) => minutes >= 1440,
      );
      return {
        fiveHour: normalizeUsageWindow(five, "5h"),
        weekly: normalizeUsageWindow(weekly, "Weekly"),
      };
    };

    const applyUsageEvent = (message) => {
      if (!message || typeof message !== "object") return false;
      const windows = collectUsageWindows(message);
      if (!windows.length) return false;
      const partial = snapshotFromUsageWindows(windows);
      if (!partial.fiveHour && !partial.weekly) return false;
      directUsageAvailable = true;
      applySnapshot(partial, "rate-limit-event");
      return true;
    };

    const onUsageMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      applyUsageEvent(data);
    };

    /**
     * Fetch /wham/usage and update the snapshot.
     *
     * Single-path strategy: try `api.ipc.invoke("usage-fetch")` first — this
     * is the same channel the usage-analytics tweak uses, so when both tweaks
     * are active there is exactly ONE /wham/usage reader (the IPC handler in
     * main). Only when IPC is unavailable do we fall back to the renderer
     * bridge (legacy runtime or analytics tweak absent). Once IPC has succeeded
     * once, `ipcUsageConfirmed` is set and the bridge path is never entered.
     */
    const refreshUsageFromApi = async () => {
      if (directUsageInFlight) return false;
      const now = Date.now();
      if (directUsageLastAttemptAt && now - directUsageLastAttemptAt < 60_000) {
        return false;
      }
      directUsageLastAttemptAt = now;
      directUsageInFlight = true;
      try {
        let status;
        // ── primary: shared IPC path (usage-analytics or built-in handler) ──
        try {
          status = await api.ipc.invoke("usage-fetch", "/wham/usage");
          // IPC succeeded — remember this so the bridge is never activated.
          ipcUsageConfirmed = true;
        } catch {
          // ── fallback: renderer bridge (only when IPC unavailable) ──
          if (ipcUsageConfirmed) {
            // IPC was working before; a transient error — don't re-activate
            // the bridge path. Treat as a temporary unavailability.
            return false;
          }
          try {
            status = await fetchViaRendererBridge("/wham/usage");
          } catch {
            status = null;
          }
        }
        const partial = snapshotFromUsageStatus(status);
        if (partial.fiveHour || partial.weekly) {
          directUsageAvailable = true;
          directUsageFailureLogged = false;
          if (!directUsageSuccessLogged) {
            directUsageSuccessLogged = true;
            log("api active (ipc=" + ipcUsageConfirmed + ")", partial);
          }
          applySnapshot(partial, "api");
          return true;
        }
        return false;
      } catch (e) {
        if (!directUsageFailureLogged) {
          directUsageFailureLogged = true;
          api.log.warn("[usage] /wham/usage unavailable; falling back to DOM", e);
        }
        return false;
      } finally {
        directUsageInFlight = false;
      }
    };

    /**
     * Codex's expanded breakdown is a 2-column CSS grid: label in col-1,
     * value in col-2. We locate the grid by its unique class signature,
     * then walk children pairwise.
     *
     * Returns the breakdown grid element, or null.
     */
    const findBreakdownGrid = () => {
      // The full class string is long and may shift; we anchor on the
      // distinctive `grid-cols-[minmax(0,1fr)_auto]` token.
      const grids = document.querySelectorAll(
        'div[class*="grid-cols-[minmax(0,1fr)_auto]"]',
      );
      for (const g of grids) {
        if (!isVisibleElement(g)) continue;
        const txt = (g.textContent || "").toLowerCase();
        if (
          (txt.includes("5h") || txt.includes("hourly")) &&
          txt.includes("week")
        )
          return g;
      }
      return null;
    };

    /**
     * Parse a value span (e.g. "100%·16:19") into `{ pct, resetAt }`.
     * Falls back to `null` fields when a piece is missing.
     */
    const parseValueText = (txt, root) => {
      const pctMatch = txt.match(/(\d{1,3})\s*%/);
      const pct = pctMatch ? Math.max(0, Math.min(100, +pctMatch[1])) : null;
      // Prefer the inner [title="HH:MM"] attribute, else regex the text.
      const titled = root?.querySelector?.("[title]");
      let resetAt = titled ? titled.getAttribute("title") : null;
      if (!resetAt) {
        const tMatch =
          txt.match(/\b(\d{1,2}:\d{2})\b/) ||
          txt.match(/\b(\d+\s*(?:m|h|d))\b/i);
        resetAt = tMatch ? tMatch[1] : null;
      }
      return { pct, resetAt };
    };

    const parseValue = (span) => {
      const txt = (span.textContent || "").replace(/\s+/g, " ").trim();
      return parseValueText(txt, span);
    };

    const scanBreakdown = (grid) => {
      const kids = Array.from(grid.children);
      let five = null;
      let week = null;
      // Pair (label, value) — col-1 then col-2 in DOM order.
      for (let i = 0; i + 1 < kids.length; i += 2) {
        const labelTxt = (kids[i].textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const value = parseValue(kids[i + 1]);
        const lower = labelTxt.toLowerCase();
        if (!five && (lower === "5h" || lower.startsWith("hourly"))) {
          five = { label: labelTxt, ...value };
        } else if (!week && lower.startsWith("week")) {
          week = { label: labelTxt, ...value };
        }
      }
      if (!five && !week) return false;
      applySnapshot({ fiveHour: five, weekly: week }, "breakdown");
      return true;
    };

    const parseCompactUsageNode = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      if (node.closest('[data-codexpp="usage-box"]')) return null;
      if (!isVisibleElement(node)) return null;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 160 || !/%/.test(text)) return null;
      const lower = text.toLowerCase();
      const hasFive = /\b(5h|5\s*hour|hourly)\b/.test(lower);
      const hasWeek = /\b(weekly|week)\b/.test(lower);
      if (!hasFive && !hasWeek) return null;

      const value = parseValueText(text, node);
      if (value.pct == null) return null;
      const label = hasFive && !hasWeek ? "5h" : hasWeek && !hasFive ? "Weekly" : null;
      if (!label) return null;
      return label === "5h"
        ? { fiveHour: { label, ...value } }
        : { weekly: { label, ...value } };
    };

    // WeakSet fingerprint guard (Phase 5.4): nodes whose textContent we've
    // already parsed and rejected. The selector below picks up every span,
    // button, aria-labelled, and title-bearing node in the doc — typically
    // thousands during a token stream. Most never have a `%` and never will,
    // so we cache the negative result here.
    const compactUsageProcessed = new WeakSet();
    const scanCompactUsage = () => {
      const candidates = document.querySelectorAll(
        'button, [role="button"], [role="status"], [aria-label], [title], span',
      );
      for (const node of candidates) {
        if (compactUsageProcessed.has(node)) continue;
        const partial = parseCompactUsageNode(node);
        if (partial) {
          applySnapshot(partial, "compact");
        } else if (node instanceof HTMLElement) {
          // Only mark elements whose text we definitively examined and
          // rejected. parseCompactUsageNode returns null both for "not
          // applicable" (no %) and "applicable but invalid" cases; either
          // way, until the node's text mutates we can skip re-checking it.
          // Codex DOES mutate the percentage text of the actual indicator,
          // but those nodes have a `%` and would have parsed successfully.
          const text = (node.textContent || "");
          if (!/%/.test(text)) compactUsageProcessed.add(node);
        }
      }
    };

    // ── sidebar mount ─────────────────────────────────────────────────
    /**
     * Find the sidebar slot for the upgrade pill. The pill itself is
     * hidden by `hide-upgrade-prompts`, so we mount as a sibling that
     * replaces its visual footprint. We anchor on the parent of any
     * button/link with text "Upgrade" (case-insensitive), or fall back
     * to the bottom of the sidebar group.
     *
     * Returns the parent element to mount into, or null if not found.
     */
    const findSidebarSlot = () => {
      // Look for the (now hidden) upgrade pill via its prev-display marker.
      const prev = document.querySelector('[data-codexpp-prev-display]');
      if (prev && prev.parentElement) return prev.parentElement;
      // Fallback: any visible button literally labelled "Upgrade".
      const btns = document.querySelectorAll('button, a');
      for (const b of btns) {
        const t = (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (t === "upgrade") return b.parentElement;
      }
      return null;
    };

    const ensureMounted = (forceRebuild = false) => {
      if (!snapshot || (!snapshot.fiveHour && !snapshot.weekly)) return;
      const slot = findSidebarSlot();
      if (!slot) {
        if (!ensureMounted._warned) {
          log("ensureMounted: no sidebar slot found yet");
          ensureMounted._warned = true;
        }
        return;
      }

      // Defensive: remove any stale boxes left by a previous mount cycle
      // (hot-reload, stop() race, or an older shape of this tweak that
      // used `data-codexpp="usage-boxes"`).
      for (const stale of document.querySelectorAll(
        '[data-codexpp="usage-box"], [data-codexpp="usage-boxes"]',
      )) {
        if (stale !== mounted) stale.remove();
      }

      if (mounted && slot.contains(mounted) && !forceRebuild) {
        mounted._refresh?.(snapshot);
        return;
      }
      if (mounted) mounted.remove();
      mounted = renderUsageBox(api, snapshot);
      mounted.dataset.codexpp = "usage-box";
      slot.appendChild(mounted);
      log("mounted usage box", {
        slotTag: slot.tagName,
        slotClass: slot.className,
      });
    };

    // Initial render from persisted snapshot (so first paint isn't empty
    // even before the user opens the popover).
    ensureMounted(true);

    // ── observers ─────────────────────────────────────────────────────
    // We throttle to one tick per animation frame so a flood of React
    // re-renders can't tank the renderer (Codex mutates the DOM heavily
    // while typing). Coalesces N onMutate() calls into one scan.
    //
    // No characterData — rAF-debounced — observer-storm rule compliant.
    let scheduled = false;
    const onMutate = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        refreshUsageFromApi();
        if (!directUsageAvailable) {
          const grid = findBreakdownGrid();
          if (grid) scanBreakdown(grid);
          scanCompactUsage();
        }
        ensureMounted();
      });
    };

    onMutate();
    const obs = new MutationObserver(onMutate);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const interval = window.setInterval(onMutate, 15_000);
    window.addEventListener("focus", onMutate);
    // The window "message" listener for usage events is part of the renderer
    // bridge fallback path. When ipcUsageConfirmed becomes true (IPC path is
    // active — i.e. usage-analytics tweak is present), this listener is a
    // no-op because the bridge is never injected and `onUsageMessage` only
    // processes data that arrives via that bridge. We still attach it so
    // the fallback works on the first load before IPC is confirmed.
    window.addEventListener("message", onUsageMessage);
    document.addEventListener("visibilitychange", onMutate);

    log("active", { snapshot });

    return () => {
      obs.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("focus", onMutate);
      window.removeEventListener("message", onUsageMessage);
      document.removeEventListener("visibilitychange", onMutate);
      if (mounted) {
        mounted.remove();
        mounted = null;
      }
    };
  },

  /**
   * Square sidebar: the visual "rounded sidebar" is actually the main
   * content panel — `<main class="main-surface ... rounded-s-2xl">` —
   * which has `border-radius: 12.5px 0 0 12.5px` (TL+BL via Tailwind's
   * logical `rounded-s-2xl`). Its rounded left edge curves into the
   * sidebar, making the sidebar's TR+BR corners *appear* rounded.
   * Flattening `.main-surface`'s left side squares the seam.
   */
  "square-sidebar"() {
    const STYLE_ID = "codexpp-square-sidebar";
    document.getElementById(STYLE_ID)?.remove();

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Flatten the main panel's left (logical-start) corners.
         Codex applies these via Tailwind's rounded-s-2xl utility. */
      .main-surface {
        border-start-start-radius: 0 !important;
        border-end-start-radius: 0 !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  },

  /**
   * Browser annotation transparency: Codex's browser comment editor card is
   * rendered from `annotation-comment-editor-card-*.js`. The stable anchors
   * below are data attributes in the upstream renderer bundle, avoiding
   * hashed/minified class selectors.
   */
  "browser-annotation-transparent-card"() {
    const STYLE_ID = "codexpp-browser-annotation-transparent-card";
    const ROOT_ATTR = "data-codexpp-browser-annotation-transparent-card";
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.setAttribute(ROOT_ATTR, "true");

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root),
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root) body,
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root) body > div,
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root) #root,
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root) #browser-sidebar-comment-popup-root,
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root) #browser-sidebar-comment-popup-root > div,
      html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root) #browser-sidebar-comment-popup-root > div > div {
        background: transparent !important;
        background-color: transparent !important;
      }

      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] {
        background: var(--color-token-main-surface-primary, var(--color-token-dropdown-background, #fff)) !important;
        background-color: var(--color-token-main-surface-primary, var(--color-token-dropdown-background, #fff)) !important;
      }

      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] [data-browser-comment-design-prompt-shell],
      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] .ProseMirror,
      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] [contenteditable="true"] {
        background: var(--color-token-dropdown-background, var(--color-token-main-surface-primary, #fff)) !important;
      }

      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] .ProseMirror,
      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] [contenteditable="true"] {
        border-radius: var(--radius-md, 0.375rem) !important;
      }

      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] [data-browser-comment-editor-footer-actions],
      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] [data-browser-comment-submit],
      #browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] [data-browser-sidebar-design-editor-toggle] {
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
      document.documentElement.removeAttribute(ROOT_ATTR);
    };
  },

  /**
   * Add a lightweight filter box to Codex Settings' sidebar. This deliberately
   * stays inside the sidebar/nav surface and marks itself with
   * `data-codexpp-settings-search` so the runtime Settings injector can ignore
   * search clicks instead of treating them as navigation.
   *
   * DORMANT: delisted from FEATURE_DEFS + DEFAULT_FEATURE_FLAGS because the
   * native Codex app now ships its own settings search, so this is never
   * activated. The handler is intentionally retained so the feature can be
   * revived (re-add the id to both registries) without re-implementing it.
   */
  "settings-search"(api) {
    const STYLE_ID = "codexpp-settings-search-style";
    const ATTR = "data-codexpp-settings-search";
    const SETTINGS_SIDEBAR_SELECTOR = [
      '[role="dialog"] .window-fx-sidebar-surface',
      ".settings-dialog .window-fx-sidebar-surface",
      ".window-fx-sidebar-surface.w-token-sidebar",
    ].join(", ");
    let root = null;
    let input = null;
    let disposed = false;

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${ATTR}="root"] {
        display: flex !important;
        flex-direction: column !important;
        gap: var(--spacing-1, 0.25rem) !important;
        padding: 0 var(--spacing-row-x, var(--spacing-3, 0.75rem)) var(--spacing-2, 0.5rem) !important;
      }

      [${ATTR}="box"] {
        align-items: center !important;
        background: var(--color-token-bg-primary, var(--color-background-panel, transparent)) !important;
        border: 1px solid var(--color-token-border, var(--color-border, currentColor)) !important;
        border-radius: var(--radius-md, 0.375rem) !important;
        display: flex !important;
        min-height: var(--spacing-token-button-composer, 2rem) !important;
        padding: 0 var(--spacing-2, 0.5rem) !important;
      }

      [${ATTR}="input"] {
        background: transparent !important;
        border: 0 !important;
        color: var(--color-token-text-primary, currentColor) !important;
        flex: 1 1 auto !important;
        font: inherit !important;
        min-width: 0 !important;
        outline: 0 !important;
      }

      [${ATTR}="input"]::placeholder {
        color: var(--color-token-text-secondary, currentColor) !important;
      }
    `;
    document.head.appendChild(style);

    const settingsSidebar = () => {
      const sidebar = document.querySelector(SETTINGS_SIDEBAR_SELECTOR);
      return sidebar instanceof HTMLElement ? sidebar : null;
    };

    const navButtons = (sidebar) =>
      Array.from(sidebar?.querySelectorAll?.("nav button, nav [role='button']") || [])
        .filter((node) => node instanceof HTMLElement && !node.closest(`[${ATTR}]`));

    const restoreButtons = () => {
      document.querySelectorAll(`[data-codexpp-settings-search-hidden]`).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        node.style.display = node.dataset.codexppSettingsSearchPrevDisplay || "";
        delete node.dataset.codexppSettingsSearchHidden;
        delete node.dataset.codexppSettingsSearchPrevDisplay;
      });
    };

    const applyFilter = () => {
      const sidebar = settingsSidebar();
      if (!sidebar || !input) return;
      const query = compactText(input.value).toLowerCase();
      for (const button of navButtons(sidebar)) {
        const text = compactText(button.textContent).toLowerCase();
        const hidden = Boolean(query && !text.includes(query));
        if (hidden) {
          if (button.dataset.codexppSettingsSearchHidden !== "true") {
            button.dataset.codexppSettingsSearchPrevDisplay = button.style.display || "";
            button.dataset.codexppSettingsSearchHidden = "true";
          }
          button.style.display = "none";
        } else if (button.dataset.codexppSettingsSearchHidden === "true") {
          button.style.display = button.dataset.codexppSettingsSearchPrevDisplay || "";
          delete button.dataset.codexppSettingsSearchHidden;
          delete button.dataset.codexppSettingsSearchPrevDisplay;
        }
      }
    };

    const mount = () => {
      if (disposed) return;
      const sidebar = settingsSidebar();
      if (!sidebar) return;
      if (root?.isConnected && sidebar.contains(root)) {
        applyFilter();
        return;
      }
      sidebar.querySelectorAll(`[${ATTR}="root"]`).forEach((node) => node.remove());

      root = document.createElement("div");
      root.setAttribute(ATTR, "root");
      const box = document.createElement("label");
      box.setAttribute(ATTR, "box");
      input = document.createElement("input");
      input.type = "search";
      input.placeholder = "Search settings";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute(ATTR, "input");
      input.setAttribute("aria-label", "Search settings");
      input.addEventListener("input", applyFilter);
      box.appendChild(input);
      root.appendChild(box);

      const nav = sidebar.querySelector("nav");
      sidebar.insertBefore(root, nav || sidebar.firstChild);
      applyFilter();
      api.log.info("settings search mounted");
    };

    let scheduled = false;
    const scheduleMount = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        mount();
      });
    };

    const observer = new MutationObserver((mutations) => {
      if (root?.isConnected) return;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length) {
          scheduleMount();
          return;
        }
      }
    });

    mount();
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    api.log.info("settings search active");

    return () => {
      disposed = true;
      observer.disconnect();
      restoreButtons();
      root?.remove();
      root = null;
      input = null;
      style.remove();
    };
  },

  /**
   * Match settings sidebar width to the main UI sidebar.
   *
   * Codex's main UI sidebar is `<aside class="pointer-events-auto relative
   * flex overflow-hidden">` — JS-controlled, user-resizable, width set via
   * inline `style="width: NNNpx"`. The settings page sidebar is a separate
   * element `<div class="window-fx-sidebar-surface ... w-token-sidebar">`
   * which uses Tailwind class `w-token-sidebar` → `width:
   * var(--spacing-token-sidebar)` ≈ 300px regardless of the main UI's
   * current width. That mismatch causes a visible layout jump every time
   * Settings opens or closes.
   *
   * Strategy: watch the main UI aside via ResizeObserver, persist the
   * latest pixel width to `api.storage`, and apply it to the settings
   * sidebar via an injected stylesheet. We seed from storage on start so
   * the very first paint of the settings page is already correct, before
   * the user has visited the main UI in this session.
   */
  "match-sidebar-width"(api) {
    const STYLE_ID = "codexpp-match-sidebar-width";
    const STORAGE_KEY = "match-sidebar-width:last";
    const ASIDE_SELECTOR = [
      "aside.pointer-events-auto.relative.flex.overflow-hidden",
      "aside.pointer-events-auto.relative.flex.overflow-visible",
      "aside.pointer-events-auto.relative.flex",
    ].join(", ");
    const SETTINGS_SIDEBAR_SELECTOR =
      ".window-fx-sidebar-surface.w-token-sidebar";

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);

    function applyWidth(px) {
      // Sanity-clamp; ignore zero/negative/absurd values that could be
      // observed mid-mount or during a transition.
      if (!Number.isFinite(px) || px < 120 || px > 900) return;
      // Override only the settings page sidebar. Main UI's <aside> sets
      // its own inline width — we mustn't touch it. Use !important to win
      // against the `w-token-sidebar` utility.
      style.textContent =
        `${SETTINGS_SIDEBAR_SELECTOR} { width: ${px}px !important; }`;
    }

    // Seed from last-known so the first settings-page paint matches.
    const seeded = Number(api.storage.get(STORAGE_KEY, NaN));
    if (Number.isFinite(seeded)) applyWidth(seeded);

    let resizeObs = null;
    let observed = null;

    function track(aside) {
      if (observed === aside) return;
      if (resizeObs) {
        resizeObs.disconnect();
        resizeObs = null;
      }
      observed = aside;
      if (!aside) return;
      // Pick up the current width immediately, then observe.
      const initial = Math.round(aside.getBoundingClientRect().width);
      if (initial > 0) {
        api.storage.set(STORAGE_KEY, initial);
        applyWidth(initial);
      }
      resizeObs = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const w = Math.round(
          entry.contentRect?.width ?? aside.getBoundingClientRect().width,
        );
        if (w <= 0) return;
        api.storage.set(STORAGE_KEY, w);
        applyWidth(w);
      });
      resizeObs.observe(aside);
    }

    // Settings and main UI are mutually exclusive — when navigating
    // between them, the aside is mounted/unmounted. Watch the body for
    // structural changes and re-bind whenever a new aside appears.
    const rebind = () => {
      const a = document.querySelector(ASIDE_SELECTOR);
      if (a !== observed) track(a);
    };
    let rebindScheduled = false;
    const scheduleRebind = () => {
      if (rebindScheduled) return;
      rebindScheduled = true;
      requestAnimationFrame(() => {
        rebindScheduled = false;
        rebind();
      });
    };
    track(document.querySelector(ASIDE_SELECTOR));
    const mut = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length) {
          scheduleRebind();
          return;
        }
      }
    });
    mut.observe(document.body, { childList: true, subtree: true });

    return () => {
      mut.disconnect();
      if (resizeObs) resizeObs.disconnect();
      style.remove();
    };
  },

  /**
   * Render the four primary sidebar actions as a compact 2x2 grid.
   *
   * We keep the native buttons and click handlers intact, hide them, and
   * render proxy buttons that forward clicks to the originals. This avoids
   * inheriting the narrow icon-button constraints Codex applies to the
   * existing action row.
   */
  "sidebar-action-grid"(api) {
    const STYLE_ID = "codexpp-sidebar-action-grid";
    const ATTR = "data-codexpp-sidebar-action-grid";
    const WRAPPER_CLASS = "grid grid-cols-2 gap-2 w-full px-row-x";
    const BUTTON_CLASS =
      "flex min-w-0 flex-col items-start justify-center gap-1 rounded-lg " +
      "border border-token-border bg-token-foreground/5 ps-3.5 pe-3.5 py-3 text-left " +
      "text-sm text-token-text-primary hover:bg-token-foreground/10 " +
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
      "focus-visible:outline-token-border cursor-interaction";
    const actions = [
      {
        key: "new chat",
        aliases: ["new chat", "quick chat"],
        label: "New chat",
      },
      { key: "search", aliases: ["search"], label: "Search" },
      { key: "plugins", aliases: ["plugin", "plugins"], label: "Plugins" },
      { key: "automations", aliases: ["automation", "automations"], label: "Automations" },
    ];

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${ATTR}="group"] {
        width: 100% !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        column-gap: var(--spacing-2, 0.5rem) !important;
        row-gap: var(--spacing-2, 0.5rem) !important;
      }

      [${ATTR}="button"] {
        display: flex !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: calc(var(--spacing-token-button-composer, 2rem) * 2.15) !important;
        color: var(--color-token-text-primary) !important;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent) !important;
        border-radius: var(--radius-lg, 0.5rem) !important;
        background-color: color-mix(in srgb, currentColor 5%, transparent) !important;
        align-items: flex-start !important;
        justify-content: center !important;
        flex-direction: column !important;
        text-align: left !important;
        gap: var(--spacing-1, 0.25rem) !important;
        overflow: hidden !important;
      }

      [${ATTR}="button"]:hover {
        background-color: color-mix(in srgb, currentColor 9%, transparent) !important;
      }

      [${ATTR}="button"] > * {
        min-width: 0;
      }

      [${ATTR}="button"] svg {
        flex-shrink: 0;
      }

      [${ATTR}="label"] {
        display: block !important;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      [${ATTR}="button"] kbd,
      [${ATTR}="button"] [class*="shortcut" i] {
        display: none !important;
      }

      [${ATTR}="original"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    const marked = new Set();
    let wrapper = null;
    let activeOriginals = [];

    const clearStaleNodes = () => {
      document.querySelectorAll(`[${ATTR}="group"]`).forEach((node) => {
        if (node.dataset.codexppSidebarActionOwned === "true") {
          node.remove();
        }
      });
      document.querySelectorAll(`[${ATTR}]`).forEach((node) => {
        if (node.dataset.codexppSidebarActionOwned === "true") {
          node.remove();
          return;
        }
        node.removeAttribute(ATTR);
        if (node.dataset.codexppSidebarActionPrevClass !== undefined) {
          node.className = node.dataset.codexppSidebarActionPrevClass;
          delete node.dataset.codexppSidebarActionPrevClass;
        }
        if (node.dataset.codexppSidebarActionPrevStyle !== undefined) {
          node.style.cssText = node.dataset.codexppSidebarActionPrevStyle;
          delete node.dataset.codexppSidebarActionPrevStyle;
        }
      });
    };

    const cleanupMarks = () => {
      for (const node of marked) {
        node.removeAttribute(ATTR);
        if (node.dataset.codexppSidebarActionPrevClass !== undefined) {
          node.className = node.dataset.codexppSidebarActionPrevClass;
          delete node.dataset.codexppSidebarActionPrevClass;
        }
        if (node.dataset.codexppSidebarActionPrevStyle !== undefined) {
          node.style.cssText = node.dataset.codexppSidebarActionPrevStyle;
          delete node.dataset.codexppSidebarActionPrevStyle;
        }
      }
      marked.clear();
    };

    const removeWrapper = () => {
      wrapper?.remove();
      wrapper = null;
      activeOriginals = [];
    };

    const normalize = (value) =>
      (value || "").replace(/\s+/g, " ").trim().toLowerCase();

    const buttonLabel = (node) =>
      normalize(node.getAttribute("aria-label") || node.textContent || "")
        .replace(/\s*[⌘⇧⌥⌃^].*$/, "")
        .trim();

    const isCompositeActionText = (node) => {
      const text = normalize(node.textContent || "");
      let count = 0;
      for (const action of actions) {
        if (action.aliases.some((alias) => text.includes(alias))) count += 1;
      }
      return count > 1;
    };

    const findMainSidebar = () => {
      const aside = document.querySelector(
        "aside.pointer-events-auto.relative.flex.overflow-hidden",
      );
      if (aside instanceof HTMLElement) return aside;
      return null;
    };

    const findActionButtons = (options = {}) => {
      const sidebar = findMainSidebar();
      if (!sidebar) return null;
      const sidebarRect = sidebar.getBoundingClientRect();
      const candidates = Array.from(sidebar.querySelectorAll("button, a"))
        .filter(
          (node) => {
            if (!(node instanceof HTMLElement)) return false;
            if (
              node.getAttribute(ATTR) === "original" ||
              node.getAttribute(ATTR) === "source-original" ||
              node.getAttribute(ATTR) === "overlay" ||
              isCompositeActionText(node)
            ) {
              return false;
            }
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            return rect.top - sidebarRect.top < 260;
          },
        )
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return ar.top - br.top || ar.left - br.left;
        });
      const byLabel = new Map();
      for (const node of candidates) {
        const label = buttonLabel(node);
        const action = actions.find((item) => item.aliases.includes(label));
        if (action && !byLabel.has(action.key)) {
          byLabel.set(action.key, node);
        }
      }
      if (actions.some((action) => !byLabel.has(action.key))) return null;
      return actions.map((action) => ({
        ...action,
        original: byLabel.get(action.key),
      }));
    };

    const commonAncestor = (nodes) => {
      if (!nodes.length) return null;
      const chain = [];
      for (let node = nodes[0]; node; node = node.parentElement) {
        chain.push(node);
      }
      return chain.find((node) => nodes.every((target) => node.contains(target)));
    };

    const markNode = (node, value) => {
      if (!marked.has(node)) {
        if (node.dataset.codexppSidebarActionPrevClass === undefined) {
          node.dataset.codexppSidebarActionPrevClass = node.className || "";
        }
        if (node.dataset.codexppSidebarActionPrevStyle === undefined) {
          node.dataset.codexppSidebarActionPrevStyle = node.style.cssText || "";
        }
        marked.add(node);
      }
      if (node.getAttribute(ATTR) !== value) node.setAttribute(ATTR, value);
    };

    const addClasses = (node, classes) => {
      const missing = classes.filter((className) => !node.classList.contains(className));
      if (missing.length) node.classList.add(...missing);
    };

    const setImportantStyle = (node, property, value) => {
      if (node.style.getPropertyValue(property) === value &&
          node.style.getPropertyPriority(property) === "important") {
        return;
      }
      node.style.setProperty(property, value, "important");
    };

    const findFullWidthMount = (sidebar, originals) => {
      const common = commonAncestor(originals);
      if (!(common instanceof HTMLElement)) return sidebar;

      const sidebarWidth = sidebar.getBoundingClientRect().width;
      let mount = common;
      while (
        mount.parentElement &&
        mount.parentElement !== sidebar &&
        mount.getBoundingClientRect().width < sidebarWidth * 0.7
      ) {
        mount = mount.parentElement;
      }
      return mount;
    };

    const createProxyButton = (action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${BUTTON_CLASS.replace(/\bflex\b/g, "").trim()} relative`;
      btn.setAttribute(ATTR, "button");
      btn.setAttribute("aria-label", action.label);
      btn.style.setProperty("display", "block", "important");
      btn.style.setProperty("width", "100%", "important");
      btn.style.setProperty("text-align", "left", "important");

      const iconWrap = document.createElement("div");
      iconWrap.className = "mb-1 h-5 w-5 text-token-text-secondary";
      iconWrap.style.setProperty("display", "block", "important");
      iconWrap.style.setProperty("width", "1.25rem", "important");
      iconWrap.style.setProperty("height", "1.25rem", "important");

      const icon = action.original.querySelector("svg")?.cloneNode(true);
      if (icon instanceof SVGElement) {
        icon.classList.add("icon-sm", "shrink-0", "text-token-text-secondary");
        icon.setAttribute("aria-hidden", "true");
        icon.removeAttribute("aria-label");
        icon.style.setProperty("display", "block", "important");
        iconWrap.appendChild(icon);
      }

      const text = document.createElement("div");
      text.setAttribute(ATTR, "label");
      text.className = "min-w-0 max-w-full truncate leading-tight";
      text.style.setProperty("display", "block", "important");
      text.style.setProperty("width", "100%", "important");
      text.textContent = action.label;
      btn.append(iconWrap, text);

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const live = findActionButtons({ includeHiddenSource: true })
          ?.find((candidate) => candidate.key === action.key)
          ?.original;
        activateOriginal(live || action.original);
      });

      return btn;
    };

    const activateOriginal = (original) => {
      if (!(original instanceof HTMLElement)) return;
      original.click();
      original.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      original.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      original.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
      );
      original.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
      );
      original.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    };

    const sourceHideTarget = (original) => {
      let node = original;
      while (
        node.parentElement &&
        node.parentElement !== wrapper &&
        node.parentElement.childElementCount === 1
      ) {
        node = node.parentElement;
      }
      return node;
    };

    const hideOriginals = (originals) => {
      for (const original of originals) {
        const target = sourceHideTarget(original);
        markNode(target, "source-original");
        target.style.setProperty("display", "none", "important");
      }
    };

    const stackOriginalButtonContent = (button) => {
      for (const node of button.querySelectorAll("kbd")) {
        if (node instanceof HTMLElement) {
          markNode(node, "shortcut");
          setImportantStyle(node, "display", "none");
        }
      }

      const content =
        Array.from(button.children).find(
          (child) =>
            child instanceof HTMLElement &&
            child.querySelector("svg") &&
            normalize(child.textContent || ""),
        ) || button;

      if (content instanceof HTMLElement) {
        if (content !== button) markNode(content, "content");
        setImportantStyle(content, "display", "flex");
        setImportantStyle(content, "flex-direction", "column");
        setImportantStyle(content, "align-items", "flex-start");
        setImportantStyle(content, "justify-content", "center");
        setImportantStyle(content, "gap", "var(--spacing-1, 0.25rem)");
        setImportantStyle(content, "width", "100%");
        setImportantStyle(content, "min-width", "0");
        setImportantStyle(content, "text-align", "left");
      }

      const icon = button.querySelector("svg");
      if (icon instanceof SVGElement) {
        setImportantStyle(icon, "display", "block");
        setImportantStyle(icon, "flex-shrink", "0");
      }
    };

    const apply = () => {
      const sidebar = findMainSidebar();
      if (!sidebar) return;

      const actionButtons = findActionButtons();
      if (!actionButtons) {
        cleanupMarks();
        return;
      }
      const originals = actionButtons.map((action) => action.original);

      const group = commonAncestor(originals);
      if (!(group instanceof HTMLElement)) return;
      const groupText = normalize(group.textContent || "");
      const groupRect = group.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      if (
        group.children.length > 8 ||
        groupRect.top - sidebarRect.top > 260 ||
        /\bpinned\b|\bprojects?\b/.test(groupText)
      ) {
        cleanupMarks();
        return;
      }

      markNode(group, "group");
      addClasses(group, WRAPPER_CLASS.split(/\s+/).filter(Boolean));

      for (const action of actionButtons) {
        const original = action.original;
        markNode(original, "button");
        addClasses(
          original,
          BUTTON_CLASS.replace(/\brelative\b/g, "")
            .split(/\s+/)
            .filter(Boolean),
        );
        setImportantStyle(original, "display", "flex");
        setImportantStyle(
          original,
          "border",
          "1px solid color-mix(in srgb, currentColor 14%, transparent)",
        );
        setImportantStyle(
          original,
          "background-color",
          "color-mix(in srgb, currentColor 5%, transparent)",
        );
        setImportantStyle(original, "flex-direction", "column");
        setImportantStyle(original, "align-items", "flex-start");
        setImportantStyle(original, "justify-content", "center");
        stackOriginalButtonContent(original);
      }
      activeOriginals = originals;
    };

    let scheduled = false;
    const scheduleApply = () => {
      if (scheduled) return;
      scheduled = true;
      // requestAnimationFrame (not setTimeout(0)) so apply()'s two
      // getBoundingClientRect() reads fire at most once per frame instead of on
      // every event-loop turn during streaming.
      window.requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    };

    clearStaleNodes();
    apply();
    const obs = new MutationObserver(scheduleApply);
    // No characterData: the action buttons' labels are static, so per-token
    // text mutations should never trigger a layout-reading re-apply.
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-label", "title"],
      childList: true,
      subtree: true,
    });

    api.log.info("sidebar action grid active");

    return () => {
      obs.disconnect();
      removeWrapper();
      cleanupMarks();
      style.remove();
    };
  },

  /**
   * Apply visual-only polish to the currently open slash command menu. The
   * feature marks menu roots for CSS and never intercepts item events, so Codex
   * keeps owning slash command selection and composer behavior.
   */
  "slash-menu-polish"(api) {
    const STYLE_ID = "codexpp-slash-menu-polish";
    const ATTR = "data-codexpp-slash-menu";
    let disposed = false;
    const marked = new Set();

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${ATTR}="true"] {
        border: 1px solid var(--color-token-border, var(--color-border, currentColor)) !important;
        border-radius: var(--radius-lg, 0.5rem) !important;
        box-shadow: 0 12px 36px rgb(9 9 11 / 0.16) !important;
        overflow: hidden !important;
      }

      [${ATTR}="true"] [role="option"],
      [${ATTR}="true"] [role="menuitem"],
      [${ATTR}="true"] button {
        border-radius: var(--radius-md, 0.375rem) !important;
        min-height: 2rem !important;
      }

      [${ATTR}="true"] [role="option"]:hover,
      [${ATTR}="true"] [role="menuitem"]:hover,
      [${ATTR}="true"] button:hover {
        background: var(--color-token-list-hover-background, var(--color-token-bg-fog, transparent)) !important;
      }

      [${ATTR}="true"] [aria-selected="true"],
      [${ATTR}="true"] [data-highlighted],
      [${ATTR}="true"] [data-state="checked"] {
        background: var(--color-token-list-selected-background, var(--color-token-bg-fog, transparent)) !important;
      }
    `;
    document.head.appendChild(style);

    const isVisible = (node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      if (node.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const computed = window.getComputedStyle(node);
      if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const hasMenuItems = (node) =>
      Boolean(node.querySelector("[role='option'], [role='menuitem'], button"));

    const isLikelySlashMenu = (node) => {
      if (!isVisible(node) || node.closest("[data-codexpp-settings-search]")) return false;
      const role = node.getAttribute("role");
      if (role !== "listbox" && role !== "menu") return false;
      if (!hasMenuItems(node)) return false;
      const active = document.activeElement;
      const composerActive = Boolean(
        active?.matches?.("textarea, [contenteditable='true'], [data-testid*='composer' i], [aria-label*='prompt' i]") ||
          active?.closest?.("form, [data-testid*='composer' i]"),
      );
      if (!composerActive) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom < window.innerHeight * 0.35) return false;
      }
      return true;
    };

    const apply = () => {
      if (disposed) return;
      const active = new Set();
      const candidates = document.querySelectorAll("[role='listbox'], [role='menu']");
      for (const node of candidates) {
        if (!(node instanceof HTMLElement) || !isLikelySlashMenu(node)) continue;
        active.add(node);
        marked.add(node);
        if (node.getAttribute(ATTR) !== "true") node.setAttribute(ATTR, "true");
      }
      for (const node of Array.from(marked)) {
        if (!node.isConnected || !active.has(node)) {
          node.removeAttribute?.(ATTR);
          marked.delete(node);
        }
      }
    };

    let scheduled = false;
    const scheduleApply = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "childList" ||
          (mutation.type === "attributes" && mutation.attributeName === "data-state")
        ) {
          scheduleApply();
          return;
        }
      }
    });

    apply();
    observer.observe(document.body || document.documentElement, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    });
    document.addEventListener("focusin", scheduleApply, true);
    api.log.info("slash menu polish active");

    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("focusin", scheduleApply, true);
      for (const node of marked) node.removeAttribute?.(ATTR);
      marked.clear();
      style.remove();
    };
  },

  /**
   * Provide a lightweight tweak mention picker for the composer. Codex owns
   * plugin (`@`) and skill (`/`) mentions internally; this mirrors that
   * ergonomics for installed tweaks by replacing the active `%query` token
   * with a stable, human-readable `%Tweak Name` mention.
   */
  "tweak-mention-menu"(api) {
    const STYLE_ID = "codexpp-tweak-mention-style";
    const MENU_ATTR = "data-codexpp-tweak-mention-menu";
    const ITEM_ATTR = "data-codexpp-tweak-mention-item";
    const MAX_QUERY_LENGTH = 80;
    const MAX_ITEMS = 8;
    let disposed = false;
    let menu = null;
    let activeTarget = null;
    let activeTrigger = null;
    let tweaks = [];
    let selectedIndex = 0;
    let loadPromise = null;
    let ignoreNextInput = false;
    let suppressSelectionRefresh = false;
    let lastComposerTarget = null;
    const prefixBoundaryChars = new Set([" ", "\t", "\n", "\r", "(", "[", "{", "\"", "'"]);

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${MENU_ATTR}="true"] {
        position: fixed;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 24px));
        max-height: min(320px, calc(100vh - 24px));
        overflow: auto;
        border: 1px solid var(--color-token-border, var(--color-border, currentColor));
        border-radius: var(--radius-lg, 0.5rem);
        background: var(--color-token-bg-primary, var(--color-bg-primary, Canvas));
        color: var(--color-token-text-primary, currentColor);
        box-shadow: 0 12px 36px rgb(9 9 11 / 0.18);
        padding: 4px;
      }

      [${MENU_ATTR}="true"] [${ITEM_ATTR}="true"] {
        display: flex;
        width: 100%;
        min-width: 0;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 0;
        border-radius: var(--radius-md, 0.375rem);
        background: transparent;
        color: inherit;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
      }

      [${MENU_ATTR}="true"] [${ITEM_ATTR}="true"]:hover,
      [${MENU_ATTR}="true"] [${ITEM_ATTR}="true"][aria-selected="true"] {
        background: var(--color-token-list-selected-background, var(--color-token-bg-fog, color-mix(in srgb, currentColor 8%, transparent)));
      }

      [${MENU_ATTR}="true"] [data-codexpp-tweak-mention-label] {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
      }

      [${MENU_ATTR}="true"] [data-codexpp-tweak-mention-meta] {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-token-text-secondary, currentColor);
        font-size: 12px;
        opacity: 0.78;
      }

      [${MENU_ATTR}="true"] [data-codexpp-tweak-mention-pill] {
        flex: none;
        color: var(--color-token-text-secondary, currentColor);
        font-size: 12px;
        opacity: 0.78;
      }
    `;
    document.head.appendChild(style);

    const ensureTweaks = () => {
      if (tweaks.length) return Promise.resolve(tweaks);
      if (loadPromise) return loadPromise;
      loadPromise = api.ipc
        .invoke("tweak-mentions-list")
        .then((items) => {
          tweaks = normalizeTweakMentionItems(items);
          return tweaks;
        })
        .catch((e) => {
          api.log.warn("[tweak-mention] installed tweak list unavailable", e);
          tweaks = [];
          return tweaks;
        })
        .finally(() => {
          loadPromise = null;
        });
      return loadPromise;
    };

    const closeMenu = () => {
      menu?.remove();
      menu = null;
      activeTarget = null;
      activeTrigger = null;
      selectedIndex = 0;
    };

    const matchesFor = (query) => {
      const needle = normalizeMentionSearch(query);
      const scored = [];
      for (const item of tweaks) {
        const haystacks = [item.label, item.name, item.id, ...(item.aliases || [])].map(normalizeMentionSearch);
        const exactPrefix = haystacks.some((value) => value.startsWith(needle));
        const wordPrefix = haystacks.some((value) => value.split(" ").some((part) => part.startsWith(needle)));
        const contains = haystacks.some((value) => value.includes(needle));
        if (needle && !exactPrefix && !wordPrefix && !contains) continue;
        scored.push({ item, score: exactPrefix ? 0 : wordPrefix ? 1 : contains ? 2 : 3 });
      }
      scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
      return scored.slice(0, MAX_ITEMS).map((entry) => entry.item);
    };

    const positionMenu = (target) => {
      if (!menu || !(target instanceof HTMLElement)) return;
      const rect = target.getBoundingClientRect();
      const menuHeight = Number(menu.offsetHeight) > 0 ? Number(menu.offsetHeight) : 280;
      const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.top - 12 - menuHeight));
      const left = Math.max(12, Math.min(window.innerWidth - 372, rect.left));
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    };

    const renderMenu = (target, trigger) => {
      const items = matchesFor(trigger.query);
      if (!items.length) {
        closeMenu();
        return;
      }
      activeTarget = target;
      activeTrigger = trigger;
      selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
      if (!menu) {
        menu = document.createElement("div");
        menu.setAttribute(MENU_ATTR, "true");
        menu.setAttribute("role", "listbox");
        menu.addEventListener("mousedown", (event) => event.preventDefault());
        document.body.appendChild(menu);
      }
      menu.replaceChildren();
      for (const [index, item] of items.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute(ITEM_ATTR, "true");
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === selectedIndex));
        button.addEventListener("mouseenter", () => {
          selectedIndex = index;
          updateSelectedMenuItem();
        });
        button.addEventListener("click", () => insertMention(item));

        const text = document.createElement("span");
        text.className = "min-w-0";
        const label = document.createElement("span");
        label.setAttribute("data-codexpp-tweak-mention-label", "true");
        label.textContent = item.label;
        const meta = document.createElement("span");
        meta.setAttribute("data-codexpp-tweak-mention-meta", "true");
        meta.textContent = item.enabled === false ? `${item.id} disabled` : item.id;
        text.append(label, meta);

        const pill = document.createElement("span");
        pill.setAttribute("data-codexpp-tweak-mention-pill", "true");
        pill.textContent = `%${item.label}`;
        button.append(text, pill);
        menu.appendChild(button);
      }
      positionMenu(target);
    };

    const updateSelectedMenuItem = () => {
      if (!menu) return;
      const items = Array.from(menu.querySelectorAll(`[${ITEM_ATTR}="true"]`));
      items.forEach((item, index) => item.setAttribute("aria-selected", String(index === selectedIndex)));
    };

    const refresh = async (target = activeComposerInput()) => {
      target = resolveComposerInput(target);
      if (disposed || !target) {
        closeMenu();
        return;
      }
      lastComposerTarget = target;
      const trigger = findTweakMentionTrigger(target);
      if (!trigger) {
        closeMenu();
        return;
      }
      await ensureTweaks();
      if (disposed) return;
      renderMenu(target, trigger);
    };

    const insertMention = (item) => {
      if (!activeTarget || !activeTrigger) return;
      ignoreNextInput = true;
      suppressSelectionRefresh = true;
      replaceComposerRange(activeTarget, activeTrigger.start, activeTrigger.end, `%${item.label}`);
      closeMenu();
    };

    const selectedItem = () => {
      if (!activeTrigger) return null;
      return matchesFor(activeTrigger.query)[selectedIndex] || null;
    };

    const onInput = (event) => {
      if (ignoreNextInput) {
        ignoreNextInput = false;
        return;
      }
      suppressSelectionRefresh = false;
      const target = resolveComposerInput(event.target);
      if (target) void refresh(target);
    };

    const scheduleRefresh = (target = activeComposerInput()) => {
      const resolved = resolveComposerInput(target);
      if (!resolved || disposed) return;
      lastComposerTarget = resolved;
      requestAnimationFrame(() => {
        if (!disposed) void refresh(resolved);
      });
    };

    const onBeforeInput = (event) => {
      if (event?.data !== "%" && event?.inputType !== "insertText") return;
      scheduleRefresh(event.target);
    };

    const onKeyup = (event) => {
      if (event.key === "%" || event.key === "Backspace" || event.key === "Delete" || event.key === " ") {
        scheduleRefresh(event.target);
      }
    };

    const onKeydown = (event) => {
      if (!menu) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const count = menu.querySelectorAll(`[${ITEM_ATTR}="true"]`).length;
        if (!count) return;
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = event.key === "ArrowDown"
          ? (selectedIndex + 1) % count
          : (selectedIndex - 1 + count) % count;
        updateSelectedMenuItem();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = selectedItem();
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        insertMention(item);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    };

    const onFocusChange = () => {
      window.setTimeout(() => {
        if (disposed) return;
        const active = activeComposerInput();
        if (!active || (menu && !document.activeElement?.closest?.(`[${MENU_ATTR}="true"]`))) {
          closeMenu();
        }
      }, 0);
    };

    const onResize = () => {
      if (activeTarget) positionMenu(activeTarget);
    };
    const onSelectionChange = () => {
      if (suppressSelectionRefresh) return;
      void refresh(activeComposerInput() || lastComposerTarget);
    };
    const onFocusIn = (event) => {
      const target = resolveComposerInput(event.target);
      if (target) lastComposerTarget = target;
    };

    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("keyup", onKeyup, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("selectionchange", onSelectionChange, true);
    document.addEventListener("focusout", onFocusChange, true);
    window.addEventListener("resize", onResize);
    api.log.info("tweak mention menu active");

    return () => {
      disposed = true;
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("keyup", onKeyup, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("selectionchange", onSelectionChange, true);
      document.removeEventListener("focusout", onFocusChange, true);
      window.removeEventListener("resize", onResize);
      closeMenu();
      style.remove();
    };

    function findTweakMentionTrigger(target) {
      const state = composerTextState(target);
      if (!state) return null;
      const before = state.text.slice(0, state.caret);
      const start = before.lastIndexOf("%");
      if (start < 0) return null;
      const previous = before[start - 1] || "";
      if (previous && !prefixBoundaryChars.has(previous)) return null;
      const query = before.slice(start + 1);
      if (query.length > MAX_QUERY_LENGTH || /[\r\n]/.test(query)) return null;
      if (/^\s/.test(query)) return null;
      if (/[\\/]/.test(query)) return null;
      return { start, end: state.caret, query };
    }
  },

  /**
   * Let sidebar chat rows be multi-selected with Cmd/Ctrl-click, then expose
   * batch actions from a right-click menu. We deliberately call Codex's native
   * controls for the actual actions so the app owns persistence and side
   * effects.
   */
  "sidebar-chat-multi-select"(api) {
    const STYLE_ID = "codexpp-sidebar-chat-multi-select";
    const ROW_ATTR = "data-codexpp-sidebar-chat-selectable";
    const SELECTED_ATTR = "data-codexpp-sidebar-chat-selected";
    const TARGET_ATTR = "data-codexpp-sidebar-chat-selected-target";
    const MENU_ATTR = "data-codexpp-sidebar-chat-multi-select-menu";
    const ASIDE_SELECTOR = [
      "aside.pointer-events-auto.relative.flex.overflow-hidden",
      "aside.pointer-events-auto.relative.flex.overflow-visible",
      "aside.pointer-events-auto.relative.flex",
    ].join(", ");
    const THREAD_SELECTOR = [
      "[data-app-action-sidebar-thread-row]",
      "[data-app-action-sidebar-thread-id]",
      "[data-app-action-sidebar-task-id]",
      "[data-sidebar-thread-id]",
      "[data-app-action-sidebar-thread-pinned]",
      "[data-app-action-sidebar-task-pinned]",
      "[data-sidebar-thread-pinned]",
    ].join(", ");
    const selectedIds = new Set();
    let disposed = false;
    let lastAnchorId = null;
    let actionInProgress = false;

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${ROW_ATTR}="true"] {
        user-select: none !important;
      }

      [${TARGET_ATTR}="true"] {
        background-color: var(--color-token-list-hover-background, color-mix(in srgb, currentColor 8%, transparent)) !important;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 38%, transparent) !important;
      }

      [${MENU_ATTR}="item"][disabled] {
        cursor: default !important;
        opacity: 0.45 !important;
      }

      [${MENU_ATTR}="label"] {
        flex: 1 1 auto !important;
        min-width: 0 !important;
      }
    `;
    document.head.appendChild(style);

    const normalizeThreadId = (value) =>
      String(value || "")
        .trim()
        .replace(/^(local|remote|pending-worktree):/, "");

    const attrValue = (node, names) => {
      if (!(node instanceof HTMLElement)) return null;
      for (const name of names) {
        const value = node.getAttribute(name);
        if (value != null && value !== "") return value;
      }
      const suffixes = new Set(names.map((name) => name.split("-").at(-1)));
      for (const attr of Array.from(node.attributes || [])) {
        const name = attr.name.toLowerCase();
        if (!name.includes("sidebar") || !name.includes("thread")) continue;
        if (
          names.some((expected) => name.endsWith(expected.replace(/^data-/, ""))) ||
          Array.from(suffixes).some((suffix) => name.endsWith(`-${suffix}`))
        ) {
          return attr.value;
        }
      }
      return null;
    };

    const threadMeta = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      const id = attrValue(node, [
        "data-app-action-sidebar-thread-id",
        "data-app-action-sidebar-task-id",
        "data-sidebar-thread-id",
      ]);
      const kind = attrValue(node, [
        "data-app-action-sidebar-thread-kind",
        "data-app-action-sidebar-task-kind",
        "data-sidebar-thread-kind",
      ]);
      if (!id || (kind && kind !== "local")) return null;
      return { id: normalizeThreadId(id) };
    };

    const mainSidebar = () => {
      const aside = document.querySelector(ASIDE_SELECTOR);
      return aside instanceof HTMLElement ? aside : null;
    };

    const interactiveTargetFor = (host, row) => {
      const interactive = host?.closest?.(
        [
          "[role='button']",
          "a",
          "button",
          "[class*='hover:bg-token-list-hover-background']",
          "[class*='bg-token-list-selected-background']",
          "[class*='bg-token-list-hover-background']",
        ].join(", "),
      );
      if (interactive instanceof HTMLElement && row?.contains?.(interactive)) {
        return interactive;
      }
      return host instanceof HTMLElement ? host : row;
    };

    const threadRows = () => {
      const sidebar = mainSidebar();
      if (!sidebar) return [];
      const rows = new Map();
      const candidates = sidebar.querySelectorAll(`${THREAD_SELECTOR}, [role='listitem']`);
      for (const node of candidates) {
        if (!(node instanceof HTMLElement)) continue;
        const source = threadMeta(node) ? node : node.querySelector?.(THREAD_SELECTOR);
        const meta = threadMeta(source);
        if (!meta?.id) continue;
        const row = source.closest("[role='listitem']") || source;
        const host = source instanceof HTMLElement ? source : row;
        if (!(row instanceof HTMLElement) || !(host instanceof HTMLElement)) continue;
        rows.set(meta.id, {
          id: meta.id,
          row,
          host,
          target: interactiveTargetFor(host, row),
        });
      }
      return Array.from(rows.values());
    };

    const rowRecordFromTarget = (target) => {
      if (!(target instanceof Element)) return null;
      const source =
        target.closest?.(THREAD_SELECTOR) ||
        target.closest?.("[role='listitem']")?.querySelector?.(THREAD_SELECTOR);
      const row = source?.closest?.("[role='listitem']");
      if (!(source instanceof HTMLElement) || !(row instanceof HTMLElement)) return null;
      const meta = threadMeta(source);
      if (!meta?.id) return null;
      return {
        id: meta.id,
        row,
        host: source,
        target: interactiveTargetFor(source, row),
      };
    };

    const selectedRecords = () => {
      const rows = threadRows();
      return Array.from(selectedIds)
        .map((id) => rows.find((row) => row.id === id))
        .filter(Boolean);
    };

    const clearSelection = ({ closeMenu = true } = {}) => {
      selectedIds.clear();
      lastAnchorId = null;
      if (closeMenu) closeNativeMenu();
      applySelection();
    };

    const toggleSelection = (id) => {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      lastAnchorId = id;
      applySelection();
    };

    const selectRangeTo = (id) => {
      const rows = threadRows();
      const start = rows.findIndex((row) => row.id === lastAnchorId);
      const end = rows.findIndex((row) => row.id === id);
      if (start < 0 || end < 0) {
        toggleSelection(id);
        return;
      }
      const [from, to] = start < end ? [start, end] : [end, start];
      for (const row of rows.slice(from, to + 1)) selectedIds.add(row.id);
      applySelection();
    };

    // Fingerprint cache (Phase 5.4): the heavy DOM rewrite below is skipped
    // when both the row-id set and the selection set are unchanged from the
    // last apply. During token streaming the sidebar contents don't shift,
    // so this is the common case.
    let lastApplyFingerprint = null;
    const applySelection = () => {
      const rows = threadRows();
      const visibleIds = new Set(rows.map((row) => row.id));
      for (const id of Array.from(selectedIds)) {
        if (!visibleIds.has(id)) selectedIds.delete(id);
      }
      const fingerprint =
        rows.map((row) => row.id).sort().join("|") +
        "::" +
        Array.from(selectedIds).sort().join("|");
      if (fingerprint === lastApplyFingerprint) return;
      lastApplyFingerprint = fingerprint;
      document
        .querySelectorAll(`[${ROW_ATTR}], [${SELECTED_ATTR}], [${TARGET_ATTR}]`)
        .forEach((node) => {
          node.removeAttribute?.(ROW_ATTR);
          node.removeAttribute?.(SELECTED_ATTR);
          node.removeAttribute?.(TARGET_ATTR);
        });
      for (const record of rows) {
        record.row.setAttribute(ROW_ATTR, "true");
        if (!selectedIds.has(record.id)) continue;
        record.row.setAttribute(SELECTED_ATTR, "true");
        record.target?.setAttribute?.(TARGET_ATTR, "true");
      }
    };

    const isNativeActionClick = (target) =>
      Boolean(target?.closest?.("button, input, textarea, select, [contenteditable='true']"));

    const shouldLetNativeNavigationProceed = (event, record) =>
      Boolean(
        record &&
          !isNativeActionClick(event.target) &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          (event.button == null || event.button === 0),
      );

    const clearSelectionBeforeNativeNavigation = (event, record) => {
      if (!selectedIds.size || !shouldLetNativeNavigationProceed(event, record)) return false;
      clearSelection({ closeMenu: false });
      return true;
    };

    const normalizeMenuText = (value) => String(value || "").replace(/\s+/g, " ").trim();

    const isVisibleElement = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 };
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle?.(node);
      return !style || (style.display !== "none" && style.visibility !== "hidden");
    };

    const isBoundedMenuPopover = (node) => {
      if (!(node instanceof HTMLElement) || !isVisibleElement(node)) return false;
      if (node === document.body || node === document.documentElement) return false;
      const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 };
      const maxWidth = Math.max(360, Math.min(window.innerWidth || 1280, 900));
      const maxHeight = Math.max(220, Math.min(window.innerHeight || 800, 720));
      return rect.width >= 120 && rect.height >= 48 && rect.width <= maxWidth && rect.height <= maxHeight;
    };

    const menuText = (node) => normalizeMenuText(node?.textContent || "");

    const isKnownNativeMenuText = (text) =>
      /open in mini window/i.test(text) ||
      /\b(remove|delete|archive|pin)\b/i.test(text);

    const closestNativeMenu = (target) => {
      if (!(target instanceof HTMLElement)) return null;
      const semantic = target.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]');
      if (semantic instanceof HTMLElement) return semantic;
      let node = target.parentElement;
      let best = null;
      while (node instanceof HTMLElement && node !== document.body && node !== document.documentElement) {
        const text = menuText(node);
        if (isBoundedMenuPopover(node) && isKnownNativeMenuText(text)) best = node;
        node = node.parentElement;
      }
      return best;
    };

    const nativeMenuItems = (root) =>
      Array.from(root.querySelectorAll('[role="menuitem"], [data-radix-collection-item], button'))
        .filter((item) => item instanceof HTMLElement && isVisibleElement(item));

    const onClick = (event) => {
      if (disposed || actionInProgress) return;
      const record = rowRecordFromTarget(event.target);
      if (!record) {
        if (selectedIds.size && !closestNativeMenu(event.target)) clearSelection();
        return;
      }
      if (isNativeActionClick(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (event.shiftKey) selectRangeTo(record.id);
        else toggleSelection(record.id);
        return;
      }
      clearSelectionBeforeNativeNavigation(event, record);
    };

    const onContextMenu = (event) => {
      if (disposed || actionInProgress) return;
      const record = rowRecordFromTarget(event.target);
      if (selectedIds.size <= 1) return;
      if (record && !selectedIds.has(record.id)) return;
      if (!record && !mainSidebar()?.contains?.(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void openNativeBatchMenu(event.clientX, event.clientY);
    };

    const onPointerDown = (event) => {
      if (disposed || actionInProgress) return;
      const record = rowRecordFromTarget(event.target);
      if (event.button === 0) {
        clearSelectionBeforeNativeNavigation(event, record);
        return;
      }
      if (event.button !== 2) return;
      if (selectedIds.size <= 1) return;
      if (record && !selectedIds.has(record.id)) return;
      if (!record && !mainSidebar()?.contains?.(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void openNativeBatchMenu(event.clientX, event.clientY);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape" && selectedIds.size) {
        event.preventDefault();
        clearSelection();
      }
    };

    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const clickElement = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      node.click();
      return true;
    };

    const buttonByAria = (row, label) =>
      Array.from(row.querySelectorAll("button"))
        .find((button) => button instanceof HTMLElement && button.getAttribute("aria-label") === label) || null;

    const runRowButtonAction = async (label) => {
      const records = selectedRecords();
      closeNativeMenu();
      actionInProgress = true;
      try {
        for (const record of records) {
          const button = buttonByAria(record.row, label);
          if (!button) continue;
          clickElement(button);
          await wait(90);
        }
      } finally {
        actionInProgress = false;
        clearSelection();
      }
    };

    const findChatActionsButton = () =>
      Array.from(document.querySelectorAll("button, [role='button']"))
        .find((node) => node instanceof HTMLElement && node.getAttribute("aria-label") === "Chat actions") || null;

    const openMenuRoots = () => {
      const roots = Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'))
        .filter((node) => node instanceof HTMLElement && isVisibleElement(node));
      for (const item of Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [data-radix-collection-item]'))) {
        if (!(item instanceof HTMLElement) || !/open in mini window/i.test(menuText(item))) continue;
        const root = closestNativeMenu(item);
        if (root && !roots.includes(root)) roots.push(root);
      }
      return roots;
    };

    const findOpenMiniWindowItem = () => {
      for (const root of openMenuRoots()) {
        const item = nativeMenuItems(root).find((node) => /open in mini window/i.test(menuText(node)));
        if (item) return item;
      }
      return null;
    };

    const openHeaderActionsMenu = async () => {
      const button = findChatActionsButton();
      if (!button) return false;
      clickElement(button);
      for (let i = 0; i < 8; i += 1) {
        await wait(80);
        if (findOpenMiniWindowItem()) return true;
      }
      return false;
    };

    const openRowsInMiniWindows = async () => {
      const ids = Array.from(selectedIds);
      closeNativeMenu();
      actionInProgress = true;
      try {
        for (const id of ids) {
          const record = threadRows().find((row) => row.id === id);
          if (!record) continue;
          clickElement(record.target || record.host);
          await wait(450);
          const hasMenu = await openHeaderActionsMenu();
          if (!hasMenu) {
            api.log.warn("[sidebar-chat-multi-select] chat actions menu unavailable", { id });
            continue;
          }
          const item = findOpenMiniWindowItem();
          if (!item) {
            api.log.warn("[sidebar-chat-multi-select] open mini window item unavailable", { id });
            continue;
          }
          clickElement(item);
          await wait(300);
        }
      } finally {
        actionInProgress = false;
        clearSelection();
      }
    };

    const actionAvailability = () => {
      const records = selectedRecords();
      return {
        count: selectedIds.size || records.length,
        canPin: records.some((record) => buttonByAria(record.row, "Pin chat")),
        canArchive: records.some((record) => buttonByAria(record.row, "Archive chat")),
      };
    };

    const openNativeBatchMenu = async (x, y) => {
      const { count, canPin, canArchive } = actionAvailability();
      if (!count) return;
      if (openNativeBatchMenu._open) return;
      openNativeBatchMenu._open = true;
      let action = null;
      try {
        action =
          (await api.ipc.invoke("sidebar-chat-batch-menu", {
            x,
            y,
            count,
            canPin,
            canArchive,
          })) || null;
      } catch (e) {
        api.log.warn("[sidebar-chat-multi-select] native batch menu unavailable", e);
        return;
      } finally {
        openNativeBatchMenu._open = false;
      }
      if (action === "pin") await runRowButtonAction("Pin chat");
      else if (action === "archive") await runRowButtonAction("Archive chat");
      else if (action === "mini-window") await openRowsInMiniWindows();
    };

    const closeNativeMenu = () => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }));
    };

    let scheduled = false;
    const scheduleApply = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        applySelection();
      });
    };

    applySelection();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("keydown", onKeyDown, true);

    api.log.info("sidebar chat multi-select active");

    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("keydown", onKeyDown, true);
      closeNativeMenu();
      selectedIds.clear();
      document
        .querySelectorAll(`[${ROW_ATTR}], [${SELECTED_ATTR}], [${TARGET_ATTR}]`)
        .forEach((node) => {
          node.removeAttribute?.(ROW_ATTR);
          node.removeAttribute?.(SELECTED_ATTR);
          node.removeAttribute?.(TARGET_ATTR);
        });
      style.remove();
    };
  },

  /**
   * Show a small project label under pinned sidebar chats. When Codex's
   * sidebar is organized as a chronological list, show it under every local
   * chat because project grouping is no longer visible.
   */
  "show-pinned-chat-project-names"(api) {
    const STYLE_ID = "codexpp-pinned-chat-project-names";
    const ATTR = "data-codexpp-pinned-chat-project-name";
    const ROW_ATTR = "data-codexpp-pinned-chat-project-name-row";
    const CONTENT_ATTR = "data-codexpp-pinned-chat-project-name-content";
    const COMPACT_ATTR = "data-codexpp-pinned-chat-project-name-compact-row";
    const COLOR_STORAGE_KEY = PROJECT_COLOR_STORAGE_KEY;
    const ORGANIZE_MODE_KEY = "codex:persisted-atom:sidebar-organize-mode-v1";
    const ASIDE_SELECTOR = [
      "aside.pointer-events-auto.relative.flex.overflow-hidden",
      "aside.pointer-events-auto.relative.flex.overflow-visible",
      "aside.pointer-events-auto.relative.flex",
    ].join(", ");
    const labels = new Map();
    let disposed = false;
    let refreshInFlight = false;
    let lastRefreshAt = 0;
    let lastRenderedSignature = "";

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${ATTR}="label"] {
        display: flex !important;
        align-items: center !important;
        gap: 0 !important;
        position: absolute !important;
        left: var(--codexpp-pinned-chat-project-label-left, 2rem) !important;
        right: var(--codexpp-pinned-chat-project-label-right, 2rem) !important;
        bottom: 0.1875rem !important;
        max-width: none !important;
        min-width: 0 !important;
        overflow: visible !important;
        color: var(--color-token-text-secondary, currentColor) !important;
        font-size: 0.6875rem !important;
        line-height: 0.875rem !important;
        opacity: 0.75 !important;
        pointer-events: none !important;
      }

      [${ATTR}="dot"] {
        width: 0.375rem !important;
        height: 0.375rem !important;
        border-radius: 9999px !important;
        flex: 0 0 auto !important;
        margin-left: 1px !important;
        background-color: var(--codexpp-pinned-chat-project-color, currentColor) !important;
      }

      [${ATTR}="label"]:has([${ATTR}="dot"]) {
        gap: 0.375rem !important;
      }

      [${ATTR}="label-text"] {
        display: block !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      [${CONTENT_ATTR}="true"] {
        position: relative !important;
        transform: translateY(-0.3125rem) !important;
      }

      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child {
        align-items: center !important;
        display: flex !important;
        height: 100% !important;
        justify-content: center !important;
        position: absolute !important;
        left: -0.25rem !important;
        top: 0.3125rem !important;
        width: 1.5rem !important;
        z-index: 20 !important;
        transform: none !important;
      }

      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child button {
        align-items: center !important;
        border: 1px solid transparent !important;
        border-radius: 9999px !important;
        color: var(--color-token-muted-foreground, currentColor) !important;
        cursor: var(--cursor-interaction, pointer) !important;
        display: flex !important;
        gap: 0.25rem !important;
        height: 1.25rem !important;
        justify-content: center !important;
        opacity: 0.5 !important;
        padding: 0 !important;
        pointer-events: auto !important;
        user-select: none !important;
        white-space: nowrap !important;
        width: 1.25rem !important;
      }

      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child button:hover,
      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child button:focus-visible {
        color: var(--color-token-foreground, currentColor) !important;
        opacity: 1 !important;
      }

      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child button > svg {
        height: 1rem !important;
        width: 1rem !important;
      }

      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child + div {
        margin-left: 0.125rem !important;
        padding-left: 0 !important;
      }

      [${COMPACT_ATTR}="true"] [${CONTENT_ATTR}="true"] > .w-4:first-child + div > div {
        padding-right: 0.75rem !important;
      }

      [${COMPACT_ATTR}="true"]:hover [${CONTENT_ATTR}="true"] > .w-4:first-child + div > div,
      [${COMPACT_ATTR}="true"]:focus-within [${CONTENT_ATTR}="true"] > .w-4:first-child + div > div {
        -webkit-mask-image: linear-gradient(to right, transparent 0, transparent 21px, black 26px) !important;
        mask-image: linear-gradient(to right, transparent 0, transparent 21px, black 26px) !important;
      }

      [${COMPACT_ATTR}="true"]:hover > [${ATTR}="label"],
      [${COMPACT_ATTR}="true"]:focus-within > [${ATTR}="label"] {
        -webkit-mask-image: linear-gradient(to right, transparent 0, transparent 21px, black 26px) !important;
        mask-image: linear-gradient(to right, transparent 0, transparent 21px, black 26px) !important;
      }

      [${ROW_ATTR}="true"] {
        --padding-row-y: 0 !important;
        box-sizing: border-box !important;
        height: 2.375rem !important;
        min-height: 2.375rem !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
      }
    `;
    document.head.appendChild(style);

    const mainSidebar = () => {
      const aside = document.querySelector(ASIDE_SELECTOR);
      return aside instanceof HTMLElement ? aside : null;
    };

    const normalizeThreadId = (value) =>
      String(value || "")
        .trim()
        .replace(/^(local|remote|pending-worktree):/, "");

    const normalizeProjectName = (value) =>
      String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

    const normalizeProjectPath = (value) =>
      String(value || "")
        .replace(/^file:\/\//, "")
        .replace(/[\\/]+$/, "")
        .toLowerCase();

    const sidebarOrganizeMode = () => {
      try {
        const raw = window.localStorage?.getItem(ORGANIZE_MODE_KEY);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      } catch {
        return null;
      }
    };

    const hasVisibleProjectRows = (sidebar) =>
      Array.from(sidebar.querySelectorAll(
        "[data-app-action-sidebar-project-row], div[role='listitem'].group\\/cwd",
      )).some((node) => node instanceof HTMLElement && node.getBoundingClientRect().height > 0);

    const hasThreadRows = (sidebar) =>
      Boolean(sidebar.querySelector(
        [
          "[data-app-action-sidebar-thread-row]",
          "[data-app-action-sidebar-thread-id]",
          "[data-app-action-sidebar-task-id]",
          "[data-sidebar-thread-id]",
        ].join(", "),
      ));

    const hasAllChatsSection = (sidebar) =>
      Boolean(sidebar.querySelector('[data-app-action-sidebar-section-heading="All chats"]'));

    const isChronologicalList = (sidebar = mainSidebar()) => {
      if (sidebar && hasAllChatsSection(sidebar)) return true;
      const mode = sidebarOrganizeMode();
      if (mode === "all") return true;
      if (mode === "project") return false;
      return Boolean(sidebar && hasThreadRows(sidebar) && !hasVisibleProjectRows(sidebar));
    };

    const projectInfoFor = (record) => {
      const fallbackLabel = typeof record === "string" ? record : record?.label;
      const cwd = typeof record?.cwd === "string" ? record.cwd : "";
      const live = liveProjectInfoFor(fallbackLabel, cwd);
      return {
        label: live.label || fallbackLabel || "",
        color: live.color || projectColorFor(live.label || fallbackLabel || ""),
      };
    };

    const projectColorFor = (label) => {
      const key = normalizeProjectName(label);
      const storedPrefs = api.storage.get(COLOR_STORAGE_KEY, {});
      const prefs = {
        ...(storedPrefs && typeof storedPrefs === "object" && !Array.isArray(storedPrefs)
          ? storedPrefs
          : {}),
        ...(window.__codexppSidebarProjectColorPrefs || {}),
      };
      const colors = {
        blue: "var(--color-token-charts-blue, var(--color-token-text-link-foreground))",
        green: "var(--color-token-charts-green, var(--color-token-text-secondary))",
        yellow: "var(--color-token-charts-yellow, var(--color-token-text-secondary))",
        red: "var(--color-token-charts-red, var(--color-token-text-secondary))",
        pink: "var(--pink-400, var(--color-token-charts-purple, var(--color-token-text-link-foreground)))",
        purple: "var(--color-token-charts-purple, var(--color-token-text-link-foreground))",
        gray: "var(--color-token-text-secondary)",
      };
      if (colors[prefs[key]]) return colors[prefs[key]];

      const auto = ["blue", "green", "yellow", "red"];
      let hash = 0;
      for (let i = 0; i < key.length; i += 1) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      }
      return colors[auto[hash % auto.length]];
    };

    const liveProjectInfoFor = (label, cwd) => {
      const key = normalizeProjectName(label);
      const pathKey = normalizeProjectPath(cwd);
      const rows = document.querySelectorAll('[data-codexpp-sidebar-project-backgrounds="row"]');
      for (const row of rows) {
        if (!(row instanceof HTMLElement)) continue;
        const action = row.querySelector("[data-app-action-sidebar-project-id]");
        const projectPath = action instanceof HTMLElement
          ? normalizeProjectPath(action.getAttribute("data-app-action-sidebar-project-id"))
          : "";
        const rowLabelText =
          row.getAttribute("aria-label") ||
            row.getAttribute("title") ||
            "";
        const rowLabel = normalizeProjectName(rowLabelText);
        const pathMatches = pathKey && projectPath && (
          pathKey === projectPath ||
          pathKey.startsWith(`${projectPath}/`) ||
          projectPath.startsWith(`${pathKey}/`)
        );
        if (!pathMatches && (!key || rowLabel !== key)) continue;
        const color =
          row.style.getPropertyValue("--codexpp-project-tint").trim() ||
          window.getComputedStyle(row).getPropertyValue("--codexpp-project-tint").trim();
        return { label: rowLabelText, color };
      }
      return { label: "", color: "" };
    };

    const attrValue = (node, names) => {
      for (const name of names) {
        const value = node.getAttribute(name);
        if (value != null && value !== "") return value;
      }
      const suffixes = new Set(names.map((name) => name.split("-").at(-1)));
      for (const attr of Array.from(node.attributes || [])) {
        const name = attr.name.toLowerCase();
        if (!name.includes("sidebar") || !name.includes("thread")) continue;
        if (
          names.some((expected) => name.endsWith(expected.replace(/^data-/, ""))) ||
          Array.from(suffixes).some((suffix) => name.endsWith(`-${suffix}`))
        ) {
          return attr.value;
        }
      }
      return null;
    };

    const threadMeta = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      const id = attrValue(node, [
        "data-app-action-sidebar-thread-id",
        "data-app-action-sidebar-task-id",
        "data-sidebar-thread-id",
      ]);
      const pinned = attrValue(node, [
        "data-app-action-sidebar-thread-pinned",
        "data-app-action-sidebar-task-pinned",
        "data-sidebar-thread-pinned",
      ]);
      const kind = attrValue(node, [
        "data-app-action-sidebar-thread-kind",
        "data-app-action-sidebar-task-kind",
        "data-sidebar-thread-kind",
      ]);
      const isPinned = String(pinned) === "true";
      if (!id || (kind && kind !== "local")) return null;
      return { id: normalizeThreadId(id), pinned: isPinned };
    };

    const threadRows = () => {
      const sidebar = mainSidebar();
      if (!sidebar) return [];
      const includeAllLocalChats = isChronologicalList(sidebar);
      const rows = new Map();
      const candidates = sidebar.querySelectorAll(
        [
          "[data-app-action-sidebar-thread-row]",
          "[data-app-action-sidebar-thread-id]",
          "[data-app-action-sidebar-task-id]",
          "[data-sidebar-thread-id]",
          "[data-app-action-sidebar-thread-pinned]",
          "[data-app-action-sidebar-task-pinned]",
          "[data-sidebar-thread-pinned]",
          "[role='listitem']",
        ].join(", "),
      );
      for (const node of candidates) {
        if (!(node instanceof HTMLElement)) continue;
        const source = threadMeta(node) ? node : node.querySelector?.(
          [
            "[data-app-action-sidebar-thread-row]",
            "[data-app-action-sidebar-thread-id]",
            "[data-app-action-sidebar-task-id]",
            "[data-sidebar-thread-id]",
            "[data-app-action-sidebar-thread-pinned]",
            "[data-app-action-sidebar-task-pinned]",
            "[data-sidebar-thread-pinned]",
          ].join(", "),
        );
        const meta = threadMeta(source);
        if (!meta?.id) continue;
        if (!meta.pinned && !includeAllLocalChats) continue;
        const row = source.closest("[role='listitem']") || source;
        const host = source instanceof HTMLElement ? source : row;
        if (row instanceof HTMLElement && host instanceof HTMLElement) {
          const title = findThreadTitle(host, row);
          rows.set(meta.id, { row, host, title, id: meta.id, pinned: meta.pinned });
        }
      }
      return Array.from(rows.values());
    };

    const findThreadTitle = (host, row) => {
      const selectors = [
        "[data-thread-title]",
        "[data-app-action-sidebar-thread-title]",
        "[data-app-action-sidebar-task-title]",
      ];
      for (const selector of selectors) {
        const node = host.querySelector(selector) || row.querySelector(selector);
        if (node instanceof HTMLElement) return node;
      }

      const title = attrValue(host, [
        "data-app-action-sidebar-thread-title",
        "data-app-action-sidebar-task-title",
        "data-sidebar-thread-title",
      ]);
      if (!title) return null;
      return Array.from(host.querySelectorAll("span, div"))
        .filter((node) => node instanceof HTMLElement)
        .find((node) => compactText(node.textContent) === compactText(title)) || null;
    };

    const backgroundTargetsFor = (host, row) => {
      const interactive = host?.closest?.(
        [
          "[role='button']",
          "a",
          "button",
          "[class*='hover:bg-token-list-hover-background']",
          "[class*='bg-token-list-selected-background']",
          "[class*='bg-token-list-hover-background']",
        ].join(", "),
      );
      if (interactive instanceof HTMLElement && row?.contains?.(interactive)) {
        return [interactive];
      }
      return host instanceof HTMLElement ? [host] : [];
    };

    const reconcileRowPaddingTargets = (row, targets) => {
      const active = new Set(targets);
      const marked = [
        row,
        ...Array.from(row?.querySelectorAll?.(`[${ROW_ATTR}="true"]`) || []),
      ];
      for (const node of marked) {
        if (node instanceof HTMLElement && !active.has(node)) {
          node.removeAttribute(ROW_ATTR);
        }
      }
    };

    const contentTargetFor = (host, title) => {
      if (!(host instanceof HTMLElement)) return null;
      if (title instanceof HTMLElement) {
        for (const child of Array.from(host.children)) {
          if (child instanceof HTMLElement && child.contains(title)) return child;
        }
        return title.parentElement instanceof HTMLElement ? title.parentElement : null;
      }
      return host.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
    };

    const setLabelInlinePosition = (node, host, title) => {
      if (!(node instanceof HTMLElement) || !(host instanceof HTMLElement)) return;
      const anchor = title instanceof HTMLElement ? title : host;
      const hostRect = host.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const left = Math.max(0, anchorRect.left - hostRect.left);
      const right = Math.max(0, hostRect.right - anchorRect.right);
      node.style.setProperty("--codexpp-pinned-chat-project-label-left", `${left}px`);
      node.style.setProperty("--codexpp-pinned-chat-project-label-right", `${right}px`);
    };

    const removeStaleLabels = (activeRows) => {
      const active = new Set(activeRows.map((item) => item.row));
      if (active.size === 0) lastRenderedSignature = "";
      document.querySelectorAll(`[${ATTR}="label"]`).forEach((node) => {
        const row = node.closest("[role='listitem']");
        if (!row || !active.has(row)) node.remove();
      });
      document.querySelectorAll(`[${ATTR}="title-stack"], [${ATTR}="title"]`)
        .forEach((node) => node.removeAttribute(ATTR));
      document.querySelectorAll(`[${CONTENT_ATTR}="true"]`)
        .forEach((node) => {
          const row = node.closest("[role='listitem']");
          if (!row || !active.has(row)) node.removeAttribute(CONTENT_ATTR);
        });
      document.querySelectorAll(`[${COMPACT_ATTR}="true"]`).forEach((node) => {
        const row = node.closest("[role='listitem']");
        if (!row || !active.has(row)) node.removeAttribute(COMPACT_ATTR);
      });
      document.querySelectorAll(`[${ROW_ATTR}="true"]`).forEach((node) => {
        const row = node.closest("[role='listitem']");
        if (!row || !active.has(row)) node.removeAttribute(ROW_ATTR);
      });
    };

    const labelGeometrySignature = (row, host, title) => {
      const rowRect = row?.getBoundingClientRect?.();
      const titleRect = title?.getBoundingClientRect?.();
      const hostRect = host?.getBoundingClientRect?.();
      return [
        Math.round(rowRect?.width || 0),
        Math.round(hostRect?.left || 0),
        Math.round(hostRect?.right || 0),
        Math.round(titleRect?.left || 0),
        Math.round(titleRect?.right || 0),
      ].join(":");
    };

    const pinnedChatProjectLabelsSignature = (entries, showAllLocalChats, showDot) =>
      [
        showAllLocalChats ? "all-local" : "pinned-only",
        showDot ? "dot" : "plain",
        ...entries.map(({ id, pinned, row, host, title, info }) =>
          [
            id,
            pinned ? "pinned" : "unpinned",
            info.label,
            info.color,
            labelGeometrySignature(row, host, title),
          ].join("\t"),
        ),
      ].join("\n");

    const renderLabels = () => {
      const rows = threadRows();
      const showAllLocalChats = isChronologicalList();
      const showDot = readFlag(api, "sidebar-project-backgrounds", true) && !showAllLocalChats;
      const entries = rows.map((row) => ({
        ...row,
        info: projectInfoFor(labels.get(row.id)),
      }));
      const signature = pinnedChatProjectLabelsSignature(entries, showAllLocalChats, showDot);
      if (signature === lastRenderedSignature) return;
      lastRenderedSignature = signature;
      removeStaleLabels(rows);
      for (const { row, host, title, pinned, info } of entries) {
        const label = info.label;
        const target = host instanceof HTMLElement ? host : row;
        const existing = target.querySelector(`[${ATTR}="label"]`);
        const contentTarget = contentTargetFor(target, title);
        if (!label) {
          existing?.remove();
          title?.removeAttribute(ATTR);
          target.removeAttribute(ATTR);
          contentTarget?.removeAttribute(CONTENT_ATTR);
          target.removeAttribute(COMPACT_ATTR);
          reconcileRowPaddingTargets(row, []);
          continue;
        }
        const paddingTargets = backgroundTargetsFor(host, row);
        reconcileRowPaddingTargets(row, paddingTargets);
        paddingTargets.forEach((node) =>
          node.setAttribute(ROW_ATTR, "true"),
        );
        title?.removeAttribute(ATTR);
        target.removeAttribute(ATTR);
        if (showAllLocalChats && !pinned) {
          target.setAttribute(COMPACT_ATTR, "true");
        } else {
          target.removeAttribute(COMPACT_ATTR);
        }
        contentTarget?.setAttribute(CONTENT_ATTR, "true");
        const node = existing instanceof HTMLElement
          ? existing
          : document.createElement("div");
        node.setAttribute(ATTR, "label");
        setLabelInlinePosition(node, target, title);
        node.style.setProperty("--codexpp-pinned-chat-project-color", info.color);
        const showDot = readFlag(api, "sidebar-project-backgrounds", true) && !showAllLocalChats;
        let dot = node.querySelector(`[${ATTR}="dot"]`);
        if (!showDot) {
          dot?.remove();
          dot = null;
        } else if (!(dot instanceof HTMLElement)) {
          dot = document.createElement("span");
          dot.setAttribute(ATTR, "dot");
        }
        let text = node.querySelector(`[${ATTR}="label-text"]`);
        if (!(text instanceof HTMLElement)) {
          text = document.createElement("span");
          text.setAttribute(ATTR, "label-text");
        }
        if (text.textContent !== label) text.textContent = label;
        if (showDot && dot && (dot.parentElement !== node || text.parentElement !== node)) {
          node.replaceChildren(dot, text);
        } else if (!showDot && (text.parentElement !== node || node.children.length !== 1)) {
          node.replaceChildren(text);
        }
        if (!node.parentElement) target.appendChild(node);
      }
    };

    const refreshLabels = async (force = false) => {
      const rows = threadRows();
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        removeStaleLabels([]);
        return;
      }
      const now = Date.now();
      if (!force && (refreshInFlight || now - lastRefreshAt < 10_000)) {
        renderLabels();
        return;
      }
      refreshInFlight = true;
      lastRefreshAt = now;
      try {
        const next = await api.ipc.invoke("pinned-chat-project-labels", ids);
        if (next && typeof next === "object") {
          labels.clear();
          for (const [id, value] of Object.entries(next)) {
            if (typeof value === "string" && value.trim()) {
              labels.set(normalizeThreadId(id), { label: value.trim(), cwd: "" });
            } else if (value && typeof value === "object") {
              const label = typeof value.label === "string" ? value.label.trim() : "";
              const cwd = typeof value.cwd === "string" ? value.cwd : "";
              if (label) labels.set(normalizeThreadId(id), { label, cwd });
            }
          }
        }
      } catch (e) {
        api.log.warn("[pinned-chat-project-names] labels unavailable", e);
      } finally {
        refreshInFlight = false;
        if (!disposed) renderLabels();
      }
    };

    let scheduled = false;
    const scheduleApply = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        refreshLabels();
      });
    };

    refreshLabels(true);
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(() => refreshLabels(true), 60_000);
    window.addEventListener("focus", scheduleApply);
    window.addEventListener("storage", scheduleApply);
    window.addEventListener(BRIDGE_EVENT, scheduleApply);
    document.addEventListener("visibilitychange", scheduleApply);

    api.log.info("pinned chat project names active");

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("focus", scheduleApply);
      window.removeEventListener("storage", scheduleApply);
      window.removeEventListener(BRIDGE_EVENT, scheduleApply);
      document.removeEventListener("visibilitychange", scheduleApply);
      document.querySelectorAll(`[${ATTR}="label"]`).forEach((node) => node.remove());
      document.querySelectorAll(`[${ATTR}], [${ROW_ATTR}="true"], [${CONTENT_ATTR}="true"], [${COMPACT_ATTR}="true"]`).forEach((node) => {
        node.removeAttribute?.(ATTR);
        node.removeAttribute?.(ROW_ATTR);
        node.removeAttribute?.(CONTENT_ATTR);
        node.removeAttribute?.(COMPACT_ATTR);
      });
      style.remove();
    };
  },

  /**
   * Add subtle grouped backgrounds behind project/session rows in the main sidebar.
   *
   * Codex's sidebar project rows are `div[role="listitem"]` nodes with
   * class `group/cwd` and an aria-label matching the child folder button.
   * We mark that row for lookup, then tint the project block plus folder
   * icon/title and any unread indicator with the row's project theme.
   *
   * We only mark existing nodes and inject token-based CSS. No wrapping,
   * no synthetic click targets, and cleanup restores the original DOM.
   */
  "sidebar-project-backgrounds"(api) {
    const STYLE_ID = "codexpp-sidebar-project-backgrounds";
    const ATTR = "data-codexpp-sidebar-project-backgrounds";
    const MENU_ATTR = "data-codexpp-sidebar-project-color-menu";
    const COLOR_STORAGE_KEY = PROJECT_COLOR_STORAGE_KEY;
    const EXCLUDED_PROJECT_IDS = new Set([
      "cloud:therealityreport/trr-app",
      "cloud:therealityreport/screenalytics",
    ]);
    const CLOUD_PROJECT_PREFIX = "cloud:";
    const EXCLUDED_PROJECT_LABELS = new Set(["trr-app", "screenalytics"]);
    const ASIDE_SELECTOR = [
      "aside.pointer-events-auto.relative.flex.overflow-hidden",
      "aside.pointer-events-auto.relative.flex.overflow-visible",
      "aside.pointer-events-auto.relative.flex",
    ].join(", ");
    const EXCLUDED_LABELS = new Set([
      "account",
      "automations",
      "get plus",
      "help",
      "new chat",
      "add new project",
      "collapse all",
      "filter sidebar chats",
      "performance boost",
      "pinned",
      "plugins",
      "projects",
      "rate limits",
      "search",
      "settings",
      "subway surfers",
      "ui improvements",
      "upgrade",
      "upgrade plan",
    ]);
    const PALETTE = [
      { id: "neutral", label: "Neutral", value: "#404040", textValue: "#404040" },
      { id: "stone", label: "Stone", value: "#44403c", textValue: "#44403c" },
      { id: "zinc", label: "Zinc", value: "#3f3f46", textValue: "#3f3f46" },
      { id: "slate", label: "Slate", value: "#334155", textValue: "#334155" },
      { id: "gray", label: "Gray", value: "#374151", textValue: "#374151" },
      { id: "mauve", label: "Mauve", value: "#524959", textValue: "#524959" },
      { id: "olive", label: "Olive", value: "#435147", textValue: "#435147" },
      { id: "mist", label: "Mist", value: "#3d5155", textValue: "#3d5155" },
      { id: "taupe", label: "Taupe", value: "#554b3e", textValue: "#554b3e" },
      { id: "red", label: "Red", value: "#b91c1c", textValue: "#b91c1c" },
      { id: "orange", label: "Orange", value: "#c2410c", textValue: "#c2410c" },
      { id: "amber", label: "Amber", value: "#b45309", textValue: "#b45309" },
      { id: "yellow", label: "Yellow", value: "#a16207", textValue: "#a16207" },
      { id: "lime", label: "Lime", value: "#4d7c0f", textValue: "#4d7c0f" },
      { id: "green", label: "Green", value: "#15803d", textValue: "#15803d" },
      { id: "emerald", label: "Emerald", value: "#047857", textValue: "#047857" },
      { id: "teal", label: "Teal", value: "#0f766e", textValue: "#0f766e" },
      { id: "cyan", label: "Cyan", value: "#0e7490", textValue: "#0e7490" },
      { id: "sky", label: "Sky", value: "#0369a1", textValue: "#0369a1" },
      { id: "blue", label: "Blue", value: "#1d4ed8", textValue: "#1d4ed8" },
      { id: "indigo", label: "Indigo", value: "#4338ca", textValue: "#4338ca" },
      { id: "violet", label: "Violet", value: "#6d28d9", textValue: "#6d28d9" },
      { id: "purple", label: "Purple", value: "#7e22ce", textValue: "#7e22ce" },
      { id: "fuchsia", label: "Fuchsia", value: "#a21caf", textValue: "#a21caf" },
      { id: "pink", label: "Pink", value: "#be185d", textValue: "#be185d" },
      { id: "rose", label: "Rose", value: "#be123c", textValue: "#be123c" },
    ];
    const colorPrefsCacheKey = "__codexppSidebarProjectColorPrefs";
    let colorPrefs = readColorPrefs();
    window[colorPrefsCacheKey] = colorPrefs;
    const overlayPrefsCacheKey = "__codexppSidebarProjectOverlayPrefs";
    let overlayPrefs = readOverlayPrefs();
    window[overlayPrefsCacheKey] = overlayPrefs;
    let pendingContextMenu = null;
    let menu = null;
    let disposed = false;

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --codexpp-project-blue-text: var(--color-token-charts-blue, var(--color-token-text-link-foreground));
        --codexpp-project-green-text: color-mix(in srgb, var(--color-token-charts-green, currentColor) 72%, black);
        --codexpp-project-yellow-text: color-mix(in srgb, var(--color-token-charts-yellow, currentColor) 42%, black);
        --codexpp-project-red-text: color-mix(in srgb, var(--color-token-charts-red, currentColor) 82%, black);
        --codexpp-project-pink-text: color-mix(in srgb, var(--pink-400, var(--color-token-charts-purple, currentColor)) 68%, black);
        --codexpp-project-purple-text: color-mix(in srgb, var(--color-token-charts-purple, currentColor) 82%, black);
        --codexpp-project-gray-text: color-mix(in srgb, var(--color-token-text-primary, currentColor) 25%, black);
      }

      .electron-dark {
        --codexpp-project-blue-text: var(--color-token-text-link-foreground, var(--color-token-charts-blue));
        --codexpp-project-green-text: var(--color-token-charts-green, var(--color-token-text-primary));
        --codexpp-project-yellow-text: var(--color-token-charts-yellow, var(--color-token-text-primary));
        --codexpp-project-red-text: color-mix(in srgb, var(--color-token-charts-red, currentColor) 86%, white);
        --codexpp-project-pink-text: var(--pink-400, var(--color-token-charts-purple, var(--color-token-text-primary)));
        --codexpp-project-purple-text: color-mix(in srgb, var(--color-token-charts-purple, currentColor) 88%, white);
        --codexpp-project-gray-text: var(--color-token-text-secondary);
      }

      [${ATTR}="row"] {
        position: relative !important;
        background-color: transparent !important;
        box-shadow: none !important;
      }

      [${ATTR}="row"][style*="--codexpp-project-blue-token-override"] {
        --color-accent-blue: var(--codexpp-project-blue-token-override);
        --color-token-charts-blue: var(--codexpp-project-blue-token-override);
        --vscode-charts-blue: var(--codexpp-project-blue-token-override);
        --vscode-terminal-ansiBlue: var(--codexpp-project-blue-token-override);
        --vscode-terminal-ansiBrightBlue: var(--codexpp-project-blue-token-override);
      }

      [${ATTR}="row"][style*="--codexpp-project-link-token-override"] {
        --color-token-text-link-foreground: var(--codexpp-project-link-token-override);
        --color-token-text-link-active-foreground: var(--codexpp-project-link-token-override);
        --vscode-textLink-foreground: var(--codexpp-project-link-token-override);
        --vscode-textLink-activeForeground: var(--codexpp-project-link-token-override);
      }

      [${ATTR}="project-list"] {
        display: flex !important;
        flex-direction: column !important;
        gap: 0 !important;
      }

      [${ATTR}="row"] + [${ATTR}="row"],
      [${ATTR}="project-child"] + [${ATTR}="row"] {
        margin-top: 4px !important;
      }

      [${ATTR}="row"]:hover,
      [${ATTR}="header"]:hover,
      [${ATTR}="row"]:has([data-app-action-sidebar-thread-active="true"]),
      [${ATTR}="header"]:has([data-app-action-sidebar-thread-active="true"]),
      [${ATTR}="project-child-target"]:hover,
      [${ATTR}="project-child-target"]:has([data-app-action-sidebar-thread-active="true"]) {
        background-color: color-mix(
          in srgb,
          var(--codexpp-project-background-tint, var(--codexpp-project-tint, currentColor)) var(--codexpp-project-child-hover-light, 18%),
          var(--color-token-list-hover-background, transparent)
        ) !important;
      }

      .electron-dark [${ATTR}="row"]:hover,
      .electron-dark [${ATTR}="header"]:hover,
      .electron-dark [${ATTR}="row"]:has([data-app-action-sidebar-thread-active="true"]),
      .electron-dark [${ATTR}="header"]:has([data-app-action-sidebar-thread-active="true"]),
      .electron-dark [${ATTR}="project-child-target"]:hover,
      .electron-dark [${ATTR}="project-child-target"]:has([data-app-action-sidebar-thread-active="true"]) {
        background-color: color-mix(
          in srgb,
          var(--codexpp-project-background-tint, var(--codexpp-project-tint, currentColor)) var(--codexpp-project-child-hover-dark, 26%),
          var(--color-token-list-hover-background, transparent)
        ) !important;
      }

      [${ATTR}="header"] {
        background-color: color-mix(
          in srgb,
          var(--codexpp-project-background-tint, var(--codexpp-project-tint, currentColor)) var(--codexpp-project-header-light, 12%),
          transparent
        ) !important;
        border-radius: 8px !important;
      }

      .electron-dark [${ATTR}="header"] {
        background-color: color-mix(
          in srgb,
          var(--codexpp-project-background-tint, var(--codexpp-project-tint, currentColor)) var(--codexpp-project-header-dark, 19%),
          transparent
        ) !important;
      }

      [${ATTR}="project-child"] {
        background-color: transparent !important;
        border-radius: 0 !important;
        box-sizing: border-box !important;
        margin-block: 1px !important;
        margin-inline: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      [${ATTR}="project-child-target"] {
        background-color: color-mix(
          in srgb,
          var(--codexpp-project-background-tint, var(--codexpp-project-tint, currentColor)) var(--codexpp-project-child-light, 10%),
          transparent
        ) !important;
        border-radius: 6px !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      .electron-dark [${ATTR}="project-child-target"] {
        background-color: color-mix(
          in srgb,
          var(--codexpp-project-background-tint, var(--codexpp-project-tint, currentColor)) var(--codexpp-project-child-dark, 18%),
          transparent
        ) !important;
      }

      [${ATTR}="project-expander"],
      [${ATTR}="project-expander"]:hover,
      [${ATTR}="project-expander"]:focus,
      [${ATTR}="project-expander"]:focus-visible,
      .electron-dark [${ATTR}="project-expander"],
      .electron-dark [${ATTR}="project-expander"]:hover,
      .electron-dark [${ATTR}="project-expander"]:focus,
      .electron-dark [${ATTR}="project-expander"]:focus-visible {
        background: transparent !important;
        background-color: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
        color: color-mix(
          in srgb,
          var(--codexpp-project-text-color, var(--codexpp-project-tint, currentColor)) 82%,
          black
        ) !important;
        font-weight: 700 !important;
        -webkit-text-fill-color: color-mix(
          in srgb,
          var(--codexpp-project-text-color, var(--codexpp-project-tint, currentColor)) 82%,
          black
        ) !important;
      }

      [${ATTR}="project-expander"] :where(*) {
        color: inherit !important;
        font-weight: inherit !important;
        -webkit-text-fill-color: inherit !important;
      }

      [${ATTR}="icon"] {
        color: color-mix(
          in srgb,
          var(--codexpp-project-text-color, var(--codexpp-project-tint, currentColor)) 82%,
          black
        ) !important;
      }

      [${ATTR}="title"] {
        color: color-mix(
          in srgb,
          var(--codexpp-project-text-color, var(--codexpp-project-tint, currentColor)) 82%,
          black
        ) !important;
        font-weight: 700 !important;
      }

      [${ATTR}="unread"] {
        background-color: var(--codexpp-project-tint, currentColor) !important;
        color: var(--codexpp-project-tint, currentColor) !important;
        fill: var(--codexpp-project-tint, currentColor) !important;
        stroke: var(--codexpp-project-tint, currentColor) !important;
      }

      [${ATTR}="row"] [class*="bg-token-charts-blue"],
      [${ATTR}="row"] [class*="bg-token-accent"],
      [${ATTR}="row"] [class*="bg-token-link"],
      [${ATTR}="row"] [data-testid*="unread" i],
      [${ATTR}="row"] [aria-label*="unread" i] {
        background-color: var(--codexpp-project-tint, currentColor) !important;
      }

      [${ATTR}="row"] [class*="text-token-charts-blue"],
      [${ATTR}="row"] [class*="text-token-accent"],
      [${ATTR}="row"] [class*="text-token-link"],
      [${ATTR}="row"] [data-testid*="unread" i],
      [${ATTR}="row"] [aria-label*="unread" i] {
        color: var(--codexpp-project-tint, currentColor) !important;
        fill: var(--codexpp-project-tint, currentColor) !important;
        stroke: var(--codexpp-project-tint, currentColor) !important;
      }

      aside.pointer-events-auto.relative.flex.overflow-hidden
        [role="button"].hover\\:bg-token-list-hover-background:not(.group\\/folder-row),
      aside.pointer-events-auto.relative.flex.overflow-visible
        [role="button"].hover\\:bg-token-list-hover-background:not(.group\\/folder-row) {
        margin-inline: 4px !important;
        width: calc(100% - 8px) !important;
      }

      [${MENU_ATTR}="root"] {
        position: fixed;
        z-index: 2147483647;
        min-width: 180px;
        border: 1px solid var(--color-token-border, var(--color-border)) !important;
        border-radius: var(--radius-lg, 0.5rem);
        background: var(--color-background-panel, var(--color-token-bg-fog));
        box-shadow: var(--shadow-lg, 0 10px 24px rgb(0 0 0 / 0.16));
        padding: var(--spacing-1, 0.25rem);
      }

      [${MENU_ATTR}="item"] {
        width: 100%;
        border-radius: var(--radius-md, 0.375rem);
      }

      [${MENU_ATTR}="swatch"] {
        background-color: var(--codexpp-project-menu-color, currentColor);
      }

      [${MENU_ATTR}="trigger"] {
        color: var(--color-token-foreground);
      }

      div[role="listitem"][aria-label="trr-app"],
      div[role="listitem"][aria-label="screenalytics"],
      div[role="listitem"]:has([data-app-action-sidebar-project-id^="cloud:"]),
      div[role="listitem"]:has([data-app-action-sidebar-project-id="cloud:therealityreport/trr-app"]),
      div[role="listitem"]:has([data-app-action-sidebar-project-id="cloud:therealityreport/screenalytics"]) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    const normalize = (value) =>
      String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

    const visible = (node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      if (node.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const style = window.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const mainSidebar = () => {
      const aside = document.querySelector(ASIDE_SELECTOR);
      return aside instanceof HTMLElement ? aside : null;
    };

    const labelFor = (node) =>
      normalizeLegacyBrandText(normalize(
        node.getAttribute("aria-label") ||
          node.getAttribute("title") ||
          node.textContent ||
        "",
      ).replace(/\s*[⌘⇧⌥⌃^].*$/, ""));

    const isProjectRow = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (!visible(node)) return false;
      if (node.getAttribute("role") !== "listitem") return false;
      if (!node.classList.contains("group/cwd")) return false;

      const text = labelFor(node);
      if (!text || text.length < 2 || text.length > 80) return false;
      if (EXCLUDED_LABELS.has(text)) return false;
      if (isExcludedProjectRow(node)) return false;

      const action = node.querySelector("[role='button'][aria-label]");
      return action instanceof HTMLElement && labelFor(action) === text;
    };

    const isExcludedProjectRow = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (EXCLUDED_PROJECT_LABELS.has(labelFor(node))) return true;
      const action = node.querySelector("[data-app-action-sidebar-project-id]");
      const projectId = action instanceof HTMLElement
        ? action.getAttribute("data-app-action-sidebar-project-id")
        : null;
      return Boolean(projectId && (isCloudProjectId(projectId) || EXCLUDED_PROJECT_IDS.has(projectId)));
    };

    const isCloudProjectId = (projectId) =>
      typeof projectId === "string" && projectId.trim().toLowerCase().startsWith(CLOUD_PROJECT_PREFIX);

    const candidateRows = (sidebar) =>
      Array.from(sidebar.querySelectorAll("div[role='listitem'][aria-label]"))
        .filter(isProjectRow)
        .filter((node, index, rows) => rows.indexOf(node) === index);

    const clearMarks = () => {
      document.querySelectorAll(`[${ATTR}]`).forEach((node) => {
        if (!(node instanceof Element)) return;
        node.removeAttribute(ATTR);
        node.removeAttribute("data-codexpp-sidebar-project-expanded");
        if ("style" in node) {
          node.style.removeProperty("--codexpp-project-tint");
          node.style.removeProperty("--codexpp-project-text-color");
          node.style.removeProperty("--codexpp-project-background-tint");
          node.style.removeProperty("--codexpp-project-header-light");
          node.style.removeProperty("--codexpp-project-header-dark");
          node.style.removeProperty("--codexpp-project-child-light");
          node.style.removeProperty("--codexpp-project-child-dark");
          node.style.removeProperty("--codexpp-project-child-hover-light");
          node.style.removeProperty("--codexpp-project-child-hover-dark");
          node.style.removeProperty("--codexpp-project-blue-token-override");
          node.style.removeProperty("--codexpp-project-link-token-override");
        }
      });
    };

    const autoPaletteFor = (text) => {
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
      }
      return PALETTE[hash % PALETTE.length];
    };

    const paletteFor = (text) => {
      const stored = colorPrefs[projectKey(text)];
      const match = PALETTE.find((color) => color.id === stored);
      return match || autoPaletteFor(text);
    };

    const tintFor = (text) => paletteFor(text).value;

    const textColorFor = (text) => {
      const color = paletteFor(text);
      return color.textValue || color.value;
    };

    const blueTokenOverrideFor = (text) => {
      const color = paletteFor(text);
      return color.value;
    };

    const linkTokenOverrideFor = (text) => {
      const color = paletteFor(text);
      return textColorFor(text);
    };

    const overlayIntensityFor = (text) =>
      normalizeProjectOverlayIntensity(overlayPrefs[projectKey(text)]);

    const overlayOptionFor = (text) =>
      PROJECT_OVERLAY_OPTIONS[overlayIntensityFor(text)] || PROJECT_OVERLAY_OPTIONS[DEFAULT_PROJECT_OVERLAY_INTENSITY];

    const applyProjectStyleVars = (node, label) => {
      const tint = tintFor(label);
      const overlay = overlayOptionFor(label);
      setStyleVar(node, "--codexpp-project-tint", tint);
      setStyleVar(node, "--codexpp-project-text-color", textColorFor(label));
      setStyleVar(node, "--codexpp-project-background-tint", tint);
      setStyleVar(node, "--codexpp-project-header-light", `${Math.max(0, Math.round(overlay.light * 1.2))}%`);
      setStyleVar(node, "--codexpp-project-header-dark", `${Math.max(0, Math.round(overlay.dark * 1.05))}%`);
      setStyleVar(node, "--codexpp-project-child-light", `${overlay.light}%`);
      setStyleVar(node, "--codexpp-project-child-dark", `${overlay.dark}%`);
      setStyleVar(node, "--codexpp-project-child-hover-light", `${overlay.hoverLight}%`);
      setStyleVar(node, "--codexpp-project-child-hover-dark", `${overlay.hoverDark}%`);
    };

    const markRows = (rows) => {
      reconcileProjectLists(rows);
      clearProjectChildMarks();
      const rowSet = new Set(rows);
      for (const row of rows) {
        if (!(row instanceof HTMLElement)) continue;
        renameLegacyBrandInElement(row);
        const label = labelFor(row);
        setAttr(row, ATTR, "row");
        setAttr(row, "data-codexpp-sidebar-project-expanded", String(isExpandedProject(row)));
        applyProjectStyleVars(row, label);
        setOptionalStyleVar(row, "--codexpp-project-blue-token-override", blueTokenOverrideFor(label));
        setOptionalStyleVar(row, "--codexpp-project-link-token-override", linkTokenOverrideFor(label));
        markProjectGroup(row, label, rowSet);
        markProjectParts(row, label);
      }
    };

    const reconcileProjectLists = (rows) => {
      const parents = new Set(
        rows
          .map((row) => row.parentElement)
          .filter((node) => node instanceof HTMLElement),
      );
      document.querySelectorAll(`[${ATTR}="project-list"]`).forEach((node) => {
        if (!parents.has(node)) node.removeAttribute(ATTR);
      });
      for (const parent of parents) {
        setAttr(parent, ATTR, "project-list");
      }
    };

    const projectKey = (label) => normalize(label);

    function readOverlayPrefs() {
      const value = api.storage.get(PROJECT_OVERLAY_STORAGE_KEY, {});
      const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const cached = window[overlayPrefsCacheKey];
      return cached && typeof cached === "object" && !Array.isArray(cached)
        ? { ...stored, ...cached }
        : stored;
    }

    const writeOverlayPrefs = () => {
      overlayPrefs = { ...overlayPrefs };
      window[overlayPrefsCacheKey] = overlayPrefs;
      return api.storage.set(PROJECT_OVERLAY_STORAGE_KEY, overlayPrefs);
    };

    const clearProjectChildMarks = () => {
      document.querySelectorAll(`[${ATTR}="project-child"], [${ATTR}="project-child-target"], [${ATTR}="project-expander"], [${ATTR}="header"]`).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        node.removeAttribute(ATTR);
        clearProjectStyleVars(node);
      });
    };

    const clearProjectStyleVars = (node) => {
      node.style.removeProperty("--codexpp-project-tint");
      node.style.removeProperty("--codexpp-project-text-color");
      node.style.removeProperty("--codexpp-project-background-tint");
      node.style.removeProperty("--codexpp-project-header-light");
      node.style.removeProperty("--codexpp-project-header-dark");
      node.style.removeProperty("--codexpp-project-child-light");
      node.style.removeProperty("--codexpp-project-child-dark");
      node.style.removeProperty("--codexpp-project-child-hover-light");
      node.style.removeProperty("--codexpp-project-child-hover-dark");
    };

    const markProjectGroup = (row, label, rowSet) => {
      const overlay = overlayOptionFor(label);
      markProjectHeader(row, label);
      if (overlay.id === "off") return;
      for (const node of projectGroupNodes(row, label, rowSet)) {
        if (!(node instanceof HTMLElement)) continue;
        setAttr(node, ATTR, "project-child");
        applyProjectStyleVars(node, label);
        const target = projectChildTintTarget(node);
        if (target) {
          setAttr(target, ATTR, isProjectExpanderControl(target) ? "project-expander" : "project-child-target");
          applyProjectStyleVars(target, label);
        }
      }
    };

    const markProjectHeader = (row, label) => {
      const header = projectHeaderFor(row, label);
      if (!(header instanceof HTMLElement)) return;
      setAttr(header, ATTR, "header");
      applyProjectStyleVars(header, label);
    };

    const projectHeaderFor = (row, label) =>
      Array.from(row.querySelectorAll("[role='button'][aria-label]"))
        .find((node) => node instanceof HTMLElement && labelFor(node) === label) ||
      row.querySelector("[role='button'][aria-label]");

    const projectGroupNodes = (row, label, rowSet) => {
      const nodes = new Set();
      for (const node of projectGroupDescendantNodes(row, label)) nodes.add(node);
      for (const node of projectGroupSiblingNodes(row, rowSet)) nodes.add(node);
      for (const node of flatProjectThreadNodes(label)) nodes.add(node);
      return Array.from(nodes);
    };

    const projectGroupSiblingNodes = (row, rowSet) => {
      const nodes = [];
      let node = row.nextElementSibling;
      while (node && !rowSet.has(node) && !isLikelyProjectBoundary(node) && normalize(node.textContent) !== "chats") {
        if (isLikelyThreadRow(node) || node.querySelector?.(THREAD_OR_TASK_SELECTOR)) nodes.push(node);
        node = node.nextElementSibling;
      }
      return nodes;
    };

    const isLikelyProjectBoundary = (node) =>
      node instanceof HTMLElement &&
      node.getAttribute("role") === "listitem" &&
      (node.classList.contains("group/cwd") || Boolean(node.querySelector?.("[data-app-action-sidebar-project-id]")));

    const THREAD_OR_TASK_SELECTOR = [
      "[data-app-action-sidebar-thread-row]",
      "[data-app-action-sidebar-thread-id]",
      "[data-app-action-sidebar-task-id]",
      "[data-sidebar-thread-id]",
      "[data-app-action-sidebar-thread-title]",
      "[data-app-action-sidebar-task-title]",
      "[data-sidebar-thread-title]",
    ].join(", ");

    const projectGroupDescendantNodes = (row, label) => {
      const header = projectHeaderFor(row, label);
      return Array.from(row.querySelectorAll(`div[role='listitem'], ${THREAD_OR_TASK_SELECTOR}`))
        .filter((node) => (
          node instanceof HTMLElement &&
          node !== row &&
          node !== header &&
          !header?.contains(node) &&
          labelFor(node) !== label &&
          (isLikelyThreadRow(node) || node.querySelector?.(THREAD_OR_TASK_SELECTOR) || node.matches?.(THREAD_OR_TASK_SELECTOR))
        ));
    };

    const flatProjectThreadNodes = (label) => {
      const sidebar = mainSidebar();
      if (!sidebar) return [];
      return Array.from(sidebar.querySelectorAll(`div[role='listitem'], ${THREAD_OR_TASK_SELECTOR}`))
        .filter((node) => node instanceof HTMLElement && !node.closest(`[${ATTR}="row"]`))
        .filter((node) => threadProjectKey(node) === projectKey(label));
    };

    const projectChildTintTarget = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      if (
        node.matches?.("button, a, [role='button']") ||
        node.matches?.(THREAD_OR_TASK_SELECTOR)
      ) {
        return node;
      }
      const target = node.querySelector?.(`button, a, [role='button'], ${THREAD_OR_TASK_SELECTOR}`);
      return target instanceof HTMLElement ? target : node;
    };

    const isProjectExpanderControl = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const text = normalize(node.getAttribute("aria-label") || node.textContent || "");
      return /^show (more|less)\b/.test(text);
    };

    const isLikelyThreadRow = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.matches?.(THREAD_OR_TASK_SELECTOR)) return true;
      if (node.querySelector?.(THREAD_OR_TASK_SELECTOR)) return true;
      const text = labelFor(node);
      return node.getAttribute("role") === "listitem" && Boolean(text) && !isProjectRow(node);
    };

    const threadProjectKey = (node) => {
      if (!(node instanceof HTMLElement)) return "";
      const attr = attrValue(node, [
        "data-app-action-sidebar-project-label",
        "data-sidebar-project-label",
        "data-project-label",
        "data-app-action-sidebar-thread-project-label",
        "data-app-action-sidebar-task-project-label",
      ]);
      if (attr) return projectKey(attr);
      const pathValue = attrValue(node, [
        "data-app-action-sidebar-project-id",
        "data-app-action-sidebar-thread-cwd",
        "data-app-action-sidebar-task-cwd",
        "data-sidebar-thread-cwd",
        "data-cwd",
        "data-project-path",
      ]);
      if (pathValue) return projectKey(projectNameFromPath(pathValue));
      return "";
    };

    const attrValue = (node, names) => {
      if (!(node instanceof HTMLElement)) return "";
      for (const name of names) {
        const direct = node.getAttribute(name);
        if (direct) return direct;
        const child = node.querySelector?.(`[${name}]`);
        const nested = child instanceof HTMLElement ? child.getAttribute(name) : "";
        if (nested) return nested;
      }
      return "";
    };

    const projectNameFromPath = (value) => {
      const input = String(value || "").trim();
      if (!input) return "";
      if (input.startsWith("codex-sidebar://")) return input.replace("codex-sidebar://", "");
      if (input.startsWith("cloud:")) return input.split("/").pop() || input.replace(/^cloud:/, "");
      const parts = input.split(/[\\/]+/).filter(Boolean);
      return parts.at(-1) || input;
    };

    function readColorPrefs() {
      const value = api.storage.get(COLOR_STORAGE_KEY, {});
      const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const cached = window[colorPrefsCacheKey];
      return cached && typeof cached === "object" && !Array.isArray(cached)
        ? { ...stored, ...cached }
        : stored;
    }

    const writeColorPrefs = () => {
      colorPrefs = { ...colorPrefs };
      window[colorPrefsCacheKey] = colorPrefs;
      return api.storage.set(COLOR_STORAGE_KEY, colorPrefs);
    };

    const isExpandedProject = (row) => {
      if (row.getBoundingClientRect().height > 40) return true;
      return Boolean(row.querySelector('[role="list"][aria-label]'));
    };

    const markProjectParts = (row, label) => {
      const header = Array.from(row.querySelectorAll("[role='button'][aria-label]"))
        .find((node) => node instanceof HTMLElement && labelFor(node) === label);
      const target = header instanceof HTMLElement ? header : row.querySelector("[role='button'][aria-label]");
      if (!(target instanceof HTMLElement)) return;

      target.querySelectorAll("svg").forEach((node) => {
        if (node instanceof SVGElement) setAttr(node, ATTR, "icon");
      });

      const title = Array.from(target.querySelectorAll("span"))
        .filter((node) => node instanceof HTMLElement && normalizeLegacyBrandText(normalize(node.textContent)) === normalize(label))
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      if (title instanceof HTMLElement) setAttr(title, ATTR, "title");

      row.querySelectorAll(
        [
          '[class*="bg-token-charts-blue"]',
          '[class*="bg-token-accent"]',
          '[class*="bg-token-link"]',
          '[class*="text-token-charts-blue"]',
          '[class*="text-token-accent"]',
          '[class*="text-token-link"]',
          '[class*="unread" i]',
          '[data-testid*="unread" i]',
          '[aria-label*="unread" i]',
        ].join(", "),
      )
        .forEach((node) => {
          if (node instanceof HTMLElement) setAttr(node, ATTR, "unread");
        });
    };

    const projectPathForRow = (row) => {
      const action = row?.querySelector?.("[data-app-action-sidebar-project-id]");
      const value = action instanceof HTMLElement
        ? action.getAttribute("data-app-action-sidebar-project-id")
        : null;
      return value || null;
    };

    const slugifyProjectSettingsId = (value) =>
      String(value || "project")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "project";

    const projectSettingsPageId = (context) =>
      `co.thomashulihan.projects:project-${slugifyProjectSettingsId(context?.label || context?.projectPath)}`;

    const numberOrClient = (value, fallback) =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback;

    const seedProjectMenu = (label, event, anchor, row) => {
      const anchorRect = anchor?.getBoundingClientRect?.();
      pendingContextMenu = {
        label,
        projectPath: projectPathForRow(row),
        x: numberOrClient(event?.clientX, anchorRect?.right ?? anchorRect?.left ?? 0),
        y: numberOrClient(event?.clientY, anchorRect?.top ?? 0),
        at: Date.now(),
      };
      [0, 50, 150, 350].forEach((delay) =>
        window.setTimeout(injectColorMenuIntoNativeMenu, delay),
      );
    };

    const findProjectOverflowButton = (row, label) =>
      Array.from(row.querySelectorAll("button, [role='button']"))
        .filter((node) => isProjectOverflowButton(row, label, node))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] || null;

    const isProjectOverflowButton = (row, label, button) => {
      if (!(button instanceof HTMLElement) || !row.contains(button) || !visible(button)) {
        return false;
      }
      if (labelFor(button) === label) return false;
      const rect = button.getBoundingClientRect();
      if (rect.width > 52 || rect.height > 52) return false;
      const text = normalize(button.textContent || "");
      const aria = normalize(button.getAttribute("aria-label") || "");
      return (
        !text ||
        aria.includes("more") ||
        aria.includes("menu") ||
        button.getAttribute("aria-haspopup") === "menu" ||
        Boolean(button.querySelector("svg"))
      );
    };

    const onProjectOverflowTrigger = (event) => {
      const button = event.target?.closest?.("button, [role='button']");
      if (!(button instanceof HTMLElement)) return;
      const row = button.closest("div[role='listitem'][aria-label]");
      if (!isProjectRow(row)) return;
      const label = labelFor(row);
      if (!isProjectOverflowButton(row, label, button)) return;
      seedProjectMenu(label, event, button, row);
    };

    const onProjectContextMenu = (event) => {
      const row = event.target?.closest?.("div[role='listitem'][aria-label]");
      if (!isProjectRow(row)) return;
      seedProjectMenu(labelFor(row), event, row, row);
    };

    const openColorMenu = (label, x, y, anchor) => {
      closeMenu();
      const selected = colorPrefs[projectKey(label)] || "auto";
      const selectedOverlay = overlayIntensityFor(label);
      menu = document.createElement("div");
      menu.setAttribute(MENU_ATTR, "root");
      menu.className = "flex flex-col gap-0.5";

      const title = document.createElement("div");
      title.className = "px-2 py-1 text-xs text-token-text-secondary";
      title.textContent = "Project color";
      menu.appendChild(title);

      const autoColor = autoPaletteFor(label);
      const options = [{ id: "auto", label: `Auto (${autoColor.label})`, value: autoColor.value }, ...PALETTE];
      for (const option of options) {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute(MENU_ATTR, "item");
        item.setAttribute("data-color-id", option.id);
        item.className =
          "flex h-token-button-composer items-center gap-2 px-2 text-left text-sm " +
          "text-token-text-primary hover:bg-token-foreground/10 cursor-interaction";
        item.setAttribute("aria-pressed", String(selected === option.id));

        const swatch = document.createElement("span");
        swatch.setAttribute(MENU_ATTR, "swatch");
        swatch.className = "size-3 shrink-0 rounded-full border border-token-border";
        swatch.style.setProperty("--codexpp-project-menu-color", option.value);

        const text = document.createElement("span");
        text.className = "min-w-0 flex-1 truncate";
        text.textContent = option.label;

        const check = document.createElement("span");
        check.setAttribute(MENU_ATTR, "check");
        check.className = "text-token-text-secondary";
        check.textContent = selected === option.id ? "✓" : "";

        item.append(swatch, text, check);
        item.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (option.id === "auto") delete colorPrefs[projectKey(label)];
          else colorPrefs[projectKey(label)] = option.id;
          applyColorToCurrentRows(label);
          syncNativeMenuChecks(label);
          try {
            await writeColorPrefs();
          } catch (e) {
            api.log.warn("sidebar project color write failed", e);
          }
          applyColorToCurrentRows(label);
          closeMenu();
          scheduleApply();
        });
        menu.appendChild(item);
      }

      const overlayTitle = document.createElement("div");
      overlayTitle.className = "mt-1 border-t border-token-border/60 px-2 py-1 text-xs text-token-text-secondary";
      overlayTitle.textContent = "Chat row overlay";
      menu.appendChild(overlayTitle);

      for (const option of Object.values(PROJECT_OVERLAY_OPTIONS)) {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute(MENU_ATTR, "item");
        item.setAttribute("data-overlay-id", option.id);
        item.className =
          "flex h-token-button-composer items-center gap-2 px-2 text-left text-sm " +
          "text-token-text-primary hover:bg-token-foreground/10 cursor-interaction";
        item.setAttribute("aria-pressed", String(selectedOverlay === option.id));

        const swatch = document.createElement("span");
        swatch.setAttribute(MENU_ATTR, "swatch");
        swatch.className = "size-3 shrink-0 rounded-full border border-token-border";
        swatch.style.setProperty("--codexpp-project-menu-color", tintFor(label));
        swatch.style.opacity = option.id === "off" ? "0.18" : String(Math.max(0.32, option.light / 18));

        const text = document.createElement("span");
        text.className = "min-w-0 flex-1 truncate";
        text.textContent = option.label;

        const check = document.createElement("span");
        check.setAttribute(MENU_ATTR, "check");
        check.className = "text-token-text-secondary";
        check.textContent = selectedOverlay === option.id ? "✓" : "";

        item.append(swatch, text, check);
        item.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const key = projectKey(label);
          overlayPrefs = { ...overlayPrefs };
          if (option.id === DEFAULT_PROJECT_OVERLAY_INTENSITY) delete overlayPrefs[key];
          else overlayPrefs[key] = option.id;
          window[overlayPrefsCacheKey] = overlayPrefs;
          applyColorToCurrentRows(label);
          syncNativeMenuChecks(label);
          try {
            await writeOverlayPrefs();
          } catch (e) {
            api.log.warn("sidebar project overlay write failed", e);
          }
          applyColorToCurrentRows(label);
          closeMenu();
          scheduleApply();
        });
        menu.appendChild(item);
      }

      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      const anchorRect = anchor?.getBoundingClientRect?.();
      const left = anchorRect ? anchorRect.right + 4 : x;
      const top = anchorRect ? anchorRect.top : y;
      menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;

      window.setTimeout(() => {
        document.addEventListener("pointerdown", closeMenuOnOutside, true);
        document.addEventListener("keydown", closeMenuOnKey, true);
      }, 0);
    };

    function closeMenu() {
      document.removeEventListener("pointerdown", closeMenuOnOutside, true);
      document.removeEventListener("keydown", closeMenuOnKey, true);
      menu?.remove();
      menu = null;
    }

    function closeMenuOnOutside(event) {
      if (menu?.contains(event.target)) return;
      closeMenu();
    }

    function closeMenuOnKey(event) {
      if (event.key === "Escape") closeMenu();
    }

    const menuText = (node) => normalize(node?.textContent || "");

    const isKnownNativeMenuText = (text) =>
      /\b(pin project|open in finder|create permanent worktree|rename project|archive chats|remove|delete)\b/i.test(text);

    const isBoundedMenuPopover = (node) => {
      if (!(node instanceof HTMLElement) || !visible(node)) return false;
      if (node === document.body || node === document.documentElement) return false;
      const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 };
      const maxWidth = Math.max(360, Math.min(window.innerWidth || 1280, 900));
      const maxHeight = Math.max(220, Math.min(window.innerHeight || 800, 720));
      return rect.width >= 120 && rect.height >= 48 && rect.width <= maxWidth && rect.height <= maxHeight;
    };

    const closestNativeMenu = (target) => {
      if (!(target instanceof HTMLElement)) return null;
      const semantic = target.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]');
      if (semantic instanceof HTMLElement) return semantic;
      let node = target.parentElement;
      let best = null;
      while (node instanceof HTMLElement && node !== document.body && node !== document.documentElement) {
        const text = menuText(node);
        if (isBoundedMenuPopover(node) && isKnownNativeMenuText(text)) best = node;
        node = node.parentElement;
      }
      return best;
    };

    const openMenuRoots = () => {
      const roots = Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'))
        .filter((node) => node instanceof HTMLElement && visible(node));
      for (const item of Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [data-radix-collection-item]'))) {
        if (!(item instanceof HTMLElement) || !isKnownNativeMenuText(menuText(item))) continue;
        const root = closestNativeMenu(item);
        if (root && !roots.includes(root)) roots.push(root);
      }
      return roots;
    };

    const nativeMenuItems = (root) =>
      Array.from(root.querySelectorAll('[role="menuitem"], [data-radix-collection-item], button'))
        .filter((item) => item instanceof HTMLElement && visible(item));

    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const clickElement = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      node.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, view: window, button: 0 }));
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
      node.click();
      return true;
    };

    const findSettingsControl = () =>
      Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"]'))
        .filter((node) => node instanceof HTMLElement && visible(node) && !node.closest("[data-codexpp]"))
        .find((node) => normalize(node.getAttribute("aria-label") || node.textContent || "") === "settings") || null;

    const showProjectMenuToast = (message) => {
      let host = document.querySelector(`[${MENU_ATTR}="toast-host"]`);
      if (!host) {
        host = document.createElement("div");
        host.setAttribute(MENU_ATTR, "toast-host");
        host.className = "pointer-events-none fixed bottom-5 right-5 z-[2147483647] flex flex-col items-end gap-2";
        document.body.appendChild(host);
      }
      const toast = document.createElement("div");
      toast.className =
        "translate-y-2 rounded-xl border border-token-border/50 bg-token-main-surface-primary " +
        "px-3 py-2 text-sm font-medium text-token-foreground opacity-0 shadow-lg transition-all duration-200";
      toast.textContent = message;
      host.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.remove("translate-y-2", "opacity-0");
      });
      window.setTimeout(() => {
        toast.classList.add("translate-y-2", "opacity-0");
        window.setTimeout(() => {
          toast.remove();
          if (host && host.childElementCount === 0) host.remove();
        }, 220);
      }, 3200);
    };

    const openProjectSettingsPage = async (context) => {
      const pageId = projectSettingsPageId(context);
      const openRegisteredPage = () => {
        try {
          return Boolean(api.codex?.openRegisteredTweakPage?.(pageId));
        } catch (e) {
          api.log.warn("open project settings page failed", e);
          return false;
        }
      };

      if (openRegisteredPage()) return true;
      clickElement(findSettingsControl());
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await wait(125);
        if (openRegisteredPage()) return true;
      }
      const message = `Could not open Project settings for ${context?.label || "this project"}. Open Settings, then try again.`;
      api.log.warn("project settings page did not open", { pageId });
      showProjectMenuToast(message);
      return false;
    };

    const injectColorMenuIntoNativeMenu = () => {
      if (!pendingContextMenu || Date.now() - pendingContextMenu.at > 1500) return;
      const nativeMenu = findNativeContextMenu(pendingContextMenu.x, pendingContextMenu.y);
      if (!nativeMenu || nativeMenu.querySelector(`[${MENU_ATTR}="trigger"]`)) return;

      const nativeItem = nativeMenu.querySelector('[role="menuitem"]');
      const copyPathItem = createNativeMenuItem({
        nativeItem,
        attr: "copy-path",
        label: "Copy folder path",
        icon: copyPathIcon(),
        onActivate: async (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          const projectPath = pendingContextMenu?.projectPath;
          if (!projectPath) return;
          try {
            await copyText(projectPath);
          } catch (e) {
            api.log.warn("copy project path failed", e);
          }
          nativeMenu.remove();
        },
      });
      const settingsItem = createNativeMenuItem({
        nativeItem,
        attr: "project-settings",
        label: "Project settings",
        icon: projectSettingsIcon(),
        onActivate: async (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          const context = pendingContextMenu;
          nativeMenu.remove();
          closeMenu();
          if (context) await openProjectSettingsPage(context);
        },
      });

      const trigger = document.createElement("div");
      trigger.setAttribute("role", "menuitem");
      trigger.setAttribute("tabindex", "-1");
      trigger.setAttribute("data-orientation", "vertical");
      trigger.setAttribute(MENU_ATTR, "trigger");
      trigger.className =
        nativeItem instanceof HTMLElement && nativeItem.className
          ? nativeItem.className
          : "text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] " +
            "py-[var(--padding-row-y)] text-sm electron:text-base flex w-full items-center " +
            "group hover:bg-token-list-hover-background focus:bg-token-list-hover-background " +
            "cursor-interaction";
      trigger.classList.remove("w-full", "items-center", "gap-2");
      trigger.classList.add("flex", "flex-col");

      const row = document.createElement("div");
      row.className = "flex w-full items-center gap-1.5";

      const label = document.createElement("span");
      label.className = "flex-1 min-w-0 truncate";
      label.textContent = "Project color";

      const chevron = document.createElement("span");
      chevron.className = "text-token-text-secondary";
      chevron.textContent = "›";

      row.append(projectColorIcon(), label, chevron);
      trigger.appendChild(row);
      const open = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        openColorMenu(pendingContextMenu.label, pendingContextMenu.x, pendingContextMenu.y, trigger);
      };
      trigger.addEventListener("pointerenter", open);
      trigger.addEventListener("focus", open);
      trigger.addEventListener("click", open);
      const removeItem = findRemoveMenuItem(nativeMenu);
      nativeMenu.insertBefore(copyPathItem, removeItem);
      nativeMenu.insertBefore(settingsItem, removeItem);
      nativeMenu.insertBefore(trigger, removeItem);
    };

    const createNativeMenuItem = ({ nativeItem, attr, label, icon, onActivate }) => {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "-1");
      item.setAttribute("data-orientation", "vertical");
      item.setAttribute(MENU_ATTR, attr);
      item.className =
        nativeItem instanceof HTMLElement && nativeItem.className
          ? nativeItem.className
          : "text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] " +
            "py-[var(--padding-row-y)] text-sm electron:text-base flex flex-col " +
            "group hover:bg-token-list-hover-background focus:bg-token-list-hover-background " +
            "cursor-interaction";
      item.classList.remove("w-full", "items-center", "gap-2");
      item.classList.add("flex", "flex-col");

      const row = document.createElement("div");
      row.className = "flex w-full items-center gap-1.5";

      const text = document.createElement("span");
      text.className = "flex-1 min-w-0 truncate";
      text.textContent = label;

      row.append(icon, text);
      item.appendChild(row);
      item.addEventListener("click", onActivate);
      return item;
    };

    const copyText = async (text) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    };

    const copyPathIcon = () => {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("width", "20");
      icon.setAttribute("height", "20");
      icon.setAttribute("viewBox", "0 0 20 20");
      icon.setAttribute("fill", "none");
      icon.setAttribute("aria-hidden", "true");
      icon.classList.add(
        "icon-xs",
        "shrink-0",
        "opacity-75",
        "group-focus:opacity-100",
        "group-hover:opacity-100",
      );

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M7.5 5.5V4.75C7.5 3.78 8.28 3 9.25 3H14C14.97 3 15.75 3.78 15.75 4.75V11.5C15.75 12.47 14.97 13.25 14 13.25H13.25M6 6.75H10.75C11.72 6.75 12.5 7.53 12.5 8.5V15.25C12.5 16.22 11.72 17 10.75 17H6C5.03 17 4.25 16.22 4.25 15.25V8.5C4.25 7.53 5.03 6.75 6 6.75Z",
      );
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.35");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.appendChild(path);
      return icon;
    };

    const projectSettingsIcon = () => {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("fill", "none");
      icon.setAttribute("aria-hidden", "true");
      icon.classList.add(
        "icon-xs",
        "shrink-0",
        "opacity-75",
        "group-focus:opacity-100",
        "group-hover:opacity-100",
      );

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M3 4.75C3 3.78 3.78 3 4.75 3h6.5C12.22 3 13 3.78 13 4.75v6.5c0 .97-.78 1.75-1.75 1.75h-6.5C3.78 13 3 12.22 3 11.25v-6.5Z M5.25 6h5.5 M5.25 8h5.5 M5.25 10h3.25",
      );
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.35");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.appendChild(path);
      return icon;
    };

    const projectColorIcon = () => {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("fill", "none");
      icon.setAttribute("aria-hidden", "true");
      icon.classList.add(
        "icon-xs",
        "shrink-0",
        "opacity-75",
        "group-focus:opacity-100",
        "group-hover:opacity-100",
      );

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M8 2.25C4.82 2.25 2.25 4.59 2.25 7.47C2.25 10.16 4.34 12.08 6.86 12.08H7.7C8.22 12.08 8.59 12.58 8.44 13.08C8.27 13.67 8.7 14.25 9.31 14.25C11.83 14.25 13.75 11.61 13.75 8.18C13.75 4.91 11.17 2.25 8 2.25Z M5.05 7.25H5.06 M6.4 5.05H6.41 M9.05 4.85H9.06 M10.95 7.05H10.96",
      );
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.45");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.appendChild(path);
      return icon;
    };

    const findRemoveMenuItem = (nativeMenu) =>
      nativeMenuItems(nativeMenu).find((item) => {
        const text = normalize(item.textContent || "");
        return text === "remove" || text === "delete" || text.includes("remove from");
      }) || null;

    const findNativeContextMenu = (x, y) => {
      const menus = openMenuRoots()
        .filter((node) => node instanceof HTMLElement && !node.hasAttribute(MENU_ATTR))
        .filter((node) => findRemoveMenuItem(node) || isKnownNativeMenuText(menuText(node)));
      return menus
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => {
          const da = Math.abs(a.rect.left - x) + Math.abs(a.rect.top - y);
          const db = Math.abs(b.rect.left - x) + Math.abs(b.rect.top - y);
          return da - db;
        })[0]?.node || null;
    };

    const syncNativeMenuChecks = (label) => {
      const selected = colorPrefs[projectKey(label)] || "auto";
      menu?.querySelectorAll(`[${MENU_ATTR}="item"]`).forEach((item) => {
        const id = item.getAttribute("data-color-id");
        const overlayId = item.getAttribute("data-overlay-id");
        const isSelected = id ? id === selected : overlayId === overlayIntensityFor(label);
        item.setAttribute("aria-pressed", String(isSelected));
        const check = item.querySelector(`[${MENU_ATTR}="check"]`);
        if (check) check.textContent = isSelected ? "✓" : "";
      });
    };

    const applyColorToCurrentRows = (label) => {
      const sidebar = mainSidebar();
      if (!sidebar) return;
      const rows = candidateRows(sidebar).filter((row) => labelFor(row) === projectKey(label));
      markRows(rows);
    };


    const apply = () => {
      const sidebar = mainSidebar();
      if (!sidebar) {
        return;
      }

      preserveSidebarScroll(sidebar, () => {
        sidebar.querySelectorAll("div[role='listitem'][aria-label]").forEach((row) => {
          if (isExcludedProjectRow(row)) clearRowMarks(row);
        });

        let rows = candidateRows(sidebar);
        rows = rows.filter((node, index) => rows.indexOf(node) === index);
        const seenLabels = new Set();
        rows = rows.filter((node) => {
          const label = labelFor(node);
          if (!label || seenLabels.has(label)) return false;
          seenLabels.add(label);
          return true;
        });
        if (!rows.length) {
          return;
        }

        reconcileMarkedRows(rows);
        markRows(rows);
        if (apply._lastCount !== rows.length) {
          apply._lastCount = rows.length;
          api.log.info("sidebar project backgrounds marked rows", {
            count: rows.length,
            labels: rows.slice(0, 8).map(labelFor),
          });
        }
      });
    };

    const preserveSidebarScroll = (sidebar, mutate) => {
      const snapshots = sidebarScrollSnapshots(sidebar);
      try {
        mutate();
      } finally {
        restoreSidebarScroll(snapshots);
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => restoreSidebarScroll(snapshots));
        }
      }
    };

    const sidebarScrollSnapshots = (sidebar) => {
      const nodes = [sidebar, ...Array.from(sidebar.querySelectorAll("*"))];
      return nodes
        .filter((node) => (
          node instanceof HTMLElement &&
          typeof node.scrollTop === "number" &&
          typeof node.scrollLeft === "number" &&
          (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
        ))
        .map((node) => ({
          node,
          top: node.scrollTop,
          left: node.scrollLeft,
        }));
    };

    const restoreSidebarScroll = (snapshots) => {
      for (const snapshot of snapshots) {
        if (!(snapshot.node instanceof HTMLElement) || !snapshot.node.isConnected) continue;
        if (snapshot.node.scrollTop !== snapshot.top) snapshot.node.scrollTop = snapshot.top;
        if (snapshot.node.scrollLeft !== snapshot.left) snapshot.node.scrollLeft = snapshot.left;
      }
    };

    const reconcileMarkedRows = (rows) => {
      const active = new Set(rows);
      document.querySelectorAll(`[${ATTR}="row"]`).forEach((row) => {
        if (!(row instanceof HTMLElement)) return;
        if (active.has(row) && row.isConnected) return;
        clearRowMarks(row);
      });
    };

    const clearRowMarks = (row) => {
      row.removeAttribute(ATTR);
      row.removeAttribute("data-codexpp-sidebar-project-expanded");
      clearProjectStyleVars(row);
      row.style.removeProperty("--codexpp-project-blue-token-override");
      row.style.removeProperty("--codexpp-project-link-token-override");
      row.querySelectorAll(`[${ATTR}]`).forEach((node) => {
        node.removeAttribute(ATTR);
        if (node instanceof HTMLElement) clearProjectStyleVars(node);
      });
    };

    const setAttr = (node, name, value) => {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    };

    const setStyleVar = (node, name, value) => {
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    };

    const setOptionalStyleVar = (node, name, value) => {
      if (value) setStyleVar(node, name, value);
      else if (node.style.getPropertyValue(name)) node.style.removeProperty(name);
    };

    let scheduled = false;
    const scheduleApply = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        if (disposed) return;
        apply();
      }, 0);
    };

    let childListTimer = null;
    const scheduleApplySoon = () => {
      if (disposed || childListTimer) return;
      childListTimer = window.setTimeout(() => {
        childListTimer = null;
        scheduleApply();
      }, 120);
    };

    const onProjectColorChanged = (event) => {
      const detail = event?.detail || {};
      const key = normalize(detail.projectKey || "");
      if (!key) return;
      const colorId = String(detail.colorId || "auto");
      if ("colorId" in detail) {
        colorPrefs = { ...colorPrefs };
        if (colorId === "auto") delete colorPrefs[key];
        else colorPrefs[key] = colorId;
        window[colorPrefsCacheKey] = colorPrefs;
      }
      if ("overlayIntensity" in detail) {
        const intensity = normalizeProjectOverlayIntensity(detail.overlayIntensity);
        overlayPrefs = { ...overlayPrefs };
        if (intensity === DEFAULT_PROJECT_OVERLAY_INTENSITY) delete overlayPrefs[key];
        else overlayPrefs[key] = intensity;
        window[overlayPrefsCacheKey] = overlayPrefs;
      }
      scheduleApply();
    };

    scheduleApply();
    const retryTimers = [250, 1000, 2500].map((delay) =>
      window.setTimeout(scheduleApply, delay),
    );
    const observer = new MutationObserver(scheduleApplySoon);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [
        "aria-label",
        "class",
        "data-app-action-sidebar-project-collapsed",
        "data-app-action-sidebar-project-id",
        "data-app-action-sidebar-project-label",
        "data-app-action-sidebar-project-row",
        "data-codexpp-sidebar-project-expanded",
        ATTR,
        "role",
        "style",
      ],
      childList: true,
      subtree: true,
    });
    document.addEventListener("contextmenu", onProjectContextMenu, true);
    document.addEventListener("pointerdown", onProjectOverflowTrigger, true);
    document.addEventListener("click", onProjectOverflowTrigger, true);
    window.addEventListener("focus", scheduleApply);
    document.addEventListener("visibilitychange", scheduleApply);
    window.addEventListener(COLOR_EVENT, onProjectColorChanged);

    api.log.info("sidebar project backgrounds active");

    return () => {
      disposed = true;
      observer.disconnect();
      if (childListTimer) window.clearTimeout(childListTimer);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener("contextmenu", onProjectContextMenu, true);
      document.removeEventListener("pointerdown", onProjectOverflowTrigger, true);
      document.removeEventListener("click", onProjectOverflowTrigger, true);
      window.removeEventListener("focus", scheduleApply);
      document.removeEventListener("visibilitychange", scheduleApply);
      window.removeEventListener(COLOR_EVENT, onProjectColorChanged);
      closeMenu();
      clearMarks();
      style.remove();
    };
  },

  /**
   * Add a Codex-native hover line to assistant messages with turn metrics.
   * Metrics are read from the main process, which parses Codex's local
   * `token_count` + `task_complete` JSONL events.
   */
  "show-message-metrics-on-hover"(api) {
    const MESSAGE_NODE_SELECTOR = "div.group.flex.min-w-0.flex-col";
    const MESSAGE_MARKDOWN_SELECTOR = "._markdownContent_1rhk1_42";
    const mounted = new Map();
    const streamStats = new WeakMap();
    let metrics = [];
    let disposed = false;
    let scanScheduled = false;
    let refreshScheduled = false;

    const hasMetricMessageSurface = () =>
      Boolean(document.querySelector(`${MESSAGE_NODE_SELECTOR} ${MESSAGE_MARKDOWN_SELECTOR}`));

    const refreshMetrics = async () => {
      if (disposed || !hasMetricMessageSurface()) return false;
      try {
        const next = await api.ipc.invoke("message-metrics");
        if (Array.isArray(next)) {
          metrics = next;
          scheduleScan();
          return true;
        }
      } catch (e) {
        api.log.warn("[message-metrics] metrics unavailable", e);
      }
      return false;
    };

    const scheduleRefresh = () => {
      if (refreshScheduled || disposed) return;
      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        refreshMetrics();
      });
    };

    const scheduleScan = () => {
      if (scanScheduled || disposed) return;
      scanScheduled = true;
      requestAnimationFrame(() => {
        scanScheduled = false;
        scanMessages();
      });
    };

    // Inert short-circuit (Phase 5.4): cache the markdown text length we last
    // processed per node. If the streamed content hasn't grown since the last
    // scan, skip the cleanMetricText + findMetricForText work. We still call
    // trackVisibleStream because it owns its own internal idempotency.
    const lastTextLen = new WeakMap();
    const scanMessages = () => {
      if (disposed || metrics.length === 0) return;
      const nodes = document.querySelectorAll(MESSAGE_NODE_SELECTOR);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const markdown = node.querySelector(MESSAGE_MARKDOWN_SELECTOR);
        if (!markdown) continue;
        const rawText = markdown.textContent || "";
        trackVisibleStream(streamStats, markdown, rawText);
        const prevLen = lastTextLen.get(markdown);
        if (prevLen === rawText.length) continue;
        lastTextLen.set(markdown, rawText.length);
        const text = cleanMetricText(rawText);
        if (text.length < 12) continue;
        const match = findMetricForText(metrics, text);
        if (!match) continue;
        const displayMetric = addObservedTps(match, streamStats.get(markdown));
        let line = node.querySelector("[data-codexpp-message-metrics]");
        if (!line) {
          line = renderMessageMetricLine(displayMetric);
          node.appendChild(line);
        } else {
          updateMessageMetricLine(line, displayMetric);
        }
        mounted.set(node, line);
      }
    };

    const onMutate = () => {
      scheduleScan();
      scheduleRefresh();
    };
    const observer = new MutationObserver(onMutate);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    scheduleRefresh();
    const timer = window.setInterval(scheduleRefresh, 15_000);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(timer);
      for (const [, line] of mounted) line.remove();
      mounted.clear();
    };
  },

};

// ─────────────────────────────────────────────────────────────── helpers ──

const LEGACY_BRAND_TOKEN = ["Code", "MAXXER"].join("");
const LEGACY_BRAND_RE = new RegExp(`${LEGACY_BRAND_TOKEN}|Codex\\+\\+`, "gi");

function normalizeLegacyBrandText(value) {
  return String(value || "").replace(LEGACY_BRAND_RE, "ShadGPT");
}

function startLegacyBrandUiScrubber(api) {
  if (typeof document === "undefined" || !document.documentElement) return null;
  let disposed = false;
  let scheduled = false;
  const pending = new Set();

  const flush = () => {
    scheduled = false;
    if (disposed) return;
    const roots = [...pending];
    pending.clear();
    try {
      for (const node of roots) {
        if (node instanceof HTMLElement && node.isConnected) {
          renameLegacyBrandInElement(node);
        }
      }
    } catch (e) {
      api.log.warn("legacy ShadGPT UI branding scrub failed", e);
    }
  };

  const enqueue = (node) => {
    if (node instanceof HTMLElement) pending.add(node);
    else if (node && node.parentElement) pending.add(node.parentElement);
  };

  // Scrub only the subtrees that actually changed instead of re-scanning the
  // entire document every frame, and ignore characterData: legacy brand text
  // lives in static UI labels/attributes delivered via childList/attribute
  // mutations, so per-token streaming text never needs a rescan. The old
  // implementation ran querySelectorAll(LEGACY_BRAND_UI_SELECTOR) over the
  // whole document on every animation frame during streaming.
  const schedule = (records) => {
    if (disposed) return;
    if (records) {
      for (const rec of records) {
        if (rec.type === "attributes") enqueue(rec.target);
        else if (rec.type === "childList") {
          for (const node of rec.addedNodes) enqueue(node);
        }
      }
    } else {
      enqueue(document.documentElement);
    }
    if (scheduled || pending.size === 0) return;
    scheduled = true;
    window.requestAnimationFrame(flush);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "placeholder", "value"],
  });
  schedule();
  api.log.info("legacy ShadGPT UI branding scrubber active");

  return () => {
    disposed = true;
    observer.disconnect();
    pending.clear();
  };
}

const LEGACY_BRAND_UI_SELECTOR = [
  "button",
  "a",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[aria-label]",
  "[title]",
  "[data-testid]",
  "[data-codexpp]",
  "[data-codexpp-store-grid]",
  "[data-codexpp-store-source]",
  "[data-codexpp-store-card-message]",
].join(",");

function renameLegacyBrandInElement(root) {
  if (!(root instanceof HTMLElement)) return;
  for (const attr of ["aria-label", "title"]) {
    const value = root.getAttribute(attr);
    if (value && LEGACY_BRAND_RE.test(value)) {
      root.setAttribute(attr, normalizeLegacyBrandText(value));
    }
    LEGACY_BRAND_RE.lastIndex = 0;
  }
  root.querySelectorAll("[aria-label], [title]").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    for (const attr of ["aria-label", "title"]) {
      const value = node.getAttribute(attr);
      if (value && LEGACY_BRAND_RE.test(value)) {
        node.setAttribute(attr, normalizeLegacyBrandText(value));
      }
      LEGACY_BRAND_RE.lastIndex = 0;
    }
  });

  const nodes = [];
  const doc = root.ownerDocument || document;
  if (typeof doc.createTreeWalker === "function") {
    const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
    const walker = doc.createTreeWalker(root, showText);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  } else {
    const collectTextNodes = (node) => {
      for (const child of Array.from(node.childNodes || [])) {
        if (child.nodeType === 3) nodes.push(child);
        else collectTextNodes(child);
      }
    };
    collectTextNodes(root);
  }
  for (const node of nodes) {
    if (node.parentElement?.closest("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) {
      continue;
    }
    const value = node.nodeValue || "";
    if (LEGACY_BRAND_RE.test(value)) node.nodeValue = normalizeLegacyBrandText(value);
    LEGACY_BRAND_RE.lastIndex = 0;
  }
}

// ── message metrics ───────────────────────────────────────────────────────
const MAIN_LEGACY_BRAND_SCRUBBER_KEY = "__shadgptUiImprovementsMainLegacyBrandScrubber";
const METRICS_GLOBAL_KEY = "__shadgptUiImprovementsMessageMetrics";
const METRICS_HANDLER_KEY = "__shadgptUiImprovementsMessageMetricsHandler";
const USAGE_GLOBAL_KEY = "__shadgptUiImprovementsUsageService";
const USAGE_HANDLER_KEY = "__shadgptUiImprovementsUsageHandler";
const PROJECT_LABEL_GLOBAL_KEY = "__shadgptUiImprovementsProjectLabels";
const PROJECT_LABEL_HANDLER_KEY = "__shadgptUiImprovementsProjectLabelsHandler";
const SIDEBAR_BATCH_MENU_GLOBAL_KEY = "__shadgptUiImprovementsSidebarBatchMenu";
const SIDEBAR_BATCH_MENU_HANDLER_KEY =
  "__shadgptUiImprovementsSidebarBatchMenuHandler";
const TWEAK_MENTION_HANDLER_KEY = "__shadgptUiImprovementsTweakMentionHandler";

function startMainLegacyBrandUiScrubber(api) {
  let electron;
  try {
    electron = require("electron");
  } catch (e) {
    api.log.warn("[legacy-branding] electron unavailable", e);
    return null;
  }

  const { app, webContents } = electron;
  const script = legacyBrandMainInjectionScript();

  const inject = (wc) => {
    try {
      if (!wc || wc.isDestroyed?.()) return;
      const url = typeof wc.getURL === "function" ? wc.getURL() : "";
      if (url && !url.startsWith("app://")) return;
      wc.executeJavaScript(script, true).catch((e) => {
        api.log.warn("[legacy-branding] renderer scrub injection failed", String(e?.message || e));
      });
    } catch (e) {
      api.log.warn("[legacy-branding] renderer scrub injection failed", String(e?.message || e));
    }
  };

  const scan = () => {
    try {
      for (const wc of webContents.getAllWebContents()) inject(wc);
    } catch (e) {
      api.log.warn("[legacy-branding] webContents scan failed", String(e?.message || e));
    }
  };

  const onCreated = (_event, wc) => inject(wc);
  app?.on?.("web-contents-created", onCreated);
  scan();

  const previous = globalThis[MAIN_LEGACY_BRAND_SCRUBBER_KEY];
  previous?.dispose?.();
  const dispose = () => {
    try {
      app?.off?.("web-contents-created", onCreated);
    } catch {
      // Ignore cleanup errors during hot reload.
    }
  };
  globalThis[MAIN_LEGACY_BRAND_SCRUBBER_KEY] = { dispose };
  api.log.info("[legacy-branding] main renderer scrubber active");
  return dispose;
}

function startMainBrowserAnnotationComposerModePatch(api) {
  let electron;
  try {
    electron = require("electron");
  } catch (e) {
    api.log.warn("[browser-annotation] electron unavailable", e);
    return null;
  }

  const { protocol } = electron;
  if (!protocol || typeof protocol.handle !== "function") return null;

  const previous = globalThis[MAIN_BROWSER_ANNOTATION_COMPOSER_MODE_PATCH_KEY];
  try {
    previous?.dispose?.();
  } catch (e) {
    api.log.warn("[browser-annotation] previous renderer patch dispose failed", String(e?.message || e));
    delete globalThis[MAIN_BROWSER_ANNOTATION_COMPOSER_MODE_PATCH_KEY];
  }

  const originalHandle = protocol.handle;
  const patchedHandle = function shadgptBrowserAnnotationProtocolHandle(scheme, handler) {
    if (scheme !== "app" || typeof handler !== "function") {
      return originalHandle.apply(this, arguments);
    }

    const wrappedHandler = async (request) => {
      const response = await handler(request);
      if (!isBrowserAnnotationRendererAsset(request?.url)) return response;

      try {
        if (!response || typeof response.text !== "function" || typeof response.clone !== "function") {
          return response;
        }
        const readableResponse = response.clone();
        const originalText = await readableResponse.text();
        const patch = browserAnnotationDefaultModePatch(originalText);
        if (!patch.changed) {
          return response;
        }
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.set("content-type", "text/javascript; charset=utf-8");
        api.log.info("[browser-annotation] patched browser comment Enter behavior");
        return new Response(patch.source, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (e) {
        api.log.warn("[browser-annotation] renderer patch failed", String(e?.message || e));
        return response;
      }
    };

    return originalHandle.call(this, scheme, wrappedHandler);
  };
  protocol.handle = patchedHandle;

  const dispose = () => {
    if (protocol.handle === patchedHandle) {
      protocol.handle = originalHandle;
    }
    if (globalThis[MAIN_BROWSER_ANNOTATION_COMPOSER_MODE_PATCH_KEY]?.dispose === dispose) {
      delete globalThis[MAIN_BROWSER_ANNOTATION_COMPOSER_MODE_PATCH_KEY];
    }
  };
  globalThis[MAIN_BROWSER_ANNOTATION_COMPOSER_MODE_PATCH_KEY] = { dispose };
  api.log.info("[browser-annotation] composer mode renderer patch active");
  return dispose;
}

function isBrowserAnnotationRendererAsset(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  try {
    const basename = new URL(rawUrl).pathname.split("/").pop() || "";
    return /^(composer|annotation-comment-editor-card|thread-side-panel-tabs)-[A-Za-z0-9_-]+\.js$/.test(basename);
  } catch {
    return false;
  }
}

function patchBrowserAnnotationDefaultMode(source) {
  return browserAnnotationDefaultModePatch(source).source;
}

function startMainTweakMentionProvider(api) {
  const manager = api.codex?.tweaks;
  if (!manager || typeof api.ipc?.handle !== "function") {
    api.log.warn("[tweak-mention] codex.tweaks API unavailable");
    return null;
  }

  try {
    globalThis[TWEAK_MENTION_HANDLER_KEY]?.dispose?.();
  } catch (e) {
    api.log.warn("[tweak-mention] previous handler dispose failed", String(e?.message || e));
  }

  const dispose = api.ipc.handle("tweak-mentions-list", () => {
    const installed = typeof manager.listInstalled === "function" ? manager.listInstalled() : [];
    return installed.map((item) => ({
      manifest: {
        id: item?.manifest?.id,
        name: item?.manifest?.name,
        description: item?.manifest?.description,
      },
      enabled: item?.enabled !== false,
    }));
  });
  globalThis[TWEAK_MENTION_HANDLER_KEY] = { dispose };
  api.log.info("[tweak-mention] installed tweak mention provider active");
  return () => {
    try {
      dispose?.();
    } finally {
      if (globalThis[TWEAK_MENTION_HANDLER_KEY]?.dispose === dispose) {
        delete globalThis[TWEAK_MENTION_HANDLER_KEY];
      }
    }
  };
}

function browserAnnotationDefaultModePatch(source) {
  if (typeof source !== "string" || source.length === 0) {
    return { changed: false, source, reason: "invalid-source" };
  }

  const candidates = BROWSER_ANNOTATION_DEFAULT_MODE_REWRITES
    .map((rewrite) => ({
      ...rewrite,
      targetCount: countOccurrences(source, rewrite.target),
      replacementCount: countOccurrences(source, rewrite.replacement),
    }))
    .filter((rewrite) => rewrite.targetCount > 0);

  if (candidates.length === 0) {
    return { changed: false, source, reason: "current-or-unknown-asset" };
  }
  if (candidates.length !== 1 || candidates[0].targetCount !== 1) {
    return { changed: false, source, reason: "ambiguous-legacy-target" };
  }

  const rewrite = candidates[0];
  const patched = source.replace(rewrite.target, rewrite.replacement);
  if (
    patched === source ||
    countOccurrences(patched, rewrite.target) !== 0 ||
    countOccurrences(patched, rewrite.replacement) !== rewrite.replacementCount + 1
  ) {
    return { changed: false, source, reason: "unverified-rewrite" };
  }

  return { changed: true, source: patched, reason: rewrite.reason };
}

function countOccurrences(source, needle) {
  if (typeof source !== "string" || typeof needle !== "string" || needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function legacyBrandMainInjectionScript() {
  return `(() => {
    const KEY = "__shadgptLegacyVisibleBrandScrubber";
    const pattern = /${LEGACY_BRAND_TOKEN}|Codex\\+\\+/gi;
    const normalize = (value) => String(value || "").replace(pattern, "ShadGPT");
    const scrubText = (node) => {
      if (!node) return;
      if (node.parentElement?.closest("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) return;
      const value = node.nodeValue || "";
      if (pattern.test(value)) node.nodeValue = normalize(value);
      pattern.lastIndex = 0;
    };
    const scrubEl = (el) => {
      if (!el || typeof el.getAttribute !== "function") return;
      for (const attr of ["aria-label", "title", "placeholder"]) {
        const value = el.getAttribute(attr);
        if (value && pattern.test(value)) el.setAttribute(attr, normalize(value));
        pattern.lastIndex = 0;
      }
    };
    const scrubNode = (root) => {
      if (!root) return;
      if (root.nodeType === 3) { scrubText(root); return; }
      if (root.nodeType !== 1) return;
      scrubEl(root);
      if (root.querySelectorAll) for (const el of root.querySelectorAll("*")) scrubEl(el);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) scrubText(walker.currentNode);
    };
    if (!window[KEY]) {
      const pending = new Set();
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        const roots = [...pending];
        pending.clear();
        for (const root of roots) { try { scrubNode(root); } catch (e) {} }
      };
      const enqueue = (node) => {
        if (node && (node.nodeType === 1 || node.nodeType === 3)) pending.add(node);
      };
      // Scrub only changed subtrees, not the whole document each frame, and
      // drop characterData so per-streamed-token text never triggers a rescan.
      const schedule = (records) => {
        for (const rec of records) {
          if (rec.type === "attributes") enqueue(rec.target);
          else if (rec.type === "childList") { for (const node of rec.addedNodes) enqueue(node); }
        }
        if (scheduled || pending.size === 0) return;
        scheduled = true;
        requestAnimationFrame(flush);
      };
      const observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "title", "placeholder"]
      });
      window[KEY] = { observer };
    }
    scrubNode(document.documentElement);
  })();`;
}

function startMainMetricsProvider(api) {
  const service = createMetricsService(api);
  globalThis[METRICS_GLOBAL_KEY] = service;

  // ShadGPT currently exposes `handle()` without a matching removeHandler().
  // Keep the registered IPC handler stable across hot reloads and swap the
  // service behind it instead.
  if (!globalThis[METRICS_HANDLER_KEY]) {
    api.ipc.handle("message-metrics", () => {
      const active = globalThis[METRICS_GLOBAL_KEY];
      return active?.getMetrics?.() || [];
    });
    globalThis[METRICS_HANDLER_KEY] = true;
  }

  api.log.info("[message-metrics] main provider active");
  return () => disposeMainService(METRICS_GLOBAL_KEY, service);
}

function startMainUsageProvider(api) {
  const service = createUsageService(api);
  globalThis[USAGE_GLOBAL_KEY] = service;

  if (!globalThis[USAGE_HANDLER_KEY]) {
    api.ipc.handle("usage-fetch", (_url = "/wham/usage") => {
      const active = globalThis[USAGE_GLOBAL_KEY];
      return active?.fetchUsage?.() || null;
    });
    globalThis[USAGE_HANDLER_KEY] = true;
  }

  api.log.info("[usage] main provider active");
  return () => disposeMainService(USAGE_GLOBAL_KEY, service);
}

function startMainProjectLabelProvider(api) {
  const service = createProjectLabelService(api);
  globalThis[PROJECT_LABEL_GLOBAL_KEY] = service;

  if (!globalThis[PROJECT_LABEL_HANDLER_KEY]) {
    api.ipc.handle("pinned-chat-project-labels", (_ids = []) => {
      const active = globalThis[PROJECT_LABEL_GLOBAL_KEY];
      return active?.getLabels?.(_ids) || {};
    });
    globalThis[PROJECT_LABEL_HANDLER_KEY] = true;
  }

  api.log.info("[pinned-chat-project-names] main provider active");
  return () => disposeMainService(PROJECT_LABEL_GLOBAL_KEY, service);
}

function startMainSidebarBatchMenuProvider(api) {
  const service = {
    disposed: false,
    show(payload) {
      if (service.disposed) return null;
      return showSidebarBatchMenu(payload);
    },
  };
  globalThis[SIDEBAR_BATCH_MENU_GLOBAL_KEY] = service;

  if (!globalThis[SIDEBAR_BATCH_MENU_HANDLER_KEY]) {
    api.ipc.handle("sidebar-chat-batch-menu", (payload = {}) => {
      const active = globalThis[SIDEBAR_BATCH_MENU_GLOBAL_KEY];
      return active?.show?.(payload) || null;
    });
    globalThis[SIDEBAR_BATCH_MENU_HANDLER_KEY] = true;
  }

  api.log.info("[sidebar-chat-multi-select] main menu provider active");
  return () => disposeMainService(SIDEBAR_BATCH_MENU_GLOBAL_KEY, service);
}

function disposeMainService(key, service) {
  try {
    service.dispose?.();
  } finally {
    service.disposed = true;
    if (globalThis[key] === service) delete globalThis[key];
  }
}

function showSidebarBatchMenu(payload) {
  const { BrowserWindow, Menu } = require("electron");
  const count = Math.max(0, Number(payload?.count) || 0);
  if (!count) return null;

  const win = BrowserWindow.getFocusedWindow();
  if (!win || win.isDestroyed()) return null;

  const x = Math.max(0, Math.round(Number(payload?.x) || 0));
  const y = Math.max(0, Math.round(Number(payload?.y) || 0));
  const canPin = payload?.canPin !== false;
  const canArchive = payload?.canArchive !== false;
  const suffix = count === 1 ? "" : "s";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      resolve(action);
    };

    const menu = Menu.buildFromTemplate([
      {
        label: `Pin ${count} chat${suffix}`,
        enabled: canPin,
        click: () => finish("pin"),
      },
      {
        label: `Archive ${count} chat${suffix}`,
        enabled: canArchive,
        click: () => finish("archive"),
      },
      {
        label: `Open ${count} mini window${suffix}`,
        click: () => finish("mini-window"),
      },
    ]);

    menu.popup({
      window: win,
      x,
      y,
      callback: () => finish(null),
    });
  });
}

function createProjectLabelService(api) {
  let cache = { at: 0, labels: new Map(), covered: new Set() };
  let disposed = false;
  const TTL_MS = 30_000;

  return {
    getLabels(ids) {
      if (disposed) return {};
      const requested = Array.isArray(ids)
        ? ids.map(normalizeConversationId).filter(Boolean)
        : [];
      if (requested.length === 0) return {};
      const now = Date.now();
      if (now - cache.at > TTL_MS) {
        try {
          cache = {
            at: now,
            labels: readConversationProjectLabels(requested),
            covered: new Set(requested),
          };
        } catch (e) {
          api.log.warn("[pinned-chat-project-names] scan failed", e);
          cache = { at: now, labels: new Map(), covered: new Set(requested) };
        }
      } else {
        const missing = requested.filter((id) => !cache.covered.has(id));
        if (missing.length) {
          try {
            const labels = readConversationProjectLabels(missing);
            for (const [id, record] of labels) cache.labels.set(id, record);
          } catch (e) {
            api.log.warn("[pinned-chat-project-names] scan failed", e);
          }
          for (const id of missing) cache.covered.add(id);
          cache.at = now;
        }
      }
      const out = {};
      for (const id of requested) {
        const record = cache.labels.get(id);
        if (record) out[id] = record;
      }
      return out;
    },
    dispose() {
      disposed = true;
      cache = { at: 0, labels: new Map(), covered: new Set() };
    },
  };
}

function readConversationProjectLabels(requestedIds = []) {
  const fs = require("node:fs");
  const path = require("node:path");
  const home = process.env.HOME || require("node:os").homedir();
  const requested = new Set(
    requestedIds.map(normalizeConversationId).filter(Boolean),
  );
  if (requested.size === 0) return new Map();
  const files = collectBoundedSessionFiles(fs, [
    {
      dir: path.join(home, ".codex", "sessions"),
      maxFiles: SESSION_SCAN_LIMITS.projectLabelActiveFiles,
    },
    {
      dir: path.join(home, ".codex", "archived_sessions"),
      maxFiles: SESSION_SCAN_LIMITS.projectLabelArchivedFiles,
    },
  ], SESSION_SCAN_LIMITS.projectLabelTotalFiles);

  const labels = new Map();
  for (const file of files) {
    const meta = readSessionMeta(fs, file.path);
    const id = normalizeConversationId(meta?.id);
    if (!id || !requested.has(id) || labels.has(id)) continue;
    const cwd = typeof meta?.cwd === "string" ? meta.cwd : null;
    if (!cwd) continue;
    const label = projectLabelForPath(path, cwd);
    if (label) labels.set(id, { label, cwd });
    if (labels.size >= requested.size) break;
  }
  return labels;
}

function readSessionMeta(fs, file) {
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf8", 0, bytes).split("\n")[0];
    if (!firstLine) return null;
    const row = JSON.parse(firstLine);
    return row?.type === "session_meta" ? row.payload : null;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors during best-effort sidebar labeling.
      }
    }
  }
}

function projectLabelForPath(path, cwd) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  if (!normalized || normalized === "~") return null;
  return path.basename(normalized) || normalized;
}

function normalizeConversationId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.replace(/^(local|remote|pending-worktree):/, "");
}

function createUsageService(api) {
  let cache = { at: 0, value: null };
  let disposed = false;
  const TTL_MS = 10_000;

  return {
    async fetchUsage() {
      if (disposed) return null;
      const now = Date.now();
      if (cache.value && now - cache.at < TTL_MS) return cache.value;
      const value = await fetchUsageInCodexWebview();
      cache = { at: Date.now(), value };
      return value;
    },
    dispose() {
      disposed = true;
      cache = { at: 0, value: null };
    },
  };

  async function fetchUsageInCodexWebview() {
    const { webContents } = require("electron");
    const candidates = webContents
      .getAllWebContents()
      .filter((wc) => {
        const url = wc.getURL();
        return !wc.isDestroyed() && (url.startsWith("app://") || url.includes("codex"));
      });

    let lastError = null;
    for (const wc of candidates) {
      try {
        return await wc.executeJavaScript(usageFetchScript(), true);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("no Codex webview available for usage fetch");
  }

  function usageFetchScript() {
    return `(() => new Promise((resolve, reject) => {
      const bridge = window.electronBridge;
      if (typeof bridge?.sendMessageFromView !== "function") {
        reject(new Error("electronBridge unavailable"));
        return;
      }
      const hostId = new URL(window.location.href).searchParams.get("hostId")?.trim() || "local";
      const requestId = "codexpp-main-usage-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      let done = false;
      const cleanup = () => {
        done = true;
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timer);
      };
      const finish = (fn, value) => {
        if (done) return;
        cleanup();
        fn(value);
      };
      const onMessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== "object" || data.type !== "fetch-response" || data.requestId !== requestId) return;
        if (data.responseType === "success") {
          try {
            const body = JSON.parse(data.bodyJsonString);
            if (data.status >= 200 && data.status < 300) finish(resolve, body);
            else finish(reject, new Error("HTTP " + data.status));
          } catch (error) {
            finish(reject, error);
          }
        } else {
          finish(reject, new Error(data.error || "fetch failed"));
        }
      };
      const timer = window.setTimeout(() => {
        bridge.sendMessageFromView({ type: "cancel-fetch", requestId }).catch(() => {});
        finish(reject, new Error("usage request timed out"));
      }, 10000);
      window.addEventListener("message", onMessage);
      bridge.sendMessageFromView({
        type: "fetch",
        hostId,
        requestId,
        method: "GET",
        url: "/wham/usage",
      }).catch((error) => finish(reject, error));
    }))();`;
  }
}

function createMetricsService(api) {
  let cache = { at: 0, items: [] };
  let disposed = false;
  const TTL_MS = 10_000;

  return {
    getMetrics() {
      if (disposed) return [];
      const now = Date.now();
      if (now - cache.at < TTL_MS) return cache.items;
      try {
        cache = { at: now, items: readRecentMessageMetrics() };
      } catch (e) {
        api.log.warn("[message-metrics] scan failed", e);
        cache = { at: now, items: [] };
      }
      return cache.items;
    },
    dispose() {
      disposed = true;
      cache = { at: 0, items: [] };
    },
  };
}

function readRecentMessageMetrics() {
  const fs = require("node:fs");
  const path = require("node:path");
  const home = process.env.HOME || require("node:os").homedir();
  const files = collectBoundedSessionFiles(fs, [
    {
      dir: path.join(home, ".codex", "sessions"),
      maxFiles: SESSION_SCAN_LIMITS.messageMetricsActiveFiles,
    },
    {
      dir: path.join(home, ".codex", "archived_sessions"),
      maxFiles: SESSION_SCAN_LIMITS.messageMetricsArchivedFiles,
    },
  ], SESSION_SCAN_LIMITS.messageMetricsTotalFiles);

  const byKey = new Map();
  let bytesRead = 0;
  for (const file of files) {
    // Some long-running archived rollouts can be huge; recent visible
    // conversations are covered by the smaller active session files.
    if (file.size > SESSION_SCAN_LIMITS.messageMetricsMaxFileBytes) continue;
    if (bytesRead + file.size > SESSION_SCAN_LIMITS.messageMetricsTotalBytes) break;
    bytesRead += file.size;
    for (const item of parseMetricsFile(fs, file.path)) {
      const key = item.turnId || `${item.completedAt}:${item.clean.slice(0, 80)}`;
      if (!byKey.has(key)) byKey.set(key, item);
    }
    if (byKey.size >= 300) break;
  }

  return Array.from(byKey.values())
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, 300);
}

function collectBoundedSessionFiles(fs, roots, totalLimit) {
  const files = [];
  for (const root of roots) {
    const bucket = [];
    collectJsonlFiles(fs, root.dir, bucket, root.maxFiles);
    files.push(...bucket);
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, totalLimit);
}

function collectJsonlFiles(fs, dir, out, maxFiles = Infinity) {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectJsonlFiles(fs, full, out, maxFiles);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // Ignore files that vanish during traversal.
      }
    }
  }
}

function parseMetricsFile(fs, file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const items = [];
  let lastUsage = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"token_count"') && !line.includes('"type":"task_complete"')) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row?.payload;
    if (payload?.type === "token_count") {
      lastUsage = payload.info || null;
      continue;
    }
    if (payload?.type !== "task_complete" || !payload.last_agent_message) {
      continue;
    }

    const clean = cleanMetricText(payload.last_agent_message);
    if (!clean) continue;
    const usage = lastUsage?.last_token_usage || null;

    items.push({
      turnId: payload.turn_id || null,
      clean,
      completedAt: numberOrNull(payload.completed_at),
      usage,
      contextWindow: numberOrNull(lastUsage?.model_context_window),
    });
  }
  return items;
}

function renderMessageMetricLine(metric) {
  const line = document.createElement("div");
  line.dataset.codexppMessageMetrics = "true";
  line.className =
    "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs " +
    "text-token-text-secondary opacity-0 transition-opacity duration-150 " +
    "group-hover:opacity-100";
  updateMessageMetricLine(line, metric);
  return line;
}

function updateMessageMetricLine(line, metric) {
  const usage = metric.usage || {};
  const parts = [];
  if (typeof usage.input_tokens === "number") {
    parts.push(`${formatCount(usage.input_tokens)} in`);
  }
  if (typeof usage.output_tokens === "number") {
    parts.push(`${formatCount(usage.output_tokens)} out`);
  }
  if (typeof usage.reasoning_output_tokens === "number" && usage.reasoning_output_tokens > 0) {
    parts.push(`${formatCount(usage.reasoning_output_tokens)} reasoning`);
  }
  if (typeof metric.observedTps === "number" && Number.isFinite(metric.observedTps)) {
    parts.push(`${formatTps(metric.observedTps)} tok/s`);
  }
  const text = parts.join(" · ");
  const title = messageMetricTitle(metric);
  if (line.textContent !== text) line.textContent = text;
  if (line.title !== title) line.title = title;
}

function trackVisibleStream(streamStats, markdown, rawText) {
  const now = performance.now();
  const text = String(rawText || "");
  const previous = streamStats.get(markdown);
  if (!previous) {
    streamStats.set(markdown, {
      firstAt: now,
      lastAt: now,
      lastText: text,
      frozenTps: null,
    });
    return;
  }
  if (previous.lastText === text) return;
  if (!previous.lastText && text) previous.firstAt = now;
  previous.lastAt = now;
  previous.lastText = text;
}

function addObservedTps(metric, stat) {
  if (!stat) return metric;
  if (typeof stat.frozenTps === "number") {
    return { ...metric, observedTps: stat.frozenTps };
  }
  const outputTokens = numberOrNull(metric.usage?.output_tokens);
  const elapsedMs = stat.lastAt - stat.firstAt;
  if (outputTokens == null || elapsedMs < 500) return metric;
  stat.frozenTps = outputTokens / (elapsedMs / 1000);
  return { ...metric, observedTps: stat.frozenTps };
}

function findMetricForText(metrics, visibleText) {
  const clean = cleanMetricText(visibleText);
  if (!clean) return null;
  for (const metric of metrics) {
    const candidate = metric.clean || "";
    if (!candidate) continue;
    const head = candidate.slice(0, Math.min(120, candidate.length));
    const tail = candidate.slice(Math.max(0, candidate.length - 80));
    if (head.length >= 30 && clean.includes(head)) return metric;
    if (clean.length >= 80 && candidate.includes(clean.slice(0, 120))) return metric;
    if (head.length >= 30 && tail.length >= 30 && clean.includes(head) && clean.includes(tail)) {
      return metric;
    }
  }
  return null;
}

function cleanMetricText(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/[*_~#>[\](){}|]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeTweakMentionItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const manifest = item?.manifest && typeof item.manifest === "object" ? item.manifest : item;
    const id = compactText(manifest?.id);
    const name = compactText(manifest?.name || id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = tweakMentionLabel(name, id);
    normalized.push({
      id,
      name,
      label,
      enabled: item?.enabled !== false,
      aliases: tweakMentionAliases(name, label, id),
    });
  }
  return normalized.sort((a, b) => a.label.localeCompare(b.label));
}

function tweakMentionLabel(name, id) {
  const raw = compactText(name || id);
  const withoutBrand = raw
    .replace(/^ShadGPT\s+/i, "")
    .replace(/^Codex\+\+\s+/i, "")
    .replace(/^Codex Plus Plus\s+/i, "");
  const withoutGenericSuffix = withoutBrand.replace(/\s+Agent$/i, "");
  return compactText(withoutGenericSuffix || withoutBrand || raw || id);
}

function tweakMentionAliases(name, label, id) {
  const aliases = new Set([name, label, id]);
  aliases.add(String(id || "").split(".").pop() || "");
  aliases.add(String(name || "").replace(/^ShadGPT\s+/i, ""));
  aliases.add(String(label || "").replace(/\s+Agent$/i, ""));
  return Array.from(aliases).map(compactText).filter(Boolean);
}

function normalizeMentionSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTextEntryElement(node) {
  if (!(node instanceof HTMLElement)) return false;
  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = String(node.getAttribute("type") || "text").toLowerCase();
    return !["button", "checkbox", "file", "hidden", "radio", "range", "submit"].includes(type);
  }
  if (node.getAttribute("contenteditable") === "true" || node.getAttribute("contenteditable") === "plaintext-only") {
    return true;
  }
  return node.classList?.contains?.("ProseMirror") === true;
}

function isComposerInput(node) {
  return Boolean(resolveComposerInput(node));
}

function resolveComposerInput(node) {
  let current = node;
  if (current && current.nodeType === Node.TEXT_NODE) current = current.parentElement;
  if (!(current instanceof HTMLElement)) return null;
  if (isTextEntryElement(current)) return current;

  const closestEditable = current.closest?.(
    "textarea, input, [contenteditable='true'], [contenteditable='plaintext-only'], .ProseMirror",
  );
  if (closestEditable instanceof HTMLElement && isTextEntryElement(closestEditable)) {
    return closestEditable;
  }

  const composerRoot = current.closest?.(
    "[data-testid*='composer' i], [aria-label*='composer' i], [aria-label*='prompt' i], form",
  );
  if (!(composerRoot instanceof HTMLElement)) return null;
  const nested = composerRoot.querySelector?.(
    "textarea, input, [contenteditable='true'], [contenteditable='plaintext-only'], .ProseMirror",
  );
  if (nested instanceof HTMLElement && isTextEntryElement(nested)) return nested;
  return null;
}

function activeComposerInput() {
  const active = document.activeElement;
  const activeInput = resolveComposerInput(active);
  if (activeInput) return activeInput;
  const selection = window.getSelection?.();
  const anchor = selection?.anchorNode;
  return resolveComposerInput(anchor);
}

function composerTextState(target) {
  target = resolveComposerInput(target);
  if (!target) return null;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const text = String(target.value || "");
    const caret = typeof target.selectionStart === "number" ? target.selectionStart : text.length;
    return { text, caret };
  }
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !target.contains(selection.anchorNode)) {
    const text = target.textContent || "";
    return document.activeElement === target && text ? { text, caret: text.length } : null;
  }
  const text = target.textContent || "";
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(target);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return { text, caret: range.toString().length };
}

function replaceComposerRange(target, start, end, replacement) {
  target = resolveComposerInput(target);
  if (!target) return;
  const mention = String(replacement || "");
  const tag = String(target?.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const value = String(target.value || "");
    const after = value.slice(end);
    const suffix = after && !/^\s/.test(after) ? " " : "";
    const next = `${value.slice(0, start)}${mention}${suffix}${after}`;
    const caret = start + mention.length + suffix.length;
    target.value = next;
    if (typeof target.setSelectionRange === "function") target.setSelectionRange(caret, caret);
    else {
      target.selectionStart = caret;
      target.selectionEnd = caret;
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const selection = window.getSelection?.();
  if (selection?.rangeCount && target.contains(selection.anchorNode)) {
    const text = target.textContent || "";
    const after = text.slice(end);
    const suffix = after && !/^\s/.test(after) ? " " : "";
    if (setTextSelectionByOffsets(target, start, end)) {
      const inserted = `${mention}${suffix}`;
      if (typeof document.execCommand === "function" && document.execCommand("insertText", false, inserted)) {
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(inserted);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges?.();
      selection.addRange?.(range);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
  }
  const text = target.textContent || "";
  const after = text.slice(end);
  const suffix = after && !/^\s/.test(after) ? " " : "";
  target.textContent = `${text.slice(0, start)}${mention}${suffix}${after}`;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextSelectionByOffsets(root, start, end) {
  const selection = window.getSelection?.();
  if (!selection || typeof document.createRange !== "function") return false;
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let ended = false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const length = node.nodeValue?.length || 0;
    const nextOffset = offset + length;
    if (!started && start >= offset && start <= nextOffset) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (!ended && end >= offset && end <= nextOffset) {
      range.setEnd(node, end - offset);
      ended = true;
      break;
    }
    offset = nextOffset;
    node = walker.nextNode();
  }
  if (!started || !ended) return false;
  selection.removeAllRanges?.();
  selection.addRange?.(range);
  return true;
}

function messageMetricTitle(metric) {
  const usage = metric.usage || {};
  const lines = [
    `Input tokens: ${formatRaw(usage.input_tokens)}`,
    `Cached input: ${formatRaw(usage.cached_input_tokens)}`,
    `Output tokens: ${formatRaw(usage.output_tokens)}`,
    `Reasoning output: ${formatRaw(usage.reasoning_output_tokens)}`,
    `Total tokens: ${formatRaw(usage.total_tokens)}`,
  ];
  if (typeof metric.observedTps === "number") {
    lines.push(`Observed stream rate: ${formatTps(metric.observedTps)} tok/s`);
  }
  return lines.join("\n");
}

function formatCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatRaw(n) {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "—";
}

function formatTps(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── usage snapshot persistence ────────────────────────────────────────────
// Stored under storage["usage:snapshot"]; survives reloads. Schema:
//   { fiveHour:{kind,pct,raw} | null, weekly:{kind,pct,raw} | null, at:number }
function readSnapshot(api) {
  const v = api.storage.get("usage:snapshot", null);
  if (!v || typeof v !== "object") return null;
  return v;
}
function writeSnapshot(api, snap) {
  api.storage.set("usage:snapshot", snap);
}

/**
 * Render a single rotating usage box. Click toggles between 5h and Weekly;
 * hover replaces the content with "Resets: HH:MM". The currently-selected
 * kind is persisted to storage so it survives reloads.
 *
 * The returned element exposes `_refresh(snapshot)` so callers can update
 * values in place without unmount/remount.
 */
function renderUsageBox(api, snapshot) {
  const ORDER = ["5h", "weekly"]; // toggle order
  let kind = api.storage.get("usage:visible-kind", "5h");
  if (!ORDER.includes(kind)) kind = "5h";

  const btn = document.createElement("button");
  btn.type = "button";
  // Keep alignment consistent with the row that hosted the upgrade pill.
  btn.className =
    "flex items-center justify-between gap-2 rounded-md border border-token-border " +
    "px-2 py-1 text-xs cursor-interaction transition-colors " +
    "hover:bg-token-foreground/10";

  const left = document.createElement("span");
  left.className = "truncate";
  const right = document.createElement("span");
  right.className = "tabular-nums flex items-center gap-1";

  btn.append(left, right);

  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const setClass = (node, className) => {
    if (node.className !== className) node.className = className;
  };
  const singleRightSpan = () => {
    let child = right.firstElementChild;
    if (!(child instanceof HTMLSpanElement)) {
      child = document.createElement("span");
      right.replaceChildren(child);
      return child;
    }
    while (child.nextSibling) child.nextSibling.remove();
    return child;
  };

  /** Pull the entry for `kind` out of the live snapshot. */
  const entryFor = (snap, k) => (k === "5h" ? snap.fiveHour : snap.weekly);

  /** Apply colors + text for the *value* state (i.e. not hover). */
  const applyValueState = (snap) => {
    const entry = entryFor(snap, kind);
    const pct = entry?.pct;
    const remaining = typeof pct === "number" ? pct : null;
    const lowEnergy = typeof remaining === "number" && remaining < 15;

    btn.classList.toggle("bg-token-charts-red/10", lowEnergy);
    btn.classList.toggle("text-token-charts-red", lowEnergy);
    btn.classList.toggle("bg-token-foreground/5", !lowEnergy);
    btn.classList.toggle("text-token-text-primary", !lowEnergy);

    setText(left, entry?.label || (kind === "5h" ? "5h" : "Weekly"));

    const pctEl = singleRightSpan();
    setText(pctEl, remaining == null ? "—" : `${remaining}%`);
    setClass(pctEl, lowEnergy ? "font-medium" : "text-token-text-secondary");
  };

  /** Replace the entire box content with "Resets: HH:MM". */
  const applyHoverState = (snap) => {
    const entry = entryFor(snap, kind);
    setText(left, "Resets:");
    setClass(left, "truncate text-token-text-secondary");
    const t = singleRightSpan();
    setClass(t, "tabular-nums");
    setText(t, entry?.resetAt || "—");
  };

  // Bind hover with a snapshot getter so handlers always see the latest.
  let currentSnap = snapshot;
  // While true, the cursor is *inside* the box but the user has clicked
  // since their last mouseleave — we suppress hover state until they
  // physically leave the element so the click's value state is sticky.
  let suppressHover = false;

  btn.addEventListener("mouseenter", () => {
    suppressHover = false;
    applyHoverState(currentSnap);
  });
  btn.addEventListener("mouseleave", () => {
    suppressHover = false;
    setClass(left, "truncate");
    applyValueState(currentSnap);
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const i = ORDER.indexOf(kind);
    kind = ORDER[(i + 1) % ORDER.length];
    api.storage.set("usage:visible-kind", kind);
    // Per the design: clicking shows the OTHER kind's value, even if the
    // cursor is still over the box.
    suppressHover = true;
    setClass(left, "truncate");
    applyValueState(currentSnap);
  });

  // Initial paint.
  applyValueState(currentSnap);

  // Allow the parent to push fresh data without remounting us. We honour
  // the click-guard so refreshes don't reintroduce hover state mid-click.
  btn._refresh = (next) => {
    if (next === currentSnap) return;
    currentSnap = next;
    if (btn.matches(":hover") && !suppressHover) applyHoverState(currentSnap);
    else applyValueState(currentSnap);
  };

  return btn;
}

function readFlag(api, id, fallback) {
  const v = api.storage.get(`feature:${id}`, undefined);
  return typeof v === "boolean" ? v : !!fallback;
}
function writeFlag(api, id, on) {
  api.storage.set(`feature:${id}`, !!on);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function sectionTitle(text) {
  const titleRow = el(
    "div",
    "flex h-toolbar items-center justify-between gap-2 px-0 py-0",
  );
  const inner = el("div", "flex min-w-0 flex-1 flex-col gap-1");
  const t = el("div", "text-base font-medium text-token-text-primary");
  t.textContent = text;
  inner.appendChild(t);
  titleRow.appendChild(inner);
  return titleRow;
}

function roundedCard() {
  const card = el(
    "div",
    "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border",
  );
  card.style.backgroundColor =
    "var(--color-background-panel, var(--color-token-bg-fog))";
  return card;
}

/** Codex-native toggle (lifted verbatim from tweaks/AGENTS.md §4). */
function switchControl(initial, onChange) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "switch");
  const pill = document.createElement("span");
  const knob = document.createElement("span");
  knob.className =
    "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] " +
    "shadow-sm transition-transform duration-200 ease-out h-4 w-4";
  pill.appendChild(knob);
  const apply = (on) => {
    btn.setAttribute("aria-checked", String(on));
    btn.dataset.state = on ? "checked" : "unchecked";
    btn.className =
      "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 " +
      "focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction";
    pill.className =
      "relative inline-flex shrink-0 items-center rounded-full transition-colors " +
      "duration-200 ease-out h-5 w-8 " +
      (on ? "bg-token-charts-blue" : "bg-token-foreground/20");
    pill.dataset.state = on ? "checked" : "unchecked";
    knob.dataset.state = on ? "checked" : "unchecked";
    knob.style.transform = on ? "translateX(14px)" : "translateX(2px)";
  };
  apply(initial);
  btn.appendChild(pill);
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = btn.getAttribute("aria-checked") !== "true";
    apply(next);
    btn.disabled = true;
    try {
      await onChange?.(next);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
