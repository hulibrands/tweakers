/**
 * Account Switcher
 *
 * ShadGPT tweak that injects account management into Codex's account/settings
 * popup. Main process owns all auth file operations; renderer only sends
 * account names and receives snapshot metadata.
 *
 * Entry point — delegates immediately to the appropriate process module.
 */

const { GLOBAL_SERVICE_KEY, IPC_HANDLER_KEY, IPC_CHANNEL } = require("./src/constants");

// ─── Tweak export ─────────────────────────────────────────────────────────────

/** @type {import("@codex-plusplus/sdk").Tweak} */
module.exports = {
  start(api) {
    if (api.process === "main") {
      startMain(api);
      return;
    }

    const state = {
      api,
      accountsExpanded: false,
      observer: null,
      pending: 0,
      disposed: false,
      disposers: [],
      lastState: null,
      lastUsageRefreshAt: 0,
      settingsRoot: null,
      accountMenuRescanTimers: [],
      usageRefreshInFlight: false,
    };
    this._state = state;
    const { startRenderer } = require("./src/renderer");
    startRenderer(state);
  },

  stop() {
    cleanupMain();
    const state = this._state;
    if (!state) return;
    state.disposed = true;
    if (state.observer) state.observer.disconnect();
    if (state.pending) window.cancelAnimationFrame(state.pending);
    for (const dispose of state.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        /* listener may already be gone */
      }
    }
    this._pageHandle?.unregister?.();
    document
      .querySelectorAll("[data-codexpp-account-switcher], [data-codexpp-account-switcher-confirm]")
      .forEach((element) => {
        const cleanup = element.__codexppAccountSwitcherCleanup;
        if (typeof cleanup === "function") cleanup();
        else element.remove();
      });
  },
};

// ─── Main process bootstrap ───────────────────────────────────────────────────

function startMain(api) {
  const { createAccountService } = require("./src/account/service");
  const service = createAccountService(api);
  globalThis[GLOBAL_SERVICE_KEY] = service;

  if (!globalThis[IPC_HANDLER_KEY]) {
    const dispose = api.ipc.handle(IPC_CHANNEL, async (message) => {
      const active = globalThis[GLOBAL_SERVICE_KEY];
      if (!active || typeof active.handle !== "function") {
        return { ok: false, error: "Account Switcher service is not active." };
      }
      return active.handle(message);
    });
    globalThis[IPC_HANDLER_KEY] = { disposers: typeof dispose === "function" ? [dispose] : [] };
  }

  api.log.info("[account-switcher] main provider active");
}

function cleanupMain() {
  require("./src/account/actions").resetAuthRelaunchState();
  delete globalThis[GLOBAL_SERVICE_KEY];
  const state = globalThis[IPC_HANDLER_KEY];
  if (!state || state === true) return;
  const disposers = Array.isArray(state.disposers) ? state.disposers : [];
  for (const dispose of disposers.splice(0).reverse()) {
    try {
      dispose();
    } catch {
      /* handler may already be gone */
    }
  }
  delete globalThis[IPC_HANDLER_KEY];
}
