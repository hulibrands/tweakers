"use strict";

const ROOT_ATTR = "data-codexpp-shadcn-ui";
const ROOT_OWNER_ATTR = "data-codexpp-shadcn-ui-owner";
const ACTIVE_OWNERS_ATTR = "data-codexpp-shadcn-ui-active-owners";
const SHADGPT_OWNER_ID = "co.thomashulihan.shadcn-codex-ui";
const UPSTREAM_OWNER_ID = "co.Arconte112.shadcn-codex-ui";
const OWNER_ID = SHADGPT_OWNER_ID;
const OWNER_PRIORITY = 100;
const STYLE_ID = "codexpp-shadcn-codex-ui-style--shadgpt";
const LEGACY_STYLE_ID = "codexpp-shadcn-codex-ui-style";
const STORAGE_KEY = "settings";
const RUNTIME_OWNER_PRIORITIES = Object.freeze({
  [SHADGPT_OWNER_ID]: 100,
  [UPSTREAM_OWNER_ID]: 10,
});
const RUNTIME_STYLE_IDS = Object.freeze({
  [SHADGPT_OWNER_ID]: "codexpp-shadcn-codex-ui-style--shadgpt",
  [UPSTREAM_OWNER_ID]: "codexpp-shadcn-codex-ui-style--upstream",
});

const DEFAULT_SETTINGS = Object.freeze({
  themeMode: "light",
  flags: Object.freeze({
    core: true,
    sidebar: true,
    composer: true,
    messages: true,
    settings: true,
    dialogs: true,
  }),
  compatibility: Object.freeze({
    uiImprovementsSidebar: true,
  }),
});

const FLAG_DEFS = Object.freeze([
  {
    key: "core",
    label: "Core theme tokens",
    description: "Bridge shadcn semantic variables into the renderer root.",
  },
  {
    key: "sidebar",
    label: "Sidebar",
    description: "Apply neutral shadcn-style treatment to navigation without boxing project groups.",
  },
  {
    key: "composer",
    label: "Composer",
    description: "Style prompt inputs, toolbars, and composer controls with clearer light-mode contrast.",
  },
  {
    key: "messages",
    label: "Messages",
    description: "Use card-like spacing, readable foregrounds, and neutral borders for the message stream.",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Style this tweak page and ShadGPT settings surfaces with shadcn-like cards and controls.",
  },
  {
    key: "dialogs",
    label: "Dialogs",
    description: "Apply conservative dialog, menu, popover, and toast styling.",
  },
]);

const COMPATIBILITY_DEFS = Object.freeze([
  {
    key: "uiImprovementsSidebar",
    label: "UI Improvements sidebar",
    description:
      "Keep UI Improvements sidebar behavior, but restyle its injected rows, grids, labels, and menus with shadcn tokens.",
  },
]);

const SHADCN_COLOR_TINT = 700;
const SHADCN_PROJECT_COLOR_OPTIONS = Object.freeze([
  { id: "neutral", label: "Neutral", value: "#404040", oklch: "oklch(0.37 0.00 0)" },
  { id: "stone", label: "Stone", value: "#44403c", oklch: "oklch(0.37 0.01 68)" },
  { id: "zinc", label: "Zinc", value: "#3f3f46", oklch: "oklch(0.37 0.01 286)" },
  { id: "slate", label: "Slate", value: "#334155", oklch: "oklch(0.37 0.04 257)" },
  { id: "gray", label: "Gray", value: "#374151", oklch: "oklch(0.37 0.03 260)" },
  { id: "mauve", label: "Mauve", value: "#524959", oklch: "oklch(0.42 0.03 310)" },
  { id: "olive", label: "Olive", value: "#435147", oklch: "oklch(0.42 0.02 155)" },
  { id: "mist", label: "Mist", value: "#3d5155", oklch: "oklch(0.42 0.03 210)" },
  { id: "taupe", label: "Taupe", value: "#554b3e", oklch: "oklch(0.42 0.03 75)" },
  { id: "red", label: "Red", value: "#b91c1c", oklch: "oklch(0.51 0.19 28)" },
  { id: "orange", label: "Orange", value: "#c2410c", oklch: "oklch(0.55 0.17 38)" },
  { id: "amber", label: "Amber", value: "#b45309", oklch: "oklch(0.56 0.15 49)" },
  { id: "yellow", label: "Yellow", value: "#a16207", oklch: "oklch(0.55 0.12 66)" },
  { id: "lime", label: "Lime", value: "#4d7c0f", oklch: "oklch(0.53 0.14 132)" },
  { id: "green", label: "Green", value: "#15803d", oklch: "oklch(0.53 0.14 150)" },
  { id: "emerald", label: "Emerald", value: "#047857", oklch: "oklch(0.51 0.10 166)" },
  { id: "teal", label: "Teal", value: "#0f766e", oklch: "oklch(0.51 0.09 186)" },
  { id: "cyan", label: "Cyan", value: "#0e7490", oklch: "oklch(0.52 0.09 223)" },
  { id: "sky", label: "Sky", value: "#0369a1", oklch: "oklch(0.50 0.12 243)" },
  { id: "blue", label: "Blue", value: "#1d4ed8", oklch: "oklch(0.49 0.22 264)" },
  { id: "indigo", label: "Indigo", value: "#4338ca", oklch: "oklch(0.46 0.21 277)" },
  { id: "violet", label: "Violet", value: "#6d28d9", oklch: "oklch(0.49 0.24 293)" },
  { id: "purple", label: "Purple", value: "#7e22ce", oklch: "oklch(0.50 0.24 302)" },
  { id: "fuchsia", label: "Fuchsia", value: "#a21caf", oklch: "oklch(0.52 0.23 324)" },
  { id: "pink", label: "Pink", value: "#be185d", oklch: "oklch(0.52 0.20 4)" },
  { id: "rose", label: "Rose", value: "#be123c", oklch: "oklch(0.51 0.20 17)" },
]);

const PROJECT_COLOR_OPTIONS = Object.freeze([
  { id: "auto", label: "Auto", value: "var(--muted-foreground, oklch(0.556 0 0))", oklch: "Auto" },
  ...SHADCN_PROJECT_COLOR_OPTIONS,
]);

function shadcnColorVar(colorId) {
  return `var(--codexpp-shadcn-${colorId}-${SHADCN_COLOR_TINT})`;
}

function shadcnPaletteCssVars() {
  return SHADCN_PROJECT_COLOR_OPTIONS.map(
    (color) =>
      `--codexpp-shadcn-${color.id}-${SHADCN_COLOR_TINT}: ${color.value};\n` +
      `  --codexpp-shadcn-${color.id}-${SHADCN_COLOR_TINT}-oklch: ${color.oklch};`,
  ).join("\n  ");
}

const UI_IMPROVEMENTS_EVENT = "codexpp-ui-improvements-setting-changed";
const UI_IMPROVEMENTS_COLOR_EVENT = "codexpp-ui-improvements-project-color-changed";

const THEME_MODES = Object.freeze([
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]);

// Canonical ShadGPT design-token style guide. Names + display grouping only;
// the VALUES are parsed live from coreTokenCss() so the guide can never drift
// from the theme the app actually renders.
const THEME_TOKEN_GROUPS = Object.freeze([
  { label: "Base", tokens: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground"] },
  { label: "Brand", tokens: ["primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground", "muted", "muted-foreground"] },
  { label: "Functional", tokens: ["destructive", "border", "input", "ring"] },
  { label: "Charts", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] },
  { label: "Sidebar", tokens: ["sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring"] },
]);
const SHADCN_THEME_TOKEN_ORDER = Object.freeze(THEME_TOKEN_GROUPS.flatMap((group) => group.tokens));

const FONT_ASSET_MIME = "font/woff2";
const FONT_ASSET_MAX_BYTES = 1024 * 1024;
const FONT_SOURCE_PACKAGES = Object.freeze({
  geist: "@fontsource-variable/geist@5.2.9",
  geistMono: "@fontsource-variable/geist-mono@5.2.8",
});
const LATIN_EXT_RANGE = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const LATIN_RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const FONT_FACE_DEFS = Object.freeze([
  {
    family: "Geist",
    style: "normal",
    source: FONT_SOURCE_PACKAGES.geist,
    path: "assets/fonts/geist-latin-ext-wght-normal.woff2",
    unicodeRange: LATIN_EXT_RANGE,
  },
  {
    family: "Geist",
    style: "normal",
    source: FONT_SOURCE_PACKAGES.geist,
    path: "assets/fonts/geist-latin-wght-normal.woff2",
    unicodeRange: LATIN_RANGE,
  },
  {
    family: "Geist",
    style: "italic",
    source: FONT_SOURCE_PACKAGES.geist,
    path: "assets/fonts/geist-latin-ext-wght-italic.woff2",
    unicodeRange: LATIN_EXT_RANGE,
  },
  {
    family: "Geist",
    style: "italic",
    source: FONT_SOURCE_PACKAGES.geist,
    path: "assets/fonts/geist-latin-wght-italic.woff2",
    unicodeRange: LATIN_RANGE,
  },
  {
    family: "Geist Mono",
    style: "normal",
    source: FONT_SOURCE_PACKAGES.geistMono,
    path: "assets/fonts/geist-mono-latin-ext-wght-normal.woff2",
    unicodeRange: LATIN_EXT_RANGE,
  },
  {
    family: "Geist Mono",
    style: "normal",
    source: FONT_SOURCE_PACKAGES.geistMono,
    path: "assets/fonts/geist-mono-latin-wght-normal.woff2",
    unicodeRange: LATIN_RANGE,
  },
  {
    family: "Geist Mono",
    style: "italic",
    source: FONT_SOURCE_PACKAGES.geistMono,
    path: "assets/fonts/geist-mono-latin-ext-wght-italic.woff2",
    unicodeRange: LATIN_EXT_RANGE,
  },
  {
    family: "Geist Mono",
    style: "italic",
    source: FONT_SOURCE_PACKAGES.geistMono,
    path: "assets/fonts/geist-mono-latin-wght-italic.woff2",
    unicodeRange: LATIN_RANGE,
  },
]);

// Typeface specimens for the Design & Style "Typefaces" container. Available
// styles are derived live from FONT_FACE_DEFS (both families are variable, 100–900,
// normal + italic); these are the named weights/styles the UI actually uses.
const TYPEFACES = Object.freeze([
  { name: "Geist", cssVar: "var(--font-sans)", role: "UI / sans" },
  { name: "Geist Mono", cssVar: "var(--font-mono)", role: "Code / mono" },
]);
const TYPEFACE_STYLES = Object.freeze([
  { label: "Regular", weight: 400, style: "normal" },
  { label: "Medium", weight: 500, style: "normal" },
  { label: "Semibold", weight: 600, style: "normal" },
  { label: "Bold", weight: 700, style: "normal" },
  { label: "Italic", weight: 400, style: "italic" },
]);

/** @type {import("@shadgpt/sdk").Tweak} */
module.exports = {
  async start(api) {
    if (api.process === "main") return registerFontAssetHandler(api);

    const state = {
      api,
      settings: loadSettings(api),
      pageHandle: null,
      pageRoot: null,
      mediaQuery: null,
      mediaListener: null,
      styleOrderObserver: null,
      fontAssetUrls: Object.create(null),
      fontAssetMissing: [],
      fontDiagnostics: null,
      fontDiagnosticsTimers: new Set(),
      fontDiagnosticsActive: false,
      uiImprovementsListener: null,
      appearanceObserver: null,
      appearanceObserverRoots: new Set(),
      appearanceSyncTimer: null,
      appearanceSurfaceListener: null,
    };

    this._state = state;
    installSystemThemeListener(state);
    installUiImprovementsListener(state);
    installAppearanceOverride(state);
    await loadFontAssets(state);
    applyRuntime(state);
    scheduleFontDiagnostics(state);

    if (typeof api.settings?.registerPage === "function") {
      state.pageHandle = api.settings.registerPage({
        id: "main",
        title: "Style + Design",
        description: "Scoped shadcn-style tokens and surface treatments for ShadGPT.",
        iconSvg:
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
          '<rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/>' +
          '<path d="M6.5 7.25h7M6.5 10h7M6.5 12.75h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          "</svg>",
        render(root) {
          state.pageRoot = root;
          renderSettingsPage(root, state);
        },
      });
    } else {
      api.log.warn("registerPage unavailable; Shadcn Codex UI styles are active without a settings page.");
    }
  },

  stop() {
    const state = this._state;
    if (!state) return;

    removeSystemThemeListener(state);
    removeUiImprovementsListener(state);
    removeAppearanceOverride(state);
    cancelFontDiagnostics(state);
    disconnectRuntimeStyleObserver(state);
    state.pageHandle?.unregister();
    state.pageHandle = null;
    state.pageRoot = null;
    removeRuntime();
    this._state = null;
  },
};

function loadSettings(api) {
  const stored = safeStorageGet(api, STORAGE_KEY, null);
  return normalizeSettings(stored);
}

function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const flags = source.flags && typeof source.flags === "object" ? source.flags : {};
  const compatibility =
    source.compatibility && typeof source.compatibility === "object" ? source.compatibility : {};
  const themeMode = THEME_MODES.some((mode) => mode.value === source.themeMode)
    ? source.themeMode
    : DEFAULT_SETTINGS.themeMode;

  return {
    themeMode,
    flags: {
      core: typeof flags.core === "boolean" ? flags.core : DEFAULT_SETTINGS.flags.core,
      sidebar: typeof flags.sidebar === "boolean" ? flags.sidebar : DEFAULT_SETTINGS.flags.sidebar,
      composer: typeof flags.composer === "boolean" ? flags.composer : DEFAULT_SETTINGS.flags.composer,
      messages: typeof flags.messages === "boolean" ? flags.messages : DEFAULT_SETTINGS.flags.messages,
      settings: typeof flags.settings === "boolean" ? flags.settings : DEFAULT_SETTINGS.flags.settings,
      dialogs: typeof flags.dialogs === "boolean" ? flags.dialogs : DEFAULT_SETTINGS.flags.dialogs,
    },
    compatibility: {
      uiImprovementsSidebar:
        typeof compatibility.uiImprovementsSidebar === "boolean"
          ? compatibility.uiImprovementsSidebar
          : DEFAULT_SETTINGS.compatibility.uiImprovementsSidebar,
    },
  };
}

function safeStorageGet(api, key, fallback) {
  try {
    return api.storage?.get ? api.storage.get(key, fallback) : fallback;
  } catch (error) {
    api.log?.warn?.("Failed to read Shadcn Codex UI settings:", error);
    return fallback;
  }
}

function saveSettings(state) {
  try {
    state.api.storage?.set?.(STORAGE_KEY, state.settings);
  } catch (error) {
    state.api.log?.warn?.("Failed to persist Shadcn Codex UI settings:", error);
  }
}

function installSystemThemeListener(state) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

  state.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  state.mediaListener = () => {
    if (state.settings.themeMode === "system") applyRuntime(state);
  };

  if (typeof state.mediaQuery.addEventListener === "function") {
    state.mediaQuery.addEventListener("change", state.mediaListener);
  } else if (typeof state.mediaQuery.addListener === "function") {
    state.mediaQuery.addListener(state.mediaListener);
  }
}

function removeSystemThemeListener(state) {
  if (!state.mediaQuery || !state.mediaListener) return;

  if (typeof state.mediaQuery.removeEventListener === "function") {
    state.mediaQuery.removeEventListener("change", state.mediaListener);
  } else if (typeof state.mediaQuery.removeListener === "function") {
    state.mediaQuery.removeListener(state.mediaListener);
  }

  state.mediaQuery = null;
  state.mediaListener = null;
}

function installUiImprovementsListener(state) {
  if (typeof window === "undefined") return;
  state.uiImprovementsListener = () => {
    if (state.pageRoot) renderSettingsPage(state.pageRoot, state);
  };
  window.addEventListener(UI_IMPROVEMENTS_EVENT, state.uiImprovementsListener);
  window.addEventListener(UI_IMPROVEMENTS_COLOR_EVENT, state.uiImprovementsListener);
}

function removeUiImprovementsListener(state) {
  if (!state.uiImprovementsListener || typeof window === "undefined") return;
  window.removeEventListener(UI_IMPROVEMENTS_EVENT, state.uiImprovementsListener);
  window.removeEventListener(UI_IMPROVEMENTS_COLOR_EVENT, state.uiImprovementsListener);
  state.uiImprovementsListener = null;
}

function installAppearanceOverride(state) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  state.appearanceSurfaceListener = () => {
    syncAppearanceObserver(state);
    scheduleAppearanceOverride(state);
  };
  window.addEventListener("codexpp:settings-surface", state.appearanceSurfaceListener);

  if (typeof MutationObserver === "function") {
    state.appearanceObserver = new MutationObserver(() => scheduleAppearanceOverride(state));
    syncAppearanceObserver(state);
  }

  scheduleAppearanceOverride(state);
}

function removeAppearanceOverride(state) {
  if (typeof window !== "undefined" && state.appearanceSurfaceListener) {
    window.removeEventListener("codexpp:settings-surface", state.appearanceSurfaceListener);
  }
  state.appearanceSurfaceListener = null;
  state.appearanceObserver?.disconnect();
  state.appearanceObserver = null;
  state.appearanceObserverRoots?.clear?.();
  if (state.appearanceSyncTimer) clearTimeout(state.appearanceSyncTimer);
  state.appearanceSyncTimer = null;
  clearAppearanceOverride(OWNER_ID);
}

function clearAppearanceOverride(ownerId = null) {
  document.querySelectorAll("[data-codexpp-shadcn-native-appearance]").forEach((node) => {
    if (ownerId && node.getAttribute("data-codexpp-shadcn-native-appearance-owner") !== ownerId) return;
    node.removeAttribute("data-codexpp-shadcn-native-appearance");
    node.removeAttribute("data-codexpp-shadcn-theme-mode");
    node.removeAttribute("data-codexpp-shadcn-native-appearance-owner");
  });
  document.querySelectorAll("[data-codexpp-shadcn-appearance-hidden]").forEach((node) => {
    if (ownerId && node.getAttribute("data-codexpp-shadcn-appearance-hidden-owner") !== ownerId) return;
    node.hidden = false;
    node.removeAttribute("data-codexpp-shadcn-appearance-hidden");
    node.removeAttribute("data-codexpp-shadcn-appearance-hidden-owner");
  });
}

function scheduleAppearanceOverride(state) {
  if (state.appearanceSyncTimer) return;
  state.appearanceSyncTimer = setTimeout(() => {
    state.appearanceSyncTimer = null;
    syncAppearanceObserver(state);
    syncAppearanceOverride(state);
  }, 80);
}

function syncAppearanceOverride(state) {
  if (!state.settings.flags.settings || !isPreferredRuntimeOwner(OWNER_ID)) {
    clearAppearanceOverride(OWNER_ID);
    return;
  }
  const root = findNativeAppearanceRoot();
  if (!root) return;
  clearAppearanceOverride();
  root.setAttribute("data-codexpp-shadcn-native-appearance", "true");
  root.setAttribute("data-codexpp-shadcn-theme-mode", state.settings.themeMode);
  root.setAttribute("data-codexpp-shadcn-native-appearance-owner", OWNER_ID);
}

function syncAppearanceObserver(state) {
  if (!state.appearanceObserver) return;
  const roots = findAppearanceSearchRoots();
  const sameRoots =
    state.appearanceObserverRoots?.size === roots.length &&
    roots.every((root) => state.appearanceObserverRoots.has(root));
  if (sameRoots) return;

  state.appearanceObserver.disconnect();
  state.appearanceObserverRoots = new Set(roots);
  for (const root of roots) {
    state.appearanceObserver.observe(root, { childList: true, subtree: true });
  }
}

function findAppearanceSearchRoots() {
  const selectors = [
    "[data-codexpp-shadcn-native-appearance]",
    "[aria-label='Appearance settings']",
    "[role='dialog'].settings-dialog",
    ".settings-dialog",
    "[data-codexpp-settings-sidebar='true']",
    "[data-codexpp='native-nav-header']",
    "[data-codexpp='nav-group']",
    "[data-codexpp='pages-group']",
  ].join(",");
  return uniqueElements(Array.from(document.querySelectorAll(selectors)).map((node) => settingsSurfaceRoot(node)));
}

function settingsSurfaceRoot(node) {
  return (
    node.closest?.("[role='dialog'].settings-dialog") ||
    node.closest?.(".settings-dialog") ||
    node.closest?.("[data-radix-popper-content-wrapper]") ||
    node.closest?.("[role='dialog']") ||
    node
  );
}

function uniqueElements(nodes) {
  return Array.from(new Set(nodes.filter(Boolean)));
}

function findNativeAppearanceRoot() {
  const roots = findAppearanceSearchRoots();
  const headings = roots.flatMap((root) =>
    Array.from(root.querySelectorAll("h1,h2,h3,[role='heading'],button,[role='tab']"))
      .filter((node) => ownText(node) === "Appearance"),
  );

  for (const heading of headings) {
    const root = findAppearanceRootFromHeading(heading);
    if (root) return root;
  }

  return null;
}

function findAppearanceRootFromHeading(heading) {
  let current = heading.parentElement;
  for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
    if (current === document.body || current === document.documentElement) return null;
    if (!looksLikeNativeAppearancePanel(current)) continue;
    return current;
  }
  return null;
}

function looksLikeNativeAppearancePanel(node) {
  const text = compactText(node.textContent);
  return (
    text.includes("Appearance") &&
    text.includes("Theme") &&
    text.includes("Use light, dark, or match your system") &&
    text.includes("Light") &&
    text.includes("Dark") &&
    text.includes("System")
  );
}

function ownText(node) {
  return compactText(
    Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent || "")
      .join(" "),
  );
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function applyRuntime(state) {
  const root = document.documentElement;
  const css = buildCss(state.settings, state.fontAssetUrls);

  if (!css) {
    disconnectRuntimeStyleObserver(state);
    removeRuntime(state);
    return;
  }

  registerRuntimeOwner(OWNER_ID);
  removeLegacyRuntimeStyleIfOwned();
  const style = ensureRuntimeStyle(OWNER_ID);
  style.textContent = css;
  style.setAttribute("data-owner-priority", String(OWNER_PRIORITY));
  style.setAttribute("data-theme-mode", effectiveThemeMode(state));
  const activeOwner = preferredRuntimeOwner();
  const ownsRuntime = activeOwner === OWNER_ID;
  style.disabled = !ownsRuntime;

  if (ownsRuntime) {
    root.setAttribute(ROOT_ATTR, effectiveThemeMode(state));
    root.setAttribute(ROOT_OWNER_ATTR, OWNER_ID);
    disableInactiveRuntimeStyles(OWNER_ID);
    syncRuntimeStyleOrder(state);
    syncAppearanceOverride(state);
  } else {
    disconnectRuntimeStyleObserver(state);
  }
}

function removeRuntime(state = null) {
  unregisterRuntimeOwner(OWNER_ID);
  document.getElementById(STYLE_ID)?.remove();
  if (document.documentElement.getAttribute(ROOT_OWNER_ATTR) === OWNER_ID) {
    promotePreferredRuntimeOwner(state);
  }
  clearAppearanceOverride(OWNER_ID);
}

function syncRuntimeStyleOrder(state) {
  if (!shouldFloatRuntimeStyle(state.settings)) {
    disconnectRuntimeStyleObserver(state);
    return;
  }

  moveRuntimeStyleToEnd();
  setTimeout(moveRuntimeStyleToEnd, 0);
  setTimeout(moveRuntimeStyleToEnd, 250);

  if (state.styleOrderObserver || typeof MutationObserver !== "function") return;

  state.styleOrderObserver = new MutationObserver(() => {
    moveRuntimeStyleToEnd();
  });
  state.styleOrderObserver.observe(document.head, { childList: true });
}

function shouldFloatRuntimeStyle(settings) {
  return true;
}

function moveRuntimeStyleToEnd() {
  const style = document.getElementById(STYLE_ID);
  if (!style || style.parentElement !== document.head || style.disabled) return;
  if (document.head.lastElementChild === style) return;
  document.head.appendChild(style);
}

function disconnectRuntimeStyleObserver(state) {
  state.styleOrderObserver?.disconnect();
  state.styleOrderObserver = null;
}

function ensureRuntimeStyle(ownerId) {
  const styleId = RUNTIME_STYLE_IDS[ownerId];
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.setAttribute("data-owner", ownerId);
  style.setAttribute("data-codexpp-shadcn-runtime-style", "true");
  return style;
}

function removeLegacyRuntimeStyleIfOwned() {
  const legacy = document.getElementById(LEGACY_STYLE_ID);
  if (!legacy) return;
  const owner = legacy.getAttribute("data-owner");
  const ownerPriority = RUNTIME_OWNER_PRIORITIES[owner] || 0;
  if (!owner || owner === OWNER_ID || ownerPriority < OWNER_PRIORITY) legacy.remove();
}

function parseRuntimeOwners() {
  return new Set(
    String(document.documentElement.getAttribute(ACTIVE_OWNERS_ATTR) || "")
      .split(/\s+/)
      .map((owner) => owner.trim())
      .filter(Boolean),
  );
}

function writeRuntimeOwners(owners) {
  const value = Array.from(owners)
    .filter(Boolean)
    .sort((left, right) => (RUNTIME_OWNER_PRIORITIES[right] || 0) - (RUNTIME_OWNER_PRIORITIES[left] || 0))
    .join(" ");
  if (value) document.documentElement.setAttribute(ACTIVE_OWNERS_ATTR, value);
  else document.documentElement.removeAttribute(ACTIVE_OWNERS_ATTR);
}

function registerRuntimeOwner(ownerId) {
  const owners = parseRuntimeOwners();
  owners.add(ownerId);
  writeRuntimeOwners(owners);
}

function unregisterRuntimeOwner(ownerId) {
  const owners = parseRuntimeOwners();
  owners.delete(ownerId);
  writeRuntimeOwners(owners);
}

function preferredRuntimeOwner() {
  return Array.from(parseRuntimeOwners())
    .filter((ownerId) => !!document.getElementById(RUNTIME_STYLE_IDS[ownerId]))
    .sort((left, right) => (RUNTIME_OWNER_PRIORITIES[right] || 0) - (RUNTIME_OWNER_PRIORITIES[left] || 0))[0] || null;
}

function isPreferredRuntimeOwner(ownerId) {
  return preferredRuntimeOwner() === ownerId;
}

function disableInactiveRuntimeStyles(activeOwner) {
  for (const [ownerId, styleId] of Object.entries(RUNTIME_STYLE_IDS)) {
    const style = document.getElementById(styleId);
    if (!style) continue;
    style.disabled = ownerId !== activeOwner;
  }
}

function promotePreferredRuntimeOwner(state = null) {
  const ownerId = preferredRuntimeOwner();
  const root = document.documentElement;
  if (!ownerId) {
    root.removeAttribute(ROOT_ATTR);
    root.removeAttribute(ROOT_OWNER_ATTR);
    return;
  }
  const style = document.getElementById(RUNTIME_STYLE_IDS[ownerId]);
  const themeMode = style?.getAttribute("data-theme-mode") || (state ? effectiveThemeMode(state) : "light");
  root.setAttribute(ROOT_ATTR, themeMode);
  root.setAttribute(ROOT_OWNER_ATTR, ownerId);
  disableInactiveRuntimeStyles(ownerId);
}

function effectiveThemeMode(state) {
  if (state.settings.themeMode !== "system") return state.settings.themeMode;
  return state.mediaQuery?.matches ? "dark" : "light";
}

function buildCss(settings, fontAssetUrls = Object.create(null)) {
  const chunks = [fontFaceCss(fontAssetUrls), baseResetCss(), coreTokenCss(), shadcnThemeOverrideCss()].filter(Boolean);
  if (settings.flags.sidebar) chunks.push(sidebarCss());
  if (settings.compatibility.uiImprovementsSidebar) chunks.push(uiImprovementsCompatibilityCss());
  if (settings.flags.composer) chunks.push(composerCss());
  if (settings.flags.messages) chunks.push(messagesCss());
  if (settings.flags.settings) chunks.push(settingsCss());
  if (settings.flags.dialogs) chunks.push(dialogsCss());
  return chunks.join("\n\n");
}


function registerFontAssetHandler(api) {
  if (typeof api.ipc?.handle !== "function") return undefined;
  return api.ipc.handle("asset-url", (relPath) => readBundledAssetAsDataUrl(relPath));
}

function readBundledAssetAsDataUrl(relPath) {
  if (typeof require !== "function") throw new Error("asset loading requires the main runtime");
  const fs = require("node:fs");
  const path = require("node:path");
  const baseDir = typeof __dirname === "string" ? __dirname : process.cwd();
  const fullPath = path.resolve(baseDir, String(relPath || ""));
  const relative = path.relative(baseDir, fullPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("bad asset path");
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) throw new Error("asset is not a file");
  if (stat.size > FONT_ASSET_MAX_BYTES) {
    throw new Error(`asset too large (${stat.size} > ${FONT_ASSET_MAX_BYTES})`);
  }
  const ext = path.extname(fullPath).toLowerCase();
  const mime = ext === ".woff2" ? FONT_ASSET_MIME : "application/octet-stream";
  return `data:${mime};base64,${fs.readFileSync(fullPath).toString("base64")}`;
}

async function loadFontAssets(state) {
  const urls = Object.create(null);
  const missing = [];
  for (const def of FONT_FACE_DEFS) {
    try {
      urls[def.path] = await readTweakAssetUrl(state.api, def.path);
    } catch (error) {
      missing.push(def.path);
      state.api.log?.warn?.("Failed to load Shadcn font asset:", def.path, error);
    }
  }
  state.fontAssetUrls = urls;
  state.fontAssetMissing = missing;
}

async function readTweakAssetUrl(api, relPath) {
  if (typeof api.assets?.url === "function") return api.assets.url(relPath);
  return api.ipc.invoke("asset-url", relPath);
}

function fontFaceCss(fontAssetUrls) {
  return FONT_FACE_DEFS.map((def) => {
    const url = fontAssetUrls?.[def.path];
    if (!url) return "";
    return [
      `/* ${def.source} ${def.path} */`,
      "@font-face {",
      `  font-family: "${def.family}";`,
      `  font-style: ${def.style};`,
      "  font-display: swap;",
      "  font-weight: 100 900;",
      `  src: url("${url}") format("woff2");`,
      `  unicode-range: ${def.unicodeRange};`,
      "}",
    ].join("\n");
  }).filter(Boolean).join("\n");
}

function refreshFontDiagnostics(state, { log = false } = {}) {
  state.fontDiagnostics = collectFontDiagnostics(state);
  if (log) state.api.log?.info?.("font diagnostics", state.fontDiagnostics);
  if (state.pageRoot) renderFontDiagnosticsInto(state);
}

function scheduleFontDiagnostics(state) {
  state.fontDiagnosticsActive = true;
  refreshFontDiagnostics(state, { log: true });
  if (document.fonts?.ready) {
    document.fonts.ready
      .then(() => {
        if (state.fontDiagnosticsActive) refreshFontDiagnostics(state, { log: true });
      })
      .catch(() => {});
  }
  const timer = setTimeout(() => {
    state.fontDiagnosticsTimers.delete(timer);
    if (state.fontDiagnosticsActive) refreshFontDiagnostics(state);
  }, 500);
  state.fontDiagnosticsTimers.add(timer);
}

function cancelFontDiagnostics(state) {
  state.fontDiagnosticsActive = false;
  for (const timer of state.fontDiagnosticsTimers || []) clearTimeout(timer);
  state.fontDiagnosticsTimers?.clear?.();
}

function collectFontDiagnostics(state) {
  const bodyFont = typeof getComputedStyle === "function" ? getComputedStyle(document.body).fontFamily : "";
  const check = (family) => {
    try {
      return !!document.fonts?.check?.(`14px "${family}"`);
    } catch {
      return false;
    }
  };
  const loadedFamilies = typeof FontFaceSet !== "undefined" && document.fonts
    ? Array.from(document.fonts).map((font) => ({ family: font.family, status: font.status, weight: font.weight, style: font.style }))
    : [];
  return {
    bodyFont,
    geistReady: check("Geist"),
    geistMonoReady: check("Geist Mono"),
    loadedFamilies,
    assetCount: Object.keys(state.fontAssetUrls || {}).length,
    missingAssets: state.fontAssetMissing || [],
    stylePresent: !!document.getElementById(STYLE_ID),
  };
}

function baseResetCss() {
  return `
html[${ROOT_ATTR}] {
  color-scheme: light dark;
  --codexpp-shadcn-font-size-base: 14px;
  font-size: var(--codexpp-shadcn-font-size-base) !important;
}

html[${ROOT_ATTR}] :focus-visible {
  outline: 2px solid var(--ring, #18181b);
  outline-offset: 2px;
}
`.trim();
}

function coreTokenCss() {
  return `
html[${ROOT_ATTR}] {
  color-scheme: light;
  --font-sans: "Geist", "Geist Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
  --radius: 0.625rem;
  ${shadcnPaletteCssVars()}
  --background: oklch(1 0 0);
  --foreground: oklch(0 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0 0 0);
  --primary: oklch(0 0 0);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(1 0 0);
  --sidebar-foreground: oklch(0 0 0);
  --sidebar-primary: oklch(0 0 0);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
  --codexpp-shadcn-ui-accent: ${shadcnColorVar("blue")};
  --codexpp-shadcn-shadow: 0 1px 2px rgb(9 9 11 / 0.06);
}

html[${ROOT_ATTR}="dark"] {
  color-scheme: dark;
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
  --codexpp-shadcn-ui-accent: ${shadcnColorVar("blue")};
  --codexpp-shadcn-shadow: 0 1px 2px rgb(0 0 0 / 0.35);
}

html[${ROOT_ATTR}] body {
  background: var(--background, #ffffff);
  color: var(--foreground, #09090b);
  font-size: var(--codexpp-shadcn-font-size-base);
  font-family: var(--font-sans);
}

html[${ROOT_ATTR}] {
  --color-token-bg-primary: var(--background);
  --color-token-bg-secondary: var(--secondary);
  --color-token-bg-fog: var(--muted);
  --color-background-panel: var(--card);
  --color-token-text-primary: var(--foreground);
  --color-token-text-secondary: var(--muted-foreground);
  --color-token-text-tertiary: color-mix(in srgb, var(--muted-foreground) 82%, var(--foreground));
  --color-token-border: var(--border);
}
`.trim();
}

function shadcnThemeOverrideCss() {
  return `
html[${ROOT_ATTR}],
html[${ROOT_ATTR}] body,
html[${ROOT_ATTR}] #root,
html[${ROOT_ATTR}] [data-radix-portal],
html[${ROOT_ATTR}] [data-radix-popper-content-wrapper] {
  --color-token-main-surface-primary: var(--background);
  --color-token-main-surface-secondary: var(--card);
  --color-token-main-surface-tertiary: var(--muted);
  --color-token-main-surface-quaternary: var(--secondary);
  --color-token-sidebar-surface-primary: var(--card);
  --color-token-sidebar-surface-secondary: var(--muted);
  --color-token-sidebar-surface-tertiary: var(--secondary);
  --color-token-sidebar-surface-hover: var(--accent);
  --color-token-sidebar-surface-active: var(--secondary);
  --color-token-bg-primary: var(--background);
  --color-token-bg-secondary: var(--secondary);
  --color-token-bg-tertiary: var(--muted);
  --color-token-bg-elevated-secondary: var(--popover);
  --color-token-bg-elevated-tertiary: var(--secondary);
  --color-token-bg-fog: color-mix(in srgb, var(--background) 88%, transparent);
  --color-token-text-primary: var(--foreground);
  --color-token-text-secondary: var(--muted-foreground);
  --color-token-text-tertiary: color-mix(in srgb, var(--muted-foreground) 78%, var(--foreground));
  --color-token-text-quaternary: color-mix(in srgb, var(--muted-foreground) 58%, var(--background));
  --color-token-text-inverted: var(--primary-foreground);
  --color-token-text-link-foreground: var(--codexpp-shadcn-ui-accent, #1d4ed8);
  --color-token-border: var(--border);
  --color-token-border-default: var(--border);
  --color-token-border-light: color-mix(in srgb, var(--border) 58%, var(--background));
  --color-token-border-medium: var(--border);
  --color-token-border-heavy: color-mix(in srgb, var(--border) 84%, var(--foreground));
  --color-token-interactive-bg-primary-default: var(--primary);
  --color-token-interactive-bg-primary-hover: color-mix(in srgb, var(--primary) 88%, var(--background));
  --color-token-interactive-bg-primary-press: color-mix(in srgb, var(--primary) 78%, var(--background));
  --color-token-interactive-bg-secondary-default: var(--secondary);
  --color-token-interactive-bg-secondary-hover: var(--accent);
  --color-token-interactive-bg-secondary-press: color-mix(in srgb, var(--accent) 78%, var(--foreground));
  --color-token-interactive-bg-tertiary-hover: var(--accent);
  --color-token-interactive-bg-tertiary-press: var(--secondary);
  --color-token-interactive-fg-primary-default: var(--primary-foreground);
  --color-token-interactive-fg-secondary-default: var(--foreground);
  --color-background-panel: var(--card);
  --color-background-panel-secondary: var(--muted);
  --color-background-popover: var(--popover);
  --color-border-default: var(--border);
  --color-border-light: color-mix(in srgb, var(--border) 58%, var(--background));
  --color-border-medium: var(--border);
  --color-text-primary: var(--foreground);
  --color-text-secondary: var(--muted-foreground);
  --color-text-tertiary: color-mix(in srgb, var(--muted-foreground) 78%, var(--foreground));
  --main-surface-primary: var(--background);
  --main-surface-secondary: var(--card);
  --main-surface-tertiary: var(--muted);
  --sidebar-surface-primary: var(--card);
  --sidebar-surface-secondary: var(--muted);
  --sidebar-surface-hover: var(--accent);
  --text-primary: var(--foreground);
  --text-secondary: var(--muted-foreground);
  --text-tertiary: color-mix(in srgb, var(--muted-foreground) 78%, var(--foreground));
  --border-default: var(--border);
  --tw-ring-color: var(--ring);
  --tw-ring-offset-color: var(--background);
}

html[${ROOT_ATTR}] body,
html[${ROOT_ATTR}] [class*="bg-token-main-surface-primary"],
html[${ROOT_ATTR}] [class*="bg-token-bg-primary"],
html[${ROOT_ATTR}] [class*="bg-token-sidebar-surface-primary"] {
  background-color: var(--background, #ffffff) !important;
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [class*="bg-token-main-surface-secondary"],
html[${ROOT_ATTR}] [class*="bg-token-sidebar-surface-secondary"],
html[${ROOT_ATTR}] [class*="bg-token-bg-secondary"] {
  background-color: var(--card, #ffffff) !important;
  color: var(--card-foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [class*="bg-token-main-surface-tertiary"],
html[${ROOT_ATTR}] [class*="bg-token-sidebar-surface-tertiary"],
html[${ROOT_ATTR}] [class*="bg-token-bg-tertiary"],
html[${ROOT_ATTR}] [class*="bg-token-bg-fog"] {
  background-color: var(--muted, #f4f4f5) !important;
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [class*="text-token-text-primary"],
html[${ROOT_ATTR}] [class*="text-token-foreground"] {
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [class*="text-token-text-secondary"],
html[${ROOT_ATTR}] [class*="text-token-description-foreground"] {
  color: var(--muted-foreground, #52525b) !important;
}

html[${ROOT_ATTR}] [class*="border-token"],
html[${ROOT_ATTR}] [class*="divide-token"] > * + * {
  border-color: var(--border, #d4d4d8) !important;
}

html[${ROOT_ATTR}] ::selection {
  background: color-mix(in srgb, var(--codexpp-shadcn-ui-accent, #1d4ed8) 24%, transparent);
}

html[${ROOT_ATTR}] {
  /* Inherited by all descendants — no universal '*' selector (which forced a
     style recalc over every node on each streamed token) and no
     text-rendering: optimizeLegibility (expensive per-glyph kerning on a
     constantly-mutating chat DOM). Antialiasing preserves the macOS look. */
  -webkit-font-smoothing: antialiased;
}
`.trim();
}

function sidebarCss() {
  return `
html[${ROOT_ATTR}] aside,
html[${ROOT_ATTR}] nav[aria-label*="Sidebar" i],
html[${ROOT_ATTR}] [data-testid*="sidebar" i] {
  background: var(--card, #ffffff);
  color: var(--card-foreground, #09090b);
  border-color: var(--border, #d4d4d8);
}

html[${ROOT_ATTR}] aside a,
html[${ROOT_ATTR}] aside button,
html[${ROOT_ATTR}] [data-testid*="sidebar" i] a,
html[${ROOT_ATTR}] [data-testid*="sidebar" i] button {
  border-radius: calc(var(--radius, 0.5rem) - 2px);
  color: var(--foreground, #09090b);
}

html[${ROOT_ATTR}] aside a:hover,
html[${ROOT_ATTR}] aside button:hover,
html[${ROOT_ATTR}] [data-testid*="sidebar" i] a:hover,
html[${ROOT_ATTR}] [data-testid*="sidebar" i] button:hover {
  background: var(--accent, #f4f4f5);
  color: var(--accent-foreground, #18181b);
}
`.trim();
}

function uiImprovementsCompatibilityCss() {
  return `
html[${ROOT_ATTR}] {
  --codexpp-shadcn-sidebar-spacing: 0.5rem;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-action-grid="group"] {
  gap: var(--codexpp-shadcn-sidebar-spacing) !important;
  padding-inline: var(--codexpp-shadcn-sidebar-spacing) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-action-grid="button"] {
  align-items: flex-start !important;
  background: var(--card, #ffffff) !important;
  border: 1px solid var(--border, #d4d4d8) !important;
  border-radius: var(--radius, 0.5rem) !important;
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06)) !important;
  color: var(--foreground, #09090b) !important;
  font-family: var(--font-sans) !important;
  gap: 0.25rem !important;
  min-height: 3.25rem !important;
  padding: 0.75rem 0.875rem !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-action-grid="button"]:hover {
  background: var(--accent, #f4f4f5) !important;
  color: var(--accent-foreground, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-action-grid="button"]:focus-visible {
  outline: 2px solid var(--ring, #18181b) !important;
  outline-offset: 2px !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-action-grid="label"] {
  color: var(--foreground, #09090b) !important;
  font-size: 0.875rem !important;
  font-weight: 500 !important;
  letter-spacing: 0 !important;
  line-height: 1.25rem !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-action-grid="badge"] {
  background: var(--primary, #18181b) !important;
  border-radius: 9999px !important;
  color: var(--primary-foreground, #fafafa) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="project-list"] {
  gap: 0 !important;
  padding-inline: 0 !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="row"] {
  --codexpp-project-row-tint: var(--codexpp-project-tint, transparent);
  --codexpp-project-row-text-color: var(--codexpp-project-text-color, currentColor);
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: inherit !important;
  margin-inline: 0 !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="row"]:hover {
  background: transparent !important;
  color: inherit !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="row"][data-codexpp-sidebar-project-expanded="true"] {
  background: transparent !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="icon"] {
  color: color-mix(
    in srgb,
    var(--codexpp-project-text-color, var(--codexpp-project-tint, var(--foreground, #09090b))) 82%,
    black
  ) !important;
  fill: currentColor !important;
  stroke: currentColor !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="title"] {
  color: color-mix(
    in srgb,
    var(--codexpp-project-text-color, var(--codexpp-project-tint, var(--foreground, #09090b))) 82%,
    black
  ) !important;
  font-weight: 700 !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="project-expander"],
html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="project-expander"]:hover,
html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="project-expander"]:focus,
html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="project-expander"]:focus-visible {
  background: transparent !important;
  background-color: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  color: color-mix(
    in srgb,
    var(--codexpp-project-text-color, var(--codexpp-project-tint, var(--foreground, #09090b))) 82%,
    black
  ) !important;
  font-weight: 700 !important;
  -webkit-text-fill-color: color-mix(
    in srgb,
    var(--codexpp-project-text-color, var(--codexpp-project-tint, var(--foreground, #09090b))) 82%,
    black
  ) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="project-expander"] :where(*) {
  color: inherit !important;
  font-weight: inherit !important;
  -webkit-text-fill-color: inherit !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-backgrounds="unread"] {
  background: var(--codexpp-project-tint, var(--primary, #18181b)) !important;
  color: var(--codexpp-project-tint, var(--primary, #18181b)) !important;
  fill: var(--codexpp-project-tint, var(--primary, #18181b)) !important;
  stroke: var(--codexpp-project-tint, var(--primary, #18181b)) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-chat-selected="true"],
html[${ROOT_ATTR}] [data-codexpp-sidebar-chat-selected-target="true"] {
  background: var(--accent, #f4f4f5) !important;
  box-shadow: inset 0 0 0 1px var(--ring, #18181b) !important;
  color: var(--accent-foreground, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-pinned-chat-project-name-row="true"],
html[${ROOT_ATTR}] [data-codexpp-pinned-chat-project-name-content="true"] {
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-pinned-chat-project-name] {
  color: var(--muted-foreground, #52525b) !important;
  font-family: var(--font-sans) !important;
  font-size: 0.75rem !important;
  line-height: 1rem !important;
}

html[${ROOT_ATTR}] [data-codexpp-pinned-chat-project-name]::before {
  background: var(--primary, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-color-menu="root"] {
  background: var(--popover, #ffffff) !important;
  border: 1px solid var(--border, #d4d4d8) !important;
  border-radius: var(--radius, 0.5rem) !important;
  box-shadow: 0 12px 36px rgb(9 9 11 / 0.16) !important;
  color: var(--popover-foreground, #09090b) !important;
  padding: 0.25rem !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-color-menu="item"] {
  border-radius: calc(var(--radius, 0.5rem) - 2px) !important;
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-sidebar-project-color-menu="item"]:hover {
  background: var(--accent, #f4f4f5) !important;
  color: var(--accent-foreground, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-ui-improvement="usage-box"] {
  background: var(--card, #ffffff) !important;
  border: 1px solid var(--border, #d4d4d8) !important;
  border-radius: calc(var(--radius, 0.5rem) - 2px) !important;
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06)) !important;
  color: var(--foreground, #09090b) !important;
  font-family: var(--font-sans) !important;
}

html[${ROOT_ATTR}] [data-codexpp-ui-improvement="usage-box"]:hover {
  background: var(--accent, #f4f4f5) !important;
  color: var(--accent-foreground, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-message-metrics] {
  color: var(--muted-foreground, #52525b) !important;
  font-family: var(--font-sans) !important;
  font-size: 0.75rem !important;
  letter-spacing: 0 !important;
  line-height: 1rem !important;
}

html[${ROOT_ATTR}] .codexpp-settings-search-box {
  background: var(--card, #ffffff) !important;
  border: 1px solid var(--border, #d4d4d8) !important;
  border-radius: var(--radius, 0.5rem) !important;
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06)) !important;
}

html[${ROOT_ATTR}] .codexpp-settings-search-box input {
  color: var(--foreground, #09090b) !important;
  font-family: var(--font-sans) !important;
}

html[${ROOT_ATTR}] .codexpp-settings-search-result {
  border-radius: calc(var(--radius, 0.5rem) - 2px) !important;
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] .codexpp-settings-search-result:hover,
html[${ROOT_ATTR}] .codexpp-settings-search-result:focus-visible {
  background: var(--accent, #f4f4f5) !important;
  color: var(--accent-foreground, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] {
  background: var(--popover, #ffffff) !important;
  border: 1px solid var(--border, #d4d4d8) !important;
  border-radius: var(--radius, 0.5rem) !important;
  box-shadow: 0 12px 36px rgb(9 9 11 / 0.16) !important;
  color: var(--popover-foreground, #09090b) !important;
  font-family: var(--font-sans) !important;
}

html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] [role="option"],
html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] [role="menuitem"],
html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] button {
  border-radius: calc(var(--radius, 0.5rem) - 2px) !important;
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] [role="option"]:hover,
html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] [role="menuitem"]:hover,
html[${ROOT_ATTR}] [data-codexpp-slash-menu="true"] button:hover {
  background: var(--accent, #f4f4f5) !important;
  color: var(--accent-foreground, #18181b) !important;
}
`.trim();
}

function composerCss() {
  return `
html[${ROOT_ATTR}] textarea,
html[${ROOT_ATTR}] [contenteditable="true"],
html[${ROOT_ATTR}] form textarea,
html[${ROOT_ATTR}] [data-testid*="composer" i],
html[${ROOT_ATTR}] [aria-label*="prompt" i] {
  color: var(--foreground, #09090b);
  caret-color: var(--foreground, #09090b);
}

html[${ROOT_ATTR}] textarea,
html[${ROOT_ATTR}] [contenteditable="true"] {
  background: var(--background, #ffffff);
  border-color: var(--input, #d4d4d8);
}

html[${ROOT_ATTR}] [data-testid*="composer" i] {
  background: var(--card, #ffffff);
  border-color: var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06));
}

html[${ROOT_ATTR}] [data-testid*="composer" i] button,
html[${ROOT_ATTR}] form button {
  border-radius: calc(var(--radius, 0.5rem) - 2px);
}
`.trim();
}

function messagesCss() {
  return `
html[${ROOT_ATTR}] [data-message-author-role],
html[${ROOT_ATTR}] [data-testid*="message" i],
html[${ROOT_ATTR}] article {
  color: var(--foreground, #09090b);
}

html[${ROOT_ATTR}] [data-message-author-role="assistant"],
html[${ROOT_ATTR}] [data-testid*="assistant" i] {
  background: var(--card, #ffffff);
  border-color: var(--border, #d4d4d8);
}

html[${ROOT_ATTR}] pre,
html[${ROOT_ATTR}] code {
  border-color: var(--border, #d4d4d8);
}

html[${ROOT_ATTR}] pre {
  background: var(--muted, #f4f4f5);
  color: var(--foreground, #09090b);
  border-radius: var(--radius, 0.5rem);
}
`.trim();
}

function settingsCss() {
  return `
html[${ROOT_ATTR}] [data-codexpp-settings-sidebar="true"] {
  background: var(--card, #ffffff) !important;
  border-color: var(--border, #d4d4d8) !important;
  color: var(--foreground, #09090b) !important;
  min-height: 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
  scrollbar-gutter: stable !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-sidebar="true"].window-fx-sidebar-surface,
html[${ROOT_ATTR}] .window-fx-sidebar-surface[data-codexpp-settings-sidebar="true"] {
  flex: 0 0 min(320px, calc(100vw - 32px)) !important;
  max-width: min(320px, calc(100vw - 32px)) !important;
  width: min(320px, calc(100vw - 32px)) !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-sidebar="true"] [data-codexpp="native-nav-header"],
html[${ROOT_ATTR}] [data-codexpp-settings-sidebar="true"] [data-codexpp="nav-group"],
html[${ROOT_ATTR}] [data-codexpp-settings-sidebar="true"] [data-codexpp="pages-group"] {
  min-width: 0 !important;
}

html[${ROOT_ATTR}] .codexpp-shadcn-page {
  color: var(--foreground, #09090b);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-card {
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06));
  overflow: hidden;
}

html[${ROOT_ATTR}] [data-codexpp-config-card],
html[${ROOT_ATTR}] [data-codexpp-repair-card] {
  background: var(--card, #ffffff) !important;
  border-color: var(--border, #d4d4d8) !important;
  border-radius: var(--radius, 0.5rem) !important;
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06)) !important;
  color: var(--card-foreground, #09090b) !important;
  overflow: hidden !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-row] {
  align-items: flex-start !important;
  min-width: 0 !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-row] > :first-child {
  flex: 1 1 auto !important;
  min-width: 0 !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-row] [data-codexpp-row-actions] {
  align-items: center !important;
  display: flex !important;
  flex: 0 1 auto !important;
  flex-wrap: wrap !important;
  gap: 0.5rem !important;
  justify-content: flex-end !important;
  max-width: min(100%, 22rem) !important;
  min-width: 0 !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-row] button:not([role="switch"]),
html[${ROOT_ATTR}] [data-codexpp-settings-row] select {
  background: var(--background, #ffffff) !important;
  border-color: var(--border, #d4d4d8) !important;
  color: var(--foreground, #09090b) !important;
  min-width: 0 !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-row] button:not([role="switch"]):hover,
html[${ROOT_ATTR}] [data-codexpp-settings-row] select:hover {
  background: var(--accent, #f4f4f5) !important;
  color: var(--accent-foreground, #18181b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-settings-row] [role="switch"][aria-checked="true"] span:first-child {
  background: var(--primary, #18181b) !important;
}

html[${ROOT_ATTR}] .codexpp-shadcn-section-heading {
  color: var(--foreground, #09090b);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-section-copy,
html[${ROOT_ATTR}] .codexpp-shadcn-description {
  color: var(--muted-foreground, #52525b);
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  width: 100%;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-swatches {
  display: flex;
  flex: 0 0 auto;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-swatch {
  border: 1px solid var(--border, #d4d4d8);
  height: 22px;
  width: 15px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-swatch:first-child {
  border-radius: 4px 0 0 4px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-swatch:last-child {
  border-left: 0;
  border-radius: 0 4px 4px 0;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-name {
  color: var(--foreground, #09090b);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-value {
  color: var(--muted-foreground, #52525b);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

html[${ROOT_ATTR}] .codexpp-shadcn-token-typo {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

html[${ROOT_ATTR}] .codexpp-shadcn-theme-code {
  background: var(--muted, #f4f4f5);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  color: var(--foreground, #09090b);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 17px;
  padding: 10px 12px;
  resize: vertical;
  width: 100%;
}

html[${ROOT_ATTR}] .codexpp-shadcn-theme-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-theme-actions button {
  background: var(--background, #ffffff);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  color: var(--foreground, #09090b);
  cursor: pointer;
  font-size: 13px;
  padding: 6px 12px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-theme-actions button:hover {
  background: var(--accent, #f4f4f5);
  color: var(--accent-foreground, #18181b);
}

html[${ROOT_ATTR}] .codexpp-shadcn-typeface {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

html[${ROOT_ATTR}] .codexpp-shadcn-typeface-name {
  color: var(--foreground, #09090b);
  font-size: 34px;
  font-weight: 600;
  line-height: 1.15;
}

html[${ROOT_ATTR}] .codexpp-shadcn-typeface-styles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-typeface-style {
  color: var(--foreground, #09090b);
  font-size: 17px;
  line-height: 1.35;
}

html[${ROOT_ATTR}] .codexpp-shadcn-row {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 12px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-row--stack {
  align-items: stretch;
  flex-direction: column;
}

html[${ROOT_ATTR}] .codexpp-shadcn-row + .codexpp-shadcn-row {
  border-top: 1px solid var(--border, #d4d4d8);
}

html[${ROOT_ATTR}] .codexpp-shadcn-label {
  color: var(--foreground, #09090b);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-segmented {
  background: var(--muted, #f4f4f5);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  display: inline-flex;
  gap: 2px;
  padding: 3px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-segmented button {
  background: transparent;
  border: 0;
  border-radius: calc(var(--radius, 0.5rem) - 3px);
  color: var(--muted-foreground, #52525b);
  cursor: pointer;
  font: inherit;
  min-height: 28px;
  padding: 4px 10px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-segmented button[aria-pressed="true"] {
  background: var(--background, #ffffff);
  color: var(--foreground, #09090b);
  box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06));
}

html[${ROOT_ATTR}] .codexpp-shadcn-switch {
  align-items: center;
  background: var(--input, #d4d4d8);
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  height: 24px;
  padding: 2px;
  position: relative;
  transition: background 140ms ease;
  width: 44px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-switch[aria-checked="true"] {
  background: var(--primary, #18181b);
}

html[${ROOT_ATTR}] .codexpp-shadcn-switch span {
  background: var(--background, #ffffff);
  border-radius: 999px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  display: block;
  height: 18px;
  transform: translateX(0);
  transition: transform 140ms ease;
  width: 18px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-switch[aria-checked="true"] span {
  transform: translateX(18px);
}

html[${ROOT_ATTR}] .codexpp-shadcn-note {
  background: var(--muted, #f4f4f5);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  color: var(--muted-foreground, #52525b);
  font-size: 12px;
  line-height: 17px;
  padding: 10px 12px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-diagnostics {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: calc(var(--radius, 0.5rem) - 2px);
  border: 1px solid var(--border, #d4d4d8);
  background: var(--secondary, #f4f4f5);
  color: var(--secondary-foreground, #18181b);
  font-size: 12px;
  font-weight: 600;
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-badge[data-status="ok"] {
  border-color: color-mix(in oklab, var(--codexpp-shadcn-green-700, #15803d) 36%, var(--border));
  color: var(--codexpp-shadcn-green-700, #15803d);
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-badge[data-status="missing"] {
  border-color: color-mix(in oklab, var(--destructive, #dc2626) 36%, var(--border));
  color: var(--destructive, #dc2626);
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-details {
  color: var(--muted-foreground, #71717a);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: anywhere;
}

html[${ROOT_ATTR}] .codexpp-shadcn-font-actions {
  display: flex;
  justify-content: flex-start;
}

html[${ROOT_ATTR}] .codexpp-shadcn-palette {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  padding: 12px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-palette-item {
  align-items: center;
  background: var(--background, #ffffff);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: var(--radius, 0.5rem);
  color: var(--foreground, #09090b);
  display: flex;
  gap: 8px;
  min-width: 0;
  padding: 8px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-palette-color {
  background: var(--codexpp-shadcn-swatch, var(--muted-foreground, #52525b));
  border-radius: calc(var(--radius, 0.5rem) - 3px);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.42);
  flex: 0 0 auto;
  height: 28px;
  width: 28px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-palette-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

html[${ROOT_ATTR}] .codexpp-shadcn-palette-name {
  color: var(--foreground, #09090b);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-palette-value {
  color: var(--muted-foreground, #52525b);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 14px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-swatch {
  align-items: center;
  background: var(--background, #ffffff);
  border: 1px solid var(--border, #d4d4d8);
  border-radius: calc(var(--radius, 0.5rem) - 2px);
  color: var(--foreground, #09090b);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 12px;
  gap: 6px;
  line-height: 16px;
  min-height: 30px;
  padding: 5px 8px;
}

html[${ROOT_ATTR}] .codexpp-shadcn-swatch[aria-pressed="true"] {
  border-color: var(--ring, #18181b);
  box-shadow: 0 0 0 1px var(--ring, #18181b);
}

html[${ROOT_ATTR}] .codexpp-shadcn-swatch-dot {
  background: var(--codexpp-shadcn-swatch, var(--muted-foreground, #52525b));
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.5);
  display: inline-block;
  height: 12px;
  width: 12px;
}

html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] input,
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] textarea,
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] select,
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] button {
  border-radius: calc(var(--radius, 0.5rem) - 2px) !important;
  font-family: var(--font-sans) !important;
}

html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] input,
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] textarea,
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] select {
  background: var(--background, #ffffff) !important;
  border: 1px solid var(--input, #d4d4d8) !important;
  color: var(--foreground, #09090b) !important;
}

html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] button[aria-pressed="true"],
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] button[aria-selected="true"],
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] [role="radio"][aria-checked="true"],
html[${ROOT_ATTR}] [data-codexpp-shadcn-native-appearance="true"] [role="switch"][aria-checked="true"] {
  background: var(--primary, #18181b) !important;
  color: var(--primary-foreground, #fafafa) !important;
}

@media (max-width: 720px) {
  html[${ROOT_ATTR}] [data-codexpp-settings-row] {
    align-items: stretch !important;
    flex-direction: column !important;
  }

  html[${ROOT_ATTR}] [data-codexpp-settings-row] [data-codexpp-row-actions] {
    justify-content: flex-start !important;
    max-width: 100% !important;
    width: 100% !important;
  }

  html[${ROOT_ATTR}] [data-codexpp-settings-row] button:not([role="switch"]),
  html[${ROOT_ATTR}] [data-codexpp-settings-row] select {
    max-width: 100% !important;
  }

  html[${ROOT_ATTR}] .codexpp-shadcn-row {
    align-items: stretch;
    flex-direction: column;
  }
}
`.trim();
}

function dialogsCss() {
  return `
html[${ROOT_ATTR}] [role="dialog"],
html[${ROOT_ATTR}] [role="alertdialog"],
html[${ROOT_ATTR}] [role="menu"],
html[${ROOT_ATTR}] [role="listbox"],
html[${ROOT_ATTR}] [data-radix-popper-content-wrapper] > * {
  background: var(--popover, #ffffff);
  border-color: var(--border, #d4d4d8);
  color: var(--popover-foreground, #09090b);
  border-radius: var(--radius, 0.5rem);
  box-shadow: 0 12px 36px rgb(9 9 11 / 0.16);
}

html[${ROOT_ATTR}] [role="menuitem"]:hover,
html[${ROOT_ATTR}] [role="option"]:hover {
  background: var(--accent, #f4f4f5);
  color: var(--accent-foreground, #18181b);
}
`.trim();
}

function renderSettingsPage(root, state) {
  root.innerHTML = "";
  root.className = "codexpp-shadcn-page";

  root.appendChild(sectionHeader("Theme", "Choose how the semantic token bridge resolves light and dark values."));

  const themeCard = card();
  const themeRow = rowShell("Theme mode", "Light is the primary visual target for this preview.");
  themeRow.appendChild(renderThemeControl(state));
  themeCard.appendChild(themeRow);
  root.appendChild(themeCard);

  root.appendChild(
    sectionHeader(
      "Design & Style",
      "The ShadGPT default theme — shadcn neutral tokens, typography, and radius. This is the canonical style guide; the values are read live from the active theme.",
    ),
  );
  root.appendChild(renderDesignStyleCard(state));

  root.appendChild(
    sectionHeader("Typefaces", "The fonts in use — each name and the styles applied, set in their own typeface."),
  );
  root.appendChild(renderFontSpecimenCard(state));

  root.appendChild(sectionHeader("Fonts", "Confirm that Shadcn typography is loading from bundled Geist assets."));
  root.appendChild(renderFontDiagnosticsCard(state));

  root.appendChild(sectionHeader("Surfaces", "Turn on each scoped stylesheet slice independently."));

  const flagsCard = card();
  for (const flag of FLAG_DEFS) {
    const item = rowShell(flag.label, flag.description);
    item.appendChild(renderSwitch(state, flag.key));
    flagsCard.appendChild(item);
  }
  root.appendChild(flagsCard);

  root.appendChild(sectionHeader("Compatibility", "Keep other sidebar tweaks functional while matching shadcn visual defaults."));

  const compatibilityCard = card();
  for (const itemDef of COMPATIBILITY_DEFS) {
    const item = rowShell(itemDef.label, itemDef.description);
    item.appendChild(renderCompatibilitySwitch(state, itemDef.key));
    compatibilityCard.appendChild(item);
  }
  root.appendChild(compatibilityCard);

  root.appendChild(sectionHeader("Project Colors", "Choose Shadcn-friendly project row accents for the sidebar."));
  root.appendChild(renderProjectColorCard(state));

  const note = document.createElement("div");
  note.className = "codexpp-shadcn-note";
  note.textContent =
    "This tweak uses one root marker and one injected stylesheet. Compatibility mode preserves other tweaks' behavior while restyling their surfaces with shadcn tokens; it does not replace upstream Codex DOM nodes.";
  root.appendChild(note);
}

function renderFontDiagnosticsCard(state) {
  const fontCard = card();
  const row = rowShell("Font diagnostics", "Shows whether this live ShadGPT window can use the bundled Geist faces.");
  row.classList.add("codexpp-shadcn-row--stack");
  row.setAttribute("data-codexpp-shadcn-font-diagnostics", "true");
  fontCard.appendChild(row);
  renderFontDiagnosticsInto(state, row);
  return fontCard;
}

function renderFontDiagnosticsInto(state, target) {
  const row = target || state.pageRoot?.querySelector?.("[data-codexpp-shadcn-font-diagnostics]");
  if (!row) return;
  row.querySelector("[data-codexpp-shadcn-font-diagnostics-body]")?.remove();
  const diagnostics = state.fontDiagnostics || collectFontDiagnostics(state);
  const body = document.createElement("div");
  const badges = document.createElement("div");
  const details = document.createElement("div");
  const actions = document.createElement("div");
  const refresh = document.createElement("button");

  body.setAttribute("data-codexpp-shadcn-font-diagnostics-body", "true");
  body.className = "codexpp-shadcn-font-diagnostics";
  badges.className = "codexpp-shadcn-font-badges";
  details.className = "codexpp-shadcn-font-details";
  actions.className = "codexpp-shadcn-font-actions";
  badges.append(
    statusBadge("Geist Sans", diagnostics.geistReady),
    statusBadge("Geist Mono", diagnostics.geistMonoReady),
    statusBadge(`Assets ${diagnostics.assetCount}/${FONT_FACE_DEFS.length}`, diagnostics.assetCount === FONT_FACE_DEFS.length),
  );
  details.textContent = diagnostics.missingAssets.length
    ? `Missing font assets: ${diagnostics.missingAssets.join(", ")}`
    : `Body stack: ${diagnostics.bodyFont || "unavailable"}`;
  refresh.type = "button";
  refresh.textContent = "Refresh";
  refresh.addEventListener("click", () => refreshFontDiagnostics(state, { log: true }));
  actions.appendChild(refresh);
  body.append(badges, details, actions);
  row.appendChild(body);
}

function statusBadge(label, ok) {
  const badge = document.createElement("span");
  badge.className = "codexpp-shadcn-font-badge";
  badge.setAttribute("data-status", ok ? "ok" : "missing");
  badge.textContent = ok ? `${label}: loaded` : `${label}: missing`;
  return badge;
}

function extractBlockVars(css, opener) {
  const vars = Object.create(null);
  const start = css.indexOf(opener);
  if (start < 0) return vars;
  const bodyStart = start + opener.length;
  const end = css.indexOf("\n}", bodyStart);
  const body = css.slice(bodyStart, end < 0 ? css.length : end);
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

// Single source of truth: read the live theme values straight out of the CSS the
// app injects, so the style guide and exported shadcn theme always match.
function themePalette() {
  const css = coreTokenCss();
  const light = extractBlockVars(css, `html[${ROOT_ATTR}] {`);
  const dark = extractBlockVars(css, `html[${ROOT_ATTR}="dark"] {`);
  return {
    radius: light.radius || "0.625rem",
    fontSans: light["font-sans"] || "",
    fontMono: light["font-mono"] || "",
    light,
    dark,
  };
}

// Emit the ShadGPT default theme as standard shadcn CSS variables (:root / .dark),
// ready to copy into a shadcn project's globals.css.
function shadcnThemeCss() {
  const palette = themePalette();
  const emit = (map) =>
    SHADCN_THEME_TOKEN_ORDER
      .filter((token) => map[token])
      .map((token) => `  --${token}: ${map[token]};`)
      .join("\n");
  return [
    ":root {",
    `  --radius: ${palette.radius};`,
    emit(palette.light),
    "}",
    "",
    ".dark {",
    emit(palette.dark),
    "}",
    "",
  ].join("\n");
}

function renderDesignStyleCard(state) {
  void state;
  const palette = themePalette();
  const wrap = card();

  for (const group of THEME_TOKEN_GROUPS) {
    const row = rowShell(group.label, `${group.tokens.length} tokens`);
    row.classList.add("codexpp-shadcn-row--stack");
    const grid = document.createElement("div");
    grid.className = "codexpp-shadcn-token-grid";
    for (const token of group.tokens) {
      const lightVal = palette.light[token] || "";
      const darkVal = palette.dark[token] || lightVal;
      const item = document.createElement("div");
      const swatches = document.createElement("div");
      const lightSw = document.createElement("span");
      const darkSw = document.createElement("span");
      const meta = document.createElement("div");
      const name = document.createElement("span");
      const value = document.createElement("span");

      item.className = "codexpp-shadcn-token";
      swatches.className = "codexpp-shadcn-token-swatches";
      lightSw.className = "codexpp-shadcn-token-swatch";
      lightSw.style.background = lightVal;
      lightSw.title = `light: ${lightVal}`;
      darkSw.className = "codexpp-shadcn-token-swatch";
      darkSw.style.background = darkVal;
      darkSw.title = `dark: ${darkVal}`;
      swatches.append(lightSw, darkSw);
      meta.className = "codexpp-shadcn-token-meta";
      name.className = "codexpp-shadcn-token-name";
      name.textContent = `--${token}`;
      value.className = "codexpp-shadcn-token-value";
      value.textContent = lightVal;
      meta.append(name, value);
      item.append(swatches, meta);
      grid.appendChild(item);
    }
    row.appendChild(grid);
    wrap.appendChild(row);
  }

  const typoRow = rowShell("Typography & radius", `Geist + Geist Mono · radius ${palette.radius}`);
  typoRow.classList.add("codexpp-shadcn-row--stack");
  const typo = document.createElement("div");
  typo.className = "codexpp-shadcn-token-typo";
  const sans = document.createElement("div");
  sans.style.fontFamily = palette.fontSans || "var(--font-sans)";
  sans.textContent = "Sans · Geist — The quick brown fox 0123456789";
  const mono = document.createElement("div");
  mono.style.fontFamily = palette.fontMono || "var(--font-mono)";
  mono.textContent = "Mono · Geist Mono — const theme = 0123456789;";
  typo.append(sans, mono);
  typoRow.appendChild(typo);
  wrap.appendChild(typoRow);

  const themeRow = rowShell(
    "shadcn theme",
    "The ShadGPT default theme as shadcn CSS variables. Copy it to reuse, or paste into a shadcn project's globals.css.",
  );
  themeRow.classList.add("codexpp-shadcn-row--stack");
  const css = shadcnThemeCss();
  const field = document.createElement("textarea");
  field.className = "codexpp-shadcn-theme-code";
  field.readOnly = true;
  field.rows = 14;
  field.spellcheck = false;
  field.value = css;
  field.addEventListener("focus", () => field.select());
  const actions = document.createElement("div");
  actions.className = "codexpp-shadcn-theme-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy theme";
  copy.addEventListener("click", () => {
    field.focus();
    field.select();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(css).catch(() => {});
    } else {
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard unavailable */
      }
    }
    copy.textContent = "Copied";
    setTimeout(() => {
      copy.textContent = "Copy theme";
    }, 1500);
  });
  actions.appendChild(copy);
  themeRow.append(field, actions);
  wrap.appendChild(themeRow);

  return wrap;
}

function renderFontSpecimenCard(state) {
  void state;
  const wrap = card();
  for (const face of TYPEFACES) {
    const styles = [...new Set(FONT_FACE_DEFS.filter((def) => def.family === face.name).map((def) => def.style))];
    const hasItalic = styles.includes("italic");
    const row = rowShell(face.name, `${face.role} · variable 100–900 · ${styles.join(" + ")}`);
    row.classList.add("codexpp-shadcn-row--stack");

    const block = document.createElement("div");
    block.className = "codexpp-shadcn-typeface";

    const title = document.createElement("div");
    title.className = "codexpp-shadcn-typeface-name";
    title.style.fontFamily = face.cssVar;
    title.textContent = face.name;
    block.appendChild(title);

    const specimens = document.createElement("div");
    specimens.className = "codexpp-shadcn-typeface-styles";
    for (const styleDef of TYPEFACE_STYLES) {
      if (styleDef.style === "italic" && !hasItalic) continue;
      const sample = document.createElement("div");
      sample.className = "codexpp-shadcn-typeface-style";
      sample.style.fontFamily = face.cssVar;
      sample.style.fontWeight = String(styleDef.weight);
      sample.style.fontStyle = styleDef.style;
      sample.textContent = `${styleDef.label} ${styleDef.weight}${styleDef.style === "italic" ? " Italic" : ""} — The quick brown fox 0123`;
      specimens.appendChild(sample);
    }
    block.appendChild(specimens);
    row.appendChild(block);
    wrap.appendChild(row);
  }
  return wrap;
}

function sectionHeader(title, description) {
  const wrap = document.createElement("div");
  const heading = document.createElement("div");
  const copy = document.createElement("div");

  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "4px";
  heading.className = "codexpp-shadcn-section-heading";
  heading.textContent = title;
  copy.className = "codexpp-shadcn-section-copy";
  copy.style.fontSize = "13px";
  copy.style.lineHeight = "18px";
  copy.textContent = description;

  wrap.append(heading, copy);
  return wrap;
}

function card() {
  const el = document.createElement("div");
  el.className = "codexpp-shadcn-card";
  return el;
}

function rowShell(labelText, descriptionText) {
  const row = document.createElement("div");
  const left = document.createElement("div");
  const label = document.createElement("div");
  const description = document.createElement("div");

  row.className = "codexpp-shadcn-row";
  left.style.minWidth = "0";
  left.style.display = "flex";
  left.style.flexDirection = "column";
  left.style.gap = "3px";

  label.className = "codexpp-shadcn-label";
  label.textContent = labelText;
  description.className = "codexpp-shadcn-description";
  description.style.fontSize = "12px";
  description.style.lineHeight = "17px";
  description.textContent = descriptionText;

  left.append(label, description);
  row.appendChild(left);
  return row;
}

function renderThemeControl(state) {
  const control = document.createElement("div");
  control.className = "codexpp-shadcn-segmented";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", "Theme mode");

  for (const mode of THEME_MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = mode.label;
    button.setAttribute("aria-pressed", String(state.settings.themeMode === mode.value));
    button.addEventListener("click", () => {
      state.settings = normalizeSettings({ ...state.settings, themeMode: mode.value });
      saveSettings(state);
      applyRuntime(state);
      if (state.pageRoot) renderSettingsPage(state.pageRoot, state);
    });
    control.appendChild(button);
  }

  return control;
}

function renderSwitch(state, key) {
  const button = document.createElement("button");
  const knob = document.createElement("span");

  button.type = "button";
  button.className = "codexpp-shadcn-switch";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-label", FLAG_DEFS.find((flag) => flag.key === key)?.label || key);
  button.setAttribute("aria-checked", String(!!state.settings.flags[key]));
  button.appendChild(knob);

  button.addEventListener("click", () => {
    state.settings = normalizeSettings({
      ...state.settings,
      flags: {
        ...state.settings.flags,
        [key]: !state.settings.flags[key],
      },
    });
    saveSettings(state);
    applyRuntime(state);
    if (state.pageRoot) renderSettingsPage(state.pageRoot, state);
  });

  return button;
}

function renderProjectColorCard(state) {
  const bridge = uiImprovementsBridge();
  const colorPrefs = bridge?.getProjectColors?.() || {};
  const projects = bridge?.getProjectRows?.() || [];
  const colorCard = card();
  colorCard.appendChild(renderProjectColorPalette());

  if (!bridge?.setProjectColor) {
    const row = rowShell("Project colors unavailable", "Enable UI Improvements to manage project color choices here.");
    row.classList.add("codexpp-shadcn-row--stack");
    colorCard.appendChild(row);
    return colorCard;
  }

  if (!projects.length) {
    const row = rowShell("No project rows detected", "Open the main sidebar with project rows visible, then return here.");
    row.classList.add("codexpp-shadcn-row--stack");
    colorCard.appendChild(row);
    return colorCard;
  }

  for (const project of projects) {
    const key = normalizeProjectKey(project.key || project.label);
    const row = rowShell(project.label || project.key, project.projectId || "Sidebar project");
    row.appendChild(renderProjectColorControl(state, bridge, key, colorPrefs[key] || "auto"));
    colorCard.appendChild(row);
  }

  return colorCard;
}

function renderProjectColorPalette() {
  const palette = document.createElement("div");
  palette.className = "codexpp-shadcn-palette";
  palette.setAttribute("aria-label", "Available project colors");

  for (const option of PROJECT_COLOR_OPTIONS) {
    const swatch = option.id === "auto" ? autoProjectColorOption("codex").value : option.value;
    const item = document.createElement("div");
    const color = document.createElement("span");
    const label = document.createElement("div");
    const name = document.createElement("span");
    const value = document.createElement("span");

    item.className = "codexpp-shadcn-palette-item";
    item.style.setProperty("--codexpp-shadcn-swatch", swatch);
    color.className = "codexpp-shadcn-palette-color";
    label.className = "codexpp-shadcn-palette-label";
    name.className = "codexpp-shadcn-palette-name";
    value.className = "codexpp-shadcn-palette-value";
    name.textContent = option.label;
    value.textContent = option.id === "auto" ? `assigns shadcn-${SHADCN_COLOR_TINT}` : `${option.id}-${SHADCN_COLOR_TINT}`;
    label.append(name, value);
    item.append(color, label);
    palette.appendChild(item);
  }

  return palette;
}

function renderProjectColorControl(state, bridge, projectKey, selected) {
  const selectedId = PROJECT_COLOR_OPTIONS.some((option) => option.id === selected) ? selected : "auto";
  const group = document.createElement("div");
  group.className = "codexpp-shadcn-color-grid";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Project color");

  for (const option of PROJECT_COLOR_OPTIONS) {
    const swatch = option.id === "auto" ? autoProjectColorOption(projectKey).value : option.value;
    const button = document.createElement("button");
    const dot = document.createElement("span");

    button.type = "button";
    button.className = "codexpp-shadcn-swatch";
    button.setAttribute("aria-pressed", String(selectedId === option.id));
    button.title =
      option.id === "auto"
        ? `Auto (${autoProjectColorOption(projectKey).label})`
        : `${option.label} ${SHADCN_COLOR_TINT} (${option.value})`;
    button.style.setProperty("--codexpp-shadcn-swatch", swatch);

    dot.className = "codexpp-shadcn-swatch-dot";
    button.append(dot, document.createTextNode(option.label));
    button.addEventListener("click", () => {
      bridge.setProjectColor(projectKey, option.id);
      if (state.pageRoot) renderSettingsPage(state.pageRoot, state);
    });
    group.appendChild(button);
  }

  return group;
}

function autoProjectColorOption(projectKey) {
  const key = normalizeProjectKey(projectKey);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return SHADCN_PROJECT_COLOR_OPTIONS[hash % SHADCN_PROJECT_COLOR_OPTIONS.length];
}

function uiImprovementsBridge() {
  return typeof window !== "undefined" ? window.__codexppUiImprovements : null;
}

function normalizeProjectKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function renderCompatibilitySwitch(state, key) {
  const button = document.createElement("button");
  const knob = document.createElement("span");

  button.type = "button";
  button.className = "codexpp-shadcn-switch";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-label", COMPATIBILITY_DEFS.find((item) => item.key === key)?.label || key);
  button.setAttribute("aria-checked", String(!!state.settings.compatibility[key]));
  button.appendChild(knob);

  button.addEventListener("click", () => {
    state.settings = normalizeSettings({
      ...state.settings,
      compatibility: {
        ...state.settings.compatibility,
        [key]: !state.settings.compatibility[key],
      },
    });
    saveSettings(state);
    applyRuntime(state);
    if (state.pageRoot) renderSettingsPage(state.pageRoot, state);
  });

  return button;
}
