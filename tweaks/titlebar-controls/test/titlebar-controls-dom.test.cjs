"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MODULE_PATH = path.resolve(__dirname, "..", "index.js");
const SAFE_HEADER_LEFT_PROPERTY = "--spacing-token-safe-header-left";
const SAFE_HEADER_RIGHT_PROPERTY = "--spacing-token-safe-header-right";
const STYLE_ID = "codexpp-titlebar-controls-style";
const TITLEBAR_ATTRIBUTE = "data-codexpp-titlebar-controls";
const SPACING_ATTRIBUTE = "data-codexpp-titlebar-spacing";

test("Titlebar Controls applies and restores native safe-area values", () => {
  withTitlebarFixture("MacIntel", ({ api, document, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "30px");

    tweak.start(api);

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "118px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "important");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "66px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_RIGHT_PROPERTY), "important");
    assert.equal(shell.getAttribute(TITLEBAR_ATTRIBUTE), "active");
    assert.equal(shell.getAttribute(SPACING_ATTRIBUTE), "applied");
    assert.ok(document.getElementById(STYLE_ID));

    tweak.stop();

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "80px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "30px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_RIGHT_PROPERTY), "");
    assert.equal(shell.hasAttribute(TITLEBAR_ATTRIBUTE), false);
    assert.equal(shell.hasAttribute(SPACING_ATTRIBUTE), false);
    assert.equal(document.getElementById(STYLE_ID), null);
  });
});

test("Titlebar Controls does not synthesize right spacing when no right variable is exposed", () => {
  withTitlebarFixture("MacIntel", ({ api, document, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "");

    tweak.start(api);

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "118px");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_RIGHT_PROPERTY), "");

    tweak.stop();
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "80px");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "");
  });
});

test("Titlebar Controls remains inert on non-macOS platforms", () => {
  withTitlebarFixture("Win32", ({ api, document, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "30px");

    tweak.start(api);

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "80px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "30px");
    assert.equal(shell.hasAttribute(TITLEBAR_ATTRIBUTE), false);
    assert.equal(document.getElementById(STYLE_ID), null);
    assert.deepEqual(api.log.messages, ["Titlebar Controls skipped on non-macOS platform"]);
  });
});

test("Titlebar Controls restores immediately when native layout stops qualifying", () => {
  withTitlebarFixture("MacIntel", ({ api, document, observers, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "30px");

    tweak.start(api);
    shell.style.setProperty(SAFE_HEADER_LEFT_PROPERTY, "10px");
    observers[0].trigger();

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "10px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "30px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_RIGHT_PROPERTY), "");
    assert.equal(shell.hasAttribute(TITLEBAR_ATTRIBUTE), false);
    assert.equal(shell.hasAttribute(SPACING_ATTRIBUTE), false);
  });
});

test("Titlebar Controls restores to native layout changes observed after application", () => {
  withTitlebarFixture("MacIntel", ({ api, document, observers, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "30px");

    tweak.start(api);
    shell.style.setProperty(SAFE_HEADER_LEFT_PROPERTY, "90px");
    observers[0].trigger();

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "118px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "important");

    tweak.stop();

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "90px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "30px");
  });
});

test("Titlebar Controls restores disconnected tracked spacing before cleanup", () => {
  withTitlebarFixture("MacIntel", ({ api, document, observers, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "30px");

    tweak.start(api);
    assert.equal(tweak._state.spacing.has(shell), true);

    shell.remove();
    observers[0].trigger();

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "80px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "30px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_RIGHT_PROPERTY), "");
    assert.equal(shell.hasAttribute(TITLEBAR_ATTRIBUTE), false);
    assert.equal(shell.hasAttribute(SPACING_ATTRIBUTE), false);
    assert.equal(tweak._state.spacing.has(shell), false);
  });
});

test("Titlebar Controls stop restores disconnected tracked spacing", () => {
  withTitlebarFixture("MacIntel", ({ api, document, tweak }) => {
    const shell = createTitlebarShell(document, "80px", "30px");

    tweak.start(api);
    shell.remove();
    tweak.stop();

    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_LEFT_PROPERTY), "80px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_LEFT_PROPERTY), "");
    assert.equal(shell.style.getPropertyValue(SAFE_HEADER_RIGHT_PROPERTY), "30px");
    assert.equal(shell.style.getPropertyPriority(SAFE_HEADER_RIGHT_PROPERTY), "");
    assert.equal(shell.hasAttribute(TITLEBAR_ATTRIBUTE), false);
    assert.equal(shell.hasAttribute(SPACING_ATTRIBUTE), false);
  });
});

function createTitlebarShell(document, left, right) {
  const shell = document.createElement("div");
  shell.style.setProperty(SAFE_HEADER_LEFT_PROPERTY, left);
  if (right) {
    shell.style.setProperty(SAFE_HEADER_RIGHT_PROPERTY, right);
  }
  const sidebarButton = document.createElement("button");
  sidebarButton.style.setProperty("--sidebar-trigger", "1");
  shell.appendChild(sidebarButton);
  document.body.appendChild(shell);
  return shell;
}

function withTitlebarFixture(platform, run) {
  const document = new FakeDocument();
  const observers = [];
  const window = new FakeWindow();
  class FixtureMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
    trigger() {
      this.callback([], this);
    }
  }
  const api = {
    log: {
      messages: [],
      info(message) {
        this.messages.push(message);
      },
    },
  };

  const sandbox = {
    console,
    document,
    HTMLElement: FakeElement,
    module: { exports: {} },
    exports: {},
    MutationObserver: FixtureMutationObserver,
    navigator: { platform, userAgent: platform === "MacIntel" ? "Macintosh" : "Windows" },
    window,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(MODULE_PATH, "utf8"), sandbox, { filename: MODULE_PATH });
  const tweak = sandbox.module.exports;
  try {
    run({ api, document, observers, tweak, window });
  } finally {
    try {
      tweak.stop();
    } catch {
      // The test body may already have stopped the tweak.
    }
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }
  setTimeout(callback) {
    callback();
    return 1;
  }
  clearTimeout() {}
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.documentElement.ownerDocument = this;
    this.head.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.isConnected = true;
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }
  getElementById(id) {
    return this.querySelectorAll(`[id="${id}"]`)[0] || null;
  }
  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.style = new FakeStyle();
    this.textContent = "";
    this.isConnected = false;
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  set id(value) {
    this.setAttribute("id", value);
  }
  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    child.setConnected(this.isConnected);
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) {
      siblings.splice(index, 1);
    }
    this.parentNode = null;
    this.setConnected(false);
  }
  setConnected(isConnected) {
    this.isConnected = isConnected;
    for (const child of this.children) {
      child.setConnected(isConnected);
    }
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(String(name));
  }
  removeAttribute(name) {
    this.attributes.delete(String(name));
  }
  matches(selector) {
    return selector.split(",").some((part) => this.matchesSingle(part.trim()));
  }
  matchesSingle(selector) {
    const styleContains = selector.match(/^\[style\*="([^"]+)"\]$/);
    if (styleContains) {
      return this.style.toString().includes(styleContains[1]);
    }
    const attrEquals = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
    if (attrEquals) {
      return this.getAttribute(attrEquals[1]) === attrEquals[2];
    }
    const attrPresent = selector.match(/^\[([^=\]]+)\]$/);
    if (attrPresent) {
      return this.hasAttribute(attrPresent[1]);
    }
    return false;
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

class FakeStyle {
  constructor() {
    this.properties = new Map();
  }
  setProperty(name, value, priority = "") {
    if (!name) return;
    this.properties.set(String(name), {
      value: String(value),
      priority: String(priority || ""),
    });
  }
  getPropertyValue(name) {
    return this.properties.get(String(name))?.value || "";
  }
  getPropertyPriority(name) {
    return this.properties.get(String(name))?.priority || "";
  }
  removeProperty(name) {
    const previous = this.getPropertyValue(name);
    this.properties.delete(String(name));
    return previous;
  }
  toString() {
    return Array.from(this.properties)
      .map(([name, entry]) => `${name}: ${entry.value}${entry.priority ? ` !${entry.priority}` : ""};`)
      .join(" ");
  }
}
