"use strict";

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tweakDir = join(__dirname, "..");
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
const uiImprovementsSource = readFileSync(resolveSiblingTweakFile("ui-improvements", "index.js"), "utf8");

function resolveSiblingTweakFile(tweakName, relPath) {
  const candidates = [
    join(tweakDir, "..", tweakName, relPath),
    join(tweakDir, "..", `thomashulihan-${tweakName}`, relPath),
    join(tweakDir, "..", `co.thomashulihan.${tweakName}`, relPath),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Unable to resolve sibling tweak ${tweakName}: ${candidates.join(", ")}`);
  return found;
}

test("manifest declares permissions used by font assets and Settings page", () => {
  assert.deepEqual(manifest.permissions, ["ipc", "settings"]);
  assert.match(source, /api\.ipc\.handle\("asset-url"/);
  assert.match(source, /api\.ipc\.invoke\("asset-url", relPath\)/);
  assert.match(source, /api\.settings\.registerPage/);
  assert.match(source, /title: "Style \+ Design"/);
});

test("ShadGPT fork is the deterministic Shadcn conflict owner", () => {
  assert.equal(manifest.id, "co.thomashulihan.shadcn-codex-ui");
  assert.equal(manifest.forkOf?.upstreamId, "co.Arconte112.shadcn-codex-ui");
  assert.match(source, /const OWNER_ID = SHADGPT_OWNER_ID/);
  assert.match(source, /const OWNER_PRIORITY = 100/);
  assert.match(source, /const ROOT_OWNER_ATTR = "data-codexpp-shadcn-ui-owner"/);
  assert.match(source, /const ACTIVE_OWNERS_ATTR = "data-codexpp-shadcn-ui-active-owners"/);
  assert.match(source, /const STYLE_ID = "codexpp-shadcn-codex-ui-style--shadgpt"/);
  assert.match(source, /\[UPSTREAM_OWNER_ID\]: 10/);
  assert.match(source, /\[SHADGPT_OWNER_ID\]: "codexpp-shadcn-codex-ui-style--shadgpt"/);
  assert.match(source, /\[UPSTREAM_OWNER_ID\]: "codexpp-shadcn-codex-ui-style--upstream"/);
  assert.match(source, /style\.disabled = !ownsRuntime/);
  assert.match(source, /function preferredRuntimeOwner\(\)/);
  assert.match(source, /function disableInactiveRuntimeStyles\(activeOwner\)/);
  assert.match(source, /function promotePreferredRuntimeOwner\(state = null\)/);
});

test("ShadGPT fork teardown only removes its own Shadcn runtime state", () => {
  const removeRuntimeBody = source.match(/function removeRuntime\(state = null\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const promoteBody = source.match(/function promotePreferredRuntimeOwner\(state = null\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const appearanceBody = source.match(/function clearAppearanceOverride\(ownerId = null\) \{([\s\S]*?)function scheduleAppearanceOverride/)?.[1] ?? "";

  assert.match(removeRuntimeBody, /unregisterRuntimeOwner\(OWNER_ID\)/);
  assert.match(removeRuntimeBody, /document\.getElementById\(STYLE_ID\)\?\.remove\(\)/);
  assert.match(removeRuntimeBody, /getAttribute\(ROOT_OWNER_ATTR\) === OWNER_ID/);
  assert.match(removeRuntimeBody, /promotePreferredRuntimeOwner\(state\)/);
  assert.doesNotMatch(removeRuntimeBody, /removeAttribute\(ROOT_ATTR\)/);
  assert.match(promoteBody, /root\.setAttribute\(ROOT_OWNER_ATTR, ownerId\)/);
  assert.match(promoteBody, /disableInactiveRuntimeStyles\(ownerId\)/);
  assert.match(appearanceBody, /data-codexpp-shadcn-native-appearance-owner/);
  assert.match(appearanceBody, /!== ownerId\) return/);
});

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
  assert.doesNotMatch(discoveryBody, /div,span/);
  assert.match(guardBody, /Use light, dark, or match your system/);
});

test("native Appearance sync is bounded to settings surfaces", () => {
  const installBody = source.match(/function installAppearanceOverride\(state\) \{([\s\S]*?)function removeAppearanceOverride/)?.[1] ?? "";
  const observerBody = source.match(/function syncAppearanceObserver\(state\) \{([\s\S]*?)function findAppearanceSearchRoots/)?.[1] ?? "";
  const searchRootsBody = source.match(/function findAppearanceSearchRoots\(\) \{([\s\S]*?)function settingsSurfaceRoot/)?.[1] ?? "";

  assert.match(installBody, /syncAppearanceObserver\(state\)/);
  assert.doesNotMatch(installBody, /observe\(document\.body/);
  assert.doesNotMatch(installBody, /document\.body \|\| document\.documentElement/);
  assert.match(observerBody, /findAppearanceSearchRoots\(\)/);
  assert.match(searchRootsBody, /\[role='dialog'\]\.settings-dialog/);
  assert.match(searchRootsBody, /\[aria-label='Appearance settings'\]/);
  assert.doesNotMatch(searchRootsBody, /querySelectorAll\("h1,h2,h3,\[role='heading'\],button,div,span"\)/);
});

test("ShadGPT repair settings controls stay scoped and responsive", () => {
  assert.match(source, /\[data-codexpp-config-card\]/);
  assert.match(source, /\[data-codexpp-repair-card\]/);
  assert.match(source, /\[data-codexpp-settings-row\]/);
  assert.match(source, /button:not\(\[role="switch"\]\)/);
  assert.match(source, /@media \(max-width: 720px\)[\s\S]*\[data-codexpp-settings-row\][\s\S]*flex-direction: column/);
});

test("ShadGPT settings sidebar stays constrained and scrollable", () => {
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
  assert.match(source, /--primary: oklch\(0 0 0\)/);
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

test("font diagnostics delayed work is canceled on stop", () => {
  const stopBody = source.match(/stop\(\) \{([\s\S]*?)\n  \},/)?.[1] ?? "";
  const cancelBody = source.match(/function cancelFontDiagnostics\(state\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(source, /fontDiagnosticsTimers: new Set\(\)/);
  assert.match(source, /fontDiagnosticsActive: false/);
  assert.match(stopBody, /cancelFontDiagnostics\(state\)/);
  assert.match(cancelBody, /fontDiagnosticsActive = false/);
  assert.match(cancelBody, /clearTimeout\(timer\)/);
});

test("root-wide important form and control rules stay out of core CSS", () => {
  assert.doesNotMatch(source, /html\[\$\{ROOT_ATTR\}\] button,\s*\nhtml\[\$\{ROOT_ATTR\}\] \[role="button"\]/);
  assert.doesNotMatch(source, /html\[\$\{ROOT_ATTR\}\] input,\s*\nhtml\[\$\{ROOT_ATTR\}\] textarea,\s*\nhtml\[\$\{ROOT_ATTR\}\] select \{\s*\n\s*background: var\(--background[^}]*!important/);
  assert.match(source, /\[data-codexpp-shadcn-native-appearance="true"\] input/);
  assert.match(source, /\[data-codexpp-settings-row\] button:not\(\[role="switch"\]\)/);
});

test("Style + Design page does not duplicate UI Improvements feature toggles", () => {
  assert.doesNotMatch(source, /sectionHeader\("UI Improvements"/);
  assert.doesNotMatch(source, /renderUiImprovementSwitch/);
  assert.doesNotMatch(source, /Control the existing UI Improvements tweak from this Shadcn surface/);
  assert.match(source, /renderProjectColorCard/);
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
  assert.match(source, /\[data-codexpp-sidebar-project-backgrounds="project-expander"\][\s\S]*?background: transparent !important/);
  assert.match(source, /\[data-codexpp-sidebar-project-backgrounds="project-expander"\][\s\S]*?--codexpp-project-text-color/);
  assert.match(source, /\[data-codexpp-sidebar-project-backgrounds="project-expander"\][\s\S]*?-webkit-text-fill-color/);
});

test("UI Improvements compatibility stays scoped behind the Shadcn root attribute", () => {
  const compatibilityStart = source.indexOf("function uiImprovementsCompatibilityCss()");
  const compatibilityEnd = source.indexOf("function composerCss()", compatibilityStart);
  const compatibilityBody = source.slice(compatibilityStart, compatibilityEnd);

  assert.match(uiImprovementsSource, /const ATTR = "data-codexpp-sidebar-action-grid"/);
  assert.match(uiImprovementsSource, /const ATTR = "data-codexpp-sidebar-project-backgrounds"/);
  assert.match(compatibilityBody, /html\[\$\{ROOT_ATTR\}\] \[data-codexpp-sidebar-action-grid="group"\]/);
  assert.match(compatibilityBody, /html\[\$\{ROOT_ATTR\}\] \[data-codexpp-sidebar-action-grid="button"\]/);
  assert.match(compatibilityBody, /html\[\$\{ROOT_ATTR\}\] \[data-codexpp-sidebar-project-backgrounds="row"\]/);
  assert.match(compatibilityBody, /html\[\$\{ROOT_ATTR\}\] \[data-codexpp-sidebar-project-backgrounds="title"\]/);
  assert.match(compatibilityBody, /html\[\$\{ROOT_ATTR\}\] \[data-codexpp-sidebar-project-backgrounds="project-expander"\]/);
  assert.doesNotMatch(compatibilityBody, /(^|\n)\s*\[data-codexpp-sidebar-action-grid=/);
  assert.doesNotMatch(compatibilityBody, /(^|\n)\s*\[data-codexpp-sidebar-project-backgrounds=/);
});
