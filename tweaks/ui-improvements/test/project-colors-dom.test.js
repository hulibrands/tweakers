"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("DOM fixture marks sidebar project rows and applies bridge color changes", () => {
  const fixture = createProjectSidebarFixture();

  vm.runInNewContext(source, fixture.context, {
    filename: join(__dirname, "..", "index.js"),
  });

  fixture.context.module.exports.start(fixture.api);
  fixture.flushTimers();

  assert.equal(
    fixture.row.getAttribute("data-codexpp-sidebar-project-backgrounds"),
    "row",
  );
  assert.equal(
    fixture.list.getAttribute("data-codexpp-sidebar-project-backgrounds"),
    "project-list",
  );
  assert.equal(
    fixture.icon.getAttribute("data-codexpp-sidebar-project-backgrounds"),
    "icon",
  );
  assert.equal(
    fixture.title.getAttribute("data-codexpp-sidebar-project-backgrounds"),
    "title",
  );
  assert.equal(fixture.row.style.getPropertyValue("--codexpp-project-tint"), "#be123c");
  assert.equal(
    fixture.row.style.getPropertyValue("--codexpp-project-text-color"),
    "#be123c",
  );

  fixture.context.window.__codexppUiImprovements.setProjectColor("Alpha", "blue");
  fixture.flushTimers();

  assert.equal(fixture.storage.get("sidebar-project-backgrounds:colors").alpha, "blue");
  assert.equal(fixture.row.style.getPropertyValue("--codexpp-project-tint"), "#1d4ed8");
  assert.equal(
    fixture.row.style.getPropertyValue("--codexpp-project-text-color"),
    "#1d4ed8",
  );
});

function createProjectSidebarFixture() {
  const timers = [];
  const storage = new Map([
    ["sidebar-project-backgrounds:colors", { alpha: "rose" }],
  ]);
  const document = new FakeDocument();
  const window = createEventTarget({
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    },
  });

  const aside = document.createElement("aside");
  aside.className = "pointer-events-auto relative flex overflow-visible";
  aside.setRect({ left: 0, top: 0, width: 280, height: 760, right: 280, bottom: 760 });

  const list = document.createElement("div");
  const row = document.createElement("div");
  row.className = "group/cwd";
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-label", "Alpha");
  row.setRect({ left: 8, top: 40, width: 260, height: 32, right: 268, bottom: 72 });

  const button = document.createElement("button");
  button.setAttribute("role", "button");
  button.setAttribute("aria-label", "Alpha");
  button.setAttribute("data-app-action-sidebar-project-id", "/Users/thomashulihan/Projects/Alpha");
  button.setRect({ left: 12, top: 42, width: 236, height: 28, right: 248, bottom: 70 });

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setRect({ left: 16, top: 48, width: 16, height: 16, right: 32, bottom: 64 });

  const title = document.createElement("span");
  title.textContent = "Alpha";
  title.setRect({ left: 40, top: 46, width: 48, height: 18, right: 88, bottom: 64 });

  button.append(icon, title);
  row.appendChild(button);
  list.appendChild(row);
  aside.appendChild(list);
  document.body.appendChild(aside);

  const api = {
    process: "renderer",
    settings: {},
    log: {
      info() {},
      warn() {},
      error() {},
    },
    storage: {
      get(key, fallback) {
        if (key.startsWith("feature:")) {
          return key === "feature:sidebar-project-backgrounds";
        }
        if (storage.has(key)) return storage.get(key);
        return fallback;
      },
      set(key, value) {
        storage.set(key, value);
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
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeElement,
    MutationObserver: FakeMutationObserver,
    console,
    Date,
    Map,
    Set,
    WeakMap,
  };
  context.globalThis = context;

  return {
    api,
    context,
    icon,
    list,
    row,
    storage,
    title,
    flushTimers() {
      for (let index = 0; index < 20 && timers.length; index += 1) {
        const timer = timers.shift();
        timer();
      }
    },
  };
}

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

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

  set cssText(value) {
    this.values.set("cssText", String(value));
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
    this.element.className = this._classes().filter((className) => !remove.has(className)).join(" ");
  }

  _classes() {
    return String(this.element.className || "").split(/\s+/).filter(Boolean);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.style = new FakeStyle();
    this.dataset = {};
    this.isConnected = false;
    this._textContent = "";
    this._rect = { left: 0, top: 0, width: 1, height: 1, right: 1, bottom: 1 };
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    if (typeof node === "string") {
      const text = new FakeElement("#text");
      text.textContent = node;
      return this.appendChild(text);
    }
    node.parentElement = this;
    this.children.push(node);
    node.setConnected(this.isConnected);
    return node;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this.setConnected(false);
  }

  setConnected(value) {
    this.isConnected = value;
    this.children.forEach((child) => child.setConnected(value));
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  setRect(rect) {
    this._rect = { ...this._rect, ...rect };
  }

  getBoundingClientRect() {
    return this._rect;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
  }

  getAttribute(name) {
    if (name === "class") return this.className;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return name === "class" ? Boolean(this.className) : this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.className = "";
  }

  addEventListener() {}

  removeEventListener() {}

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const matches = [];
    for (const child of this._walk()) {
      if (selectors.some((part) => matchesSelector(child, part))) matches.push(child);
    }
    return matches;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector.split(",").some((part) => matchesSelector(node, part.trim()))) return node;
      node = node.parentElement;
    }
    return null;
  }

  *_walk() {
    for (const child of this.children) {
      yield child;
      yield* child._walk();
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

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return this.querySelectorAll(`[id="${id}"]`)[0] || null;
  }
}

function createEventTarget(base) {
  const listeners = new Map();
  return {
    ...base,
    addEventListener(type, callback) {
      const list = listeners.get(type) || [];
      list.push(callback);
      listeners.set(type, list);
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== callback));
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
      return true;
    },
  };
}

function matchesSelector(element, selector) {
  if (!selector) return false;
  if (selector.includes(":")) return false;
  const tag = selector.match(/^[a-zA-Z][\w-]*/)?.[0];
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;

  for (const className of selector.matchAll(/\.([^\.\[]+)/g)) {
    if (!element.classList.contains(className[1].replace(/\\/g, ""))) return false;
  }

  for (const attr of selector.matchAll(/\[([^\]\s~|^$*='"]+)([*^$]?=)?(?:"([^"]*)"|'([^']*)')?(?:\s+i)?\]/g)) {
    const [, name, operator, doubleQuoted, singleQuoted] = attr;
    const expected = doubleQuoted ?? singleQuoted;
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
