"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDomWorkScheduler,
  createSignatureGate,
  mutationTouchesOwnedNodes,
} = require("../lib/dom-observer.cjs");

test("DOM observer scheduler coalesces pending work and can cancel it", () => {
  const calls = [];
  const timers = [];
  const timerHost = {
    setTimeout(fn, delay) {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
  };
  const scheduler = createDomWorkScheduler({ timerHost, delayMs: 120 });

  assert.equal(scheduler.schedule(() => calls.push("first")), true);
  assert.equal(scheduler.schedule(() => calls.push("second")), false);
  assert.equal(scheduler.pending(), true);
  assert.equal(timers[0].delay, 120);

  timers[0].fn();
  assert.deepEqual(calls, ["first"]);
  assert.equal(scheduler.pending(), false);

  assert.equal(scheduler.schedule(() => calls.push("third")), true);
  scheduler.cancel();
  assert.equal(timers[1].cleared, true);
  assert.equal(scheduler.pending(), false);
});

test("signature gate skips unchanged queued work and reopens after ttl", () => {
  const gate = createSignatureGate({ ttlMs: 1000 });

  assert.equal(gate.begin("a", 100), true);
  assert.equal(gate.shouldRun("b", 101), false);
  gate.end();
  assert.equal(gate.shouldRun("a", 500), false);
  assert.equal(gate.shouldRun("a", 1100), true);
  assert.equal(gate.begin("b", 1101), true);
  gate.end();
  assert.equal(gate.shouldRun("b", 1200), false);
  gate.reset();
  assert.equal(gate.shouldRun("b", 1201), true);
});

test("owned mutation helper accepts only mutations fully owned by the tweak", () => {
  const owned = { owned: true };
  const foreign = { owned: false };
  const isOwnedNode = (node) => Boolean(node && node.owned);

  assert.equal(mutationTouchesOwnedNodes([
    { target: owned, addedNodes: [owned], removedNodes: [] },
  ], isOwnedNode), true);

  assert.equal(mutationTouchesOwnedNodes([
    { target: owned, addedNodes: [foreign], removedNodes: [] },
  ], isOwnedNode), false);
});
