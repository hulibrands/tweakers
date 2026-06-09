"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

// Dormant: settings-search is delisted from FEATURE_DEFS + DEFAULT_FEATURE_FLAGS
// (native Codex now provides its own settings search), so start() no longer
// activates it and these tests can't mount the field through the flag path.
// The handler is retained; to revive, re-add the id to both registries and
// remove these skip flags. See feature-matrix RETIRED_HANDLER_IDS.
test("settings-search mounts once, filters settings nav, clears, and cleans up", { skip: "settings-search delisted; native Codex provides it" }, () => {
  const fixture = createSettingsSearchFixture();

  runTweak(fixture);
  fixture.flush();

  const searchFields = fixture.document.querySelectorAll("input[data-codexpp-settings-search]");
  assert.equal(searchFields.length, 1);

  const search = searchFields[0];
  assert.equal(search.tagName, "INPUT");

  search.value = "usage";
  search.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  fixture.flush();

  assert.equal(isVisible(fixture.navButton("Usage & billing")), true);
  assert.equal(isVisible(fixture.navButton("General")), false);
  assert.equal(isVisible(fixture.navButton("Tweak Store")), false);

  search.value = "";
  search.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  fixture.flush();

  assert.equal(isVisible(fixture.navButton("General")), true);
  assert.equal(isVisible(fixture.navButton("Appearance")), true);
  assert.equal(isVisible(fixture.navButton("Tweaks")), true);
  assert.equal(isVisible(fixture.navButton("Tweak Store")), true);
  assert.equal(isVisible(fixture.navButton("UI Improvements")), true);

  fixture.context.module.exports.stop();
  fixture.flush();

  assert.equal(fixture.document.querySelectorAll("input[data-codexpp-settings-search]").length, 0);
});

// Dormant: see note on the first settings-search test above.
test("settings-search mounts after Settings appears and does not duplicate on later mutations", { skip: "settings-search delisted; native Codex provides it" }, () => {
  const fixture = createFixture({ enabledFeature: "settings-search" });

  runTweak(fixture);
  fixture.flush();

  assert.equal(fixture.document.querySelectorAll("input[data-codexpp-settings-search]").length, 0);

  const { sidebar, navRoot, main } = appendCodexSettingsLayout(fixture.document);
  fixture.notifyAdded(sidebar);
  fixture.flush();

  assert.equal(fixture.document.querySelectorAll("input[data-codexpp-settings-search]").length, 1);
  assert.equal(main.querySelectorAll("input[data-codexpp-settings-search]").length, 0);

  const lateButton = fixture.document.createElement("button");
  lateButton.textContent = "Late Plugin Page";
  navRoot.appendChild(lateButton);
  fixture.notifyAdded(lateButton);
  fixture.flush();

  assert.equal(fixture.document.querySelectorAll("input[data-codexpp-settings-search]").length, 1);
  assert.equal(isVisible(lateButton), true);
});

test("slash-menu-polish marks only the menu root, preserves item events, and cleans up", () => {
  const fixture = createSlashMenuFixture();

  let clickCount = 0;
  let keydownCount = 0;
  fixture.menuItem.addEventListener("click", () => {
    clickCount += 1;
  });
  fixture.menuItem.addEventListener("keydown", () => {
    keydownCount += 1;
  });

  runTweak(fixture);
  fixture.flush();

  assert.equal(fixture.menu.getAttribute("data-codexpp-slash-menu"), "true");
  assert.equal(fixture.menuItem.hasAttribute("data-codexpp-slash-menu"), false);

  const clickEvent = new FakeMouseEvent("click", { bubbles: true });
  fixture.menuItem.dispatchEvent(clickEvent);
  assert.equal(clickCount, 1);
  assert.equal(clickEvent.defaultPrevented, false);
  assert.equal(clickEvent.propagationStopped, false);

  const keyEvent = new FakeKeyboardEvent("keydown", { bubbles: true, key: "Enter" });
  fixture.menuItem.dispatchEvent(keyEvent);
  assert.equal(keydownCount, 1);
  assert.equal(keyEvent.defaultPrevented, false);
  assert.equal(keyEvent.propagationStopped, false);

  fixture.context.module.exports.stop();
  fixture.flush();

  assert.equal(fixture.document.querySelectorAll("[data-codexpp-slash-menu]").length, 0);
  assert.equal(
    fixture.document.head
      .querySelectorAll("style")
      .some((node) => /codexpp-slash-menu|data-codexpp-slash-menu/.test(node.textContent)),
    false,
  );
});

test("tweak-mention-menu opens from percent trigger and inserts a short tweak mention", async () => {
  const fixture = createTweakMentionFixture();

  runTweak(fixture);
  fixture.flush();

  fixture.input.value = "%Proj";
  fixture.input.selectionStart = fixture.input.value.length;
  fixture.input.selectionEnd = fixture.input.value.length;
  fixture.document.activeElement = fixture.input;
  fixture.input.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await new Promise((resolve) => setImmediate(resolve));
  fixture.flush();

  const menu = fixture.document.querySelector("[data-codexpp-tweak-mention-menu='true']");
  assert.ok(menu);
  assert.match(menu.textContent, /Projects/);
  assert.doesNotMatch(menu.textContent, /ShadGPT Projects/);

  fixture.input.dispatchEvent(new FakeKeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  fixture.flush();

  assert.equal(fixture.input.value, "%Projects");
  assert.equal(fixture.input.selectionStart, "%Projects".length);
  assert.equal(fixture.document.querySelector("[data-codexpp-tweak-mention-menu='true']"), null);

  fixture.context.module.exports.stop();
  fixture.flush();
});

test("tweak-mention-menu resolves contenteditable composer targets", async () => {
  const fixture = createTweakMentionFixture({ contenteditable: true });

  runTweak(fixture);
  fixture.flush();

  fixture.input.textContent = "%Bet";
  fixture.document.activeElement = fixture.input;
  fixture.input.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  await new Promise((resolve) => setImmediate(resolve));
  fixture.flush();

  const menu = fixture.document.querySelector("[data-codexpp-tweak-mention-menu='true']");
  assert.ok(menu);
  assert.match(menu.textContent, /Better Browser/);

  fixture.input.dispatchEvent(new FakeKeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  fixture.flush();

  assert.equal(fixture.input.textContent, "%Better Browser");

  fixture.context.module.exports.stop();
  fixture.flush();
});

function runTweak(fixture) {
  vm.runInNewContext(source, fixture.context, {
    filename: join(__dirname, "..", "index.js"),
  });
  fixture.context.module.exports.start(fixture.api);
}

function createSettingsSearchFixture() {
  const fixture = createFixture({ enabledFeature: "settings-search" });
  const { document } = fixture;
  appendCodexSettingsLayout(document);

  return {
    ...fixture,
    navButton(label) {
      const button = Array.from(document.querySelectorAll("nav button")).find(
        (node) => compactText(node.textContent) === compactText(label),
      );
      assert.ok(button, `expected nav button "${label}"`);
      return button;
    },
  };
}

function appendCodexSettingsLayout(document) {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.className = "settings-dialog";

  const shell = document.createElement("div");
  shell.className = "flex h-full min-h-0";

  const sidebar = document.createElement("div");
  sidebar.className = "window-fx-sidebar-surface flex shrink-0 flex-col w-token-sidebar";
  sidebar.setRect({ left: 0, top: 0, width: 300, height: 720, right: 300, bottom: 720 });

  const toolbar = document.createElement("div");
  toolbar.className = "draggable h-toolbar w-full";

  const nav = document.createElement("nav");
  nav.className = "px-row-x";
  nav.setAttribute("aria-label", "Settings");

  const navRoot = document.createElement("div");
  navRoot.className = "flex flex-col";
  navRoot.append(
    navGroup(document, ["General", "Appearance", "Usage & billing"]),
    navGroup(document, ["Configuration", "Keyboard Shortcuts", "Hooks", "Browser"]),
    navGroup(document, ["Config", "Tweaks", "Tweak Store", "UI Improvements"], {
      "data-codexpp": "nav-group",
    }),
  );
  nav.appendChild(navRoot);
  sidebar.append(toolbar, nav);

  const main = document.createElement("main");
  main.className = "min-w-0 flex-1 overflow-visible";
  const section = document.createElement("section");
  const h1 = document.createElement("h1");
  h1.textContent = "General";
  section.appendChild(h1);
  main.appendChild(section);

  shell.append(sidebar, main);
  dialog.appendChild(shell);
  document.body.appendChild(dialog);

  return { dialog, shell, sidebar, nav, navRoot, main };
}

function createSlashMenuFixture() {
  const fixture = createFixture({ enabledFeature: "slash-menu-polish" });
  const { document } = fixture;

  const composer = document.createElement("div");
  composer.setAttribute("data-testid", "composer");
  composer.setRect({ left: 80, top: 560, width: 720, height: 80, right: 800, bottom: 640 });

  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "Message Codex");
  input.value = "/";
  input.setRect({ left: 100, top: 580, width: 680, height: 44, right: 780, bottom: 624 });
  composer.appendChild(input);

  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.setAttribute("data-state", "open");
  menu.className = "z-50 rounded-md border bg-popover text-popover-foreground";
  menu.setRect({ left: 100, top: 380, width: 320, height: 180, right: 420, bottom: 560 });

  const menuItem = document.createElement("button");
  menuItem.setAttribute("role", "menuitem");
  menuItem.textContent = "Summarize";
  menuItem.setRect({ left: 112, top: 400, width: 296, height: 32, right: 408, bottom: 432 });

  const secondItem = document.createElement("button");
  secondItem.setAttribute("role", "menuitem");
  secondItem.textContent = "Explain";
  secondItem.setRect({ left: 112, top: 436, width: 296, height: 32, right: 408, bottom: 468 });

  menu.append(menuItem, secondItem);
  document.body.append(composer, menu);

  return {
    ...fixture,
    menu,
    menuItem,
  };
}

function createTweakMentionFixture(options = {}) {
  const fixture = createFixture({ enabledFeature: "tweak-mention-menu" });
  const { document } = fixture;

  const composer = document.createElement("div");
  composer.setAttribute("data-testid", "composer");
  composer.setRect({ left: 80, top: 560, width: 720, height: 80, right: 800, bottom: 640 });

  const input = options.contenteditable ? document.createElement("div") : document.createElement("textarea");
  input.setAttribute("aria-label", "Message Codex");
  if (options.contenteditable) {
    input.setAttribute("contenteditable", "true");
    input.className = "ProseMirror";
  } else {
    input.setSelectionRange = (start, end) => {
      input.selectionStart = start;
      input.selectionEnd = end;
    };
  }
  input.setRect({ left: 100, top: 580, width: 680, height: 44, right: 780, bottom: 624 });
  composer.appendChild(input);
  document.body.appendChild(composer);
  document.activeElement = input;

  return {
    ...fixture,
    input,
  };
}

function navGroup(document, labels, attrs = {}) {
  const group = document.createElement("div");
  group.className = "flex flex-col gap-1";
  for (const [name, value] of Object.entries(attrs)) group.setAttribute(name, value);
  for (const label of labels) {
    const button = document.createElement("button");
    button.textContent = label;
    group.appendChild(button);
  }
  return group;
}

function createFixture({ enabledFeature }) {
  const timers = [];
  const rafs = [];
  const observers = new Set();
  const storage = new Map();
  const document = new FakeDocument();
  let context;

  const window = createEventTarget({
    innerWidth: 1280,
    innerHeight: 800,
    document,
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    requestAnimationFrame(fn) {
      rafs.push(fn);
      return rafs.length;
    },
    cancelAnimationFrame() {},
    getComputedStyle(node) {
      const display = node?.style?.display || node?.style?.getPropertyValue?.("display") || "block";
      const visibility =
        node?.style?.visibility || node?.style?.getPropertyValue?.("visibility") || "visible";
      const opacity = node?.style?.opacity || node?.style?.getPropertyValue?.("opacity") || "1";
      return { display, visibility, opacity };
    },
  });
  document.defaultView = window;

  class FixtureMutationObserver extends FakeMutationObserver {
    constructor(callback) {
      super(callback);
      observers.add(this);
    }
  }

  const api = {
    process: "renderer",
    settings: {
      registerPage() {
        return { unregister() {} };
      },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
    storage: {
      get(key, fallback) {
        if (key.startsWith("feature:")) return key === `feature:${enabledFeature}`;
        if (storage.has(key)) return storage.get(key);
        return fallback;
      },
      set(key, value) {
        storage.set(key, value);
      },
    },
    ipc: {
      invoke(channel) {
        if (channel === "tweak-mentions-list") {
          return Promise.resolve([
            {
              manifest: {
                id: "co.thomashulihan.projects",
                name: "ShadGPT Projects",
                description: "Project inventory.",
              },
              enabled: true,
            },
            {
              manifest: {
                id: "co.thomashulihan.better-browser-agent",
                name: "ShadGPT Better Browser Agent",
                description: "Browser tools.",
              },
              enabled: true,
            },
          ]);
        }
        return Promise.resolve(null);
      },
    },
  };

  context = {
    module: { exports: {} },
    exports: {},
    api,
    document,
    window,
    navigator: {},
    CustomEvent: FakeCustomEvent,
    Event: FakeEvent,
    KeyboardEvent: FakeKeyboardEvent,
    MouseEvent: FakeMouseEvent,
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeElement,
    Node: FakeNode,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    MutationObserver: FixtureMutationObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    console,
    Date,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Array,
    Object,
    String,
    RegExp,
    Promise,
  };
  context.globalThis = context;

  return {
    api,
    context,
    document,
    storage,
    flush() {
      for (let index = 0; index < 20 && (timers.length || rafs.length); index += 1) {
        while (rafs.length) rafs.shift()(Date.now());
        while (timers.length) timers.shift()();
      }
      for (const observer of Array.from(observers)) observer.flush();
    },
    notifyAdded(node) {
      const target = node.parentElement || document.body;
      for (const observer of Array.from(observers)) {
        observer.flush([{ type: "childList", target, addedNodes: [node] }]);
      }
    },
  };
}

class FakeNode {
  static ELEMENT_NODE = 1;
  static TEXT_NODE = 3;
}

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? true;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? true;
    this.target = null;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
    this.stopPropagation();
  }
}

class FakeMouseEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.metaKey = init.metaKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.button = init.button ?? 0;
  }
}

class FakeKeyboardEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key || "";
    this.code = init.code || "";
    this.metaKey = init.metaKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.connected = false;
  }

  observe(target, options = {}) {
    this.connected = true;
    this.target = target;
    this.options = options;
  }

  disconnect() {
    this.connected = false;
  }

  flush(records = [{ type: "childList", target: this.target, addedNodes: [] }]) {
    if (!this.connected) return;
    this.callback(records, this);
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
    this[toStyleProperty(name)] = String(value);
  }

  getPropertyValue(name) {
    return this.values.get(name) || this[toStyleProperty(name)] || "";
  }

  removeProperty(name) {
    this.values.delete(name);
    this[toStyleProperty(name)] = "";
  }

  set cssText(value) {
    this.values.set("cssText", String(value));
  }

  get cssText() {
    return this.values.get("cssText") || "";
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  contains(className) {
    return this._classes().includes(className);
  }

  add(...classNames) {
    const next = new Set(this._classes());
    classNames.forEach((className) => next.add(className));
    this.element.className = Array.from(next).join(" ");
  }

  remove(...classNames) {
    const remove = new Set(classNames);
    this.element.className = this._classes()
      .filter((className) => !remove.has(className))
      .join(" ");
  }

  _classes() {
    return String(this.element.className || "").split(/\s+/).filter(Boolean);
  }
}

class FakeTextNode extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = FakeNode.TEXT_NODE;
    this.nodeName = "#text";
    this.parentElement = null;
    this.parentNode = null;
    this.nodeValue = String(text || "");
    this.isConnected = false;
  }

  set textContent(value) {
    this.nodeValue = String(value || "");
  }

  get textContent() {
    return this.nodeValue;
  }

  setConnected(value) {
    this.isConnected = value;
  }

  contains(node) {
    return node === this;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.nodeType = FakeNode.ELEMENT_NODE;
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;
    this.attributes = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.style = new FakeStyle();
    this._dataset = {};
    this.dataset = createDatasetProxy(this);
    this.eventListeners = new Map();
    this.isConnected = false;
    this.hidden = false;
    this.value = "";
    this._textContent = "";
    this._rect = { left: 0, top: 0, width: 1, height: 1, right: 1, bottom: 1 };
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this.children = [];
    this.childNodes = [];
  }

  get textContent() {
    return this._textContent + this.childNodes.map((child) => child.textContent).join("");
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  prepend(...nodes) {
    for (const node of nodes.reverse()) this.insertBefore(node, this.firstChild);
  }

  before(...nodes) {
    if (!this.parentElement) return;
    for (const node of nodes) this.parentElement.insertBefore(node, this);
  }

  after(...nodes) {
    if (!this.parentElement) return;
    let reference = this.nextSibling;
    for (const node of nodes) {
      this.parentElement.insertBefore(node, reference);
    }
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) child.remove();
    nodes.forEach((node) => this.appendChild(node));
  }

  insertBefore(node, referenceNode) {
    const child = normalizeNode(node);
    if (child.parentElement) child.remove();
    child.parentElement = this;
    child.parentNode = this;
    const index = referenceNode ? this.childNodes.indexOf(referenceNode) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, child);
    else this.childNodes.push(child);
    if (child.nodeType === FakeNode.ELEMENT_NODE) {
      const childIndex = referenceNode ? this.children.indexOf(referenceNode) : -1;
      if (childIndex >= 0) this.children.splice(childIndex, 0, child);
      else this.children.push(child);
    }
    child.setConnected(this.isConnected);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.childNodes = this.parentElement.childNodes.filter((child) => child !== this);
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this.parentNode = null;
    this.setConnected(false);
  }

  setConnected(value) {
    this.isConnected = value;
    this.childNodes.forEach((child) => child.setConnected(value));
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child.contains(node));
  }

  setRect(rect) {
    this._rect = { ...this._rect, ...rect };
  }

  getBoundingClientRect() {
    return this._rect;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") this.className = stringValue;
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) this._dataset[dataAttrToProp(name)] = stringValue;
  }

  getAttribute(name) {
    if (name === "class") return this.className || null;
    if (name === "hidden") return this.hidden ? "" : null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    if (name === "class") return Boolean(this.className);
    if (name === "hidden") return this.hidden;
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.className = "";
    if (name === "hidden") this.hidden = false;
    if (name.startsWith("data-")) delete this._dataset[dataAttrToProp(name)];
  }

  addEventListener(type, callback, options = {}) {
    const list = this.eventListeners.get(type) || [];
    list.push({ callback, capture: Boolean(options?.capture) });
    this.eventListeners.set(type, list);
  }

  removeEventListener(type, callback) {
    this.eventListeners.set(
      type,
      (this.eventListeners.get(type) || []).filter((item) => item.callback !== callback),
    );
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const path = [];
    let node = this;
    while (node) {
      path.push(node);
      node = node.parentElement;
    }
    const fullPath = [...path].reverse();
    for (const current of fullPath) {
      invokeListeners(current, event, true);
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    for (const current of path) {
      invokeListeners(current, event, false);
      if (event.propagationStopped || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = splitSelectorList(selector);
    const matches = [];
    for (const node of this._walk()) {
      if (node.nodeType !== FakeNode.ELEMENT_NODE) continue;
      if (selectors.some((part) => matchesComplexSelector(node, part))) matches.push(node);
    }
    return matches;
  }

  matches(selector) {
    if (selector === ":hover") return false;
    return splitSelectorList(selector).some((part) => matchesComplexSelector(this, part));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  *_walk() {
    for (const child of this.childNodes) {
      yield child;
      if (child.nodeType === FakeNode.ELEMENT_NODE) yield* child._walk();
    }
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document");
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.append(this.head, this.body);
    this.setConnected(true);
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }

  getElementById(id) {
    return this.querySelectorAll(`#${escapeCssIdentifier(id)}`)[0] || null;
  }
}

function createEventTarget(base) {
  const listeners = new Map();
  return {
    ...base,
    addEventListener(type, callback, options = {}) {
      const list = listeners.get(type) || [];
      list.push({ callback, capture: Boolean(options?.capture) });
      listeners.set(type, list);
    },
    removeEventListener(type, callback) {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((item) => item.callback !== callback),
      );
    },
    dispatchEvent(event) {
      for (const item of listeners.get(event.type) || []) item.callback(event);
      return !event.defaultPrevented;
    },
  };
}

function invokeListeners(node, event, capture) {
  for (const item of node.eventListeners?.get(event.type) || []) {
    if (item.capture !== capture) continue;
    event.currentTarget = node;
    item.callback(event);
    if (event.immediatePropagationStopped) return;
  }
}

function normalizeNode(node) {
  return typeof node === "string" ? new FakeTextNode(node) : node;
}

function isVisible(node) {
  let current = node;
  while (current) {
    if (current.hidden) return false;
    if (current.getAttribute?.("aria-hidden") === "true") return false;
    if (current.style?.display === "none" || current.style?.getPropertyValue?.("display") === "none") {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function createDatasetProxy(element) {
  return new Proxy(element._dataset, {
    set(target, prop, value) {
      target[prop] = String(value);
      element.attributes.set(dataPropToAttr(prop), String(value));
      return true;
    },
    deleteProperty(target, prop) {
      delete target[prop];
      element.attributes.delete(dataPropToAttr(prop));
      return true;
    },
  });
}

function dataAttrToProp(name) {
  return name
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function dataPropToAttr(prop) {
  return `data-${String(prop).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function toStyleProperty(name) {
  return String(name).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function splitSelectorList(selector) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (const char of String(selector || "")) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSelectorParts(selector) {
  const normalized = String(selector || "").replace(/\s*>\s*/g, " ");
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (const char of normalized) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function matchesComplexSelector(element, selector) {
  const parts = splitSelectorParts(selector);
  if (!parts.length) return false;
  if (!matchesSimpleSelector(element, parts.at(-1))) return false;
  let ancestor = element.parentElement;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) {
      ancestor = ancestor.parentElement;
    }
    if (!ancestor) return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

function matchesSimpleSelector(element, selector) {
  if (!selector || selector === "*") return true;
  if (selector === ":hover") return false;
  if (selector.includes(":not(")) {
    for (const not of selector.matchAll(/:not\(([^()]*)\)/g)) {
      if (matchesSimpleSelector(element, not[1])) return false;
    }
    selector = selector.replace(/:not\([^()]*\)/g, "");
  }
  selector = selector.replace(/:(is|where)\(([^()]*)\)/g, (_match, _kind, inner) => {
    const options = splitSelectorList(inner);
    return options.some((option) => matchesSimpleSelector(element, option)) ? "" : "__never__";
  });
  if (selector.includes("__never__")) return false;

  const tag = selector.match(/^[a-zA-Z][\w-]*/)?.[0];
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;

  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;

  for (const className of selector.matchAll(/\.([^\.\[#]+)/g)) {
    if (!element.classList.contains(className[1].replace(/\\/g, ""))) return false;
  }

  for (const attr of selector.matchAll(/\[([^\]\s~|^$*='"]+)([*^$]?=)?(?:"([^"]*)"|'([^']*)'|([^\]]+))?(?:\s+i)?\]/g)) {
    const [, name, operator, doubleQuoted, singleQuoted, bare] = attr;
    const expected = doubleQuoted ?? singleQuoted ?? bare?.trim();
    const actual = element.getAttribute(name);
    if (!operator) {
      if (actual === null) return false;
    } else if (operator === "=") {
      if (actual !== expected) return false;
    } else if (operator === "*=") {
      if (!actual?.includes(expected)) return false;
    } else if (operator === "^=") {
      if (!actual?.startsWith(expected)) return false;
    } else if (operator === "$=") {
      if (!actual?.endsWith(expected)) return false;
    }
  }

  return true;
}

function escapeCssIdentifier(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
