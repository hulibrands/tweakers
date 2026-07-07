"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("tweak mention menu ignores ordinary typing until the menu is active", () => {
  const feature = extractFeatureSource("tweak-mention-menu");

  assert.match(feature, /const inputData = typeof event\?\.data === "string" \? event\.data : "";/);
  assert.match(feature, /const inputType = typeof event\?\.inputType === "string" \? event\.inputType : "";/);
  assert.match(feature, /if \(!menu && !inputData\.includes\("%"\)\) \{/);
  assert.match(feature, /const shouldFallbackScan = !inputType \|\| inputType === "insertFromPaste" \|\| inputType === "insertFromDrop";/);
  assert.match(feature, /if \(!shouldFallbackScan \|\| !findTweakMentionTrigger\(target\)\) return;/);
  assert.match(feature, /if \(event\?\.data !== "%"\) return;/);
  assert.doesNotMatch(feature, /event\?\.data !== "%" && event\?\.inputType !== "insertText"/);
});

test("tweak mention menu coalesces selection refresh work", () => {
  const feature = extractFeatureSource("tweak-mention-menu");

  assert.match(feature, /let refreshFrame = 0;/);
  assert.match(feature, /let pendingRefreshTarget = null;/);
  assert.match(feature, /if \(refreshFrame\) return;/);
  assert.match(feature, /refreshFrame = requestAnimationFrame/);
  assert.match(feature, /const nextTarget = pendingRefreshTarget;/);
  assert.match(feature, /if \(!menu\) return;/);
  assert.match(feature, /scheduleRefresh\(target\);/);
  assert.match(feature, /cancelAnimationFrame\(refreshFrame\)/);
});

function extractFeatureSource(name) {
  const marker = `"${name}"(api)`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find feature ${name}`);
  const open = source.indexOf("{", start);
  const close = findMatchingBrace(source, open);
  return source.slice(start, close + 1);
}

function findMatchingBrace(text, openIndex) {
  assert.equal(text[openIndex], "{", "expected open brace");
  let depth = 0;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("No matching closing brace found");
}
