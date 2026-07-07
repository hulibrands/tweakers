const assert = require("node:assert/strict");
const test = require("node:test");

function freshActions() {
  delete require.cache[require.resolve("../src/account/actions")];
  return require("../src/account/actions");
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function scheduler() {
  const timers = [];
  return {
    timers,
    setTimeout(fn, delay) {
      timers.push({ fn, delay });
      return timers.length;
    },
  };
}

test("scheduled auth relaunch clears state after failure and allows retry", async () => {
  const actions = freshActions();
  const api = { log: { info() {}, warn() {} } };
  const scheduled = scheduler();
  let relaunches = 0;

  actions.__test.scheduleAuthRelaunch(api, "first", {
    setTimeout: scheduled.setTimeout,
    relaunchCodex: async () => {
      relaunches += 1;
      throw new Error("failed relaunch");
    },
  });
  actions.__test.scheduleAuthRelaunch(api, "duplicate", { setTimeout: scheduled.setTimeout });

  assert.equal(scheduled.timers.length, 1);
  assert.equal(scheduled.timers[0].delay, 250);
  assert.equal(actions.__test.getAuthRelaunchScheduled(), true);

  scheduled.timers.shift().fn();
  await flushPromises();

  assert.equal(relaunches, 1);
  assert.equal(actions.__test.getAuthRelaunchScheduled(), false);

  actions.__test.scheduleAuthRelaunch(api, "retry", {
    setTimeout: scheduled.setTimeout,
    relaunchCodex: async () => {
      relaunches += 1;
    },
  });
  scheduled.timers.shift().fn();
  await flushPromises();

  assert.equal(relaunches, 2);
  assert.equal(actions.__test.getAuthRelaunchScheduled(), false);
});

test("main cleanup resets pending auth relaunch state", () => {
  const actions = freshActions();
  delete require.cache[require.resolve("../index")];
  const tweak = require("../index");
  const api = { log: { info() {}, warn() {} } };
  const scheduled = scheduler();

  actions.__test.scheduleAuthRelaunch(api, "pending", { setTimeout: scheduled.setTimeout });
  assert.equal(actions.__test.getAuthRelaunchScheduled(), true);

  tweak.stop();

  assert.equal(actions.__test.getAuthRelaunchScheduled(), false);
  actions.__test.scheduleAuthRelaunch(api, "after-cleanup", { setTimeout: scheduled.setTimeout });
  assert.equal(scheduled.timers.length, 2);
});
