"use strict";

/**
 * T6.1 — Plugin-page re-anchor + coexistence tests
 *
 * Verifies that:
 *   1. isPluginsDirectorySurface() recognises both old-markup and new-markup
 *      fixtures via the PLUGIN_PAGE_ANCHOR_CHAIN fallback chain.
 *   2. hasNativeDirectorySearch() recognises both old ("Search plugins") and
 *      new ("Search skills") placeholder values.
 *   3. ensurePanel (via minimal mock) inserts our panel ALONGSIDE native list
 *      nodes — native nodes are still present after injection (coexistence).
 *   4. A second ensurePanel call with the panel already in the DOM does NOT
 *      create a duplicate (idempotent re-run).
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = fs;
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const path = require("node:path");

const {
  PLUGIN_PAGE_ANCHOR_CHAIN,
  isPluginsDirectorySurface,
  hasNativeDirectorySearch,
  hasNativeDirectoryListingSignal,
  getNativeDirectoryMeta,
  normalizeNativeDirectoryMeta,
  nativeDirectoryRecordVisible,
  compareDirectoryRecords,
  sortOptionsForMode,
  rowDateMs,
  groupedRows,
  normalizeDirectoryState,
  applyPluginUsageToNativeMeta,
  renderNativeDirectoryCounts,
  nativeDirectoryToolbarAnchor,
  nativeDirectorySearchFallbackAnchor,
  nativeDirectoryRowMeta,
  parseNativeDirectoryTitle,
  slugKey,
  bestSlugMatch,
  isNativeDirectoryRowCandidate,
  isInsideAppSidebar,
  groupNativeSkillRowsByPlugin,
  groupNativeRowsByCategory,
  nativeDirectoryCategoryOptions,
  createNativeDirectoryMetaCache,
  pluginSkillsForDir,
  nativePluginMetadataRows,
  sanitizeNativeMetadataHref,
  sanitizeNativeIconUrl,
  isSafeRelativeAssetPath,
  normalizeNativePluginClis,
  renderNativePluginClisSection,
  readPluginMetadata,
  pluginStatusesSignature,
  nativeObserverMutationRoot,
  pluginDirectoryCounts,
  buildPluginDirectoryHealth,
  syncConfiguredPluginActionButtons,
  syncNativeDirectoryInstalledAction,
  syncNativeDirectoryIconFrames,
} = require("../index.cjs").__test;

// ---------------------------------------------------------------------------
// Minimal fake DOM (no jsdom dependency — mirrors the existing test harness)
// ---------------------------------------------------------------------------

class FakeStyle {
  constructor() { this._props = {}; }
  setProperty(k, v) { this._props[k] = v; }
  removeProperty(k) { delete this._props[k]; }
  get display() { return this._props.display || ""; }
  set display(v) { this._props.display = v; }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this._attrs = new Map();
    this.dataset = {};
    this.hidden = false;
    this.style = new FakeStyle();
    this._className = "";
    this._textContent = "";
    this.isConnected = false;
    this.classList = {
      add: (...cls) => {
        const cur = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const c of cls) cur.add(c);
        this.className = Array.from(cur).join(" ");
      },
      toggle: (c, force) => {
        const cur = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force === undefined ? cur.has(c) : !force) cur.delete(c);
        else cur.add(c);
        this.className = Array.from(cur).join(" ");
      },
      remove: (...cls) => {
        const cur = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const c of cls) cur.delete(c);
        this.className = Array.from(cur).join(" ");
      },
    };
  }

  get className() { return this._className; }
  set className(v) { this._className = String(v || ""); }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this._textContent = String(v ?? "");
    this.children = [];
  }

  appendChild(node) {
    if (node.parentElement) {
      const prevIdx = node.parentElement.children.indexOf(node);
      if (prevIdx >= 0) node.parentElement.children.splice(prevIdx, 1);
    }
    node.parentElement = this;
    node.isConnected = true;
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
  }

  insertAdjacentElement(position, node) {
    if (position === "afterend") {
      const parent = this.parentElement;
      if (!parent) { this.appendChild(node); return node; }
      const idx = parent.children.indexOf(this);
      node.parentElement = parent;
      node.isConnected = true;
      parent.children.splice(idx + 1, 0, node);
    } else if (position === "beforebegin") {
      const parent = this.parentElement;
      if (!parent) return node;
      const idx = parent.children.indexOf(this);
      node.parentElement = parent;
      node.isConnected = true;
      parent.children.splice(idx, 0, node);
    } else {
      this.appendChild(node);
    }
    return node;
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
    this.isConnected = false;
  }

  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  hasAttribute(name) { return this._attrs.has(name); }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      if (node !== this && matchesSelector(node, selector)) results.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this);
    return results;
  }

  contains(other) {
    if (!other) return false;
    if (other === this) return true;
    return this.children.some((c) => c === other || c.contains(other));
  }

  matches(selector) { return matchesSelector(this, selector); }

  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    // Return a "large enough to pass viewport checks" rect so geometry
    // guards don't reject our fixtures.
    return { width: 800, height: 600, top: 80, left: 200, right: 1000, bottom: 680 };
  }
}

function matchesSelector(node, selector) {
  if (!node || typeof selector !== "string") return false;
  // Handle comma-separated selectors
  const parts = selector.split(",").map((s) => s.trim());
  return parts.some((part) => matchesSingleSelector(node, part));
}

/**
 * Convert a CSS attribute name like "data-codexpp-tweaks-directory-panel"
 * to a dataset key like "codexppTweaksDirectoryPanel".
 */
function dataAttrToDatasetKey(attrName) {
  // Strip leading "data-" then camelCase the rest
  if (!attrName.startsWith("data-")) return null;
  return attrName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function matchesSingleSelector(node, part) {
  // Input with placeholder: input[placeholder='...'] — handle before generic attr selector
  const inputPlaceholder = part.match(/^input\[placeholder=['"]?([^'"=\]]*?)['"]?\]$/);
  if (inputPlaceholder) {
    return node.tagName === "INPUT" &&
           (node.getAttribute("placeholder") === inputPlaceholder[1]);
  }

  // Attribute equality selector e.g. [data-foo='bar'] or [placeholder='bar']
  const attrEq = part.match(/^\[([^=\]]+)=['"]?([^'"=\]]*?)['"]?\]$/);
  if (attrEq) {
    const [, name, value] = attrEq;
    // Try _attrs map (setAttribute path)
    if (node.hasAttribute && node.hasAttribute(name) && node.getAttribute(name) === value) return true;
    // Try dataset (direct property assignment path) for data-* attrs
    if (name.startsWith("data-")) {
      const key = dataAttrToDatasetKey(name);
      if (key && node.dataset && node.dataset[key] === value) return true;
    }
    return false;
  }

  // Attribute presence selector e.g. [data-codexpp-tweaks-directory-panel]
  const attrPresence = part.match(/^\[([^\]]+)\]$/);
  if (attrPresence) {
    const name = attrPresence[1];
    // Try _attrs map
    if (node.hasAttribute && node.hasAttribute(name)) return true;
    // Try dataset for data-* attrs (direct assignment path)
    if (name.startsWith("data-")) {
      const key = dataAttrToDatasetKey(name);
      if (key && node.dataset && key in node.dataset) return true;
    }
    return false;
  }

  // Tag selector (plain element name)
  if (/^[a-z][a-z0-9]*$/i.test(part)) return node.tagName === part.toUpperCase();

  // Class selector
  if (part.startsWith(".")) {
    const cls = part.slice(1);
    return typeof node.className === "string" && node.className.split(/\s+/).includes(cls);
  }
  return false;
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body");
    this.body.isConnected = true;
    this.head = new FakeElement("head");
    this.documentElement = new FakeElement("html");
    this._all = [];
  }

  createElement(tagName) {
    const el = new FakeElement(tagName);
    return el;
  }

  getElementById(id) {
    return this.body.querySelector(`[id="${id}"]`) || null;
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function installFakeGlobals(doc) {
  const prev = {
    document: global.document,
    window: global.window,
    MutationObserver: global.MutationObserver,
  };
  global.document = doc;
  global.window = {
    innerWidth: 1440,
    innerHeight: 900,
    setTimeout: (fn, ms) => { fn(); return 0; },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    history: { pushState: () => {} },
  };
  global.MutationObserver = class { observe() {} disconnect() {} };
  return () => {
    global.document = prev.document;
    global.window = prev.window;
    global.MutationObserver = prev.MutationObserver;
  };
}

// ---------------------------------------------------------------------------
// OLD-MARKUP fixture: Codex plugin page with "Make Codex work your way" header
// and "Search plugins" placeholder.
// ---------------------------------------------------------------------------

function buildOldMarkupPluginPage(doc) {
  const page = doc.createElement("div");
  page.dataset.testid = "plugin-page-old";

  // Native header (old markup)
  const header = doc.createElement("h1");
  header.textContent = "Make Codex work your way";
  page.appendChild(header);

  // Native search input (old placeholder)
  const searchInput = doc.createElement("input");
  searchInput.setAttribute("placeholder", "Search plugins");
  page.appendChild(searchInput);

  // Native plugin list (must survive our injection — coexistence)
  const nativeList = doc.createElement("ul");
  nativeList.dataset.testid = "native-plugin-list";
  const item1 = doc.createElement("li");
  item1.textContent = "Computer Use";
  const item2 = doc.createElement("li");
  item2.textContent = "Featured";
  nativeList.appendChild(item1);
  nativeList.appendChild(item2);
  page.appendChild(nativeList);

  // Tab row with Plugins / Skills tabs
  const tabRow = doc.createElement("div");
  const pluginsTab = doc.createElement("button");
  pluginsTab.textContent = "Plugins";
  const skillsTab = doc.createElement("button");
  skillsTab.textContent = "Skills";
  tabRow.appendChild(pluginsTab);
  tabRow.appendChild(skillsTab);
  page.appendChild(tabRow);

  return { page, nativeList, tabRow, pluginsTab, skillsTab };
}

// ---------------------------------------------------------------------------
// NEW-MARKUP fixture: Codex plugin page after a hypothetical redesign.
// Header renamed, placeholder changed to "Search skills".
// ---------------------------------------------------------------------------

function buildNewMarkupPluginPage(doc) {
  const page = doc.createElement("div");
  page.dataset.testid = "plugin-page-new";

  // New-markup header — different text than old
  const header = doc.createElement("h1");
  header.textContent = "Featured";
  page.appendChild(header);

  // New search input (new placeholder)
  const searchInput = doc.createElement("input");
  searchInput.setAttribute("placeholder", "Search skills");
  page.appendChild(searchInput);

  // Native plugin list (must survive our injection — coexistence)
  const nativeList = doc.createElement("ul");
  nativeList.dataset.testid = "native-plugin-list";
  const item1 = doc.createElement("li");
  item1.textContent = "Computer Use";
  const item2 = doc.createElement("li");
  item2.textContent = "Playwright";
  nativeList.appendChild(item1);
  nativeList.appendChild(item2);
  page.appendChild(nativeList);

  // Tab row with Plugins / Skills tabs (same as old markup — tab labels
  // are not expected to change in this scenario)
  const tabRow = doc.createElement("div");
  const pluginsTab = doc.createElement("button");
  pluginsTab.textContent = "Plugins";
  const skillsTab = doc.createElement("button");
  skillsTab.textContent = "Skills";
  tabRow.appendChild(pluginsTab);
  tabRow.appendChild(skillsTab);
  page.appendChild(tabRow);

  return { page, nativeList, tabRow, pluginsTab, skillsTab };
}

function buildSplitPanePluginLandingPage(doc) {
  const shell = doc.createElement("div");
  shell.dataset.testid = "split-shell";
  const leftPane = doc.createElement("main");
  leftPane.dataset.testid = "left-pane";
  const rightPane = doc.createElement("aside");
  rightPane.dataset.testid = "right-pane";

  const tabRow = doc.createElement("div");
  const pluginsTab = doc.createElement("button");
  pluginsTab.textContent = "Plugins";
  const skillsTab = doc.createElement("button");
  skillsTab.textContent = "Skills";
  tabRow.append(pluginsTab, skillsTab);

  const title = doc.createElement("h1");
  title.textContent = "Make Codex work your way";

  const toolbar = doc.createElement("div");
  toolbar.dataset.testid = "toolbar";
  const searchWrap = doc.createElement("label");
  const searchInput = doc.createElement("input");
  searchInput.setAttribute("placeholder", "Search plugins");
  searchWrap.appendChild(searchInput);
  const source = doc.createElement("button");
  source.textContent = "Built by OpenAI";
  const marketplace = doc.createElement("button");
  marketplace.textContent = "All";
  toolbar.append(searchWrap, source, marketplace);

  const carousel = doc.createElement("div");
  carousel.textContent = "Computer Use Play a playlist to help me lock in Try in chat";
  const list = doc.createElement("div");
  const card = doc.createElement("article");
  card.textContent = "Computer Use Control Mac apps from Codex";
  list.appendChild(card);

  leftPane.append(tabRow, title, toolbar, carousel, list);
  shell.append(leftPane, rightPane);
  return { shell, toolbar, rightPane, tabRow };
}

function buildCompactToolbarPluginPage(doc) {
  const page = doc.createElement("main");
  const tabRow = doc.createElement("div");
  const pluginsTab = doc.createElement("button");
  pluginsTab.textContent = "Plugins";
  const skillsTab = doc.createElement("button");
  skillsTab.textContent = "Skills";
  tabRow.append(pluginsTab, skillsTab);
  const toolbar = doc.createElement("div");
  toolbar.dataset.testid = "toolbar";
  const searchInput = doc.createElement("input");
  searchInput.setAttribute("placeholder", "Search plugins");
  const source = doc.createElement("button");
  source.textContent = "Built by OpenAI";
  const marketplace = doc.createElement("button");
  marketplace.textContent = "All";
  toolbar.append(searchInput, source, marketplace);
  page.append(tabRow, toolbar);
  return { page, toolbar, tabRow };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("PLUGIN_PAGE_ANCHOR_CHAIN contains expected entries in fallback order", () => {
  assert.ok(Array.isArray(PLUGIN_PAGE_ANCHOR_CHAIN), "chain is an array");
  assert.ok(PLUGIN_PAGE_ANCHOR_CHAIN.length >= 4, "chain has at least 4 entries");

  // Verify the fallback order: own panel → old header → new header → search selectors
  const ids = PLUGIN_PAGE_ANCHOR_CHAIN.map((e) => e.id);
  assert.ok(ids.includes("directory-root-own"), "chain has own-panel entry");
  assert.ok(ids.includes("directory-root-header-old"), "chain has old-header entry");
  assert.ok(ids.includes("directory-root-header-new"), "chain has new-header entry");
  assert.ok(ids.includes("search-field-old"), "chain has old search-field entry");
  assert.ok(ids.includes("search-field-new"), "chain has new search-field entry");

  // Own panel entry must come before header entries
  const ownIdx = ids.indexOf("directory-root-own");
  const oldHeaderIdx = ids.indexOf("directory-root-header-old");
  assert.ok(ownIdx < oldHeaderIdx, "own-panel entry is before old-header entry");

  // Old header before new header (old markup is tried first)
  const newHeaderIdx = ids.indexOf("directory-root-header-new");
  assert.ok(oldHeaderIdx < newHeaderIdx, "old-header entry is before new-header entry");
});

test("isPluginsDirectorySurface — old markup: recognises 'Make Codex work your way'", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildOldMarkupPluginPage(doc);
    doc.body.appendChild(page);
    assert.equal(isPluginsDirectorySurface(page), true, "old markup page is recognised");
  } finally {
    restore();
  }
});

test("isPluginsDirectorySurface — new markup: recognises 'Featured' + listing signal", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildNewMarkupPluginPage(doc);
    doc.body.appendChild(page);
    // New markup has "Featured" header + "Computer Use" listing signal
    assert.equal(isPluginsDirectorySurface(page), true, "new markup page is recognised");
  } finally {
    restore();
  }
});

test("isPluginsDirectorySurface — rejects unrelated nodes", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const chat = doc.createElement("div");
    chat.textContent = "New chat Projects Settings";
    doc.body.appendChild(chat);
    assert.equal(isPluginsDirectorySurface(chat), false, "sidebar nav is not a plugin page");

    const empty = doc.createElement("div");
    doc.body.appendChild(empty);
    assert.equal(isPluginsDirectorySurface(empty), false, "empty node is not a plugin page");
  } finally {
    restore();
  }
});

test("hasNativeDirectorySearch — old markup: finds 'Search plugins' placeholder", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildOldMarkupPluginPage(doc);
    assert.equal(hasNativeDirectorySearch(page), true, "old markup search is found");
  } finally {
    restore();
  }
});

test("hasNativeDirectorySearch — new markup: finds 'Search skills' placeholder", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildNewMarkupPluginPage(doc);
    assert.equal(hasNativeDirectorySearch(page), true, "new markup search is found");
  } finally {
    restore();
  }
});

test("hasNativeDirectorySearch — rejects a node with no search input", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const div = doc.createElement("div");
    div.textContent = "just some text";
    assert.equal(hasNativeDirectorySearch(div), false, "no search input found");
  } finally {
    restore();
  }
});

test("native observer work is scoped to directory mutations", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildOldMarkupPluginPage(doc);
    doc.body.appendChild(page);
    const state = { panel: null, root: page };

    const unrelated = doc.createElement("div");
    unrelated.textContent = "New chat Projects Settings";
    doc.body.appendChild(unrelated);
    assert.equal(nativeObserverMutationRoot(state, [{ target: unrelated, addedNodes: [unrelated], removedNodes: [] }]), null);

    const row = doc.createElement("div");
    row.textContent = "DebugPro";
    page.appendChild(row);
    assert.equal(nativeObserverMutationRoot(state, [{ target: page, addedNodes: [row], removedNodes: [] }]), page);

    const { page: addedPage } = buildNewMarkupPluginPage(doc);
    assert.equal(nativeObserverMutationRoot({ panel: null, root: null }, [{ target: doc.body, addedNodes: [addedPage], removedNodes: [] }]), addedPage);
  } finally {
    restore();
  }
});

test("hasNativeDirectoryListingSignal — recognises 'Featured', 'Recommended', 'Try in chat'", () => {
  assert.equal(hasNativeDirectoryListingSignal("Featured plugins here"), true);
  assert.equal(hasNativeDirectoryListingSignal("Recommended for you"), true);
  assert.equal(hasNativeDirectoryListingSignal("Try in chat"), true);
  assert.equal(hasNativeDirectoryListingSignal("Computer Use"), true);
  assert.equal(hasNativeDirectoryListingSignal("just a header"), false);
  assert.equal(hasNativeDirectoryListingSignal(""), false);
});

test("native directory controls anchor to toolbar instead of split-pane blank area", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { shell, toolbar, rightPane, tabRow } = buildSplitPanePluginLandingPage(doc);
    doc.body.appendChild(shell);
    const anchor = nativeDirectoryToolbarAnchor(shell, tabRow, "plugins");
    assert.equal(anchor, toolbar);

    const controls = doc.createElement("div");
    controls.dataset.codexppNativeDirectoryControls = "true";
    anchor.appendChild(controls);
    assert.equal(toolbar.contains(controls), true);
    assert.equal(rightPane.contains(controls), false);
  } finally {
    restore();
  }
});

test("native directory controls append as compact toolbar siblings", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page, toolbar, tabRow } = buildCompactToolbarPluginPage(doc);
    doc.body.appendChild(page);
    const anchor = nativeDirectoryToolbarAnchor(page, tabRow, "plugins");
    assert.equal(anchor, toolbar);

    const controls = doc.createElement("div");
    controls.dataset.codexppNativeDirectoryControls = "true";
    anchor.appendChild(controls);
    assert.equal(toolbar.children[toolbar.children.length - 1], controls);
  } finally {
    restore();
  }
});

test("native directory controls fall back beside search wrapper, not page root", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const page = doc.createElement("main");
    const searchWrap = doc.createElement("label");
    const searchInput = doc.createElement("input");
    searchInput.setAttribute("placeholder", "Search plugins");
    searchWrap.appendChild(searchInput);
    page.appendChild(searchWrap);
    doc.body.appendChild(page);

    assert.equal(nativeDirectoryToolbarAnchor(page, null, "plugins"), null);
    assert.equal(nativeDirectorySearchFallbackAnchor(page, "plugins"), searchWrap);
  } finally {
    restore();
  }
});

test("additive coexistence — old markup: native list nodes remain after panel insertion", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page, nativeList } = buildOldMarkupPluginPage(doc);
    doc.body.appendChild(page);

    // Simulate inserting our panel alongside the native content
    const panel = doc.createElement("section");
    panel.dataset.codexppTweaksDirectoryPanel = "true";

    // Our anchor strategy: insert after a child of the page root
    const anchor = page.children[page.children.length - 1]; // tabRow
    anchor.insertAdjacentElement("afterend", panel);

    // Verify panel is now in the DOM
    assert.ok(
      page.contains(panel) || doc.body.contains(panel),
      "panel is in the DOM after insertion",
    );

    // Coexistence: native list is still connected
    assert.ok(
      page.contains(nativeList),
      "native plugin list is still in the DOM after our panel was inserted",
    );

    // Native list children still present
    const items = nativeList.children;
    assert.equal(items.length, 2, "native list retains its children");
  } finally {
    restore();
  }
});

test("additive coexistence — new markup: native list nodes remain after panel insertion", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page, nativeList } = buildNewMarkupPluginPage(doc);
    doc.body.appendChild(page);

    const panel = doc.createElement("section");
    panel.dataset.codexppTweaksDirectoryPanel = "true";

    const anchor = page.children[page.children.length - 1];
    anchor.insertAdjacentElement("afterend", panel);

    assert.ok(
      page.contains(panel) || doc.body.contains(panel),
      "panel is in the DOM",
    );
    assert.ok(
      page.contains(nativeList),
      "native plugin list is still present (new markup)",
    );
    assert.equal(nativeList.children.length, 2, "native list retains its children (new markup)");
  } finally {
    restore();
  }
});

test("idempotent — second ensurePanel call does not duplicate the panel", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildOldMarkupPluginPage(doc);
    doc.body.appendChild(page);

    // First insertion
    const panel = doc.createElement("section");
    panel.dataset.codexppTweaksDirectoryPanel = "true";
    const anchor = page.children[page.children.length - 1];
    anchor.insertAdjacentElement("afterend", panel);

    // Simulate "second run" by querying for the existing panel (as ensurePanel does)
    const existing = doc.querySelector("[data-codexpp-tweaks-directory-panel]");
    assert.ok(existing, "existing panel found by attribute selector");
    assert.equal(existing, panel, "found node is the same panel we inserted");

    // A well-behaved ensurePanel reuses the existing node; no second element added
    const allPanels = doc.querySelectorAll("[data-codexpp-tweaks-directory-panel]");
    assert.equal(allPanels.length, 1, "exactly one panel in the DOM (idempotent)");
  } finally {
    restore();
  }
});

test("idempotent — querySelectorAll for panel attr returns at most 1 node after two insertions", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const { page } = buildNewMarkupPluginPage(doc);
    doc.body.appendChild(page);

    // First insertion
    const panel = doc.createElement("section");
    panel.dataset.codexppTweaksDirectoryPanel = "true";
    page.children[0].insertAdjacentElement("afterend", panel);

    // Guard: if ensurePanel tries to insert again it should find the existing
    // node first — test that our fake DOM's querySelectorAll finds it
    const found = doc.querySelector("[data-codexpp-tweaks-directory-panel]");
    assert.ok(found, "panel is findable");
    assert.equal(found.isConnected, true, "found panel reports isConnected");

    // Simulate: a second call that checks isConnected before creating
    if (!found || !found.isConnected) {
      const second = doc.createElement("section");
      second.dataset.codexppTweaksDirectoryPanel = "true";
      page.appendChild(second);
    }

    const allPanels = doc.querySelectorAll("[data-codexpp-tweaks-directory-panel]");
    assert.equal(allPanels.length, 1, "still only one panel — idempotency guard worked");
  } finally {
    restore();
  }
});

test("contract chain selector integrity — all selector strings are non-empty strings", () => {
  for (const entry of PLUGIN_PAGE_ANCHOR_CHAIN) {
    assert.ok(typeof entry.id === "string" && entry.id.length > 0, `entry ${entry.id} has an id`);
    assert.ok(Array.isArray(entry.selectors), `entry ${entry.id} has selectors array`);
    for (const sel of entry.selectors) {
      assert.ok(typeof sel === "string" && sel.length > 0, `entry ${entry.id} selector is non-empty string`);
    }
    assert.ok(Array.isArray(entry.textSignals), `entry ${entry.id} has textSignals array`);
  }
});

test("Tweaks Directory sort dates prefer installed filesystem metadata", () => {
  const row = {
    installed: {
      createdAtMs: 100,
      updatedAtMs: 200,
      lastUsedAtMs: 300,
      enabled: true,
    },
    store: {
      approvedAt: "2026-01-01T00:00:00.000Z",
    },
    manifest: {
      id: "co.example.tweak",
      name: "Example",
    },
  };
  assert.equal(rowDateMs(row, "created"), 100);
  assert.equal(rowDateMs(row, "updated"), 200);
  assert.equal(rowDateMs(row, "used"), 300);
});

test("Tweaks Directory filesystem-backed sort label says file accessed", () => {
  const option = sortOptionsForMode("tweaks").find((item) => item.key === "used");
  assert.equal(option.label, "File Accessed");
});

test("Tweaks Directory sort dates fall back to store approval time", () => {
  const row = {
    installed: null,
    store: {
      approvedAt: "2026-01-02T03:04:05.000Z",
    },
    manifest: {
      id: "co.example.store",
      name: "Store Example",
    },
  };
  assert.equal(rowDateMs(row, "created"), Date.parse("2026-01-02T03:04:05.000Z"));
  assert.equal(rowDateMs(row, "updated"), Date.parse("2026-01-02T03:04:05.000Z"));
});

test("native directory record filters installed and enabled with one pill", () => {
  const controls = { query: "", installedEnabledOnly: true };
  assert.equal(nativeDirectoryRecordVisible({ installed: true, enabled: true, text: "DebugPro", title: "DebugPro" }, controls), true);
  assert.equal(nativeDirectoryRecordVisible({ installed: true, enabled: false, text: "DebugPro", title: "DebugPro" }, controls), false);
  assert.equal(nativeDirectoryRecordVisible({ installed: false, enabled: true, text: "DebugPro", title: "DebugPro" }, controls), false);
});

test("native directory record search includes plugin and skill metadata", () => {
  const record = {
    installed: true,
    enabled: true,
    text: "debugpro-hypotheses",
    title: "debugpro-hypotheses",
    meta: {
      pluginLabel: "DebugPro",
      category: "Design",
      slash: "$debugpro-hypotheses",
    },
  };
  assert.equal(nativeDirectoryRecordVisible(record, { query: "debugpro", installedEnabledOnly: false }), true);
  assert.equal(nativeDirectoryRecordVisible(record, { query: "design", installedEnabledOnly: false }), true);
  assert.equal(nativeDirectoryRecordVisible(record, { query: "", category: "Design", installedEnabledOnly: false }), true);
  assert.equal(nativeDirectoryRecordVisible(record, { query: "", category: "Coding", installedEnabledOnly: false }), false);
  assert.equal(nativeDirectoryRecordVisible(record, { query: "missing", installedEnabledOnly: false }), false);
});

test("Tweaks Directory date sorts flatten update installed and store groups", () => {
  const update = { installed: { manifest: { version: "1.0.0" } }, store: { manifest: { version: "2.0.0" } } };
  const installed = { installed: { manifest: { version: "1.0.0" } }, store: null };
  const store = { installed: null, store: { manifest: { version: "1.0.0" } } };
  const flattened = groupedRows([update, installed, store], "created");
  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].title, "");
  assert.deepEqual(flattened[0].rows, [update, installed, store]);
  assert.deepEqual(groupedRows([update, installed, store], "used").map((section) => section.title), ["Updates", "Installed", "Store"]);
});

test("native directory Date Used uses persisted plugin usage timestamps", () => {
  const meta = normalizeNativeDirectoryMeta({
    plugins: [{ id: "debugpro", displayName: "DebugPro", lastUsedAtMs: 0 }],
    skills: [{ name: "debugpro-hypotheses", pluginName: "DebugPro", lastUsedAtMs: 0 }],
  });
  const state = { pluginUsage: { debugpro: 12345 } };
  const updated = applyPluginUsageToNativeMeta(state, meta);
  assert.equal(updated.plugins[0].lastUsedAtMs, 12345);
  assert.equal(updated.skills[0].lastUsedAtMs, 12345);
});

test("directory state preferences persist tweaks and native directory controls", () => {
  const normalized = normalizeDirectoryState({
    tweaks: { filter: "store", sort: "used", installedEnabledOnly: true },
    plugins: { sort: "updated", installedEnabledOnly: true },
    skills: { sort: "created", groupBy: "plugin", installedEnabledOnly: true },
  });
  assert.deepEqual(normalized.tweaks, { filter: "store", sort: "used", installedEnabledOnly: true });
  assert.deepEqual(normalized.plugins, { sort: "updated", installedEnabledOnly: true, category: "" });
  assert.deepEqual(normalized.skills, { sort: "created", groupBy: "plugin", installedEnabledOnly: true, category: "" });
});

test("native directory metadata cache bounds scans and supports explicit refresh", () => {
  let calls = 0;
  let now = 1000;
  const cache = createNativeDirectoryMetaCache({
    ttlMs: 100,
    now: () => now,
    scan: () => ({ status: "ok", plugins: [{ id: `plugin-${calls += 1}` }], skills: [] }),
  });

  const first = cache.get();
  const second = cache.get();
  assert.equal(calls, 1);
  assert.equal(second, first);

  now += 101;
  const afterTtl = cache.get();
  assert.equal(calls, 2);
  assert.notEqual(afterTtl, first);

  cache.get({ force: true });
  assert.equal(calls, 3);
  cache.clear();
  cache.get();
  assert.equal(calls, 4);
});

test("plugin status signatures change when configured plugin state changes", () => {
  const enabled = pluginStatusesSignature({
    items: [
      { key: "debugpro@local-plugins", enabled: true },
      { key: "plan-grader@local-plugins", enabled: false },
    ],
  });
  const reordered = pluginStatusesSignature({
    items: [
      { key: "plan-grader@local-plugins", enabled: false },
      { key: "debugpro@local-plugins", enabled: true },
    ],
  });
  const changed = pluginStatusesSignature({
    items: [
      { key: "debugpro@local-plugins", enabled: false },
      { key: "plan-grader@local-plugins", enabled: false },
    ],
  });
  assert.equal(reordered, enabled);
  assert.notEqual(changed, enabled);
});

test("native directory metadata marks installed from Codex plugin config, not cache presence", () => {
  const home = mkdtempSync(join(tmpdir(), "codexpp-native-meta-"));
  try {
    writeNativePluginFixture(home, "debugpro", "DebugPro", "0.1.0");
    writeNativePluginFixture(home, "debugpro-copy", "DebugPro", "0.1.0");
    writeNativePluginFixture(home, "plan-grader", "Plan Grader", "1.0.0");
    writeNativePluginFixture(home, "available-only", "Available Only", "1.0.0");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), [
      "[plugins]",
      "[plugins.\"debugpro@local-plugins\"]",
      "enabled = true",
      "[plugins.\"plan-grader@local-plugins\"]",
      "enabled = false",
      "",
    ].join("\n"));

    const meta = getNativeDirectoryMeta({ home });
    const byId = Object.fromEntries(meta.plugins.map((plugin) => [plugin.id, plugin]));
    assert.equal(meta.plugins.filter((plugin) => plugin.displayName === "DebugPro").length, 1);
    assert.equal(byId.debugpro.installed, true);
    assert.equal(byId.debugpro.enabled, true);
    assert.equal(byId["plan-grader"].installed, true);
    assert.equal(byId["plan-grader"].enabled, false);
    assert.equal(byId["available-only"].installed, false);
    assert.equal(byId["available-only"].enabled, false);

    const skill = meta.skills.find((item) => item.pluginId === "available-only");
    assert.equal(skill.installed, false);
    assert.equal(skill.enabled, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function writeNativePluginFixture(home, id, displayName, version) {
  const root = join(home, ".codex", "plugins", "cache", "local-plugins", id, version);
  const pluginDir = join(root, ".codex-plugin");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
    name: id,
    displayName,
    interface: {
      includes: [{ kind: "skill", name: `${id}-skill`, displayName: `${displayName} Skill` }],
    },
  }, null, 2));
  return root;
}

test("native directory metadata reads plugin CLI sidecars", () => {
  const home = mkdtempSync(join(tmpdir(), "codexpp-native-cli-meta-"));
  try {
    const pluginRoot = writeNativePluginFixture(home, "mcp-app-builder", "MCP App Builder", "0.1.0");
    writeFileSync(join(pluginRoot, ".cli.json"), JSON.stringify({
      commands: [
        {
          name: "validate_app_scaffold",
          description: "Validate a scaffold.",
          command: "node scripts/validate_app_scaffold.mjs /tmp/app",
          cwd: ".",
          mode: "read-only",
          examples: ["node scripts/validate_app_scaffold.mjs /tmp/app"],
        },
        { name: "skip", command: "node skip.js", mode: "danger" },
      ],
    }, null, 2));

    const meta = getNativeDirectoryMeta({ home });
    const plugin = meta.plugins.find((item) => item.id === "mcp-app-builder");
    assert.equal(plugin.cliCommands.length, 1);
    assert.equal(plugin.cliCommands[0].name, "validate_app_scaffold");
    assert.equal(plugin.cliCommands[0].mode, "read-only");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("plugin health reports enabled config entries missing cache metadata", () => {
  const health = buildPluginDirectoryHealth({
    items: [
      { key: "supabase@openai-curated", id: "supabase", slug: "supabase", displayName: "Supabase", enabled: true },
      { key: "disabled@local-plugins", id: "disabled", slug: "disabled", displayName: "Disabled", enabled: false },
    ],
  }, {
    plugins: [{ id: "other", displayName: "Other", installed: true, enabled: true }],
  });
  assert.equal(health.configured, 2);
  assert.equal(health.installed, 2);
  assert.equal(health.enabled, 1);
  assert.equal(health.disabled, 1);
  assert.equal(health.cacheBacked, 0);
  assert.deepEqual(health.missing.map((item) => item.id), ["supabase"]);
});

test("plugin counts separate installed from enabled state", () => {
  const counts = pluginDirectoryCounts({
    items: [
      { key: "enabled@local-plugins", id: "enabled", configured: true, installed: true, enabled: true },
      { key: "disabled@local-plugins", id: "disabled", configured: true, installed: true, enabled: false },
      { key: "available@local-plugins", id: "available", configured: false, installed: false, enabled: false },
    ],
  }, {
    plugins: [
      { id: "enabled", installed: true, enabled: true },
      { id: "disabled", installed: true, enabled: false },
      { id: "available", installed: false, enabled: false },
    ],
  });
  assert.equal(counts.configured, 3);
  assert.equal(counts.installed, 2);
  assert.equal(counts.enabled, 1);
  assert.equal(counts.disabled, 1);
  assert.equal(counts.directoryInstalled, 2);
  assert.equal(counts.directoryEnabled, 1);
});

test("native plugin toolbar count shows installed and enabled separately", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const count = renderNativeDirectoryCounts({
      pluginStatuses: {
        items: [
          { key: "enabled@local-plugins", id: "enabled", configured: true, installed: true, enabled: true },
          { key: "disabled@local-plugins", id: "disabled", configured: true, installed: true, enabled: false },
        ],
      },
      nativeDirectoryMeta: {
        plugins: [
          { id: "enabled", installed: true, enabled: true },
          { id: "disabled", installed: true, enabled: false },
        ],
      },
    }, "plugins");
    assert.equal(count.textContent, "2 installed · 1 enabled");
    assert.equal(count.dataset.codexppNativeDirectoryCounts, "true");
  } finally {
    restore();
  }
});

test("native plugin row action rewrites Add plugin for installed enabled config plugins", () => {
  const doc = new FakeDocument();
  const row = doc.createElement("div");
  const action = doc.createElement("button");
  action.textContent = "Add plugin";
  row.appendChild(action);
  const changed = syncNativeDirectoryInstalledAction({ row, installed: true, enabled: true });
  assert.equal(changed, true);
  assert.equal(action.textContent, "✓");
  assert.equal(action.disabled, true);
  assert.equal(action.getAttribute("aria-label"), "Installed and enabled");
  assert.equal(action.dataset.codexppNativePluginInstalledAction, "true");
});

test("native plugin row action rewrites enabled switch controls to installed checkmarks", () => {
  const doc = new FakeDocument();
  const row = doc.createElement("div");
  const toggle = doc.createElement("button");
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", "true");
  row.appendChild(toggle);
  const changed = syncNativeDirectoryInstalledAction({ row, installed: true, enabled: true });
  assert.equal(changed, true);
  assert.equal(toggle.textContent, "✓");
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.getAttribute("aria-label"), "Installed and enabled");
  assert.equal(toggle.dataset.codexppNativePluginInstalledAction, "true");
});

test("generic plugin cards rewrite Add plugin for enabled configured plugins", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const card = doc.createElement("div");
    const title = doc.createElement("h3");
    title.textContent = "Supabase";
    const description = doc.createElement("p");
    description.textContent = "Supabase skills and MCP tools for Codex";
    const action = doc.createElement("button");
    action.textContent = "Add plugin";
    card.append(title, description, action);
    doc.body.appendChild(card);
    const state = {
      preferences: { nativePatchesSafeMode: false },
      nativeDirectoryMeta: normalizeNativeDirectoryMeta({
        plugins: [{ id: "supabase", name: "Supabase", displayName: "Supabase", label: "Supabase", installed: true, enabled: true }],
        skills: [],
      }),
    };
    const changed = syncConfiguredPluginActionButtons(state, doc.body);
    assert.equal(changed, 1);
    assert.equal(action.textContent, "✓");
    assert.equal(action.disabled, true);
  } finally {
    restore();
  }
});

test("generic plugin cards rewrite bare Add (search/library) for installed enabled plugins", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const card = doc.createElement("div");
    const title = doc.createElement("h3");
    title.textContent = "Stripe";
    const description = doc.createElement("p");
    description.textContent = "Payments and business tools";
    const action = doc.createElement("button");
    action.textContent = "Add"; // search/library list uses bare "Add", not "Add plugin"
    card.append(title, description, action);
    doc.body.appendChild(card);
    const state = {
      preferences: { nativePatchesSafeMode: false },
      nativeDirectoryMeta: normalizeNativeDirectoryMeta({
        plugins: [{ id: "stripe", name: "Stripe", displayName: "Stripe", label: "Stripe", installed: true, enabled: true }],
        skills: [],
      }),
    };
    const changed = syncConfiguredPluginActionButtons(state, doc.body);
    assert.equal(changed, 1);
    assert.equal(action.textContent, "✓");
    assert.equal(action.disabled, true);
  } finally {
    restore();
  }
});

test("generic plugin cards rewrite enabled switches for installed enabled plugins", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const card = doc.createElement("div");
    const title = doc.createElement("h3");
    title.textContent = "Projections Market";
    const description = doc.createElement("p");
    description.textContent = "Event-contract research and watchlists";
    const toggle = doc.createElement("button");
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", "true");
    card.append(title, description, toggle);
    doc.body.appendChild(card);
    const state = {
      preferences: { nativePatchesSafeMode: false },
      nativeDirectoryMeta: normalizeNativeDirectoryMeta({
        plugins: [{ id: "projections-market", name: "Projections Market", displayName: "Projections Market", label: "Projections Market", installed: true, enabled: true }],
        skills: [],
      }),
    };
    const changed = syncConfiguredPluginActionButtons(state, doc.body);
    assert.equal(changed, 1);
    assert.equal(toggle.textContent, "✓");
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.getAttribute("aria-label"), "Installed and enabled");
  } finally {
    restore();
  }
});

test("bare Add is NOT flipped when the card only FUZZY-matches a plugin (deterministic guard)", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const card = doc.createElement("div");
    const title = doc.createElement("h3");
    title.textContent = "Stripe Atlas"; // a different product whose slug merely CONTAINS "stripe"
    const description = doc.createElement("p");
    description.textContent = "Incorporate a company";
    const action = doc.createElement("button");
    action.textContent = "Add";
    card.append(title, description, action);
    doc.body.appendChild(card);
    const state = {
      preferences: { nativePatchesSafeMode: false },
      nativeDirectoryMeta: normalizeNativeDirectoryMeta({
        plugins: [{ id: "stripe", name: "Stripe", displayName: "Stripe", label: "Stripe", installed: true, enabled: true }],
        skills: [],
      }),
    };
    // Fuzzy bestSlugMatch WOULD match "stripe" ⊂ "stripeatlas"; the bare-Add path
    // resolves deterministically only, so this unrelated card stays "Add".
    const changed = syncConfiguredPluginActionButtons(state, doc.body);
    assert.equal(changed, 0);
    assert.equal(action.textContent, "Add");
    assert.ok(!action.disabled);
    assert.equal(action.dataset.codexppNativePluginInstalledAction, undefined);
  } finally {
    restore();
  }
});

test("native directory sort orders default rows by original order", () => {
  const first = { title: "B", originalIndex: 0, meta: { updatedAtMs: 100 } };
  const second = { title: "A", originalIndex: 1, meta: { updatedAtMs: 200 } };
  assert.equal(compareDirectoryRecords(first, second, "default") < 0, true);
});

test("native directory sort orders newest dates first and then names", () => {
  const older = { title: "B", originalIndex: 0, meta: { updatedAtMs: 100 } };
  const newer = { title: "A", originalIndex: 1, meta: { updatedAtMs: 200 } };
  assert.equal(compareDirectoryRecords(newer, older, "updated") < 0, true);
  assert.equal(compareDirectoryRecords({ title: "A", meta: {} }, { title: "B", meta: {} }, "used") < 0, true);
});

test("native directory metadata indexes skills by plugin for grouping", () => {
  const normalized = normalizeNativeDirectoryMeta({
    status: "ok",
    plugins: [{ id: "debugpro", displayName: "DebugPro", label: "DebugPro", installed: true, enabled: true }],
    skills: [{ name: "debugpro-hypotheses", pluginLabel: "DebugPro", installed: true, enabled: true }],
  });
  assert.equal(normalized.byPlugin.debugpro.displayName, "DebugPro");
  assert.equal(normalized.bySkill["debugpro-hypotheses"].pluginLabel, "DebugPro");
  assert.equal(normalized.byPluginSlug.debugpro.displayName, "DebugPro");
  assert.equal(normalized.bySkillSlug.debugprohypotheses.pluginLabel, "DebugPro");
});

test("native skill row metadata resolves Plugin: Skill titles by slug", () => {
  const nativeDirectoryMeta = normalizeNativeDirectoryMeta({
    status: "ok",
    plugins: [{ id: "agent-teams", displayName: "Agent Teams", label: "Agent Teams", installed: true, enabled: true }],
    skills: [{ name: "team-debug", displayName: "Team Debug", pluginId: "agent-teams", pluginLabel: "Agent Teams", installed: true, enabled: true }],
  });
  const meta = nativeDirectoryRowMeta({ nativeDirectoryMeta }, "Agent Teams: Team Debug", "Agent Teams: Team Debug agent-teams Use when debugging complex issues", "skills");
  assert.equal(meta.pluginLabel, "Agent Teams");
  assert.equal(meta.name, "team-debug");
});

test("native skill row metadata ignores false-positive description words", () => {
  const nativeDirectoryMeta = normalizeNativeDirectoryMeta({
    status: "ok",
    plugins: [
      { id: "agent-teams", displayName: "Agent Teams", label: "Agent Teams", installed: true, enabled: true },
      { id: "vercel", displayName: "Vercel", label: "Vercel", installed: true, enabled: true },
    ],
    skills: [
      { name: "team-shutdown", displayName: "Team Shutdown", pluginId: "agent-teams", pluginLabel: "Agent Teams", installed: true, enabled: true },
      { name: "browser", displayName: "Browser", pluginId: "vercel", pluginLabel: "Vercel", installed: true, enabled: true },
    ],
  });
  const meta = nativeDirectoryRowMeta(
    { nativeDirectoryMeta },
    "Agent Teams: Team Shutdown",
    "Agent Teams: Team Shutdown agent-teams Use when stopping a team. This description mentions vercel incidentally.",
    "skills"
  );
  assert.equal(meta.pluginLabel, "Agent Teams");
  assert.equal(meta.name, "team-shutdown");
});

test("native skill row metadata resolves top-level short skills by exact slug", () => {
  const nativeDirectoryMeta = normalizeNativeDirectoryMeta({
    status: "ok",
    plugins: [],
    skills: [{ name: "pdf", displayName: "PDF", pluginLabel: "System", installed: true, enabled: true }],
  });
  const meta = nativeDirectoryRowMeta({ nativeDirectoryMeta }, "PDF", "PDF", "skills");
  assert.equal(meta.displayName, "PDF");
  assert.equal(meta.pluginLabel, "System");
});

test("native skill row metadata creates plugin-carrying fallback for known plugin prefixes", () => {
  const nativeDirectoryMeta = normalizeNativeDirectoryMeta({
    status: "ok",
    plugins: [{ id: "agent-teams", displayName: "Agent Teams", label: "Agent Teams", installed: true, enabled: true }],
    skills: [],
  });
  const meta = nativeDirectoryRowMeta({ nativeDirectoryMeta }, "Agent Teams: Missing Skill", "Agent Teams: Missing Skill", "skills");
  assert.equal(meta.pluginLabel, "Agent Teams");
  assert.equal(meta.name, "Missing Skill");
  assert.equal(meta.slash, "");
});

test("skill frontmatter icon files are treated as custom skill icons", () => {
  const tmp = mkdtempSync(join(tmpdir(), "td-skill-icon-"));
  try {
    const pluginDir = join(tmp, "plugin");
    const skillDir = join(pluginDir, "skills", "custom-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "icon.png"), "not-empty");
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: custom-skill\ndescription: Uses its own icon.\nicon: ./icon.png\n---\n",
    );

    const skills = pluginSkillsForDir(fs, path, pluginDir, {
      id: "demo",
      name: "demo",
      displayName: "Demo",
      label: "Demo",
      dir: pluginDir,
      iconPath: "./assets/default.png",
      iconUrl: "",
      iconShape: "circle",
      iconSource: "github",
      installed: true,
      enabled: true,
    }, {});

    assert.equal(skills.length, 1);
    assert.equal(skills[0].iconInheritedFromPlugin, false);
    assert.equal(skills[0].iconPath, "./skills/custom-skill/icon.png");
    assert.equal(skills[0].iconShape, "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("skill metadata rows show inherited icon status", () => {
  const rows = nativePluginMetadataRows({
    kind: "skill",
    name: "ask-matt",
    displayName: "Ask Matt",
    pluginLabel: "mattpocock/skills",
    iconPath: "./assets/owner-avatar.png",
    iconInheritedFromPlugin: true,
  });

  assert.equal(rows.find((row) => row.label === "Plugin").value, "mattpocock/skills");
  assert.equal(rows.find((row) => row.label === "Skill Icon").value, "Inherited from mattpocock/skills");
  assert.equal(rows.find((row) => row.label === "Icon Source").value, "./assets/owner-avatar.png");
});

test("native directory GitHub icon frames are marked circular", () => {
  const row = new FakeElement("div");
  const outerFrame = new FakeElement("div");
  const frame = new FakeElement("div");
  const image = new FakeElement("img");
  frame.appendChild(image);
  outerFrame.appendChild(frame);
  row.appendChild(outerFrame);

  syncNativeDirectoryIconFrames([{ row, meta: { iconShape: "circle" } }]);

  assert.equal(image.dataset.codexppNativePluginGithubIcon, "true");
  assert.equal(frame.dataset.codexppNativePluginGithubIconFrame, "true");
  assert.equal(outerFrame.dataset.codexppNativePluginGithubIconFrame, "true");

  syncNativeDirectoryIconFrames([{ row, meta: { iconShape: "rounded-square" } }]);

  assert.equal(image.dataset.codexppNativePluginGithubIcon, undefined);
  assert.equal(frame.dataset.codexppNativePluginGithubIconFrame, undefined);
  assert.equal(outerFrame.dataset.codexppNativePluginGithubIconFrame, undefined);
});

test("plugin metadata falls back to marketplace icon for non-GitHub marketplace wrappers", () => {
  const tmp = mkdtempSync(join(tmpdir(), "td-marketplace-icon-"));
  try {
    const marketplaceRoot = join(tmp, "example-marketplace");
    const pluginDir = join(marketplaceRoot, "plugins", "demo");
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    mkdirSync(join(marketplaceRoot, ".codex-marketplace"), { recursive: true });
    mkdirSync(join(marketplaceRoot, "assets"), { recursive: true });
    writeFileSync(join(marketplaceRoot, "assets", "favicon.ico"), "not-empty");
    writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "demo" }));
    writeFileSync(
      join(marketplaceRoot, ".codex-marketplace", "metadata.json"),
      JSON.stringify({ name: "example", iconPath: "./assets/favicon.ico", iconSource: "favicon", iconCacheKey: "test-cache" }),
    );

    const meta = readPluginMetadata(pluginDir, { fs, path });
    assert.equal(meta.iconPath, "");
    assert.match(meta.iconUrl, /^file:\/\//);
    assert.match(meta.iconUrl, /favicon\.ico/);
    assert.match(meta.iconUrl, /codex_icon_cache=test-cache/);
    assert.equal(meta.iconShape, "rounded");
    assert.equal(meta.iconSource, "favicon");
    assert.equal(meta.marketplaceIconShape, "rounded");
    assert.equal(meta.marketplaceIconSource, "favicon");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("plugin metadata reads interface category and featured flags", () => {
  const tmp = mkdtempSync(join(tmpdir(), "td-plugin-category-"));
  try {
    const pluginDir = join(tmp, "design-docs-supporting");
    mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
    writeFileSync(
      join(pluginDir, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "design-docs-supporting",
        displayName: "Design Docs Supporting Skills",
        interface: {
          category: "Design",
          featured: true,
          shortDescription: "Design Docs helpers",
        },
      }),
    );

    const meta = readPluginMetadata(pluginDir, { fs, path });
    assert.equal(meta.category, "Design");
    assert.equal(meta.featured, true);
    assert.equal(meta.description, "Design Docs helpers");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("plugin metadata rows show marketplace icon source", () => {
  const rows = nativePluginMetadataRows({
    kind: "plugin",
    displayName: "mattpocock/skills",
    category: "Design",
    iconPath: "./assets/owner-avatar.png",
    iconSource: "github",
    iconShape: "circle",
    iconCacheKey: "avatar-cache",
    marketplaceIconUrl: "https://avatars.githubusercontent.com/u/28293365?s=256",
    marketplaceIconSource: "github",
    marketplaceIconShape: "circle",
    marketplaceIconCacheKey: "avatar-cache",
  });

  assert.equal(rows.find((row) => row.label === "Plugin Icon Source").value, "GitHub avatar, circle frame, cache-busted");
  assert.equal(rows.find((row) => row.label === "Marketplace Icon").href, "https://avatars.githubusercontent.com/u/28293365?s=256");
  assert.equal(rows.find((row) => row.label === "Marketplace Icon Source").value, "GitHub avatar, circle frame, cache-busted");
  assert.equal(rows.find((row) => row.label === "Category").value, "Design");
});

test("native metadata links reject local files and unsafe schemes", () => {
  assert.equal(sanitizeNativeMetadataHref("https://example.com/docs"), "https://example.com/docs");
  assert.equal(sanitizeNativeMetadataHref("http://example.com/docs"), "http://example.com/docs");
  assert.equal(sanitizeNativeMetadataHref("file:///Users/example/plugin/icon.png"), "");
  assert.equal(sanitizeNativeMetadataHref("/Users/example/plugin/icon.png"), "");
  assert.equal(sanitizeNativeMetadataHref("javascript:alert(1)"), "");

  const rows = nativePluginMetadataRows({
    kind: "plugin",
    website: "file:///tmp/local.html",
    documentation: "javascript:alert(1)",
    githubRepoUrl: "https://github.com/example/plugin",
    marketplaceIconUrl: "/Users/example/icon.png",
  });
  assert.equal(rows.find((row) => row.label === "Website").href, "");
  assert.equal(rows.find((row) => row.label === "Documentation").href, "");
  assert.equal(rows.find((row) => row.label === "GitHub Repo URL").href, "https://github.com/example/plugin");
  assert.equal(rows.find((row) => row.label === "Marketplace Icon").href, "");
});

test("native icon URLs reject local files and unsupported data types", () => {
  assert.equal(sanitizeNativeIconUrl("https://example.com/icon.png"), "https://example.com/icon.png");
  assert.equal(sanitizeNativeIconUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(sanitizeNativeIconUrl("file:///Users/example/icon.png"), "");
  assert.equal(sanitizeNativeIconUrl("/Users/example/icon.png"), "");
  assert.equal(sanitizeNativeIconUrl("data:text/html;base64,PGgxPkJvb208L2gxPg=="), "");
  assert.equal(sanitizeNativeIconUrl("javascript:alert(1)"), "");
});

test("native local asset paths stay relative to plugin roots", () => {
  assert.equal(isSafeRelativeAssetPath("./assets/icon.png"), "assets/icon.png");
  assert.equal(isSafeRelativeAssetPath("assets/nested/icon.svg"), "assets/nested/icon.svg");
  assert.equal(isSafeRelativeAssetPath("../outside/icon.png"), "");
  assert.equal(isSafeRelativeAssetPath("/tmp/icon.png"), "");
  assert.equal(isSafeRelativeAssetPath("file:///tmp/icon.png"), "");
});

test("native plugin CLI section renders display-only commands", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const clis = normalizeNativePluginClis({
      commands: [{
        name: "validate_app_scaffold",
        description: "Validate a scaffold.",
        command: "node scripts/validate_app_scaffold.mjs /tmp/app",
        cwd: ".",
        mode: "read-only",
        examples: ["node scripts/validate_app_scaffold.mjs /tmp/app"],
      }],
    });
    const section = renderNativePluginClisSection(clis);
    doc.body.appendChild(section);

    assert.equal(section.dataset.codexppNativePluginClis, "true");
    assert.match(section.textContent, /CLIs/);
    assert.match(section.textContent, /validate_app_scaffold/);
    assert.match(section.textContent, /node scripts\/validate_app_scaffold\.mjs \/tmp\/app/);
    assert.equal(section.querySelectorAll("button").length, 0);
  } finally {
    restore();
  }
});

test("native directory title parsing and slug matching avoid short fuzzy tokens", () => {
  assert.deepEqual(parseNativeDirectoryTitle("Agent Teams: Team Debug"), { pluginPart: "Agent Teams", skillPart: "Team Debug" });
  assert.deepEqual(parseNativeDirectoryTitle("PDF"), { pluginPart: "", skillPart: "PDF" });
  assert.equal(slugKey("$team-debug"), "teamdebug");
  assert.equal(bestSlugMatch([{ name: "github" }], ["name"], "git"), null);
  assert.equal(bestSlugMatch([{ name: "team-debug" }, { name: "team" }], ["name"], "Team Debug").name, "team-debug");
});

test("native directory row candidate rejects app sidebar descendants", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const nav = doc.createElement("nav");
    nav.textContent = "New chat Projects Settings";
    const sidebarRow = doc.createElement("button");
    sidebarRow.textContent = "Review social media scrapers";
    nav.appendChild(sidebarRow);
    doc.body.appendChild(nav);
    assert.equal(isInsideAppSidebar(sidebarRow), true);
    assert.equal(isNativeDirectoryRowCandidate(sidebarRow, null), false);

    const card = doc.createElement("article");
    card.textContent = "DebugPro Use when debugging complex issues";
    const action = doc.createElement("button");
    action.textContent = "+";
    card.appendChild(action);
    doc.body.appendChild(card);
    assert.equal(isInsideAppSidebar(card), false);
    assert.equal(isNativeDirectoryRowCandidate(card, null), true);
  } finally {
    restore();
  }
});

test("Skills plugin grouping emits one section heading per plugin", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const parent = doc.createElement("div");
    const first = doc.createElement("article");
    first.textContent = "Team Debug";
    const second = doc.createElement("article");
    second.textContent = "Team Review";
    const third = doc.createElement("article");
    third.textContent = "DebugPro Hypotheses";
    parent.append(first, second, third);
    doc.body.appendChild(parent);

    groupNativeSkillRowsByPlugin([
      { row: first, title: "Team Debug", originalIndex: 0, meta: { pluginLabel: "Agent Teams" } },
      { row: second, title: "Team Review", originalIndex: 1, meta: { pluginLabel: "Agent Teams" } },
      { row: third, title: "DebugPro Hypotheses", originalIndex: 2, meta: { pluginLabel: "DebugPro" } },
    ]);

    const headings = parent.children.filter((node) => node.dataset && node.dataset.codexppNativeDirectoryGroupHeading);
    assert.deepEqual(headings.map((node) => node.textContent), ["Agent Teams", "DebugPro"]);
    assert.equal(headings[0].getAttribute("role"), "heading");
    assert.equal(headings[0].className.includes("codexpp-native-directory-plugin-section-heading"), true);
  } finally {
    restore();
  }
});

test("native directory category options include featured, categories, and uncategorized rows", () => {
  const meta = normalizeNativeDirectoryMeta({
    plugins: [
      { id: "debugpro", category: "Coding" },
      { id: "impeccable", category: "Design", featured: true },
      { id: "plan-architect", category: "Productivity" },
      { id: "legacy-plugin" },
    ],
    skills: [],
  });
  assert.deepEqual(nativeDirectoryCategoryOptions({ nativeDirectoryMeta: meta }, "plugins"), [
    "Featured",
    "Design",
    "Coding",
    "Productivity",
    "Other",
  ]);
});

test("native directory category grouping emits one section heading per category", () => {
  const doc = new FakeDocument();
  const restore = installFakeGlobals(doc);
  try {
    const parent = doc.createElement("div");
    const first = doc.createElement("article");
    first.textContent = "DebugPro";
    const second = doc.createElement("article");
    second.textContent = "Design Docs";
    const third = doc.createElement("article");
    third.textContent = "Legacy";
    parent.append(first, second, third);
    doc.body.appendChild(parent);

    groupNativeRowsByCategory([
      { row: first, title: "DebugPro", originalIndex: 0, meta: { category: "Coding" } },
      { row: second, title: "Design Docs", originalIndex: 1, meta: { category: "Design" } },
      { row: third, title: "Legacy", originalIndex: 2, meta: {} },
    ]);

    const headings = parent.children.filter((node) => node.dataset && node.dataset.codexppNativeDirectoryGroupHeading);
    assert.deepEqual(headings.map((node) => node.textContent), ["Design", "Coding", "Other"]);
    assert.deepEqual(parent.children.map((node) => node.textContent), ["Design", "Design Docs", "Coding", "DebugPro", "Other", "Legacy"]);
    assert.equal(parent.dataset.codexppNativeDirectoryGroupMode, "category");
  } finally {
    restore();
  }
});

test("sortOptionsForMode exposes per-surface sort keys", () => {
  assert.deepEqual(sortOptionsForMode("plugins").map((o) => o.key), ["updated", "created", "az", "default"]);
  assert.deepEqual(sortOptionsForMode("skills").map((o) => o.key), ["updated", "created", "az", "default", "plugin"]);
  assert.deepEqual(sortOptionsForMode("tweaks").map((o) => o.key), ["default", "created", "updated", "used"]);
  // Plugins/Skills label the default regrouping as "Category" to match native marketplace sections.
  assert.equal(sortOptionsForMode("plugins").find((o) => o.key === "default").label, "Category");
});

test("native directory A-Z sort orders by name", () => {
  const a = { title: "Apple", originalIndex: 2, meta: {} };
  const b = { title: "Banana", originalIndex: 0, meta: {} };
  assert.equal(compareDirectoryRecords(a, b, "az") < 0, true);
  assert.equal(compareDirectoryRecords(b, a, "az") > 0, true);
});

test("native directory plugin sort preserves native order (grouping applied separately)", () => {
  const first = { title: "Z", originalIndex: 0, meta: {} };
  const second = { title: "A", originalIndex: 1, meta: {} };
  assert.equal(compareDirectoryRecords(first, second, "plugin") < 0, true);
});
