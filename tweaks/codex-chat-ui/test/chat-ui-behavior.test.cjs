const assert = require("node:assert/strict");
const test = require("node:test");

const tweak = require("../index.js").__test;

test("parseChatUiJson sanitizes unsafe text and ignores malformed payloads", () => {
  const payload = tweak.parseChatUiJson(JSON.stringify({
    codex_ui: true,
    version: 1,
    blocks: [
      {
        kind: "summary_card",
        props: {
          title: "<script>alert(1)</script> Ready",
          subtitle: "javascript:alert(1)",
          onClick: "evil()",
          actions: [
            {
              type: "send_message",
              label: "Continue",
              prompt: "javascript:run the next fix",
            },
          ],
        },
      },
    ],
  }));

  assert.equal(payload.blocks[0].props.title, "Ready");
  assert.equal(payload.blocks[0].props.subtitle, "alert(1)");
  assert.equal(payload.blocks[0].props.onClick, undefined);
  assert.equal(payload.blocks[0].props.actions[0].prompt, "run the next fix");
  assert.equal(tweak.parseChatUiJson("{ nope"), null);
});

test("scanMessages renders chat UI, hides source, and action clicks insert safe composer text", () => {
  const restore = installFakeDom();
  try {
    const textarea = document.createElement("textarea");
    const message = assistantMessage({
      codex_ui: true,
      version: 1,
      blocks: [
        {
          kind: "summary_card",
          props: {
            title: "Patch ready",
            actions: [
              {
                type: "send_message",
                label: "Apply",
                prompt: "javascript:Apply the safe patch",
              },
            ],
          },
        },
      ],
    });
    document.body.append(textarea, message);

    tweak.scanMessages({
      enabled: true,
      showFallbacks: true,
      clickableActions: true,
      blockKinds: { summary_card: true },
    });

    const panel = message.querySelector(`[${tweak.PANEL_ATTR}]`);
    const hidden = message.querySelector(`[${tweak.HIDDEN_ATTR}]`);
    assert.ok(panel);
    assert.ok(hidden);
    assert.equal(hidden.hidden, true);
    assert.match(panel.textContent, /Patch ready/);

    const button = panel.querySelector("button");
    assert.ok(button);
    button.click();
    assert.equal(textarea.value, "Apply the safe patch");
    assert.equal(textarea.focused, true);
  } finally {
    restore();
  }
});

test("action clicks target the active composer instead of an earlier settings textarea", () => {
  const restore = installFakeDom();
  try {
    const settingsTextarea = document.createElement("textarea");
    settingsTextarea.value = "settings";
    const composer = document.createElement("textarea");
    composer.value = "Start: ";
    composer.selectionStart = composer.value.length;
    composer.selectionEnd = composer.value.length;
    document.activeElement = composer;
    const message = assistantMessage({
      codex_ui: true,
      version: 1,
      blocks: [
        {
          kind: "summary_card",
          props: {
            title: "Patch ready",
            actions: [
              {
                type: "send_message",
                label: "Apply",
                prompt: "Apply the safe patch",
              },
            ],
          },
        },
      ],
    });
    document.body.append(settingsTextarea, composer, message);

    tweak.scanMessages({
      enabled: true,
      showFallbacks: true,
      clickableActions: true,
      blockKinds: { summary_card: true },
    });

    message.querySelector("button").click();
    assert.equal(settingsTextarea.value, "settings");
    assert.equal(composer.value, "Start: Apply the safe patch");
  } finally {
    restore();
  }
});

test("file previews render typed file and status icons with list semantics", () => {
  const restore = installFakeDom();
  const previousFetch = global.fetch;
  const fetchCalls = [];
  global.fetch = (...args) => {
    fetchCalls.push(args);
    return Promise.resolve({ ok: true });
  };
  try {
    const message = assistantMessage({
      codex_ui: true,
      version: 1,
      blocks: [
        {
          kind: "file_preview",
          props: {
            files: [
              {
                name: "src",
                kind: "directory",
                children: [
                  { path: "src/index.ts", status: "done" },
                  { path: "README.md", status: "warning" },
                  { path: "/Users/thomashulihan/Projects/shadgpt/package.json", status: "ready" },
                ],
              },
            ],
          },
        },
      ],
    });
    document.body.append(message);

    tweak.scanMessages({
      enabled: true,
      showFallbacks: true,
      clickableActions: true,
      blockKinds: { file_preview: true },
    });

    const list = message.querySelector(".codexpp-chat-ui-file-tree");
    assert.ok(list);
    assert.equal(list.getAttribute("role"), "list");
    assert.equal(message.querySelectorAll(".codexpp-chat-ui-file-row-wrap")[0].getAttribute("role"), "listitem");
    assert.equal(message.querySelectorAll(".codexpp-chat-ui-file-icon")[0].textContent, "DIR");
    assert.equal(message.querySelectorAll(".codexpp-chat-ui-file-icon")[1].textContent, "TS");
    assert.match(message.querySelectorAll(".codexpp-chat-ui-file-icon")[1].className, /codexpp-chat-ui-file-ext-ts/);
    assert.match(message.querySelectorAll(".codexpp-chat-ui-file-icon")[2].className, /codexpp-chat-ui-file-ext-md/);
    assert.match(message.querySelectorAll(".codexpp-chat-ui-file-icon")[3].className, /codexpp-chat-ui-file-ext-json/);
    assert.equal(message.querySelectorAll(".codexpp-chat-ui-file-status-icon")[0].textContent, "OK");
    assert.equal(message.querySelectorAll(".codexpp-chat-ui-file-status-icon")[1].textContent, "!");
    assert.match(message.textContent, /Copy only/);
    assert.match(message.textContent, /untrusted relative path/);

    const rows = message.querySelectorAll(".codexpp-chat-ui-file-row-clickable");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].getAttribute("role"), "button");
    assert.equal(rows[0].getAttribute("tabindex"), "0");
    rows[0].click();
    assert.equal(fetchCalls[0][0], "vscode://codex/open-file");
    assert.deepEqual(JSON.parse(fetchCalls[0][1].body), {
      path: "/Users/thomashulihan/Projects/shadgpt/package.json",
      openMode: "workspace",
    });
  } finally {
    global.fetch = previousFetch;
    restore();
  }
});

test("file preview path validation rejects unsafe relative paths unless a trusted root resolves them", () => {
  assert.deepEqual(tweak.validateLocalFilePath("src/index.ts").canOpen, false);
  assert.equal(
    tweak.validateLocalFilePath("src/index.ts", {
      trustedWorkspaceRoots: ["/Users/thomashulihan/Projects/shadgpt"],
    }).openPath,
    "/Users/thomashulihan/Projects/shadgpt/src/index.ts",
  );
  assert.equal(
    tweak.validateLocalFilePath("../outside.txt", {
      trustedWorkspaceRoots: ["/Users/thomashulihan/Projects/shadgpt"],
    }).canOpen,
    false,
  );
  assert.equal(
    tweak.validateLocalFilePath("file:///Users/thomashulihan/Projects/shadgpt/README.md").openPath,
    "/Users/thomashulihan/Projects/shadgpt/README.md",
  );
  assert.equal(tweak.validateLocalFilePath("/Users/thomashulihan/../../etc/passwd").canOpen, false);
  assert.equal(tweak.validateLocalFilePath("file://example.com/Users/thomashulihan/README.md").canOpen, false);
});

test("file preview rows show visible failed-open state when the bridge rejects", async () => {
  const restore = installFakeDom();
  const previousFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error("bridge unavailable"));
  try {
    const message = assistantMessage({
      codex_ui: true,
      version: 1,
      blocks: [
        {
          kind: "file_preview",
          props: {
            files: [{ path: "/Users/thomashulihan/Projects/shadgpt/README.md" }],
          },
        },
      ],
    });
    document.body.append(message);

    tweak.scanMessages({
      enabled: true,
      showFallbacks: true,
      clickableActions: true,
      blockKinds: { file_preview: true },
      api: { log: { warn: () => {} } },
    });

    const row = message.querySelector(".codexpp-chat-ui-file-row-clickable");
    assert.ok(row);
    row.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.match(row.textContent, /Open failed/);
  } finally {
    global.fetch = previousFetch;
    restore();
  }
});

test("scanMessages renders mentioned local file links as openable preview rows", () => {
  const restore = installFakeDom();
  const previousFetch = global.fetch;
  const fetchCalls = [];
  global.fetch = (...args) => {
    fetchCalls.push(args);
    return Promise.resolve({ ok: true });
  };
  try {
    const message = document.createElement("div");
    message.className = "group flex min-w-0 flex-col";
    const markdown = document.createElement("div");
    markdown.className = "_markdownContent_1rhk1_42";

    const readme = document.createElement("a");
    readme.setAttribute("href", "/Users/thomashulihan/Projects/shadgpt/README.md");
    readme.textContent = "README.md";
    const csv = document.createElement("a");
    csv.setAttribute("href", "file:///Users/thomashulihan/Projects/shadgpt/schedule-input.csv");
    csv.textContent = "schedule-input.csv";
    markdown.append(readme, csv);
    message.appendChild(markdown);
    document.body.append(message);

    tweak.scanMessages({
      enabled: true,
      showFallbacks: true,
      clickableActions: true,
      blockKinds: {},
    });

    const panel = message.querySelector("[data-codexpp-chat-ui-mentioned-files]");
    assert.ok(panel);
    assert.equal(message.children[0], panel);
    assert.match(panel.textContent, /README\.md/);
    assert.match(panel.textContent, /Document · MD/);
    assert.match(panel.textContent, /schedule-input\.csv/);
    assert.match(panel.textContent, /Spreadsheet · CSV/);

    const rows = panel.querySelectorAll(".codexpp-chat-ui-mentioned-file-row");
    assert.equal(rows.length, 2);
    rows[0].click();
    assert.equal(fetchCalls[0][0], "vscode://codex/open-file");
    assert.deepEqual(JSON.parse(fetchCalls[0][1].body), {
      path: "/Users/thomashulihan/Projects/shadgpt/README.md",
      openMode: "workspace",
    });
  } finally {
    global.fetch = previousFetch;
    restore();
  }
});

function assistantMessage(payload) {
  const message = document.createElement("div");
  message.className = "group flex min-w-0 flex-col";
  const markdown = document.createElement("div");
  markdown.className = "_markdownContent_1rhk1_42";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = JSON.stringify(payload);
  pre.appendChild(code);
  markdown.appendChild(pre);
  message.appendChild(markdown);
  return message;
}

function installFakeDom() {
  const previous = {
    document: global.document,
    HTMLElement: global.HTMLElement,
    HTMLButtonElement: global.HTMLButtonElement,
    HTMLTextAreaElement: global.HTMLTextAreaElement,
    HTMLDetailsElement: global.HTMLDetailsElement,
    InputEvent: global.InputEvent,
    navigator: global.navigator,
  };
  global.HTMLElement = FakeElement;
  global.HTMLButtonElement = FakeButton;
  global.HTMLTextAreaElement = FakeTextarea;
  global.HTMLDetailsElement = FakeElement;
  global.InputEvent = class InputEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: () => Promise.resolve() } },
  });
  global.document = new FakeDocument();
  return () => {
    global.document = previous.document;
    global.HTMLElement = previous.HTMLElement;
    global.HTMLButtonElement = previous.HTMLButtonElement;
    global.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    global.HTMLDetailsElement = previous.HTMLDetailsElement;
    global.InputEvent = previous.InputEvent;
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: previous.navigator,
    });
  };
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body");
    this.activeElement = null;
  }

  createElement(tagName) {
    if (tagName === "button") return new FakeButton(tagName);
    if (tagName === "textarea") return new FakeTextarea(tagName);
    return new FakeElement(tagName);
  }

  getElementById() {
    return null;
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    this._className = "";
    this._textContent = "";
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = value;
      },
      removeProperty: (name) => {
        delete this.style[name];
      },
    };
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

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  insertBefore(node, referenceNode) {
    const index = this.children.indexOf(referenceNode);
    node.parentElement = this;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }

  focus() {
    this.focused = true;
    global.document.activeElement = this;
  }

  click() {
    this.dispatchEvent({ type: "click" });
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

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  matches(selector) {
    return selector.split(",").map((part) => part.trim()).some((part) => {
      if (part === "pre" || part === "code" || part === "button" || part === "textarea" || part === "a") return this.tagName.toLowerCase() === part;
      if (part === "div.group.flex.min-w-0.flex-col") return this.tagName === "DIV" && hasClasses(this, ["group", "flex", "min-w-0", "flex-col"]);
      if (part.startsWith("._markdownContent_")) return this.className.split(/\s+/).some((item) => item.startsWith("_markdownContent_"));
      if (part === "[class*='_markdownContent_']") return this.className.includes("_markdownContent_");
      if (part === '[contenteditable="true"]') return this.getAttribute("contenteditable") === "true";
      const attr = part.match(/^\[([^\]]+)\]$/)?.[1];
      if (attr) return this.hasAttribute(attr);
      const className = part.match(/^\.([\w-]+)$/)?.[1];
      if (className) return hasClasses(this, [className]);
      return false;
    });
  }
}

class FakeButton extends FakeElement {}

class FakeTextarea extends FakeElement {
  constructor(tagName) {
    super(tagName);
    this.value = "";
  }
}

function hasClasses(node, classNames) {
  const current = new Set(String(node.className || "").split(/\s+/).filter(Boolean));
  return classNames.every((className) => current.has(className));
}
