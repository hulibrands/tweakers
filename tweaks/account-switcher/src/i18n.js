const STRINGS = {
  "accounts.title": "Accounts",
  "accounts.configure": "Configure accounts",
  "accounts.emptySaved": "No saved accounts yet.",
  "accounts.emptyActive": "No active session. Relaunch and sign in.",
  "accounts.loading": "Loading saved accounts...",
  "accounts.switching": "Switching account...",
  "accounts.confirmTitle": "Switch account?",
  "accounts.confirmMessage": "Codex will switch to {email} and relaunch.",
  "accounts.confirmCancel": "Cancel",
  "accounts.confirmSwitch": "Switch account",
  "accounts.preparingSignIn": "Preparing sign-in...",
  "accounts.selected": "selected account",
  "accounts.switchedRelaunching": "Switched to {email}. Relaunching Codex...",
  "accounts.sessionClearedRelaunching": "Session cleared. Relaunching Codex for sign-in...",
  "accounts.relaunchFailed": "Relaunch failed: {error}",
  "settings.activeSession": "Active session",
  "settings.signedInAs": "Signed in as",
  "settings.unsavedAccount": "Unsaved account",
  "settings.noActiveSession": "No active session",
  "settings.activeAuthDescription": "Codex is using the session stored in ~/.codex/auth.json.",
  "settings.noAuthDescription": "No active auth file exists at ~/.codex/auth.json.",
  "settings.accountSetup": "Account setup",
  "settings.signInAnother": "Sign in to another account",
  "settings.signInAnotherDescription": "Back up the current session, clear auth, and relaunch Codex for sign-in.",
  "settings.startSignIn": "Start sign-in",
  "settings.refreshSaved": "Refresh saved accounts",
  "settings.refreshSavedDescription": "Rescan saved sessions in ~/.codex/auth_accounts.",
  "settings.refresh": "Refresh",
  "settings.savedAccounts": "Saved accounts",
  "settings.noSavedAccounts": "No saved accounts yet",
  "settings.noneFound": "None found",
  "settings.noSavedAccountsDescription": "Use Sign in to another account to create one.",
  "settings.activeInWindow": "Active in this Codex window.",
  "settings.usageUnchecked": "Usage not checked yet.",
  "settings.switch": "Switch",
  "settings.delete": "Delete",
  "settings.removing": "Removing account...",
  "service.saved": "Saved current account as {name}.",
  "service.switched": "Switched to {name}. Relaunching Codex.",
  "service.removed": "Removed saved account {name}.",
  "service.sessionCleared": "Session cleared. Relaunching Codex for sign-in.",
  "service.relaunching": "Relaunching Codex...",
};

function t(key, params = {}) {
  const template = STRINGS[key] || key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
  });
}

module.exports = { t };
