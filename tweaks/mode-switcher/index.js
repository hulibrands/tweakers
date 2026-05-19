/**
 * Mode Switcher tweak.
 *
 * Adds a "Mode" section above "Codex++ Updates" in the Codex++ Config page
 * with a two-segment pill (Codex / Codex++). Flipping the pill toggles every
 * OTHER user tweak between enabled and disabled, then reloads the renderer
 * so the change takes effect immediately.
 *
 * Why a tweak instead of a runtime patch: tweaks live under
 *   ~/Library/Application Support/codex-plusplus/tweaks/
 * which is OUTSIDE the codex-plusplus source dir, so codex-plusplus
 * self-updates (which atomically rename the source root) leave it untouched.
 *
 * Coordination: when going to "Codex" mode, we snapshot every other tweak's
 * current `enabled` state into our own data dir, then write `enabled: false`
 * for each in the runtime's config.json. When going back to "Codex++", we
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

  const ROOT_DIR = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "codex-plusplus",
  );
  const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
  const TWEAKS_DIR = path.join(ROOT_DIR, "tweaks");
  const DATA_DIR = path.join(ROOT_DIR, "tweak-data", SELF_ID);
  const STATE_PATH = path.join(DATA_DIR, "state.json");
  const RELOAD_SENTINEL = path.join(TWEAKS_DIR, ".codexpp-safe-mode-reload");

  api.log.info("[mode-switcher] main provider active");
  runTeardown("main");
  removeModeSwitcherIpcHandlers(api);

  api.ipc.handle("get-mode", () => readState().mode);

  api.ipc.handle("set-mode", (mode) => {
    const next = mode === "regular" ? "regular" : "plusplus";
    const state = readState();
    if (state.mode === next) return { mode: next, changed: false };

    const cfg = readConfig();
    cfg.tweaks = cfg.tweaks ?? {};
    const otherIds = listTweakIdsExcludingSelf();

    if (next === "regular") {
      const snapshot = {};
      for (const id of otherIds) {
        const enabled = cfg.tweaks[id]?.enabled !== false; // default true
        snapshot[id] = enabled;
        cfg.tweaks[id] = Object.assign({}, cfg.tweaks[id], { enabled: false });
      }
      state.snapshot = snapshot;
    } else {
      const snapshot = state.snapshot || {};
      for (const id of otherIds) {
        const wasEnabled = id in snapshot ? snapshot[id] : true;
        cfg.tweaks[id] = Object.assign({}, cfg.tweaks[id], {
          enabled: wasEnabled,
        });
      }
      state.snapshot = {};
    }

    state.mode = next;
    writeConfig(cfg);
    writeState(state);
    touchReloadSentinel();
    api.log.info(
      `[mode-switcher] mode set to ${next} (others affected: ${otherIds.length})`,
    );
    return { mode: next, changed: true };
  });

  const cleanup = () => {
    removeModeSwitcherIpcHandlers(api);
    if (mainTeardown === cleanup) mainTeardown = null;
  };
  mainTeardown = cleanup;
  return cleanup;

  function listTweakIdsExcludingSelf() {
    let entries;
    try {
      entries = fs.readdirSync(TWEAKS_DIR, { withFileTypes: true });
    } catch {
      return [];
    }
    const ids = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name.endsWith(".bak")) continue;
      const tweakDir = path.join(TWEAKS_DIR, entry.name);
      if (!entry.isDirectory() && !isDirectorySymlink(tweakDir, entry)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(
            path.join(tweakDir, "manifest.json"),
            "utf8",
          ),
        );
        if (typeof manifest.id === "string" && manifest.id !== SELF_ID) {
          ids.push(manifest.id);
        }
      } catch {
        /* skip unreadable manifests */
      }
    }
    return ids;
  }

  function readConfig() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      return {};
    }
  }

  function writeConfig(cfg) {
    fs.mkdirSync(ROOT_DIR, { recursive: true });
    const tmp = CONFIG_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, CONFIG_PATH);
  }

  function readState() {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      return {
        mode: raw.mode === "regular" ? "regular" : "plusplus",
        snapshot:
          raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : {},
      };
    } catch {
      return { mode: "plusplus", snapshot: {} };
    }
  }

  function writeState(state) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify(state, null, 2) + "\n",
      "utf8",
    );
  }

  function touchReloadSentinel() {
    try {
      fs.mkdirSync(TWEAKS_DIR, { recursive: true });
      fs.writeFileSync(RELOAD_SENTINEL, String(Date.now()), "utf8");
    } catch {
      /* best-effort */
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

  // Eager refresh so first paint matches state.
  api.ipc
    .invoke("get-mode")
    .then(() => {
      void tryInject();
    })
    .catch(() => {});

  const observer = new MutationObserver(() => {
    void tryInject();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  async function tryInject() {
    if (window[MODE_SECTION_LOCK]) return;

    const anchorSection = findUpdatesSection();
    if (!anchorSection) return;

    if (cleanupModeSections(anchorSection)) return;

    window[MODE_SECTION_LOCK] = true;
    try {
      const currentMode =
        (await api.ipc.invoke("get-mode")) === "regular"
          ? "regular"
          : "plusplus";
      if (!anchorSection.isConnected) return;
      if (cleanupModeSections(anchorSection)) return;
      const section = buildModeSection(currentMode, async (next) => {
        await api.ipc.invoke("set-mode", next);
        location.reload();
      });
      section.dataset.codexppModeSwitcher = "true";
      anchorSection.parentElement?.insertBefore(section, anchorSection);
    } catch (e) {
      api.log.warn("[mode-switcher] inject failed", String(e));
    } finally {
      window[MODE_SECTION_LOCK] = false;
    }
  }

  const cleanup = () => {
    observer.disconnect();
    document.querySelectorAll(MODE_SECTION_SELECTOR).forEach((node) => node.remove());
    if (rendererTeardown === cleanup) rendererTeardown = null;
  };
  rendererTeardown = cleanup;
  return cleanup;
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
    text.includes("Switch between stock Codex and your Codex++ tweaks.")
  );
}

function findUpdatesSection() {
  const sections = document.querySelectorAll("section");
  for (const sec of sections) {
    const hits = sec.querySelectorAll("div, h1, h2, h3, span");
    for (const node of hits) {
      const t = (node.textContent || "").trim();
      if (t === "Codex++ Updates") return sec;
    }
  }
  return null;
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
    "Switch between stock Codex and your Codex++ tweaks. Reloads the window.";
  left.appendChild(rowTitle);
  left.appendChild(rowDesc);
  row.appendChild(left);
  row.appendChild(buildSegmentedPill(currentMode, onChange));
  card.appendChild(row);
  section.appendChild(card);

  return section;
}

function buildSegmentedPill(initial, onChange) {
  const group = document.createElement("div");
  group.setAttribute("role", "radiogroup");
  group.className =
    "inline-flex shrink-0 items-center rounded-full bg-token-foreground/10 p-0.5 text-sm";

  const options = [
    { value: "regular", label: "Codex" },
    { value: "plusplus", label: "Codex++" },
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
      b.className =
        "rounded-full px-3 py-1 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border " +
        (on
          ? "bg-token-charts-blue text-white shadow-sm"
          : "text-token-text-secondary hover:text-token-text-primary");
    }
  };

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      const next = btn.dataset.value;
      if (next === current) return;
      busy = true;
      apply(next);
      for (const b of buttons) b.disabled = true;
      try {
        await onChange(next);
      } finally {
        busy = false;
        for (const b of buttons) b.disabled = false;
      }
    });
    buttons.push(btn);
    group.appendChild(btn);
  }

  apply(initial);
  return group;
}
