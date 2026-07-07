const { IPC_CHANNEL } = require("./constants");

const DESTRUCTIVE_ACTIONS = new Set(["switch", "delete", "clear-active", "relaunch"]);

/**
 * Invokes an IPC action on the main-process account service.
 * Throws on failure so callers can use try/catch uniformly.
 *
 * @param {object} state  - Renderer state (holds api + lastState cache)
 * @param {string} action - IPC action name
 * @param {object} payload
 */
async function invoke(state, action, payload = {}) {
  const finalPayload = DESTRUCTIVE_ACTIONS.has(action)
    ? { ...payload, intent: await createIntent(state, action, payload), action }
    : { ...payload, action };
  const result = await state.api.ipc.invoke(IPC_CHANNEL, finalPayload);
  if (!result?.ok) throw new Error(result?.error || "Account switcher action failed.");
  state.lastState = result.state;
  return result.state;
}

async function createIntent(state, action, payload) {
  const result = await state.api.ipc.invoke(IPC_CHANNEL, {
    ...payload,
    action: "create-intent",
    intentAction: action,
  });
  if (!result?.ok || typeof result.state?.intent !== "string") {
    throw new Error(result?.error || "Account switcher confirmation failed.");
  }
  return result.state.intent;
}

module.exports = { invoke };
