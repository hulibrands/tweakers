const { t } = require("./i18n");
const { accountDisplayName, addButtonFeedback } = require("./ui-components");

const CONFIRMATION_SELECTOR = "[data-codexpp-account-switcher-confirm]";
const CONFIRMATION_CLEANUP_KEY = "__codexppAccountSwitcherCleanup";

function confirmAccountAction(state, accountState, action, payload = {}) {
  const details = confirmationDetails(accountState, action, payload);
  if (!details) return Promise.resolve(true);

  const previousFocus = document.activeElement && typeof document.activeElement.focus === "function"
    ? document.activeElement
    : null;
  closeExistingConfirmation();

  return new Promise((resolve) => {
    const dialogId = `codexpp-account-switcher-confirm-${Date.now().toString(36)}`;
    const overlay = document.createElement("div");
    overlay.setAttribute("data-codexpp-account-switcher-confirm", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;" +
      "background:rgba(0,0,0,.18);color:var(--color-token-text-primary,currentColor);";

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", `${dialogId}-title`);
    dialog.setAttribute("aria-describedby", `${dialogId}-message`);
    dialog.tabIndex = -1;
    dialog.style.cssText =
      "width:min(360px,calc(100vw - 32px));border-radius:12px;border:1px solid var(--color-token-border,rgba(0,0,0,.12));" +
      "background:var(--color-background-panel,var(--color-token-bg-primary,#fff));box-shadow:0 18px 48px rgba(0,0,0,.22);" +
      "padding:18px;display:flex;flex-direction:column;gap:14px;font:inherit;";

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
    message.style.cssText =
      "font-size:14px;line-height:1.45;color:var(--color-token-text-secondary,currentColor);";
    dialog.appendChild(message);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

    const cancel = confirmButton(t("accounts.confirmCancel"), false);
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
    // Stop propagation in the BUBBLE phase (not capture). A capture-phase
    // listener on the dialog fires before the event descends to the Cancel/
    // Switch buttons, so stopPropagation() there kills the click before it
    // ever reaches them — leaving the buttons dead. Bubbling lets the buttons
    // handle the event first, then stops it from reaching outer handlers.
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
      title: t("accounts.confirmSwitchTitle"),
      message: t("accounts.confirmSwitchMessage", { email }),
      confirmLabel: t("accounts.confirmSwitch"),
    };
  }
  if (action === "delete") {
    const email = accountDisplayName(accountState, payload.name, { includeCurrent: false });
    return {
      title: t("accounts.confirmDeleteTitle"),
      message: t("accounts.confirmDeleteMessage", { email }),
      confirmLabel: t("accounts.confirmDelete"),
    };
  }
  if (action === "clear-active") {
    return {
      title: t("accounts.confirmClearTitle"),
      message: t("accounts.confirmClearMessage"),
      confirmLabel: t("accounts.confirmClear"),
    };
  }
  return null;
}

function confirmButton(label, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText =
    "height:32px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);" +
    "padding:0 12px;font:inherit;font-size:13px;cursor:pointer;" +
    (primary
      ? "background:var(--color-token-text-primary,currentColor);color:var(--color-token-bg-primary,#fff);"
      : "background:color-mix(in srgb,currentColor 5%,transparent);color:var(--color-token-text-primary,currentColor);");
  addButtonFeedback(button, {
    normal: { background: button.style.background },
    hover: {
      background: primary
        ? "color-mix(in srgb,var(--color-token-text-primary,currentColor) 88%,transparent)"
        : "color-mix(in srgb,currentColor 10%,transparent)",
    },
    active: {
      background: primary
        ? "color-mix(in srgb,var(--color-token-text-primary,currentColor) 78%,transparent)"
        : "color-mix(in srgb,currentColor 16%,transparent)",
      transform: "scale(0.98)",
    },
  });
  return button;
}

module.exports = { confirmAccountAction };
