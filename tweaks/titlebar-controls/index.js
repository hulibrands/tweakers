/**
 * Titlebar Controls
 *
 * Renderer-only Codex++ tweak. It keeps the native macOS traffic-light buttons
 * untouched, then adjusts Codex's nearby sidebar/back/forward controls so they
 * sit on the same visual centerline.
 */

const SAFE_HEADER_LEFT_PROPERTY = "--spacing-token-safe-header-left";
const SAFE_HEADER_RIGHT_PROPERTY = "--spacing-token-safe-header-right";
const MAC_TITLEBAR_SAFE_LEFT_MIN_PX = 118;
const MAC_TITLEBAR_SAFE_RIGHT_MIN_PX = 66;
const NO_SAFE_AREA_MAX_PX = 16;
const ADJUSTABLE_SAFE_LEFT_MIN_PX = 60;
const ADJUSTABLE_SAFE_RIGHT_MIN_PX = 24;
const STYLE_ID = "codexpp-titlebar-controls-style";
const TITLEBAR_ATTRIBUTE = "data-codexpp-titlebar-controls";
const SPACING_ATTRIBUTE = "data-codexpp-titlebar-spacing";
const CANDIDATE_SELECTOR = `[style*="${SAFE_HEADER_LEFT_PROPERTY}"]`;
const STYLE_TEXT = `
[${TITLEBAR_ATTRIBUTE}="active"] :is(
  button[style*="sidebar-trigger"],
  button[aria-label="Hide sidebar"],
  button[aria-label="Show sidebar"],
  button[aria-label="Back"],
  button[aria-label="Forward"],
  button[title="Back"],
  button[title="Forward"]
) {
  block-size: 32px !important;
  inline-size: 32px !important;
  min-inline-size: 32px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  transform: translateY(4px);
}

[${TITLEBAR_ATTRIBUTE}="active"] :is(
  button[style*="sidebar-trigger"],
  button[aria-label="Hide sidebar"],
  button[aria-label="Show sidebar"],
  button[aria-label="Back"],
  button[aria-label="Forward"],
  button[title="Back"],
  button[title="Forward"]
) svg {
  block-size: 21px !important;
  inline-size: 21px !important;
}
`.trim();

module.exports = {
  start(api) {
    if (!isMacOS()) {
      api.log.info("Titlebar Controls skipped on non-macOS platform");
      return;
    }

    const state = {
      api,
      disposed: false,
      observer: null,
      pending: 0,
      originals: new Map(),
      resizeHandler: null,
    };
    this._state = state;

    ensureStyle();
    applyTitlebarControls(state);

    state.resizeHandler = () => schedule(state);
    window.addEventListener("resize", state.resizeHandler);

    state.observer = new MutationObserver(() => schedule(state));
    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });

    api.log.info("Titlebar Controls enabled");
  },

  stop() {
    const state = this._state;
    if (!state) return;
    state.disposed = true;
    if (state.pending) {
      window.clearTimeout(state.pending);
      state.pending = 0;
    }
    state.observer?.disconnect();
    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
    }
    restoreOriginalSpacing(state);
    document.getElementById(STYLE_ID)?.remove();
    document
      .querySelectorAll(`[${TITLEBAR_ATTRIBUTE}], [${SPACING_ATTRIBUTE}]`)
      .forEach((element) => {
        element.removeAttribute(TITLEBAR_ATTRIBUTE);
        element.removeAttribute(SPACING_ATTRIBUTE);
      });
    this._state = null;
  },
};

function schedule(state) {
  if (state.disposed || state.pending) return;
  state.pending = window.setTimeout(() => {
    state.pending = 0;
    applyTitlebarControls(state);
  }, 50);
}

function applyTitlebarControls(state) {
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR));

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    const currentLeftPx = parsePx(candidate.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY));
    const currentRightPx = parsePx(candidate.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY));

    if (currentLeftPx == null || currentLeftPx <= NO_SAFE_AREA_MAX_PX) {
      candidate.removeAttribute(TITLEBAR_ATTRIBUTE);
      candidate.removeAttribute(SPACING_ATTRIBUTE);
      continue;
    }

    candidate.setAttribute(TITLEBAR_ATTRIBUTE, "active");

    const adjustedLeftPx = adjustSafeLeft(currentLeftPx);
    const adjustedRightPx = adjustSafeRight(currentRightPx);

    if (adjustedLeftPx == null && adjustedRightPx == null) continue;
    if (adjustedLeftPx != null) setSafeHeaderProperty(state, candidate, SAFE_HEADER_LEFT_PROPERTY, adjustedLeftPx);
    if (adjustedRightPx != null) setSafeHeaderProperty(state, candidate, SAFE_HEADER_RIGHT_PROPERTY, adjustedRightPx);
    candidate.setAttribute(SPACING_ATTRIBUTE, "applied");
  }
}

function setSafeHeaderProperty(state, element, property, valuePx) {
  rememberOriginal(state, element, property);
  element.style.setProperty(property, `${valuePx}px`, "important");
}

function rememberOriginal(state, element, property) {
  let originals = state.originals.get(element);
  if (!originals) {
    originals = new Map();
    state.originals.set(element, originals);
  }
  if (originals.has(property)) return;
  originals.set(property, {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  });
}

function restoreOriginalSpacing(state) {
  for (const [element, originals] of state.originals) {
    if (!element.isConnected) continue;
    for (const [property, original] of originals) {
      if (original.value) {
        element.style.setProperty(property, original.value, original.priority);
      } else {
        element.style.removeProperty(property);
      }
    }
  }
  state.originals.clear();
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.head.appendChild(style);
}

function adjustSafeLeft(currentPx) {
  if (!Number.isFinite(currentPx)) return null;
  if (currentPx <= NO_SAFE_AREA_MAX_PX) return null;
  if (currentPx >= MAC_TITLEBAR_SAFE_LEFT_MIN_PX) return null;
  if (currentPx >= ADJUSTABLE_SAFE_LEFT_MIN_PX) return MAC_TITLEBAR_SAFE_LEFT_MIN_PX;
  return null;
}

function adjustSafeRight(currentPx) {
  if (!Number.isFinite(currentPx)) return MAC_TITLEBAR_SAFE_RIGHT_MIN_PX;
  if (currentPx <= NO_SAFE_AREA_MAX_PX) return null;
  if (currentPx >= MAC_TITLEBAR_SAFE_RIGHT_MIN_PX) return null;
  if (currentPx >= ADJUSTABLE_SAFE_RIGHT_MIN_PX) return MAC_TITLEBAR_SAFE_RIGHT_MIN_PX;
  return null;
}

function parsePx(value) {
  const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMacOS() {
  const userAgentDataPlatform = navigator.userAgentData?.platform;
  if (userAgentDataPlatform) return /\bmac/i.test(userAgentDataPlatform);
  if (navigator.platform) return /^Mac/i.test(navigator.platform);
  return /\b(Macintosh|Mac OS X|MacIntel)\b/i.test(navigator.userAgent);
}
