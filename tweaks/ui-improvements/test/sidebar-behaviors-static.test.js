"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("local UI Improvements owns restored Bennett sidebar behaviors", () => {
  assert.match(source, /id: "sidebar-chat-multi-select"/);
  assert.match(source, /id: "show-pinned-chat-project-names"/);
  assert.match(source, /id: "clarify-stale-chat-branch-label"/);
  assert.match(source, /"sidebar-chat-multi-select": true/);
  assert.match(source, /"show-pinned-chat-project-names": true/);
  assert.match(source, /"clarify-stale-chat-branch-label": true/);
  assert.match(source, /startMainProjectLabelProvider\(api\)/);
  assert.match(source, /startMainSidebarBatchMenuProvider\(api\)/);
});

test("stale branch hover copy is clarified as historical metadata", () => {
  assert.match(source, /Chat branch reflects active branch when last used/);
  assert.match(source, /Last used chat branch; opening or sending in the chat refreshes it/);
  assert.match(source, /data-codexpp-stale-branch-label-clarified/);
  assert.match(source, /NodeFilter\.SHOW_ELEMENT \| NodeFilter\.SHOW_TEXT/);
  assert.match(source, /String\(text \|\| ""\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\)/);
  assert.match(source, /node\.nodeValue = REPLACEMENT/);
  assert.doesNotMatch(source, /node\.nodeValue = String\(node\.nodeValue\)\.replace\(ORIGINAL, REPLACEMENT\)/);
});

test("pinned chat project labels use main-process project lookup and live color hints", () => {
  assert.match(source, /"show-pinned-chat-project-names"\(api\)/);
  assert.match(source, /api\.ipc\.invoke\("pinned-chat-project-labels", ids\)/);
  assert.match(source, /function createProjectLabelService\(api\)/);
  assert.match(source, /function readConversationProjectLabels\(\)/);
  assert.match(source, /data-codexpp-pinned-chat-project-name/);
  assert.match(source, /--codexpp-pinned-chat-project-color/);
  assert.match(source, /window\.addEventListener\(BRIDGE_EVENT, scheduleApply\)/);
});

test("legacy ShadGPT branding scrubber covers interactive app chrome", () => {
  assert.match(source, /startMainLegacyBrandUiScrubber\(api\)/);
  assert.match(source, /MAIN_LEGACY_BRAND_SCRUBBER_KEY/);
  assert.match(source, /executeJavaScript\(script, true\)/);
  assert.match(source, /web-contents-created/);
  assert.match(source, /startLegacyBrandUiScrubber\(api\)/);
  assert.match(source, /LEGACY_BRAND_UI_SELECTOR/);
  assert.ok(source.includes("Codex\\\\+\\\\+"));
  assert.match(source, /\[role='option'\]/);
  assert.match(source, /\[data-codexpp-store-grid\]/);
  assert.match(source, /placeholder", "value"/);
  assert.match(source, /input, textarea, \[contenteditable='true'\], \[contenteditable='plaintext-only'\]/);
  assert.match(source, /legacy ShadGPT UI branding scrubber active/);
});

test("sidebar chat multi-select wires selection markers and native batch menu", () => {
  assert.match(source, /"sidebar-chat-multi-select"\(api\)/);
  assert.match(source, /data-codexpp-sidebar-chat-selected/);
  assert.match(source, /data-codexpp-sidebar-chat-selected-target/);
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey/);
  assert.match(source, /api\.ipc\.invoke\("sidebar-chat-batch-menu"/);
  assert.match(source, /label: `Pin \$\{count\} chat\$\{suffix\}`/);
  assert.match(source, /label: `Archive \$\{count\} chat\$\{suffix\}`/);
  assert.match(source, /label: `Open \$\{count\} mini window\$\{suffix\}`/);
});

test("sidebar chat multi-select recognizes non-Radix Codex menu popovers", () => {
  assert.match(source, /closestNativeMenu/);
  assert.match(source, /isBoundedMenuPopover/);
  assert.match(source, /nativeMenuItems/);
  assert.match(source, /openMenuRoots/);
  assert.match(source, /Open in mini window/i);
  assert.match(source, /\[data-radix-menu-content\]/);
  assert.match(source, /\[data-radix-popper-content-wrapper\]/);
  assert.doesNotMatch(
    source,
    /document\.querySelectorAll\('\[role="menu"\]\[data-state="open"\] \[role="menuitem"\], \[role="menu"\] \[role="menuitem"\]'\)/,
  );
});

test("copy folder path has a live context-menu verification placeholder", (t) => {
  t.skip("Codex app UI automation is blocked for com.openai.codex in this environment; run this check when UI automation is available.");
});
