const { errorMessage } = require("./utils");
const { invoke } = require("./ipc");
const { t } = require("./i18n");
const { protectInteractiveControl } = require("./dom-utils");
const { renderAccountsPageState } = require("./ui-settings");
const {
  accountPanelShell,
  setPanelStatus,
  PANEL_ROW_LEFT_INSET,
  accountDisplayName,
  accountUsageSummary,
  addButtonFeedback,
  bindButtonAction,
} = require("./ui-components");

const ACCOUNTS_PANEL_TRANSITION_MS = 160;
const ACCOUNTS_PANEL_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const MENU_ROW_ICON_SIZE = 20;
const MENU_ROW_CHEVRON_SIZE = 16;

// ─── Panel render ─────────────────────────────────────────────────────────────

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
  list.style.cssText = `display:flex;flex-direction:column;min-width:0;margin-left:${PANEL_ROW_LEFT_INSET + 8}px;padding:2px 0 6px;`;

  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = accountState.hasActiveAuth
      ? t("accounts.emptySaved")
      : t("accounts.emptyActive");
    empty.style.cssText =
      "font-size:12px;color:var(--color-token-text-secondary,currentColor);padding:2px 0 4px;";
    list.appendChild(empty);
  }

  for (const name of accounts) {
    list.appendChild(accountRow(state, panel, accountState, name));
  }

  list.appendChild(configureAccountsRow(state, panel));
  const body = document.createElement("div");
  body.setAttribute("data-codexpp-account-switcher-body", "accounts");
  body.style.cssText = "overflow:hidden;opacity:1;";
  const bodyInner = document.createElement("div");
  bodyInner.style.cssText = "min-height:0;";
  bodyInner.appendChild(list);
  body.appendChild(bodyInner);
  section.appendChild(body);
  panel.appendChild(section);

  // Notice / error
  if (accountState.notice || accountState.error) {
    const note = document.createElement("div");
    note.textContent = accountState.notice || accountState.error;
    note.style.cssText =
      `padding:0 24px 6px ${PANEL_ROW_LEFT_INSET}px;font-size:11px;line-height:1.3;color:` +
      (accountState.error
        ? "var(--color-token-text-error,#ff6b6b)"
        : "var(--color-token-text-secondary,currentColor)") +
      ";";
    panel.appendChild(note);
  }
}

function accountsHeaderRow(state, panel, accountState, expanded) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.style.cssText =
    "width:100%;border:0;background:transparent;color:var(--color-token-text-tertiary,currentColor);" +
    "font:inherit;font-size:13px;line-height:1.25;text-align:left;border-radius:6px;" +
    "min-height:38px;padding:0 12px;cursor:pointer;display:grid;" +
    `grid-template-columns:${MENU_ROW_ICON_SIZE}px minmax(0,1fr) ${MENU_ROW_CHEVRON_SIZE}px;` +
    "column-gap:8px;align-items:center;";

  button.appendChild(cloneAccountIcon(panel, accountState));

  const title = document.createElement("span");
  title.textContent = t("accounts.title");
  title.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-token-text-primary,currentColor);";
  button.appendChild(title);

  const chevronSlot = document.createElement("span");
  chevronSlot.style.cssText =
    `display:flex;align-items:center;justify-content:center;width:${MENU_ROW_CHEVRON_SIZE}px;` +
    `height:${MENU_ROW_CHEVRON_SIZE}px;color:var(--color-token-text-tertiary,currentColor);`;
  chevronSlot.appendChild(cloneRateLimitsChevron(panel, expanded));
  button.appendChild(chevronSlot);

  addButtonFeedback(button, {
    normal: { background: "transparent" },
    hover: { background: "color-mix(in srgb,currentColor 8%,transparent)" },
    active: {
      background: "color-mix(in srgb,currentColor 12%,transparent)",
      transform: "scale(0.99)",
    },
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
  slot.style.cssText =
    `display:flex;align-items:center;justify-content:center;height:${MENU_ROW_ICON_SIZE}px;` +
    `width:${MENU_ROW_ICON_SIZE}px;` +
    "color:var(--color-token-text-tertiary,currentColor);";

  if (icon) {
    const clone = icon.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    clone.style.width = `${MENU_ROW_ICON_SIZE}px`;
    clone.style.height = `${MENU_ROW_ICON_SIZE}px`;
    slot.appendChild(clone);
    return slot;
  }

  slot.textContent = "◎";
  slot.style.fontSize = "13px";
  return slot;
}

function findAccountMenuIcon(panel, accountState) {
  const menu =
    panel.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') ||
    document;
  const current = accountState.current
    ? accountDisplayName(accountState, accountState.current, { includeCurrent: false })
    : "";
  const candidates = Array.from(menu.querySelectorAll('button, a, [role="menuitem"], div'));
  const accountRow = candidates.find((element) => {
    if (!(element instanceof HTMLElement)) return false;
    const text = element.textContent || "";
    return (current && text.includes(current)) || /@/.test(text);
  });
  if (!(accountRow instanceof HTMLElement)) return null;
  return accountRow.querySelector("svg");
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
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M6 3.75 10 8l-4 4.25");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  fallback.appendChild(path);
  return fallback;
}

function findRateLimitsChevron(panel) {
  const menu =
    panel.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') ||
    document;
  const rateLimits = Array.from(menu.querySelectorAll('button, a, [role="menuitem"]')).find((element) => {
    return element instanceof HTMLElement && /\b(?:usage remaining|rate limits)\b/i.test(element.textContent || "");
  });
  if (!(rateLimits instanceof HTMLElement)) return null;
  const icons = Array.from(rateLimits.querySelectorAll("svg"));
  return icons.length ? icons[icons.length - 1] : null;
}

// ─── Per-account row ──────────────────────────────────────────────────────────

function accountRow(state, panel, accountState, name) {
  const row = document.createElement("button");
  row.type = "button";
  row.title = accountDisplayName(accountState, name, { includeCurrent: false });
  const normalBackground =
    accountState.current === name
      ? "var(--color-token-list-hover-background, var(--color-token-bg-tertiary, color-mix(in srgb,currentColor 8%,transparent)))"
      : "transparent";
  row.style.cssText =
    "width:100%;border:0;text-align:left;font:inherit;display:flex;flex-direction:column;gap:2px;" +
    `border-radius:8px;margin-left:-8px;margin-right:-8px;padding:4px 8px;background:${normalBackground};` +
    "color:var(--color-token-text-primary,currentColor);cursor:pointer;";
  const nameText = document.createElement("span");
  nameText.textContent = accountDisplayName(accountState, name);
  nameText.style.cssText =
    "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;";
  row.appendChild(nameText);
  const usage = accountUsageSummary(accountState, name);
  if (usage) {
    const usageText = document.createElement("span");
    usageText.textContent = usage;
    usageText.style.cssText =
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
      "color:var(--color-token-text-secondary,currentColor);font-size:11px;";
    row.appendChild(usageText);
  }
  addButtonFeedback(row, {
    normal: { background: normalBackground },
    hover: {
      background: accountState.current === name
        ? "var(--color-token-list-hover-background, var(--color-token-bg-tertiary, color-mix(in srgb,currentColor 10%,transparent)))"
        : "var(--color-token-list-hover-background, color-mix(in srgb,currentColor 8%,transparent))",
    },
    active: {
      background: accountState.current === name
        ? "var(--color-token-list-active-selection-background, var(--color-token-list-hover-background, color-mix(in srgb,currentColor 12%,transparent)))"
        : "var(--color-token-list-hover-background, color-mix(in srgb,currentColor 12%,transparent))",
      transform: "scale(0.99)",
    },
  });
  protectInteractiveControl(row);
  bindButtonAction(row, async () => {
    if (accountState.current === name) return;
    const confirmed = await confirmSwitchAccount(state, accountState, name);
    if (!confirmed) return;
    void runPanelAction(state, panel, "switch", { name }, t("accounts.switching"));
  });
  return row;
}

function confirmSwitchAccount(state, accountState, name) {
  const email = accountDisplayName(accountState, name, { includeCurrent: false });
  document.querySelector("[data-codexpp-account-switcher-confirm]")?.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-codexpp-account-switcher-confirm", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;" +
      "background:rgba(0,0,0,.18);color:var(--color-token-text-primary,currentColor);";

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.style.cssText =
      "width:min(360px,calc(100vw - 32px));border-radius:12px;border:1px solid var(--color-token-border,rgba(0,0,0,.12));" +
      "background:var(--color-background-panel,var(--color-token-bg-primary,#fff));box-shadow:0 18px 48px rgba(0,0,0,.22);" +
      "padding:18px;display:flex;flex-direction:column;gap:14px;font:inherit;";

    const title = document.createElement("div");
    title.textContent = t("accounts.confirmTitle");
    title.style.cssText = "font-size:17px;font-weight:600;line-height:1.3;";
    dialog.appendChild(title);

    const message = document.createElement("div");
    message.textContent = t("accounts.confirmMessage", { email });
    message.style.cssText =
      "font-size:14px;line-height:1.45;color:var(--color-token-text-secondary,currentColor);";
    dialog.appendChild(message);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

    const cancel = confirmButton(t("accounts.confirmCancel"), false);
    const confirm = confirmButton(t("accounts.confirmSwitch"), true);
    actions.append(cancel, confirm);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };

    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) finish(false);
    });
    dialog.addEventListener("pointerdown", (event) => event.stopPropagation(), true);
    dialog.addEventListener("click", (event) => event.stopPropagation(), true);
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeyDown, true);
    document.body.appendChild(overlay);
    cancel.focus();
  });
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

function configureAccountsRow(state, panel) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("accounts.configure");
  button.style.cssText =
    "width:100%;border:0;background:transparent;color:var(--color-token-text-secondary,currentColor);" +
    "font:inherit;font-size:13px;text-align:left;border-radius:8px;margin-left:-8px;margin-right:-8px;" +
    "padding:5px 8px;cursor:pointer;";
  addButtonFeedback(button, {
    normal: { background: "transparent" },
    hover: { background: "color-mix(in srgb,currentColor 8%,transparent)" },
    active: {
      background: "color-mix(in srgb,currentColor 12%,transparent)",
      transform: "scale(0.99)",
    },
  });
  protectInteractiveControl(button);
  bindButtonAction(button, () => openAccountsSettings(state, panel));
  return button;
}

function openAccountsSettings(state, panel) {
  const menu =
    panel.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') ||
    document;
  const settingsItem = findMenuCommand(menu, /settings/i);
  settingsItem?.click();
  window.setTimeout(() => {
    const accountsNav = Array.from(
      document.querySelectorAll('button[data-codexpp^="nav-page-"], button'),
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

// ─── User-initiated actions ───────────────────────────────────────────────────

function clearActiveForNewLogin(state, panel) {
  runPanelAction(state, panel, "clear-active", {}, t("accounts.preparingSignIn"));
}

async function runPanelAction(state, panel, action, payload, loadingText) {
  setPanelStatus(panel, loadingText);
  try {
    const accountState = await invoke(state, action, payload);
    if (action === "switch" || action === "clear-active") {
      setPanelStatus(panel, authReloadMessage(action, accountState));
      scheduleAppRelaunch(state, panel);
      return;
    }
    renderAccountPanel(state, panel, accountState);
    if (state.settingsRoot?.isConnected) {
      renderAccountsPageState(state, state.settingsRoot, accountState);
    }
  } catch (error) {
    renderAccountPanel(state, panel, {
      ...(state.lastState || { accounts: [], current: null, hasActiveAuth: false }),
      error: errorMessage(error),
    });
  }
}

function authReloadMessage(action, accountState) {
  if (action === "clear-active") {
    return t("accounts.sessionClearedRelaunching");
  }
  const email = accountState.current
    ? accountDisplayName(accountState, accountState.current, { includeCurrent: false })
    : t("accounts.selected");
  return t("accounts.switchedRelaunching", { email });
}

function scheduleAppRelaunch(state, panel) {
  window.setTimeout(() => {
    invoke(state, "relaunch").catch((error) => {
      setPanelStatus(panel, t("accounts.relaunchFailed", { error: errorMessage(error) }));
    });
  }, 1200);
}

async function refreshPanel(state, panel) {
  setPanelStatus(panel, t("accounts.loading"));
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
  if (state.usageRefreshInFlight || now - (state.lastUsageRefreshAt || 0) < 60_000) return;
  state.usageRefreshInFlight = true;
  state.lastUsageRefreshAt = now;
  invoke(state, "refresh-usage")
    .then((accountState) => {
      if (panel.isConnected) renderAccountPanel(state, panel, accountState);
      if (state.settingsRoot?.isConnected) {
        renderAccountsPageState(state, state.settingsRoot, accountState);
      }
    })
    .catch((error) => {
      state.api.log.warn("[account-switcher] usage refresh failed", errorMessage(error));
    })
    .finally(() => {
      state.usageRefreshInFlight = false;
  });
}

module.exports = { renderAccountPanel, accountPanelShell, refreshPanel };
