const assert = require("node:assert/strict");
const test = require("node:test");

const threadSummaryProfiles = require("../index.js");
const tweak = threadSummaryProfiles.__test;

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
    assert.match(panel.querySelector("[data-profile-row=\"chrome\"]")?.getAttribute("aria-label") || panel.textContent, /Work/);

    api.value = "Personal";
    assert.equal(await tweak.injectProfilesSection(document, api), 1);
    assert.equal(document.querySelectorAll(`[${tweak.SECTION_ATTR}="true"]`).length, 1);
    assert.doesNotMatch(panel.querySelector("[data-profile-row=\"chrome\"]")?.getAttribute("aria-label") || panel.textContent, /Work/);
    assert.match(panel.querySelector("[data-profile-row=\"chrome\"]")?.getAttribute("aria-label") || panel.textContent, /Personal/);
  } finally {
    restore();
  }
});

test("renderer keeps the existing Profiles node when content is unchanged", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    panel.append(section("Environment", "cwd /repo"), section("Sources", "files"), section("Progress", "done"));
    document.body.appendChild(panel);

    const api = fakeApi("Work");
    assert.equal(await tweak.injectProfilesSection(document, api), 1);
    const first = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);

    assert.equal(await tweak.injectProfilesSection(document, api), 1);
    assert.equal(panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`), first);

    api.value = "Personal";
    assert.equal(await tweak.injectProfilesSection(document, api), 1);
    assert.notEqual(panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`), first);
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

test("renderer keeps a static Profiles section visible when no profile rows resolve", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    const sources = staticSourcesSection();
    panel.append(section("Environment", "Changes"), sources);
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work", { rows: [] })), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    assert.equal(profiles.parentElement, panel);
    assert.equal(profiles.children[0].textContent, "Profiles");
    assert.equal(profiles.querySelectorAll(".codexpp-thread-summary-profiles__static-icon").length, 0);
  } finally {
    restore();
  }
});

test("renderer formats Profiles as an open disclosure section", () => {
  const restore = installFakeDom();
  try {
    const sectionNode = tweak.createProfilesSection({
      rows: [
        { id: "chrome", label: "Chrome", value: "Work", state: "set", status: "Assigned locally" },
      ],
    });

    const details = sectionNode.querySelector("details");
    const summary = sectionNode.querySelector("summary");
    const title = sectionNode.querySelector(".codexpp-thread-summary-profiles__title");
    const chevron = sectionNode.querySelector(".codexpp-thread-summary-profiles__chevron");

    assert.equal(details.open, true);
    assert.equal(summary.parentElement, details);
    assert.equal(title.textContent, "Profiles");
    assert.equal(chevron.getAttribute("aria-hidden"), "true");
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

test("renderer scopes mutation observers to summary panel roots", () => {
  const restore = installFakeDom();
  const previous = {
    MutationObserver: global.MutationObserver,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
  };
  const observed = [];
  try {
    global.MutationObserver = class FakeMutationObserver {
      constructor(callback) {
        this.callback = callback;
      }

      observe(target, options) {
        observed.push({ target, options });
      }

      disconnect() {}
    };
    global.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    global.cancelAnimationFrame = () => {};

    const panel = document.createElement("aside");
    panel.append(section("Environment", "cwd /repo"), section("Sources", "files"), section("Progress", "done"));
    document.body.appendChild(panel);

    const api = fakeApi("Work");
    api.process = "renderer";
    threadSummaryProfiles.start(api);

    assert.equal(observed.some((entry) => entry.target === document.body && entry.options.subtree === true), false);
    assert.equal(observed.some((entry) => entry.target === document.body && entry.options.subtree === false), true);
    assert.equal(observed.some((entry) => entry.target === panel && entry.options.subtree === true), true);
  } finally {
    threadSummaryProfiles.stop();
    global.MutationObserver = previous.MutationObserver;
    global.requestAnimationFrame = previous.requestAnimationFrame;
    global.cancelAnimationFrame = previous.cancelAnimationFrame;
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

test("renderer builds Profiles from the native side-panel accordion template", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    const progress = nativeAccordion("Progress", "done");
    panel.append(section("Environment", "cwd /repo"), progress, section("Sources", "files"));
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work")), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    const trigger = profiles.querySelector("button");
    const body = profiles.querySelector(".codexpp-thread-summary-profiles__content");

    assert.match(profiles.className, /native-section/);
    assert.match(profiles.className, /codexpp-thread-summary-profiles--native/);
    assert.match(trigger.className, /native-trigger/);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(body.hidden, false);
    assert.match(trigger.textContent, /Profiles/);
    assert.doesNotMatch(trigger.textContent, /Progress/);

    trigger.click();

    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(body.hidden, true);
  } finally {
    restore();
  }
});

test("renderer uses native item rows and native icon slots for Profiles", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    const progress = nativeAccordion("Progress", "done", { rowTemplate: true });
    panel.append(section("Environment", "cwd /repo"), progress, section("Sources", "files"));
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work")), 1);

    const row = panel.querySelector("[data-profile-row=\"chrome\"]");
    const icon = row.querySelector(".codexpp-thread-summary-profiles__native-icon");

    assert.equal(row.tagName, "BUTTON");
    assert.match(row.className, /native-row/);
    assert.match(row.className, /codexpp-thread-summary-profiles__row--native/);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.match(icon.className, /native-icon/);
    assert.equal(row.querySelector(".codexpp-thread-summary-profiles__native-text").textContent, "Chrome Work");
    assert.equal(icon.querySelector("svg")?.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(icon.querySelector("svg")?.getAttribute("stroke"), "currentColor");
    assert.doesNotMatch(icon.className, /icon-chrome/);
    assert.equal(row.querySelector(".codexpp-thread-summary-profiles__icon"), null);
    assert.equal(row.querySelector(".codexpp-thread-summary-profiles__body"), null);
  } finally {
    restore();
  }
});

test("renderer inserts Profiles after the owning Sources section, not inside a nested Sources row", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    const environment = nativeAccordion("Environment", "done", { rowTemplate: true });
    const sourcesGroup = document.createElement("div");
    sourcesGroup.className = "native-sources-row";
    sourcesGroup.appendChild(section("Sources", "files"));
    panel.append(environment, sourcesGroup);
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work")), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    assert.equal(profiles.parentElement, panel);
    assert.equal(panel.children.indexOf(profiles), panel.children.indexOf(sourcesGroup) + 1);
    assert.equal(sourcesGroup.querySelector(`[${tweak.SECTION_ATTR}="true"]`), null);
  } finally {
    restore();
  }
});

test("renderer clones static Sources-style section when no accordion template exists", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    const environment = section("Environment", "Changes");
    const sources = staticSourcesSection();
    panel.append(environment, sources);
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work", {
      rows: [
        { id: "chrome", label: "Chrome", value: "Work", state: "set", status: "Assigned locally", action: { type: "settings", target: "projects" } },
        { id: "github", label: "GitHub", value: "hulibrands/ShadGPT", state: "set", status: "Remote detected", action: { type: "external", target: "https://github.com/hulibrands/ShadGPT" } },
      ],
    })), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);

    assert.equal(profiles.parentElement, panel);
    assert.equal(panel.children.indexOf(profiles), panel.children.indexOf(sources) + 1);
    assert.match(profiles.className, /native-static-section/);
    assert.match(profiles.className, /codexpp-thread-summary-profiles--static/);
    assert.equal(profiles.children[0].textContent, "Profiles");
    assert.equal(profiles.querySelectorAll(".codexpp-thread-summary-profiles__static-icon").length, 2);
    assert.equal(profiles.querySelector("[data-profile-row=\"chrome\"]")?.querySelector("svg")?.getAttribute("stroke"), "currentColor");
  } finally {
    restore();
  }
});

test("renderer preserves nested static Sources structure and computed section styles", async () => {
  const restore = installFakeDom();
  const previousGetComputedStyle = global.getComputedStyle;
  try {
    global.getComputedStyle = (node) => ({
      display: node.className.includes("native-static-content") ? "flex" : "block",
      boxSizing: "border-box",
      width: "100%",
      maxWidth: "none",
      minWidth: "0px",
      gridColumn: "auto",
      flex: "0 1 auto",
      flexBasis: "auto",
      padding: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
      margin: node.className.includes("native-static-heading") ? "0px 0px 8px" : "0px",
      marginTop: "0px",
      marginRight: "0px",
      marginBottom: node.className.includes("native-static-heading") ? "8px" : "0px",
      marginLeft: "0px",
      border: "0px none currentcolor",
      borderTop: "0px none currentcolor",
      borderRight: "0px none currentcolor",
      borderBottom: "0px none currentcolor",
      borderLeft: "0px none currentcolor",
      color: node.className.includes("native-static-heading") ? "rgb(96, 96, 96)" : "rgb(0, 0, 0)",
      font: "16px system-ui",
      fontFamily: "system-ui",
      fontSize: "16px",
      fontWeight: node.className.includes("native-static-heading") ? "400" : "500",
      fontStyle: "normal",
      lineHeight: "24px",
      letterSpacing: "normal",
      textTransform: "none",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: "10px",
      columnGap: "10px",
      rowGap: "10px",
      height: "16px",
      minHeight: "0px",
      maxHeight: "none",
    });
    const panel = document.createElement("aside");
    const sources = nestedStaticSourcesSection();
    panel.append(section("Environment", "Changes"), sources);
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work", {
      rows: [
        { id: "chrome", label: "Chrome", value: "Work", state: "set", status: "Assigned locally" },
      ],
    })), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    const title = profiles.querySelector(".native-static-heading");
    const content = profiles.querySelector(".native-static-content");

    assert.equal(profiles.querySelector(".native-static-inner") !== null, true);
    assert.equal(title.textContent, "Profiles");
    assert.equal(content.textContent, "");
    assert.equal(content.querySelectorAll(".codexpp-thread-summary-profiles__static-icon").length, 1);
    assert.equal(title.style.color, "rgb(96, 96, 96)");
    assert.equal(title.style.marginBottom, "8px");
  } finally {
    global.getComputedStyle = previousGetComputedStyle;
    restore();
  }
});

test("renderer renders compact native summary while Profiles is collapsed", async () => {
  const restore = installFakeDom();
  try {
    const storage = fakeStorage({ [tweak.OPEN_STATE_KEY]: false });
    const panel = document.createElement("aside");
    const progress = nativeAccordion("Progress", "done", { rowTemplate: true });
    panel.append(section("Environment", "cwd /repo"), progress, section("Sources", "files"));
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work", {
      storage,
      rows: [
        { id: "chrome", label: "Chrome", value: "Work", state: "set", status: "Assigned locally", action: { type: "settings", target: "projects" } },
        { id: "github", label: "GitHub", value: "hulibrands/ShadGPT", state: "set", status: "Remote detected", action: { type: "external", target: "https://github.com/hulibrands/ShadGPT" } },
      ],
    })), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    const trigger = profiles.querySelector("button");
    const body = profiles.querySelector(".codexpp-thread-summary-profiles__content");
    const compact = profiles.querySelector(".codexpp-thread-summary-profiles__collapsed-summary");

    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(body.hidden, true);
    assert.equal(compact.hidden, false);
    assert.equal(compact.textContent, "Chrome, GitHub");

    trigger.click();

    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(body.hidden, false);
    assert.equal(compact.hidden, true);
  } finally {
    restore();
  }
});

test("renderer persists Profiles native accordion open state", async () => {
  const restore = installFakeDom();
  try {
    const storage = fakeStorage({ [tweak.OPEN_STATE_KEY]: false });
    const panel = document.createElement("aside");
    const progress = nativeAccordion("Progress", "done", { rowTemplate: true });
    panel.append(section("Environment", "cwd /repo"), progress, section("Sources", "files"));
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work", { storage })), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    const trigger = profiles.querySelector("button");
    const body = profiles.querySelector(".codexpp-thread-summary-profiles__content");

    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(body.hidden, true);

    trigger.click();

    assert.equal(storage.values.get(tweak.OPEN_STATE_KEY), true);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");

    trigger.click();

    assert.equal(storage.values.get(tweak.OPEN_STATE_KEY), false);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
  } finally {
    restore();
  }
});

test("renderer ignores static sections and does not copy sibling-only controls", async () => {
  const restore = installFakeDom();
  try {
    const panel = document.createElement("aside");
    const environment = nativeAccordion("Environment", "cwd /repo", { controls: true });
    panel.append(environment, section("Sources", "No sources yet"));
    document.body.appendChild(panel);

    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work")), 1);

    const profiles = panel.querySelector(`[${tweak.SECTION_ATTR}="true"]`);
    const trigger = profiles.querySelector("button");

    assert.match(profiles.className, /native-section/);
    assert.match(trigger.className, /native-trigger/);
    assert.match(trigger.textContent, /Profiles/);
    assert.match(trigger.textContent, />/);
    assert.doesNotMatch(trigger.textContent, /Environment/);
    assert.doesNotMatch(trigger.textContent, /\+21,288|-1,496|gear/);
  } finally {
    restore();
  }
});

test("renderer never targets editable composer surfaces", async () => {
  const restore = installFakeDom();
  try {
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    composer.append(section("Environment", "cwd /repo"), section("Sources", "files"), section("Progress", "done"));
    document.body.appendChild(composer);

    assert.deepEqual(tweak.findThreadSummaryPanels(document), []);
    assert.equal(await tweak.injectProfilesSection(document, fakeApi("Work")), 0);
    assert.equal(composer.querySelector(`[${tweak.SECTION_ATTR}="true"]`), null);
  } finally {
    restore();
  }
});

test("renderer ignores page wrappers with a composer and still targets the summary card", () => {
  const restore = installFakeDom();
  try {
    const outer = document.createElement("div");
    const card = document.createElement("aside");
    card.append(section("Environment", "Changes"), section("Sources", "Context7"));
    const composer = document.createElement("div");
    composer.setAttribute("role", "textbox");
    outer.append(card, section("Progress", "done"), composer);
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

function fakeApi(value, options = {}) {
  const fake = {
    value,
    storage: options.storage || fakeStorage(),
    ipc: {
      invoke() {
        return Promise.resolve({
          rows: options.rows || [
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

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    set(key, value) {
      values.set(key, value);
    },
  };
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

function staticSourcesSection() {
  const node = document.createElement("section");
  node.className = "native-static-section";
  const heading = document.createElement("div");
  heading.className = "native-static-heading";
  heading.textContent = "Sources";
  const content = document.createElement("div");
  content.className = "native-static-content";
  for (const label of ["one", "two", "three"]) {
    const icon = document.createElement("span");
    icon.className = "native-source-icon";
    icon.textContent = label;
    content.appendChild(icon);
  }
  node.append(heading, content);
  return node;
}

function nestedStaticSourcesSection() {
  const node = document.createElement("section");
  node.className = "native-static-section";
  const inner = document.createElement("div");
  inner.className = "native-static-inner";
  const heading = document.createElement("div");
  heading.className = "native-static-heading";
  heading.textContent = "Sources";
  const content = document.createElement("div");
  content.className = "native-static-content";
  const icon = document.createElement("span");
  icon.className = "native-source-icon";
  content.appendChild(icon);
  inner.append(heading, content);
  node.appendChild(inner);
  return node;
}

function nativeAccordion(title, bodyText, options = {}) {
  const node = document.createElement("section");
  node.className = "native-section";
  const trigger = document.createElement("button");
  trigger.className = "native-trigger";
  trigger.setAttribute("aria-expanded", "false");
  const label = document.createElement("span");
  label.className = "native-label";
  label.textContent = title;
  const chevron = document.createElement("span");
  chevron.className = "native-chevron";
  chevron.textContent = ">";
  trigger.append(label, chevron);
  if (options.controls) {
    const additions = document.createElement("span");
    additions.className = "native-controls";
    additions.textContent = "+21,288 -1,496 gear";
    trigger.appendChild(additions);
  }
  const content = document.createElement("div");
  content.className = "native-content";
  if (options.rowTemplate) {
    const row = document.createElement(options.rowTag || "button");
    row.className = "native-row";
    const icon = document.createElement("span");
    icon.className = "native-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "native-row-text";
    text.textContent = bodyText;
    row.append(icon, text);
    content.appendChild(row);
  } else {
    content.textContent = bodyText;
  }
  node.append(trigger, content);
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

  createElementNS(_namespace, tagName) {
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
    this.style = {};
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

  click() {
    for (const listener of this.listeners.get("click") || []) {
      listener({ preventDefault() {}, stopPropagation() {} });
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
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
      if (["aside", "section", "div", "details", "summary", "span", "a", "button", "svg", "path", "circle", "text"].includes(part)) return this.tagName.toLowerCase() === part;
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
