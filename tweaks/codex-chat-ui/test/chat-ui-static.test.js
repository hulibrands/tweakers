"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));

test("manifest supports settings and installed tweak reload IPC", () => {
  assert.equal(manifest.id, "co.thomashulihan.codex-chat-ui");
  assert.equal(manifest.scope, "both");
  assert.deepEqual(manifest.permissions, ["ipc", "settings"]);
  assert.match(source, /const IPC_RELOAD_TWEAKS = "codex-chat-ui:reload-tweaks"/);
  assert.match(source, /api\.codex\?\.tweaks/);
  assert.match(source, /Reload installed tweaks/);
});

test("settings include sample payload injection and React fiber probing", () => {
  assert.match(source, /Sample payload/);
  assert.match(source, /function samplePayloadText/);
  assert.match(source, /insertIntoComposer\(samplePayloadText\(\)\)/);
  assert.match(source, /React fiber probe/);
  assert.match(source, /function probeNativeMessageFiber/);
  assert.match(source, /api\.react/);
  assert.match(source, /getFiber\(node\)/);
  assert.match(source, /memoizedProps/);
});

test("all first release and expanded block kinds are registered", () => {
  for (const kind of ["summary_card", "action_list", "progress_panel", "data_table", "file_preview"]) {
    assert.match(source, new RegExp(`"${kind}"`));
    assert.match(source, new RegExp(`api\\.storage\\.get\\("${kind}", true\\)`));
  }
  assert.match(source, /renderSummaryCard/);
  assert.match(source, /renderActionList/);
  assert.match(source, /renderProgressPanel/);
  assert.match(source, /renderDataTable/);
  assert.match(source, /renderFilePreview/);
});

test("payload parsing stays data-only and hides source only after render", () => {
  assert.match(source, /codex_ui !== true/);
  assert.match(source, /Number\(parsed\.version \|\| 1\) !== 1/);
  assert.match(source, /sanitizeDataObject/);
  assert.match(source, /javascript:/);
  assert.match(source, /Invalid JSON should remain visible as normal chat text/);

  const noPayloadBranch = source.match(/if \(!record\?\.payload\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  const noRenderedBranch = source.match(/if \(renderedBlocks\.length === 0\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(noPayloadBranch, /showHiddenSourceBlocks\(node\)/);
  assert.match(noRenderedBranch, /showSourceBlocks\(record\.sourceBlocks\)/);
  assert.match(source, /hideSourceBlocks\(record\.sourceBlocks\)/);
});

test("fallback behavior and file tree rendering are present", () => {
  assert.match(source, /showFallbacks/);
  assert.match(source, /Unsupported block/);
  assert.match(source, /Block disabled/);
  assert.match(source, /role", "list"/);
  assert.doesNotMatch(source, /role", "tree"/);
  assert.doesNotMatch(source, /aria-level/);
  assert.match(source, /fileIconDescriptor/);
  assert.match(source, /fileStatusIcon/);
  assert.match(source, /codexpp-chat-ui-file-ext-ts/);
  assert.match(source, /codexpp-chat-ui-file-ext-md/);
  assert.match(source, /Copy path/);
  assert.match(source, /normalizeFiles/);
  assert.match(source, /normalizeColumns/);
  assert.match(source, /codexpp-chat-ui-table-scroll/);
});
