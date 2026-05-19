const assert = require("node:assert/strict");
const test = require("node:test");

function installDomFixture() {
  const previous = {
    document: global.document,
    HTMLElement: global.HTMLElement,
    SVGElement: global.SVGElement,
    MutationObserver: global.MutationObserver,
    window: global.window,
  };

  class FixtureEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.key = options.key;
      this.target = options.target || null;
      this.defaultPrevented = false;
      this.propagationStopped = false;
    }

    preventDefault() {
      this.defaultPrevented = true;
    }

    stopPropagation() {
      this.propagationStopped = true;
    }
  }

  class FixtureElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.ownerDocument = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.disabled = false;
      this._textContent = "";
    }

    append(...children) {
      for (const child of children) this.appendChild(child);
    }

    appendChild(child) {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
      return child;
    }

    before(sibling) {
      if (!this.parentElement) return;
      sibling.parentElement = this.parentElement;
      sibling.ownerDocument = this.ownerDocument;
      const index = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(index < 0 ? 0 : index, 0, sibling);
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

    matches(selector) {
      return matchesSelector(this, selector);
    }

    closest(selector) {
      let node = this;
      while (node) {
        if (node.matches(selector)) return node;
        node = node.parentElement;
      }
      return null;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const selectors = splitSelectors(selector);
      const results = [];
      walk(this, (element) => {
        if (element !== this && selectors.some((part) => matchesSelector(element, part))) {
          results.push(element);
        }
      });
      return results;
    }

    addEventListener(type, handler) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(handler);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, handler) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter((listener) => listener !== handler));
    }

    dispatchEvent(event) {
      event.target ||= this;
      for (const handler of this.listeners.get(event.type) || []) {
        handler(event);
      }
      return !event.defaultPrevented;
    }

    click() {
      this.dispatchEvent(new FixtureEvent("click", { target: this }));
    }

    focus() {
      this.ownerDocument.activeElement = this;
    }

    cloneNode(deep = false) {
      const clone = new this.constructor(this.tagName.toLowerCase());
      clone.ownerDocument = this.ownerDocument;
      clone._textContent = this._textContent;
      clone.disabled = this.disabled;
      clone.style = { ...this.style };
      for (const [key, value] of this.attributes) clone.attributes.set(key, value);
      if (deep) {
        for (const child of this.children) clone.appendChild(child.cloneNode(true));
      }
      return clone;
    }

    get textContent() {
      return this._textContent + this.children.map((child) => child.textContent).join("");
    }

    set textContent(value) {
      this._textContent = String(value || "");
      this.children = [];
    }

    get isConnected() {
      let node = this;
      while (node) {
        if (node === this.ownerDocument?.documentElement) return true;
        node = node.parentElement;
      }
      return false;
    }

    getBoundingClientRect() {
      return { width: 320, height: 40 };
    }
  }

  class FixtureSvgElement extends FixtureElement {}

  class FixtureDocument extends FixtureElement {
    constructor() {
      super("#document");
      this.ownerDocument = this;
      this.documentElement = new FixtureElement("html");
      this.documentElement.ownerDocument = this;
      this.body = new FixtureElement("body");
      this.body.ownerDocument = this;
      this.documentElement.appendChild(this.body);
      this.activeElement = null;
      this.listeners = new Map();
    }

    createElement(tagName) {
      const element = new FixtureElement(tagName);
      element.ownerDocument = this;
      return element;
    }

    createElementNS(_namespace, tagName) {
      const element = new FixtureSvgElement(tagName);
      element.ownerDocument = this;
      return element;
    }

    querySelector(selector) {
      return this.documentElement.querySelector(selector);
    }

    querySelectorAll(selector) {
      return this.documentElement.querySelectorAll(selector);
    }
  }

  const document = new FixtureDocument();
  global.document = document;
  global.HTMLElement = FixtureElement;
  global.SVGElement = FixtureSvgElement;
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  global.window = {
    Event: FixtureEvent,
    setTimeout(callback, ms = 0) {
      if (ms >= 1000) return 0;
      return setTimeout(callback, ms);
    },
    clearTimeout(id) {
      clearTimeout(id);
    },
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    getComputedStyle() {
      return { display: "block", visibility: "visible" };
    },
  };

  return {
    document,
    Event: FixtureEvent,
    cleanup() {
      global.document = previous.document;
      global.HTMLElement = previous.HTMLElement;
      global.SVGElement = previous.SVGElement;
      global.MutationObserver = previous.MutationObserver;
      global.window = previous.window;
    },
  };
}

function splitSelectors(selector) {
  return selector.split(",").map((part) => part.trim()).filter(Boolean);
}

function matchesSelector(element, selector) {
  if (!selector) return false;
  const tagWithAttr = selector.match(/^([a-z]+)(\[.+\])$/i);
  if (tagWithAttr) {
    return matchesSelector(element, tagWithAttr[1]) && matchesSelector(element, tagWithAttr[2]);
  }
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "a") return element.tagName === "A";
  if (selector === "svg") return element.tagName === "SVG";
  if (selector === "div") return element.tagName === "DIV";
  if (selector === '[data-codexpp-account-switcher]') {
    return element.attributes.has("data-codexpp-account-switcher");
  }
  if (selector === "[data-codexpp-account-switcher-confirm]") {
    return element.attributes.has("data-codexpp-account-switcher-confirm");
  }
  const attrEquals = selector.match(/^\[([^=\]]+)="([^"]+)"\]$/);
  if (attrEquals) return element.getAttribute(attrEquals[1]) === attrEquals[2];
  const attrExists = selector.match(/^\[([^\]=]+)\]$/);
  if (attrExists) return element.attributes.has(attrExists[1]);
  return false;
}

function walk(root, visit) {
  for (const child of root.children || []) {
    visit(child);
    walk(child, visit);
  }
}

function accountState() {
  return {
    accounts: ["work", "personal"],
    current: "work",
    hasActiveAuth: true,
    accountEmails: {
      work: "work@example.com",
      personal: "personal@example.com",
    },
    accountUsage: {},
  };
}

test("account panel renders collapsed and expands as an accordion", () => {
  const fixture = installDomFixture();
  try {
    const { renderAccountPanel } = require("../src/ui-popup");
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const state = { accountsExpanded: false, api: { ipc: { invoke() {} }, log: { warn() {} } } };

    renderAccountPanel(state, panel, accountState());

    const header = panel.querySelector('button[aria-expanded="false"]');
    assert.ok(header);
    assert.equal(header.textContent.includes("Accounts"), true);
    assert.equal(header.style.cssText.includes("font-size:13px"), true);
    assert.equal(header.style.cssText.includes("min-height:38px"), true);
    assert.equal(header.style.cssText.includes("grid-template-columns:20px minmax(0,1fr) 16px"), true);
    assert.equal(panel.querySelector("[data-codexpp-account-switcher-body=\"accounts\"]"), null);
    assert.equal(panel.textContent.includes("personal@example.com"), false);

    header.dispatchEvent(new fixture.Event("click", { target: header }));

    assert.equal(state.accountsExpanded, true);
    assert.ok(panel.querySelector('button[aria-expanded="true"]'));
    assert.ok(panel.querySelector("[data-codexpp-account-switcher-body=\"accounts\"]"));
    assert.equal(panel.textContent.includes("personal@example.com"), true);
  } finally {
    fixture.cleanup();
  }
});

test("renderer starts with the account accordion collapsed", () => {
  const fixture = installDomFixture();
  try {
    const tweak = require("../index");
    tweak.start({
      process: "renderer",
      log: { warn() {} },
      ipc: { invoke() {} },
      settings: {
        registerPage() {
          return { unregister() {} };
        },
      },
    });

    assert.equal(tweak._state.accountsExpanded, false);
    tweak.stop();
  } finally {
    fixture.cleanup();
  }
});

test("renderer injects accounts before the current Usage remaining menu row", async () => {
  const fixture = installDomFixture();
  try {
    const { startRenderer } = require("../src/renderer");
    const decoy = document.createElement("div");
    decoy.setAttribute("role", "menu");
    document.body.appendChild(decoy);
    for (const label of ["Personal account", "Settings", "Log out"]) {
      const button = document.createElement("button");
      button.textContent = label;
      decoy.appendChild(button);
    }

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    for (const label of [
      "admin@thereality.report",
      "Personal account",
      "Settings",
      "Usage remaining",
      "Log out",
    ]) {
      const item = document.createElement(label === "Usage remaining" ? "div" : "button");
      if (label === "Usage remaining") item.setAttribute("data-radix-collection-item", "");
      item.textContent = label;
      menu.appendChild(item);
    }

    const state = {
      api: {
        log: { warn() {} },
        ipc: {
          async invoke(_channel, message) {
            assert.equal(message.action, "state");
            return { ok: true, state: accountState() };
          },
        },
        settings: {
          registerPage() {
            return { unregister() {} };
          },
        },
      },
      accountsExpanded: false,
      observer: null,
      pending: 0,
      disposed: false,
      disposers: [],
      lastState: null,
      lastUsageRefreshAt: Date.now(),
      settingsRoot: null,
      usageRefreshInFlight: false,
    };

    startRenderer(state);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const labels = menu.children.map((child) => child.textContent);
    const accountsIndex = labels.findIndex((label) => label.includes("Accounts"));
    const usageIndex = labels.findIndex((label) => label.includes("Usage remaining"));
    assert.ok(accountsIndex >= 0);
    assert.ok(usageIndex >= 0);
    assert.equal(accountsIndex < usageIndex, true);
    assert.ok(menu.querySelector('button[aria-expanded="false"]'));
    assert.equal(decoy.querySelector("[data-codexpp-account-switcher]"), null);

    for (const dispose of state.disposers.splice(0)) dispose();
  } finally {
    fixture.cleanup();
  }
});

test("renderer retries account menu injection while the popup settles", async () => {
  const fixture = installDomFixture();
  try {
    const { startRenderer } = require("../src/renderer");
    const state = {
      api: {
        log: { warn() {} },
        ipc: {
          async invoke(_channel, message) {
            assert.equal(message.action, "state");
            return { ok: true, state: accountState() };
          },
        },
        settings: {
          registerPage() {
            return { unregister() {} };
          },
        },
      },
      accountsExpanded: false,
      observer: null,
      pending: 0,
      disposed: false,
      disposers: [],
      lastState: null,
      lastUsageRefreshAt: Date.now(),
      settingsRoot: null,
      usageRefreshInFlight: false,
    };

    startRenderer(state);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    for (const label of ["Personal account", "Settings", "Usage remaining", "Log out"]) {
      const button = document.createElement("button");
      button.textContent = label;
      menu.appendChild(button);
    }

    await new Promise((resolve) => setTimeout(resolve, 80));

    const labels = menu.children.map((child) => child.textContent);
    const accountsIndex = labels.findIndex((label) => label.includes("Accounts"));
    const usageIndex = labels.findIndex((label) => label.includes("Usage remaining"));
    assert.ok(accountsIndex >= 0);
    assert.ok(usageIndex >= 0);
    assert.equal(accountsIndex < usageIndex, true);

    for (const dispose of state.disposers.splice(0)) dispose();
  } finally {
    fixture.cleanup();
  }
});

test("switching from the account accordion requires confirmation", async () => {
  const fixture = installDomFixture();
  try {
    const { renderAccountPanel } = require("../src/ui-popup");
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const calls = [];
    const state = {
      accountsExpanded: true,
      settingsRoot: null,
      api: {
        log: { warn() {} },
        ipc: {
          async invoke(_channel, message) {
            calls.push(message);
            return { ok: true, state: accountState() };
          },
        },
      },
    };

    renderAccountPanel(state, panel, accountState());
    const personalRow = panel.querySelectorAll("button").find((button) =>
      button.textContent.includes("personal@example.com"),
    );
    assert.ok(personalRow);

    personalRow.dispatchEvent(new fixture.Event("click", { target: personalRow }));
    await Promise.resolve();

    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog);
    assert.equal(dialog.textContent.includes("personal@example.com"), true);
    assert.deepEqual(calls, []);

    const confirm = document.querySelectorAll("button").find((button) =>
      button.textContent === "Switch account",
    );
    assert.ok(confirm);
    confirm.dispatchEvent(new fixture.Event("click", { target: confirm }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(document.querySelector("[data-codexpp-account-switcher-confirm]"), null);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { action: "switch", name: "personal" });
  } finally {
    fixture.cleanup();
  }
});
