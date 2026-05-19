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
  assert.match(source, /"sidebar-chat-multi-select": true/);
  assert.match(source, /"show-pinned-chat-project-names": true/);
  assert.match(source, /startMainProjectLabelProvider\(api\)/);
  assert.match(source, /startMainSidebarBatchMenuProvider\(api\)/);
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

test("copy folder path has a live context-menu verification placeholder", (t) => {
  t.skip("Codex app UI automation is blocked for com.openai.codex in this environment; run this check when UI automation is available.");
});
