"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

const CANONICAL_FEATURE_IDS = [
  "hide-upgrade-prompts",
  "show-usage-in-sidebar",
  "show-message-metrics-on-hover",
  "square-sidebar",
  "browser-annotation-transparent-card",
  "match-sidebar-width",
  "sidebar-action-grid",
  "sidebar-project-backgrounds",
  "sidebar-chat-multi-select",
  "show-pinned-chat-project-names",
  "clarify-stale-chat-branch-label",
  "settings-search",
  "slash-menu-polish",
  "tweak-mention-menu",
];

test("canonical feature ids are consistent across tweak registries", () => {
  const registries = {
    FEATURE_DEFS: extractFeatureDefIds(source),
    DEFAULT_FEATURE_FLAGS: extractDefaultFlagIds(source),
    FEATURES: extractFeatureHandlerIds(source),
  };

  for (const [name, ids] of Object.entries(registries)) {
    assertCanonicalRegistry(name, ids);
  }

  assert.deepEqual(
    new Set(registries.FEATURE_DEFS),
    new Set(registries.DEFAULT_FEATURE_FLAGS),
    "FEATURE_DEFS and DEFAULT_FEATURE_FLAGS should describe the same feature ids",
  );
  assert.deepEqual(
    new Set(registries.FEATURE_DEFS),
    new Set(registries.FEATURES),
    "FEATURE_DEFS and FEATURES should describe the same feature ids",
  );
});

test("mutation observers do not synchronously run full-document scanners", () => {
  const offenders = collectMutationObservers(source)
    .filter((observer) => !usesScheduler(observer.callback))
    .filter((observer) => isFullDocumentScanner(observer.callback))
    .map((observer) => formatObserver(observer));

  assert.deepEqual(
    offenders,
    [],
    "MutationObserver callbacks must schedule expensive scans instead of running them synchronously",
  );
});

test("broad mutation observers use a scheduler or documented cheap callback", () => {
  const offenders = collectMutationObservers(source)
    .filter((observer) => observer.isBroad)
    .filter((observer) => !usesScheduler(observer.callback))
    .filter((observer) => !hasDocumentedCheapCallback(observer))
    .map((observer) => formatObserver(observer));

  assert.deepEqual(
    offenders,
    [],
    "Broad document/body observers must use a scheduler or document why their callback is cheap",
  );
});

function assertCanonicalRegistry(name, ids) {
  assert.equal(ids.length, new Set(ids).size, `${name} should not contain duplicate feature ids`);

  const actual = new Set(ids);
  const expected = new Set(CANONICAL_FEATURE_IDS);
  const missing = CANONICAL_FEATURE_IDS.filter((id) => !actual.has(id));
  const extra = ids.filter((id) => !expected.has(id));

  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${name} should contain exactly the canonical feature ids`,
  );
}

function extractFeatureDefIds(text) {
  const block = extractDelimitedInitializer(text, "FEATURE_DEFS", "[", "]");
  return matchAll(block, /\bid:\s*"([^"]+)"/g);
}

function extractDefaultFlagIds(text) {
  const block = extractDelimitedInitializer(text, "DEFAULT_FEATURE_FLAGS", "{", "}");
  return matchAll(block, /"([^"]+)":\s*(?:true|false)\b/g);
}

function extractFeatureHandlerIds(text) {
  const block = extractDelimitedInitializer(text, "FEATURES", "{", "}");
  return matchAll(block, /^\s*"([^"]+)"\s*\(/gm);
}

function collectMutationObservers(text) {
  const observers = [];
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+MutationObserver\s*\(/g;
  let match;

  while ((match = re.exec(text))) {
    const variableName = match[1];
    const callbackStart = re.lastIndex;
    const callbackEnd = findMatchingParen(text, callbackStart - 1);
    const callbackExpression = text.slice(callbackStart, callbackEnd).trim();
    const body = extractCallbackBody(text, callbackExpression);
    const observeCall = findObserveCall(text, variableName, callbackEnd);
    const context = text.slice(Math.max(0, match.index - 700), observeCall?.end ?? callbackEnd);

    observers.push({
      variableName,
      callbackExpression,
      callback: {
        expression: callbackExpression,
        body,
      },
      context,
      isBroad: Boolean(observeCall?.isBroad),
      index: match.index,
    });

    re.lastIndex = callbackEnd + 1;
  }

  return observers;
}

function extractCallbackBody(text, expression) {
  const callbackName = expression.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  if (callbackName) return extractNamedFunctionBody(text, callbackName);

  const arrowStart = expression.indexOf("=>");
  if (arrowStart !== -1) {
    const bodyStart = expression.indexOf("{", arrowStart);
    if (bodyStart === -1) return expression.slice(arrowStart + 2);
    const bodyEnd = findMatchingBrace(expression, bodyStart);
    return expression.slice(bodyStart + 1, bodyEnd);
  }

  return expression;
}

function extractNamedFunctionBody(text, name) {
  const constRe = new RegExp(`(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*(?:\\([^)]*\\)|[^=;()]+)\\s*=>\\s*\\{`, "m");
  const constMatch = constRe.exec(text);
  if (constMatch) {
    const bodyStart = constMatch.index + constMatch[0].lastIndexOf("{");
    const bodyEnd = findMatchingBrace(text, bodyStart);
    return text.slice(bodyStart + 1, bodyEnd);
  }

  const fnRe = new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*\\{`, "m");
  const fnMatch = fnRe.exec(text);
  if (fnMatch) {
    const bodyStart = fnMatch.index + fnMatch[0].lastIndexOf("{");
    const bodyEnd = findMatchingBrace(text, bodyStart);
    return text.slice(bodyStart + 1, bodyEnd);
  }

  return "";
}

function findObserveCall(text, variableName, startIndex) {
  const nextObserver = text.indexOf("new MutationObserver", startIndex + 1);
  const searchEnd = nextObserver === -1 ? text.length : nextObserver;
  const slice = text.slice(startIndex, searchEnd);
  const observeRe = new RegExp(`\\b${escapeRegExp(variableName)}\\.observe\\s*\\(`, "m");
  const match = observeRe.exec(slice);
  if (!match) return null;

  const openParen = startIndex + match.index + match[0].lastIndexOf("(");
  const closeParen = findMatchingParen(text, openParen);
  const args = text.slice(openParen + 1, closeParen);
  const isBroad =
    /document\.(?:body|documentElement)\b/.test(args) &&
    /\bsubtree\s*:\s*true\b/.test(args);

  return { args, end: closeParen + 1, isBroad };
}

function usesScheduler(callback) {
  return (
    /\b(?:schedule|scheduled|debounce|throttle)/i.test(callback.expression) ||
    /\bschedule[A-Za-z0-9_$]*\s*\(/.test(callback.body) ||
    /\b(?:requestAnimationFrame|requestIdleCallback|setTimeout)\s*\(/.test(callback.body)
  );
}

function isFullDocumentScanner(callback) {
  return (
    /\bscan\w*\b/i.test(callback.expression) ||
    /\bcreateTreeWalker\s*\(/.test(callback.body) ||
    /\bdocument\.querySelectorAll\s*\(/.test(callback.body) ||
    /\b(?:document\.body|document\.documentElement)\b[\s\S]{0,160}\b(?:querySelectorAll|textContent|createTreeWalker)\b/.test(callback.body)
  );
}

function hasDocumentedCheapCallback(observer) {
  return (
    /\b(?:cheap callback|cheap observer|documented cheap|O\(1\)|constant-time)\b/i.test(observer.context) &&
    !/\b(?:querySelectorAll|createTreeWalker|textContent)\b/.test(observer.callback.body)
  );
}

function formatObserver(observer) {
  return `${observer.variableName}: ${observer.callback.expression.split(/\s+/).slice(0, 4).join(" ")}`;
}

function extractDelimitedInitializer(text, name, openChar, closeChar) {
  const assignment = new RegExp(`const\\s+${escapeRegExp(name)}\\s*=\\s*(?:Object\\.freeze\\()?\\s*\\${openChar}`, "m").exec(text);
  assert.ok(assignment, `Could not find ${name}`);

  const openIndex = assignment.index + assignment[0].lastIndexOf(openChar);
  const closeIndex = openChar === "{" ? findMatchingBrace(text, openIndex) : findMatchingBracket(text, openIndex);
  return text.slice(openIndex + 1, closeIndex);
}

function matchAll(text, re) {
  return Array.from(text.matchAll(re), (match) => match[1]);
}

function findMatchingParen(text, openIndex) {
  return findMatchingDelimiter(text, openIndex, "(", ")");
}

function findMatchingBrace(text, openIndex) {
  return findMatchingDelimiter(text, openIndex, "{", "}");
}

function findMatchingBracket(text, openIndex) {
  return findMatchingDelimiter(text, openIndex, "[", "]");
}

function findMatchingDelimiter(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      index = text.indexOf("\n", index);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) break;
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;
    if (depth === 0) return index;
  }

  throw new Error(`No matching ${closeChar} found`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
