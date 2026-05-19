"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

test("Shadcn tab does not mirror native Appearance values", () => {
  const clearBody = source.match(/function clearAppearanceOverride\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.doesNotMatch(source, /renderAppearanceOverride/);
  assert.doesNotMatch(source, /data-codexpp-shadcn-appearance-preview/);
  assert.doesNotMatch(source, /Appearance Theme/);
  assert.doesNotMatch(source, /#0169CC/i);
  assert.doesNotMatch(source, /#2563eb/i);
  assert.doesNotMatch(source, /#0ea5e9/i);
  assert.doesNotMatch(clearBody, /data-codexpp-shadcn-appearance-root/);
});

test("native appearance discovery targets the existing Appearance tab", () => {
  const discoveryBody = source.match(/function findNativeAppearanceRoot\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const guardBody = source.match(/function looksLikeNativeAppearancePanel\(node\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(discoveryBody, /ownText\(node\) === "Appearance"/);
  assert.match(guardBody, /Use light, dark, or match your system/);
});

test("Codex++ repair settings controls stay scoped and responsive", () => {
  assert.match(source, /\[data-codexpp-config-card\]/);
  assert.match(source, /\[data-codexpp-repair-card\]/);
  assert.match(source, /\[data-codexpp-settings-row\]/);
  assert.match(source, /button:not\(\[role="switch"\]\)/);
  assert.match(source, /@media \(max-width: 720px\)[\s\S]*\[data-codexpp-settings-row\][\s\S]*flex-direction: column/);
});

test("Codex++ settings sidebar stays constrained and scrollable", () => {
  assert.match(source, /\[data-codexpp-settings-sidebar="true"\]/);
  assert.match(source, /overflow-y: auto !important/);
  assert.match(source, /scrollbar-gutter: stable !important/);
  assert.match(source, /flex: 0 0 min\(320px, calc\(100vw - 32px\)\) !important/);
});

test("project colors use shadcn color families at the 700 tint", () => {
  assert.match(source, /const SHADCN_COLOR_TINT = 700/);
  assert.match(source, /id: "blue", label: "Blue", value: "#1d4ed8"/);
  assert.match(source, /id: "rose", label: "Rose", value: "#be123c"/);
  assert.match(source, /\$\{option\.id\}-\$\{SHADCN_COLOR_TINT\}/);
  assert.doesNotMatch(source, /id: "primary",\s*label: "Primary"/);
});

test("core theme uses Geist and shadcn default neutral theme tokens", () => {
  assert.match(source, /const chunks = \[fontFaceCss\(fontAssetUrls\), baseResetCss\(\), coreTokenCss\(\), shadcnThemeOverrideCss\(\)\]\.filter\(Boolean\)/);
  assert.match(source, /FONT_SOURCE_PACKAGES/);
  assert.match(source, /@fontsource-variable\/geist@5\.2\.9/);
  assert.match(source, /@fontsource-variable\/geist-mono@5\.2\.8/);
  assert.match(source, /assets\/fonts\/geist-latin-wght-normal\.woff2/);
  assert.match(source, /assets\/fonts\/geist-mono-latin-wght-normal\.woff2/);
  assert.match(source, /api\.assets\?\.url/);
  assert.match(source, /api\.ipc\.invoke\(\"asset-url\", relPath\)/);
  assert.doesNotMatch(source, /data:font\/woff2;base64/);
  assert.match(source, /font-family: \"\$\{def\.family\}\"/);
  assert.match(source, /--codexpp-shadcn-font-size-base: 14px/);
  assert.match(source, /font-size: var\(--codexpp-shadcn-font-size-base\) !important/);
  assert.match(source, /html\[\$\{ROOT_ATTR\}\] body \{[\s\S]*?font-size: var\(--codexpp-shadcn-font-size-base\)/);
  assert.match(source, /--font-sans: "Geist", "Geist Sans"/);
  assert.match(source, /--font-mono: "Geist Mono"/);
  assert.match(source, /--primary: oklch\(0\.205 0 0\)/);
  assert.match(source, /--ring: oklch\(0\.708 0 0\)/);
  assert.match(source, /--chart-1: oklch\(0\.646 0\.222 41\.116\)/);
  assert.match(source, /--sidebar-primary: oklch\(0\.488 0\.243 264\.376\)/);
});

test("settings page exposes live font diagnostics", () => {
  assert.match(source, /renderFontDiagnosticsCard/);
  assert.match(source, /data-codexpp-shadcn-font-diagnostics/);
  assert.match(source, /document\.fonts\?\.check/);
  assert.match(source, /Geist Sans/);
  assert.match(source, /Geist Mono/);
});

test("project group backgrounds preserve the assigned project tint", () => {
  const backgroundRules = source.match(
    /html\[\$\{ROOT_ATTR\}\] \[data-codexpp-sidebar-project-backgrounds="row"\] \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  assert.match(backgroundRules, /--codexpp-project-tint/);
  assert.match(backgroundRules, /--codexpp-project-text-color/);
  assert.doesNotMatch(backgroundRules, /font-size: calc\(1rem - 2px\) !important/);
  assert.doesNotMatch(backgroundRules, /background:\s*var\(--card/);
  assert.doesNotMatch(source, /\[data-codexpp-sidebar-project-backgrounds="row"\] :where\(a, button, div, p, span\)/);
  assert.match(source, /\[data-codexpp-sidebar-project-backgrounds="icon"\] \{[\s\S]*?color-mix/);
  assert.match(source, /\[data-codexpp-sidebar-project-backgrounds="title"\] \{[\s\S]*?--codexpp-project-text-color/);
  assert.doesNotMatch(source, /\[data-codexpp-sidebar-project-backgrounds="title"\] \{[\s\S]*?font-size: inherit !important/);
  assert.match(source, /\[data-codexpp-sidebar-project-backgrounds="title"\] \{[\s\S]*?font-weight: 700 !important/);
});
