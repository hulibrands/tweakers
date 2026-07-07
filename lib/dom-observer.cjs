"use strict";

function createDomWorkScheduler(options = {}) {
  const timerHost = options.timerHost || globalThis;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 120;
  let timer = null;

  const cancel = () => {
    if (!timer) return;
    if (typeof timerHost.clearTimeout === "function") timerHost.clearTimeout(timer);
    timer = null;
  };

  const schedule = (run) => {
    if (timer) return false;
    if (typeof run !== "function") throw new TypeError("run must be a function");
    if (typeof timerHost.setTimeout !== "function") {
      run();
      return true;
    }
    timer = timerHost.setTimeout(() => {
      timer = null;
      run();
    }, delayMs);
    return true;
  };

  return {
    schedule,
    cancel,
    pending: () => Boolean(timer),
  };
}

function createSignatureGate(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 10_000;
  let lastSignature = "";
  let lastRunAt = 0;
  let queued = false;

  const shouldRun = (signature, now = Date.now()) => {
    if (queued) return false;
    if (signature !== lastSignature) return true;
    return now - lastRunAt >= ttlMs;
  };

  return {
    shouldRun,
    begin(signature, now = Date.now()) {
      if (!shouldRun(signature, now)) return false;
      lastSignature = signature;
      lastRunAt = now;
      queued = true;
      return true;
    },
    end() {
      queued = false;
    },
    reset() {
      lastSignature = "";
      lastRunAt = 0;
      queued = false;
    },
  };
}

function mutationTouchesOwnedNodes(mutations, isOwnedNode) {
  if (!Array.isArray(mutations) || typeof isOwnedNode !== "function") return false;
  return mutations.every((mutation) => {
    const added = Array.from(mutation.addedNodes || []);
    const removed = Array.from(mutation.removedNodes || []);
    return [mutation.target, ...added, ...removed].every((node) => isOwnedNode(node));
  });
}

module.exports = {
  createDomWorkScheduler,
  createSignatureGate,
  mutationTouchesOwnedNodes,
};
