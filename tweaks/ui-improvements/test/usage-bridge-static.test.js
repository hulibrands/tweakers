"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("usage request bridge dispatches through the injected page bridge before fallback", () => {
  assert.match(source, /let usageBridgeReady = false;/);
  assert.match(source, /dispatchReady\(true\);/);
  assert.match(source, /dispatchReady\(false\);/);
  assert.match(source, /if \(usageBridgeReady\) return;/);
});

test("usage bridge ready event is reusable across hot reloads", () => {
  const listenerOptions = source.match(
    /window\.addEventListener\(\s*"codexpp-usage-bridge-ready",[\s\S]*?\n\s*\);/,
  )?.[0] ?? "";

  assert.doesNotMatch(listenerOptions, /once:\s*true/);
});

test("sidebar project color bridge uses shadcn 700 color families", () => {
  assert.match(source, /id: "blue", label: "Blue", value: "#1d4ed8"/);
  assert.match(source, /id: "rose", label: "Rose", value: "#be123c"/);
  assert.match(source, /id: "mauve", label: "Mauve", value: "#524959"/);
  assert.doesNotMatch(source, /\[\$\{ATTR\}="row"\][\s\S]*?font-size: calc\(1rem - 2px\) !important/);
  assert.doesNotMatch(source, /\[\$\{ATTR\}="row"\] :where\(a, button, div, p, span\)/);
  assert.doesNotMatch(source, /\[\$\{ATTR\}="title"\][\s\S]*?font-size: inherit !important/);
  assert.match(source, /\[\$\{ATTR\}="title"\][\s\S]*?font-weight: 700 !important/);
  assert.match(source, /\[\$\{ATTR\}="icon"\][\s\S]*?color-mix/);
  assert.doesNotMatch(source, /id: "primary",\s*label: "Primary"/);
});

test("Shadcn settings bridge exposes project color controls", () => {
  assert.match(source, /window\.__codexppUiImprovements = bridge/);
  assert.match(source, /getProjectColors\(\)[\s\S]*PROJECT_COLOR_STORAGE_KEY/);
  assert.match(source, /setProjectColor\(projectKey, colorId\)/);
  assert.match(source, /getProjectRows\(\)[\s\S]*discoverProjectRows\(\)/);
  assert.match(source, /window\.addEventListener\(COLOR_EVENT, onProjectColorChanged\)/);
});

test("project context menu restores Bennett copy path action", () => {
  assert.match(source, /label: "Copy folder path"/);
  assert.match(source, /projectPath: projectPathForRow\(row\)/);
  assert.match(source, /copyText\(projectPath\)/);
  assert.match(source, /nativeMenu\.insertBefore\(copyPathItem, removeItem\)/);
});

test("sidebar project rows do not render expanded projects as cards", () => {
  const rowRule = source.match(
    /\[\$\{ATTR\}="row"\] \{([\s\S]*?)\n\s+\}/,
  )?.[1] ?? "";
  const listRule = source.match(
    /\[\$\{ATTR\}="project-list"\] \{([\s\S]*?)\n\s+\}/,
  )?.[1] ?? "";

  assert.match(rowRule, /background-color: transparent !important/);
  assert.match(rowRule, /box-shadow: none !important/);
  assert.match(listRule, /gap: 0 !important/);
  assert.doesNotMatch(rowRule, /border-radius/);
  assert.doesNotMatch(rowRule, /inset 0 0 0 1px/);
});

test("sidebar project row detection supports Codex sidebar overflow variants", () => {
  const selectorBlock = source.match(
    /"sidebar-project-backgrounds"\(api\) \{[\s\S]*?const ASIDE_SELECTOR = \[([\s\S]*?)\]\.join\(", "\);/,
  )?.[1] ?? "";

  assert.match(selectorBlock, /aside\.pointer-events-auto\.relative\.flex\.overflow-hidden/);
  assert.match(selectorBlock, /aside\.pointer-events-auto\.relative\.flex\.overflow-visible/);
  assert.match(selectorBlock, /aside\.pointer-events-auto\.relative\.flex"/);
  assert.match(
    source,
    /aside\.pointer-events-auto\.relative\.flex\.overflow-visible\s*\n\s*\[role="button"\]\.hover/,
  );
});
