const { errorMessage } = require("./utils");
const { invoke } = require("./ipc");
const { t } = require("./i18n");
const {
  settingsButton,
  settingsSection,
  settingsCard,
  settingsRowShell,
  settingsInfoRow,
  settingsActionRow,
  settingsStatus,
  accountDisplayName,
  accountUsageSummary,
  bindButtonAction,
} = require("./ui-components");

// ─── Page lifecycle ───────────────────────────────────────────────────────────

async function renderAccountsPage(state, root) {
  root.textContent = "";
  root.appendChild(settingsStatus(t("accounts.loading")));
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

  // ── Current account info ─────────────────────────────────────────────────
  const intro = settingsSection(t("settings.activeSession"));
  const introCard = settingsCard();
  const currentName =
    accountState.current ||
    (accountState.hasActiveAuth ? t("settings.unsavedAccount") : t("settings.noActiveSession"));
  const currentValue = accountState.current
    ? accountDisplayName(accountState, accountState.current, { includeCurrent: false })
    : currentName;
  introCard.appendChild(
    settingsInfoRow(
      t("settings.signedInAs"),
      currentValue,
      accountState.hasActiveAuth
        ? t("settings.activeAuthDescription")
        : t("settings.noAuthDescription"),
    ),
  );
  intro.appendChild(introCard);
  root.appendChild(intro);

  // ── Actions ──────────────────────────────────────────────────────────────
  const actions = settingsSection(t("settings.accountSetup"));
  const actionCard = settingsCard();
  actionCard.appendChild(
    settingsActionRow(
      t("settings.signInAnother"),
      t("settings.signInAnotherDescription"),
      t("settings.startSignIn"),
      () => clearActiveFromSettings(state, root),
    ),
  );
  actionCard.appendChild(
    settingsActionRow(
      t("settings.refreshSaved"),
      t("settings.refreshSavedDescription"),
      t("settings.refresh"),
      () => renderAccountsPage(state, root),
    ),
  );
  actions.appendChild(actionCard);
  root.appendChild(actions);

  // ── Saved accounts list ──────────────────────────────────────────────────
  const saved = settingsSection(t("settings.savedAccounts"));
  const savedCard = settingsCard();
  const accounts = Array.isArray(accountState.accounts) ? accountState.accounts : [];
  if (!accounts.length) {
    savedCard.appendChild(
      settingsInfoRow(
        t("settings.noSavedAccounts"),
        t("settings.noneFound"),
        t("settings.noSavedAccountsDescription"),
      ),
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

// ─── Per-account row ──────────────────────────────────────────────────────────

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
  desc.textContent =
    accountUsageSummary(accountState, name) ||
    (accountState.current === name ? t("settings.activeInWindow") : t("settings.usageUnchecked"));
  left.appendChild(desc);
  row.appendChild(left);

  const actionsEl = document.createElement("div");
  actionsEl.className = "flex shrink-0 items-center gap-2";

  const switchButton = settingsButton(t("settings.switch"));
  switchButton.disabled = accountState.current === name;
  bindButtonAction(switchButton, () =>
    runSettingsAction(state, root, "switch", { name }, t("accounts.switching")),
  );
  actionsEl.appendChild(switchButton);

  const removeButton = settingsButton(t("settings.delete"));
  bindButtonAction(removeButton, () => {
    runSettingsAction(state, root, "delete", { name }, t("settings.removing"));
  });
  actionsEl.appendChild(removeButton);
  row.appendChild(actionsEl);
  return row;
}

// ─── User-initiated actions ───────────────────────────────────────────────────

function clearActiveFromSettings(state, root) {
  runSettingsAction(state, root, "clear-active", {}, t("accounts.preparingSignIn"));
}

function refreshUsageInBackground(state, root) {
  const now = Date.now();
  if (state.usageRefreshInFlight || now - (state.lastUsageRefreshAt || 0) < 60_000) return;
  state.usageRefreshInFlight = true;
  state.lastUsageRefreshAt = now;
  invoke(state, "refresh-usage")
    .then((accountState) => {
      if (root.isConnected) renderAccountsPageState(state, root, accountState);
    })
    .catch((error) => {
      state.api.log.warn("[account-switcher] usage refresh failed", errorMessage(error));
    })
    .finally(() => {
      state.usageRefreshInFlight = false;
    });
}

async function runSettingsAction(state, root, action, payload, loadingText) {
  root.textContent = "";
  root.appendChild(settingsStatus(loadingText));
  try {
    const accountState = await invoke(state, action, payload);
    if (action === "switch" || action === "clear-active") {
      root.textContent = "";
      root.appendChild(settingsStatus(authReloadMessage(action, accountState)));
      scheduleAppRelaunch(state, root);
      return;
    }
    renderAccountsPageState(state, root, accountState);
  } catch (error) {
    renderAccountsPageState(state, root, {
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

function scheduleAppRelaunch(state, root) {
  window.setTimeout(() => {
    invoke(state, "relaunch").catch((error) => {
      root.textContent = "";
      root.appendChild(settingsStatus(t("accounts.relaunchFailed", { error: errorMessage(error) }), true));
    });
  }, 1200);
}

module.exports = {
  renderAccountsPage,
  renderAccountsPageState,
};
