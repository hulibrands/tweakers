"use strict";

/**
 * Regression guard for the "Switch account button does nothing" bug.
 *
 * The confirmation dialog used to register its stopPropagation() listeners in
 * the CAPTURE phase (`addEventListener("click", ..., true)`). A capture-phase
 * listener on an ancestor fires BEFORE the event descends to the target, so
 * stopPropagation() there killed the click before it ever reached the Cancel /
 * Switch buttons — leaving every button in the dialog dead.
 *
 * The shared FixtureElement harness in ui-popup.test.js cannot catch this: it
 * ignores the capture flag and dispatches only on the target with no
 * propagation. This file ships a minimal but phase-correct DOM (capture →
 * target → bubble, honouring stopPropagation and the capture flag) and drives
 * the REAL confirmAccountAction so the regression is exercised end-to-end.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// ─── Minimal phase-correct DOM ─────────────────────────────────────────────

class FakeEvent {
  constructor(type, { bubbles = true } = {}) {
    this.type = type;
    this.bubbles = bubbles;
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.defaultPrevented = false;
    this._stop = false;
    this._stopImmediate = false;
    this.key = undefined;
    this.shiftKey = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stop = true;
  }
  stopImmediatePropagation() {
    this._stop = true;
    this._stopImmediate = true;
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.style = {};
    this.listeners = [];
    this.tabIndex = 0;
    this._text = "";
    this.type = "";
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children) {
    for (const child of children) this.appendChild(child);
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  set textContent(value) {
    this._text = String(value == null ? "" : value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }

  focus() {
    DOCUMENT.activeElement = this;
  }

  matches(selector) {
    if (selector.startsWith("[") && selector.endsWith("]")) {
      return this.attributes.has(selector.slice(1, -1).split("=")[0]);
    }
    return this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (selector.split(",").some((part) => child.matches(part.trim()))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  addEventListener(type, handler, options) {
    const capture = options === true || (options && options.capture === true);
    this.listeners.push({ type, handler, capture });
  }
  removeEventListener(type, handler, options) {
    const capture = options === true || (options && options.capture === true);
    const index = this.listeners.findIndex(
      (l) => l.type === type && l.handler === handler && l.capture === capture,
    );
    if (index >= 0) this.listeners.splice(index, 1);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    const path = [];
    for (let node = this; node; node = node.parentElement) path.push(node);

    const fire = (node, phaseCaptureWanted) => {
      for (const l of node.listeners.slice()) {
        if (l.type !== event.type) continue;
        if (l.capture !== phaseCaptureWanted) continue;
        event.currentTarget = node;
        l.handler.call(node, event);
        if (event._stopImmediate) return;
      }
    };

    // Capture phase: root → target.parent (capture listeners only).
    event.eventPhase = 1;
    for (let i = path.length - 1; i >= 1; i--) {
      fire(path[i], true);
      if (event._stop) return !event.defaultPrevented;
    }
    // At target: both capture and bubble listeners, in registration order.
    event.eventPhase = 2;
    event.currentTarget = this;
    for (const l of this.listeners.slice()) {
      if (l.type !== event.type) continue;
      l.handler.call(this, event);
      if (event._stopImmediate) break;
    }
    if (event._stop) return !event.defaultPrevented;
    // Bubble phase: target.parent → root (bubble listeners only).
    if (event.bubbles) {
      event.eventPhase = 3;
      for (let i = 1; i < path.length; i++) {
        fire(path[i], false);
        if (event._stop) return !event.defaultPrevented;
      }
    }
    return !event.defaultPrevented;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document");
    this.body = new FakeElement("body");
    this.body.parentElement = this;
    this.children.push(this.body);
    this.activeElement = null;
  }
  createElement(tag) {
    return new FakeElement(tag);
  }
  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

const DOCUMENT = new FakeDocument();

function resetDocument() {
  DOCUMENT.body.children = [];
  DOCUMENT.body.listeners = [];
  DOCUMENT.listeners = [];
  DOCUMENT.activeElement = null;
}

function documentKeydownListeners() {
  return DOCUMENT.listeners.filter((listener) => listener.type === "keydown");
}

// ─── Load the real module against the fake DOM ─────────────────────────────

function loadConfirmation() {
  const previous = { document: global.document, window: global.window };
  global.document = DOCUMENT;
  global.window = { setTimeout, clearTimeout };
  try {
    const modulePath = path.join(__dirname, "..", "src", "ui-confirmation.js");
    delete require.cache[require.resolve(modulePath)];
    // Clear cached deps so they re-bind against the current globals if needed.
    for (const dep of ["./i18n", "./ui-components"]) {
      const resolved = Module._resolveFilename(dep, {
        id: modulePath,
        filename: modulePath,
        paths: Module._nodeModulePaths(path.dirname(modulePath)),
      });
      delete require.cache[resolved];
    }
    return require(modulePath);
  } finally {
    if (previous.document === undefined) delete global.document;
    else global.document = previous.document;
    if (previous.window === undefined) delete global.window;
    else global.window = previous.window;
  }
}

// ─── The regression ────────────────────────────────────────────────────────

test("clicking the confirm button resolves the dialog (no capture-phase swallow)", async () => {
  resetDocument();
  global.document = DOCUMENT;
  global.window = { setTimeout, clearTimeout };
  try {
    const { confirmAccountAction } = loadConfirmation();
    const accountState = {
      current: "admin@thereality.report",
      accounts: ["codex@thereality.report", "admin@thereality.report"],
    };

    const pending = confirmAccountAction({}, accountState, "switch", {
      name: "codex@thereality.report",
    });

    const overlay = DOCUMENT.querySelector("[data-codexpp-account-switcher-confirm]");
    assert.ok(overlay, "confirmation dialog should mount");

    const confirmButton = overlay
      .querySelectorAll("button")
      .find((button) => button.textContent === "Switch account");
    assert.ok(confirmButton, "Switch account button should render");

    // A real user click bubbles up from the button. If any ancestor swallows
    // it in the capture phase, the button's own handler never fires and this
    // promise never resolves.
    confirmButton.dispatchEvent(new FakeEvent("click", { bubbles: true }));

    const resolved = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("__never_resolved__"), 200)),
    ]);

    assert.equal(resolved, true, "confirm click must resolve confirmAccountAction(...) to true");
    assert.equal(
      DOCUMENT.querySelector("[data-codexpp-account-switcher-confirm]"),
      null,
      "dialog should close after confirming",
    );
  } finally {
    delete global.document;
    delete global.window;
  }
});

test("cancel button also resolves (dialog buttons are reachable)", async () => {
  resetDocument();
  global.document = DOCUMENT;
  global.window = { setTimeout, clearTimeout };
  try {
    const { confirmAccountAction } = loadConfirmation();
    const accountState = { current: "a@x", accounts: ["b@x", "a@x"] };
    const pending = confirmAccountAction({}, accountState, "switch", { name: "b@x" });
    const overlay = DOCUMENT.querySelector("[data-codexpp-account-switcher-confirm]");
    const cancelButton = overlay
      .querySelectorAll("button")
      .find((button) => button.textContent === "Cancel");
    assert.ok(cancelButton, "Cancel button should render");
    cancelButton.dispatchEvent(new FakeEvent("click", { bubbles: true }));
    const resolved = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("__never_resolved__"), 200)),
    ]);
    assert.equal(resolved, false, "cancel click must resolve to false");
  } finally {
    delete global.document;
    delete global.window;
  }
});

test("state disposer cancels a pending confirmation and removes its key listener", async () => {
  resetDocument();
  global.document = DOCUMENT;
  global.window = { setTimeout, clearTimeout };
  try {
    const { confirmAccountAction } = loadConfirmation();
    const accountState = { current: "a@x", accounts: ["b@x", "a@x"] };
    const state = { disposers: [] };

    const pending = confirmAccountAction(state, accountState, "switch", { name: "b@x" });

    assert.equal(state.disposers.length, 1, "dialog should register a tweak cleanup disposer");
    assert.equal(documentKeydownListeners().length, 1, "dialog should register one document key listener");

    state.disposers[0]();
    const resolved = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("__never_resolved__"), 200)),
    ]);

    assert.equal(resolved, false, "cleanup should cancel the pending confirmation");
    assert.equal(state.disposers.length, 0, "cleanup should unregister itself from tweak disposers");
    assert.equal(documentKeydownListeners().length, 0, "cleanup should remove the document key listener");
    assert.equal(
      DOCUMENT.querySelector("[data-codexpp-account-switcher-confirm]"),
      null,
      "cleanup should remove the dialog",
    );
  } finally {
    delete global.document;
    delete global.window;
  }
});
