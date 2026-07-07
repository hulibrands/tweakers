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
      this.shiftKey = Boolean(options.shiftKey);
      this.metaKey = Boolean(options.metaKey);
      this.ctrlKey = Boolean(options.ctrlKey);
      this.altKey = Boolean(options.altKey);
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

    contains(other) {
      let node = other;
      while (node) {
        if (node === this) return true;
        node = node.parentElement;
      }
      return false;
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
  if (selector.startsWith("#")) return element.getAttribute("id") === selector.slice(1);
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

test("account list supports roving keyboard focus", () => {
  const fixture = installDomFixture();
  try {
    const { renderAccountPanel } = require("../src/ui-popup");
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const state = { accountsExpanded: true, api: { ipc: { invoke() {} }, log: { warn() {} } } };

    renderAccountPanel(state, panel, accountState());

    const work = panel.querySelectorAll("button").find((button) =>
      button.textContent.includes("work@example.com"),
    );
    const personal = panel.querySelectorAll("button").find((button) =>
      button.textContent.includes("personal@example.com"),
    );
    const configure = panel.querySelectorAll("button").find((button) =>
      button.textContent.includes("Configure"),
    );
    assert.ok(work);
    assert.ok(personal);
    assert.ok(configure);
    assert.equal(work.getAttribute("aria-current"), "true");
    assert.match(work.getAttribute("aria-label"), /Current account/);
    assert.match(personal.getAttribute("aria-label"), /Switch to account/);
    assert.match(personal.getAttribute("aria-label"), /personal@example\.com/);
    assert.equal(work.tabIndex, 0);
    assert.equal(personal.tabIndex, -1);

    work.focus();
    const down = new fixture.Event("keydown", { key: "ArrowDown", target: work });
    work.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.equal(document.activeElement, personal);
    assert.equal(personal.tabIndex, 0);
    assert.equal(work.tabIndex, -1);

    const end = new fixture.Event("keydown", { key: "End", target: personal });
    personal.dispatchEvent(end);
    assert.equal(document.activeElement, configure);

    const typeahead = new fixture.Event("keydown", { key: "w", target: configure });
    configure.dispatchEvent(typeahead);
    assert.equal(document.activeElement, work);
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

test("renderer ignores ordinary document clicks before probing account menu", async () => {
  const fixture = installDomFixture();
  try {
    const { startRenderer } = require("../src/renderer");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    for (const label of ["Personal account", "Settings", "Usage remaining", "Log out"]) {
      const button = document.createElement("button");
      button.textContent = label;
      menu.appendChild(button);
    }

    const state = {
      api: {
        log: { warn() {} },
        ipc: {
          async invoke() {
            throw new Error("ordinary clicks should not probe account state");
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
    document.dispatchEvent(new fixture.Event("pointerdown", { target: document.body }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(menu.querySelector("[data-codexpp-account-switcher]"), null);
    assert.equal(state.accountMenuOpen, false);

    for (const dispose of state.disposers.splice(0)) dispose();
  } finally {
    fixture.cleanup();
  }
});

test("renderer injects accounts before the current Usage remaining menu row", async () => {
  const fixture = installDomFixture();
  try {
    const { startRenderer } = require("../src/renderer");
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-label", "Account menu");
    document.body.appendChild(trigger);

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
    document.dispatchEvent(new fixture.Event("pointerdown", { target: trigger }));
    await new Promise((resolve) => setTimeout(resolve, 10));
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

test("renderer restores accounts accordion in unlabelled current account popover", async () => {
  const fixture = installDomFixture();
  try {
    const { startRenderer } = require("../src/renderer");
    const menu = document.createElement("div");
    document.body.appendChild(menu);
    for (const label of [
      "admin@thereality.report",
      "Personal account",
      "Settings",
      "Usage remaining 4%",
      "Log out",
    ]) {
      const row = document.createElement("div");
      row.textContent = label;
      menu.appendChild(row);
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
      accountMenuOpen: true,
      observer: null,
      pending: 0,
      disposed: false,
      disposers: [],
      lastState: null,
      lastUsageRefreshAt: Date.now(),
      settingsRoot: null,
      accountMenuRescanTimers: [],
      usageRefreshInFlight: false,
    };

    startRenderer(state);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setImmediate(resolve));

    const labels = menu.children.map((child) => child.textContent);
    const accountsIndex = labels.findIndex((label) => label.includes("Accounts"));
    const usageIndex = labels.findIndex((label) => label.includes("Usage remaining"));
    assert.ok(accountsIndex >= 0, labels.join(" | "));
    assert.ok(usageIndex >= 0, labels.join(" | "));
    assert.equal(accountsIndex < usageIndex, true);
    assert.ok(menu.querySelector('button[aria-expanded="false"]'));

    for (const dispose of state.disposers.splice(0)) dispose();
  } finally {
    fixture.cleanup();
  }
});

test("renderer injects into full current account popover instead of nested usage row", async () => {
  const fixture = installDomFixture();
  try {
    const { startRenderer } = require("../src/renderer");
    const menu = document.createElement("div");
    document.body.appendChild(menu);

    const email = document.createElement("div");
    email.textContent = "codex@thereality.report";
    menu.appendChild(email);
    const plan = document.createElement("div");
    plan.textContent = "Personal account";
    menu.appendChild(plan);
    const settings = document.createElement("button");
    settings.textContent = "Settings";
    menu.appendChild(settings);

    const usageWrapper = document.createElement("div");
    const usageButton = document.createElement("button");
    usageButton.setAttribute("data-radix-collection-item", "");
    usageButton.textContent = "Usage remaining 4%";
    usageWrapper.appendChild(usageButton);
    menu.appendChild(usageWrapper);

    const logout = document.createElement("button");
    logout.textContent = "Log out";
    menu.appendChild(logout);

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
      accountMenuOpen: true,
      observer: null,
      pending: 0,
      disposed: false,
      disposers: [],
      lastState: null,
      lastUsageRefreshAt: Date.now(),
      settingsRoot: null,
      accountMenuRescanTimers: [],
      usageRefreshInFlight: false,
    };

    startRenderer(state);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(Boolean(usageWrapper.querySelector("[data-codexpp-account-switcher]")), false);
    assert.equal(Boolean(menu.querySelector("[data-codexpp-account-switcher]")), true);
    const labels = menu.children.map((child) => child.textContent);
    const accountsIndex = labels.findIndex((label) => label.includes("Accounts"));
    const usageIndex = labels.findIndex((label) => label.includes("Usage remaining"));
    assert.ok(accountsIndex >= 0, labels.join(" | "));
    assert.ok(usageIndex >= 0, labels.join(" | "));
    assert.equal(accountsIndex < usageIndex, true);
    assert.ok(["installed", "already installed"].includes(state.detectorHealth.status));

    for (const dispose of state.disposers.splice(0)) dispose();
  } finally {
    fixture.cleanup();
  }
});

test("renderer captures live account popover DOM signals for diagnostics", () => {
  const fixture = installDomFixture();
  try {
    const { __test } = require("../src/renderer");
    const menu = document.createElement("div");
    document.body.appendChild(menu);
    for (const label of [
      "codex@thereality.report",
      "Personal account",
      "Settings",
      "Usage remaining 4%",
      "Log out",
    ]) {
      const row = document.createElement("div");
      row.textContent = label;
      menu.appendChild(row);
    }

    const snapshot = __test.captureAccountMenuDomSnapshot();

    assert.equal(snapshot.count >= 5, true);
    assert.equal(snapshot.joinedText.includes("codex@thereality.report"), true);
    assert.equal(snapshot.joinedText.includes("Usage remaining 4%"), true);
    assert.equal(snapshot.joinedText.includes("Log out"), true);
  } finally {
    fixture.cleanup();
  }
});

test("settings page exposes account menu detector health", () => {
  const fixture = installDomFixture();
  try {
    const { renderAccountsPageState } = require("../src/ui-settings");
    const root = document.createElement("div");
    document.body.appendChild(root);
    const state = {
      detectorHealth: {
        status: "missing",
        misses: 2,
        lastCheckedAt: Date.now(),
        lastMissingAt: Date.now(),
        lastReason: "Saw account-menu text but no full menu container matched.",
        lastSnapshot: {
          joinedText: "codex@thereality.report | Usage remaining 4% | Log out",
        },
      },
      api: { log: { warn() {} }, ipc: { invoke() {} } },
    };

    renderAccountsPageState(state, root, accountState());

    assert.equal(root.textContent.includes("Account menu detector"), true);
    assert.equal(root.textContent.includes("missing (2 misses)"), true);
    assert.equal(root.textContent.includes("codex@thereality.report"), true);
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
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-label", "Account menu");
    document.body.appendChild(trigger);
    document.dispatchEvent(new fixture.Event("pointerdown", { target: trigger }));

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
            if (message.action === "create-intent") {
              return { ok: true, state: { intent: "intent-switch-personal" } };
            }
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

    personalRow.focus();
    personalRow.dispatchEvent(new fixture.Event("click", { target: personalRow }));
    await Promise.resolve();

    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog);
    assert.equal(dialog.textContent.includes("personal@example.com"), true);
    assert.ok(dialog.getAttribute("aria-labelledby"));
    assert.ok(dialog.getAttribute("aria-describedby"));
    assert.equal(document.querySelector(`#${dialog.getAttribute("aria-labelledby")}`).textContent, "Switch account?");
    assert.equal(document.querySelector(`#${dialog.getAttribute("aria-describedby")}`).textContent.includes("personal@example.com"), true);
    assert.deepEqual(calls, []);

    const confirm = document.querySelectorAll("button").find((button) =>
      button.textContent === "Switch account",
    );
    assert.ok(confirm);
    confirm.focus();
    const tabEvent = new fixture.Event("keydown", { key: "Tab", target: document });
    document.dispatchEvent(tabEvent);
    assert.equal(tabEvent.defaultPrevented, true);
    assert.equal(document.activeElement.textContent, "Cancel");

    confirm.dispatchEvent(new fixture.Event("click", { target: confirm }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(document.querySelector("[data-codexpp-account-switcher-confirm]"), null);
    assert.equal(document.activeElement, personalRow);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { action: "create-intent", intentAction: "switch", name: "personal" });
    assert.deepEqual(calls[1], { action: "switch", name: "personal", intent: "intent-switch-personal" });
  } finally {
    fixture.cleanup();
  }
});

test("settings switch, delete, and clear-active require confirmation", async () => {
  const fixture = installDomFixture();
  try {
    const { renderAccountsPageState } = require("../src/ui-settings");

    async function exercise(label, confirmLabel, expectedIntent) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const calls = [];
      const state = {
        detectorHealth: {},
        api: {
          log: { warn() {} },
          ipc: {
            async invoke(_channel, message) {
              calls.push(message);
              if (message.action === "create-intent") {
                return { ok: true, state: { intent: `intent-${expectedIntent}` } };
              }
              return { ok: true, state: accountState() };
            },
          },
        },
      };

      renderAccountsPageState(state, root, accountState());
      const button = root.querySelectorAll("button").find((candidate) => {
        return candidate.textContent === label && !candidate.disabled;
      });
      assert.ok(button, `missing settings button: ${label}`);

      button.focus();
      button.dispatchEvent(new fixture.Event("click", { target: button }));
      await Promise.resolve();

      const dialog = document.querySelector('[role="alertdialog"]');
      assert.ok(dialog, `missing confirmation dialog for ${label}`);
      assert.deepEqual(calls, []);

      const confirm = dialog.querySelectorAll("button").find((candidate) => {
        return candidate.textContent === confirmLabel;
      });
      assert.ok(confirm, `missing confirmation button: ${confirmLabel}`);
      confirm.dispatchEvent(new fixture.Event("click", { target: confirm }));
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(document.querySelector("[data-codexpp-account-switcher-confirm]"), null);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].action, "create-intent");
      assert.equal(calls[0].intentAction, expectedIntent);
      assert.equal(calls[1].action, expectedIntent);
      assert.equal(calls[1].intent, `intent-${expectedIntent}`);
      root.remove();
    }

    await exercise("Switch", "Switch account", "switch");
    await exercise("Delete", "Delete account", "delete");
    await exercise("Start sign-in", "Start sign-in", "clear-active");
  } finally {
    fixture.cleanup();
  }
});
