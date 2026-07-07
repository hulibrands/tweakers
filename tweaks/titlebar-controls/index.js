/**
 * Titlebar Controls
 *
 * Renderer-only ShadGPT tweak. It keeps the native macOS traffic-light buttons
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
const RIGHT_SAFE_AREA_LAYOUT_SELECTOR = [
  `[style*="${SAFE_HEADER_RIGHT_PROPERTY}"]`,
  `[data-codexpp-titlebar-right-safe-area="true"]`,
  `[data-titlebar-controls-right-safe-area="true"]`,
].join(", ");
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
      spacing: new Map(),
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
  const candidates = new Set(document.querySelectorAll(CANDIDATE_SELECTOR));
  for (const element of state.spacing.keys()) {
    candidates.add(element);
  }

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      state.spacing.delete(candidate);
      continue;
    }
    if (!candidate.isConnected) {
      restoreAndDeleteTrackedElement(state, candidate);
      continue;
    }

    const nativeLeft = readNativeStyle(state, candidate, SAFE_HEADER_LEFT_PROPERTY);
    const currentLeftPx = parsePx(nativeLeft.value);

    if (currentLeftPx == null || currentLeftPx <= NO_SAFE_AREA_MAX_PX) {
      refreshTrackedNativeStyles(state, candidate);
      restoreElementSpacing(state, candidate);
      continue;
    }

    candidate.setAttribute(TITLEBAR_ATTRIBUTE, "active");

    const nativeRight = readNativeStyle(state, candidate, SAFE_HEADER_RIGHT_PROPERTY);
    const adjustedLeftPx = adjustSafeLeft(currentLeftPx);
    const mayAdjustRight = shouldAdjustRightSafeArea(candidate, nativeRight);
    const adjustedRightPx = mayAdjustRight
      ? adjustSafeRight(parsePx(nativeRight.value), !nativeRight.value)
      : null;
    const desiredProperties = new Set();

    if (adjustedLeftPx != null) {
      desiredProperties.add(SAFE_HEADER_LEFT_PROPERTY);
      setSafeHeaderProperty(state, candidate, SAFE_HEADER_LEFT_PROPERTY, adjustedLeftPx, nativeLeft);
    }
    if (adjustedRightPx != null) {
      desiredProperties.add(SAFE_HEADER_RIGHT_PROPERTY);
      setSafeHeaderProperty(state, candidate, SAFE_HEADER_RIGHT_PROPERTY, adjustedRightPx, nativeRight);
    }

    restoreUnusedSpacing(state, candidate, desiredProperties);

    if (desiredProperties.size) {
      candidate.setAttribute(SPACING_ATTRIBUTE, "applied");
    } else {
      candidate.removeAttribute(SPACING_ATTRIBUTE);
    }
  }
}

function setSafeHeaderProperty(state, element, property, valuePx, native) {
  const propertyState = ensurePropertyState(state, element, property, native);
  const applied = { value: `${valuePx}px`, priority: "important" };
  propertyState.native = native;
  propertyState.applied = applied;
  element.style.setProperty(property, applied.value, applied.priority);
}

function readNativeStyle(state, element, property) {
  const current = readStyleSnapshot(element, property);
  const propertyState = state.spacing.get(element)?.get(property);
  if (!propertyState) return current;
  if (sameStyleSnapshot(current, propertyState.applied)) {
    return propertyState.native;
  }

  propertyState.native = current;
  propertyState.applied = null;
  return current;
}

function ensurePropertyState(state, element, property, native) {
  let properties = state.spacing.get(element);
  if (!properties) {
    properties = new Map();
    state.spacing.set(element, properties);
  }
  let propertyState = properties.get(property);
  if (!propertyState) {
    propertyState = { native, applied: null };
    properties.set(property, propertyState);
  }
  return propertyState;
}

function readStyleSnapshot(element, property) {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function sameStyleSnapshot(current, expected) {
  return Boolean(
    expected
      && current.value === expected.value
      && current.priority === expected.priority,
  );
}

function restoreUnusedSpacing(state, element, desiredProperties) {
  const properties = state.spacing.get(element);
  if (!properties) return;
  for (const property of Array.from(properties.keys())) {
    if (desiredProperties.has(property)) continue;
    restoreProperty(element, property, properties.get(property));
    properties.delete(property);
  }
  if (!properties.size) {
    state.spacing.delete(element);
  }
}

function restoreElementSpacing(state, element) {
  restoreAndDeleteTrackedElement(state, element);
}

function restoreAndDeleteTrackedElement(state, element) {
  const properties = state.spacing.get(element);
  if (properties) {
    for (const [property, propertyState] of properties) {
      restoreProperty(element, property, propertyState);
    }
    state.spacing.delete(element);
  }
  element.removeAttribute(TITLEBAR_ATTRIBUTE);
  element.removeAttribute(SPACING_ATTRIBUTE);
}

function restoreProperty(element, property, propertyState) {
  const native = propertyState.native;
  if (native.value) {
    element.style.setProperty(property, native.value, native.priority);
  } else {
    element.style.removeProperty(property);
  }
}

function refreshTrackedNativeStyles(state, element) {
  const properties = state.spacing.get(element);
  if (!properties) return;
  for (const property of properties.keys()) {
    readNativeStyle(state, element, property);
  }
}

function restoreOriginalSpacing(state) {
  for (const element of Array.from(state.spacing.keys())) {
    restoreAndDeleteTrackedElement(state, element);
  }
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

function adjustSafeRight(currentPx, allowSynthesis = false) {
  if (!Number.isFinite(currentPx)) return allowSynthesis ? MAC_TITLEBAR_SAFE_RIGHT_MIN_PX : null;
  if (currentPx <= NO_SAFE_AREA_MAX_PX) return null;
  if (currentPx >= MAC_TITLEBAR_SAFE_RIGHT_MIN_PX) return null;
  if (currentPx >= ADJUSTABLE_SAFE_RIGHT_MIN_PX) return MAC_TITLEBAR_SAFE_RIGHT_MIN_PX;
  return null;
}

function shouldAdjustRightSafeArea(element, nativeRight) {
  if (nativeRight.value) return true;
  return typeof element.matches === "function" && element.matches(RIGHT_SAFE_AREA_LAYOUT_SELECTOR);
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
