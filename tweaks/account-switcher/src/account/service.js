const { ok, fail, errorMessage, stringifyError } = require("../utils");
const {
  clearActiveAuth,
  deleteAccount,
  refreshActiveUsage,
  relaunchCodex,
  saveCurrentAccount,
  switchAccount,
} = require("./actions");
const { readState } = require("./state");
const { randomBytes } = require("node:crypto");

const INTENT_TTL_MS = 30_000;
const DESTRUCTIVE_ACTIONS = new Set(["switch", "delete", "clear-active", "relaunch"]);

function createAccountService(api) {
  const intents = new Map();
  return {
    async handle(message) {
      const action = message?.action;
      try {
        api.log?.info?.(`[account-switcher] action ${String(action)}`);
        if (action === "create-intent") {
          return ok({ intent: createIntent(intents, message) });
        }
        if (action === "state") return ok(await readState());
        if (action === "save") return ok(await saveCurrentAccount(message?.name));
        if (DESTRUCTIVE_ACTIONS.has(action) && !consumeIntent(intents, message)) {
          return fail("Account action requires a fresh confirmation intent.");
        }
        if (action === "switch") return ok(await switchAccount(message?.name, api));
        if (action === "delete") return ok(await deleteAccount(message?.name));
        if (action === "clear-active") return ok(await clearActiveAuth(api));
        if (action === "refresh-usage") return ok(await refreshActiveUsage(api));
        if (action === "relaunch") return ok(await relaunchCodex(api));
        return fail(`Unknown account action: ${String(action)}`);
      } catch (error) {
        api.log?.warn?.("[account-switcher] action failed", stringifyError(error));
        return fail(errorMessage(error));
      }
    },
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
    expiresAt: Date.now() + INTENT_TTL_MS,
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

module.exports = { createAccountService };
