/**
 * Titlebar Controls
 *
 * Renderer-only Codex++ tweak. It keeps the native macOS traffic-light buttons
 * untouched, then adjusts Codex's nearby sidebar/back/forward controls so they
 * sit on the same visual centerline.
 */

const SAFE_HEADER_LEFT_PROPERTY = "--spacing-token-safe-header-left";
const MAC_TITLEBAR_SAFE_LEFT_MIN_PX = 118;
const NO_SAFE_AREA_MAX_PX = 16;
const ADJUSTABLE_SAFE_LEFT_MIN_PX = 60;
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
    document.querySelectorAll(`[${TITLEBAR_ATTRIBUTE}], [${SPACING_ATTRIBUTE}]`).forEach((element) => {
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
    const currentPx = parsePx(candidate.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY));

    if (currentPx == null || currentPx <= NO_SAFE_AREA_MAX_PX) {
      candidate.removeAttribute(TITLEBAR_ATTRIBUTE);
      candidate.removeAttribute(SPACING_ATTRIBUTE);
      continue;
    }

    candidate.setAttribute(TITLEBAR_ATTRIBUTE, "active");
    const adjustedPx = adjustSafeLeft(currentPx);
    if (adjustedPx == null) continue;

    rememberOriginal(state, candidate);
    candidate.style.setProperty(SAFE_HEADER_LEFT_PROPERTY, `${adjustedPx}px`, "important");
    candidate.setAttribute(SPACING_ATTRIBUTE, "applied");
  }
}

function rememberOriginal(state, element) {
  if (state.originals.has(element)) return;
  state.originals.set(element, {
    value: element.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY),
    priority: element.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY),
  });
}

function restoreOriginalSpacing(state) {
  for (const [element, original] of state.originals) {
    if (!element.isConnected) continue;
    if (original.value) {
      element.style.setProperty(SAFE_HEADER_LEFT_PROPERTY, original.value, original.priority);
    } else {
      element.style.removeProperty(SAFE_HEADER_LEFT_PROPERTY);
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
