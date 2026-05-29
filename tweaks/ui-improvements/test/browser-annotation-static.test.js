"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("browser annotation composer defaults to adding notes before direct send", () => {
  assert.match(source, /startMainBrowserAnnotationComposerModePatch\(api\)/);
  assert.match(source, /BROWSER_ANNOTATION_DEFAULT_MODE_TARGET = "defaultCreateSubmitMode:`direct`,session:"/);
  assert.match(source, /BROWSER_ANNOTATION_DEFAULT_MODE_REPLACEMENT = "defaultCreateSubmitMode:`saved`,session:"/);
  assert.match(source, /BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_TARGET/);
  assert.match(source, /BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_REPLACEMENT/);
  assert.match(source, /\^\(composer\|annotation-comment-editor-card\|thread-side-panel-tabs\)-\[A-Za-z0-9_-\]\+\\\.js\$/);
  assert.match(source, /(?:browserAnnotationDefaultModePatch|patchBrowserAnnotationDefaultMode)\(originalText\)/);
  assert.match(source, /response\.clone/);
  assert.match(source, /return response/);
});

test("browser annotation transparency is scoped to the comment editor surface", () => {
  assert.match(source, /id: "browser-annotation-transparent-card"/);
  assert.match(source, /"browser-annotation-transparent-card": true/);
  assert.match(source, /const STYLE_ID = "codexpp-browser-annotation-transparent-card"/);
  assert.match(source, /const ROOT_ATTR = "data-codexpp-browser-annotation-transparent-card"/);
  assert.match(source, /document\.documentElement\.setAttribute\(ROOT_ATTR, "true"\)/);
  assert.match(source, /document\.documentElement\.removeAttribute\(ROOT_ATTR\)/);
  assert.ok(source.includes("html[${ROOT_ATTR}].compact-window:has(#browser-sidebar-comment-popup-root)"));
  assert.match(source, /#browser-sidebar-comment-popup-root/);
  assert.match(source, /\[data-browser-comment-editor-surface\]/);
  assert.match(source, /\[data-browser-comment-design-prompt-shell\]/);
  assert.match(source, /\[data-browser-comment-editor-footer-actions\]/);
  assert.match(source, /\[data-browser-comment-submit\]/);
  assert.match(source, /\[data-browser-sidebar-design-editor-toggle\]/);
  assert.match(source, /pointer-events: auto !important/);
  assert.match(source, /background: transparent !important/);
  assert.match(source, /background-color: transparent !important/);
  const editorSurfaceRule = extractCssRule(
    source,
    "#browser-sidebar-comment-popup-root [data-browser-comment-editor-surface] {",
  );
  assert.match(editorSurfaceRule, /#fff/);
  assert.doesNotMatch(editorSurfaceRule, /transparent/);
  assert.match(source, /background: var\(--color-token-dropdown-background/);
  assert.doesNotMatch(source, /<card-root-selector>|<card-backdrop-selector>|<composer-selector>|<toolbar-selector>/);
});

test("browser annotation composer patch is gated to exactly one known legacy chunk", () => {
  const {
    BROWSER_ANNOTATION_DEFAULT_MODE_TARGET: target,
    BROWSER_ANNOTATION_DEFAULT_MODE_REPLACEMENT: replacement,
    BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_TARGET: threadTarget,
    BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_REPLACEMENT: threadReplacement,
    browserAnnotationDefaultModePatch,
    isBrowserAnnotationRendererAsset,
    patchBrowserAnnotationDefaultMode,
  } = loadBrowserAnnotationPatchInternals(source);

  const helperBody = extractFunctionBody(source, "browserAnnotationDefaultModePatch");
  assert.match(helperBody, /candidates\.length\s*===\s*0/);
  assert.match(helperBody, /candidates\.length\s*!==\s*1/);
  assert.match(helperBody, /changed:\s*false/);
  assert.match(helperBody, /changed:\s*true/);
  assert.match(helperBody, /countOccurrences\(patched,\s*rewrite\.target\)\s*!==\s*0/);
  assert.match(helperBody, /countOccurrences\(patched,\s*rewrite\.replacement\)\s*!==\s*rewrite\.replacementCount\s*\+\s*1/);

  const legacyChunk = `alpha ${target} omega`;
  const savedChunk = `alpha ${replacement} omega`;
  const threadPanelChunk = `alpha ${threadTarget} omega`;
  const savedThreadPanelChunk = `alpha ${threadReplacement} omega`;
  const duplicateLegacyChunk = `alpha ${target} middle ${target} omega`;
  const ambiguousMixedChunk = `alpha ${target} middle ${threadTarget} omega`;
  const unknownChunk = "alpha defaultCreateSubmitMode:`manual`,session: omega";

  assert.equal(
    isBrowserAnnotationRendererAsset("app://codex/webview/assets/thread-side-panel-tabs-BL2fcy4d.js"),
    true,
  );
  assert.equal(
    isBrowserAnnotationRendererAsset("app://codex/webview/assets/annotation-comment-editor-card-B1cyUkU2.js"),
    true,
  );

  assert.deepEqual(plainObject(browserAnnotationDefaultModePatch(legacyChunk)), {
    changed: true,
    source: savedChunk,
    reason: "legacy-direct-submit",
  });
  assert.equal(patchBrowserAnnotationDefaultMode(legacyChunk), savedChunk);

  assert.deepEqual(plainObject(browserAnnotationDefaultModePatch(threadPanelChunk)), {
    changed: true,
    source: savedThreadPanelChunk,
    reason: "thread-panel-direct-submit",
  });
  assert.equal(patchBrowserAnnotationDefaultMode(threadPanelChunk), savedThreadPanelChunk);

  assert.deepEqual(plainObject(browserAnnotationDefaultModePatch(savedChunk)), {
    changed: false,
    source: savedChunk,
    reason: "current-or-unknown-asset",
  });
  assert.equal(patchBrowserAnnotationDefaultMode(savedChunk), savedChunk);

  assert.deepEqual(plainObject(browserAnnotationDefaultModePatch(duplicateLegacyChunk)), {
    changed: false,
    source: duplicateLegacyChunk,
    reason: "ambiguous-legacy-target",
  });
  assert.equal(patchBrowserAnnotationDefaultMode(duplicateLegacyChunk), duplicateLegacyChunk);

  assert.deepEqual(plainObject(browserAnnotationDefaultModePatch(ambiguousMixedChunk)), {
    changed: false,
    source: ambiguousMixedChunk,
    reason: "ambiguous-legacy-target",
  });
  assert.equal(patchBrowserAnnotationDefaultMode(ambiguousMixedChunk), ambiguousMixedChunk);

  assert.deepEqual(plainObject(browserAnnotationDefaultModePatch(unknownChunk)), {
    changed: false,
    source: unknownChunk,
    reason: "current-or-unknown-asset",
  });
  assert.equal(patchBrowserAnnotationDefaultMode(unknownChunk), unknownChunk);
});

function plainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBrowserAnnotationPatchInternals(sourceText) {
  const context = {
    module: { exports: {} },
    globalThis: {},
    URL,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(
    `${sourceText}
globalThis.__browserAnnotationPatchInternals = {
  BROWSER_ANNOTATION_DEFAULT_MODE_TARGET,
  BROWSER_ANNOTATION_DEFAULT_MODE_REPLACEMENT,
  BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_TARGET,
  BROWSER_ANNOTATION_THREAD_PANEL_DEFAULT_MODE_REPLACEMENT,
  browserAnnotationDefaultModePatch,
  isBrowserAnnotationRendererAsset,
  patchBrowserAnnotationDefaultMode,
};`,
    context,
    { filename: "ui-improvements-index.js" },
  );

  return context.globalThis.__browserAnnotationPatchInternals;
}

function extractFunctionBody(sourceText, name) {
  const marker = `function ${name}`;
  const markerIndex = sourceText.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing function: ${name}`);
  return extractBlockStartingAt(sourceText, sourceText.indexOf("{", markerIndex));
}

function extractCssRule(sourceText, selector) {
  const selectorIndex = sourceText.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `missing CSS selector: ${selector}`);
  const endIndex = sourceText.indexOf("}", selectorIndex);
  assert.notEqual(endIndex, -1, `missing CSS rule end: ${selector}`);
  return sourceText.slice(selectorIndex, endIndex + 1);
}

function extractBlockStartingAt(sourceText, startBrace) {
  assert.notEqual(startBrace, -1, "missing opening brace");

  let depth = 0;
  for (let i = startBrace; i < sourceText.length; i++) {
    const char = sourceText[i];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return sourceText.slice(startBrace + 1, i);
  }

  assert.fail("missing closing brace");
}
