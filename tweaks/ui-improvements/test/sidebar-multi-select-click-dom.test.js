"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("sidebar multi-select clears selection before normal session navigation proceeds", () => {
  const fixture = createSidebarFixture();
  runTweak(fixture);

  const firstModifierClick = fixture.click(fixture.first.link, { metaKey: true });
  assert.equal(firstModifierClick.defaultPrevented, true);
  assert.equal(firstModifierClick.propagationStopped, true);
  assert.equal(firstModifierClick.immediatePropagationStopped, true);
  assert.equal(fixture.first.nativeClicks, 0);
  assert.equal(fixture.first.row.getAttribute("data-codexpp-sidebar-chat-selected"), "true");

  const normalClick = fixture.activate(fixture.second.link);
  assert.equal(normalClick.defaultPrevented, false);
  assert.equal(normalClick.propagationStopped, false);
  assert.equal(normalClick.immediatePropagationStopped, false);
  assert.equal(fixture.second.nativeClicks, 1);
  assert.deepEqual(fixture.second.selectedRowsAtNativeClick, []);
  assert.equal(fixture.documentKeydowns, 0);
  assert.equal(fixture.first.row.hasAttribute("data-codexpp-sidebar-chat-selected"), false);
  assert.equal(fixture.first.row.hasAttribute("data-codexpp-sidebar-chat-selected-target"), false);

  fixture.flushTimers();

  assert.equal(fixture.second.nativeClicks, 1);
  assert.equal(fixture.documentKeydowns, 0);
  assert.equal(fixture.first.row.hasAttribute("data-codexpp-sidebar-chat-selected"), false);
  assert.equal(fixture.first.row.hasAttribute("data-codexpp-sidebar-chat-selected-target"), false);
});

test("sidebar multi-select lets five normal session clicks navigate in order", () => {
  const fixture = createSidebarFixture();
  runTweak(fixture);

  for (const row of fixture.rows) {
    const click = fixture.activate(row.link);
    assert.equal(click.defaultPrevented, false);
    assert.equal(click.propagationStopped, false);
    assert.equal(click.immediatePropagationStopped, false);
    assert.equal(row.nativeClicks, 1);
  }

  assert.deepEqual(fixture.routeActivations, [
    "thread-a",
    "thread-b",
    "thread-c",
    "thread-d",
    "thread-e",
  ]);
  assert.equal(fixture.documentKeydowns, 0);
});

test("sidebar multi-select still blocks native navigation for modifier selection clicks", () => {
  const fixture = createSidebarFixture();
  runTweak(fixture);

  const ctrlClick = fixture.click(fixture.first.link, { ctrlKey: true });
  assert.equal(ctrlClick.defaultPrevented, true);
  assert.equal(ctrlClick.propagationStopped, true);
  assert.equal(ctrlClick.immediatePropagationStopped, true);
  assert.equal(fixture.first.nativeClicks, 0);

  const shiftClick = fixture.click(fixture.second.link, { shiftKey: true });
  assert.equal(shiftClick.defaultPrevented, true);
  assert.equal(shiftClick.propagationStopped, true);
  assert.equal(shiftClick.immediatePropagationStopped, true);
  assert.equal(fixture.second.nativeClicks, 0);
});

function runTweak(fixture) {
  vm.runInNewContext(source, fixture.context, {
    filename: join(__dirname, "..", "index.js"),
  });
  fixture.context.module.exports.start(fixture.api);
}

function createSidebarFixture() {
  const timers = [];
  let documentKeydowns = 0;
  const document = new FakeDocument();
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
      timers.push(fn);
      return timers.length;
    },
    cancelAnimationFrame() {},
  });
  document.defaultView = window;

  const aside = document.createElement("aside");
  aside.className = "pointer-events-auto relative flex overflow-visible";
  document.body.appendChild(aside);

  const routeActivations = [];
  const rows = ["thread-a", "thread-b", "thread-c", "thread-d", "thread-e"]
    .map((id) => appendThreadRow(document, aside, id, routeActivations));
  const [first, second] = rows;

  document.addEventListener("keydown", () => {
    documentKeydowns += 1;
  });

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
        if (key.startsWith("feature:")) return key === "feature:sidebar-chat-multi-select";
        return fallback;
      },
      set() {},
    },
    ipc: {
      invoke() {
        throw new Error("ipc should not be used by click selection tests");
      },
    },
  };

  const context = {
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
    MutationObserver: FakeMutationObserver,
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
    Promise,
  };
  context.globalThis = context;

  return {
    api,
    context,
    document,
    first,
    second,
    rows,
    routeActivations,
    get documentKeydowns() {
      return documentKeydowns;
    },
    click(target, init = {}) {
      const event = new FakeMouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    },
    activate(target, init = {}) {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        target.dispatchEvent(new FakeMouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          ...init,
        }));
      }
      return this.click(target, init);
    },
    flushTimers() {
      for (let index = 0; index < 20 && timers.length; index += 1) {
        timers.shift()(Date.now());
      }
    },
  };
}

function appendThreadRow(document, aside, id, routeActivations) {
  let nativeClicks = 0;
  let selectedRowsAtNativeClick = [];
  const row = document.createElement("div");
  row.setAttribute("role", "listitem");

  const link = document.createElement("a");
  link.setAttribute("href", `/chat/${id}`);
  link.setAttribute("data-app-action-sidebar-thread-id", `local:${id}`);
  link.setAttribute("data-app-action-sidebar-thread-kind", "local");
  link.textContent = id;
  link.addEventListener("click", () => {
    selectedRowsAtNativeClick = Array.from(
      aside.querySelectorAll("[data-codexpp-sidebar-chat-selected]"),
    ).map((node) => node.textContent);
    routeActivations.push(id);
    nativeClicks += 1;
  });

  row.appendChild(link);
  aside.appendChild(row);

  return {
    row,
    link,
    get nativeClicks() {
      return nativeClicks;
    },
    get selectedRowsAtNativeClick() {
      return selectedRowsAtNativeClick;
    },
  };
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
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}

class FakeKeyboardEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key || "";
  }
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }

  removeProperty(name) {
    this.values.delete(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;
    this.attributeMap = new Map();
    this.attributes = [];
    this.className = "";
    this.style = new FakeStyle();
    this.eventListeners = new Map();
    this.isConnected = false;
    this._textContent = "";
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
    return this._textContent + this.childNodes.map((child) => child.textContent || "").join("");
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  insertBefore(node, referenceNode) {
    if (node.parentElement) node.remove();
    node.parentElement = this;
    node.parentNode = this;
    const index = referenceNode ? this.childNodes.indexOf(referenceNode) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, node);
    else this.childNodes.push(node);
    if (node.nodeType === 1) {
      const childIndex = referenceNode ? this.children.indexOf(referenceNode) : -1;
      if (childIndex >= 0) this.children.splice(childIndex, 0, node);
      else this.children.push(node);
    }
    node.setConnected?.(this.isConnected);
    return node;
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
    for (const child of this.childNodes) child.setConnected?.(value);
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child.contains?.(node));
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributeMap.set(name, stringValue);
    const existing = this.attributes.find((attr) => attr.name === name);
    if (existing) existing.value = stringValue;
    else this.attributes.push({ name, value: stringValue });
    if (name === "class") this.className = stringValue;
  }

  getAttribute(name) {
    if (name === "class") return this.className || null;
    return this.attributeMap.has(name) ? this.attributeMap.get(name) : null;
  }

  hasAttribute(name) {
    if (name === "class") return Boolean(this.className);
    return this.attributeMap.has(name);
  }

  removeAttribute(name) {
    this.attributeMap.delete(name);
    this.attributes = this.attributes.filter((attr) => attr.name !== name);
    if (name === "class") this.className = "";
  }

  addEventListener(type, callback, options = {}) {
    const list = this.eventListeners.get(type) || [];
    list.push({ callback, capture: Boolean(options === true || options?.capture) });
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
    const capturePath = [...path].reverse();
    for (const current of capturePath) {
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
    for (const node of this.walk()) {
      if (selectors.some((part) => matchesSimpleSelector(node, part))) matches.push(node);
    }
    return matches;
  }

  matches(selector) {
    return splitSelectorList(selector).some((part) => matchesSimpleSelector(this, part));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  *walk() {
    for (const child of this.childNodes) {
      if (child.nodeType === 1) {
        yield child;
        yield* child.walk();
      }
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
  }

  createElement(tagName) {
    return new FakeElement(tagName);
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
      list.push({ callback, capture: Boolean(options === true || options?.capture) });
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

function splitSelectorList(selector) {
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesSimpleSelector(node, selector) {
  if (!(node instanceof FakeElement)) return false;
  let rest = selector.trim();
  if (!rest) return false;

  const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagMatch) {
    if (node.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }

  for (const classMatch of rest.matchAll(/\.([\w-]+)/g)) {
    const classes = String(node.className || "").split(/\s+/).filter(Boolean);
    if (!classes.includes(classMatch[1])) return false;
  }

  for (const attrMatch of rest.matchAll(/\[([^\]=~*^$]+)([*]?=)?['"]?([^'"\]]*)['"]?\]/g)) {
    const name = attrMatch[1].trim();
    const operator = attrMatch[2] || "";
    const expected = attrMatch[3] || "";
    const value = node.getAttribute(name);
    if (operator === "") {
      if (value == null) return false;
    } else if (operator === "=") {
      if (value !== expected) return false;
    } else if (operator === "*=") {
      if (!String(value || "").includes(expected)) return false;
    }
  }

  if (!tagMatch && !rest.includes(".") && !rest.includes("[")) {
    return node.tagName.toLowerCase() === rest.toLowerCase();
  }

  return true;
}

function escapeCssIdentifier(value) {
  return String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
