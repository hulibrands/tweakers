const assert = require("node:assert/strict");
const test = require("node:test");

const tweak = require("../index.js").__test;

test("renderer inserts Profiles once and replaces stale content", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    panel.append(section("Environment", "cwd /repo"), section("Sources", "files"), section("Progress", "done"));
    document.body.appendChild(panel);

    const api = fakeApi("Work");
    assert.equal(await tweak.injectProfilesSection(document, api), 1);
    assert.equal(document.querySelectorAll(`[${tweak.SECTION_ATTR}="true"]`).length, 1);
    assert.match(panel.textContent, /Profiles/);
    assert.match(panel.textContent, /Work/);

    api.value = "Personal";
    assert.equal(await tweak.injectProfilesSection(document, api), 1);
    assert.equal(document.querySelectorAll(`[${tweak.SECTION_ATTR}="true"]`).length, 1);
    assert.doesNotMatch(panel.textContent, /Work/);
    assert.match(panel.textContent, /Personal/);
  } finally {
    restore();
  }
});

test("renderer removes stale Profiles sections outside the active summary card", async () => {
  const restore = installFakeDom();
  try {
    const outer = document.createElement("div");
    const panel = document.createElement("aside");
    panel.append(section("Environment", "cwd /repo"), section("Sources", "files"));
    const stale = document.createElement("section");
    stale.setAttribute(tweak.SECTION_ATTR, "true");
    stale.textContent = "Profiles";
    outer.append(panel, stale);
    document.body.appendChild(outer);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work")), 1);

    assert.equal(stale.parentElement, null);
    assert.equal(panel.querySelectorAll(`[${tweak.SECTION_ATTR}="true"]`).length, 1);
  } finally {
    restore();
  }
});

test("renderer creates a hidden empty state for no connected profiles", () => {
  const restore = installFakeDom();
  try {
    const sectionNode = tweak.createProfilesSection({ rows: [] });
    const empty = sectionNode.querySelector(".codexpp-thread-summary-profiles__empty");

    assert.equal(empty.hidden, true);
    assert.match(empty.textContent, /No profiles connected/);
  } finally {
    restore();
  }
});

test("renderer finds summary panels by visible stable headings", () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("div");
    panel.append(section("Environment", "cwd"), section("Sources", "files"), section("Progress", "done"));
    const unrelated = document.createElement("div");
    unrelated.textContent = "Settings Profiles Projects";
    document.body.append(panel, unrelated);

    const panels = tweak.findThreadSummaryPanels(document);

    assert.deepEqual(panels, [panel]);
  } finally {
    restore();
  }
});

test("renderer targets the inner summary card when the page also matches", () => {
  const restore = installFakeDom();
  try {
    const outer = document.createElement("div");
    const card = document.createElement("aside");
    card.append(section("Environment", "Changes"), section("Sources", "Context7"));
    outer.append(card, section("Progress", "done"));
    document.body.appendChild(outer);

    const panels = tweak.findThreadSummaryPanels(document);

    assert.deepEqual(panels, [card]);
  } finally {
    restore();
  }
});

test("renderer extracts visible cwd text when data attributes are missing", () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    panel.append(section("Environment", "cwd /Users/thomashulihan/Projects/TRR"), section("Sources", "Context7"));
    document.body.appendChild(panel);

    const context = tweak.inferRendererProjectContext(document, [panel]);

    assert.equal(context.projectPath, "/Users/thomashulihan/Projects/TRR");
  } finally {
    restore();
  }
});

test("renderer keeps unsafe actions non-actionable", () => {
  const restore = installFakeDom();
  try {
    const sectionNode = tweak.createProfilesSection({
      rows: [
        { id: "github", label: "GitHub", value: "repo", state: "set", action: { type: "external", target: "https://example.com/repo" } },
      ],
    });

    assert.equal(sectionNode.querySelectorAll("a").length, 0);
    assert.equal(sectionNode.querySelectorAll("button").length, 0);
  } finally {
    restore();
  }
});

function fakeApi(value) {
  const fake = {
    value,
    ipc: {
      invoke() {
        return Promise.resolve({
          rows: [
            { id: "chrome", label: "Chrome", value: fake.value, state: "set", status: "Assigned locally", action: { type: "settings", target: "projects" } },
            { id: "supabase", label: "Supabase", value: "No project", state: "unset", status: "Status unknown", action: { type: "file", target: ".codex/config.toml" } },
            { id: "github", label: "GitHub", value: "No repo detected", state: "unset", status: "Status unknown", action: { type: "settings", target: "projects" } },
            { id: "google-drive", label: "Google Drive", value: "Unset", state: "unset", status: "Status unknown", action: { type: "settings", target: "projects" } },
            { id: "gmail", label: "Gmail", value: "Unset", state: "unset", status: "Status unknown", action: { type: "settings", target: "projects" } },
            { id: "modal", label: "Modal", value: "Unset", state: "unset", status: "Status unknown", action: { type: "settings", target: "projects" } },
          ],
        });
      },
    },
    log: { warn() {} },
  };
  return fake;
}

function section(title, body) {
  const node = document.createElement("section");
  const heading = document.createElement("div");
  heading.textContent = title;
  const content = document.createElement("div");
  content.textContent = body;
  node.append(heading, content);
  return node;
}

function installFakeDom() {
  const previous = {
    document: global.document,
    HTMLElement: global.HTMLElement,
  };
  global.HTMLElement = FakeElement;
  global.document = new FakeDocument();
  return () => {
    global.document = previous.document;
    global.HTMLElement = previous.HTMLElement;
  };
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body");
    this.head = new FakeElement("head");
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById() {
    return null;
  }

  querySelector(selector) {
    return this.body.querySelector(selector) || this.head.querySelector(selector);
  }

  querySelectorAll(selector) {
    return [...this.body.querySelectorAll(selector), ...this.head.querySelectorAll(selector)];
  }
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this._className = "";
    this._textContent = "";
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || "");
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children.length = 0;
  }

  get parentNode() {
    return this.parentElement;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  insertBefore(node, reference) {
    node.parentElement = this;
    const index = this.children.indexOf(reference);
    if (index >= 0) this.children.splice(index, 0, node);
    else this.children.push(node);
    return node;
  }

  replaceWith(node) {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) {
      node.parentElement = this.parentElement;
      siblings.splice(index, 1, node);
      this.parentElement = null;
    }
  }

  remove() {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "href") this.href = String(value);
    if (name.startsWith("data-")) {
      this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      if (node.matches(selector)) results.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return results;
  }

  matches(selector) {
    return selector.split(",").map((part) => part.trim()).some((part) => {
      if (["aside", "section", "div", "a", "button"].includes(part)) return this.tagName.toLowerCase() === part;
      if (part.startsWith(".")) return this.className.split(/\s+/).includes(part.slice(1));
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attr) {
        const actual = this.getAttribute(attr[1]);
        return attr[2] == null ? actual != null : actual === attr[2];
      }
      return false;
    });
  }
}
