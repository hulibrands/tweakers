const { compactText, isVisible, findMenuItem } = require("./dom-utils");
const { accountPanelShell, renderAccountPanel, refreshPanel } = require("./ui-popup");
const { renderAccountsPage } = require("./ui-settings");

const USAGE_MENU_PATTERN = /\b(?:usage remaining|rate limits(?: remaining)?)\b/i;
const ACCOUNT_MENU_SETTLE_SCAN_DELAYS_MS = [50, 150, 350, 700];
const ACCOUNT_MENU_SIGNAL_PATTERN = /\b(?:personal account|usage remaining|rate limits(?: remaining)?|settings|log out)\b|@/i;
const DETECTOR_MISS_LOG_INTERVAL_MS = 60_000;
const ACCOUNT_MENU_PROBE_WINDOW_MS = 1_200;
const ACCOUNT_MENU_TRIGGER_SELECTOR = [
  "[data-codexpp-account-switcher]",
  "[data-codexpp-account-switcher-confirm]",
  '[role="menu"]',
  "[data-radix-menu-content]",
  "[data-radix-popper-content-wrapper]",
  "[data-radix-menu-trigger]",
  '[aria-haspopup="menu"]',
  '[aria-haspopup="true"]',
  "[aria-expanded]",
].join(", ");
const ACCOUNT_MENU_TRIGGER_TEXT_PATTERN =
  /\b(?:account|profile|avatar|user menu|usage remaining|rate limits(?: remaining)?|settings|log out)\b|@/i;
const INTERACTIVE_TRIGGER_SELECTOR = [
  "button",
  "a",
  '[role="button"]',
  '[role="menuitem"]',
].join(", ");
const ACCOUNT_MENU_ITEM_SELECTOR = [
  "button",
  "a",
  '[role="button"]',
  '[role="menuitem"]',
  "[data-radix-collection-item]",
].join(", ");
const ACCOUNT_MENU_ROOT_SELECTOR = [
  '[role="menu"]',
  "[data-radix-menu-content]",
  "[data-radix-popper-content-wrapper]",
  '[data-state="open"]',
  "[data-side][data-align]",
].join(", ");

/**
 * Bootstraps the renderer-side of the account switcher:
 *  1. Registers the dedicated Settings page (if the SDK supports it).
 *  2. Sets up a MutationObserver + pointer/key listeners to inject the
 *     floating panel into Codex's account menu whenever it appears.
 *
 * @param {object} state - Shared renderer state created in index.js
 */
function startRenderer(state) {
  // ── Settings page registration ────────────────────────────────────────────
  if (typeof state.api.settings?.registerPage === "function") {
    const pageHandle = state.api.settings.registerPage({
      id: "accounts",
      title: "Accounts",
      description: "Switch Codex accounts and manage saved sessions.",
      iconSvg:
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle" aria-hidden="true">' +
        '<path d="M10 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" stroke-width="1.5"/>' +
        '<path d="M4.75 16.25c.7-2.15 2.65-3.5 5.25-3.5s4.55 1.35 5.25 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
        "</svg>",
      render: (root) => {
        state.settingsRoot = root;
        renderAccountsPage(state, root);
      },
    });
    state.disposers.push(() => pageHandle.unregister?.());
  } else {
    state.api.log.warn(
      "[account-switcher] registerPage unavailable; account controls will only appear in the account menu.",
    );
  }

  // ── Mutation observer: inject panel into the account popup ────────────────
  // Phase 5.4 gate: Codex streams tokens via constant DOM churn, and the
  // account menu only exists after the user clicks the avatar. We start with
  // accountMenuOpen=false so the observer ignores random mutations, and only
  // re-enable scanning on pointerdown/keydown (which is how the menu can be
  // opened in the first place). installAccountSwitcher flips the flag on
  // when the panel actually mounts; on next teardown it flips back.
  if (typeof state.accountMenuOpen !== "boolean") state.accountMenuOpen = false;

  const schedule = (withFollowUps = false, force = false) => {
    if (state.disposed) return;
    // Only queue settle scans / rAF work if the menu is currently visible or
    // we have an explicit trigger (pointerdown/keydown) signalling intent.
    if (!state.accountMenuOpen && !force) return;
    if (withFollowUps) queueAccountMenuSettleScans(state);
    if (state.pending) return;
    state.pending = window.requestAnimationFrame(() => {
      state.pending = 0;
      scanForAccountMenu(state);
    });
  };

  state.observer = new MutationObserver(() => schedule(true));
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
  // Disconnect the observer when the tweak is stopped to avoid a memory leak.
  state.disposers.push(() => state.observer?.disconnect());
  state.disposers.push(() => clearAccountMenuSettleScans(state));
  // pointerdown/keydown are the trigger that re-enables observation: the
  // menu can only appear in response to a user gesture. `force=true` opens
  // the gate; the next scan will mark accountMenuOpen=true if it finds the
  // menu, after which mutation-driven rescans take over.
  const MENU_TRIGGER_KEYS = new Set(["Enter", " ", "ArrowDown", "ArrowUp", "Escape"]);
  const scheduleWithFollowUps = (event) => {
    if (event?.type === "pointerdown" && !shouldProbeAccountMenuFromPointer(event, state)) {
      return;
    }
    // keydown fires on every keystroke, including message composition. The
    // account menu can only be opened or navigated by menu-relevant keys, so
    // ignore ordinary text input — otherwise every character typed triggers a
    // full-document account-menu scan.
    if (event && event.type === "keydown" && !MENU_TRIGGER_KEYS.has(event.key)) {
      return;
    }
    state.accountMenuOpen = true;
    state.accountMenuProbeUntil = Date.now() + ACCOUNT_MENU_PROBE_WINDOW_MS;
    schedule(true, true);
  };
  document.addEventListener("pointerdown", scheduleWithFollowUps, true);
  document.addEventListener("keydown", scheduleWithFollowUps, true);
  state.disposers.push(() => document.removeEventListener("pointerdown", scheduleWithFollowUps, true));
  state.disposers.push(() => document.removeEventListener("keydown", scheduleWithFollowUps, true));
  if (state.accountMenuOpen) schedule(true);
}

function shouldProbeAccountMenuFromPointer(event, state) {
  if (state?.accountMenuOpen || isAccountMenuProbeActive(state)) return true;
  const target = event?.target;
  if (!target || typeof target.closest !== "function") return false;
  if (closestSelector(target, ACCOUNT_MENU_TRIGGER_SELECTOR)) return true;

  const control = closestSelector(target, INTERACTIVE_TRIGGER_SELECTOR);
  if (!control) return false;
  return ACCOUNT_MENU_TRIGGER_TEXT_PATTERN.test(accountTriggerLabel(control));
}

function closestSelector(element, selector) {
  for (const part of selector.split(",")) {
    const candidate = part.trim();
    if (!candidate) continue;
    const match = element.closest(candidate);
    if (match) return match;
  }
  return null;
}

function accountTriggerLabel(element) {
  if (!element) return "";
  const attributes = [
    "aria-label",
    "title",
    "data-testid",
    "data-test-id",
    "data-test",
    "id",
    "class",
  ];
  return [
    compactText(element),
    ...attributes.map((attribute) => element.getAttribute?.(attribute) || ""),
  ].join(" ");
}

function queueAccountMenuSettleScans(state) {
  clearAccountMenuSettleScans(state);
  state.accountMenuRescanTimers = ACCOUNT_MENU_SETTLE_SCAN_DELAYS_MS.map((delay) => {
    return window.setTimeout(() => {
      if (state.accountMenuOpen || isAccountMenuProbeActive(state)) {
        scanForAccountMenu(state);
      }
    }, delay);
  });
}

function clearAccountMenuSettleScans(state) {
  for (const timer of state.accountMenuRescanTimers || []) {
    if (typeof window.clearTimeout === "function") window.clearTimeout(timer);
    else clearTimeout(timer);
  }
  state.accountMenuRescanTimers = [];
}

function isAccountMenuProbeActive(state) {
  return Date.now() < (state?.accountMenuProbeUntil || 0);
}

// ─── Account-menu detection ───────────────────────────────────────────────────

function scanForAccountMenu(state) {
  const menu = findSettingsAccountMenu();
  if (!menu) {
    // Menu is no longer in the DOM — close the gate so the observer stops
    // burning cycles until the next pointer/keyboard trigger.
    if (state) {
      const snapshot = isAccountMenuProbeActive(state)
        ? captureAccountMenuDomSnapshot()
        : { count: 0, entries: [], joinedText: "" };
      // A genuine miss = we saw account-menu text but could not resolve the
      // full menu container (the actionable "detection is broken" signal). A
      // scan that finds no account-menu signals at all means the menu simply
      // is not open — report that as "idle" and do NOT count it, otherwise the
      // health widget climbs to "missing (N misses)" and reads permanently
      // broken even while injection works fine when the menu is open.
      const realMiss = snapshot.entries.length > 0;
      const patch = {
        status: realMiss ? "missing" : "idle",
        lastReason: realMiss
          ? "Saw account-menu text but no full menu container matched."
          : "Account menu is closed — nothing to inject yet.",
        lastSnapshot: snapshot,
      };
      if (realMiss) patch.lastMissingAt = Date.now();
      updateDetectorHealth(state, patch);
      logDetectorMiss(state, snapshot);
      state.accountMenuOpen = false;
    }
    return;
  }
  updateDetectorHealth(state, {
    status: "found",
    lastFoundAt: Date.now(),
    lastReason: "Account menu container matched.",
    lastMenuText: accountMenuText(menu).slice(0, 240),
    lastSnapshot: captureAccountMenuDomSnapshot(menu),
  });
  if (menu.querySelector("[data-codexpp-account-switcher]")) {
    // Already installed and the menu node is still attached — keep the gate
    // open so settle-scans + observer ticks can refresh the panel.
    if (state) {
      state.accountMenuOpen = true;
      updateDetectorHealth(state, {
        status: "already installed",
        lastReason: "Accounts accordion is already mounted in the menu.",
      });
    }
    return;
  }
  installAccountSwitcher(state, menu);
}

function findSettingsAccountMenu() {
  const openPopoverMenu = findOpenAccountPopoverMenu();
  if (openPopoverMenu) return openPopoverMenu;

  const usageMenu = findAccountMenuByRateLimits();
  if (usageMenu) return usageMenu;

  const candidates = Array.from(
    document.querySelectorAll(accountMenuCandidateSelector()),
  );
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) continue;
    const text = accountMenuText(candidate);
    if (!/\bsettings\b/i.test(text) || !/\blog out\b/i.test(text)) continue;
    if (!USAGE_MENU_PATTERN.test(text) && !/@/.test(text)) continue;
    return candidate.matches("[data-radix-popper-content-wrapper]")
      ? candidate.querySelector('[role="menu"], [data-radix-menu-content]') || candidate
      : candidate;
  }
  return findSidebarAccountMenuByItems();
}

function accountMenuCandidateSelector() {
  return ACCOUNT_MENU_ROOT_SELECTOR;
}

function findOpenAccountPopoverMenu() {
  const roots = accountMenuRoots();
  const rootCandidates = roots.filter((root) => looksLikeAccountMenu(root));
  const anchors = Array.from(
    new Set(roots.flatMap((root) => Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR)))),
  ).filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
    if (element.closest("[data-codexpp-account-switcher]")) return false;
    const text = compactText(element);
    return USAGE_MENU_PATTERN.test(text) || /\blog out\b/i.test(text);
  });

  const candidates = [];
  for (const anchor of anchors) {
    let node = anchor;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node instanceof HTMLElement && isVisible(node) && looksLikeAccountMenu(node)) {
        candidates.push(node);
      }
      node = node.parentElement;
    }
  }

  return smallestAccountMenuCandidate([...candidates, ...rootCandidates]);
}

function looksLikeAccountMenu(element) {
  if (!isPlausibleAccountMenuBox(element)) return false;
  const text = accountMenuText(element);
  if (!/\bsettings\b/i.test(text) || !/\blog out\b/i.test(text)) return false;
  if (!USAGE_MENU_PATTERN.test(text) && !/@/.test(text)) {
    return false;
  }
  if (element.querySelector("[data-codexpp-account-switcher]")) return false;
  return true;
}

function isPlausibleAccountMenuBox(element) {
  if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (window.innerWidth && rect.width > window.innerWidth * 0.8) return false;
  if (window.innerHeight && rect.height > window.innerHeight * 0.8) return false;
  return true;
}

function smallestAccountMenuCandidate(candidates) {
  const unique = Array.from(new Set(candidates)).filter((candidate) => candidate instanceof HTMLElement);
  unique.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
  });
  return unique[0] || null;
}

function findAccountMenuByRateLimits() {
  const rateLimits = findRateLimitsItem();
  if (!rateLimits) return null;
  const menu = rateLimits.closest(
    accountMenuCandidateSelector(),
  );
  const normalized = normalizeAccountMenuCandidate(menu);
  if (normalized) return normalized;

  let node = rateLimits.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node instanceof HTMLElement && isVisible(node) && looksLikeAccountMenu(node)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function findRateLimitsItem(root = document) {
  const candidates = root === document
    ? accountMenuRoots().flatMap((menuRoot) => Array.from(menuRoot.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR)))
    : Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR));
  for (const element of candidates) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
    if (element.closest("[data-codexpp-account-switcher]")) continue;
    const text = compactText(element).toLowerCase();
    if (!USAGE_MENU_PATTERN.test(text)) continue;
    return element;
  }
  return null;
}

function findSidebarAccountMenuByItems() {
  const items = accountMenuRoots()
    .flatMap((root) => Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR)))
    .filter((element) => element instanceof HTMLElement && isVisible(element));
  const settings = items.find((element) => /\bsettings\b/i.test(compactText(element)));
  const logout = items.find((element) => /\blog out\b/i.test(compactText(element)));
  if (!settings || !logout) return null;

  let node = settings.parentElement;
  while (node && node !== document.body) {
    if (node.contains(logout)) {
      const text = accountMenuText(node);
      if (USAGE_MENU_PATTERN.test(text) || /@/.test(text)) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

function accountMenuRoots(root = document) {
  if (!root?.querySelectorAll) return [];
  const explicitRoots = Array.from(root.querySelectorAll(ACCOUNT_MENU_ROOT_SELECTOR))
    .filter((element) => element instanceof HTMLElement && isVisible(element));
  return Array.from(new Set([
    ...explicitRoots,
    ...inferAccountMenuRootsFromItems(root),
    ...inferAccountMenuRootsFromBodyChildren(root),
  ]));
}

function inferAccountMenuRootsFromItems(root = document) {
  const candidates = [];
  for (const item of Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR))) {
    if (!(item instanceof HTMLElement) || !isVisible(item)) continue;
    if (item.closest("[data-codexpp-account-switcher]")) continue;
    const text = compactText(item);
    if (!ACCOUNT_MENU_SIGNAL_PATTERN.test(text)) continue;
    let node = item.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node instanceof HTMLElement && looksLikeAccountMenu(node)) {
        candidates.push(node);
        break;
      }
      node = node.parentElement;
    }
  }
  return candidates;
}

function inferAccountMenuRootsFromBodyChildren(root = document) {
  if (root !== document || !document.body?.children) return [];
  return Array.from(document.body.children)
    .filter((element) => element instanceof HTMLElement)
    .filter((element) => !element.matches?.(ACCOUNT_MENU_ROOT_SELECTOR))
    .filter((element) => !element.querySelector?.(ACCOUNT_MENU_ROOT_SELECTOR))
    .filter((element) => {
      if (!isPlausibleAccountMenuBox(element)) return false;
      const text = accountMenuText(element);
      if (!/\bsettings\b/i.test(text) || !/\blog out\b/i.test(text)) return false;
      return USAGE_MENU_PATTERN.test(text) || /@/.test(text);
    });
}

function normalizeAccountMenuCandidate(candidate) {
  if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) return null;
  const menu = candidate.matches("[data-radix-popper-content-wrapper]")
    ? candidate.querySelector('[role="menu"], [data-radix-menu-content]') || candidate
    : candidate;
  return menu instanceof HTMLElement && isVisible(menu) && looksLikeAccountMenu(menu) ? menu : null;
}

function installAccountSwitcher(state, menu) {
  const target =
    findMenuItem(menu, USAGE_MENU_PATTERN) ||
    findMenuItem(menu, /settings/i) ||
    Array.from(menu.children).find((child) => child instanceof HTMLElement);
  if (!(target instanceof HTMLElement) || !target.parentElement) return;

  const panel = accountPanelShell(target);
  target.before(panel);
  // Phase 5.4 gate: panel is now in the DOM, so the account menu is
  // currently open. Flip the observer gate on so streamed-token mutations
  // are once again allowed to drive panel refresh until the menu closes.
  if (state) state.accountMenuOpen = true;
  // Attach an explicit catch so the promise rejection is never silently swallowed.
  refreshPanel(state, panel).catch((error) => {
    state.api.log.warn("[account-switcher] panel load failed", String(error));
  });
  updateDetectorHealth(state, {
    status: "installed",
    lastInstalledAt: Date.now(),
    lastReason: "Accounts accordion was inserted into the account menu.",
    lastMenuText: accountMenuText(menu).slice(0, 240),
  });
}

function accountMenuText(element) {
  if (!(element instanceof HTMLElement)) return "";
  const pieces = [compactText(element)];
  const descendants = element.querySelectorAll(`${ACCOUNT_MENU_ITEM_SELECTOR}, div`);
  for (const child of descendants) {
    if (child instanceof HTMLElement) pieces.push(compactText(child));
    if (pieces.length >= 64) break;
  }
  return pieces
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function updateDetectorHealth(state, patch) {
  if (!state) return;
  const previous = state.detectorHealth || {};
  const status = patch.status || previous.status || "idle";
  state.detectorHealth = {
    status,
    misses: previous.misses || 0,
    lastCheckedAt: Date.now(),
    lastFoundAt: previous.lastFoundAt || null,
    lastInstalledAt: previous.lastInstalledAt || null,
    lastMissingAt: previous.lastMissingAt || null,
    lastReason: previous.lastReason || "",
    lastMenuText: previous.lastMenuText || "",
    lastSnapshot: previous.lastSnapshot || null,
    ...patch,
  };
  if (status === "missing") {
    state.detectorHealth.misses = (previous.misses || 0) + 1;
  }
}

function logDetectorMiss(state, snapshot) {
  if (!state?.api?.log?.warn) return;
  if (!state.accountMenuOpen || !snapshot.entries.length) return;
  const now = Date.now();
  if (now - (state.lastDetectorMissLogAt || 0) < DETECTOR_MISS_LOG_INTERVAL_MS) return;
  state.lastDetectorMissLogAt = now;
  state.api.log.warn(
    "[account-switcher] account menu not found",
    JSON.stringify({
      signals: snapshot.entries.slice(0, 8),
    }),
  );
}

function captureAccountMenuDomSnapshot(root = document) {
  const entries = [];
  if (!root?.querySelectorAll) return { count: 0, entries, joinedText: "" };
  const elements = root === document
    ? Array.from(new Set([
      ...accountMenuRoots(root),
      ...inferAccountMenuRootsFromBodyChildren(root),
    ])).flatMap((menuRoot) => [
      menuRoot,
      ...Array.from(menuRoot.querySelectorAll(`${ACCOUNT_MENU_ITEM_SELECTOR}, div`)),
    ])
    : Array.from(root.querySelectorAll(`${ACCOUNT_MENU_ITEM_SELECTOR}, div`));
  for (const element of elements) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
    if (element.closest("[data-codexpp-account-switcher]")) continue;
    const text = compactText(element);
    if (!text || !ACCOUNT_MENU_SIGNAL_PATTERN.test(text)) continue;
    entries.push({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      state: element.getAttribute("data-state") || "",
      radixItem: element.getAttribute("data-radix-collection-item") != null,
      text: text.slice(0, 180),
    });
    if (entries.length >= 16) break;
  }
  return {
    count: entries.length,
    entries,
    joinedText: entries.map((entry) => entry.text).join(" | "),
  };
}

module.exports = {
  startRenderer,
  __test: {
    captureAccountMenuDomSnapshot,
    findSettingsAccountMenu,
  },
};
