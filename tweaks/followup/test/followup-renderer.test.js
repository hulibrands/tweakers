const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("follow-up row click preserves draft text and prefers the likely composer", () => {
  const fixture = createFixture();
  runInstrumentedTweak(fixture);

  const settingsTextarea = fixture.document.createElement("textarea");
  settingsTextarea.value = "Settings draft";
  fixture.document.body.appendChild(settingsTextarea);

  const composer = fixture.document.createElement("div");
  composer.setAttribute("data-testid", "composer");
  const input = fixture.document.createElement("textarea");
  input.setAttribute("aria-label", "Message Codex");
  input.value = "Existing draft";
  composer.appendChild(input);
  fixture.document.body.appendChild(composer);

  const panel = fixture.context.module.exports.__test.renderRadarPanel({
    title: "Follow-up",
    items: [{ prompt: "Improve the follow-up wording", achieves: [] }],
    showDivider: false,
    clickableItems: true,
    pending: false,
  });
  fixture.document.body.appendChild(panel);

  panel.querySelector("button").dispatchEvent(new fixture.context.MouseEvent("click", { bubbles: true }));

  assert.equal(settingsTextarea.value, "Settings draft");
  assert.equal(input.value, "Existing draft\n\nImprove the follow-up wording");
});

test("follow-up row click inserts at the active textarea selection", () => {
  const fixture = createFixture();
  runInstrumentedTweak(fixture);

  const input = fixture.document.createElement("textarea");
  input.setAttribute("aria-label", "Message Codex");
  input.value = "Draft old text";
  input.selectionStart = 6;
  input.selectionEnd = 9;
  fixture.document.body.appendChild(input);

  const panel = fixture.context.module.exports.__test.renderRadarPanel({
    title: "Follow-up",
    items: [{ prompt: "new", achieves: [] }],
    showDivider: false,
    clickableItems: true,
    pending: false,
  });
  fixture.document.body.appendChild(panel);

  panel.querySelector("button").dispatchEvent(new fixture.context.MouseEvent("click", { bubbles: true }));

  assert.equal(input.value, "Draft new text");
  assert.equal(input.selectionStart, "Draft new".length);
  assert.equal(input.selectionEnd, "Draft new".length);
});

test("stop cancels the pending startup AGENTS sync", () => {
  const fixture = createFixture();
  runTweak(fixture);

  fixture.context.module.exports.start(fixture.api);

  assert.equal(fixture.timeouts.size, 1);
  assert.equal(fixture.invokeCount(), 0);

  fixture.context.module.exports.stop();
  fixture.flushTimeouts();

  assert.equal(fixture.clearedTimeouts.length, 1);
  assert.equal(fixture.invokeCount(), 0);
});

function runTweak(fixture) {
  vm.runInNewContext(source, fixture.context, {
    filename: join(__dirname, "..", "index.js"),
  });
}

function runInstrumentedTweak(fixture) {
  vm.runInNewContext(
    `${source}\nmodule.exports.__test = { renderRadarPanel, insertIntoComposer };`,
    fixture.context,
    { filename: join(__dirname, "..", "index.js") },
  );
}

function createFixture() {
  const document = new FakeDocument();
  const timeouts = new Map();
  const intervals = new Map();
  const clearedTimeouts = [];
  let nextTimerId = 1;
  let invokeCount = 0;

  const window = createEventTarget({
    document,
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timeouts.set(id, { callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      clearedTimeouts.push(id);
      const timer = timeouts.get(id);
      if (timer) timer.cleared = true;
    },
    setInterval(callback, delay = 0) {
      const id = nextTimerId++;
      intervals.set(id, { callback, delay, cleared: false });
      return id;
    },
    clearInterval(id) {
      const timer = intervals.get(id);
      if (timer) timer.cleared = true;
    },
  });
  document.defaultView = window;

  const api = {
    process: "renderer",
    settings: {
      registerPage() {
        return { unregister() {} };
      },
    },
    storage: {
      get(_key, fallback) {
        return fallback;
      },
      set() {},
    },
    ipc: {
      invoke() {
        invokeCount += 1;
        return Promise.resolve({ ok: true, action: "unchanged" });
      },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
  };

  const context = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    document,
    window,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Event: FakeEvent,
    InputEvent: FakeInputEvent,
    MouseEvent: FakeMouseEvent,
    HTMLElement: FakeElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame(callback) {
      this._raf = callback;
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    Promise,
    Array,
    Date,
    Map,
    Set,
    String,
    RegExp,
    Object,
  };
  context.globalThis = context;

  return {
    api,
    context,
    document,
    timeouts,
    clearedTimeouts,
    flushTimeouts() {
      for (const [id, timer] of Array.from(timeouts)) {
        timeouts.delete(id);
        if (!timer.cleared) timer.callback();
      }
    },
    invokeCount() {
      return invokeCount;
    },
  };
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? true;
    this.target = null;
    this.currentTarget = null;
  }
}

class FakeInputEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.inputType = init.inputType || "";
    this.data = init.data || null;
  }
}

class FakeMouseEvent extends FakeEvent {}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.connected = false;
  }

  observe(target, options) {
    this.target = target;
    this.options = options;
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  contains(className) {
    return this.element.className.split(/\s+/).includes(className);
  }

  add(...classNames) {
    const next = new Set(this.element.className.split(/\s+/).filter(Boolean));
    classNames.forEach((className) => next.add(className));
    this.element.className = Array.from(next).join(" ");
  }

  toggle(className, force) {
    const hasClass = this.contains(className);
    if (force === true || (!hasClass && force !== false)) {
      this.add(className);
      return true;
    }
    if (hasClass && force !== true) {
      this.element.className = this.element.className
        .split(/\s+/)
        .filter((value) => value && value !== className)
        .join(" ");
    }
    return false;
  }
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = value;
  }

  removeProperty(name) {
    delete this[name];
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text || "");
    this.parentElement = null;
  }

  contains(node) {
    return node === this;
  }
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.style = new FakeStyle();
    this.hidden = false;
    this._textContent = "";
    this.innerText = "";
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

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    const child = typeof node === "string" ? new FakeTextNode(node) : node;
    child.parentElement = this;
    this.childNodes.push(child);
    if (child.nodeType === 1) this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement.childNodes = this.parentElement.childNodes.filter((child) => child !== this);
    this.parentElement = null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") this.className = stringValue;
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) {
      this.dataset[name.slice(5).replace(/-([a-z])/g, (_match, char) => char.toUpperCase())] = stringValue;
    }
  }

  getAttribute(name) {
    if (name === "class") return this.className || null;
    if (name === "hidden") return this.hidden ? "" : null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, callback) {
    const list = this.eventListeners.get(type) || [];
    list.push(callback);
    this.eventListeners.set(type, list);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const callback of this.eventListeners.get(event.type) || []) callback(event);
    return true;
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child.contains?.(node));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = splitSelectorList(selector);
    const results = [];
    for (const node of walk(this)) {
      if (node.nodeType === 1 && selectors.some((part) => matchesComplexSelector(node, part))) {
        results.push(node);
      }
    }
    return results;
  }

  matches(selector) {
    return splitSelectorList(selector).some((part) => matchesComplexSelector(this, part));
  }
}

class FakeTextAreaElement extends FakeElement {
  constructor() {
    super("textarea");
    this.value = "";
    this.disabled = false;
    this.readOnly = false;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document");
    this.ownerDocument = this;
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.activeElement = null;
    this.documentElement.append(this.head, this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName) {
    const element = String(tagName).toLowerCase() === "textarea"
      ? new FakeTextAreaElement()
      : new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createTextNode(text) {
    const node = new FakeTextNode(text);
    node.ownerDocument = this;
    return node;
  }

  getElementById(id) {
    return this.querySelectorAll(`#${id}`).find((node) => node.id === id) || null;
  }

  addEventListener() {}

  removeEventListener() {}
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
  };
}

function* walk(root) {
  for (const child of root.childNodes || []) {
    yield child;
    if (child.nodeType === 1) yield* walk(child);
  }
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
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
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

function matchesComplexSelector(element, selector) {
  const parts = splitSelectorParts(selector);
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

function splitSelectorParts(selector) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (const char of String(selector || "").trim()) {
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
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
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

function matchesSimpleSelector(element, selector) {
  const tag = selector.match(/^[a-zA-Z][\w-]*/)?.[0];
  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;

  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;

  for (const className of selector.matchAll(/\.([^\.\[#]+)/g)) {
    if (!element.classList.contains(className[1])) return false;
  }

  for (const attr of selector.matchAll(/\[([^\]\s~|^$*='"]+)([*^$]?=)?(?:"([^"]*)"|'([^']*)'|([^\]\s]+))?(?:\s+i)?\]/g)) {
    const [, name, operator, doubleQuoted, singleQuoted, bare] = attr;
    const expected = doubleQuoted ?? singleQuoted ?? bare;
    const actual = element.getAttribute(name);
    if (!operator && actual === null) return false;
    if (operator === "=" && actual !== expected) return false;
    if (operator === "*=" && !actual?.toLowerCase().includes(String(expected).toLowerCase())) return false;
  }

  return true;
}
