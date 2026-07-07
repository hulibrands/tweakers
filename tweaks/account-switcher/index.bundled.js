"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// vendor/tweakers/tweaks/account-switcher/src/constants.js
var require_constants = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/constants.js"(exports2, module2) {
    "use strict";
    var GLOBAL_SERVICE_KEY2 = "__codexpp_thomashulihan_account_switcher_service__";
    var IPC_HANDLER_KEY2 = "__codexpp_thomashulihan_account_switcher_ipc_handler__";
    var IPC_CHANNEL2 = "account-switcher";
    var ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    module2.exports = { GLOBAL_SERVICE_KEY: GLOBAL_SERVICE_KEY2, IPC_HANDLER_KEY: IPC_HANDLER_KEY2, IPC_CHANNEL: IPC_CHANNEL2, ACCOUNT_NAME_PATTERN };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/dom-utils.js
var require_dom_utils = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/dom-utils.js"(exports2, module2) {
    "use strict";
    function compactText(element) {
      return (element?.textContent || "").replace(/\s+/g, " ").trim();
    }
    function isVisible(element) {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    function findMenuItem(root, pattern) {
      return Array.from(
        root.querySelectorAll('button, a, [role="button"], [role="menuitem"], [data-radix-collection-item], div')
      ).find((element) => {
        return element instanceof HTMLElement && isVisible(element) && pattern.test(compactText(element));
      });
    }
    function protectInteractiveControl(element, options = {}) {
      const preventClickDefault = options.preventClickDefault !== false;
      const stop = (event) => {
        event.stopPropagation();
      };
      element.addEventListener("pointerdown", stop, true);
      element.addEventListener("mousedown", stop, true);
      element.addEventListener("mouseup", stop, true);
      element.addEventListener("keydown", stop, true);
      element.addEventListener(
        "click",
        (event) => {
          if (preventClickDefault) event.preventDefault();
          event.stopPropagation();
        },
        true
      );
    }
    module2.exports = { compactText, isVisible, findMenuItem, protectInteractiveControl };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/utils.js
var require_utils = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/utils.js"(exports2, module2) {
    "use strict";
    function ok(state) {
      return { ok: true, state };
    }
    function fail(error) {
      return { ok: false, error };
    }
    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }
    function stringifyError(error) {
      return error instanceof Error ? error.stack || error.message : String(error);
    }
    module2.exports = { ok, fail, errorMessage, stringifyError };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/ipc.js
var require_ipc = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/ipc.js"(exports2, module2) {
    "use strict";
    var { IPC_CHANNEL: IPC_CHANNEL2 } = require_constants();
    var DESTRUCTIVE_ACTIONS = /* @__PURE__ */ new Set(["switch", "delete", "clear-active", "relaunch"]);
    async function invoke(state, action, payload = {}) {
      const finalPayload = DESTRUCTIVE_ACTIONS.has(action) ? { ...payload, intent: await createIntent(state, action, payload), action } : { ...payload, action };
      const result = await state.api.ipc.invoke(IPC_CHANNEL2, finalPayload);
      if (!result?.ok) throw new Error(result?.error || "Account switcher action failed.");
      state.lastState = result.state;
      return result.state;
    }
    async function createIntent(state, action, payload) {
      const result = await state.api.ipc.invoke(IPC_CHANNEL2, {
        ...payload,
        action: "create-intent",
        intentAction: action
      });
      if (!result?.ok || typeof result.state?.intent !== "string") {
        throw new Error(result?.error || "Account switcher confirmation failed.");
      }
      return result.state.intent;
    }
    module2.exports = { invoke };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/i18n.js
var require_i18n = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/i18n.js"(exports2, module2) {
    "use strict";
    var STRINGS = {
      "accounts.title": "Accounts",
      "accounts.configure": "Configure accounts",
      "accounts.emptySaved": "No saved accounts yet.",
      "accounts.emptyActive": "No active session. Relaunch and sign in.",
      "accounts.loading": "Loading saved accounts...",
      "accounts.switching": "Switching account...",
      "accounts.confirmTitle": "Switch account?",
      "accounts.confirmMessage": "ShadGPT will switch to {email} and relaunch.",
      "accounts.confirmSwitchTitle": "Switch account?",
      "accounts.confirmSwitchMessage": "ShadGPT will switch to {email} and relaunch.",
      "accounts.confirmCancel": "Cancel",
      "accounts.confirmSwitch": "Switch account",
      "accounts.confirmDeleteTitle": "Delete saved account?",
      "accounts.confirmDeleteMessage": "Delete the saved snapshot for {email}. This does not sign out the active ShadGPT window.",
      "accounts.confirmDelete": "Delete account",
      "accounts.confirmClearTitle": "Start a new sign-in?",
      "accounts.confirmClearMessage": "The current session will be backed up, cleared, and ShadGPT will relaunch for sign-in.",
      "accounts.confirmClear": "Start sign-in",
      "accounts.preparingSignIn": "Preparing sign-in...",
      "accounts.selected": "selected account",
      "accounts.switchedRelaunching": "Switched to {email}. Relaunching ShadGPT...",
      "accounts.sessionClearedRelaunching": "Session cleared. Relaunching ShadGPT for sign-in...",
      "accounts.relaunchFailed": "Relaunch failed: {error}",
      "settings.activeSession": "Active session",
      "settings.signedInAs": "Signed in as",
      "settings.unsavedAccount": "Unsaved account",
      "settings.noActiveSession": "No active session",
      "settings.activeAuthDescription": "ShadGPT is using the session stored in ~/.codex/auth.json.",
      "settings.noAuthDescription": "No active auth file exists at ~/.codex/auth.json.",
      "settings.accountSetup": "Account setup",
      "settings.signInAnother": "Sign in to another account",
      "settings.signInAnotherDescription": "Back up the current session, clear auth, and relaunch ShadGPT for sign-in.",
      "settings.startSignIn": "Start sign-in",
      "settings.refreshSaved": "Refresh saved accounts",
      "settings.refreshSavedDescription": "Rescan saved sessions in ~/.codex/auth_accounts.",
      "settings.refresh": "Refresh",
      "settings.savedAccounts": "Saved accounts",
      "settings.noSavedAccounts": "No saved accounts yet",
      "settings.noneFound": "None found",
      "settings.noSavedAccountsDescription": "Use Sign in to another account to create one.",
      "settings.activeInWindow": "Active in this ShadGPT window.",
      "settings.usageUnchecked": "Usage not checked yet.",
      "settings.switch": "Switch",
      "settings.delete": "Delete",
      "settings.removing": "Removing account...",
      "service.saved": "Saved current account as {name}.",
      "service.switched": "Switched to {name}. Relaunching ShadGPT.",
      "service.removed": "Removed saved account {name}.",
      "service.sessionCleared": "Session cleared. Relaunching ShadGPT for sign-in.",
      "service.relaunching": "Relaunching ShadGPT..."
    };
    function t2(key, params = {}) {
      const template = STRINGS[key] || key;
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
      });
    }
    module2.exports = { t: t2 };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/ui-components.js
var require_ui_components = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/ui-components.js"(exports2, module2) {
    "use strict";
    var { protectInteractiveControl } = require_dom_utils();
    var PANEL_ROW_LEFT_INSET = 30;
    function addButtonFeedback(element, styles) {
      const normal = {
        background: element.style.background || element.style.backgroundColor || "transparent",
        color: element.style.color || "",
        transform: element.style.transform || ""
      };
      const apply = (values) => {
        if (values.background != null) element.style.background = values.background;
        if (values.color != null) element.style.color = values.color;
        if (values.transform != null) element.style.transform = values.transform;
      };
      const hover = styles.hover || {};
      const active = styles.active || hover;
      const restore = () => apply(styles.normal || normal);
      element.style.transition = "background-color 120ms ease, color 120ms ease, transform 80ms ease";
      element.addEventListener("pointerenter", () => {
        if (element.disabled) return;
        apply(hover);
      });
      element.addEventListener("pointerleave", restore);
      element.addEventListener("focus", () => {
        if (element.disabled) return;
        apply(hover);
      });
      element.addEventListener("blur", restore);
      element.addEventListener("pointerdown", () => {
        if (element.disabled) return;
        apply(active);
      });
      element.addEventListener("pointerup", () => {
        if (element.disabled) return;
        apply(hover);
      });
      element.addEventListener("pointercancel", restore);
    }
    function smallButton(label) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = "height:24px;border:0;border-radius:6px;padding:0 8px;background:color-mix(in srgb,var(--color-token-text-primary,currentColor) 10%,transparent);color:var(--color-token-text-primary,currentColor);font:inherit;font-size:12px;line-height:1;cursor:pointer;";
      addButtonFeedback(button, {
        hover: {
          background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 16%,transparent)"
        },
        active: {
          background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 22%,transparent)",
          transform: "scale(0.98)"
        }
      });
      protectInteractiveControl(button);
      return button;
    }
    function iconButton(label, text) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.style.cssText = "display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:5px;background:transparent;color:var(--color-token-text-secondary,currentColor);font:inherit;font-size:16px;line-height:1;cursor:pointer;";
      addButtonFeedback(button, {
        hover: {
          background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 10%,transparent)",
          color: "var(--color-token-text-primary,currentColor)"
        },
        active: {
          background: "color-mix(in srgb,var(--color-token-text-primary,currentColor) 18%,transparent)",
          color: "var(--color-token-text-primary,currentColor)",
          transform: "scale(0.94)"
        }
      });
      protectInteractiveControl(button);
      return button;
    }
    function settingsButton(label) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-sm text-token-text-primary hover:bg-token-foreground/10 disabled:cursor-default disabled:opacity-50";
      button.style.border = "1px solid color-mix(in srgb, currentColor 14%, transparent)";
      button.style.backgroundColor = "color-mix(in srgb, currentColor 5%, transparent)";
      addButtonFeedback(button, {
        hover: {
          background: "color-mix(in srgb, currentColor 10%, transparent)"
        },
        active: {
          background: "color-mix(in srgb, currentColor 16%, transparent)",
          transform: "scale(0.98)"
        }
      });
      protectInteractiveControl(button);
      return button;
    }
    function settingsSection(title) {
      const section = document.createElement("section");
      section.className = "flex flex-col gap-2";
      const titleRow = document.createElement("div");
      titleRow.className = "flex h-toolbar items-center justify-between gap-2 px-0 py-0";
      const inner = document.createElement("div");
      inner.className = "flex min-w-0 flex-1 flex-col gap-1";
      const heading = document.createElement("div");
      heading.className = "text-base font-medium text-token-text-primary";
      heading.textContent = title;
      inner.appendChild(heading);
      titleRow.appendChild(inner);
      section.appendChild(titleRow);
      return section;
    }
    function settingsCard() {
      const card = document.createElement("div");
      card.className = "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border";
      card.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";
      return card;
    }
    function settingsRowShell() {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-4 p-3";
      return row;
    }
    function settingsInfoRow(titleText, valueText, descriptionText) {
      const row = settingsRowShell();
      const left = document.createElement("div");
      left.className = "flex min-w-0 flex-col gap-1";
      const title = document.createElement("div");
      title.className = "min-w-0 text-sm text-token-text-primary";
      title.textContent = titleText;
      left.appendChild(title);
      if (descriptionText) {
        const desc = document.createElement("div");
        desc.className = "text-token-text-secondary min-w-0 text-sm";
        desc.textContent = descriptionText;
        left.appendChild(desc);
      }
      const value = document.createElement("div");
      value.className = "max-w-[45%] shrink-0 truncate text-right text-sm text-token-text-secondary";
      value.title = valueText;
      value.textContent = valueText;
      row.append(left, value);
      return row;
    }
    function settingsActionRow(titleText, descriptionText, actionText, onClick) {
      const row = settingsRowShell();
      const left = document.createElement("div");
      left.className = "flex min-w-0 flex-col gap-1";
      const title = document.createElement("div");
      title.className = "min-w-0 text-sm text-token-text-primary";
      title.textContent = titleText;
      left.appendChild(title);
      const desc = document.createElement("div");
      desc.className = "text-token-text-secondary min-w-0 text-sm";
      desc.textContent = descriptionText;
      left.appendChild(desc);
      row.appendChild(left);
      const button = settingsButton(actionText);
      bindButtonAction(button, onClick);
      row.appendChild(button);
      return row;
    }
    function bindButtonAction(button, onAction) {
      let lastRun = 0;
      const run = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        const now = Date.now();
        if (now - lastRun < 350) return;
        lastRun = now;
        onAction(event);
      };
      button.addEventListener("pointerup", run);
      button.addEventListener("click", run);
    }
    function settingsStatus(text, isError = false) {
      const status = document.createElement("div");
      status.className = "text-token-text-secondary text-sm";
      status.style.color = isError ? "var(--color-token-text-error, #c2410c)" : "var(--color-token-text-secondary, currentColor)";
      status.textContent = text;
      return status;
    }
    function accountPanelShell(base) {
      const panel = document.createElement("div");
      panel.setAttribute("data-codexpp-account-switcher", "panel");
      panel.setAttribute("role", "presentation");
      panel.style.cssText = [
        "box-sizing:border-box",
        "width:100%",
        "margin:0",
        "padding:0",
        "color:var(--color-token-text-primary,currentColor)",
        "cursor:default",
        "user-select:none"
      ].join(";");
      return panel;
    }
    function setPanelStatus(panel, text) {
      panel.textContent = "";
      const status = document.createElement("div");
      status.textContent = text;
      status.style.cssText = `font-size:12px;line-height:1.35;color:var(--color-token-text-secondary,currentColor);padding:4px 24px 6px ${PANEL_ROW_LEFT_INSET}px;`;
      panel.appendChild(status);
    }
    function accountDisplayName(accountState, name, options = {}) {
      const email = accountState?.accountEmails?.[name];
      const suffix = accountState?.current === name && options.includeCurrent !== false ? " (current)" : "";
      return email ? `${email}${suffix}` : `${name}${suffix}`;
    }
    function accountUsageSummary(accountState, name) {
      const usage = accountState?.accountUsage?.[name];
      if (!usage || typeof usage !== "object") return null;
      const parts = [];
      const fiveHour = usageWindowSummary(usage.fiveHour, "5h");
      const weekly = usageWindowSummary(usage.weekly, "Weekly");
      if (fiveHour) parts.push(fiveHour);
      if (weekly) parts.push(weekly);
      if (!parts.length) return null;
      return parts.join(" \xB7 ");
    }
    function usageWindowSummary(window2, fallbackLabel) {
      if (typeof window2?.pct !== "number") return null;
      const label = window2.label || fallbackLabel;
      const reset = window2.pct <= 0 && window2.resetAt ? `, resets ${window2.resetAt}` : "";
      return `${label} ${window2.pct}%${reset}`;
    }
    module2.exports = {
      PANEL_ROW_LEFT_INSET,
      addButtonFeedback,
      smallButton,
      iconButton,
      settingsButton,
      settingsSection,
      settingsCard,
      settingsRowShell,
      settingsInfoRow,
      settingsActionRow,
      settingsStatus,
      bindButtonAction,
      accountPanelShell,
      setPanelStatus,
      accountDisplayName,
      accountUsageSummary
    };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/ui-confirmation.js
var require_ui_confirmation = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/ui-confirmation.js"(exports2, module2) {
    "use strict";
    var { t: t2 } = require_i18n();
    var { accountDisplayName, addButtonFeedback } = require_ui_components();
    var CONFIRMATION_SELECTOR = "[data-codexpp-account-switcher-confirm]";
    var CONFIRMATION_CLEANUP_KEY = "__codexppAccountSwitcherCleanup";
    function confirmAccountAction(state, accountState, action, payload = {}) {
      const details = confirmationDetails(accountState, action, payload);
      if (!details) return Promise.resolve(true);
      const previousFocus = document.activeElement && typeof document.activeElement.focus === "function" ? document.activeElement : null;
      closeExistingConfirmation();
      return new Promise((resolve) => {
        const dialogId = `codexpp-account-switcher-confirm-${Date.now().toString(36)}`;
        const overlay = document.createElement("div");
        overlay.setAttribute("data-codexpp-account-switcher-confirm", "true");
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(0,0,0,.18);color:var(--color-token-text-primary,currentColor);";
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "alertdialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", `${dialogId}-title`);
        dialog.setAttribute("aria-describedby", `${dialogId}-message`);
        dialog.tabIndex = -1;
        dialog.style.cssText = "width:min(360px,calc(100vw - 32px));border-radius:12px;border:1px solid var(--color-token-border,rgba(0,0,0,.12));background:var(--color-background-panel,var(--color-token-bg-primary,#fff));box-shadow:0 18px 48px rgba(0,0,0,.22);padding:18px;display:flex;flex-direction:column;gap:14px;font:inherit;";
        const title = document.createElement("div");
        title.id = `${dialogId}-title`;
        title.setAttribute("id", title.id);
        title.textContent = details.title;
        title.style.cssText = "font-size:17px;font-weight:600;line-height:1.3;";
        dialog.appendChild(title);
        const message = document.createElement("div");
        message.id = `${dialogId}-message`;
        message.setAttribute("id", message.id);
        message.textContent = details.message;
        message.style.cssText = "font-size:14px;line-height:1.45;color:var(--color-token-text-secondary,currentColor);";
        dialog.appendChild(message);
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
        const cancel = confirmButton(t2("accounts.confirmCancel"), false);
        const confirm = confirmButton(details.confirmLabel, true);
        actions.append(cancel, confirm);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        let done = false;
        let stateDisposer = null;
        const unregisterStateDisposer = () => {
          if (!stateDisposer || !Array.isArray(state?.disposers)) return;
          const index = state.disposers.indexOf(stateDisposer);
          if (index >= 0) state.disposers.splice(index, 1);
          stateDisposer = null;
        };
        const finish = (value, options = {}) => {
          if (done) return;
          done = true;
          document.removeEventListener("keydown", onKeyDown, true);
          delete overlay[CONFIRMATION_CLEANUP_KEY];
          overlay.remove();
          unregisterStateDisposer();
          if (options.restoreFocus !== false) previousFocus?.focus?.();
          resolve(value);
        };
        overlay[CONFIRMATION_CLEANUP_KEY] = () => finish(false, { restoreFocus: false });
        if (Array.isArray(state?.disposers)) {
          stateDisposer = overlay[CONFIRMATION_CLEANUP_KEY];
          state.disposers.push(stateDisposer);
        }
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
            return;
          }
          if (event.key === "Tab") {
            const focusable = dialog.querySelectorAll("button, a, input, select, textarea, [tabindex]");
            if (!focusable.length) {
              event.preventDefault();
              dialog.focus();
              return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        };
        overlay.addEventListener("pointerdown", (event) => {
          if (event.target === overlay) finish(false);
        });
        dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
        dialog.addEventListener("click", (event) => event.stopPropagation());
        cancel.addEventListener("click", () => finish(false));
        confirm.addEventListener("click", () => finish(true));
        document.addEventListener("keydown", onKeyDown, true);
        document.body.appendChild(overlay);
        cancel.focus();
      });
    }
    function closeExistingConfirmation() {
      const overlay = document.querySelector(CONFIRMATION_SELECTOR);
      if (!overlay) return;
      if (typeof overlay[CONFIRMATION_CLEANUP_KEY] === "function") {
        overlay[CONFIRMATION_CLEANUP_KEY]();
        return;
      }
      overlay.remove();
    }
    function confirmationDetails(accountState, action, payload) {
      if (action === "switch") {
        const email = accountDisplayName(accountState, payload.name, { includeCurrent: false });
        return {
          title: t2("accounts.confirmSwitchTitle"),
          message: t2("accounts.confirmSwitchMessage", { email }),
          confirmLabel: t2("accounts.confirmSwitch")
        };
      }
      if (action === "delete") {
        const email = accountDisplayName(accountState, payload.name, { includeCurrent: false });
        return {
          title: t2("accounts.confirmDeleteTitle"),
          message: t2("accounts.confirmDeleteMessage", { email }),
          confirmLabel: t2("accounts.confirmDelete")
        };
      }
      if (action === "clear-active") {
        return {
          title: t2("accounts.confirmClearTitle"),
          message: t2("accounts.confirmClearMessage"),
          confirmLabel: t2("accounts.confirmClear")
        };
      }
      return null;
    }
    function confirmButton(label, primary) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = "height:32px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);padding:0 12px;font:inherit;font-size:13px;cursor:pointer;" + (primary ? "background:var(--color-token-text-primary,currentColor);color:var(--color-token-bg-primary,#fff);" : "background:color-mix(in srgb,currentColor 5%,transparent);color:var(--color-token-text-primary,currentColor);");
      addButtonFeedback(button, {
        normal: { background: button.style.background },
        hover: {
          background: primary ? "color-mix(in srgb,var(--color-token-text-primary,currentColor) 88%,transparent)" : "color-mix(in srgb,currentColor 10%,transparent)"
        },
        active: {
          background: primary ? "color-mix(in srgb,var(--color-token-text-primary,currentColor) 78%,transparent)" : "color-mix(in srgb,currentColor 16%,transparent)",
          transform: "scale(0.98)"
        }
      });
      return button;
    }
    module2.exports = { confirmAccountAction };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/ui-settings.js
var require_ui_settings = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/ui-settings.js"(exports2, module2) {
    "use strict";
    var { errorMessage } = require_utils();
    var { invoke } = require_ipc();
    var { t: t2 } = require_i18n();
    var { confirmAccountAction } = require_ui_confirmation();
    var {
      settingsButton,
      settingsSection,
      settingsCard,
      settingsRowShell,
      settingsInfoRow,
      settingsActionRow,
      settingsStatus,
      accountDisplayName,
      accountUsageSummary,
      bindButtonAction
    } = require_ui_components();
    async function renderAccountsPage(state, root) {
      root.textContent = "";
      root.appendChild(settingsStatus(t2("accounts.loading")));
      try {
        const accountState = await invoke(state, "state");
        renderAccountsPageState(state, root, accountState);
        refreshUsageInBackground(state, root);
      } catch (error) {
        root.textContent = "";
        root.appendChild(settingsStatus(errorMessage(error), true));
      }
    }
    function renderAccountsPageState(state, root, accountState) {
      root.textContent = "";
      const intro = settingsSection(t2("settings.activeSession"));
      const introCard = settingsCard();
      const currentName = accountState.current || (accountState.hasActiveAuth ? t2("settings.unsavedAccount") : t2("settings.noActiveSession"));
      const currentValue = accountState.current ? accountDisplayName(accountState, accountState.current, { includeCurrent: false }) : currentName;
      introCard.appendChild(
        settingsInfoRow(
          t2("settings.signedInAs"),
          currentValue,
          accountState.hasActiveAuth ? t2("settings.activeAuthDescription") : t2("settings.noAuthDescription")
        )
      );
      intro.appendChild(introCard);
      root.appendChild(intro);
      const detector = settingsSection("Account menu detector");
      const detectorCard = settingsCard();
      const detectorHealth = state.detectorHealth || {};
      detectorCard.appendChild(
        settingsInfoRow(
          "Status",
          detectorStatusLabel(detectorHealth),
          detectorHealth.lastReason || "Waiting for the account pop-up to open."
        )
      );
      detectorCard.appendChild(
        settingsInfoRow(
          "Last seen",
          detectorTimeLabel(detectorHealth.lastFoundAt || detectorHealth.lastMissingAt || detectorHealth.lastCheckedAt),
          detectorSnapshotLabel(detectorHealth)
        )
      );
      detector.appendChild(detectorCard);
      root.appendChild(detector);
      const actions = settingsSection(t2("settings.accountSetup"));
      const actionCard = settingsCard();
      actionCard.appendChild(
        settingsActionRow(
          t2("settings.signInAnother"),
          t2("settings.signInAnotherDescription"),
          t2("settings.startSignIn"),
          () => clearActiveFromSettings(state, root, accountState)
        )
      );
      actionCard.appendChild(
        settingsActionRow(
          t2("settings.refreshSaved"),
          t2("settings.refreshSavedDescription"),
          t2("settings.refresh"),
          () => renderAccountsPage(state, root)
        )
      );
      actions.appendChild(actionCard);
      root.appendChild(actions);
      const saved = settingsSection(t2("settings.savedAccounts"));
      const savedCard = settingsCard();
      const accounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
      if (!accounts.length) {
        savedCard.appendChild(
          settingsInfoRow(
            t2("settings.noSavedAccounts"),
            t2("settings.noneFound"),
            t2("settings.noSavedAccountsDescription")
          )
        );
      } else {
        for (const name of accounts) {
          savedCard.appendChild(settingsAccountRow(state, root, accountState, name));
        }
      }
      saved.appendChild(savedCard);
      root.appendChild(saved);
      if (accountState.notice || accountState.error) {
        root.appendChild(settingsStatus(accountState.notice || accountState.error, !!accountState.error));
      }
    }
    function detectorStatusLabel(detectorHealth) {
      const status = detectorHealth.status || "idle";
      const misses = detectorHealth.misses || 0;
      return misses ? `${status} (${misses} misses)` : status;
    }
    function detectorTimeLabel(timestamp) {
      return timestamp ? new Date(timestamp).toLocaleTimeString() : "Not checked yet";
    }
    function detectorSnapshotLabel(detectorHealth) {
      const snapshot = detectorHealth.lastSnapshot;
      if (detectorHealth.lastMenuText) return detectorHealth.lastMenuText;
      if (snapshot?.joinedText) return snapshot.joinedText.slice(0, 180);
      return "No account menu text captured yet.";
    }
    function settingsAccountRow(state, root, accountState, name) {
      const row = settingsRowShell();
      const left = document.createElement("div");
      left.className = "flex min-w-0 flex-col gap-1";
      const title = document.createElement("div");
      title.className = "min-w-0 truncate text-sm text-token-text-primary";
      title.textContent = accountDisplayName(accountState, name);
      title.title = accountDisplayName(accountState, name, { includeCurrent: false });
      left.appendChild(title);
      const desc = document.createElement("div");
      desc.className = "text-token-text-secondary min-w-0 text-sm";
      desc.textContent = accountUsageSummary(accountState, name) || (accountState.current === name ? t2("settings.activeInWindow") : t2("settings.usageUnchecked"));
      left.appendChild(desc);
      row.appendChild(left);
      const actionsEl = document.createElement("div");
      actionsEl.className = "flex shrink-0 items-center gap-2";
      const switchButton = settingsButton(t2("settings.switch"));
      switchButton.disabled = accountState.current === name;
      bindButtonAction(
        switchButton,
        () => runSettingsAction(state, root, accountState, "switch", { name }, t2("accounts.switching"))
      );
      actionsEl.appendChild(switchButton);
      const removeButton = settingsButton(t2("settings.delete"));
      bindButtonAction(removeButton, () => {
        runSettingsAction(state, root, accountState, "delete", { name }, t2("settings.removing"));
      });
      actionsEl.appendChild(removeButton);
      row.appendChild(actionsEl);
      return row;
    }
    function clearActiveFromSettings(state, root, accountState) {
      runSettingsAction(state, root, accountState, "clear-active", {}, t2("accounts.preparingSignIn"));
    }
    function refreshUsageInBackground(state, root) {
      const now = Date.now();
      if (state.usageRefreshInFlight || now - (state.lastUsageRefreshAt || 0) < 6e4) return;
      state.usageRefreshInFlight = true;
      state.lastUsageRefreshAt = now;
      invoke(state, "refresh-usage").then((accountState) => {
        if (root.isConnected) renderAccountsPageState(state, root, accountState);
      }).catch((error) => {
        state.api.log.warn("[account-switcher] usage refresh failed", errorMessage(error));
      }).finally(() => {
        state.usageRefreshInFlight = false;
      });
    }
    async function runSettingsAction(state, root, accountState, action, payload, loadingText) {
      const confirmed = await confirmAccountAction(state, accountState, action, payload);
      if (!confirmed) return;
      root.textContent = "";
      root.appendChild(settingsStatus(loadingText));
      try {
        const accountState2 = await invoke(state, action, payload);
        if (action === "switch" || action === "clear-active") {
          root.textContent = "";
          root.appendChild(settingsStatus(authReloadMessage(action, accountState2)));
          scheduleAppRelaunch(state, root, accountState2);
          return;
        }
        renderAccountsPageState(state, root, accountState2);
      } catch (error) {
        renderAccountsPageState(state, root, {
          ...state.lastState || { accounts: [], current: null, hasActiveAuth: false },
          error: errorMessage(error)
        });
      }
    }
    function authReloadMessage(action, accountState) {
      if (action === "clear-active") {
        return t2("accounts.sessionClearedRelaunching");
      }
      const email = accountState.current ? accountDisplayName(accountState, accountState.current, { includeCurrent: false }) : t2("accounts.selected");
      return t2("accounts.switchedRelaunching", { email });
    }
    function scheduleAppRelaunch(state, root, accountState) {
      if (accountState?.relaunchScheduled) return;
      window.setTimeout(() => {
        invoke(state, "relaunch").catch((error) => {
          root.textContent = "";
          root.appendChild(settingsStatus(t2("accounts.relaunchFailed", { error: errorMessage(error) }), true));
        });
      }, 1200);
    }
    module2.exports = {
      renderAccountsPage,
      renderAccountsPageState
    };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/ui-popup.js
var require_ui_popup = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/ui-popup.js"(exports2, module2) {
    "use strict";
    var { errorMessage } = require_utils();
    var { invoke } = require_ipc();
    var { t: t2 } = require_i18n();
    var { protectInteractiveControl } = require_dom_utils();
    var { confirmAccountAction } = require_ui_confirmation();
    var { renderAccountsPageState } = require_ui_settings();
    var {
      accountPanelShell,
      setPanelStatus,
      PANEL_ROW_LEFT_INSET,
      accountDisplayName,
      accountUsageSummary,
      addButtonFeedback,
      bindButtonAction
    } = require_ui_components();
    var ACCOUNTS_PANEL_TRANSITION_MS = 160;
    var ACCOUNTS_PANEL_EASING = "cubic-bezier(0.2, 0, 0, 1)";
    var MENU_ROW_ICON_SIZE = 20;
    var MENU_ROW_CHEVRON_SIZE = 16;
    function renderAccountPanel(state, panel, accountState) {
      panel.textContent = "";
      panel.setAttribute("data-codexpp-account-switcher", "panel");
      const accounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
      const expanded = state.accountsExpanded !== false;
      const section = document.createElement("div");
      section.style.cssText = "display:flex;flex-direction:column;padding:0;";
      section.appendChild(accountsHeaderRow(state, panel, accountState, expanded));
      if (!expanded) {
        panel.appendChild(section);
        return;
      }
      const list = document.createElement("div");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", t2("accounts.title"));
      list.style.cssText = `display:flex;flex-direction:column;min-width:0;margin-left:${PANEL_ROW_LEFT_INSET + 8}px;padding:2px 0 6px;`;
      if (accounts.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = accountState.hasActiveAuth ? t2("accounts.emptySaved") : t2("accounts.emptyActive");
        empty.style.cssText = "font-size:12px;color:var(--color-token-text-secondary,currentColor);padding:2px 0 4px;";
        list.appendChild(empty);
      }
      for (const name of accounts) {
        list.appendChild(accountRow(state, panel, accountState, name));
      }
      list.appendChild(configureAccountsRow(state, panel));
      wireAccountListKeyboard(list, panel, accountState);
      const body = document.createElement("div");
      body.setAttribute("data-codexpp-account-switcher-body", "accounts");
      body.style.cssText = "overflow:hidden;opacity:1;";
      const bodyInner = document.createElement("div");
      bodyInner.style.cssText = "min-height:0;";
      bodyInner.appendChild(list);
      body.appendChild(bodyInner);
      section.appendChild(body);
      panel.appendChild(section);
      if (accountState.notice || accountState.error) {
        const note = document.createElement("div");
        note.textContent = accountState.notice || accountState.error;
        note.style.cssText = `padding:0 24px 6px ${PANEL_ROW_LEFT_INSET}px;font-size:11px;line-height:1.3;color:` + (accountState.error ? "var(--color-token-text-error,#ff6b6b)" : "var(--color-token-text-secondary,currentColor)") + ";";
        panel.appendChild(note);
      }
    }
    function accountsHeaderRow(state, panel, accountState, expanded) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.style.cssText = `width:100%;border:0;background:transparent;color:var(--color-token-text-tertiary,currentColor);font:inherit;font-size:13px;line-height:1.25;text-align:left;border-radius:6px;min-height:38px;padding:0 12px;cursor:pointer;display:grid;grid-template-columns:${MENU_ROW_ICON_SIZE}px minmax(0,1fr) ${MENU_ROW_CHEVRON_SIZE}px;column-gap:8px;align-items:center;`;
      button.appendChild(cloneAccountIcon(panel, accountState));
      const title = document.createElement("span");
      title.textContent = t2("accounts.title");
      title.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-token-text-primary,currentColor);";
      button.appendChild(title);
      const chevronSlot = document.createElement("span");
      chevronSlot.style.cssText = `display:flex;align-items:center;justify-content:center;width:${MENU_ROW_CHEVRON_SIZE}px;height:${MENU_ROW_CHEVRON_SIZE}px;color:var(--color-token-text-tertiary,currentColor);`;
      chevronSlot.appendChild(cloneRateLimitsChevron(panel, expanded));
      button.appendChild(chevronSlot);
      addButtonFeedback(button, {
        normal: { background: "transparent" },
        hover: { background: "color-mix(in srgb,currentColor 8%,transparent)" },
        active: {
          background: "color-mix(in srgb,currentColor 12%,transparent)",
          transform: "scale(0.99)"
        }
      });
      protectInteractiveControl(button);
      bindButtonAction(button, () => toggleAccountsExpanded(state, panel, accountState, expanded));
      return button;
    }
    function toggleAccountsExpanded(state, panel, accountState, expanded) {
      if (!expanded) {
        state.accountsExpanded = true;
        renderAccountPanel(state, panel, accountState);
        return;
      }
      const header = panel.querySelector("button[aria-expanded='true']");
      header?.setAttribute("aria-expanded", "false");
      const chevron = header?.querySelector("svg");
      if (chevron instanceof SVGElement) {
        chevron.style.transform = "rotate(0deg)";
      }
      state.accountsExpanded = false;
      renderAccountPanel(state, panel, accountState);
    }
    function cloneAccountIcon(panel, accountState) {
      const icon = findAccountMenuIcon(panel, accountState);
      const slot = document.createElement("span");
      slot.setAttribute("aria-hidden", "true");
      slot.style.cssText = `display:flex;align-items:center;justify-content:center;height:${MENU_ROW_ICON_SIZE}px;width:${MENU_ROW_ICON_SIZE}px;color:var(--color-token-text-tertiary,currentColor);`;
      if (icon) {
        const clone = icon.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        clone.style.width = `${MENU_ROW_ICON_SIZE}px`;
        clone.style.height = `${MENU_ROW_ICON_SIZE}px`;
        slot.appendChild(clone);
        return slot;
      }
      slot.textContent = "\u25CE";
      slot.style.fontSize = "13px";
      return slot;
    }
    function findAccountMenuIcon(panel, accountState) {
      const menu = panel.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') || document;
      const current = accountState.current ? accountDisplayName(accountState, accountState.current, { includeCurrent: false }) : "";
      const candidates2 = Array.from(menu.querySelectorAll('button, a, [role="menuitem"], div'));
      const accountRow2 = candidates2.find((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const text = element.textContent || "";
        return current && text.includes(current) || /@/.test(text);
      });
      if (!(accountRow2 instanceof HTMLElement)) return null;
      return accountRow2.querySelector("svg");
    }
    function cloneRateLimitsChevron(panel, expanded) {
      const chevron = findRateLimitsChevron(panel);
      if (chevron) {
        const clone = chevron.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        clone.style.width = `${MENU_ROW_CHEVRON_SIZE}px`;
        clone.style.height = `${MENU_ROW_CHEVRON_SIZE}px`;
        clone.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
        clone.style.transformOrigin = "center";
        clone.style.transition = `transform ${ACCOUNTS_PANEL_TRANSITION_MS}ms ${ACCOUNTS_PANEL_EASING}`;
        return clone;
      }
      const fallback = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      fallback.setAttribute("aria-hidden", "true");
      fallback.setAttribute("width", String(MENU_ROW_CHEVRON_SIZE));
      fallback.setAttribute("height", String(MENU_ROW_CHEVRON_SIZE));
      fallback.setAttribute("viewBox", "0 0 16 16");
      fallback.setAttribute("fill", "none");
      fallback.style.transform = expanded ? "rotate(90deg)" : "rotate(0deg)";
      fallback.style.transformOrigin = "center";
      fallback.style.transition = `transform ${ACCOUNTS_PANEL_TRANSITION_MS}ms ${ACCOUNTS_PANEL_EASING}`;
      const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path2.setAttribute("d", "M6 3.75 10 8l-4 4.25");
      path2.setAttribute("stroke", "currentColor");
      path2.setAttribute("stroke-width", "1.8");
      path2.setAttribute("stroke-linecap", "round");
      path2.setAttribute("stroke-linejoin", "round");
      fallback.appendChild(path2);
      return fallback;
    }
    function findRateLimitsChevron(panel) {
      const menu = panel.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') || document;
      const rateLimits = Array.from(menu.querySelectorAll('button, a, [role="menuitem"]')).find((element) => {
        return element instanceof HTMLElement && /\b(?:usage remaining|rate limits)\b/i.test(element.textContent || "");
      });
      if (!(rateLimits instanceof HTMLElement)) return null;
      const icons = Array.from(rateLimits.querySelectorAll("svg"));
      return icons.length ? icons[icons.length - 1] : null;
    }
    function accountRow(state, panel, accountState, name) {
      const row = document.createElement("button");
      row.type = "button";
      const displayName = accountDisplayName(accountState, name, { includeCurrent: false });
      const isCurrent = accountState.current === name;
      row.title = displayName;
      row.setAttribute("data-codexpp-account-switcher-list-item", "account");
      row.setAttribute("data-codexpp-account-name", name);
      row.setAttribute("aria-current", isCurrent ? "true" : "false");
      const normalBackground = isCurrent ? "var(--color-token-list-hover-background, var(--color-token-bg-tertiary, color-mix(in srgb,currentColor 8%,transparent)))" : "transparent";
      row.style.cssText = `width:100%;border:0;text-align:left;font:inherit;display:flex;flex-direction:column;gap:2px;border-radius:8px;margin-left:-8px;margin-right:-8px;padding:4px 8px;background:${normalBackground};color:var(--color-token-text-primary,currentColor);cursor:pointer;`;
      const nameText = document.createElement("span");
      nameText.textContent = accountDisplayName(accountState, name);
      nameText.style.cssText = "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;";
      row.appendChild(nameText);
      const usage = accountUsageSummary(accountState, name);
      row.setAttribute("aria-label", accountRowAriaLabel(displayName, usage, isCurrent));
      if (usage) {
        const usageText = document.createElement("span");
        usageText.textContent = usage;
        usageText.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-token-text-secondary,currentColor);font-size:11px;";
        row.appendChild(usageText);
      }
      addButtonFeedback(row, {
        normal: { background: normalBackground },
        hover: {
          background: accountState.current === name ? "var(--color-token-list-hover-background, var(--color-token-bg-tertiary, color-mix(in srgb,currentColor 10%,transparent)))" : "var(--color-token-list-hover-background, color-mix(in srgb,currentColor 8%,transparent))"
        },
        active: {
          background: accountState.current === name ? "var(--color-token-list-active-selection-background, var(--color-token-list-hover-background, color-mix(in srgb,currentColor 12%,transparent)))" : "var(--color-token-list-hover-background, color-mix(in srgb,currentColor 12%,transparent))",
          transform: "scale(0.99)"
        }
      });
      protectInteractiveControl(row);
      bindButtonAction(row, async () => {
        if (accountState.current === name) return;
        const confirmed = await confirmAccountAction(state, accountState, "switch", { name });
        if (!confirmed) return;
        void runPanelAction(state, panel, "switch", { name }, t2("accounts.switching"));
      });
      return row;
    }
    function accountRowAriaLabel(displayName, usage, isCurrent) {
      const action = isCurrent ? "Current account" : "Switch to account";
      return [action, displayName, usage ? `Usage ${usage}` : ""].filter(Boolean).join(". ");
    }
    function configureAccountsRow(state, panel) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-codexpp-account-switcher-list-item", "configure");
      button.textContent = t2("accounts.configure");
      button.style.cssText = "width:100%;border:0;background:transparent;color:var(--color-token-text-secondary,currentColor);font:inherit;font-size:13px;text-align:left;border-radius:8px;margin-left:-8px;margin-right:-8px;padding:5px 8px;cursor:pointer;";
      addButtonFeedback(button, {
        normal: { background: "transparent" },
        hover: { background: "color-mix(in srgb,currentColor 8%,transparent)" },
        active: {
          background: "color-mix(in srgb,currentColor 12%,transparent)",
          transform: "scale(0.99)"
        }
      });
      protectInteractiveControl(button);
      bindButtonAction(button, () => openAccountsSettings(state, panel));
      return button;
    }
    function wireAccountListKeyboard(list, panel, accountState) {
      const items = accountListItems(list);
      if (!items.length) return;
      const current = items.find((item) => item.getAttribute("data-codexpp-account-name") === accountState.current);
      setAccountListTabStop(items, current || items[0]);
      const onKeyDown = (event) => {
        if (event.defaultPrevented) return;
        const active = items.includes(document.activeElement) ? document.activeElement : items.find((item) => item.tabIndex === 0) || items[0];
        const index = Math.max(0, items.indexOf(active));
        let next = null;
        if (event.key === "ArrowDown" || event.key === "ArrowRight") next = items[(index + 1) % items.length];
        else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = items[(index - 1 + items.length) % items.length];
        else if (event.key === "Home") next = items[0];
        else if (event.key === "End") next = items[items.length - 1];
        else if (event.key === "Escape") next = panel.querySelector("button[aria-expanded='true']");
        else if (event.key?.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const needle = event.key.toLowerCase();
          next = items.slice(index + 1).concat(items.slice(0, index + 1)).find((item) => item.textContent.trim().toLowerCase().startsWith(needle));
        }
        if (!next) return;
        event.preventDefault();
        setAccountListTabStop(items, next);
        next.focus();
      };
      list.addEventListener("keydown", onKeyDown);
      for (const item of items) item.addEventListener("keydown", onKeyDown);
    }
    function accountListItems(list) {
      return Array.from(list.querySelectorAll("[data-codexpp-account-switcher-list-item]")).filter((item) => item instanceof HTMLElement && !item.disabled);
    }
    function setAccountListTabStop(items, active) {
      for (const item of items) item.tabIndex = item === active ? 0 : -1;
    }
    function openAccountsSettings(state, panel) {
      const menu = panel.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') || document;
      const settingsItem = findMenuCommand(menu, /settings/i);
      settingsItem?.click();
      window.setTimeout(() => {
        const accountsNav = Array.from(
          document.querySelectorAll('button[data-codexpp^="nav-page-"], button')
        ).find((element) => {
          return element instanceof HTMLElement && /\baccounts\b/i.test(element.textContent || "");
        });
        if (accountsNav instanceof HTMLElement) accountsNav.click();
      }, 300);
      panel.remove();
    }
    function findMenuCommand(root, pattern) {
      return Array.from(root.querySelectorAll('button, a, [role="menuitem"]')).find((element) => {
        return element instanceof HTMLElement && pattern.test(element.textContent || "");
      });
    }
    async function runPanelAction(state, panel, action, payload, loadingText) {
      setPanelStatus(panel, loadingText);
      try {
        const accountState = await invoke(state, action, payload);
        if (action === "switch" || action === "clear-active") {
          setPanelStatus(panel, authReloadMessage(action, accountState));
          scheduleAppRelaunch(state, panel, accountState);
          return;
        }
        renderAccountPanel(state, panel, accountState);
        if (state.settingsRoot?.isConnected) {
          renderAccountsPageState(state, state.settingsRoot, accountState);
        }
      } catch (error) {
        renderAccountPanel(state, panel, {
          ...state.lastState || { accounts: [], current: null, hasActiveAuth: false },
          error: errorMessage(error)
        });
      }
    }
    function authReloadMessage(action, accountState) {
      if (action === "clear-active") {
        return t2("accounts.sessionClearedRelaunching");
      }
      const email = accountState.current ? accountDisplayName(accountState, accountState.current, { includeCurrent: false }) : t2("accounts.selected");
      return t2("accounts.switchedRelaunching", { email });
    }
    function scheduleAppRelaunch(state, panel, accountState) {
      if (accountState?.relaunchScheduled) return;
      window.setTimeout(() => {
        invoke(state, "relaunch").catch((error) => {
          setPanelStatus(panel, t2("accounts.relaunchFailed", { error: errorMessage(error) }));
        });
      }, 1200);
    }
    async function refreshPanel(state, panel) {
      setPanelStatus(panel, t2("accounts.loading"));
      try {
        const accountState = await invoke(state, "state");
        renderAccountPanel(state, panel, accountState);
        refreshUsageInBackground(state, panel);
      } catch (error) {
        setPanelStatus(panel, errorMessage(error));
      }
    }
    function refreshUsageInBackground(state, panel) {
      const now = Date.now();
      if (state.usageRefreshInFlight || now - (state.lastUsageRefreshAt || 0) < 6e4) return;
      state.usageRefreshInFlight = true;
      state.lastUsageRefreshAt = now;
      invoke(state, "refresh-usage").then((accountState) => {
        if (panel.isConnected) renderAccountPanel(state, panel, accountState);
        if (state.settingsRoot?.isConnected) {
          renderAccountsPageState(state, state.settingsRoot, accountState);
        }
      }).catch((error) => {
        state.api.log.warn("[account-switcher] usage refresh failed", errorMessage(error));
      }).finally(() => {
        state.usageRefreshInFlight = false;
      });
    }
    module2.exports = { renderAccountPanel, accountPanelShell, refreshPanel };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/renderer.js
var require_renderer = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/renderer.js"(exports2, module2) {
    "use strict";
    var { compactText, isVisible, findMenuItem } = require_dom_utils();
    var { accountPanelShell, renderAccountPanel, refreshPanel } = require_ui_popup();
    var { renderAccountsPage } = require_ui_settings();
    var USAGE_MENU_PATTERN = /\b(?:usage remaining|rate limits(?: remaining)?)\b/i;
    var ACCOUNT_MENU_SETTLE_SCAN_DELAYS_MS = [50, 150, 350, 700];
    var ACCOUNT_MENU_SIGNAL_PATTERN = /\b(?:personal account|usage remaining|rate limits(?: remaining)?|settings|log out)\b|@/i;
    var DETECTOR_MISS_LOG_INTERVAL_MS = 6e4;
    var ACCOUNT_MENU_PROBE_WINDOW_MS = 1200;
    var ACCOUNT_MENU_TRIGGER_SELECTOR = [
      "[data-codexpp-account-switcher]",
      "[data-codexpp-account-switcher-confirm]",
      '[role="menu"]',
      "[data-radix-menu-content]",
      "[data-radix-popper-content-wrapper]",
      "[data-radix-menu-trigger]",
      '[aria-haspopup="menu"]',
      '[aria-haspopup="true"]',
      "[aria-expanded]"
    ].join(", ");
    var ACCOUNT_MENU_TRIGGER_TEXT_PATTERN = /\b(?:account|profile|avatar|user menu|usage remaining|rate limits(?: remaining)?|settings|log out)\b|@/i;
    var INTERACTIVE_TRIGGER_SELECTOR = [
      "button",
      "a",
      '[role="button"]',
      '[role="menuitem"]'
    ].join(", ");
    var ACCOUNT_MENU_ITEM_SELECTOR = [
      "button",
      "a",
      '[role="button"]',
      '[role="menuitem"]',
      "[data-radix-collection-item]"
    ].join(", ");
    var ACCOUNT_MENU_ROOT_SELECTOR = [
      '[role="menu"]',
      "[data-radix-menu-content]",
      "[data-radix-popper-content-wrapper]",
      '[data-state="open"]',
      "[data-side][data-align]"
    ].join(", ");
    function startRenderer(state) {
      if (typeof state.api.settings?.registerPage === "function") {
        const pageHandle = state.api.settings.registerPage({
          id: "accounts",
          title: "Accounts",
          description: "Switch Codex accounts and manage saved sessions.",
          iconSvg: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle" aria-hidden="true"><path d="M10 10.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M4.75 16.25c.7-2.15 2.65-3.5 5.25-3.5s4.55 1.35 5.25 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
          render: (root) => {
            state.settingsRoot = root;
            renderAccountsPage(state, root);
          }
        });
        state.disposers.push(() => pageHandle.unregister?.());
      } else {
        state.api.log.warn(
          "[account-switcher] registerPage unavailable; account controls will only appear in the account menu."
        );
      }
      if (typeof state.accountMenuOpen !== "boolean") state.accountMenuOpen = false;
      const schedule = (withFollowUps = false, force = false) => {
        if (state.disposed) return;
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
      state.disposers.push(() => state.observer?.disconnect());
      state.disposers.push(() => clearAccountMenuSettleScans(state));
      const MENU_TRIGGER_KEYS = /* @__PURE__ */ new Set(["Enter", " ", "ArrowDown", "ArrowUp", "Escape"]);
      const scheduleWithFollowUps = (event) => {
        if (event?.type === "pointerdown" && !shouldProbeAccountMenuFromPointer(event, state)) {
          return;
        }
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
        "class"
      ];
      return [
        compactText(element),
        ...attributes.map((attribute) => element.getAttribute?.(attribute) || "")
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
    function scanForAccountMenu(state) {
      const menu = findSettingsAccountMenu();
      if (!menu) {
        if (state) {
          const snapshot = isAccountMenuProbeActive(state) ? captureAccountMenuDomSnapshot() : { count: 0, entries: [], joinedText: "" };
          const realMiss = snapshot.entries.length > 0;
          const patch = {
            status: realMiss ? "missing" : "idle",
            lastReason: realMiss ? "Saw account-menu text but no full menu container matched." : "Account menu is closed \u2014 nothing to inject yet.",
            lastSnapshot: snapshot
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
        lastSnapshot: captureAccountMenuDomSnapshot(menu)
      });
      if (menu.querySelector("[data-codexpp-account-switcher]")) {
        if (state) {
          state.accountMenuOpen = true;
          updateDetectorHealth(state, {
            status: "already installed",
            lastReason: "Accounts accordion is already mounted in the menu."
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
      const candidates2 = Array.from(
        document.querySelectorAll(accountMenuCandidateSelector())
      );
      for (const candidate of candidates2) {
        if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) continue;
        const text = accountMenuText(candidate);
        if (!/\bsettings\b/i.test(text) || !/\blog out\b/i.test(text)) continue;
        if (!USAGE_MENU_PATTERN.test(text) && !/@/.test(text)) continue;
        return candidate.matches("[data-radix-popper-content-wrapper]") ? candidate.querySelector('[role="menu"], [data-radix-menu-content]') || candidate : candidate;
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
        new Set(roots.flatMap((root) => Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR))))
      ).filter((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
        if (element.closest("[data-codexpp-account-switcher]")) return false;
        const text = compactText(element);
        return USAGE_MENU_PATTERN.test(text) || /\blog out\b/i.test(text);
      });
      const candidates2 = [];
      for (const anchor of anchors) {
        let node = anchor;
        while (node && node !== document.body && node !== document.documentElement) {
          if (node instanceof HTMLElement && isVisible(node) && looksLikeAccountMenu(node)) {
            candidates2.push(node);
          }
          node = node.parentElement;
        }
      }
      return smallestAccountMenuCandidate([...candidates2, ...rootCandidates]);
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
    function smallestAccountMenuCandidate(candidates2) {
      const unique = Array.from(new Set(candidates2)).filter((candidate) => candidate instanceof HTMLElement);
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
        accountMenuCandidateSelector()
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
      const candidates2 = root === document ? accountMenuRoots().flatMap((menuRoot) => Array.from(menuRoot.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR))) : Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR));
      for (const element of candidates2) {
        if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
        if (element.closest("[data-codexpp-account-switcher]")) continue;
        const text = compactText(element).toLowerCase();
        if (!USAGE_MENU_PATTERN.test(text)) continue;
        return element;
      }
      return null;
    }
    function findSidebarAccountMenuByItems() {
      const items = accountMenuRoots().flatMap((root) => Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR))).filter((element) => element instanceof HTMLElement && isVisible(element));
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
      const explicitRoots = Array.from(root.querySelectorAll(ACCOUNT_MENU_ROOT_SELECTOR)).filter((element) => element instanceof HTMLElement && isVisible(element));
      return Array.from(/* @__PURE__ */ new Set([
        ...explicitRoots,
        ...inferAccountMenuRootsFromItems(root),
        ...inferAccountMenuRootsFromBodyChildren(root)
      ]));
    }
    function inferAccountMenuRootsFromItems(root = document) {
      const candidates2 = [];
      for (const item of Array.from(root.querySelectorAll(ACCOUNT_MENU_ITEM_SELECTOR))) {
        if (!(item instanceof HTMLElement) || !isVisible(item)) continue;
        if (item.closest("[data-codexpp-account-switcher]")) continue;
        const text = compactText(item);
        if (!ACCOUNT_MENU_SIGNAL_PATTERN.test(text)) continue;
        let node = item.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
          if (node instanceof HTMLElement && looksLikeAccountMenu(node)) {
            candidates2.push(node);
            break;
          }
          node = node.parentElement;
        }
      }
      return candidates2;
    }
    function inferAccountMenuRootsFromBodyChildren(root = document) {
      if (root !== document || !document.body?.children) return [];
      return Array.from(document.body.children).filter((element) => element instanceof HTMLElement).filter((element) => !element.matches?.(ACCOUNT_MENU_ROOT_SELECTOR)).filter((element) => !element.querySelector?.(ACCOUNT_MENU_ROOT_SELECTOR)).filter((element) => {
        if (!isPlausibleAccountMenuBox(element)) return false;
        const text = accountMenuText(element);
        if (!/\bsettings\b/i.test(text) || !/\blog out\b/i.test(text)) return false;
        return USAGE_MENU_PATTERN.test(text) || /@/.test(text);
      });
    }
    function normalizeAccountMenuCandidate(candidate) {
      if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) return null;
      const menu = candidate.matches("[data-radix-popper-content-wrapper]") ? candidate.querySelector('[role="menu"], [data-radix-menu-content]') || candidate : candidate;
      return menu instanceof HTMLElement && isVisible(menu) && looksLikeAccountMenu(menu) ? menu : null;
    }
    function installAccountSwitcher(state, menu) {
      const target = findMenuItem(menu, USAGE_MENU_PATTERN) || findMenuItem(menu, /settings/i) || Array.from(menu.children).find((child) => child instanceof HTMLElement);
      if (!(target instanceof HTMLElement) || !target.parentElement) return;
      const panel = accountPanelShell(target);
      target.before(panel);
      if (state) state.accountMenuOpen = true;
      refreshPanel(state, panel).catch((error) => {
        state.api.log.warn("[account-switcher] panel load failed", String(error));
      });
      updateDetectorHealth(state, {
        status: "installed",
        lastInstalledAt: Date.now(),
        lastReason: "Accounts accordion was inserted into the account menu.",
        lastMenuText: accountMenuText(menu).slice(0, 240)
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
      return pieces.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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
        ...patch
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
          signals: snapshot.entries.slice(0, 8)
        })
      );
    }
    function captureAccountMenuDomSnapshot(root = document) {
      const entries = [];
      if (!root?.querySelectorAll) return { count: 0, entries, joinedText: "" };
      const elements = root === document ? Array.from(/* @__PURE__ */ new Set([
        ...accountMenuRoots(root),
        ...inferAccountMenuRootsFromBodyChildren(root)
      ])).flatMap((menuRoot) => [
        menuRoot,
        ...Array.from(menuRoot.querySelectorAll(`${ACCOUNT_MENU_ITEM_SELECTOR}, div`))
      ]) : Array.from(root.querySelectorAll(`${ACCOUNT_MENU_ITEM_SELECTOR}, div`));
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
          text: text.slice(0, 180)
        });
        if (entries.length >= 16) break;
      }
      return {
        count: entries.length,
        entries,
        joinedText: entries.map((entry) => entry.text).join(" | ")
      };
    }
    module2.exports = {
      startRenderer,
      __test: {
        captureAccountMenuDomSnapshot,
        findSettingsAccountMenu
      }
    };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/node-utils.js
var require_node_utils = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/node-utils.js"(exports2, module2) {
    "use strict";
    var { ACCOUNT_NAME_PATTERN } = require_constants();
    function nodeDeps2() {
      return {
        fs: require("node:fs"),
        fsp: require("node:fs/promises"),
        os: require("node:os"),
        path: require("node:path")
      };
    }
    function codexAuthPaths2() {
      const { os, path: path2 } = nodeDeps2();
      const CODEX_DIR = path2.join(os.homedir(), ".codex");
      return {
        CODEX_DIR,
        AUTH_PATH: path2.join(CODEX_DIR, "auth.json"),
        ACCOUNTS_DIR: path2.join(CODEX_DIR, "auth_accounts"),
        USAGE_CACHE_PATH: path2.join(CODEX_DIR, "auth_accounts_usage.json"),
        CURRENT_NAME_PATH: path2.join(CODEX_DIR, "current_account")
      };
    }
    function normalizeAccountName2(rawName) {
      if (typeof rawName !== "string") throw new Error("Account name is required.");
      const name = rawName.trim().replace(/\.json$/i, "");
      if (!ACCOUNT_NAME_PATTERN.test(name)) {
        throw new Error(
          "Use letters, numbers, dots, underscores, or dashes. The name must start with a letter or number."
        );
      }
      return name;
    }
    function accountPath2(name) {
      const { path: path2 } = nodeDeps2();
      const { ACCOUNTS_DIR } = codexAuthPaths2();
      return path2.join(ACCOUNTS_DIR, `${name}.json`);
    }
    async function ensureDir2(dir) {
      const { fsp } = nodeDeps2();
      await fsp.mkdir(dir, { recursive: true });
    }
    async function pathExists2(target) {
      const { fs, fsp } = nodeDeps2();
      try {
        await fsp.access(target, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
    module2.exports = { nodeDeps: nodeDeps2, codexAuthPaths: codexAuthPaths2, normalizeAccountName: normalizeAccountName2, accountPath: accountPath2, ensureDir: ensureDir2, pathExists: pathExists2 };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/account/auth.js
var require_auth = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/account/auth.js"(exports2, module2) {
    "use strict";
    function emailFromAuthString(raw) {
      try {
        return emailFromAuth(JSON.parse(raw));
      } catch {
        return null;
      }
    }
    function emailFromAuth(auth) {
      const direct = auth?.email || auth?.user?.email || auth?.account?.email;
      if (typeof direct === "string" && direct.includes("@")) return direct;
      const idToken = auth?.tokens?.id_token;
      if (typeof idToken !== "string") return null;
      const [, payload] = idToken.split(".");
      if (!payload) return null;
      try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return typeof claims.email === "string" && claims.email.includes("@") ? claims.email : null;
      } catch {
        return null;
      }
    }
    module2.exports = { emailFromAuthString, emailFromAuth };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/account/storage.js
var require_storage = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/account/storage.js"(exports2, module2) {
    "use strict";
    var {
      nodeDeps: nodeDeps2,
      codexAuthPaths: codexAuthPaths2,
      accountPath: accountPath2,
      ensureDir: ensureDir2,
      pathExists: pathExists2
    } = require_node_utils();
    var { emailFromAuthString } = require_auth();
    async function listAccountNames2() {
      const { fsp } = nodeDeps2();
      const { ACCOUNTS_DIR } = codexAuthPaths2();
      if (!await pathExists2(ACCOUNTS_DIR)) return [];
      const entries = await fsp.readdir(ACCOUNTS_DIR, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name.replace(/\.json$/i, "")).sort((a, b) => a.localeCompare(b, void 0, { sensitivity: "base" }));
    }
    async function getCurrentAccountName2(accounts) {
      const { fsp, path: path2 } = nodeDeps2();
      const { AUTH_PATH, ACCOUNTS_DIR, CURRENT_NAME_PATH } = codexAuthPaths2();
      if (!await pathExists2(AUTH_PATH)) return null;
      const matched = await findMatchingAccountByContents(accounts);
      if (matched) return matched;
      try {
        const raw = await fsp.readFile(CURRENT_NAME_PATH, "utf8");
        const name = raw.trim();
        if (name && accounts.includes(name)) return name;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (!await pathExists2(AUTH_PATH)) return null;
      try {
        const stat = await fsp.lstat(AUTH_PATH);
        if (stat.isSymbolicLink()) {
          const target = await fsp.readlink(AUTH_PATH);
          const resolved = path2.resolve(path2.dirname(AUTH_PATH), target);
          const relative = path2.relative(path2.resolve(ACCOUNTS_DIR), resolved);
          if (!relative.startsWith("..") && !path2.isAbsolute(relative)) {
            return path2.basename(resolved).replace(/\.json$/i, "");
          }
        }
      } catch {
      }
      return null;
    }
    async function findMatchingAccountByContents(accounts) {
      const { fsp } = nodeDeps2();
      const { AUTH_PATH } = codexAuthPaths2();
      let active;
      try {
        active = await fsp.readFile(AUTH_PATH, "utf8");
      } catch {
        return null;
      }
      for (const name of accounts) {
        try {
          const saved = await fsp.readFile(accountPath2(name), "utf8");
          if (saved === active) return name;
        } catch {
        }
      }
      return null;
    }
    async function accountContentsMatchActive(contents) {
      const { fsp } = nodeDeps2();
      const { AUTH_PATH } = codexAuthPaths2();
      try {
        return await fsp.readFile(AUTH_PATH, "utf8") === contents;
      } catch {
        return false;
      }
    }
    async function ensureAutosavedActiveAccount() {
      const { fsp } = nodeDeps2();
      const { AUTH_PATH, ACCOUNTS_DIR, CURRENT_NAME_PATH } = codexAuthPaths2();
      if (!await pathExists2(AUTH_PATH)) return null;
      const accounts = await listAccountNames2();
      const matched = await findMatchingAccountByContents(accounts);
      if (matched) {
        await fsp.writeFile(CURRENT_NAME_PATH, `${matched}
`, "utf8");
        return matched;
      }
      const active = await fsp.readFile(AUTH_PATH, "utf8");
      const sameEmail = await findMatchingAccountByEmail(accounts, active);
      if (sameEmail) {
        await fsp.copyFile(AUTH_PATH, accountPath2(sameEmail));
        await fsp.writeFile(CURRENT_NAME_PATH, `${sameEmail}
`, "utf8");
        return sameEmail;
      }
      await ensureDir2(ACCOUNTS_DIR);
      const name = await nextAvailableAccountName("account");
      await fsp.copyFile(AUTH_PATH, accountPath2(name));
      await fsp.writeFile(CURRENT_NAME_PATH, `${name}
`, "utf8");
      return name;
    }
    async function findMatchingAccountByEmail(accounts, activeContents) {
      const activeEmail = emailFromAuthString(activeContents)?.toLowerCase();
      if (!activeEmail) return null;
      const { fsp } = nodeDeps2();
      const { CURRENT_NAME_PATH } = codexAuthPaths2();
      let current = null;
      try {
        current = (await fsp.readFile(CURRENT_NAME_PATH, "utf8")).trim();
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const matches = [];
      for (const name of accounts) {
        try {
          const filePath = accountPath2(name);
          const [contents, stat] = await Promise.all([
            fsp.readFile(filePath, "utf8"),
            fsp.stat(filePath)
          ]);
          if (emailFromAuthString(contents)?.toLowerCase() === activeEmail) {
            matches.push({ name, isCurrent: name === current, mtimeMs: stat.mtimeMs });
          }
        } catch {
        }
      }
      matches.sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
        return a.name.localeCompare(b.name, void 0, { sensitivity: "base" });
      });
      return matches[0]?.name || null;
    }
    async function nextAvailableAccountName(baseName) {
      const accounts = new Set(await listAccountNames2());
      if (!accounts.has(baseName)) return baseName;
      for (let index = 2; index < 1e4; index += 1) {
        const name = `${baseName}-${index}`;
        if (!accounts.has(name)) return name;
      }
      throw new Error("Could not find an available account name.");
    }
    module2.exports = {
      listAccountNames: listAccountNames2,
      getCurrentAccountName: getCurrentAccountName2,
      findMatchingAccountByContents,
      findMatchingAccountByEmail,
      accountContentsMatchActive,
      ensureAutosavedActiveAccount,
      nextAvailableAccountName
    };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/account/usage.js
var require_usage = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/account/usage.js"(exports, module) {
    "use strict";
    var { nodeDeps, codexAuthPaths, ensureDir } = require_node_utils();
    async function readAccountUsage(accounts) {
      const { fsp } = nodeDeps();
      const { USAGE_CACHE_PATH } = codexAuthPaths();
      let raw;
      try {
        raw = JSON.parse(await fsp.readFile(USAGE_CACHE_PATH, "utf8"));
      } catch {
        return {};
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(
        accounts.map((name) => [name, normalizeUsageSnapshot(raw[name])]).filter(([, usage]) => usage)
      );
    }
    async function writeAccountUsage(name, snapshot) {
      const { fsp } = nodeDeps();
      const { CODEX_DIR, USAGE_CACHE_PATH } = codexAuthPaths();
      const usage = normalizeUsageSnapshot(snapshot);
      if (!usage) return false;
      let cache = {};
      try {
        const raw = JSON.parse(await fsp.readFile(USAGE_CACHE_PATH, "utf8"));
        if (raw && typeof raw === "object" && !Array.isArray(raw)) cache = raw;
      } catch {
      }
      cache[name] = usage;
      await ensureDir(CODEX_DIR);
      await fsp.writeFile(USAGE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}
`, "utf8");
      return true;
    }
    function normalizeUsageSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return null;
      const fiveHour = normalizeUsageWindow(snapshot.fiveHour);
      const weekly = normalizeUsageWindow(snapshot.weekly);
      if (!fiveHour && !weekly) return null;
      const at = Number(snapshot.at);
      return {
        fiveHour,
        weekly,
        at: Number.isFinite(at) ? at : Date.now()
      };
    }
    function normalizeUsageWindow(window2) {
      if (!window2 || typeof window2 !== "object") return null;
      const pct = Number(window2.pct);
      if (!Number.isFinite(pct)) return null;
      return {
        label: typeof window2.label === "string" && window2.label ? window2.label : null,
        pct: Math.max(0, Math.min(100, Math.round(pct))),
        resetAt: typeof window2.resetAt === "string" && window2.resetAt ? window2.resetAt : null
      };
    }
    async function fetchActiveUsageSnapshot(api2) {
      if (typeof api2?.fetchActiveUsage === "function") {
        return api2.fetchActiveUsage();
      }
      const usage = await fetchUsageInCodexWebview();
      return snapshotFromUsagePayload(usage);
    }
    async function fetchUsageInCodexWebview() {
      const electronRequire = eval("require");
      const { webContents } = electronRequire("electron");
      const candidates = webContents.getAllWebContents().filter((wc) => {
        const url = wc.getURL();
        return !wc.isDestroyed() && (url.startsWith("app://") || url.includes("codex"));
      });
      let lastError = null;
      for (const wc of candidates) {
        try {
          return await wc.executeJavaScript(usageFetchScript(), true);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("No Codex webview available for usage fetch.");
    }
    function usageFetchScript() {
      return `(() => new Promise((resolve, reject) => {
    const bridge = window.electronBridge;
    if (typeof bridge?.sendMessageFromView !== "function") {
      reject(new Error("electronBridge unavailable"));
      return;
    }
    const hostId = new URL(window.location.href).searchParams.get("hostId")?.trim() || "local";
    const requestId = "account-switcher-usage-" + Date.now() + "-" + Math.random().toString(36).slice(2);
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
    function snapshotFromUsagePayload(payload) {
      const windows = collectUsageWindows(payload);
      const five = pickClosestUsageWindow(windows, 300, (minutes) => minutes > 0 && minutes < 1440);
      const weekly = pickClosestUsageWindow(windows, 7 * 24 * 60, (minutes) => minutes >= 1440);
      return {
        fiveHour: usageWindowSnapshot(five, "5h"),
        weekly: usageWindowSnapshot(weekly, "Weekly"),
        at: Date.now()
      };
    }
    function collectUsageWindows(value, out = [], seen = /* @__PURE__ */ new WeakSet()) {
      if (!value || typeof value !== "object") return out;
      if (seen.has(value)) return out;
      seen.add(value);
      if ("used_percent" in value && "limit_window_seconds" in value && "reset_at" in value) {
        out.push(value);
      }
      const values = Array.isArray(value) ? value : Object.values(value);
      for (const item of values) collectUsageWindows(item, out, seen);
      return out;
    }
    function pickClosestUsageWindow(windows, targetMinutes, predicate) {
      let best = null;
      let bestDistance = Infinity;
      for (const window2 of windows) {
        const minutes = Number(window2?.limit_window_seconds) / 60;
        if (!Number.isFinite(minutes) || !predicate(minutes)) continue;
        const distance = Math.abs(minutes - targetMinutes);
        if (!best || distance < bestDistance) {
          best = window2;
          bestDistance = distance;
        }
      }
      return best;
    }
    function usageWindowSnapshot(window2, label) {
      if (!window2 || typeof window2 !== "object") return null;
      const used = Number(window2.used_percent);
      if (!Number.isFinite(used)) return null;
      const resetAt = formatUsageResetAt(window2.reset_at, Number(window2.limit_window_seconds) >= 86400);
      return {
        label,
        pct: Math.round(Math.min(Math.max(100 - used, 0), 100)),
        resetAt
      };
    }
    function formatUsageResetAt(epochSeconds, includeDay) {
      const seconds = Number(epochSeconds);
      if (!Number.isFinite(seconds)) return null;
      const date = new Date(seconds * 1e3);
      if (!Number.isFinite(date.getTime())) return null;
      return date.toLocaleTimeString(void 0, {
        ...includeDay ? { weekday: "short" } : {},
        hour: "numeric",
        minute: "2-digit"
      });
    }
    module.exports = {
      readAccountUsage,
      writeAccountUsage,
      normalizeUsageSnapshot,
      normalizeUsageWindow,
      fetchActiveUsageSnapshot,
      snapshotFromUsagePayload
    };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/account/state.js
var require_state = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/account/state.js"(exports2, module2) {
    "use strict";
    var { nodeDeps: nodeDeps2, codexAuthPaths: codexAuthPaths2, accountPath: accountPath2, pathExists: pathExists2 } = require_node_utils();
    var { emailFromAuthString } = require_auth();
    var {
      accountContentsMatchActive,
      ensureAutosavedActiveAccount,
      getCurrentAccountName: getCurrentAccountName2,
      listAccountNames: listAccountNames2
    } = require_storage();
    var { readAccountUsage: readAccountUsage2 } = require_usage();
    async function readState2(extra = {}) {
      const { AUTH_PATH, ACCOUNTS_DIR, CURRENT_NAME_PATH } = codexAuthPaths2();
      await ensureAutosavedActiveAccount();
      const allAccounts = await listAccountNames2();
      const visibleAccounts = await selectVisibleAccounts(allAccounts);
      const accounts = visibleAccounts.map((account) => account.name);
      const current = await getCurrentAccountName2(accounts);
      const hasActiveAuth = await pathExists2(AUTH_PATH);
      const accountEmails = Object.fromEntries(
        visibleAccounts.map(({ name, email }) => [name, email]).filter(([, email]) => email)
      );
      const accountUsage = await readAccountUsage2(accounts);
      return {
        accounts,
        accountEmails,
        accountUsage,
        current,
        hasActiveAuth,
        paths: {
          auth: AUTH_PATH,
          accountsDir: ACCOUNTS_DIR,
          current: CURRENT_NAME_PATH
        },
        ...extra
      };
    }
    async function selectVisibleAccounts(accounts) {
      const details = await Promise.all(accounts.map(readAccountDetails));
      const byIdentity = /* @__PURE__ */ new Map();
      for (const detail of details) {
        const key = detail.email ? `email:${detail.email.toLowerCase()}` : `name:${detail.name}`;
        const existing = byIdentity.get(key);
        if (!existing || compareAccountPreference(detail, existing) < 0) {
          byIdentity.set(key, detail);
        }
      }
      return Array.from(byIdentity.values()).sort(
        (a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" })
      );
    }
    async function readAccountDetails(name) {
      const { fsp } = nodeDeps2();
      let raw = null;
      let mtimeMs = 0;
      try {
        const filePath = accountPath2(name);
        const [contents, stat] = await Promise.all([
          fsp.readFile(filePath, "utf8"),
          fsp.stat(filePath)
        ]);
        raw = contents;
        mtimeMs = stat.mtimeMs;
      } catch {
      }
      return {
        name,
        email: raw ? emailFromAuthString(raw) : null,
        isActive: raw ? await accountContentsMatchActive(raw) : false,
        mtimeMs
      };
    }
    function compareAccountPreference(left, right) {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
      if (left.mtimeMs !== right.mtimeMs) return right.mtimeMs - left.mtimeMs;
      return left.name.localeCompare(right.name, void 0, { sensitivity: "base" });
    }
    module2.exports = { readState: readState2, selectVisibleAccounts };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/account/actions.js
var require_actions = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/account/actions.js"(exports, module) {
    "use strict";
    var { t } = require_i18n();
    var {
      nodeDeps,
      codexAuthPaths,
      normalizeAccountName,
      accountPath,
      ensureDir,
      pathExists
    } = require_node_utils();
    var { readState } = require_state();
    var { getCurrentAccountName, listAccountNames } = require_storage();
    var { fetchActiveUsageSnapshot, writeAccountUsage } = require_usage();
    var BACKUP_FILE_PATTERN = /^auth\.account-switcher-(?:prev|backup)-.+\.json$/;
    var BACKUP_RETENTION_COUNT = 8;
    var AUTH_RELAUNCH_DELAY_MS = 250;
    var authRelaunchScheduled = false;
    async function saveCurrentAccount(rawName) {
      const { fsp } = nodeDeps();
      const { AUTH_PATH, ACCOUNTS_DIR, CURRENT_NAME_PATH } = codexAuthPaths();
      const name = normalizeAccountName(rawName);
      if (!await pathExists(AUTH_PATH)) {
        throw new Error(`No active Codex auth file found at ${AUTH_PATH}`);
      }
      await ensureDir(ACCOUNTS_DIR);
      const target = accountPath(name);
      await copyPrivateFile(AUTH_PATH, target);
      await fsp.writeFile(CURRENT_NAME_PATH, `${name}
`, "utf8");
      return readState({ notice: t("service.saved", { name }) });
    }
    async function switchAccount(rawName, api2) {
      const { fsp, path: path2 } = nodeDeps();
      const { CODEX_DIR, AUTH_PATH, CURRENT_NAME_PATH } = codexAuthPaths();
      const name = normalizeAccountName(rawName);
      const source = accountPath(name);
      if (!await pathExists(source)) throw new Error(`Saved account not found: ${name}`);
      await ensureDir(CODEX_DIR);
      if (await pathExists(AUTH_PATH)) {
        const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
        try {
          await copyPrivateFile(AUTH_PATH, path2.join(CODEX_DIR, `auth.account-switcher-prev-${stamp}.json`));
          await pruneAuthBackups(api2);
        } catch (error) {
          api2?.log?.warn?.(`[account-switcher] pre-switch backup failed: ${error && error.message ? error.message : String(error)}`);
        }
      }
      const tmp = `${AUTH_PATH}.codexpp-switch-tmp`;
      await copyPrivateFile(source, tmp);
      await fsp.rename(tmp, AUTH_PATH);
      await fsp.writeFile(CURRENT_NAME_PATH, `${name}
`, "utf8");
      api2?.log?.info?.("[account-switcher] switched auth file; scheduling ShadGPT relaunch");
      scheduleAuthRelaunch(api2, "switch");
      return readState({
        notice: t("service.switched", { name }),
        requiresAppRelaunch: true,
        relaunchScheduled: true
      });
    }
    async function deleteAccount(rawName) {
      const { fsp } = nodeDeps();
      const { CURRENT_NAME_PATH } = codexAuthPaths();
      const name = normalizeAccountName(rawName);
      await fsp.rm(accountPath(name), { force: true });
      try {
        const raw = await fsp.readFile(CURRENT_NAME_PATH, "utf8");
        if (raw.trim() === name) {
          await fsp.rm(CURRENT_NAME_PATH, { force: true });
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return readState({ notice: t("service.removed", { name }) });
    }
    async function clearActiveAuth(api2) {
      const { fsp, path: path2 } = nodeDeps();
      const { CODEX_DIR, AUTH_PATH, CURRENT_NAME_PATH } = codexAuthPaths();
      await ensureDir(CODEX_DIR);
      if (await pathExists(AUTH_PATH)) {
        const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
        await copyPrivateFile(AUTH_PATH, path2.join(CODEX_DIR, `auth.account-switcher-backup-${stamp}.json`));
        await pruneAuthBackups(api2);
        await fsp.rm(AUTH_PATH, { force: true });
      }
      await fsp.rm(CURRENT_NAME_PATH, { force: true });
      api2?.log?.info?.("[account-switcher] cleared active auth file; scheduling ShadGPT relaunch");
      scheduleAuthRelaunch(api2, "clear-active");
      return readState({
        notice: t("service.sessionCleared"),
        requiresAppRelaunch: true,
        relaunchScheduled: true
      });
    }
    function scheduleAuthRelaunch(api2, reason, deps = {}) {
      if (authRelaunchScheduled) {
        api2?.log?.info?.(`[account-switcher] ShadGPT relaunch already scheduled; ignoring duplicate ${reason}`);
        return;
      }
      const setTimeoutFn = deps.setTimeout || setTimeout;
      const relaunch = deps.relaunchCodex || relaunchCodex;
      authRelaunchScheduled = true;
      setTimeoutFn(() => {
        Promise.resolve().then(() => relaunch(api2)).catch((error) => {
          api2?.log?.warn?.("[account-switcher] scheduled ShadGPT relaunch failed", error?.message || String(error));
        }).finally(() => {
          authRelaunchScheduled = false;
        });
      }, AUTH_RELAUNCH_DELAY_MS);
    }
    function resetAuthRelaunchState() {
      authRelaunchScheduled = false;
    }
    async function copyPrivateFile(source, target) {
      const { fsp } = nodeDeps();
      await fsp.copyFile(source, target);
      await markPrivateFile(target);
    }
    async function markPrivateFile(target) {
      if (process.platform === "win32") return;
      const { fsp } = nodeDeps();
      await fsp.chmod(target, 384);
    }
    async function pruneAuthBackups(api2, keep = BACKUP_RETENTION_COUNT) {
      const { fsp, path: path2 } = nodeDeps();
      const { CODEX_DIR } = codexAuthPaths();
      let entries;
      try {
        entries = await fsp.readdir(CODEX_DIR, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") return;
        api2?.log?.warn?.(`[account-switcher] backup retention scan failed: ${error?.message || String(error)}`);
        return;
      }
      const backups = [];
      for (const entry of entries) {
        if (!entry.isFile() || !BACKUP_FILE_PATTERN.test(entry.name)) continue;
        const filePath = path2.join(CODEX_DIR, entry.name);
        try {
          const stat = await fsp.stat(filePath);
          backups.push({ filePath, mtimeMs: stat.mtimeMs, name: entry.name });
        } catch (error) {
          if (error?.code !== "ENOENT") {
            api2?.log?.warn?.(`[account-switcher] backup stat failed: ${error?.message || String(error)}`);
          }
        }
      }
      backups.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
      for (const stale of backups.slice(Math.max(0, keep))) {
        try {
          await fsp.rm(stale.filePath, { force: true });
        } catch (error) {
          api2?.log?.warn?.(`[account-switcher] backup retention failed: ${error?.message || String(error)}`);
        }
      }
    }
    async function refreshActiveUsage(api2) {
      const accounts = await listAccountNames();
      const current = await getCurrentAccountName(accounts);
      if (!current) return readState();
      const snapshot = await fetchActiveUsageSnapshot(api2);
      await writeAccountUsage(current, snapshot);
      return readState();
    }
    async function relaunchCodex(api) {
      api?.log?.info?.("[account-switcher] relaunch requested");
      const electronRequire = eval("require");
      const { app } = electronRequire("electron");
      if (!app || typeof app.quit !== "function" && typeof app.exit !== "function") {
        throw new Error("Electron app runtime is not available for relaunch.");
      }
      const relaunch = scheduleDetachedRelaunch(api);
      setTimeout(() => {
        try {
          relaunch();
        } catch (error) {
          api?.log?.warn?.("[account-switcher] failed to spawn detached relaunch", error?.message || String(error));
        }
        try {
          if (typeof app.quit === "function") app.quit();
          else app.exit(0);
          if (typeof app.exit === "function") setTimeout(() => app.exit(0), 1500).unref?.();
        } catch {
          if (typeof app.exit === "function") app.exit(0);
        }
      }, 100);
      return readState({ notice: t("service.relaunching") });
    }
    function scheduleDetachedRelaunch(api) {
      if (process.platform !== "darwin") {
        return () => {
          const electronRequire = eval("require");
          const { app } = electronRequire("electron");
          app.relaunch();
        };
      }
      const { spawn, execFileSync } = require("node:child_process");
      const { path } = nodeDeps();
      const appRoot = path.dirname(path.dirname(path.dirname(process.execPath)));
      const mainBin = path.basename(process.execPath);
      const bundleId = readBundleId(appRoot, execFileSync, path) || "";
      return () => {
        const script = `
APP_ROOT=$1
BUNDLE_ID=$2
MAIN_PATTERN="$APP_ROOT/Contents/MacOS/${mainBin}"
has_main() { /usr/bin/pgrep -f "$MAIN_PATTERN" >/dev/null 2>&1; }
wait_gone() {
  deadline=$(( $(/bin/date +%s) + $1 ))
  while has_main; do
    [ "$(/bin/date +%s)" -ge "$deadline" ] && return 1
    /bin/sleep 0.25
  done
  return 0
}
if ! wait_gone 10; then
  /usr/bin/pkill -TERM -f "$MAIN_PATTERN" >/dev/null 2>&1 || true
  wait_gone 4 || true
fi
if has_main; then
  /usr/bin/pkill -KILL -f "$MAIN_PATTERN" >/dev/null 2>&1 || true
  wait_gone 4 || true
fi
/usr/bin/open -b "$BUNDLE_ID" >/dev/null 2>&1 || /usr/bin/open "$APP_ROOT" >/dev/null 2>&1 || true
`;
        const child = spawn(
          "/bin/sh",
          ["-c", script, "codexpp-account-switcher-restart", appRoot, bundleId],
          { detached: true, stdio: "ignore" }
        );
        child.unref();
      };
    }
    function readBundleId(appRoot2, execFileSync2, path2) {
      try {
        return execFileSync2(
          "/usr/libexec/PlistBuddy",
          ["-c", "Print :CFBundleIdentifier", path2.join(appRoot2, "Contents", "Info.plist")],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim() || null;
      } catch {
        return null;
      }
    }
    module.exports = {
      saveCurrentAccount,
      switchAccount,
      deleteAccount,
      clearActiveAuth,
      refreshActiveUsage,
      relaunchCodex,
      resetAuthRelaunchState,
      __test: {
        BACKUP_RETENTION_COUNT,
        getAuthRelaunchScheduled: () => authRelaunchScheduled,
        markPrivateFile,
        pruneAuthBackups,
        scheduleAuthRelaunch
      }
    };
  }
});

// vendor/tweakers/tweaks/account-switcher/src/account/service.js
var require_service = __commonJS({
  "vendor/tweakers/tweaks/account-switcher/src/account/service.js"(exports2, module2) {
    "use strict";
    var { ok, fail, errorMessage, stringifyError } = require_utils();
    var {
      clearActiveAuth: clearActiveAuth2,
      deleteAccount: deleteAccount2,
      refreshActiveUsage: refreshActiveUsage2,
      relaunchCodex: relaunchCodex2,
      saveCurrentAccount: saveCurrentAccount2,
      switchAccount: switchAccount2
    } = require_actions();
    var { readState: readState2 } = require_state();
    var { randomBytes } = require("node:crypto");
    var INTENT_TTL_MS = 3e4;
    var DESTRUCTIVE_ACTIONS = /* @__PURE__ */ new Set(["switch", "delete", "clear-active", "relaunch"]);
    function createAccountService(api2) {
      const intents = /* @__PURE__ */ new Map();
      return {
        async handle(message) {
          const action = message?.action;
          try {
            api2.log?.info?.(`[account-switcher] action ${String(action)}`);
            if (action === "create-intent") {
              return ok({ intent: createIntent(intents, message) });
            }
            if (action === "state") return ok(await readState2());
            if (action === "save") return ok(await saveCurrentAccount2(message?.name));
            if (DESTRUCTIVE_ACTIONS.has(action) && !consumeIntent(intents, message)) {
              return fail("Account action requires a fresh confirmation intent.");
            }
            if (action === "switch") return ok(await switchAccount2(message?.name, api2));
            if (action === "delete") return ok(await deleteAccount2(message?.name));
            if (action === "clear-active") return ok(await clearActiveAuth2(api2));
            if (action === "refresh-usage") return ok(await refreshActiveUsage2(api2));
            if (action === "relaunch") return ok(await relaunchCodex2(api2));
            return fail(`Unknown account action: ${String(action)}`);
          } catch (error) {
            api2.log?.warn?.("[account-switcher] action failed", stringifyError(error));
            return fail(errorMessage(error));
          }
        }
      };
    }
    function createIntent(intents, message) {
      const action = message?.intentAction;
      if (!DESTRUCTIVE_ACTIONS.has(action)) {
        throw new Error(`Cannot create account intent for action: ${String(action)}`);
      }
      const token = randomBytes(18).toString("base64url");
      intents.set(token, {
        action,
        name: typeof message?.name === "string" ? message.name : null,
        expiresAt: Date.now() + INTENT_TTL_MS
      });
      return token;
    }
    function consumeIntent(intents, message) {
      const token = typeof message?.intent === "string" ? message.intent : "";
      if (!token) return false;
      const intent = intents.get(token);
      intents.delete(token);
      if (!intent || intent.expiresAt < Date.now()) return false;
      if (intent.action !== message?.action) return false;
      const expectedName = intent.name;
      if (expectedName !== null && expectedName !== message?.name) return false;
      return true;
    }
    module2.exports = { createAccountService };
  }
});

// vendor/tweakers/tweaks/account-switcher/index.js
var { GLOBAL_SERVICE_KEY, IPC_HANDLER_KEY, IPC_CHANNEL } = require_constants();
module.exports = {
  start(api2) {
    if (api2.process === "main") {
      startMain(api2);
      return;
    }
    const state = {
      api: api2,
      accountsExpanded: false,
      observer: null,
      pending: 0,
      disposed: false,
      disposers: [],
      lastState: null,
      lastUsageRefreshAt: 0,
      settingsRoot: null,
      accountMenuRescanTimers: [],
      usageRefreshInFlight: false
    };
    this._state = state;
    const { startRenderer } = require_renderer();
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
      }
    }
    this._pageHandle?.unregister?.();
    document.querySelectorAll("[data-codexpp-account-switcher], [data-codexpp-account-switcher-confirm]").forEach((element) => {
      const cleanup = element.__codexppAccountSwitcherCleanup;
      if (typeof cleanup === "function") cleanup();
      else element.remove();
    });
  }
};
function startMain(api2) {
  const { createAccountService } = require_service();
  const service = createAccountService(api2);
  globalThis[GLOBAL_SERVICE_KEY] = service;
  if (!globalThis[IPC_HANDLER_KEY]) {
    const dispose = api2.ipc.handle(IPC_CHANNEL, async (message) => {
      const active = globalThis[GLOBAL_SERVICE_KEY];
      if (!active || typeof active.handle !== "function") {
        return { ok: false, error: "Account Switcher service is not active." };
      }
      return active.handle(message);
    });
    globalThis[IPC_HANDLER_KEY] = { disposers: typeof dispose === "function" ? [dispose] : [] };
  }
  api2.log.info("[account-switcher] main provider active");
}
function cleanupMain() {
  require_actions().resetAuthRelaunchState();
  delete globalThis[GLOBAL_SERVICE_KEY];
  const state = globalThis[IPC_HANDLER_KEY];
  if (!state || state === true) return;
  const disposers = Array.isArray(state.disposers) ? state.disposers : [];
  for (const dispose of disposers.splice(0).reverse()) {
    try {
      dispose();
    } catch {
    }
  }
  delete globalThis[IPC_HANDLER_KEY];
}
