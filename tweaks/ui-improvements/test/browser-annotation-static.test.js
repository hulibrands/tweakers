"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("browser annotation composer defaults to adding notes before direct send", () => {
  assert.match(source, /startMainBrowserAnnotationComposerModePatch\(api\)/);
  assert.match(source, /BROWSER_ANNOTATION_DEFAULT_MODE_TARGET = "defaultCreateSubmitMode:`direct`,session:"/);
  assert.match(source, /BROWSER_ANNOTATION_DEFAULT_MODE_REPLACEMENT = "defaultCreateSubmitMode:`saved`,session:"/);
  assert.match(source, /\^\(composer\|annotation-comment-editor-card\)-\[A-Za-z0-9_-\]\+\\\.js\$/);
  assert.match(source, /patchBrowserAnnotationDefaultMode\(originalText\)/);
  assert.match(source, /response\.clone/);
  assert.match(source, /return response/);
});
