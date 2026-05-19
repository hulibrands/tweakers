/**
 * Better Browser Agent
 *
 * Custom main-only Codex++ tweak. Main hooks apply immediately; renderer bundle
 * patches apply to the next app-shell load, so enabling or updating the tweak
 * during a running session waits for the user's next app restart.
 */

const TWEAK_ID = "co.thomashulihan.better-browser-agent";
const TWEAK_NAME = "Better Browser Agent";
const ORIGINAL_BETTER_BROWSER_STATE_KEY = "__codexpp_better_browser_state__";
const GLOBAL_STATE_KEY = "__codexpp_better_browser_agent_state__";
const PATCH_RENDERER_ASSET_KEY = "__codexpp_better_browser_agent_patch_renderer_asset__";
const SERVICES_KEY = "__codexpp_window_services__";
const PATCH_OVERRIDES_DIR = "tweak-source-overrides";
const PATCH_OVERRIDE_FILE = "patches.override.json";
const MESSAGE_FROM_VIEW = "codex_desktop:message-from-view";
const MESSAGE_FOR_VIEW = "codex_desktop:message-for-view";
const DEVTOOLS_CONTROL_IPC = "codexpp:better-browser-agent-devtools-control";
const MAX_BROWSER_TABS = 25;
const BROWSER_THEMES = new Set(["dark", "light"]);
const INLINE_DEVTOOLS_DEFAULT_DOCK = "bottom";
const INLINE_DEVTOOLS_DOCKS = new Set(["left", "bottom", "right"]);
const INLINE_DEVTOOLS_HANDLE_SIZE = 7;
const INLINE_DEVTOOLS_MIN_WIDTH = 360;
const INLINE_DEVTOOLS_MAX_WIDTH = 760;
const INLINE_DEVTOOLS_WIDTH_RATIO = 0.46;
const INLINE_DEVTOOLS_MIN_HEIGHT = 260;
const INLINE_DEVTOOLS_MAX_HEIGHT = 720;
const INLINE_DEVTOOLS_HEIGHT_RATIO = 0.42;
const INLINE_DEVTOOLS_BOUNDS_POLL_MS = 16;
const DIRECT_COMMENT_ALIAS_TTL_MS = 5 * 60 * 1000;
const BROWSER_COMMENT_OVERLAY_ALIAS_MESSAGE_TYPES = new Set([
  "browser-sidebar-comment-overlay-close",
  "browser-sidebar-comment-overlay-delete",
  "browser-sidebar-comment-overlay-mounted",
  "browser-sidebar-comment-overlay-preview-open-changed",
  "browser-sidebar-comment-overlay-submit",
]);
const BROWSER_COMMENT_OVERLAY_ALIAS_CONSUMING_MESSAGE_TYPES = new Set([
  "browser-sidebar-comment-overlay-close",
  "browser-sidebar-comment-overlay-delete",
  "browser-sidebar-comment-overlay-submit",
]);
const BRIDGE_BUFFER_LIMITS = Object.freeze({
  bridgeCalls: 100,
  console: 200,
  navigation: 100,
  network: 200,
  runtime: 100,
  screenshots: 8,
});
const BRIDGE_OUTPUT_LIMITS = Object.freeze({
  accessibilityNodes: 80,
  domNodes: 120,
  fieldLength: 800,
  totalStringLength: 48000,
});
const BRIDGE_SCREENSHOT_BYTES_LIMIT = 4 * 1024 * 1024;
const BRIDGE_SCREENSHOT_DIR = "better-browser-agent";
const BRIDGE_REFUSED_METHODS = new Set([
  "getCookies",
  "getStorage",
  "getAuthHeaders",
  "getRequestBodies",
  "click",
  "type",
  "mutate",
]);
const BROWSER_RENDERER_PATCH_NAMES = Object.freeze([
  "use-model-settings",
  "review-runtime-bridge",
  "app-shell",
]);
const PATCHED_IPC_HANDLER = Symbol.for("codexpp.better-browser-agent.ipcHandler");
const PATCHED_WEB_CONTENTS = Symbol.for("codexpp.better-browser-agent.webContents");

/** @type {import("@codex-plusplus/sdk").Tweak} */
const tweak = {
  start(api) {
    if (api.process !== "main") return;

    const previous = globalThis[GLOBAL_STATE_KEY];
    if (previous && typeof previous.dispose === "function") {
      try {
        previous.dispose();
      } catch (error) {
        api.log.warn("failed to dispose previous instance", stringifyError(error));
      }
    }

    if (globalThis[ORIGINAL_BETTER_BROWSER_STATE_KEY]) {
      const state = createMainState(api, {
        conflict: {
          active: true,
          message:
            "Original Better Browser is already active. Disable it before enabling Better Browser Agent.",
          originalStateKey: ORIGINAL_BETTER_BROWSER_STATE_KEY,
        },
        patchingEnabled: false,
        status: "blocked-by-original-better-browser",
      });
      state.dispose = () => stopMain(state);
      globalThis[GLOBAL_STATE_KEY] = state;
      this._state = state;
      api.log.warn("Better Browser Agent conflict: original Better Browser is already active; skipping browser patches", {
        customStateKey: GLOBAL_STATE_KEY,
        originalStateKey: ORIGINAL_BETTER_BROWSER_STATE_KEY,
        tweakId: TWEAK_ID,
      });
      return;
    }

    const state = createMainState(api, {
      patchingEnabled: true,
      status: "active",
    });

    state.devToolsSessionManager = createDevToolsSessionManager(api, state);
    state.bridgeApi = createBetterBrowserBridgeApi(state);
    state.dispose = () => stopMain(state);
    state.patchRendererAsset = (rawUrl, source) => patchRendererAsset(rawUrl, source, state);
    globalThis[GLOBAL_STATE_KEY] = state;
    globalThis[PATCH_RENDERER_ASSET_KEY] = state.patchRendererAsset;
    this._state = state;

    if (state.patchOverrides?.patchesById?.size > 0) {
      logInfo(
        api,
        `loaded ${state.patchOverrides.patchesById.size} smart-repatch override(s) from ${state.patchOverrides.path}`,
      );
    }

    installProtocolPatch(api, state);
    installIpcPatch(state);
    installDevToolsControlIpc(api, state);
    installWebContentsPatch(api, state);
    installGlobalTabShortcuts(api, state);
  },

  stop() {
    const state = this._state;
    if (state) stopMain(state);
  },
};

module.exports = tweak;

if (typeof process !== "undefined" && process.env?.BETTER_BROWSER_TEST === "1") {
  module.exports.__test = {
    assetPatchKind,
    createDevToolsSessionManager,
    createBetterBrowserBridgeApi,
    createBridgeEventBuffers,
    ensureBrowserTabRegistryEntry,
    getBrowserTabHealthSnapshot,
    listBrowserTabHealthSnapshots,
    loadPatchOverrides,
    patchRendererAsset,
    patchUseModelSettings,
    patchReviewRuntimeBridge,
    patchAppShell,
    rememberBrowserDirectCommentAlias,
    redactBridgeValue,
    refreshBrowserTabRegistryEntry,
    refuseUnsupportedBridgeMethod,
    routeBrowserDirectCommentAlias,
    selectBrowserTabForBridge,
    truncateBridgeValue,
  };
}

function createMainState(api, overrides = {}) {
  return {
    api,
    bridgeApi: null,
    bridgeAuditLog: createRingBuffer(BRIDGE_BUFFER_LIMITS.bridgeCalls),
    bridgeEventBuffers: createBridgeEventBuffers(),
    bridgeMode: "read-only",
    browserTabRegistry: new Map(),
    browserThemeByOwnerWebContentsId: new Map(),
    conflict: null,
    devToolsControlOwners: new Map(),
    devToolsSessionManager: null,
    directCommentAliases: new Map(),
    disposers: [],
    fork: {
      id: TWEAK_ID,
      name: TWEAK_NAME,
      stateKey: GLOBAL_STATE_KEY,
    },
    patchOverrideWarnings: new Set(),
    patchOverrides: loadPatchOverrides(api),
    patchedAssets: new Set(),
    patchingEnabled: false,
    shortcutStateByWebContentsId: new Map(),
    startedAt: Date.now(),
    status: "initializing",
    webContentsEntries: new Map(),
    ...overrides,
  };
}

function stopMain(state) {
  if (globalThis[GLOBAL_STATE_KEY] === state) {
    delete globalThis[GLOBAL_STATE_KEY];
  }
  if (
    globalThis[PATCH_RENDERER_ASSET_KEY] === patchRendererAsset ||
    globalThis[PATCH_RENDERER_ASSET_KEY] === state.patchRendererAsset
  ) {
    delete globalThis[PATCH_RENDERER_ASSET_KEY];
  }

  for (const entry of state.webContentsEntries.values()) {
    restoreWebContents(entry);
  }
  state.webContentsEntries.clear();
  state.bridgeEventBuffers?.clear?.();
  state.bridgeAuditLog?.clear?.();
  state.bridgeApi = null;
  state.browserTabRegistry?.clear?.();
  state.browserThemeByOwnerWebContentsId?.clear?.();
  state.devToolsControlOwners.clear();
  state.devToolsSessionManager?.dispose?.();
  state.devToolsSessionManager = null;
  state.shortcutStateByWebContentsId.clear();

  for (const dispose of state.disposers.splice(0).reverse()) {
    try {
      dispose();
    } catch (error) {
      state.api.log.warn("dispose failed", stringifyError(error));
    }
  }
}

function installProtocolPatch(api, state) {
  const { protocol } = require("electron");
  const originalHandle = protocol.handle;

  protocol.handle = function betterBrowserProtocolHandle(scheme, handler) {
    if (scheme !== "app" || typeof handler !== "function") {
      return originalHandle.apply(this, arguments);
    }

    const wrappedHandler = async (request) => {
      const response = await handler(request);
      if (!shouldPatchRendererAsset(request?.url)) return response;

      let originalText = null;
      try {
        originalText = await response.text();
        const patcher = globalThis[PATCH_RENDERER_ASSET_KEY] ?? patchRendererAsset;
        const patchedText = patcher(request.url, originalText);
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.set("content-type", "text/javascript; charset=utf-8");

        const assetName = assetPatchKind(request.url);
        if (patchedText !== originalText && !state.patchedAssets.has(assetName)) {
          state.patchedAssets.add(assetName);
          logInfo(api, `patched renderer asset: ${assetName}`);
        }

        return new Response(patchedText, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        api.log.warn("failed to patch renderer asset; serving original", {
          url: request?.url,
          error: stringifyError(error),
        });
        if (originalText != null) {
          return new Response(originalText, responseInitFrom(response));
        }
        return response;
      }
    };

    return originalHandle.call(this, scheme, wrappedHandler);
  };

  state.disposers.push(() => {
    protocol.handle = originalHandle;
  });
}

function installIpcPatch(state) {
  const { ipcMain } = require("electron");
  const originalHandle = ipcMain.handle;
  const handlerDisposers = [];

  const wrapMessageFromViewListener = (listener) => {
    if (listener?.[PATCHED_IPC_HANDLER]) return listener;

    const wrapped = async function betterBrowserMessageFromView(event, message, ...args) {
      const routedMessage = routeBrowserDirectCommentAlias(state, event, message);
      observeRendererMessage(state, event, routedMessage);
      return listener.call(this, event, routedMessage, ...args);
    };

    Object.defineProperty(wrapped, PATCHED_IPC_HANDLER, {
      configurable: true,
      value: {
        original: listener,
      },
    });

    return wrapped;
  };

  ipcMain.handle = function betterBrowserIpcHandle(channel, listener) {
    if (channel !== MESSAGE_FROM_VIEW || typeof listener !== "function") {
      return originalHandle.apply(this, arguments);
    }

    return originalHandle.call(this, channel, wrapMessageFromViewListener(listener));
  };

  wrapExistingInvokeHandler(ipcMain, MESSAGE_FROM_VIEW, wrapMessageFromViewListener, handlerDisposers);

  state.disposers.push(() => {
    ipcMain.handle = originalHandle;
    for (const dispose of handlerDisposers.splice(0).reverse()) {
      dispose();
    }
  });
}

function wrapExistingInvokeHandler(ipcMain, channel, wrapListener, disposers) {
  const handlers = ipcMain?._invokeHandlers;
  if (!handlers || typeof handlers.get !== "function" || typeof handlers.set !== "function") return false;

  const existing = handlers.get(channel);
  if (typeof existing !== "function" || existing[PATCHED_IPC_HANDLER]) return false;

  const wrapped = wrapListener(existing);
  handlers.set(channel, wrapped);

  disposers.push(() => {
    if (handlers.get(channel) === wrapped) {
      handlers.set(channel, existing);
    }
  });

  return true;
}

function installDevToolsControlIpc(api, state) {
  const { ipcMain } = require("electron");
  const listener = (event, message) => {
    const entry = state.devToolsControlOwners.get(event.sender.id);
    if (!entry || !message || typeof message !== "object") return;
    handleInlineDevToolsControlMessage(api, state, entry, message);
  };

  ipcMain.on(DEVTOOLS_CONTROL_IPC, listener);
  state.disposers.push(() => ipcMain.off(DEVTOOLS_CONTROL_IPC, listener));
}

function installWebContentsPatch(api, state) {
  const { app, webContents } = require("electron");

  const patchOne = (_event, wc) => patchWebContents(api, state, wc);
  app.on("web-contents-created", patchOne);
  state.disposers.push(() => app.off("web-contents-created", patchOne));

  for (const wc of webContents.getAllWebContents()) {
    patchWebContents(api, state, wc);
  }
}

function installGlobalTabShortcuts(api, state) {
  const { app, BrowserWindow, globalShortcut } = require("electron");
  const registered = new Set();
  const warned = new Set();

  const register = () => {
    if (registered.size > 0) return;
    for (let ordinal = 1; ordinal <= 9; ordinal += 1) {
      const accelerator = `Control+${ordinal}`;
      try {
        const ok = globalShortcut.register(accelerator, () => {
          activateRightPanelTabFromFocusedContext(state, ordinal);
        });
        if (ok) {
          registered.add(accelerator);
        } else if (!warned.has(accelerator)) {
          warned.add(accelerator);
          api.log.warn("failed to register right-panel tab shortcut", { accelerator });
        }
      } catch (error) {
        if (!warned.has(accelerator)) {
          warned.add(accelerator);
          api.log.warn("failed to register right-panel tab shortcut", {
            accelerator,
            error: stringifyError(error),
          });
        }
      }
    }
  };

  const unregister = () => {
    for (const accelerator of registered) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        /* non-critical */
      }
    }
    registered.clear();
  };

  const hasFocusedCodexWindow = () => {
    return BrowserWindow.getAllWindows().some((window) => {
      if (window.isDestroyed() || !window.isFocused()) return false;
      return isAppShellContent(window.webContents);
    });
  };

  const registerIfFocused = () => {
    if (hasFocusedCodexWindow()) register();
  };

  const unregisterIfBlurred = () => {
    setTimeout(() => {
      if (!hasFocusedCodexWindow()) unregister();
    }, 50);
  };

  const attach = () => {
    registerIfFocused();
    app.on("browser-window-focus", registerIfFocused);
    app.on("browser-window-blur", unregisterIfBlurred);
  };

  if (app.isReady()) {
    attach();
  } else {
    app.once("ready", attach);
    state.disposers.push(() => app.off("ready", attach));
  }

  state.disposers.push(() => {
    app.off("browser-window-focus", registerIfFocused);
    app.off("browser-window-blur", unregisterIfBlurred);
    unregister();
  });
}

function activateRightPanelTabFromFocusedContext(state, ordinal) {
  const { BrowserWindow, webContents } = require("electron");
  const focusedContents = webContents.getFocusedWebContents?.();

  if (focusedContents && isLikelyBrowserContent(focusedContents)) {
    return switchRightPanelBrowserTabByOrdinal(focusedContents, ordinal);
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow || focusedWindow.isDestroyed() || !focusedWindow.isFocused()) return false;

  const ownerWebContents = focusedWindow.webContents;
  if (!ownerWebContents || ownerWebContents.isDestroyed?.() || !isAppShellContent(ownerWebContents)) {
    return false;
  }

  return switchFocusedRightPanelTabByOrdinal(state, ownerWebContents, ordinal);
}

function patchWebContents(api, state, wc) {
  if (!wc || wc.isDestroyed?.() || wc[PATCHED_WEB_CONTENTS]) return;

  const entry = {
    wc,
    browserTheme: null,
    browserThemeCssKey: null,
    browserThemeCssToken: null,
    browserThemeWarned: false,
    devToolsLayout: {
      dock: INLINE_DEVTOOLS_DEFAULT_DOCK,
      open: false,
      sizes: Object.create(null),
    },
    hadBrowserPageState: false,
    inlineDevTools: null,
    originalCloseDevTools: wc.closeDevTools,
    originalInspectElement: wc.inspectElement,
    originalOpenDevTools: wc.openDevTools,
    originalSend: wc.send,
    rendererPatchNames: BROWSER_RENDERER_PATCH_NAMES.slice(),
    listeners: [],
  };

  Object.defineProperty(wc, PATCHED_WEB_CONTENTS, {
    configurable: true,
    value: entry,
  });
  state.webContentsEntries.set(wc.id, entry);
  ensureBrowserTabRegistryEntry(state, wc, { entry, reason: "patch" });

  wc.openDevTools = function betterBrowserOpenDevTools(options = {}) {
    if (isLikelyBrowserContent(wc)) {
      if (openInlineDevTools(api, state, entry, options)) return undefined;
      return openFallbackDevTools(api, entry, options);
    }
    return entry.originalOpenDevTools.apply(this, arguments);
  };

  wc.closeDevTools = function betterBrowserCloseDevTools(...args) {
    if (isLikelyBrowserContent(wc)) {
      try {
        entry.devToolsLayout.open = false;
        return entry.originalCloseDevTools.apply(this, args);
      } finally {
        disposeInlineDevTools(entry, { closeDevTools: false });
      }
    }
    return entry.originalCloseDevTools.apply(this, args);
  };

  wc.inspectElement = function betterBrowserInspectElement(...args) {
    if (!isLikelyBrowserContent(wc)) {
      return entry.originalInspectElement.apply(this, args);
    }

    const openedInline = openInlineDevTools(api, state, entry, { activate: true });
    if (!openedInline) openFallbackDevTools(api, entry, { activate: true });

    const inspect = () => {
      if (wc.isDestroyed?.()) return;
      try {
        entry.originalInspectElement.apply(wc, args);
        revealDevTools(wc, 0);
        revealDevTools(wc, 250);
      } catch (error) {
        api.log.warn("failed to inspect browser element", stringifyError(error));
      }
    };

    setTimeout(inspect, wc.isDevToolsOpened?.() ? 0 : 100);
    return undefined;
  };

  wc.send = function betterBrowserSend(channel, message) {
    if (channel === MESSAGE_FOR_VIEW && message?.type === "browser-sidebar-comment-overlay-session") {
      const routed = mirrorBrowserCommentOverlaySessionToBaseConversation(state, wc, entry, message);
      if (routed) return undefined;
    }

    if (channel === MESSAGE_FOR_VIEW && message?.type === "browser-sidebar-direct-comment") {
      const baseConversationId = getBaseConversationIdForBrowserTab(message.conversationId);
      if (baseConversationId) {
        rememberBrowserDirectCommentAlias(
          state,
          wc.id,
          baseConversationId,
          message.conversationId,
          message.sessionId,
        );
        entry.originalSend.call(this, channel, message);
        entry.originalSend.call(this, channel, {
          ...message,
          conversationId: baseConversationId,
        });
        return undefined;
      }
    }

    if (
      channel === MESSAGE_FOR_VIEW &&
      message &&
      (message.type === "navigate-back" || message.type === "navigate-forward") &&
      goBrowserHistory(state, wc, message.type === "navigate-back" ? "back" : "forward")
    ) {
      return undefined;
    }
    return entry.originalSend.apply(this, arguments);
  };

  const beforeInput = (event, input) => {
    const tabOrdinal = getRightPanelTabShortcutOrdinal(input);
    if (
      tabOrdinal != null &&
      isLikelyBrowserContent(wc) &&
      switchRightPanelBrowserTabByOrdinal(wc, tabOrdinal)
    ) {
      event.preventDefault();
      return;
    }

    if (
      tabOrdinal != null &&
      isAppShellContent(wc) &&
      switchFocusedRightPanelTabByOrdinal(state, wc, tabOrdinal)
    ) {
      event.preventDefault();
      return;
    }

    if (isDevToolsShortcut(input)) {
      if (isLikelyBrowserContent(wc)) {
        event.preventDefault();
        toggleInlineDevToolsForEntry(state, entry);
        return;
      }

      if (isAppShellContent(wc) && toggleInlineDevToolsForOwnerWebContents(state, wc)) {
        event.preventDefault();
        return;
      }
    }

    if (!isBrowserHistoryShortcut(input)) return;

    if (isLikelyBrowserContent(wc)) {
      event.preventDefault();
      if (isBackInput(input)) {
        if (wc.canGoBack()) wc.goBack();
      } else if (wc.canGoForward()) {
        wc.goForward();
      }
      return;
    }

    if (
      isAppShellContent(wc) &&
      goBrowserHistoryForFocusedRightPanel(state, wc, isBackInput(input) ? "back" : "forward")
    ) {
      event.preventDefault();
    }
  };

  const injectGestures = () => {
    if (!isLikelyBrowserContent(wc) || !isInjectablePageUrl(wc.getURL())) return;
    wc.executeJavaScript(browserGestureInjectionScript(wc), true).catch((error) => {
      api.log.warn("failed to inject browser swipe gestures", stringifyError(error));
    });
  };

  const applyBrowserTheme = () => {
    applyBrowserThemeForEntry(api, entry);
  };

  const injectAppShellShortcuts = () => {
    if (!isAppShellContent(wc)) return;
    wc.executeJavaScript(APP_SHELL_RIGHT_TAB_SHORTCUT_SCRIPT, true).catch((error) => {
      api.log.warn("failed to inject right-panel tab shortcuts", stringifyError(error));
    });
    wc.executeJavaScript(APP_SHELL_DEVTOOLS_DOCK_MENU_SCRIPT, true).catch((error) => {
      api.log.warn("failed to inject DevTools dock menu", stringifyError(error));
    });
  };

  const destroyed = () => {
    restoreWebContents(entry);
    state.webContentsEntries.delete(wc.id);
    state.bridgeEventBuffers?.delete?.(wc.id);
    state.browserTabRegistry.delete(wc.id);
    state.browserThemeByOwnerWebContentsId.delete(wc.id);
    state.shortcutStateByWebContentsId.delete(wc.id);
  };

  const refreshBrowserTabHealth = (reason) => {
    refreshBrowserTabRegistryEntry(state, wc, { entry, reason });
  };
  const captureConsoleMessage = (_event, level, message, line, sourceId) => {
    if (!isLikelyBrowserContent(wc)) return;
    recordBridgeEvent(state, wc, "console", {
      level: normalizeConsoleLevel(level),
      line: Number.isFinite(Number(line)) ? Number(line) : null,
      message,
      source: sourceId,
    });
  };
  const captureRenderGone = (_event, details) => {
    if (!isLikelyBrowserContent(wc)) return;
    recordBridgeEvent(state, wc, "runtime", {
      reason: "render-process-gone",
      details,
    });
  };
  const captureLoadFailure = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isLikelyBrowserContent(wc)) return;
    recordBridgeEvent(state, wc, "network", {
      errorCode,
      errorText: errorDescription,
      failed: true,
      isMainFrame: !!isMainFrame,
      method: null,
      status: null,
      url: validatedURL,
    });
  };
  const captureNavigation = (_event, url, httpResponseCode, httpStatusText) => {
    if (!isLikelyBrowserContent(wc)) return;
    recordBridgeEvent(state, wc, "navigation", {
      httpResponseCode: Number.isFinite(Number(httpResponseCode)) ? Number(httpResponseCode) : null,
      httpStatusText,
      url,
    });
  };

  wc.on("before-input-event", beforeInput);
  wc.on("console-message", captureConsoleMessage);
  wc.on("dom-ready", injectAppShellShortcuts);
  wc.on("did-finish-load", injectAppShellShortcuts);
  wc.on("dom-ready", injectGestures);
  wc.on("did-navigate", injectGestures);
  wc.on("did-navigate-in-page", injectGestures);
  wc.on("did-finish-load", injectGestures);
  wc.on("did-stop-loading", injectGestures);
  wc.on("dom-ready", applyBrowserTheme);
  wc.on("did-navigate", applyBrowserTheme);
  wc.on("did-navigate-in-page", applyBrowserTheme);
  wc.on("did-finish-load", applyBrowserTheme);
  wc.on("did-stop-loading", applyBrowserTheme);
  wc.on("did-start-loading", refreshBrowserTabHealth);
  wc.on("did-stop-loading", refreshBrowserTabHealth);
  wc.on("did-fail-load", captureLoadFailure);
  wc.on("did-finish-load", refreshBrowserTabHealth);
  wc.on("did-navigate", captureNavigation);
  wc.on("did-navigate", refreshBrowserTabHealth);
  wc.on("did-navigate-in-page", captureNavigation);
  wc.on("did-navigate-in-page", refreshBrowserTabHealth);
  wc.on("page-title-updated", refreshBrowserTabHealth);
  wc.on("render-process-gone", captureRenderGone);
  wc.on("focus", refreshBrowserTabHealth);
  wc.on("blur", refreshBrowserTabHealth);
  wc.on("devtools-opened", refreshBrowserTabHealth);
  wc.on("devtools-closed", refreshBrowserTabHealth);
  wc.once("destroyed", destroyed);

  entry.listeners.push(["before-input-event", beforeInput]);
  entry.listeners.push(["console-message", captureConsoleMessage]);
  entry.listeners.push(["dom-ready", injectAppShellShortcuts]);
  entry.listeners.push(["did-finish-load", injectAppShellShortcuts]);
  entry.listeners.push(["dom-ready", injectGestures]);
  entry.listeners.push(["did-navigate", injectGestures]);
  entry.listeners.push(["did-navigate-in-page", injectGestures]);
  entry.listeners.push(["did-finish-load", injectGestures]);
  entry.listeners.push(["did-stop-loading", injectGestures]);
  entry.listeners.push(["dom-ready", applyBrowserTheme]);
  entry.listeners.push(["did-navigate", applyBrowserTheme]);
  entry.listeners.push(["did-navigate-in-page", applyBrowserTheme]);
  entry.listeners.push(["did-finish-load", applyBrowserTheme]);
  entry.listeners.push(["did-stop-loading", applyBrowserTheme]);
  entry.listeners.push(["did-start-loading", refreshBrowserTabHealth]);
  entry.listeners.push(["did-stop-loading", refreshBrowserTabHealth]);
  entry.listeners.push(["did-fail-load", captureLoadFailure]);
  entry.listeners.push(["did-finish-load", refreshBrowserTabHealth]);
  entry.listeners.push(["did-navigate", captureNavigation]);
  entry.listeners.push(["did-navigate", refreshBrowserTabHealth]);
  entry.listeners.push(["did-navigate-in-page", captureNavigation]);
  entry.listeners.push(["did-navigate-in-page", refreshBrowserTabHealth]);
  entry.listeners.push(["page-title-updated", refreshBrowserTabHealth]);
  entry.listeners.push(["render-process-gone", captureRenderGone]);
  entry.listeners.push(["focus", refreshBrowserTabHealth]);
  entry.listeners.push(["blur", refreshBrowserTabHealth]);
  entry.listeners.push(["devtools-opened", refreshBrowserTabHealth]);
  entry.listeners.push(["devtools-closed", refreshBrowserTabHealth]);
  entry.listeners.push(["destroyed", destroyed]);

  injectAppShellShortcuts();
  injectGestures();
  applyBrowserTheme();
  refreshBrowserTabHealth("initial");
}

function revealDevTools(wc, delayMs = 50) {
  const reveal = () => {
    if (!wc || wc.isDestroyed?.()) return;
    const devToolsWebContents = wc.devToolsWebContents;
    if (!devToolsWebContents || devToolsWebContents.isDestroyed?.()) return;

    try {
      devToolsWebContents.focus?.();
    } catch {
      /* non-critical */
    }

    try {
      const { BrowserWindow } = require("electron");
      const devToolsWindow = BrowserWindow.fromWebContents(devToolsWebContents);
      if (devToolsWindow && !devToolsWindow.isDestroyed()) {
        devToolsWindow.show();
        devToolsWindow.focus();
      }
    } catch {
      /* non-critical */
    }
  };

  if (delayMs > 0) {
    setTimeout(reveal, delayMs);
  } else {
    reveal();
  }
}

function openInlineDevTools(api, state, entry, options = {}) {
  const wc = entry.wc;
  if (!wc || wc.isDestroyed?.() || typeof wc.setDevToolsWebContents !== "function") return false;

  const ownerWindow = getBrowserOwnerWindow(wc);
  if (!ownerWindow || ownerWindow.isDestroyed()) return false;

  try {
    const { BrowserView } = require("electron");
    if (typeof BrowserView !== "function" || typeof ownerWindow.addBrowserView !== "function") {
      return false;
    }

    let inline = entry.inlineDevTools;
    if (
      !inline ||
      inline.disposed ||
      !inline.view ||
      inline.view.webContents?.isDestroyed?.() ||
      inline.ownerWindow !== ownerWindow
    ) {
      disposeInlineDevTools(entry, { closeDevTools: false, preserveOpenState: true });
      if (wc.isDevToolsOpened?.()) {
        try {
          entry.originalCloseDevTools.call(wc);
        } catch {
          /* non-critical */
        }
      }

      const devToolsView = new BrowserView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const handleView = createInlineDevToolsControlView(BrowserView);
      ownerWindow.addBrowserView(devToolsView);
      ownerWindow.addBrowserView(handleView);
      devToolsView.setAutoResize?.({ width: false, height: false });
      handleView.setAutoResize?.({ width: false, height: false });
      state.devToolsControlOwners.set(handleView.webContents.id, entry);

      inline = {
        controlWebContentsIds: [handleView.webContents.id],
        disposed: false,
        handleView,
        ignoreNextDevToolsClosed: false,
        listeners: [],
        ownerWindow,
        view: devToolsView,
      };
      entry.inlineDevTools = inline;
      loadInlineDevToolsControlViews(entry);

      const updateBounds = () => {
        positionInlineDevToolsViews(entry);
      };
      inline.boundsInterval = setInterval(updateBounds, INLINE_DEVTOOLS_BOUNDS_POLL_MS);
      inline.boundsInterval.unref?.();
      const devToolsClosed = () => {
        if (inline.ignoreNextDevToolsClosed) {
          inline.ignoreNextDevToolsClosed = false;
          return;
        }
        entry.devToolsLayout.open = false;
        disposeInlineDevTools(entry, { closeDevTools: false });
      };
      const viewDestroyed = () => {
        disposeInlineDevTools(entry, { closeDevTools: true });
      };
      const handleWebContentsId = handleView.webContents.id;
      const controlDestroyed = (controlWebContentsId) => {
        state.devToolsControlOwners.delete(controlWebContentsId);
      };
      const handleDestroyed = () => controlDestroyed(handleWebContentsId);
      const devToolsBeforeInput = (event, input) => {
        if (!isDevToolsShortcut(input)) return;
        event.preventDefault();
        toggleInlineDevToolsForEntry(state, entry);
      };

      ownerWindow.on("move", updateBounds);
      ownerWindow.on("resize", updateBounds);
      ownerWindow.on("enter-full-screen", updateBounds);
      ownerWindow.on("leave-full-screen", updateBounds);
      wc.on("devtools-closed", devToolsClosed);
      devToolsView.webContents.on("before-input-event", devToolsBeforeInput);
      devToolsView.webContents.once("destroyed", viewDestroyed);
      handleView.webContents.once("destroyed", handleDestroyed);

      inline.listeners.push([ownerWindow, "move", updateBounds]);
      inline.listeners.push([ownerWindow, "resize", updateBounds]);
      inline.listeners.push([ownerWindow, "enter-full-screen", updateBounds]);
      inline.listeners.push([ownerWindow, "leave-full-screen", updateBounds]);
      inline.listeners.push([wc, "devtools-closed", devToolsClosed]);
      inline.listeners.push([devToolsView.webContents, "before-input-event", devToolsBeforeInput]);
      inline.listeners.push([devToolsView.webContents, "destroyed", viewDestroyed]);
      inline.listeners.push([handleView.webContents, "destroyed", handleDestroyed]);
    }

    entry.devToolsLayout.open = true;
    positionInlineDevToolsViews(entry);

    if (wc.devToolsWebContents !== inline.view.webContents) {
      if (wc.isDevToolsOpened?.()) {
        try {
          inline.ignoreNextDevToolsClosed = true;
          entry.originalCloseDevTools.call(wc);
        } catch {
          /* non-critical */
        } finally {
          setTimeout(() => {
            if (entry.inlineDevTools === inline) inline.ignoreNextDevToolsClosed = false;
          }, 100);
        }
      }
      wc.setDevToolsWebContents(inline.view.webContents);
    }

    entry.originalOpenDevTools.call(wc, {
      ...options,
      mode: "detach",
      activate: options?.activate ?? true,
    });

    positionInlineDevToolsViews(entry);
    if (options?.activate !== false) {
      inline.view.webContents.focus?.();
    }
    revealDevTools(wc, 50);
    return true;
  } catch (error) {
    api.log.warn("failed to open managed inline devtools", stringifyError(error));
    disposeInlineDevTools(entry, { closeDevTools: true });
    return false;
  }
}

function openFallbackDevTools(api, entry, options = {}) {
  const wc = entry.wc;
  try {
    const result = entry.originalOpenDevTools.call(wc, {
      ...options,
      mode: options?.mode && options.mode !== "detach" ? options.mode : "right",
      activate: options?.activate ?? true,
    });
    revealDevTools(wc);
    return result;
  } catch (error) {
    api.log.warn("failed to open browser devtools", stringifyError(error));
    return undefined;
  }
}

function createInlineDevToolsControlView(BrowserView) {
  return new BrowserView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
}

function loadInlineDevToolsControlViews(entry) {
  const inline = entry.inlineDevTools;
  if (!inline || inline.disposed) return;
  loadInlineDevToolsControlView(entry, inline.handleView);
}

function loadInlineDevToolsControlView(entry, view) {
  if (!view?.webContents || view.webContents.isDestroyed?.()) return;
  const dock = getInlineDevToolsDock(entry);
  const html = inlineDevToolsHandleHtml(dock);
  view.webContents.loadURL(dataHtmlUrl(html)).catch(() => {
    /* non-critical */
  });
}

function dataHtmlUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function inlineDevToolsHandleHtml(dock) {
  const isBottom = dock === "bottom";
  const cursor = isBottom ? "row-resize" : "col-resize";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#a6abb2;cursor:${cursor};user-select:none}
body:hover{background:#b2b6bc}
body:active{background:#989ea6}
#knob{position:absolute;left:50%;top:50%;width:5px;height:5px;box-sizing:border-box;transform:translate(-50%,-50%);border-radius:999px;background:#59606a}
@media (prefers-color-scheme: dark){
html,body{background:#3f454d}
body:hover{background:#4b525b}
body:active{background:#343a42}
#knob{background:#20242a}
}
</style>
</head>
<body><div id="knob"></div>
<script>
const { ipcRenderer } = require("electron");
const channel = ${JSON.stringify(DEVTOOLS_CONTROL_IPC)};
let dragging = false;
window.addEventListener("pointerdown", event => {
  dragging = true;
  document.body.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
window.addEventListener("pointermove", event => {
  if (!dragging) return;
  ipcRenderer.send(channel, {
    type: "resize",
    deltaX: Number(event.movementX) || 0,
    deltaY: Number(event.movementY) || 0,
  });
  event.preventDefault();
});
window.addEventListener("pointerup", event => {
  dragging = false;
  document.body.releasePointerCapture?.(event.pointerId);
  event.preventDefault();
});
window.addEventListener("pointercancel", () => { dragging = false; });
</script>
</body>
</html>`;
}

function handleInlineDevToolsControlMessage(api, state, entry, message) {
  if (!entry.inlineDevTools || entry.inlineDevTools.disposed) return;

  if (message.type === "resize") {
    const deltaX = Number(message.deltaX) || 0;
    const deltaY = Number(message.deltaY) || 0;
    resizeInlineDevTools(entry, deltaX, deltaY);
  }
}

function disposeInlineDevTools(entry, options = {}) {
  const inline = entry.inlineDevTools;
  if (!inline || inline.disposed) return;
  inline.disposed = true;
  entry.inlineDevTools = null;
  if (!options.preserveOpenState) {
    entry.devToolsLayout.open = false;
  }

  const state = globalThis[GLOBAL_STATE_KEY];
  if (state?.devToolsControlOwners && Array.isArray(inline.controlWebContentsIds)) {
    for (const id of inline.controlWebContentsIds) {
      state.devToolsControlOwners.delete(id);
    }
  }

  for (const [target, eventName, listener] of inline.listeners) {
    try {
      target.off(eventName, listener);
    } catch {
      /* non-critical */
    }
  }
  inline.listeners.length = 0;
  if (inline.boundsInterval != null) {
    clearInterval(inline.boundsInterval);
    inline.boundsInterval = null;
  }

  const wc = entry.wc;
  if (options.closeDevTools && wc && !wc.isDestroyed?.()) {
    try {
      entry.originalCloseDevTools.call(wc);
    } catch {
      /* non-critical */
    }
  }

  for (const view of [inline.handleView, inline.view]) {
    if (!view) continue;
    if (inline.ownerWindow && !inline.ownerWindow.isDestroyed?.()) {
      try {
        inline.ownerWindow.removeBrowserView?.(view);
      } catch {
        /* non-critical */
      }
    }
    if (view.webContents && !view.webContents.isDestroyed?.()) {
      try {
        view.webContents.close({ waitForBeforeUnload: false });
      } catch {
        /* non-critical */
      }
    }
  }
}

function resizeInlineDevTools(entry, deltaX, deltaY) {
  const inline = entry.inlineDevTools;
  if (!inline || inline.disposed || !inline.ownerWindow || inline.ownerWindow.isDestroyed()) {
    return;
  }

  const { container, visible } = getInlineDevToolsLayoutContainer(entry.wc, inline.ownerWindow);
  if (!visible) return;
  const dock = getInlineDevToolsDock(entry);
  const currentSize = getInlineDevToolsSize(entry, dock, container);
  let nextSize = currentSize;

  if (dock === "left") {
    nextSize += deltaX;
  } else if (dock === "right") {
    nextSize -= deltaX;
  } else {
    nextSize -= deltaY;
  }

  entry.devToolsLayout.sizes[dock] = clampInlineDevToolsSize(dock, nextSize, container);
  positionInlineDevToolsViews(entry);
}

function positionInlineDevToolsViews(entry) {
  const inline = entry.inlineDevTools;
  if (
    !inline ||
    inline.disposed ||
    !inline.view ||
    inline.view.webContents?.isDestroyed?.() ||
    !inline.ownerWindow ||
    inline.ownerWindow.isDestroyed()
  ) {
    return;
  }

  if (entry.hadBrowserPageState && findBrowserPageForWebContentsId(entry.wc.id) == null) {
    entry.devToolsLayout.open = false;
    disposeInlineDevTools(entry, { closeDevTools: true });
    return;
  }

  const bounds = getInlineDevToolsViewBounds(entry, inline.ownerWindow);

  try {
    if (!bounds || entry.devToolsLayout.open !== true || !isInlineDevToolsActiveForOwner(entry)) {
      hideInlineDevToolsViews(inline);
      return;
    }

    const nextBoundsKey = inlineDevToolsBoundsKey(bounds);
    if (inline.lastBoundsKey !== nextBoundsKey) {
      inline.view.setBounds(bounds.devTools);
      inline.handleView?.setBounds(bounds.handle);
      inline.lastBoundsKey = nextBoundsKey;
      inline.viewsHidden = false;
    }
    inline.ownerWindow.setTopBrowserView?.(inline.handleView);
  } catch {
    /* non-critical */
  }
}

function hideInlineDevToolsViews(inline) {
  if (inline.viewsHidden) return;
  const hidden = { x: -10000, y: -10000, width: 1, height: 1 };
  try {
    inline.view?.setBounds(hidden);
    inline.handleView?.setBounds(hidden);
    inline.lastBoundsKey = "hidden";
    inline.viewsHidden = true;
  } catch {
    /* non-critical */
  }
}

function inlineDevToolsBoundsKey(bounds) {
  const devTools = bounds?.devTools;
  const handle = bounds?.handle;
  return [
    devTools?.x,
    devTools?.y,
    devTools?.width,
    devTools?.height,
    handle?.x,
    handle?.y,
    handle?.width,
    handle?.height,
  ].join(":");
}

function isInlineDevToolsActiveForOwner(entry) {
  const state = globalThis[GLOBAL_STATE_KEY];
  const pageState = findBrowserPageForWebContentsId(entry.wc.id);
  const ownerWebContents =
    pageState?.windowState?.owner ??
    pageState?.ownerWebContents ??
    pageState?.owner ??
    null;
  if (!state || !ownerWebContents || ownerWebContents.isDestroyed?.()) return true;

  const conversationId = getPageStateConversationId(pageState);
  if (typeof conversationId !== "string" || conversationId.length === 0) return true;

  const shortcutState = getShortcutState(state, ownerWebContents);
  if (!shortcutState) return true;
  const activeConversationId = shortcutState.rightPanelBrowserConversationId;
  if (typeof activeConversationId !== "string" || activeConversationId.length === 0) {
    return shortcutState.rightPanelCanCloseActiveTab === true && getBrowserPageContentBounds(entry.wc) != null;
  }
  return activeConversationId === conversationId;
}

function getInlineDevToolsViewBounds(entry, ownerWindow) {
  const { container, visible } = getInlineDevToolsLayoutContainer(entry.wc, ownerWindow);
  if (!visible) return null;
  const dock = getInlineDevToolsDock(entry);
  const size = getInlineDevToolsSize(entry, dock, container);
  const handleSize = INLINE_DEVTOOLS_HANDLE_SIZE;
  let devTools;
  let handle;

  if (dock === "left") {
    devTools = {
      x: Math.round(container.x),
      y: Math.round(container.y),
      width: Math.round(size),
      height: Math.round(container.height),
    };
    handle = {
      x: Math.round(container.x + size),
      y: Math.round(container.y),
      width: handleSize,
      height: Math.round(container.height),
    };
  } else if (dock === "bottom") {
    devTools = {
      x: Math.round(container.x),
      y: Math.round(container.y + container.height - size),
      width: Math.round(container.width),
      height: Math.round(size),
    };
    handle = {
      x: Math.round(container.x),
      y: Math.round(devTools.y - handleSize),
      width: Math.round(container.width),
      height: handleSize,
    };
  } else {
    devTools = {
      x: Math.round(container.x + container.width - size),
      y: Math.round(container.y),
      width: Math.round(size),
      height: Math.round(container.height),
    };
    handle = {
      x: Math.round(devTools.x - handleSize),
      y: Math.round(container.y),
      width: handleSize,
      height: Math.round(container.height),
    };
  }

  return {
    devTools: clampRectToBounds(devTools, container),
    handle: clampRectToBounds(handle, container),
  };
}

function getInlineDevToolsLayoutContainer(wc, ownerWindow) {
  const contentBounds = ownerWindow.getContentBounds();
  const pageBounds = getBrowserPageContentBounds(wc);
  const entry = wc?.[PATCHED_WEB_CONTENTS] ?? null;
  const hasPageState = findBrowserPageForWebContentsId(wc.id) != null;
  if ((hasPageState || entry?.hadBrowserPageState === true) && !pageBounds) {
    return {
      container: { x: 0, y: 0, width: 0, height: 0 },
      contentBounds,
      visible: false,
    };
  }
  const rawContainer = pageBounds
    ? rectToContentBounds(pageBounds, contentBounds)
    : {
        x: 0,
        y: 0,
        width: contentBounds.width,
        height: contentBounds.height,
      };

  const container = clampRectToBounds(rawContainer, {
    x: 0,
    y: 0,
    width: contentBounds.width,
    height: contentBounds.height,
  });

  const visible = container.width >= 260 && container.height >= 180;

  return { container, contentBounds, visible };
}

function getInlineDevToolsDock(entry) {
  const dock = entry.devToolsLayout?.dock;
  return INLINE_DEVTOOLS_DOCKS.has(dock) ? dock : INLINE_DEVTOOLS_DEFAULT_DOCK;
}

function getInlineDevToolsSize(entry, dock, container) {
  const saved = Number(entry.devToolsLayout?.sizes?.[dock]);
  if (Number.isFinite(saved) && saved > 0) {
    return clampInlineDevToolsSize(dock, saved, container);
  }

  const desired =
    dock === "bottom"
      ? Math.round(container.height * INLINE_DEVTOOLS_HEIGHT_RATIO)
      : Math.round(container.width * INLINE_DEVTOOLS_WIDTH_RATIO);
  return clampInlineDevToolsSize(dock, desired, container);
}

function clampInlineDevToolsSize(dock, size, container) {
  const dimension = dock === "bottom" ? container.height : container.width;
  const min = dock === "bottom" ? INLINE_DEVTOOLS_MIN_HEIGHT : INLINE_DEVTOOLS_MIN_WIDTH;
  const configuredMax = dock === "bottom" ? INLINE_DEVTOOLS_MAX_HEIGHT : INLINE_DEVTOOLS_MAX_WIDTH;
  const max = Math.max(80, Math.min(configuredMax, dimension - INLINE_DEVTOOLS_HANDLE_SIZE));
  const minForContainer = Math.min(min, max);
  return Math.max(minForContainer, Math.min(max, Math.round(size)));
}

function getBrowserPageContentBounds(wc) {
  const pageState = findBrowserPageForWebContentsId(wc.id);
  if (pageState && wc?.[PATCHED_WEB_CONTENTS]) {
    wc[PATCHED_WEB_CONTENTS].hadBrowserPageState = true;
  }
  const candidates = [
    pageState?.threadState?.bounds,
    pageState?.thread?.bounds,
    pageState?.page?.bounds,
    pageState?.browserBounds,
    pageState?.bounds,
  ];

  for (const candidate of candidates) {
    const rect = normalizeRect(candidate);
    if (rect && rect.width >= 320 && rect.height >= 240) return rect;
  }

  return null;
}

function getBrowserOwnerWebContents(entry) {
  const pageState = findBrowserPageForWebContentsId(entry?.wc?.id);
  const ownerWebContents =
    pageState?.windowState?.owner ??
    pageState?.ownerWebContents ??
    pageState?.owner ??
    null;
  return ownerWebContents && !ownerWebContents.isDestroyed?.() ? ownerWebContents : null;
}

function getBrowserOwnerWindow(wc) {
  let BrowserWindow;
  try {
    ({ BrowserWindow } = require("electron"));
  } catch {
    return null;
  }
  if (!BrowserWindow || typeof BrowserWindow.fromWebContents !== "function") return null;

  const directWindow = BrowserWindow.fromWebContents(wc);
  if (directWindow && !directWindow.isDestroyed()) return directWindow;

  const pageState = findBrowserPageForWebContentsId(wc.id);
  const stateWindow = pageState?.windowState?.window ?? pageState?.window;
  if (stateWindow && typeof stateWindow.isDestroyed === "function" && !stateWindow.isDestroyed()) {
    return stateWindow;
  }

  const ownerContents =
    pageState?.windowState?.owner ??
    pageState?.ownerWebContents ??
    pageState?.owner ??
    null;
  const ownerWindow =
    ownerContents && !ownerContents.isDestroyed?.()
      ? BrowserWindow.fromWebContents(ownerContents)
      : null;
  if (ownerWindow && !ownerWindow.isDestroyed()) return ownerWindow;

  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed() && isAppShellContent(focusedWindow.webContents)) {
    return focusedWindow;
  }

  return null;
}

function getOwnerWindowForWebContents(wc) {
  if (!wc || wc.isDestroyed?.()) return null;
  try {
    const { BrowserWindow } = require("electron");
    const window = BrowserWindow.fromWebContents(wc);
    return window && !window.isDestroyed() ? window : null;
  } catch {
    return null;
  }
}

function getBrowserTheme(entry) {
  if (BROWSER_THEMES.has(entry?.browserTheme)) return entry.browserTheme;
  const state = globalThis[GLOBAL_STATE_KEY];
  const owner = getBrowserOwnerWebContents(entry);
  const ownerTheme = owner ? state?.browserThemeByOwnerWebContentsId?.get(owner.id) : null;
  return BROWSER_THEMES.has(ownerTheme) ? ownerTheme : getDefaultBrowserTheme();
}

function getDefaultBrowserTheme() {
  try {
    const { nativeTheme } = require("electron");
    return nativeTheme?.shouldUseDarkColors ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyBrowserThemeForEntry(api, entry) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.() || !isLikelyBrowserContent(wc)) return false;
  const url = wc.getURL?.() ?? "";
  if (!isInjectablePageUrl(url)) return false;

  const theme = getBrowserTheme(entry);
  let applied = applyBrowserThemeViaCdp(api, entry, theme);
  applied = applyBrowserThemeFallback(api, entry, theme) || applied;
  return applied;
}

function applyBrowserThemeViaCdp(api, entry, theme) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.()) return false;

  const state = globalThis[GLOBAL_STATE_KEY];
  const manager = state?.devToolsSessionManager;
  if (!manager) return false;

  const ok = manager.sendCommand(
    wc,
    "Emulation.setEmulatedMedia",
    {
      features: [{ name: "prefers-color-scheme", value: theme }],
    },
    {
      reason: "browser-theme",
      warn: (error) => warnBrowserThemeOnce(api, entry, "failed to set browser theme media emulation", error),
    },
  );

  if (ok) refreshBrowserTabRegistryEntry(state, wc, { entry, reason: "browser-theme" });
  return ok;
}

function applyBrowserThemeFallback(api, entry, theme) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.()) return false;

  try {
    const script = browserThemeFallbackScript(theme);
    wc.executeJavaScript(script, true).catch(() => {
      /* non-critical */
    });
  } catch {
    /* non-critical */
  }

  if (typeof wc.insertCSS !== "function") return true;

  try {
    const previousKey = entry.browserThemeCssKey;
    const token = {};
    entry.browserThemeCssToken = token;
    entry.browserThemeCssKey = null;

    if (previousKey && typeof wc.removeInsertedCSS === "function") {
      wc.removeInsertedCSS(previousKey).catch(() => {
        /* non-critical */
      });
    }

    const css = `:root,html,body{color-scheme:${theme}!important;}`;
    Promise.resolve(wc.insertCSS(css, { cssOrigin: "user" }))
      .then((key) => {
        if (entry.browserThemeCssToken === token) {
          entry.browserThemeCssKey = key;
        } else if (key && typeof wc.removeInsertedCSS === "function" && !wc.isDestroyed?.()) {
          wc.removeInsertedCSS(key).catch(() => {
            /* non-critical */
          });
        }
      })
      .catch(() => {
        /* non-critical */
      });
  } catch {
    /* non-critical */
  }

  return true;
}

function browserThemeFallbackScript(theme) {
  return `(() => {
    const theme = ${JSON.stringify(theme)};
    try {
      const root = document.documentElement;
      if (!root) return;
      root.style.colorScheme = theme;
      if (document.body) document.body.style.colorScheme = theme;

      let meta = document.querySelector('meta[name="color-scheme"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "color-scheme");
        document.head?.appendChild(meta);
      }
      meta.setAttribute("content", theme);

      const setThemeAttribute = (name) => {
        if (root.hasAttribute(name)) root.setAttribute(name, theme);
      };
      setThemeAttribute("data-color-mode");
      setThemeAttribute("data-theme");
      setThemeAttribute("data-bs-theme");
      setThemeAttribute("theme");

      if (root.classList.contains("dark") || root.classList.contains("light")) {
        root.classList.toggle("dark", theme === "dark");
        root.classList.toggle("light", theme === "light");
      }
    } catch {
    }
  })();`;
}

function clearBrowserThemeForEntry(entry) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.()) return;

  entry.browserThemeCssToken = {};
  if (entry.browserThemeCssKey && typeof wc.removeInsertedCSS === "function") {
    wc.removeInsertedCSS(entry.browserThemeCssKey).catch(() => {
      /* non-critical */
    });
    entry.browserThemeCssKey = null;
  }

  const state = globalThis[GLOBAL_STATE_KEY];
  const manager = state?.devToolsSessionManager;
  if (!manager) return;

  manager.resetEmulatedMedia(wc, {
    reason: "browser-theme-clear",
    warn: (error) =>
      warnBrowserThemeOnce(
        state?.api ?? { log: { warn() {} } },
        entry,
        "failed to clear browser theme media emulation",
        error,
      ),
  });
}

function warnBrowserThemeOnce(api, entry, message, error) {
  if (!entry || entry.browserThemeWarned) return;
  entry.browserThemeWarned = true;
  api.log.warn(message, stringifyError(error));
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = Number(rect.x ?? rect.left);
  const y = Number(rect.y ?? rect.top);
  const width = Number(rect.width ?? (Number(rect.right) - x));
  const height = Number(rect.height ?? (Number(rect.bottom) - y));
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function rectToContentBounds(rect, contentBounds) {
  const isAlreadyContentRelative =
    rect.x >= -8 &&
    rect.y >= -8 &&
    rect.x + rect.width <= contentBounds.width + 8 &&
    rect.y + rect.height <= contentBounds.height + 8;

  if (isAlreadyContentRelative) {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  const isScreenRelative =
    rect.x >= contentBounds.x - 8 &&
    rect.y >= contentBounds.y - 8 &&
    rect.x + rect.width <= contentBounds.x + contentBounds.width + 8 &&
    rect.y + rect.height <= contentBounds.y + contentBounds.height + 8;

  if (isScreenRelative) {
    return {
      x: rect.x - contentBounds.x,
      y: rect.y - contentBounds.y,
      width: rect.width,
      height: rect.height,
    };
  }

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function clampRectToBounds(rect, bounds) {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - width)),
    y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - height)),
    width,
    height,
  };
}

function createDevToolsSessionManager(api, state) {
  const sessions = new Map();

  const getDebugger = (wc) => {
    if (!wc || wc.isDestroyed?.()) return null;
    try {
      return wc.debugger ?? null;
    } catch {
      return null;
    }
  };

  const ensureSession = (wc) => {
    if (!wc || wc.isDestroyed?.()) return null;

    let session = sessions.get(wc.id);
    if (!session) {
      session = {
        attached: false,
        attachedAt: null,
        attachedReason: null,
        detachListener: null,
        eventListener: null,
        evidenceEnabled: false,
        lastAttachAt: null,
        lastCommand: null,
        lastCommandAt: null,
        lastDetachAt: null,
        lastError: null,
        status: "unavailable",
        webContents: wc,
        webContentsId: wc.id,
      };
      sessions.set(wc.id, session);
    }

    session.webContentsId = wc.id;
    session.webContents = wc;
    return session;
  };

  const refreshRegistry = (wc, reason = "devtools-session") => {
    refreshBrowserTabRegistryEntry(state, wc, { reason });
  };

  const attachWebContents = (wc, reason = "command") => {
    const session = ensureSession(wc);
    if (!session) return null;

    const dbg = getDebugger(wc);
    if (!dbg || typeof dbg.attach !== "function" || typeof dbg.sendCommand !== "function") {
      session.status = "unavailable";
      refreshRegistry(wc, `devtools-${reason}-unavailable`);
      return null;
    }

    try {
      if (typeof dbg.isAttached === "function" && dbg.isAttached()) {
        session.attached = true;
        session.status = "attached";
      } else {
        dbg.attach("1.3");
        session.attached = true;
        session.lastAttachAt = Date.now();
        session.status = "attached";
      }

      session.attachedReason = reason;
      session.lastError = null;
      if (!session.detachListener && typeof dbg.on === "function") {
        session.detachListener = (_event, detachReason) => {
          session.attached = false;
          session.status = detachReason === "target_closed" ? "closed" : "detached";
          session.lastDetachAt = Date.now();
          session.lastError = null;
          refreshRegistry(wc, `devtools-detach-${detachReason ?? "unknown"}`);
        };
        dbg.on("detach", session.detachListener);
      }
      if (!session.eventListener && typeof dbg.on === "function") {
        session.eventListener = (_event, method, params) => {
          recordDevToolsProtocolEvent(state, wc, method, params);
        };
        dbg.on("message", session.eventListener);
      }
      refreshRegistry(wc, `devtools-${reason}-attached`);
      return session;
    } catch (error) {
      session.attached = false;
      session.status = "error";
      session.lastError = stringifyError(error);
      refreshRegistry(wc, `devtools-${reason}-attach-error`);
      return null;
    }
  };

  const detachWebContents = (wc, reason = "dispose", options = {}) => {
    const session = sessions.get(wc?.id);
    if (!session) return false;

    const dbg = getDebugger(wc);
    if (dbg && session.eventListener && typeof dbg.off === "function") {
      try {
        dbg.off("message", session.eventListener);
      } catch {
        /* non-critical */
      }
    }
    if (dbg && session.detachListener && typeof dbg.off === "function") {
      try {
        dbg.off("detach", session.detachListener);
      } catch {
        /* non-critical */
      }
    }
    session.eventListener = null;
    session.detachListener = null;
    session.evidenceEnabled = false;

    if (dbg && typeof dbg.detach === "function") {
      try {
        if (typeof dbg.isAttached !== "function" || dbg.isAttached()) {
          dbg.detach();
        }
      } catch {
        /* non-critical */
      }
    }

    session.attached = false;
    session.status = reason === "target_closed" ? "closed" : "detached";
    session.lastDetachAt = Date.now();
    session.attachedReason = null;
    if (!options.quiet) refreshRegistry(wc, `devtools-${reason}-detached`);
    return true;
  };

  const sendCommand = (wc, method, params, options = {}) => {
    const session = attachWebContents(wc, options.reason ?? method);
    if (!session) {
      if (typeof options.warn === "function") {
        options.warn(new Error(`unable to attach debugger for ${method}`));
      }
      return false;
    }

    const dbg = getDebugger(wc);
    if (!dbg || typeof dbg.sendCommand !== "function") {
      session.status = "unavailable";
      session.lastError = "debugger unavailable";
      refreshRegistry(wc, `devtools-${method}-unavailable`);
      if (typeof options.warn === "function") {
        options.warn(new Error(`debugger unavailable for ${method}`));
      }
      if (options.detachAfter) detachWebContents(wc, options.detachReason ?? options.reason ?? method);
      return false;
    }

    session.lastCommand = method;
    session.lastCommandAt = Date.now();

    let result;
    try {
      result = dbg.sendCommand(method, params);
    } catch (error) {
      session.status = "error";
      session.lastError = stringifyError(error);
      refreshRegistry(wc, `devtools-${method}-send-error`);
      if (typeof options.warn === "function") options.warn(error);
      if (options.detachAfter) detachWebContents(wc, options.detachReason ?? options.reason ?? method);
      return false;
    }

    session.status = "attached";
    session.lastError = null;
    refreshRegistry(wc, `devtools-${method}-sent`);

    const trackedResult = Promise.resolve(result)
      .then(() => {
        if (sessions.get(wc?.id) !== session) return;
        session.lastError = null;
        session.status = session.attached ? "attached" : "available";
        refreshRegistry(wc, `devtools-${method}-resolved`);
        return result;
      })
      .catch((error) => {
        if (sessions.get(wc?.id) !== session) return;
        session.status = "error";
        session.lastError = stringifyError(error);
        refreshRegistry(wc, `devtools-${method}-failed`);
        if (typeof options.warn === "function") options.warn(error);
        return false;
      })
      .finally(() => {
        if (options.detachAfter) {
          detachWebContents(wc, options.detachReason ?? options.reason ?? method);
        }
      });

    return trackedResult;
  };

  const executeCommand = async (wc, method, params, options = {}) => {
    const session = attachWebContents(wc, options.reason ?? method);
    if (!session) {
      const error = new Error(`unable to attach debugger for ${method}`);
      if (typeof options.warn === "function") options.warn(error);
      return {
        ok: false,
        error: stringifyError(error),
        status: "unavailable",
      };
    }

    const dbg = getDebugger(wc);
    if (!dbg || typeof dbg.sendCommand !== "function") {
      session.status = "unavailable";
      session.lastError = "debugger unavailable";
      refreshRegistry(wc, `devtools-${method}-unavailable`);
      if (options.detachAfter) detachWebContents(wc, options.detachReason ?? options.reason ?? method);
      return {
        ok: false,
        error: "debugger unavailable",
        status: "unavailable",
      };
    }

    session.lastCommand = method;
    session.lastCommandAt = Date.now();

    try {
      const value = await Promise.resolve(dbg.sendCommand(method, params));
      session.status = "attached";
      session.lastError = null;
      refreshRegistry(wc, `devtools-${method}-resolved`);
      return {
        ok: true,
        status: session.status,
        value,
      };
    } catch (error) {
      session.status = "error";
      session.lastError = stringifyError(error);
      refreshRegistry(wc, `devtools-${method}-failed`);
      if (typeof options.warn === "function") options.warn(error);
      return {
        ok: false,
        error: stringifyError(error),
        status: "error",
      };
    } finally {
      if (options.detachAfter) {
        detachWebContents(wc, options.detachReason ?? options.reason ?? method);
      }
    }
  };

  const enableEvidenceCollection = async (wc, options = {}) => {
    const session = attachWebContents(wc, options.reason ?? "bridge-evidence");
    if (!session) {
      return {
        ok: false,
        error: "debugger unavailable",
        status: "unavailable",
      };
    }
    if (session.evidenceEnabled) {
      return { ok: true, status: session.status };
    }

    const methods = ["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"];
    const failures = [];
    for (const method of methods) {
      const result = await executeCommand(wc, method, {}, { reason: options.reason ?? "bridge-evidence" });
      if (!result.ok) failures.push({ method, error: result.error });
    }
    session.evidenceEnabled = failures.length === 0;
    refreshRegistry(wc, failures.length === 0 ? "devtools-evidence-enabled" : "devtools-evidence-degraded");
    return {
      ok: failures.length === 0,
      failures,
      status: failures.length === 0 ? "attached" : "degraded",
    };
  };

  const resetEmulatedMedia = (wc, options = {}) => {
    const ok = sendCommand(
      wc,
      "Emulation.setEmulatedMedia",
      { features: [] },
      {
        ...options,
        detachAfter: options.detachAfter === true,
        detachReason: options.detachReason ?? options.reason ?? "browser-theme-clear",
      },
    );
    if (!ok && options.detachAfter === true) {
      detachWebContents(wc, options.detachReason ?? options.reason ?? "browser-theme-clear");
    }
    return ok;
  };

  const forgetWebContents = (wc, reason = "dispose", options = {}) => {
    if (!wc) return false;
    detachWebContents(wc, reason, options);
    sessions.delete(wc.id);
    state.browserTabRegistry.delete(wc.id);
    return true;
  };

  const getSnapshot = (wcOrId) => {
    const webContentsId = Number(typeof wcOrId === "object" ? wcOrId?.id : wcOrId);
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) return null;
    const session = sessions.get(webContentsId);
    if (!session) return null;
    return {
      ...session,
      attached: !!session.attached,
      lastError: session.lastError ?? null,
      status: session.status ?? "unavailable",
    };
  };

  const listSnapshots = () => {
    return [...sessions.values()].map((session) => ({
      ...session,
      attached: !!session.attached,
      lastError: session.lastError ?? null,
      status: session.status ?? "unavailable",
    }));
  };

  const dispose = () => {
    for (const session of [...sessions.values()]) {
      if (session?.webContents) {
        forgetWebContents(session.webContents, "dispose", { quiet: true });
      } else {
        sessions.delete(session.webContentsId);
        state.browserTabRegistry.delete(session.webContentsId);
      }
    }
    sessions.clear();
  };

  return {
    api,
    attachWebContents,
    detachWebContents,
    dispose,
    forgetWebContents,
    getSnapshot,
    enableEvidenceCollection,
    executeCommand,
    listSnapshots,
    resetEmulatedMedia,
    sendCommand,
  };
}

function ensureBrowserTabRegistryEntry(state, wc, options = {}) {
  if (!state || !wc || wc.isDestroyed?.()) return null;
  const existing = state.browserTabRegistry.get(wc.id) ?? null;
  if (existing) return refreshBrowserTabRegistryEntry(state, wc, options);

  const record = {
    activeish: false,
    cdpAttached: false,
    cdpAvailable: false,
    cdpStatus: "unavailable",
    devToolsOpen: false,
    isAppShellContent: false,
    isFocused: false,
    isVisible: false,
    lastUpdatedAt: Date.now(),
    loading: false,
    ownerWebContentsId: null,
    rendererPatchNames: BROWSER_RENDERER_PATCH_NAMES.slice(),
    title: "",
    url: "",
    webContentsId: wc.id,
  };
  state.browserTabRegistry.set(wc.id, record);
  return refreshBrowserTabRegistryEntry(state, wc, { ...options, record });
}

function refreshBrowserTabRegistryEntry(state, wc, options = {}) {
  if (!state || !wc || wc.isDestroyed?.()) return null;

  const manager = state.devToolsSessionManager ?? null;
  const record = options.record ?? state.browserTabRegistry.get(wc.id) ?? {
    webContentsId: wc.id,
    rendererPatchNames: BROWSER_RENDERER_PATCH_NAMES.slice(),
  };
  const ownerWindow = getBrowserOwnerWindow(wc);
  const ownerWebContents = getBrowserOwnerWebContents({ wc });
  const session = manager?.getSnapshot?.(wc) ?? null;

  record.webContentsId = wc.id;
  record.url = wc.getURL?.() ?? "";
  record.title = wc.getTitle?.() ?? "";
  record.isAppShellContent = isAppShellContent(wc);
  record.isFocused = typeof wc.isFocused === "function" ? !!wc.isFocused() : false;
  record.isVisible = typeof ownerWindow?.isVisible === "function" ? !!ownerWindow.isVisible() : false;
  record.devToolsOpen = typeof wc.isDevToolsOpened === "function" ? !!wc.isDevToolsOpened() : false;
  record.loading = typeof wc.isLoading === "function" ? !!wc.isLoading() : false;
  record.activeish = !!(record.isFocused || record.isVisible || record.devToolsOpen);
  record.ownerWebContentsId = ownerWebContents?.id ?? null;
  record.rendererPatchNames = Array.isArray(record.rendererPatchNames)
    ? record.rendererPatchNames.slice()
    : BROWSER_RENDERER_PATCH_NAMES.slice();
  record.cdpAttached = !!session?.attached;
  record.cdpAvailable = !!session && session.status !== "unavailable";
  record.cdpStatus = session?.status ?? "unavailable";
  record.cdpLastCommand = session?.lastCommand ?? null;
  record.cdpLastCommandAt = session?.lastCommandAt ?? null;
  record.cdpLastError = session?.lastError ?? null;
  record.lastUpdatedAt = Date.now();
  record.reason = typeof options.reason === "string" ? options.reason : null;
  state.browserTabRegistry.set(wc.id, record);
  return record;
}

function getBrowserTabHealthSnapshot(state, wcOrId) {
  if (!state) return null;
  const webContentsId = Number(typeof wcOrId === "object" ? wcOrId?.id : wcOrId);
  if (!Number.isInteger(webContentsId) || webContentsId <= 0) return null;
  const record = state.browserTabRegistry.get(webContentsId);
  if (!record) return null;
  return { ...record, rendererPatchNames: [...(record.rendererPatchNames ?? [])] };
}

function listBrowserTabHealthSnapshots(state) {
  if (!state) return [];
  return [...state.browserTabRegistry.values()].map((record) => ({
    ...record,
    rendererPatchNames: [...(record.rendererPatchNames ?? [])],
  }));
}

function createBetterBrowserBridgeApi(state) {
  if (!state.bridgeAuditLog) state.bridgeAuditLog = createRingBuffer(BRIDGE_BUFFER_LIMITS.bridgeCalls);
  if (!state.bridgeEventBuffers) state.bridgeEventBuffers = createBridgeEventBuffers();
  if (!state.webContentsEntries) state.webContentsEntries = new Map();

  const call = (toolName, options, fn) => {
    if (state.bridgeEnabled === false) {
      return {
        ok: false,
        code: "bridge-disabled",
        error: { code: "bridge-disabled", message: "Better Browser Agent bridge is disabled." },
      };
    }
    const startedAt = Date.now();
    const audit = {
      status: "started",
      tabId: normalizeWebContentsId(options?.webContentsId ?? options?.tabId),
      timestamp: startedAt,
      toolName,
    };
    pushRingBuffer(state.bridgeAuditLog, audit);
    recordBridgeCall(state, audit.tabId, {
      status: "started",
      toolName,
    });

    try {
      const finalize = (result) => {
        audit.status = result?.ok === false ? "degraded" : "ok";
        audit.durationMs = Date.now() - startedAt;
        audit.resultCounts = resultCountsForAudit(result);
        recordBridgeCall(state, audit.tabId ?? result?.tab?.webContentsId, {
          durationMs: audit.durationMs,
          resultCounts: audit.resultCounts,
          status: audit.status,
          toolName,
        });
        return truncateBridgeValue(redactBridgeValue(result));
      };
      const result = fn();
      if (result && typeof result.then === "function") {
        return result.then(finalize).catch((error) => {
          audit.status = "error";
          audit.durationMs = Date.now() - startedAt;
          audit.error = sanitizeBridgeError(error);
          recordBridgeCall(state, audit.tabId, {
            durationMs: audit.durationMs,
            error: audit.error,
            status: "error",
            toolName,
          });
          return unavailableBridgeResult("bridge-call-failed", audit.error, { toolName });
        });
      }
      return finalize(result);
    } catch (error) {
      audit.status = "error";
      audit.durationMs = Date.now() - startedAt;
      audit.error = sanitizeBridgeError(error);
      recordBridgeCall(state, audit.tabId, {
        durationMs: audit.durationMs,
        error: audit.error,
        status: "error",
        toolName,
      });
      return unavailableBridgeResult("bridge-call-failed", audit.error, { toolName });
    }
  };

  const api = {
    listBrowserTabs(options = {}) {
      return call("listBrowserTabs", options, () => ({
        ok: true,
        bridgeStatus: getBridgeStatus(state),
        tabs: listBridgeBrowserTabs(state),
      }));
    },

    getActiveBrowserTab(options = {}) {
      return call("getActiveBrowserTab", options, () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) {
          return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.", {
            bridgeStatus: getBridgeStatus(state),
            selectionReason: selected.reason,
          });
        }
        return {
          ok: true,
          bridgeStatus: getBridgeStatus(state),
          selectionReason: selected.reason,
          tab: getBridgeTabMetadata(state, selected.entry),
        };
      });
    },

    getConsoleMessages(options = {}) {
      return call("getConsoleMessages", options, async () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.");
        await ensureBridgeEvidenceCollection(state, selected.entry.wc, "bridge-console");
        const buffer = getBridgeBufferForWebContents(state, selected.entry.wc.id, false);
        const messages = getRingBufferItems(buffer?.console).slice(-(options.limit ?? BRIDGE_BUFFER_LIMITS.console));
        return {
          ok: true,
          bufferingStartedAt: buffer?.createdAt ?? null,
          note: "Console history starts when Better Browser Agent observes the tab; earlier page events may be absent.",
          tab: getBridgeTabMetadata(state, selected.entry),
          messages,
          summary: summarizeConsoleMessages(messages),
        };
      });
    },

    getNetworkFailures(options = {}) {
      return call("getNetworkFailures", options, async () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.");
        await ensureBridgeEvidenceCollection(state, selected.entry.wc, "bridge-network");
        const buffer = getBridgeBufferForWebContents(state, selected.entry.wc.id, false);
        const entries = getRingBufferItems(buffer?.network);
        const failures = entries
          .filter((entry) => entry.failed || (Number.isInteger(entry.status) && (entry.status < 200 || entry.status >= 400)))
          .slice(-(options.limit ?? BRIDGE_BUFFER_LIMITS.network));
        return {
          ok: true,
          bufferingStartedAt: buffer?.createdAt ?? null,
          note: "Network history starts when Better Browser Agent observes the tab; request bodies and auth headers are never collected.",
          tab: getBridgeTabMetadata(state, selected.entry),
          failures,
        };
      });
    },

    async captureBrowserScreenshot(options = {}) {
      return call("captureBrowserScreenshot", options, async () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.");
        const result = await captureBridgeScreenshot(state, selected.entry, options);
        return {
          ...result,
          tab: getBridgeTabMetadata(state, selected.entry),
        };
      });
    },

    async getDomSummary(options = {}) {
      return call("getDomSummary", options, async () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.");
        const result = await evaluateBridgeScript(state, selected.entry.wc, bridgeDomSummaryScript(options), {
          reason: "bridge-dom-summary",
        });
        if (!result.ok) return unavailableBridgeResult("dom-summary-unavailable", result.error, { tab: getBridgeTabMetadata(state, selected.entry) });
        return {
          ok: true,
          tab: getBridgeTabMetadata(state, selected.entry),
          summary: result.value?.result?.value ?? result.value?.result ?? null,
        };
      });
    },

    async getAccessibilitySummary(options = {}) {
      return call("getAccessibilitySummary", options, async () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.");
        const collection = await ensureBridgeEvidenceCollection(state, selected.entry.wc, "bridge-accessibility");
        if (!collection.ok && collection.status === "unavailable") {
          return unavailableBridgeResult("accessibility-unavailable", "DevTools protocol is unavailable.", {
            tab: getBridgeTabMetadata(state, selected.entry),
          });
        }
        const result = await state.devToolsSessionManager.executeCommand(
          selected.entry.wc,
          "Accessibility.getFullAXTree",
          { depth: 4 },
          { reason: "bridge-accessibility" },
        );
        if (!result.ok) return unavailableBridgeResult("accessibility-unavailable", result.error, { tab: getBridgeTabMetadata(state, selected.entry) });
        return {
          ok: true,
          tab: getBridgeTabMetadata(state, selected.entry),
          summary: summarizeAccessibilityTree(result.value?.nodes ?? []),
        };
      });
    },

    async createEvidenceBundle(options = {}) {
      return call("createEvidenceBundle", options, async () => {
        const selected = selectBridgeBrowserEntry(state, options);
        if (!selected.entry) return unavailableBridgeResult("missing-browser-target", "No Better Browser tab is available.");
        await ensureBridgeEvidenceCollection(state, selected.entry.wc, "bridge-evidence-bundle");
        const tab = getBridgeTabMetadata(state, selected.entry);
        const buffer = getBridgeBufferForWebContents(state, selected.entry.wc.id, false);
        const consoleMessages = getRingBufferItems(buffer?.console).slice(-50);
        const networkFailures = getRingBufferItems(buffer?.network)
          .filter((entry) => entry.failed || (Number.isInteger(entry.status) && (entry.status < 200 || entry.status >= 400)))
          .slice(-50);
        const [screenshot, dom, accessibility] = await Promise.all([
          captureBridgeScreenshot(state, selected.entry, options),
          evaluateBridgeScript(state, selected.entry.wc, bridgeDomSummaryScript(options), {
            reason: "bridge-evidence-dom",
          }),
          state.devToolsSessionManager.executeCommand(selected.entry.wc, "Accessibility.getFullAXTree", { depth: 4 }, {
            reason: "bridge-evidence-accessibility",
          }),
        ]);
        return {
          ok: true,
          bridgeStatus: getBridgeStatus(state),
          capturedAt: new Date().toISOString(),
          tab,
          screenshot,
          console: {
            messages: consoleMessages,
            summary: summarizeConsoleMessages(consoleMessages),
          },
          network: {
            failures: networkFailures,
          },
          dom: dom.ok ? dom.value?.result?.value ?? dom.value?.result ?? null : unavailableBridgeResult("dom-summary-unavailable", dom.error),
          accessibility: accessibility.ok
            ? summarizeAccessibilityTree(accessibility.value?.nodes ?? [])
            : unavailableBridgeResult("accessibility-unavailable", accessibility.error),
          audit: getRingBufferItems(state.bridgeAuditLog).slice(-20),
          buffersStartedAt: buffer?.createdAt ?? null,
        };
      });
    },

    refuseUnsupportedBridgeMethod(methodName) {
      return call("refuseUnsupportedBridgeMethod", { methodName }, () =>
        refuseUnsupportedBridgeMethod(methodName),
      );
    },

    recordAuditEntry(entry) {
      const redacted = redactBridgeValue({
        durationMs: entry?.durationMs ?? null,
        error: entry?.error ?? null,
        origin: entry?.origin ?? null,
        redactionCount: entry?.redactionCount ?? 0,
        resultCounts: entry?.resultCounts ?? null,
        status: entry?.status ?? "unknown",
        tabId: entry?.tabId ?? null,
        timestamp: entry?.timestamp ?? Date.now(),
        toolName: entry?.toolName ?? "unknown",
      });
      pushRingBuffer(state.bridgeAuditLog, truncateBridgeValue(redacted));
      return redacted;
    },

    getAuditLog() {
      return getRingBufferItems(state.bridgeAuditLog).map((entry) => ({ ...entry }));
    },
  };

  for (const methodName of BRIDGE_REFUSED_METHODS) {
    api[methodName] = () => api.refuseUnsupportedBridgeMethod(methodName);
  }

  return api;
}

function createBridgeEventBuffers(options = {}) {
  const buffers = new Map();
  const redactor = typeof options.redact === "function" ? options.redact : redactBridgeValue;
  const partialHistory = options.partialHistory === true;
  const limits = {
    bridgeCalls: options.limits?.bridgeCalls ?? options.bridgeCallsLimit ?? BRIDGE_BUFFER_LIMITS.bridgeCalls,
    console: options.limits?.console ?? options.consoleLimit ?? BRIDGE_BUFFER_LIMITS.console,
    navigation: options.limits?.navigation ?? options.navigationLimit ?? BRIDGE_BUFFER_LIMITS.navigation,
    network: options.limits?.network ?? options.networkLimit ?? BRIDGE_BUFFER_LIMITS.network,
    runtime: options.limits?.runtime ?? options.runtimeLimit ?? BRIDGE_BUFFER_LIMITS.runtime,
    screenshots: options.limits?.screenshots ?? options.screenshotLimit ?? BRIDGE_BUFFER_LIMITS.screenshots,
  };
  buffers.console = createRingBuffer(limits.console, { partialHistory, redactor });
  buffers.network = createRingBuffer(limits.network, { partialHistory, redactor });
  buffers.runtime = createRingBuffer(limits.runtime, { partialHistory, redactor });
  buffers.navigation = createRingBuffer(limits.navigation, { partialHistory, redactor });
  buffers.screenshots = createRingBuffer(limits.screenshots, { partialHistory, redactor });
  buffers.bridgeCalls = createRingBuffer(limits.bridgeCalls, { partialHistory, redactor });
  buffers.getConsoleBuffer = () => buffers.console;
  buffers.getNetworkBuffer = () => buffers.network;
  buffers.forWebContentsId = (webContentsId) => {
    const id = normalizeWebContentsId(webContentsId);
    if (id == null) return null;
    let buffer = buffers.get(id);
    if (!buffer) {
      buffer = {
        bridgeCalls: createRingBuffer(limits.bridgeCalls, { partialHistory, redactor }),
        console: createRingBuffer(limits.console, { partialHistory, redactor }),
        createdAt: Date.now(),
        navigation: createRingBuffer(limits.navigation, { partialHistory, redactor }),
        network: createRingBuffer(limits.network, { partialHistory, redactor }),
        runtime: createRingBuffer(limits.runtime, { partialHistory, redactor }),
        screenshots: createRingBuffer(limits.screenshots, { partialHistory, redactor }),
        webContentsId: id,
      };
      buffers.set(id, buffer);
    }
    return buffer;
  };
  return buffers;
}

function createRingBuffer(limit, options = {}) {
  const max = Math.max(1, Number(limit) || 1);
  return {
    items: [],
    limit: max,
    partialHistory: options.partialHistory === true,
    truncated: false,
    push(value) {
      const item = typeof options.redactor === "function" ? options.redactor(value) : value;
      this.items.push(item);
      if (this.items.length > this.limit) {
        this.items.splice(0, this.items.length - this.limit);
        this.truncated = true;
      }
    },
    add(value) {
      return this.push(value);
    },
    addEntry(value) {
      return this.push(value);
    },
    clear() {
      this.items.length = 0;
      this.truncated = false;
    },
    entries() {
      return this.items.slice();
    },
    getEntries() {
      return this.items.slice();
    },
    record(value) {
      return this.push(value);
    },
    snapshot() {
      return {
        entries: this.items.slice(),
        partialHistory: this.partialHistory,
        truncated: this.truncated,
      };
    },
    toJSON() {
      return this.snapshot();
    },
    values() {
      return this.items.slice();
    },
  };
}

function pushRingBuffer(buffer, value) {
  if (buffer && typeof buffer.push === "function") buffer.push(value);
}

function getRingBufferItems(buffer) {
  if (!buffer) return [];
  if (typeof buffer.values === "function") return buffer.values();
  return Array.isArray(buffer.items) ? buffer.items.slice() : [];
}

function getBridgeBufferForWebContents(state, webContentsId, create = true) {
  const id = normalizeWebContentsId(webContentsId);
  if (id == null) return null;
  if (!create) return state.bridgeEventBuffers?.get?.(id) ?? null;
  return state.bridgeEventBuffers?.forWebContentsId?.(id) ?? null;
}

function recordBridgeEvent(state, wcOrId, eventType, payload = {}) {
  const webContentsId = normalizeWebContentsId(typeof wcOrId === "object" ? wcOrId?.id : wcOrId);
  if (webContentsId == null) return false;
  const buffer = getBridgeBufferForWebContents(state, webContentsId);
  const record = redactBridgeValue({
    ...payload,
    eventType,
    pageUrl: getBridgeWebContentsUrl(state, webContentsId),
    timestamp: Date.now(),
    webContentsId,
  });
  const target = buffer?.[eventType];
  if (target) pushRingBuffer(target, truncateBridgeValue(record));
  return !!target;
}

function recordBridgeCall(state, webContentsId, payload = {}) {
  const id = normalizeWebContentsId(webContentsId);
  if (id == null) return false;
  return recordBridgeEvent(state, id, "bridgeCalls", payload);
}

function recordDevToolsProtocolEvent(state, wc, method, params) {
  if (!method || !wc || wc.isDestroyed?.()) return;
  if (method === "Runtime.consoleAPICalled") {
    recordBridgeEvent(state, wc, "console", {
      args: (params?.args ?? []).map((arg) => arg?.value ?? arg?.description ?? arg?.type).filter((value) => value != null),
      level: normalizeConsoleLevel(params?.type),
      message: (params?.args ?? []).map((arg) => arg?.value ?? arg?.description ?? "").join(" "),
      source: "runtime",
    });
  } else if (method === "Runtime.exceptionThrown") {
    const details = params?.exceptionDetails ?? {};
    recordBridgeEvent(state, wc, "runtime", {
      columnNumber: details.columnNumber ?? null,
      lineNumber: details.lineNumber ?? null,
      message: details.text ?? details.exception?.description ?? details.exception?.value ?? "Runtime exception",
      source: details.url ?? null,
    });
    recordBridgeEvent(state, wc, "console", {
      level: "error",
      message: details.text ?? details.exception?.description ?? "Runtime exception",
      source: details.url ?? "runtime",
    });
  } else if (method === "Network.loadingFailed") {
    recordBridgeEvent(state, wc, "network", {
      errorText: params?.errorText,
      failed: true,
      requestId: params?.requestId,
      type: params?.type,
    });
  } else if (method === "Network.responseReceived") {
    const response = params?.response ?? {};
    const status = Number(response.status);
    recordBridgeEvent(state, wc, "network", {
      failed: Number.isInteger(status) && (status < 200 || status >= 400),
      method: response.requestHeadersText ? null : params?.request?.method ?? null,
      requestId: params?.requestId,
      status: Number.isInteger(status) ? status : null,
      statusText: response.statusText ?? null,
      timing: summarizeResponseTiming(response.timing),
      type: params?.type,
      url: response.url,
    });
  } else if (method === "Page.frameNavigated" || method === "Page.navigatedWithinDocument") {
    recordBridgeEvent(state, wc, "navigation", {
      frameId: params?.frame?.id ?? params?.frameId ?? null,
      url: params?.frame?.url ?? params?.url ?? null,
    });
  } else if (method === "Log.entryAdded") {
    const entry = params?.entry ?? {};
    recordBridgeEvent(state, wc, "console", {
      level: normalizeConsoleLevel(entry.level),
      message: entry.text,
      source: entry.source ?? "log",
      url: entry.url ?? null,
    });
  }
}

function normalizeConsoleLevel(level) {
  const raw = typeof level === "string" ? level.toLowerCase() : String(level ?? "");
  if (raw === "3" || raw.includes("error")) return "error";
  if (raw === "2" || raw.includes("warn")) return "warning";
  if (raw === "1" || raw.includes("info")) return "info";
  return raw || "log";
}

function summarizeResponseTiming(timing) {
  if (!timing || typeof timing !== "object") return null;
  return {
    receiveHeadersEnd: numberOrNull(timing.receiveHeadersEnd),
    requestTime: numberOrNull(timing.requestTime),
    sendEnd: numberOrNull(timing.sendEnd),
    sendStart: numberOrNull(timing.sendStart),
  };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getBridgeStatus(state) {
  if (!state) return { mode: "unavailable", status: "unavailable" };
  if (state.conflict?.active) {
    return {
      mode: "blocked",
      reason: state.conflict.message,
      status: "blocked",
    };
  }
  return {
    mode: state.bridgeMode ?? "read-only",
    status: state.status ?? "initializing",
  };
}

function listBridgeBrowserTabs(state) {
  const tabs = [];
  for (const entry of state.webContentsEntries.values()) {
    if (!entry?.wc || entry.wc.isDestroyed?.() || !isLikelyBrowserContent(entry.wc)) continue;
    refreshBrowserTabRegistryEntry(state, entry.wc, { entry, reason: "bridge-list" });
    tabs.push(getBridgeTabMetadata(state, entry));
  }
  return tabs
    .sort((a, b) => Number(b.activeish) - Number(a.activeish) || b.lastUpdatedAt - a.lastUpdatedAt)
    .slice(0, MAX_BROWSER_TABS);
}

function selectBridgeBrowserEntry(state, options = {}) {
  const requestedId = normalizeWebContentsId(options.webContentsId ?? options.tabId ?? options.browserWebContentsId);
  if (requestedId != null) {
    const entry = state.webContentsEntries.get(requestedId) ?? getOrCreateWebContentsEntryById(state, requestedId);
    if (entry?.wc && !entry.wc.isDestroyed?.() && isLikelyBrowserContent(entry.wc)) {
      return { entry, reason: "requested-webContentsId" };
    }
    return { entry: null, reason: "requested-webContentsId-missing" };
  }

  const candidates = [];
  for (const entry of state.webContentsEntries.values()) {
    if (!entry?.wc || entry.wc.isDestroyed?.() || !isLikelyBrowserContent(entry.wc)) continue;
    candidates.push(entry);
  }
  if (candidates.length === 0) return { entry: null, reason: "no-browser-tabs" };

  const focused = candidates.find((entry) => entry.wc.isFocused?.());
  if (focused) return { entry: focused, reason: "focused-browser-webContents" };

  const inline = candidates.find((entry) => entry.inlineDevTools && !entry.inlineDevTools.disposed);
  if (inline) return { entry: inline, reason: "inline-devtools-open" };

  const visible = candidates.find((entry) => {
    const window = getBrowserOwnerWindow(entry.wc);
    return typeof window?.isVisible === "function" ? window.isVisible() : false;
  });
  if (visible) return { entry: visible, reason: "visible-owner-window" };

  return { entry: candidates[0], reason: "first-browser-tab" };
}

function selectBrowserTabForBridge(tabs, options = {}) {
  const candidates = (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => normalizeWebContentsId(tab?.webContentsId) != null)
    .map((tab) => ({ ...tab, webContentsId: normalizeWebContentsId(tab.webContentsId) }));
  if (candidates.length === 0) return { reason: "no-browser-tabs", tab: null };

  const preferredId = normalizeWebContentsId(options.preferredWebContentsId ?? options.webContentsId ?? options.tabId);
  if (preferredId != null) {
    const preferred = candidates.find((tab) => tab.webContentsId === preferredId);
    if (preferred) return { reason: "requested-preferred-webContentsId", tab: preferred };
  }

  const sorted = candidates.slice().sort((a, b) => {
    const score = (tab) =>
      (tab.isFocused ? 1000 : 0) +
      (tab.devToolsOpen ? 500 : 0) +
      (tab.isVisible ? 100 : 0) +
      (tab.activeish ? 50 : 0);
    const delta = score(b) - score(a);
    if (delta !== 0) return delta;
    const updated = Number(b.lastUpdatedAt ?? 0) - Number(a.lastUpdatedAt ?? 0);
    if (updated !== 0) return updated;
    return a.webContentsId - b.webContentsId;
  });

  const selected = sorted[0];
  let reason = "deterministic-tie-break";
  if (selected.isFocused) reason = "focused-tab";
  else if (selected.devToolsOpen) reason = "devtools-open-tab";
  else if (selected.isVisible) reason = "visible-tab-deterministic";
  return { reason, tab: selected };
}

function getBridgeTabMetadata(state, entry) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.()) return null;
  const pageState = findBrowserPageForWebContentsId(wc.id);
  const conversationId = getPageStateConversationId(pageState);
  const record = refreshBrowserTabRegistryEntry(state, wc, { entry, reason: "bridge-metadata" });
  return redactBridgeValue({
    activeish: !!record?.activeish,
    betterBrowserTabId: conversationId ? getBaseConversationIdForBrowserTab(conversationId) ?? conversationId : null,
    browserConversationId: conversationId,
    bridgeBufferStartedAt: getBridgeBufferForWebContents(state, wc.id, false)?.createdAt ?? null,
    cdp: {
      attached: !!record?.cdpAttached,
      available: !!record?.cdpAvailable,
      lastCommand: record?.cdpLastCommand ?? null,
      lastCommandAt: record?.cdpLastCommandAt ?? null,
      lastError: record?.cdpLastError ?? null,
      status: record?.cdpStatus ?? "unavailable",
    },
    devToolsOpen: !!record?.devToolsOpen,
    isFocused: !!record?.isFocused,
    isVisible: !!record?.isVisible,
    loading: !!record?.loading,
    ownerWebContentsId: record?.ownerWebContentsId ?? null,
    title: record?.title ?? "",
    url: record?.url ?? "",
    webContentsId: wc.id,
  });
}

async function ensureBridgeEvidenceCollection(state, wc, reason) {
  if (!wc || wc.isDestroyed?.()) {
    return { ok: false, status: "unavailable", error: "webContents unavailable" };
  }
  getBridgeBufferForWebContents(state, wc.id);
  const manager = state.devToolsSessionManager;
  if (!manager || typeof manager.enableEvidenceCollection !== "function") {
    return { ok: false, status: "unavailable", error: "DevTools session manager unavailable" };
  }
  return manager.enableEvidenceCollection(wc, { reason });
}

async function evaluateBridgeScript(state, wc, expression, options = {}) {
  const collection = await ensureBridgeEvidenceCollection(state, wc, options.reason ?? "bridge-evaluate");
  if (!collection.ok && collection.status === "unavailable") {
    return {
      ok: false,
      error: "DevTools protocol is unavailable.",
    };
  }
  return state.devToolsSessionManager.executeCommand(
    wc,
    "Runtime.evaluate",
    {
      awaitPromise: true,
      expression,
      returnByValue: true,
      timeout: 2000,
    },
    options,
  );
}

async function captureBridgeScreenshot(state, entry, options = {}) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.()) {
    return unavailableBridgeResult("screenshot-unavailable", "webContents unavailable");
  }
  const collection = await ensureBridgeEvidenceCollection(state, wc, "bridge-screenshot");
  if (!collection.ok && collection.status === "unavailable") {
    return unavailableBridgeResult("screenshot-unavailable", "DevTools protocol is unavailable.");
  }
  const result = await state.devToolsSessionManager.executeCommand(
    wc,
    "Page.captureScreenshot",
    {
      captureBeyondViewport: false,
      format: "png",
      fromSurface: true,
    },
    { reason: "bridge-screenshot" },
  );
  if (!result.ok || typeof result.value?.data !== "string") {
    return unavailableBridgeResult("screenshot-unavailable", result.error ?? "No screenshot data returned.");
  }

  const bytes = Buffer.from(result.value.data, "base64");
  if (bytes.length > BRIDGE_SCREENSHOT_BYTES_LIMIT) {
    return unavailableBridgeResult("screenshot-too-large", "Screenshot exceeded the bridge artifact size limit.", {
      bytes: bytes.length,
      limit: BRIDGE_SCREENSHOT_BYTES_LIMIT,
    });
  }

  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const root = path.join(os.tmpdir(), BRIDGE_SCREENSHOT_DIR);
    fs.mkdirSync(root, { recursive: true });
    const fileName = `tab-${wc.id}-${Date.now()}.png`;
    const filePath = path.join(root, fileName);
    fs.writeFileSync(filePath, bytes);
    const screenshot = {
      bytes: bytes.length,
      filePath,
      mimeType: "image/png",
      ok: true,
      capturedAt: new Date().toISOString(),
    };
    recordBridgeEvent(state, wc, "screenshots", screenshot);
    return screenshot;
  } catch (error) {
    return unavailableBridgeResult("screenshot-write-failed", stringifyError(error));
  }
}

function bridgeDomSummaryScript(options = {}) {
  const maxNodes = Math.max(1, Math.min(BRIDGE_OUTPUT_LIMITS.domNodes, Number(options.maxNodes) || 60));
  const maxText = Math.max(40, Math.min(240, Number(options.maxTextLength) || 120));
  return `(() => {
    const maxNodes = ${JSON.stringify(maxNodes)};
    const maxText = ${JSON.stringify(maxText)};
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    };
    const textOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, maxText);
    const roleOf = (el) => el.getAttribute("role") || (el instanceof HTMLButtonElement ? "button" : el instanceof HTMLAnchorElement ? "link" : el.tagName.toLowerCase());
    const nodes = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    while (nodes.length < maxNodes) {
      const el = walker.nextNode();
      if (!el) break;
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      nodes.push({
        tag: el.tagName.toLowerCase(),
        role: roleOf(el),
        name: el.getAttribute("aria-label") || el.getAttribute("title") || textOf(el),
        id: el.id || null,
        className: typeof el.className === "string" ? el.className.split(/\\s+/).slice(0, 4).join(" ") : "",
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }
    return {
      title: document.title || "",
      url: location.href,
      visibleNodeCount: nodes.length,
      nodes,
      truncated: nodes.length >= maxNodes,
    };
  })()`;
}

function summarizeAccessibilityTree(nodes) {
  const out = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (out.length >= BRIDGE_OUTPUT_LIMITS.accessibilityNodes) break;
    const role = axValue(node.role);
    const name = axValue(node.name);
    if (!role && !name) continue;
    out.push({
      role: role || null,
      name: name || null,
      ignored: !!node.ignored,
      childIds: Array.isArray(node.childIds) ? node.childIds.slice(0, 12) : [],
    });
  }
  return {
    nodes: out,
    truncated: Array.isArray(nodes) && nodes.length > out.length,
  };
}

function axValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.value ?? value.description ?? null;
  return null;
}

function summarizeConsoleMessages(messages) {
  const summary = { error: 0, warning: 0, info: 0, log: 0 };
  for (const message of messages) {
    const level = normalizeConsoleLevel(message?.level);
    if (summary[level] == null) summary[level] = 0;
    summary[level] += 1;
  }
  return summary;
}

function unavailableBridgeResult(reason, message, extra = {}) {
  return {
    ok: false,
    degraded: true,
    message: message ?? reason,
    reason,
    ...extra,
  };
}

function refuseUnsupportedBridgeMethod(methodName) {
  const normalized =
    typeof methodName === "string"
      ? methodName
      : typeof methodName?.toolName === "string"
        ? methodName.toolName
        : "unsupported";
  return {
    allowed: false,
    code: "read-only-bridge-refused",
    ok: false,
    refused: true,
    methodName: normalized,
    reason: "out-of-scope-read-only-bridge",
    message:
      "Better Browser Agent V1 is read-only and does not expose cookies, storage, auth headers, request bodies, or page mutation.",
  };
}

function resultCountsForAudit(result) {
  return {
    tabs: Array.isArray(result?.tabs) ? result.tabs.length : undefined,
    messages: Array.isArray(result?.messages) ? result.messages.length : undefined,
    failures: Array.isArray(result?.failures) ? result.failures.length : undefined,
  };
}

function sanitizeBridgeError(error) {
  return truncateBridgeValue(redactBridgeValue(stringifyError(error)));
}

function getBridgeWebContentsUrl(state, webContentsId) {
  const entry = state.webContentsEntries?.get?.(webContentsId);
  if (!entry?.wc || entry.wc.isDestroyed?.()) return null;
  return entry.wc.getURL?.() ?? null;
}

function normalizeWebContentsId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function redactBridgeValue(value) {
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map((item) => redactBridgeValue(item));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveBridgeKey(key)) {
      out[key] = "[redacted]";
    } else if (key === "url" || key === "pageUrl" || key === "source" || key === "filePath") {
      out[key] = key === "filePath" ? item : redactSensitiveString(item);
    } else {
      out[key] = redactBridgeValue(item);
    }
  }
  return out;
}

function isSensitiveBridgeKey(key) {
  return /cookie|authorization|auth|token|secret|password|passwd|api[-_]?key|requestBody|postData|body|storage/i.test(key);
}

function redactSensitiveString(value) {
  if (typeof value !== "string") return value;
  let out = value;
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
  out = out.replace(/([?&](?:token|access_token|refresh_token|id_token|code|key|api_key|password|secret|auth|signature|session|session_id)=)[^&#\s]+/gi, "$1[redacted]");
  out = out.replace(/\braw-(?:token|cookie|auth|body|api-key|session)-secret\b/gi, "[redacted]");
  out = out.replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "[redacted-email]@$2");
  return out;
}

function truncateBridgeValue(value, limits = BRIDGE_OUTPUT_LIMITS, state = { total: 0, truncated: false }) {
  if (typeof value === "string") {
    state.total += value.length;
    let out = value;
    if (out.length > limits.fieldLength) {
      out = `${out.slice(0, limits.fieldLength)}...[truncated]`;
      state.truncated = true;
    }
    if (state.total > limits.totalStringLength) {
      state.truncated = true;
      return "[truncated-output-limit]";
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateBridgeValue(item, limits, state));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = truncateBridgeValue(item, limits, state);
  }
  if (state.truncated) out.truncated = out.truncated ?? true;
  return out;
}

function restoreWebContents(entry) {
  const wc = entry.wc;
  if (!wc) return;

  disposeInlineDevTools(entry, { closeDevTools: true });
  const state = globalThis[GLOBAL_STATE_KEY];
  if (wc.isDestroyed?.()) {
    state?.devToolsSessionManager?.forgetWebContents?.(wc, "destroyed");
    state?.browserTabRegistry?.delete(wc.id);
    return;
  }

  clearBrowserThemeForEntry(entry);
  state?.devToolsSessionManager?.forgetWebContents?.(wc, "restore");

  wc.inspectElement = entry.originalInspectElement;
  wc.openDevTools = entry.originalOpenDevTools;
  wc.closeDevTools = entry.originalCloseDevTools;
  wc.send = entry.originalSend;

  for (const [eventName, listener] of entry.listeners) {
    wc.off(eventName, listener);
  }

  try {
    delete wc[PATCHED_WEB_CONTENTS];
  } catch {
    /* non-critical */
  }
}

function rememberBrowserDirectCommentAlias(
  state,
  ownerWebContentsId,
  baseConversationId,
  browserConversationId,
  sessionId,
) {
  const keys = browserDirectCommentAliasKeys(ownerWebContentsId, baseConversationId, sessionId);
  if (keys.length === 0) return;
  cleanupBrowserDirectCommentAliases(state);
  const alias = {
    browserConversationId,
    expiresAt: Date.now() + DIRECT_COMMENT_ALIAS_TTL_MS,
  };
  for (const key of keys) state.directCommentAliases.set(key, alias);
}

function routeBrowserDirectCommentAlias(state, event, message) {
  if (!message || typeof message !== "object") return message;
  if (!BROWSER_COMMENT_OVERLAY_ALIAS_MESSAGE_TYPES.has(message.type)) {
    return message;
  }

  const keys = browserDirectCommentAliasKeys(event.sender.id, message.conversationId, message.sessionId);
  if (keys.length === 0) return message;
  const key = keys.find((candidate) => state.directCommentAliases.has(candidate));
  if (!key) {
    logBrowserDirectCommentAliasMiss(state, event, message, "missing-alias");
    return message;
  }
  const alias = state.directCommentAliases.get(key);
  if (!alias) return message;
  if (alias.expiresAt <= Date.now()) {
    logBrowserDirectCommentAliasMiss(state, event, message, "expired-alias");
    deleteBrowserDirectCommentAlias(state, alias);
    return message;
  }

  if (BROWSER_COMMENT_OVERLAY_ALIAS_CONSUMING_MESSAGE_TYPES.has(message.type)) {
    deleteBrowserDirectCommentAlias(state, alias);
  }
  return {
    ...message,
    conversationId: alias.browserConversationId,
  };
}

function deleteBrowserDirectCommentAlias(state, alias) {
  for (const [key, candidate] of state.directCommentAliases) {
    if (candidate === alias) state.directCommentAliases.delete(key);
  }
}

function logBrowserDirectCommentAliasMiss(state, event, message, reason) {
  const warn = state?.api?.log?.warn;
  if (typeof warn !== "function") return;
  const key = [
    reason,
    event?.sender?.id,
    message?.type,
    message?.conversationId,
    message?.sessionId,
  ].join(":");
  state.directCommentAliasMissWarnings ??= new Set();
  if (state.directCommentAliasMissWarnings.has(key)) return;
  state.directCommentAliasMissWarnings.add(key);
  warn.call(state.api.log, "browser comment overlay alias route miss", {
    reason,
    senderWebContentsId: event?.sender?.id ?? null,
    messageType: message?.type ?? null,
    conversationId: message?.conversationId ?? null,
    sessionId: message?.sessionId ?? null,
  });
}

function cleanupBrowserDirectCommentAliases(state) {
  const now = Date.now();
  for (const [key, alias] of state.directCommentAliases) {
    if (alias.expiresAt <= now) state.directCommentAliases.delete(key);
  }
}

function browserDirectCommentAliasKeys(ownerWebContentsId, conversationId, sessionId) {
  if (typeof conversationId !== "string" || conversationId.length === 0) return [];
  if (sessionId == null) return [];
  const sessionKey = `${conversationId}:${String(sessionId)}`;
  return [`${ownerWebContentsId}:${sessionKey}`, `overlay:${sessionKey}`];
}

function mirrorBrowserCommentOverlaySessionToBaseConversation(state, ownerWebContents, entry, message) {
  const baseConversationId = getBaseConversationIdForBrowserTab(message.conversationId);
  if (!baseConversationId) return false;

  const sessionId = message.session?.sessionId ?? message.sessionId;
  rememberBrowserDirectCommentAlias(
    state,
    ownerWebContents.id,
    baseConversationId,
    message.conversationId,
    sessionId,
  );

  entry.originalSend.call(ownerWebContents, MESSAGE_FOR_VIEW, message);
  entry.originalSend.call(ownerWebContents, MESSAGE_FOR_VIEW, {
    ...message,
    conversationId: baseConversationId,
    session: message.session
      ? {
          ...message.session,
          conversationId: baseConversationId,
        }
      : message.session,
  });
  return true;
}

function observeRendererMessage(state, event, message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "better-browser-devtools-dock") {
    setInlineDevToolsDockForOwnerWebContents(state, event.sender, message.dock, message);
    return;
  }

  if (message.type === "better-browser-devtools-toggle") {
    toggleInlineDevToolsForOwnerWebContents(state, event.sender, message);
    return;
  }

  if (message.type === "better-browser-devtools-state-request") {
    sendInlineDevToolsStateForOwnerWebContents(state, event.sender, message);
    return;
  }

  if (message.type === "better-browser-theme") {
    setBrowserThemeForOwnerWebContents(state, event.sender, message.theme, message);
    return;
  }

  if (message.type === "app-shell-shortcut-state-changed") {
    state.shortcutStateByWebContentsId.set(event.sender.id, {
      bottomPanelCanCloseActiveTab: !!message.bottomPanelCanCloseActiveTab,
      focusArea: message.focusArea ?? "main",
      rightPanelBrowserConversationId: message.rightPanelBrowserConversationId ?? null,
      rightPanelCanCloseActiveTab: !!message.rightPanelCanCloseActiveTab,
    });
    syncInlineDevToolsForOwnerWebContents(state, event.sender);
  }
}

function setInlineDevToolsDockForOwnerWebContents(state, ownerWebContents, dock, hints = null) {
  if (!INLINE_DEVTOOLS_DOCKS.has(dock)) return false;
  const entry =
    findOpenInlineDevToolsEntryForOwnerWebContents(state, ownerWebContents) ??
    findBrowserEntryForOwnerWebContents(state, ownerWebContents, hints);
  if (!entry) return false;

  entry.devToolsLayout.dock = dock;
  if (entry.inlineDevTools && !entry.inlineDevTools.disposed) {
    loadInlineDevToolsControlViews(entry);
    positionInlineDevToolsViews(entry);
  }
  sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents, hints);
  return true;
}

function findOpenInlineDevToolsEntryForOwnerWebContents(state, ownerWebContents) {
  if (!ownerWebContents || ownerWebContents.isDestroyed?.()) return null;

  for (const entry of state.webContentsEntries.values()) {
    if (!entry.inlineDevTools || entry.inlineDevTools.disposed) continue;
    const pageState = findBrowserPageForWebContentsId(entry.wc.id, ownerWebContents);
    if (!pageStateBelongsToOwner(pageState, ownerWebContents)) continue;
    if (isInlineDevToolsActiveForOwner(entry)) return entry;
  }

  for (const entry of state.webContentsEntries.values()) {
    if (!entry.inlineDevTools || entry.inlineDevTools.disposed) continue;
    const pageState = findBrowserPageForWebContentsId(entry.wc.id, ownerWebContents);
    if (pageStateBelongsToOwner(pageState, ownerWebContents)) return entry;
  }

  return null;
}

function toggleInlineDevToolsForOwnerWebContents(state, ownerWebContents, hints = null) {
  const entry = findBrowserEntryForOwnerWebContents(state, ownerWebContents, hints);
  if (!entry) {
    sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents);
    return false;
  }

  return toggleInlineDevToolsForEntry(state, entry, ownerWebContents);
}

function toggleInlineDevToolsForEntry(state, entry, ownerWebContents = null) {
  if (!entry?.wc || entry.wc.isDestroyed?.()) {
    if (ownerWebContents) sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents);
    return false;
  }

  const isOpen =
    entry.devToolsLayout.open === true &&
    entry.inlineDevTools &&
    !entry.inlineDevTools.disposed &&
    (ownerWebContents ? isInlineDevToolsActiveForOwner(entry) : true);
  if (isOpen) {
    entry.devToolsLayout.open = false;
    disposeInlineDevTools(entry, { closeDevTools: true });
  } else if (!openInlineDevTools(state.api, state, entry, { activate: true })) {
    openFallbackDevTools(state.api, entry, { activate: true });
  }

  const stateOwner = ownerWebContents ?? getBrowserOwnerWebContents(entry);
  if (stateOwner) sendInlineDevToolsStateForOwnerWebContents(state, stateOwner);
  return true;
}

function syncInlineDevToolsForOwnerWebContents(state, ownerWebContents) {
  for (const entry of state.webContentsEntries.values()) {
    if (!entry.inlineDevTools || entry.inlineDevTools.disposed) continue;
    const pageState = findBrowserPageForWebContentsId(entry.wc.id, ownerWebContents);
    if (!pageStateBelongsToOwner(pageState, ownerWebContents)) continue;
    positionInlineDevToolsViews(entry);
  }
  sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents);
}

function setBrowserThemeForOwnerWebContents(state, ownerWebContents, theme, hints = null) {
  if (!BROWSER_THEMES.has(theme)) {
    sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents);
    return false;
  }

  const entries = findBrowserThemeEntriesForOwnerWebContents(state, ownerWebContents, hints);
  for (const entry of entries) {
    entry.browserTheme = theme;
    applyBrowserThemeForEntry(state.api, entry);
  }
  if (ownerWebContents && !ownerWebContents.isDestroyed?.()) {
    state.browserThemeByOwnerWebContentsId.set(ownerWebContents.id, theme);
  }
  sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents, hints);
  return entries.length > 0;
}

function findBrowserThemeEntriesForOwnerWebContents(state, ownerWebContents, hints = null) {
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry?.wc || entry.wc.isDestroyed?.() || seen.has(entry.wc.id) || !isLikelyBrowserContent(entry.wc)) {
      return;
    }
    seen.add(entry.wc.id);
    entries.push(entry);
  };

  add(findBrowserEntryForOwnerWebContents(state, ownerWebContents, hints));

  for (const entry of state.webContentsEntries.values()) {
    const wc = entry.wc;
    if (!wc || wc.isDestroyed?.() || !isLikelyBrowserContent(wc)) continue;
    const pageState = findBrowserPageForWebContentsId(wc.id, ownerWebContents);
    if (pageState) {
      if (pageStateBelongsToOwner(pageState, ownerWebContents)) add(entry);
      continue;
    }

    const ownerWindow = getBrowserOwnerWindow(wc);
    const ownerShellWindow = getOwnerWindowForWebContents(ownerWebContents);
    if (ownerWindow && ownerShellWindow && ownerWindow.id === ownerShellWindow.id) add(entry);
  }

  if (entries.length > 0) return entries;

  try {
    const { webContents } = require("electron");
    for (const wc of webContents.getAllWebContents()) {
      if (!wc || wc.isDestroyed?.() || !isLikelyBrowserContent(wc)) continue;
      add(ensureWebContentsEntry(state, wc));
    }
  } catch {
    /* non-critical */
  }

  return entries;
}

function ensureWebContentsEntry(state, wc) {
  if (!wc || wc.isDestroyed?.()) return null;
  const existing = state.webContentsEntries.get(wc.id) ?? wc[PATCHED_WEB_CONTENTS] ?? null;
  if (existing) return existing;
  patchWebContents(state.api, state, wc);
  return state.webContentsEntries.get(wc.id) ?? wc[PATCHED_WEB_CONTENTS] ?? null;
}

function sendInlineDevToolsStateForOwnerWebContents(state, ownerWebContents, hints = null) {
  if (!ownerWebContents || ownerWebContents.isDestroyed?.()) return;
  const entry =
    findBrowserEntryForOwnerWebContents(state, ownerWebContents, hints) ??
    findActiveBrowserEntryForOwnerWebContents(state, ownerWebContents);
  const open =
    entry?.devToolsLayout?.open === true &&
    entry.inlineDevTools &&
    !entry.inlineDevTools.disposed &&
    isInlineDevToolsActiveForOwner(entry);
  ownerWebContents.send(MESSAGE_FOR_VIEW, {
    type: "better-browser-devtools-state",
    dock: entry ? getInlineDevToolsDock(entry) : INLINE_DEVTOOLS_DEFAULT_DOCK,
    open: !!open,
    theme:
      (ownerWebContents ? state.browserThemeByOwnerWebContentsId.get(ownerWebContents.id) : null) ??
      (entry ? getBrowserTheme(entry) : getDefaultBrowserTheme()),
  });
}

function findActiveBrowserEntryForOwnerWebContents(state, ownerWebContents) {
  const shortcutState = getShortcutState(state, ownerWebContents);
  const conversationId =
    typeof shortcutState?.rightPanelBrowserConversationId === "string"
      ? shortcutState.rightPanelBrowserConversationId
      : null;
  return (
    findBrowserEntryForConversationId(state, ownerWebContents, conversationId) ??
    findBrowserEntryForConversationId(
      state,
      ownerWebContents,
      getActiveBrowserConversationIdForOwner(ownerWebContents),
    ) ??
    findBrowserEntryForOwnerWebContents(state, ownerWebContents)
  );
}

function findBrowserEntryForOwnerWebContents(state, ownerWebContents, hints = null) {
  if (!ownerWebContents || ownerWebContents.isDestroyed?.()) return null;

  const hintedWebContentsId = Number(hints?.browserWebContentsId ?? hints?.webContentsId);
  if (Number.isInteger(hintedWebContentsId) && hintedWebContentsId > 0) {
    const hintedEntry = getOrCreateWebContentsEntryById(state, hintedWebContentsId);
    const hintedPageState = findBrowserPageForWebContentsId(hintedWebContentsId, ownerWebContents);
    if (browserEntryBelongsToOwner(hintedEntry, ownerWebContents, hintedPageState)) {
      return hintedEntry;
    }
  }

  const hintedConversationId =
    typeof hints?.browserConversationId === "string"
      ? hints.browserConversationId
      : typeof hints?.conversationId === "string"
        ? hints.conversationId
        : null;
  const hinted = findBrowserEntryForConversationId(state, ownerWebContents, hintedConversationId);
  if (hinted) return hinted;

  const shortcutState = getShortcutState(state, ownerWebContents);
  const conversationId =
    typeof shortcutState?.rightPanelBrowserConversationId === "string"
      ? shortcutState.rightPanelBrowserConversationId
      : null;
  const exact = findBrowserEntryForConversationId(state, ownerWebContents, conversationId);
  if (exact) return exact;

  const activeConversationId = getActiveBrowserConversationIdForOwner(ownerWebContents);
  const active = findBrowserEntryForConversationId(state, ownerWebContents, activeConversationId);
  if (active) return active;

  const candidates = [];
  for (const entry of state.webContentsEntries.values()) {
    const wc = entry.wc;
    if (!wc || wc.isDestroyed?.() || !isLikelyBrowserContent(wc)) continue;

    const pageState = findBrowserPageForWebContentsId(wc.id, ownerWebContents);
    if (!pageStateBelongsToOwner(pageState, ownerWebContents)) continue;
    candidates.push(entry);
  }

  const hintedUrl = typeof hints?.browserUrl === "string" ? normalizeBrowserUrl(hints.browserUrl) : null;
  if (hintedUrl) {
    const urlMatch = candidates.find((entry) => normalizeBrowserUrl(entry.wc?.getURL?.() ?? "") === hintedUrl);
    if (urlMatch) return urlMatch;
  }

  return (
    candidates.find((entry) => entry.inlineDevTools && !entry.inlineDevTools.disposed) ??
    candidates.find((entry) => entry.wc?.isFocused?.()) ??
    candidates[0] ??
    null
  );
}

function getOrCreateWebContentsEntryById(state, webContentsId) {
  const existing = state.webContentsEntries.get(webContentsId);
  if (existing) return existing;

  try {
    const { webContents } = require("electron");
    const wc = webContents.fromId?.(webContentsId);
    return wc ? ensureWebContentsEntry(state, wc) : null;
  } catch {
    return null;
  }
}

function browserEntryBelongsToOwner(entry, ownerWebContents, pageState = null) {
  const wc = entry?.wc;
  if (!wc || wc.isDestroyed?.() || !isLikelyBrowserContent(wc)) return false;
  if (pageState) return pageStateBelongsToOwner(pageState, ownerWebContents);

  const ownerWindow = getOwnerWindowForWebContents(ownerWebContents);
  const browserOwnerWindow = getBrowserOwnerWindow(wc);
  return !!ownerWindow && !!browserOwnerWindow && ownerWindow.id === browserOwnerWindow.id;
}

function normalizeBrowserUrl(url) {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function findBrowserEntryForConversationId(state, ownerWebContents, conversationId) {
  if (typeof conversationId !== "string" || conversationId.length === 0) return null;

  const manager = getBrowserSidebarManager(ownerWebContents);
  const methods = [
    "findPageStateForConversationId",
    "findPageForConversationId",
    "getPageStateForConversationId",
    "getPageForConversationId",
    "getPageState",
    "getThreadPageState",
  ];

  for (const method of methods) {
    if (typeof manager?.[method] !== "function") continue;
    let pageState = null;
    try {
      pageState = manager[method](conversationId);
    } catch {
      /* non-critical */
    }
    if (!pageState) {
      try {
        pageState = manager[method](ownerWebContents, conversationId);
      } catch {
        /* non-critical */
      }
    }

    const webContentsId = getPageStateWebContentsId(pageState);
    if (webContentsId != null) {
      const entry = state.webContentsEntries.get(webContentsId);
      if (entry && pageStateBelongsToOwner(pageState, ownerWebContents)) return entry;
    }
  }

  const windowPageState = getBrowserPageStateFromOwnerWindowState(ownerWebContents, conversationId);
  const windowWebContentsId = getPageStateWebContentsId(windowPageState);
  if (windowWebContentsId != null) {
    const entry = state.webContentsEntries.get(windowWebContentsId);
    if (entry && pageStateBelongsToOwner(windowPageState, ownerWebContents)) return entry;
  }

  for (const entry of state.webContentsEntries.values()) {
    const wc = entry.wc;
    if (!wc || wc.isDestroyed?.() || !isLikelyBrowserContent(wc)) continue;
    const pageState = findBrowserPageForWebContentsId(wc.id, ownerWebContents);
    if (!pageStateBelongsToOwner(pageState, ownerWebContents)) continue;
    if (getPageStateConversationId(pageState) === conversationId) return entry;
  }

  return null;
}

function getActiveBrowserConversationIdForOwner(ownerWebContents) {
  const manager = getBrowserSidebarManager(ownerWebContents);
  const windowState = getBrowserWindowStateForOwner(manager, ownerWebContents);
  return typeof windowState?.activeConversationId === "string" ? windowState.activeConversationId : null;
}

function getBrowserPageStateFromOwnerWindowState(ownerWebContents, conversationId) {
  const manager = getBrowserSidebarManager(ownerWebContents);
  const windowState = getBrowserWindowStateForOwner(manager, ownerWebContents);
  const threadState =
    typeof windowState?.threads?.get === "function" ? windowState.threads.get(conversationId) : null;
  const page = threadState?.page ?? null;
  return page ? { conversationId, page, threadState, windowState } : null;
}

function getBrowserWindowStateForOwner(manager, ownerWebContents) {
  if (!manager || !ownerWebContents || ownerWebContents.isDestroyed?.()) return null;
  const methods = ["getCurrentWindowState", "ensureCurrentWindowState"];
  for (const method of methods) {
    if (typeof manager?.[method] !== "function") continue;
    try {
      const windowState = manager[method](ownerWebContents);
      if (windowState) return windowState;
    } catch {
      /* non-critical */
    }
  }
  return null;
}

function getPageStateWebContentsId(pageState) {
  const candidates = [
    pageState?.webContentsId,
    pageState?.browserWebContentsId,
    pageState?.webContents?.id,
    pageState?.view?.webContents?.id,
    pageState?.view?.webContentsId,
    pageState?.page?.webContentsId,
    pageState?.page?.webContents?.id,
    pageState?.page?.view?.webContents?.id,
    pageState?.page?.view?.webContentsId,
    pageState?.threadState?.webContentsId,
    pageState?.windowState?.webContentsId,
    pageState?.windowState?.webContents?.id,
  ];

  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return null;
}

function getPageStateConversationId(pageState) {
  const candidates = [
    pageState?.conversationId,
    pageState?.browserConversationId,
    pageState?.page?.conversationId,
    pageState?.threadState?.conversationId,
    pageState?.thread?.conversationId,
    pageState?.windowState?.conversationId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function getBaseConversationIdForBrowserTab(conversationId) {
  if (typeof conversationId !== "string") return null;
  const marker = ":browser:";
  const markerIndex = conversationId.indexOf(marker);
  if (markerIndex <= 0) return null;
  return conversationId.slice(0, markerIndex);
}

function pageStateBelongsToOwner(pageState, ownerWebContents) {
  if (!pageState) return false;
  const owner =
    pageState?.windowState?.owner ??
    pageState?.ownerWebContents ??
    pageState?.owner ??
    null;
  return !owner || owner.id === ownerWebContents.id;
}

function goBrowserHistory(state, ownerWebContents, direction) {
  const shortcutState = getShortcutState(state, ownerWebContents);
  const conversationId = shortcutState?.rightPanelBrowserConversationId;
  if (typeof conversationId !== "string" || conversationId.length === 0) return false;

  const manager = getBrowserSidebarManager(ownerWebContents);
  if (!manager) return false;

  if (direction === "back" && typeof manager.goBack === "function") {
    manager.goBack(ownerWebContents, conversationId);
    return true;
  }

  if (direction === "forward" && typeof manager.goForward === "function") {
    manager.goForward(ownerWebContents, conversationId);
    return true;
  }

  return false;
}

function goBrowserHistoryForFocusedRightPanel(state, ownerWebContents, direction) {
  const shortcutState = getShortcutState(state, ownerWebContents);
  if (shortcutState?.focusArea !== "right-panel") return false;
  return goBrowserHistory(state, ownerWebContents, direction);
}

function switchRightPanelBrowserTabByOrdinal(browserWebContents, ordinal) {
  const pageState = findBrowserPageForWebContentsId(browserWebContents.id);
  const owner = pageState?.windowState?.owner;
  if (!owner || owner.isDestroyed?.()) return false;

  sendActivateRightPanelTab(owner, ordinal);
  return true;
}

function switchFocusedRightPanelTabByOrdinal(state, ownerWebContents, ordinal) {
  const shortcutState = getShortcutState(state, ownerWebContents);
  if (shortcutState?.focusArea !== "right-panel") return false;

  sendActivateRightPanelTab(ownerWebContents, ordinal);
  return true;
}

function sendActivateRightPanelTab(ownerWebContents, ordinal) {
  ownerWebContents.send(MESSAGE_FOR_VIEW, {
    type: "better-browser-activate-right-tab",
    index: ordinal,
  });
}

function getShortcutState(state, ownerWebContents) {
  const services = getServices();
  return (
    services?.windowManager?.getAppShellShortcutState?.(ownerWebContents.id) ??
    state.shortcutStateByWebContentsId.get(ownerWebContents.id) ??
    null
  );
}

function getBrowserSidebarManager(ownerWebContents) {
  const services = getServices();
  const context =
    ownerWebContents && typeof services?.getContextForWebContents === "function"
      ? services.getContextForWebContents(ownerWebContents)
      : null;

  return (
    context?.getBrowserSidebarManager?.() ??
    context?.browserSidebarManager ??
    services?.browserSidebarManager ??
    services?.windowManager?.browserSidebarManager ??
    services?.getContext?.("local")?.getBrowserSidebarManager?.() ??
    services?.getContext?.("local")?.browserSidebarManager ??
    null
  );
}

function getBrowserSidebarManagers(ownerWebContents = null) {
  const services = getServices();
  const managers = [];
  const seen = new Set();
  const add = (manager) => {
    if (!manager || typeof manager !== "object" || seen.has(manager)) return;
    seen.add(manager);
    managers.push(manager);
  };

  add(getBrowserSidebarManager(ownerWebContents));
  add(services?.browserSidebarManager);
  add(services?.windowManager?.browserSidebarManager);
  add(services?.getContext?.("local")?.getBrowserSidebarManager?.());
  add(services?.getContext?.("local")?.browserSidebarManager);

  const contexts = services?.contextsByHostId;
  if (contexts && typeof contexts.values === "function") {
    for (const context of contexts.values()) {
      add(context?.getBrowserSidebarManager?.());
      add(context?.browserSidebarManager);
    }
  }

  return managers;
}

function findBrowserPageForWebContentsId(webContentsId, ownerWebContents = null) {
  for (const manager of getBrowserSidebarManagers(ownerWebContents)) {
    if (typeof manager.findPageStateForWebContentsId !== "function") continue;
    try {
      const pageState = manager.findPageStateForWebContentsId(webContentsId);
      if (pageState) return pageState;
    } catch {
      /* non-critical */
    }
  }
  return null;
}

function getServices() {
  const services = globalThis[SERVICES_KEY];
  return services && typeof services === "object" ? services : null;
}

function isLikelyBrowserContent(wc) {
  if (findBrowserPageForWebContentsId(wc.id) != null) return true;

  const url = wc.getURL?.() ?? "";
  if (!url) return false;
  if (url.startsWith("app://") || url.startsWith("devtools://")) return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  return /^(https?|file|about):/i.test(url);
}

function isDevToolsShortcut(input) {
  if (input?.type !== "keyDown") return false;
  const keyIsI = input.code === "KeyI" || String(input.key ?? "").toLowerCase() === "i";
  const keyIsF12 = input.code === "F12" || input.key === "F12";
  if (keyIsF12 && !input.control && !input.meta && !input.alt && !input.shift) return true;
  if (!keyIsI) return false;

  if (process.platform === "darwin") {
    return input.meta === true && input.alt === true && !input.control && !input.shift;
  }

  return input.control === true && input.shift === true && !input.meta && !input.alt;
}

function isAppShellContent(wc) {
  const url = wc.getURL?.() ?? "";
  return url.startsWith("app://-/index.html");
}

function isInjectablePageUrl(url) {
  if (!url) return false;
  if (url.startsWith("app://") || url.startsWith("devtools://")) return false;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return false;
  return /^(https?|file|about):/i.test(url);
}

function isBrowserHistoryShortcut(input) {
  if (input?.type !== "keyDown") return false;
  if (input.alt || input.shift) return false;

  const isMac = process.platform === "darwin";
  const modifierOk = isMac
    ? input.meta === true && input.control !== true
    : input.control === true && input.meta !== true;

  return modifierOk && (isBackInput(input) || isForwardInput(input));
}

function getRightPanelTabShortcutOrdinal(input) {
  if (input?.type !== "keyDown") return null;
  const hasTabModifier = input.control === true || input.meta === true;
  if (
    !hasTabModifier ||
    (input.control === true && input.meta === true) ||
    input.alt === true ||
    input.shift === true
  ) {
    return null;
  }

  const codeMatch = /^Digit([1-9])$/.exec(input.code ?? "");
  const keyMatch = /^[1-9]$/.exec(input.key ?? "");
  const ordinal = Number(codeMatch?.[1] ?? keyMatch?.[0] ?? NaN);
  return Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 9 ? ordinal : null;
}

function isBackInput(input) {
  return (
    input.key === "[" ||
    input.code === "BracketLeft" ||
    input.key === "ArrowLeft" ||
    input.key === "Left" ||
    input.code === "ArrowLeft"
  );
}

function isForwardInput(input) {
  return (
    input.key === "]" ||
    input.code === "BracketRight" ||
    input.key === "ArrowRight" ||
    input.key === "Right" ||
    input.code === "ArrowRight"
  );
}

function browserGestureInjectionScript(wc) {
  const canBack = !!wc.canGoBack?.();
  const canForward = !!wc.canGoForward?.();
  return `window.__codexppBetterBrowserGestureState={canBack:${JSON.stringify(canBack)},canForward:${JSON.stringify(canForward)}};\n${BROWSER_SWIPE_SCRIPT}`;
}

const BROWSER_SWIPE_SCRIPT = `(() => {
  const flag = "__codexppBetterBrowserGesturesV2";
  if (window[flag]?.version === 3) return;
  Object.defineProperty(window, flag, { configurable: true, value: { version: 3 } });

  const threshold = 125;
  const minDelta = 18;
  const cooldownMs = 620;
  let accumulatedX = 0;
  let lastNavigationAt = 0;
  let resetTimer = 0;
  let hideTimer = 0;
  let ui = null;

  const historyGuardKey = "__codexppBetterBrowserGestureHistoryGuard";
  const historyGuard = window[historyGuardKey] || {
    back: null,
    forward: null,
    installed: false,
    suppressBackUntil: 0,
    suppressForwardUntil: 0,
  };

  if (!window[historyGuardKey]) {
    try {
      Object.defineProperty(window, historyGuardKey, {
        configurable: true,
        value: historyGuard,
      });
    } catch {
      window[historyGuardKey] = historyGuard;
    }
  }

  if (!historyGuard.installed) {
    try {
      historyGuard.back = window.history.back.bind(window.history);
      historyGuard.forward = window.history.forward.bind(window.history);
      window.history.back = (...args) => {
        if (Date.now() < historyGuard.suppressBackUntil) return undefined;
        return historyGuard.back(...args);
      };
      window.history.forward = (...args) => {
        if (Date.now() < historyGuard.suppressForwardUntil) return undefined;
        return historyGuard.forward(...args);
      };
      historyGuard.installed = true;
    } catch {
    }
  }

  const applyStyle = (element, styles) => {
    for (const [key, value] of Object.entries(styles)) element.style[key] = value;
  };

  const getGestureState = () => {
    const state = window.__codexppBetterBrowserGestureState;
    return {
      canBack: state?.canBack === true,
      canForward: state?.canForward === true,
    };
  };

  const canNavigate = (direction) => {
    const state = getGestureState();
    return direction === "back" ? state.canBack : state.canForward;
  };

  const suppressLegacyNavigation = (direction) => {
    const until = Date.now() + cooldownMs + 180;
    if (direction === "back") historyGuard.suppressBackUntil = until;
    else historyGuard.suppressForwardUntil = until;
  };

  const navigate = (direction) => {
    suppressLegacyNavigation(direction);
    try {
      if (direction === "back") {
        if (typeof historyGuard.back === "function") historyGuard.back();
        else window.history.back();
      } else if (typeof historyGuard.forward === "function") {
        historyGuard.forward();
      } else {
        window.history.forward();
      }
    } catch {
    }
  };

  const ensureUi = () => {
    if (ui != null) return ui;
    const root = document.documentElement || document.body;
    if (!root) return null;

    const host = document.createElement("div");
    host.setAttribute("data-codexpp-better-browser-gesture-ui", "");
    applyStyle(host, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
      fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    });

    const rail = document.createElement("div");
    applyStyle(rail, {
      position: "fixed",
      top: "calc(50% - 54px)",
      width: "4px",
      height: "108px",
      borderRadius: "999px",
      background: "rgba(16, 163, 127, 0)",
      boxShadow: "0 0 28px rgba(16, 163, 127, 0)",
      opacity: "0",
      transition: "opacity 120ms ease, background 120ms ease, box-shadow 120ms ease",
    });

    const pill = document.createElement("div");
    applyStyle(pill, {
      position: "fixed",
      top: "50%",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      minWidth: "148px",
      height: "54px",
      boxSizing: "border-box",
      padding: "0 16px 0 12px",
      border: "1px solid rgba(255, 255, 255, 0.16)",
      borderRadius: "16px",
      background: "linear-gradient(180deg, rgba(25, 28, 32, 0.94), rgba(15, 17, 20, 0.9))",
      boxShadow: "0 14px 38px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
      color: "white",
      opacity: "0",
      transform: "translate3d(0, -50%, 0) scale(0.96)",
      transition: "opacity 120ms ease, transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
      backdropFilter: "blur(18px) saturate(1.2)",
      WebkitBackdropFilter: "blur(18px) saturate(1.2)",
    });

    const arrow = document.createElement("div");
    applyStyle(arrow, {
      display: "grid",
      placeItems: "center",
      width: "30px",
      height: "30px",
      borderRadius: "10px",
      background: "rgba(255, 255, 255, 0.13)",
      color: "white",
      fontSize: "20px",
      lineHeight: "1",
      fontWeight: "700",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.12)",
    });

    const content = document.createElement("div");
    applyStyle(content, {
      display: "grid",
      gap: "6px",
      minWidth: "82px",
    });

    const label = document.createElement("div");
    applyStyle(label, {
      fontSize: "12px",
      fontWeight: "700",
      lineHeight: "1",
      letterSpacing: "0",
      textTransform: "uppercase",
    });

    const hint = document.createElement("div");
    applyStyle(hint, {
      color: "rgba(255, 255, 255, 0.62)",
      fontSize: "11px",
      fontWeight: "500",
      lineHeight: "1",
      letterSpacing: "0",
    });

    const track = document.createElement("div");
    applyStyle(track, {
      width: "82px",
      height: "4px",
      overflow: "hidden",
      borderRadius: "999px",
      background: "rgba(255, 255, 255, 0.16)",
    });

    const bar = document.createElement("div");
    applyStyle(bar, {
      width: "100%",
      height: "100%",
      borderRadius: "inherit",
      background: "rgb(16, 163, 127)",
      transform: "scaleX(0)",
      transformOrigin: "left center",
      transition: "transform 80ms linear",
    });

    track.appendChild(bar);
    content.append(label, hint, track);
    pill.append(arrow, content);
    host.append(rail, pill);
    root.appendChild(host);
    ui = { arrow, bar, hint, host, label, pill, rail };
    return ui;
  };

  const hideGesture = () => {
    if (ui == null) return;
    ui.pill.style.opacity = "0";
    ui.pill.style.transform = "translate3d(0, -50%, 0) scale(0.96)";
    ui.rail.style.opacity = "0";
  };

  const showGesture = (direction, progress, triggered) => {
    const indicator = ensureUi();
    if (indicator == null) return;
    const clamped = Math.max(0, Math.min(1, progress));
    const isBack = direction === "back";
    const offset = isBack ? -10 + clamped * 10 : 10 - clamped * 10;
    const opacity = Math.min(0.98, 0.26 + clamped * 0.72);
    indicator.pill.style.left = isBack ? "16px" : "";
    indicator.pill.style.right = isBack ? "" : "16px";
    indicator.pill.style.borderColor = triggered ? "rgba(16, 163, 127, 0.72)" : "rgba(255, 255, 255, 0.16)";
    indicator.pill.style.boxShadow = triggered
      ? "0 16px 44px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(16, 163, 127, 0.24), 0 0 34px rgba(16, 163, 127, 0.26)"
      : "0 14px 38px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08)";
    indicator.pill.style.opacity = String(opacity);
    indicator.pill.style.transform = "translate3d(" + offset + "px, -50%, 0) scale(" + (0.96 + clamped * 0.04) + ")";
    indicator.rail.style.left = isBack ? "0" : "";
    indicator.rail.style.right = isBack ? "" : "0";
    indicator.rail.style.opacity = String(Math.min(0.9, 0.15 + clamped * 0.75));
    indicator.rail.style.background = "rgba(16, 163, 127, " + (0.2 + clamped * 0.55) + ")";
    indicator.rail.style.boxShadow = "0 0 " + (12 + clamped * 22) + "px rgba(16, 163, 127, " + (0.18 + clamped * 0.34) + ")";
    indicator.arrow.textContent = isBack ? "<" : ">";
    indicator.label.textContent = isBack ? "Back" : "Forward";
    indicator.hint.textContent = triggered ? "Navigating" : Math.round(clamped * 100) + "%";
    indicator.bar.style.transformOrigin = isBack ? "right center" : "left center";
    indicator.bar.style.transform = "scaleX(" + clamped + ")";

    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideGesture, triggered ? 380 : 220);
  };

  window.addEventListener("wheel", (event) => {
    if (event.defaultPrevented) return;
    if (Math.abs(event.deltaX) < minDelta) return;
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.35) return;

    accumulatedX += event.deltaX;
    const direction = accumulatedX < 0 ? "back" : "forward";
    if (!canNavigate(direction)) {
      suppressLegacyNavigation(direction);
      accumulatedX = 0;
      hideGesture();
      return;
    }

    const progress = Math.abs(accumulatedX) / threshold;
    showGesture(direction, progress, false);

    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      accumulatedX = 0;
      hideGesture();
    }, 220);

    const now = Date.now();
    if (now - lastNavigationAt < cooldownMs || Math.abs(accumulatedX) < threshold) return;

    accumulatedX = 0;
    lastNavigationAt = now;
    showGesture(direction, 1, true);
    navigate(direction);
  }, { capture: true, passive: true });
})();`;

const APP_SHELL_RIGHT_TAB_SHORTCUT_SCRIPT = `(() => {
  const flag = "__codexppBetterBrowserRightTabShortcuts";
  const existing = window[flag];
  if (existing && existing.version === 5) return;
  try {
    delete window[flag];
  } catch {
  }
  Object.defineProperty(window, flag, { configurable: true, value: { version: 5 } });

  let rightPanelHadRecentFocus = false;

  const getRightTabs = () =>
    Array.from(document.querySelectorAll('[data-app-shell-tab-controller="right"][data-tab-id]'))
      .filter((element) => element instanceof HTMLElement);

  const getReactProps = (element) => {
    const key = Object.keys(element).find((key) => key.startsWith("__reactProps"));
    return key == null ? null : element[key];
  };

  const callReactMouseDown = (element) => {
    const props = getReactProps(element);
    if (typeof props?.onMouseDown !== "function") return false;
    props.onMouseDown({
      button: 0,
      buttons: 1,
      currentTarget: element,
      target: element,
      nativeEvent: {},
      preventDefault() {},
      stopPropagation() {},
    });
    return true;
  };

  const activateTabElement = (tab) => {
    const tabButton = tab.querySelector('button[role="tab"]');
    if (tabButton instanceof HTMLElement && callReactMouseDown(tabButton)) return true;

    const activator = tab.querySelector('[role="button"][tabindex]') ?? tab;
    if (activator instanceof HTMLElement) {
      const props = getReactProps(activator);
      if (typeof props?.onPointerDown === "function") {
        const rect = activator.getBoundingClientRect();
        props.onPointerDown({
          button: 0,
          buttons: 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          currentTarget: activator,
          target: activator,
          nativeEvent: {},
          preventDefault() {},
          stopPropagation() {},
        });
        return true;
      }
      activator.click();
      return true;
    }

    return false;
  };

  const activateOrdinal = (ordinal) => {
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 9) return false;
    const tabs = getRightTabs();
    if (tabs.length === 0) return false;
    const tab = tabs[ordinal - 1];
    if (!(tab instanceof HTMLElement)) return false;
    return activateTabElement(tab);
  };

  const rightPanelHasDomFocus = (target) => {
    if (target instanceof Element && target.closest('[data-app-shell-focus-area="right-panel"], [data-app-shell-tab-controller="right"]')) {
      rightPanelHadRecentFocus = true;
      return true;
    }
    if (document.querySelector('[data-app-shell-focus-area="right-panel"]:focus-within') != null) {
      rightPanelHadRecentFocus = true;
      return true;
    }
    return rightPanelHadRecentFocus && document.hasFocus();
  };

  const shortcutOrdinal = (event) => {
    const hasTabModifier = event.ctrlKey || event.metaKey;
    if (!hasTabModifier || (event.ctrlKey && event.metaKey) || event.altKey || event.shiftKey) return null;
    if (/^Digit[1-9]$/.test(event.code)) return Number(event.code.slice(5));
    if (/^[1-9]$/.test(event.key)) return Number(event.key);
    return null;
  };

  const rememberRightPanelFocus = (event) => {
    rightPanelHadRecentFocus = event.target instanceof Element && event.target.closest('[data-app-shell-focus-area="right-panel"], [data-app-shell-tab-controller="right"]') != null;
  };

  window.addEventListener("focusin", rememberRightPanelFocus, true);
  window.addEventListener("pointerdown", rememberRightPanelFocus, true);

  window.addEventListener("keydown", (event) => {
    const ordinal = shortcutOrdinal(event);
    if (ordinal == null || !rightPanelHasDomFocus(event.target)) return;
    if (activateOrdinal(ordinal)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.type !== "better-browser-activate-right-tab") return;
    const ordinal = Number(message.index);
    if (activateOrdinal(ordinal)) {
      event.stopImmediatePropagation?.();
    }
  });
})();`;

const APP_SHELL_DEVTOOLS_DOCK_MENU_SCRIPT = `(() => {
  const flag = "__codexppBetterBrowserDevToolsDockMenu";
  const existing = window[flag];
  if (existing && existing.version === 11) return;
  if (existing && typeof existing.disconnect === "function") {
    try {
      existing.disconnect();
    } catch {
    }
  }

  const marker = "data-codexpp-better-browser-devtools-dock-menu";
  const toggleMarker = "data-codexpp-better-browser-devtools-toggle";
  const toggleSlotMarker = "data-codexpp-better-browser-devtools-toggle-slot";
  const itemSelector = '[role="menuitem"], [data-radix-collection-item], [cmdk-item], button';
  const dockOptions = [
    ["left", "Dock left"],
    ["bottom", "Dock bottom"],
    ["right", "Dock right"],
  ];
  const themeOptions = [
    ["dark", "Dark"],
    ["light", "Light"],
  ];

  const state = {
    version: 11,
    dock: "bottom",
    open: false,
    theme: window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light",
    disconnect() {},
  };

  try {
    Object.defineProperty(window, flag, { configurable: true, value: state });
  } catch {
    window[flag] = state;
  }

  const textOf = (element) => [
    element.getAttribute?.("aria-label") || "",
    element.getAttribute?.("title") || "",
    element.textContent || "",
  ].join(" ").replace(/\\s+/g, " ").trim();

  const controlLabelOf = (element) =>
    [element.getAttribute?.("aria-label") || "", element.getAttribute?.("title") || ""]
      .join(" ")
      .replace(/\\s+/g, " ")
      .trim();

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const isBrowserToolsText = (text) =>
    /hard reload/i.test(text) ||
    /show device toolbar/i.test(text) ||
    /clear cookies/i.test(text) ||
    /clear cache/i.test(text) ||
    /^zoom\\b/i.test(text);

  const rootFor = (item) => {
    const menu = item.closest('[role="menu"], [data-radix-menu-content]');
    if (menu) return menu;
    const wrapper = item.closest('[data-radix-popper-content-wrapper]');
    return wrapper?.querySelector?.('[role="menu"], [data-radix-menu-content]') ?? null;
  };

  const sendMessage = (type, payload = {}) => {
    try {
      const bridge = window.electronBridge;
      if (typeof bridge?.sendMessageFromView !== "function") return;
      Promise.resolve(
        bridge.sendMessageFromView({
          ...payload,
          type,
        }),
      ).catch(() => {});
    } catch {
    }
  };

  const collectWebviews = () => {
    const webviews = [];
    const seen = new Set();
    const visit = (root) => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      try {
        for (const webview of root.querySelectorAll?.("webview") ?? []) {
          if (!seen.has(webview)) {
            seen.add(webview);
            webviews.push(webview);
          }
        }
        for (const element of root.querySelectorAll?.("*") ?? []) {
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      } catch {
      }
    };
    visit(document);
    return webviews;
  };

  const browserHint = () => {
    const webviews = collectWebviews();
    const visible = webviews.find((webview) => {
      if (!(webview instanceof HTMLElement)) return false;
      const rect = webview.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1 || rect.x < -1000 || rect.y < -1000) return false;
      const style = window.getComputedStyle(webview);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    const webview = visible || (webviews.length === 1 ? webviews[0] : null);
    let browserWebContentsId = null;
    try {
      if (typeof webview?.getWebContentsId === "function") browserWebContentsId = webview.getWebContentsId();
    } catch {
    }
    return {
      browserConversationId: webview?.getAttribute?.("data-browser-sidebar-conversation-id") || null,
      browserWebContentsId,
      browserUrl: webview?.getAttribute?.("src") || null,
    };
  };

  const sendDock = (dock) => sendMessage("better-browser-devtools-dock", { ...browserHint(), dock });
  const sendTheme = (theme) => sendMessage("better-browser-theme", { ...browserHint(), theme });
  const toggleDevTools = () => sendMessage("better-browser-devtools-toggle", browserHint());
  const requestState = () => sendMessage("better-browser-devtools-state-request", browserHint());
  const chooseDock = (dock) => {
    sendDock(dock);
    state.dock = dock;
    updateDockRows();
    closeMenu();
  };
  const chooseTheme = (theme) => {
    sendTheme(theme);
    state.theme = theme;
    updateThemeRows();
    closeMenu();
  };

  const closeMenu = () => {
    try {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "Escape",
          key: "Escape",
        }),
      );
    } catch {
    }
  };

  const dockIcon = (dock) => {
    if (dock === "left") {
      return '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="4.8" y="4.8" width="4.8" height="10.4" rx="1" fill="currentColor"/></svg>';
    }
    if (dock === "right") {
      return '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="10.4" y="4.8" width="4.8" height="10.4" rx="1" fill="currentColor"/></svg>';
    }
    return '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="4.8" y="10.4" width="10.4" height="4.8" rx="1" fill="currentColor"/></svg>';
  };

  const inspectIcon = () =>
    '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><path d="M4.5 4.5h11v11h-11z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 8l5.5 2-2.25 1.05L10.2 13.4 8 8z" fill="currentColor"/></svg>';

  const themeIcon = (theme) =>
    theme === "dark"
      ? '<svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14"><path d="M14.7 12.9A6.7 6.7 0 0 1 7.1 5.3a6 6 0 1 0 7.6 7.6z" fill="currentColor"/></svg>'
      : '<svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14"><circle cx="10" cy="10" r="3.2" fill="currentColor"/><path d="M10 2.7v2M10 15.3v2M3.8 3.8l1.4 1.4M14.8 14.8l1.4 1.4M2.7 10h2M15.3 10h2M3.8 16.2l1.4-1.4M14.8 5.2l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const makeSeparator = () => {
    const separator = document.createElement("div");
    separator.setAttribute(marker, "separator");
    separator.setAttribute("role", "separator");
    separator.style.cssText =
      "height:1px;margin:4px 8px;background:var(--color-token-border-default,rgba(255,255,255,.12));opacity:.9;";
    return separator;
  };

  const makeDockButton = (dock, label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codexppBetterBrowserDevtoolsDock = dock;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = dockIcon(dock);
    button.style.cssText =
      "display:grid;place-items:center;width:26px;height:22px;border:0;border-radius:5px;background:transparent;color:var(--color-token-text-secondary,currentColor);cursor:pointer;";
    const refresh = () => {
      const active = state.dock === dock;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.style.background = active
        ? "color-mix(in srgb, var(--color-token-text-link-foreground,currentColor) 16%, transparent)"
        : "transparent";
      button.style.color = active
        ? "var(--color-token-text-link-foreground,currentColor)"
        : "var(--color-token-text-secondary,currentColor)";
    };
    button.addEventListener("mouseenter", refresh);
    button.addEventListener("mouseleave", refresh);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      chooseDock(dock);
    });
    refresh();
    return button;
  };

  const makeDockRow = (base) => {
    const row = base.cloneNode(false);
    row.removeAttribute("id");
    row.removeAttribute("disabled");
    row.removeAttribute("aria-disabled");
    row.setAttribute(marker, "row");
    row.setAttribute("role", "menuitem");
    row.setAttribute("tabindex", "-1");
    row.style.cssText += ";" + [
      "display:flex",
      "flex-direction:row",
      "align-items:center",
      "justify-content:space-between",
      "gap:12px",
      "width:100%",
      "box-sizing:border-box",
      "cursor:default",
      "user-select:none",
      "background:transparent",
    ].join(";");

    const label = document.createElement("span");
    label.textContent = "Dock DevTools";
    label.style.cssText = "display:block;min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

    const controls = document.createElement("span");
    controls.style.cssText = "display:inline-flex;flex:0 0 auto;align-items:center;justify-content:flex-end;gap:2px;margin-left:auto;white-space:nowrap;";
    for (const [dock, buttonLabel] of dockOptions) {
      controls.appendChild(makeDockButton(dock, buttonLabel));
    }

    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    row.addEventListener("mouseenter", () => {
      row.style.background = "transparent";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "transparent";
    });
    row.append(label, controls);
    return row;
  };

  const makeThemeButton = (theme, label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.codexppBetterBrowserTheme = theme;
    button.setAttribute("aria-label", label + " theme");
    button.title = label + " theme";
    button.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px">' + themeIcon(theme) + '<span>' + label + '</span></span>';
    button.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;height:22px;min-width:52px;padding:0 7px;border:0;border-radius:5px;background:transparent;color:var(--color-token-text-secondary,currentColor);font:inherit;font-size:12px;line-height:1;cursor:pointer;";
    const refresh = () => {
      const active = state.theme === theme;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.style.background = active
        ? "color-mix(in srgb, var(--color-token-text-link-foreground,currentColor) 16%, transparent)"
        : "transparent";
      button.style.color = active
        ? "var(--color-token-text-link-foreground,currentColor)"
        : "var(--color-token-text-secondary,currentColor)";
    };
    button.addEventListener("mouseenter", refresh);
    button.addEventListener("mouseleave", refresh);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      chooseTheme(theme);
    });
    refresh();
    return button;
  };

  const makeThemeRow = (base) => {
    const row = base.cloneNode(false);
    row.removeAttribute("id");
    row.removeAttribute("disabled");
    row.removeAttribute("aria-disabled");
    row.setAttribute(marker, "theme-row");
    row.setAttribute("role", "menuitem");
    row.setAttribute("tabindex", "-1");
    row.style.cssText += ";" + [
      "display:flex",
      "flex-direction:row",
      "align-items:center",
      "justify-content:space-between",
      "gap:12px",
      "width:100%",
      "box-sizing:border-box",
      "cursor:default",
      "user-select:none",
      "background:transparent",
    ].join(";");

    const label = document.createElement("span");
    label.textContent = "Theme";
    label.style.cssText = "display:block;min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

    const controls = document.createElement("span");
    controls.style.cssText = "display:inline-flex;flex:0 0 auto;align-items:center;justify-content:flex-end;gap:2px;margin-left:auto;white-space:nowrap;";
    for (const [theme, buttonLabel] of themeOptions) {
      controls.appendChild(makeThemeButton(theme, buttonLabel));
    }

    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    row.addEventListener("mouseenter", () => {
      row.style.background = "transparent";
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "transparent";
    });
    row.append(label, controls);
    return row;
  };

  const installIntoMenu = (items) => {
    const target =
      items.find((item) => /show device toolbar/i.test(textOf(item))) ||
      items.find((item) => /hard reload/i.test(textOf(item))) ||
      items.find((item) => /^zoom\\b/i.test(textOf(item))) ||
      items[0];
    if (!(target instanceof HTMLElement) || !target.parentElement) return false;

    const menuRoot = rootFor(target) || target.parentElement;
    if (menuRoot.querySelector("[" + marker + "]")) return false;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(makeSeparator());
    fragment.appendChild(makeThemeRow(target));
    fragment.appendChild(makeDockRow(target));
    target.after(fragment);
    updateDockRows();
    updateThemeRows();
    return true;
  };

  const updateDockRows = () => {
    for (const button of document.querySelectorAll("button[data-codexpp-better-browser-devtools-dock]")) {
      const active = button.dataset.codexppBetterBrowserDevtoolsDock === state.dock;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.style.background = active
        ? "color-mix(in srgb, var(--color-token-text-link-foreground,currentColor) 16%, transparent)"
        : "transparent";
      button.style.color = active
        ? "var(--color-token-text-link-foreground,currentColor)"
        : "var(--color-token-text-secondary,currentColor)";
    }
  };

  const updateThemeRows = () => {
    for (const button of document.querySelectorAll("button[data-codexpp-better-browser-theme]")) {
      const active = button.dataset.codexppBetterBrowserTheme === state.theme;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.style.background = active
        ? "color-mix(in srgb, var(--color-token-text-link-foreground,currentColor) 16%, transparent)"
        : "transparent";
      button.style.color = active
        ? "var(--color-token-text-link-foreground,currentColor)"
        : "var(--color-token-text-secondary,currentColor)";
    }
  };

  const updateToggleButtons = () => {
    for (const button of document.querySelectorAll("[" + toggleMarker + "]")) {
      button.setAttribute("aria-pressed", state.open ? "true" : "false");
      button.dataset.active = state.open ? "true" : "false";
      button.style.background = state.open
        ? "color-mix(in srgb, var(--color-token-text-link-foreground,currentColor) 16%, transparent)"
        : "";
      button.style.color = state.open ? "var(--color-token-text-link-foreground,currentColor)" : "";
    }
  };

  const makeToolbarButton = (base) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = base.className || "";
    button.setAttribute(toggleMarker, "");
    button.setAttribute("aria-label", "Inspect element");
    button.title = "Inspect element";
    button.innerHTML = inspectIcon();
    button.style.cssText += [
      "cursor:pointer",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "width:28px",
      "height:28px",
      "min-width:28px",
      "max-width:28px",
      "flex:0 0 28px",
    ].join(";");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleDevTools();
    });
    return button;
  };

  const makeToolbarSlot = (button) => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute(toggleSlotMarker, "");
    wrapper.className = "no-drag flex shrink-0 items-center justify-center";
    wrapper.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "width:28px",
      "height:28px",
      "min-width:28px",
      "max-width:28px",
      "flex:0 0 28px",
      "overflow:visible",
      "opacity:1",
      "transform:none",
      "position:relative",
      "z-index:1",
      "margin-inline-end:4px",
    ].join(";");
    wrapper.appendChild(button);
    return wrapper;
  };

  const installToolbarButton = () => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((element) => isVisible(element));
    const screenshot = candidates.find((element) =>
      /(^|\\b)take a screenshot(\\b|$)/i.test(controlLabelOf(element)),
    );
    const annotate = candidates.find((element) =>
      /(^|\\b)annotat(e|ing)(\\b|$)/i.test(controlLabelOf(element)),
    );
    const target = screenshot || annotate;
    if (!(target instanceof HTMLElement) || !target.parentElement) return;

    const slot = target.parentElement;
    const group = slot?.parentElement ?? target.parentElement;
    if (!(group instanceof HTMLElement)) return;

    if (group.querySelector("[" + toggleMarker + "]")) {
      updateToggleButtons();
      return;
    }

    const button = makeToolbarButton(target);
    if (slot instanceof HTMLElement && slot.parentElement === group) {
      slot.after(makeToolbarSlot(button));
    } else if (screenshot) {
      screenshot.after(makeToolbarSlot(button));
    } else {
      annotate.after(makeToolbarSlot(button));
    }
    updateToggleButtons();
    requestState();
  };

  const scan = () => {
    installToolbarButton();

    const groups = new Map();
    for (const item of Array.from(document.querySelectorAll(itemSelector))) {
      if (!isVisible(item)) continue;
      const text = textOf(item);
      if (!isBrowserToolsText(text)) continue;
      const root = rootFor(item);
      if (!root) continue;
      const group = groups.get(root) || [];
      group.push(item);
      groups.set(root, group);
    }

    for (const items of groups.values()) {
      const labels = items.map(textOf).join("\\n");
      const looksLikeBrowserToolsMenu =
        /hard reload/i.test(labels) &&
        (/show device toolbar/i.test(labels) || /clear cache/i.test(labels) || /clear cookies/i.test(labels));
      if (looksLikeBrowserToolsMenu) installIntoMenu(items);
    }
  };

  const handleMenuChoicePointer = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const dockButton = target?.closest?.("button[data-codexpp-better-browser-devtools-dock]") ?? null;
    const themeButton = target?.closest?.("button[data-codexpp-better-browser-theme]") ?? null;
    const button = dockButton || themeButton;
    if (!(button instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const dock = button.dataset.codexppBetterBrowserDevtoolsDock;
    const theme = button.dataset.codexppBetterBrowserTheme;
    if (typeof dock === "string") chooseDock(dock);
    else if (typeof theme === "string") chooseTheme(theme);
  };

  let pending = 0;
  const schedule = () => {
    if (pending) return;
    pending = window.requestAnimationFrame(() => {
      pending = 0;
      scan();
    });
  };

  const observer = new MutationObserver(schedule);
  document.querySelectorAll("[" + marker + "], [" + toggleMarker + "], [" + toggleSlotMarker + "]").forEach((element) => {
    element.remove();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("pointerdown", handleMenuChoicePointer, true);
  document.addEventListener("pointerdown", schedule, true);
  document.addEventListener("keydown", schedule, true);
  const handleHostMessage = (event) => {
    const message = event.data;
    if (message?.type !== "better-browser-devtools-state") return;
    state.open = message.open === true;
    if (typeof message.dock === "string") state.dock = message.dock;
    if (typeof message.theme === "string") state.theme = message.theme;
    updateDockRows();
    updateThemeRows();
    updateToggleButtons();
  };

  window.addEventListener("message", handleHostMessage);
  state.disconnect = () => {
    observer.disconnect();
    document.removeEventListener("pointerdown", handleMenuChoicePointer, true);
    document.removeEventListener("pointerdown", schedule, true);
    document.removeEventListener("keydown", schedule, true);
    window.removeEventListener("message", handleHostMessage);
    if (pending) window.cancelAnimationFrame(pending);
  };

  schedule();
})();`;

function shouldPatchRendererAsset(rawUrl) {
  return assetPatchKind(rawUrl) != null;
}

function assetPatchKind(rawUrl) {
  if (typeof rawUrl !== "string") return null;

  let basename;
  try {
    const pathname = new URL(rawUrl).pathname;
    basename = pathname.slice(pathname.lastIndexOf("/") + 1);
  } catch {
    return null;
  }

  if (/^use-model-settings-[A-Za-z0-9_]+\.js$/.test(basename)) {
    return "use-model-settings";
  }
  if (/^review-runtime-bridge-[A-Za-z0-9_]+\.js$/.test(basename)) {
    return "review-runtime-bridge";
  }
  if (/^app-shell-[A-Za-z0-9_]+\.js$/.test(basename)) {
    return "app-shell";
  }
  return null;
}

function loadPatchOverrides(api) {
  const userRoot = resolveCodexPlusPlusUserRoot();
  if (!userRoot) return { path: null, patchesById: new Map() };

  const path = require("node:path");
  const fs = require("node:fs");
  const overridePath = path.join(userRoot, PATCH_OVERRIDES_DIR, TWEAK_ID, PATCH_OVERRIDE_FILE);
  try {
    if (!fs.existsSync(overridePath)) {
      return { path: overridePath, patchesById: new Map() };
    }
    const parsed = JSON.parse(fs.readFileSync(overridePath, "utf8"));
    const patches = Array.isArray(parsed?.patches) ? parsed.patches : [];
    const patchesById = new Map();
    for (const patch of patches) {
      if (
        patch &&
        typeof patch.id === "string" &&
        typeof patch.asset === "string" &&
        typeof patch.anchor === "string" &&
        typeof patch.replacement === "string"
      ) {
        patchesById.set(patch.id, patch);
      }
    }
    return { path: overridePath, patchesById };
  } catch (error) {
    api?.log?.warn?.("failed to load smart-repatch overrides", stringifyError(error));
    return { path: overridePath, patchesById: new Map() };
  }
}

function resolveCodexPlusPlusUserRoot() {
  if (typeof process === "undefined") return null;
  if (process.env?.CODEX_PLUSPLUS_USER_ROOT) return process.env.CODEX_PLUSPLUS_USER_ROOT;
  if (process.env?.CODEX_PLUSPLUS_HOME) return process.env.CODEX_PLUSPLUS_HOME;

  try {
    const os = require("node:os");
    const path = require("node:path");
    const home = os.homedir();
    if (!home) return null;
    if (process.platform === "darwin") {
      return path.join(home, "Library", "Application Support", "codex-plusplus");
    }
    if (process.platform === "win32") {
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codex-plusplus");
    }
    return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "codex-plusplus");
  } catch {
    return null;
  }
}

function patchRendererAsset(rawUrl, source, state = null) {
  switch (assetPatchKind(rawUrl)) {
    case "use-model-settings":
      return patchUseModelSettings(source);
    case "review-runtime-bridge":
      return patchReviewRuntimeBridge(source, state);
    case "app-shell":
      return patchAppShell(source, state);
    default:
      return source;
  }
}

function patchUseModelSettings(source) {
  let out = source;

  out = replaceRequired(
    out,
    "l=t=>{r(n=>{let r={...n},i=r[e]??[],a=typeof t==`function`?t(i):t;return a.length===0?(r[e]===void 0||delete r[e],r):(r[e]=a,r)})}",
    "l=t=>{r(n=>{let r={...n},i=r[e]??[],a=typeof t==`function`?t(i):t,o=typeof e==`string`?e.indexOf(`:browser:`):-1,s=o>0?e.slice(0,o):null;if(a.length===0)return r[e]===void 0||delete r[e],s!=null&&delete r[s],r;return r[e]=a,s!=null&&(r[s]=a),r})}",
    "browser comments base conversation mirror",
  );

  out = replaceRequired(
    out,
    "x=l&&c?.tabId===iu.BROWSER,S=x&&u,C;",
    "x=l&&c?.tabId===e.tabId,S=x&&u,C;",
    "browser panel active-tab check",
  );

  out = replaceRequired(
    out,
    "children:(0,Y.jsx)(qL,{autoFocusOnOpen:!0,conversationId:n,cwd:a,hostDisplayName:r,rolloutPath:g,agentBrowserControlLabel:v,agentBrowserControlTurnId:b,isAgentControllingBrowser:m,isDeviceToolbarMenuItemVisible:d,isFloatingComposerMenuItemVisible:S,isFloatingComposerVisible:p,isVisible:x,onToggleFloatingComposer:C,transferSourceConversationId:i})",
    "children:(0,Y.jsxs)(Y.Fragment,{children:[(0,Y.jsx)(xje,{browserConversationId:n,browserTabFallbackTitle:`Browser`,isAgentWorking:o,transferSourceConversationId:i,browserTabId:e.tabId}),(0,Y.jsx)(qL,{autoFocusOnOpen:!0,conversationId:n,cwd:a,hostDisplayName:r,rolloutPath:g,agentBrowserControlLabel:v,agentBrowserControlTurnId:b,isAgentControllingBrowser:m,isDeviceToolbarMenuItemVisible:d,isFloatingComposerMenuItemVisible:S,isFloatingComposerVisible:p,isVisible:x,onToggleFloatingComposer:C,transferSourceConversationId:i})]})",
    "browser tab metadata watcher",
  );

  out = replaceRequired(
    out,
    "vu.updateTab(o,iu.BROWSER,{",
    "vu.updateTab(o,e.browserTabId??iu.BROWSER,{",
    "browser metadata tab id",
  );

  const start = out.indexOf("function V3(e,t=!0,n={}){");
  const end = out.indexOf("function H3(", start);
  if (start === -1 || end === -1) {
    throw new Error("missing patch target: browser open helper block");
  }

  const replacement =
    'function V3(e,t=!0,n={}){let r=e.value,i=zr(r),a=n.browserConversationId??i;if(a==null)return!1;let o=e.get(No).formatMessage({id:`thread.sidePanel.browserTab`,defaultMessage:`Browser`,description:`Title for the browser tab in the thread side panel`}),s=e.get(vu.tabs$),c=e=>e.tabId===iu.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(iu.BROWSER+":"),l=s.filter(c);if(n.browserTabId==null&&l.length>=25)return!1;let u=()=>typeof crypto<`u`&&typeof crypto.randomUUID==`function`?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`,d=n.browserTabId??(l.length===0?iu.BROWSER:`${iu.BROWSER}:${u()}`),f=d===iu.BROWSER?a:`${a}:browser:${d.slice(iu.BROWSER.length+1)}`,p=n.isAgentWorking??_(e,ze,a)??!1,m=zD({browserSnapshot:FS.getSnapshot(f,n.browserTransferSourceConversationId),browserTabFallbackTitle:o,browserUseActiveState:FS.getBrowserUseActiveState(f),conversationTurns:_(e,Ge,a)??RD,isResponseInProgress:p}),h=()=>{e.set(BD,{conversationId:f,...n.browserTransferSourceConversationId==null?{}:{transferSourceConversationId:n.browserTransferSourceConversationId}})};return h(),vu.openTab(e,bje,{highlightedIcon:(0,J.createElement)(sw,{className:`size-[13px]`}),icon:(0,J.createElement)(nw,{alt:``,className:`icon-xs shrink-0 rounded-2xs`,logoUrl:m.faviconUrl,fallback:(0,J.createElement)(Gr,{className:`size-full`})}),isHighlighted:m.isHighlighted,isShimmering:m.isShimmering,props:{browserConversationId:f,browserHostDisplayName:n.browserHostDisplayName??e.get(hd).display_name,...n.browserTransferSourceConversationId==null?{}:{browserTransferSourceConversationId:n.browserTransferSourceConversationId},cwd:n.cwd??e.get(pd),isAgentWorking:p},id:d,activate:t,onActivate:h,onClose:()=>{e.get(BD)?.conversationId===f&&e.set(BD,null),dn.dispatchMessage(`browser-sidebar-command`,{conversationId:f,command:{type:`reset`}})},title:m.title}),t&&uw(e),!0}function Tje(e,t){if(!V3(e,!0,t))return!1;e.set(ql,!0),e.set(Gl,!0);let n=e.get(Kl);return n.stop(),n.set(1),!0}';

  return out.slice(0, start) + replacement + out.slice(end);
}

function patchReviewRuntimeBridge(source, state = null) {
  let out = source;

  let override = applyPatchOverride(
    out,
    state,
    "review-runtime-bridge",
    "review-runtime-bridge-browser-plus-menu-cap",
    "browser plus-menu cap",
  );
  out = override.source;
  if (!override.applied) {
    out = replaceFirstAvailable(
      out,
      [
        ["E=c&&!s.some(yr)", `E=c&&s.filter(yr).length<${MAX_BROWSER_TABS}`],
        ["M=c&&!s.some(Tr)", `M=c&&s.filter(Tr).length<${MAX_BROWSER_TABS}`],
        ["N=c&&!s.some(Tr)", `N=c&&s.filter(Tr).length<${MAX_BROWSER_TABS}`],
        ["M=u&&!l.some(Dr)", `M=u&&l.filter(Dr).length<${MAX_BROWSER_TABS}`],
      ],
      "browser plus-menu cap",
    );
  }

  override = applyPatchOverride(
    out,
    state,
    "review-runtime-bridge",
    "review-runtime-bridge-browser-tab-detector",
    "browser tab detector",
  );
  out = override.source;
  if (!override.applied) {
    out = replaceFirstAvailable(
      out,
      [
        [
          "function yr(e){return e.tabId===A.BROWSER}",
          'function yr(e){return e.tabId===A.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(A.BROWSER+":")}',
        ],
        [
          "function Tr(e){return e.tabId===d.BROWSER}",
          'function Tr(e){return e.tabId===d.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(d.BROWSER+":")}',
        ],
        [
          "function Dr(e){return e.tabId===g.BROWSER}",
          'function Dr(e){return e.tabId===g.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(g.BROWSER+":")}',
        ],
      ],
      "browser tab detector",
    );
  }

  override = applyPatchOverride(
    out,
    state,
    "review-runtime-bridge",
    "review-runtime-bridge-find-shortcut-detector",
    "browser find shortcut detector",
  );
  out = override.source;
  if (!override.applied) {
    out = replaceFirstAvailable(
      out,
      [
        [
          "if(!n||e!==A.BROWSER)return!1;",
          'if(!n||!(e===A.BROWSER||typeof e==="string"&&e.startsWith(A.BROWSER+":")))return!1;',
        ],
        [
          "if(!n||e!==d.BROWSER)return!1;",
          'if(!n||!(e===d.BROWSER||typeof e==="string"&&e.startsWith(d.BROWSER+":")))return!1;',
        ],
        [
          "if(!n||e!==g.BROWSER)return!1;",
          'if(!n||!(e===g.BROWSER||typeof e==="string"&&e.startsWith(g.BROWSER+":")))return!1;',
        ],
      ],
      "browser find shortcut detector",
    );
  }

  override = applyPatchOverride(
    out,
    state,
    "review-runtime-bridge",
    "review-runtime-bridge-browser-overlay-condition",
    "browser overlay condition",
  );
  out = override.source;
  if (!override.applied) {
    out = out.replace(
      "p=i?.tabId!==A.BROWSER||!a||o",
      'p=!(i?.tabId===A.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(A.BROWSER+":"))||!a||o',
    );
    out = out.replace(
      "p=i?.tabId!==d.BROWSER||!a||o",
      'p=!(i?.tabId===d.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(d.BROWSER+":"))||!a||o',
    );
    out = out.replace(
      "p=i?.tabId!==g.BROWSER||!a||o",
      'p=!(i?.tabId===g.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(g.BROWSER+":"))||!a||o',
    );
  }
  return out;
}

function patchAppShell(source, state = null) {
  let out = source;

  let override = applyPatchOverride(
    out,
    state,
    "app-shell",
    "app-shell-browser-shortcut-active-tab",
    "browser shortcut state active tab",
  );
  out = override.source;
  if (!override.applied) {
    out = replaceFirstAvailable(
      out,
      [
        [
          "c=i?.tabId===E.BROWSER?a:null",
          'c=(i?.tabId===E.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(E.BROWSER+":"))?a:null',
        ],
        [
          "m=s?.tabId===l.BROWSER?u:null",
          'm=(s?.tabId===l.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(l.BROWSER+":"))?u:null',
        ],
        [
          "m=s?.tabId===h.BROWSER?l:null",
          'm=(s?.tabId===h.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(h.BROWSER+":"))?l:null',
        ],
      ],
      "browser shortcut state active tab",
    );
  }

  override = applyPatchOverride(
    out,
    state,
    "app-shell",
    "app-shell-browser-close-active-tab",
    "browser close-active-tab detector",
  );
  out = override.source;
  if (!override.applied) {
    out = replaceFirstAvailable(
      out,
      [
        [
          "i?.tabId===E.BROWSER&&G.closeTab(t,i.tabId)",
          '(i?.tabId===E.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(E.BROWSER+":"))&&G.closeTab(t,i.tabId)',
        ],
        [
          "s?.tabId===l.BROWSER&&j.closeTab(t,s.tabId)",
          '(s?.tabId===l.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(l.BROWSER+":"))&&j.closeTab(t,s.tabId)',
        ],
        [
          "s?.tabId===l.BROWSER&&j.closeTab(n,s.tabId)",
          '(s?.tabId===l.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(l.BROWSER+":"))&&j.closeTab(n,s.tabId)',
        ],
        [
          "s?.tabId===h.BROWSER&&c.closeTab(t,s.tabId)",
          '(s?.tabId===h.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(h.BROWSER+":"))&&c.closeTab(t,s.tabId)',
        ],
      ],
      "browser close-active-tab detector",
    );
  }

  out = patchRightPanelTabShortcuts(out);

  return out;
}

function patchRightPanelTabShortcuts(source) {
  const start = source.indexOf("function nn(){let e=(0,Z.c)(13),");
  const end = source.indexOf("function rn(){", start);
  if (start === -1 || end === -1) {
    return source;
  }

  const replacement =
    'function nn(){let e=(0,Z.c)(18),t=q(X),n=J(o.canCloseActiveTab$),r=J(f),i=J(G.activeTab$),a=J(y),s=J(G.canCloseActiveTab$),c=J(G.tabs$),l=(i?.tabId===E.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(E.BROWSER+":"))?a:null,u=s||l!=null,d;e[0]===l?d=e[1]:(d=()=>l==null?null:F.getSnapshot(l.conversationId,l.transferSourceConversationId),e[0]=l,e[1]=d);let p=d,m=((0,$.useSyncExternalStore)(on,p,p)?.tabType===fe.WEB?l:null)?.conversationId??null,h,g;e[2]!==n||e[3]!==r||e[4]!==u||e[5]!==m?(h=()=>{xe.dispatchMessage(`app-shell-shortcut-state-changed`,{bottomPanelCanCloseActiveTab:n,focusArea:r,rightPanelBrowserConversationId:m,rightPanelCanCloseActiveTab:u})},g=[n,r,u,m],e[2]=n,e[3]=r,e[4]=u,e[5]=m,e[6]=h,e[7]=g):(h=e[6],g=e[7]),(0,$.useEffect)(h,g);let _;e[8]===Symbol.for(`react.memo_cache_sentinel`)?(_=[],e[8]=_):_=e[8],(0,$.useEffect)(rn,_);let v=e=>{if(!Array.isArray(c)||c.length===0)return!1;let n=c[e-1];return n==null?!1:(G.activateTab(t,n.tabId),!0)},b,x;e[9]!==c||e[10]!==r||e[11]!==t?(b=()=>{let e=e=>{let n=e.ctrlKey||e.metaKey;if(r!==`right-panel`||e.defaultPrevented||!n||e.ctrlKey&&e.metaKey||e.altKey||e.shiftKey)return;let i=null,a=e.code??``;if(/^Digit[1-9]$/.test(a))i=Number(a.slice(5));else{let o=e.key??``;/^[1-9]$/.test(o)&&(i=Number(o))}i!=null&&v(i)&&(e.preventDefault(),e.stopPropagation())},n=e=>{let t=e.data,n=Number(t?.index);t?.type===`better-browser-activate-right-tab`&&Number.isInteger(n)&&v(n)&&e.stopImmediatePropagation?.()};return window.addEventListener(`keydown`,e,!0),window.addEventListener(`message`,n),()=>{window.removeEventListener(`keydown`,e,!0),window.removeEventListener(`message`,n)}},x=[c,r,t],e[9]=c,e[10]=r,e[11]=t,e[12]=b,e[13]=x):(b=e[12],x=e[13]),(0,$.useEffect)(b,x);let S,C;return e[14]!==i||e[15]!==t?(S=e=>{let{panelId:n}=e;bb47:switch(n){case`bottom`:o.closeActiveTab(t);break bb47;case`right`:if(G.closeTab(t))break bb47;(i?.tabId===E.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(E.BROWSER+":"))&&G.closeTab(t,i.tabId)}},C=[i,t],e[14]=i,e[15]=t,e[16]=S,e[17]=C):(S=e[16],C=e[17]),Se(`close-active-app-shell-tab`,S,C),null}';

  return source.slice(0, start) + replacement + source.slice(end);
}

function applyPatchOverride(source, state, assetKind, patchId, label) {
  const patch = patchOverrideFor(state, assetKind, patchId);
  if (!patch) return { source, applied: false };

  const occurrences = countOccurrences(source, patch.anchor);
  if (occurrences === 1) {
    logPatchOverrideOnce(state, "info", patchId, `applied smart-repatch override: ${label}`);
    return { source: source.replace(patch.anchor, patch.replacement), applied: true };
  }

  if (patch.replacement && source.includes(patch.replacement)) {
    return { source, applied: true };
  }

  logPatchOverrideOnce(
    state,
    "warn",
    patchId,
    `smart-repatch override did not match ${label}: ${occurrences} occurrence(s)`,
  );
  return { source, applied: false };
}

function patchOverrideFor(state, assetKind, patchId) {
  const patch = state?.patchOverrides?.patchesById?.get?.(patchId);
  if (!patch || !assetPatternMatchesKind(patch.asset, assetKind)) return null;
  return patch;
}

function assetPatternMatchesKind(pattern, assetKind) {
  if (typeof pattern !== "string" || typeof assetKind !== "string") return false;
  const samples = {
    "app-shell": "app-shell-fixture.js",
    "review-runtime-bridge": "review-runtime-bridge-fixture.js",
    "use-model-settings": "use-model-settings-fixture.js",
  };
  const sample = samples[assetKind];
  if (!sample) return false;
  return patternToRegex(pattern).test(sample);
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
    if (count > 5) break;
  }
  return count;
}

function logPatchOverrideOnce(state, level, patchId, message) {
  const key = `${level}:${patchId}:${message}`;
  if (state?.patchOverrideWarnings?.has?.(key)) return;
  state?.patchOverrideWarnings?.add?.(key);
  const logger = state?.api?.log?.[level];
  if (typeof logger === "function") logger.call(state.api.log, message);
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`missing patch target: ${label}`);
  }
  return source.replace(from, to);
}

function replaceFirstAvailable(source, replacements, label) {
  for (const [from, to] of replacements) {
    if (source.includes(from)) {
      return source.replace(from, to);
    }
  }
  for (const [, to] of replacements) {
    if (source.includes(to)) {
      return source;
    }
  }
  throw new Error(`missing patch target: ${label}`);
}

function responseInitFrom(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

function stringifyError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function logInfo(api, message) {
  if (typeof api.log?.info === "function") {
    api.log.info(message);
  } else if (typeof api.log?.warn === "function") {
    api.log.warn(message);
  }
}
