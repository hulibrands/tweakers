"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "..");

function source(relativePath) {
  return readFileSync(path.join(repo, relativePath), "utf8");
}

function maybeSource(relativePath) {
  const full = path.join(repo, relativePath);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function rendererSafeSandbox() {
  const sandbox = {
    console,
    module: { exports: {} },
    exports: {},
    process: { env: {}, platform: process.platform },
    URL,
    setTimeout() {},
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

test("both-scope tweak entrypoints evaluate without CommonJS require in renderer", () => {
  const base = path.join(repo, "tweaks");
  const failures = [];
  for (const name of readdirSync(base)) {
    const dir = path.join(base, name);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = path.join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.scope !== "both") continue;
    const entryCandidates = [manifest.main, "index.js", "index.cjs"].filter(Boolean);
    const entry = entryCandidates.map((file) => path.join(dir, file)).find((file) => existsSync(file));
    if (!entry) continue;
    try {
      vm.runInNewContext(readFileSync(entry, "utf8"), rendererSafeSandbox(), { filename: entry });
    } catch (error) {
      failures.push(`${manifest.id || name}: ${error && error.message || String(error)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("ShadGPT-owned active tweak names keep the ShadGPT prefix", () => {
  const manifests = [
    "retired/better-browser-agent/manifest.json",
    "tweaks/titlebar-controls/manifest.json",
    "tweaks/ui-improvements/manifest.json",
  ];
  for (const file of manifests) {
    const text = maybeSource(file);
    if (text === null) continue;
    const manifest = JSON.parse(text);
    assert.match(manifest.name, /^ShadGPT /, `${file} should use a ShadGPT display name`);
  }
});

test("Better Browser DevTools menu scan stays scoped to menu controls", () => {
  const text = maybeSource("retired/better-browser-agent/index.js");
  if (text === null) return;
  const dockMenuScript = text.match(/const APP_SHELL_DEVTOOLS_DOCK_MENU_SCRIPT = `\(\(\) => \{([\s\S]*?)\}\)\(\);`;/)?.[1] ?? "";

  assert.match(dockMenuScript, /existing && existing\.version === 12/);
  assert.match(dockMenuScript, /const itemSelector = '\[role="menuitem"\], \[data-radix-collection-item\], \[cmdk-item\], button'/);
  assert.doesNotMatch(dockMenuScript, /button, div/);
  assert.doesNotMatch(dockMenuScript, /document\.addEventListener\("keydown", schedule, true\)/);
});

test("Titlebar Controls spaces the right titlebar by safe area, not button restyling", () => {
  const text = source("tweaks/titlebar-controls/index.js");
  assert.match(text, /const SAFE_HEADER_RIGHT_PROPERTY = "--spacing-token-safe-header-right"/);
  assert.match(text, /const MAC_TITLEBAR_SAFE_RIGHT_MIN_PX = 66/);
  assert.match(text, /function adjustSafeRight\(currentPx, allowSynthesis = false\)/);
  assert.match(text, /function shouldAdjustRightSafeArea\(element, nativeRight\)/);
  assert.match(text, /setSafeHeaderProperty\(state, candidate, SAFE_HEADER_RIGHT_PROPERTY, adjustedRightPx, nativeRight\)/);
  assert.match(text, /return allowSynthesis \? MAC_TITLEBAR_SAFE_RIGHT_MIN_PX : null/);
  assert.doesNotMatch(text, /RIGHT_CONTROL_ATTRIBUTE/);
  assert.doesNotMatch(text, /function markRightTitlebarControls/);
  assert.match(text, /block-size: 32px !important/);
  assert.match(text, /inline-size: 21px !important/);
});

test("Follow-up settings render clears the previous render", () => {
  const text = source("tweaks/followup/index.js");
  const renderSettings = text.match(/function renderSettings\(root, state\) \{([\s\S]*?)\n\s*root\.appendChild/s)?.[1] ?? "";
  assert.match(renderSettings, /root\.textContent = ""/);
});

test("Follow-up uses inline multi-select rows that activate the composer send button", () => {
  const text = source("tweaks/followup/index.js");
  assert.doesNotMatch(text, /data-soren-radar-dialog/);
  assert.doesNotMatch(text, /function showFollowupDialog/);
  assert.match(text, /When generating a Follow-up payload, generate exactly 5 follow-up items/);
  assert.match(text, /Exception: when a turn uses any Matt Pocock skill/);
  assert.match(text, /mattpocock\/skills/);
  assert.match(text, /Ponytail skill/);
  assert.match(text, /Ponytail plugin/);
  assert.match(text, /request_user_input/);
  assert.match(text, /\(Recommended\)/);
  assert.match(text, /Use everyday words first/);
  assert.match(text, /Technical now:/);
  assert.match(text, /Better Follow-up:/);
  assert.match(text, /Update existing chats to use the clearer Follow-up wording/);
  assert.match(text, /Make Follow-up suggestions appear without slowing long chats/);
  assert.doesNotMatch(text, /Always include a Follow-up payload/);
  assert.doesNotMatch(text, /Rules: always emit/);
  assert.match(text, /"achieves": \[/);
  assert.match(text, /normalizeAchieves/);
  assert.match(text, /soren-radar-achieves/);
  assert.match(text, /document\.createElement\("li"\)/);
  assert.match(text, /list-style: disc outside/);
  assert.match(text, /display: list-item/);
  assert.match(text, /role", "checkbox"/);
  assert.match(text, /soren-radar-row-selected/);
  assert.match(text, /\$\{index \+ 1\}\. \$\{prompt\}/);
  assert.match(text, /\.join\("\\n"\)/);
  assert.match(text, /insertIntoComposer\(value,\s*\{\s*replace:\s*true\s*\}\)/);
  assert.match(text, /editable\.innerText = value/);
});

test("Follow-up caches parsed message payloads between structural scans", () => {
  const text = source("tweaks/followup/index.js");

  assert.match(text, /payloadCache: new WeakMap\(\)/);
  assert.match(text, /findRadarPayload\(markdown, state\.payloadCache\)/);
  assert.match(text, /function radarPayloadSignature/);
  assert.match(text, /cached\?\.signature\?\.kind === signature\.kind/);
  assert.match(text, /state\.payloadCache = new WeakMap\(\)/);
});

test("Follow-up settings expose prompt preview, migration status, and reload", () => {
  const text = source("tweaks/followup/index.js");
  assert.match(text, /Synced prompt preview/);
  assert.match(text, /function previewBlock/);
  assert.match(text, /state\.previewPromptEl/);
  assert.match(text, /Custom prompt guide/);
  assert.match(text, /Prompt migration/);
  assert.match(text, /OLD_DEFAULT_FOLLOWUP_PROMPT_FINGERPRINT/);
  assert.match(text, /function migrateFollowupPrompt/);
  assert.match(text, /Reload Follow-up/);
  assert.match(text, /Reloading installed tweaks from disk/);
  assert.match(text, /Installed tweaks reloaded\. Refreshing this window/);
  assert.match(text, /IPC_RELOAD_TWEAKS/);
  assert.match(text, /manager\.reload\(\)/);
});

test("Follow-up writes ShadGPT managed markers while removing legacy markers", () => {
  const text = source("tweaks/followup/index.js");
  assert.match(text, /const SHADGPT_BLOCK_PREFIX = "shadgpt"/);
  assert.match(text, /const BLOCK_BEGIN = `<!-- \$\{SHADGPT_BLOCK_PREFIX\}:\$\{TWEAK_ID\}:start -->`/);
  assert.match(text, /const PREVIOUS_BLOCK_BEGIN = `<!-- \$\{LEGACY_BLOCK_PREFIX\}:\$\{TWEAK_ID\}:start -->`/);
  assert.match(text, /\[PREVIOUS_BLOCK_BEGIN,\s*PREVIOUS_BLOCK_END\]/);
  assert.match(text, /next = next\.replace\(managedBlockPattern\(begin,\s*end,\s*true\), "\\n"\)/);
  assert.doesNotMatch(text, /const BLOCK_BEGIN = `<!-- codex-plusplus:/);
});

test("Mode Switcher scopes settings observers to shell and settings roots", () => {
  const text = source("tweaks/mode-switcher/index.js");
  assert.match(text, /function findSettingsObserverRoot\(\)/);
  assert.match(text, /function findSettingsRoot\(\)/);
  assert.match(text, /let observedSettingsRoot = null/);
  assert.match(text, /rootObserver\.observe\(findSettingsObserverRoot\(\), \{ childList: true \}\)/);
  assert.match(text, /settingsObserver\.observe\(observedSettingsRoot, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(text, /settingsObserver\.observe\(document\.(?:body|documentElement)/);
});

test("Replaced upstream tweakers are not visible as base tweaks or store entries", () => {
  const replacedUpstreamIds = new Set([
    "co.Arconte112.followup",
    "co.Arconte112.shadcn-codex-ui",
    "co.bennett.better-browser",
    "co.bennett.ui-improvements",
    "co.sakushi.add-project-by-path",
    "co.thomashulihan.add-project-by-path",
    "co.thomas.mode-switcher",
    "me.erkin.codex-plusplus-account-switcher",
  ]);
  for (const dir of readdirSync(path.join(repo, "tweaks"))) {
    const manifestPath = path.join(repo, "tweaks", dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(
      replacedUpstreamIds.has(manifest.id),
      false,
      `${manifest.id} should not be visible as an active tweak`,
    );
  }
  const store = JSON.parse(source("store/index.json"));
  const storeIds = store.entries.map((entry) => entry.id);
  for (const id of replacedUpstreamIds) {
    assert.equal(storeIds.includes(id), false, `${id} should not be visible in the ShadGPT tweak store`);
  }
});

test("Tweaks Directory opens a detail page for each tweak row", () => {
  const text = source("tweaks/tweaks-directory/index.cjs");
  assert.match(text, /function renderTweakDetailPage/);
  assert.match(text, /detailRowKey/);
  assert.match(text, /Open .* details/);
  assert.match(text, /Includes/);
  assert.match(text, /Information/);
  assert.match(text, /Main startup timeout/);
  assert.match(text, /manifest\.mainStartupTimeoutMs/);
});

test("Tweaks Directory renders installed tweak files from the scoped file-tree channel", () => {
  const text = source("tweaks/tweaks-directory/index.cjs");
  assert.match(text, /getTweakFileTree: "get-tweak-file-tree"/);
  assert.match(text, /getPluginFileTree: "get-plugin-file-tree"/);
  assert.match(text, /Files UI is newer than the loaded ShadGPT runtime/);
  assert.match(text, /manager\.getTweakFileTree\(String\(id \|\| ""\), options/);
  assert.match(text, /manager\.getPluginFileTree\(String\(id \|\| ""\), options/);
  assert.match(text, /function renderInstalledTweakFilesSection/);
  assert.match(text, /function renderNativePluginFilesSection/);
  assert.match(text, /function findNativePluginDetailSurface/);
  assert.match(text, /dataset\.codexppPluginFiles = "true"/);
  assert.match(text, /CHANNELS\.getTweakFileTree/);
  assert.match(text, /CHANNELS\.getPluginFileTree/);
  assert.match(text, /Refresh files/);
  assert.match(text, /Loading files/);
  assert.match(text, /Could not load files/);
  assert.match(text, /No files found/);
  assert.match(text, /function toggleTweakFileFolder/);
  assert.match(text, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(text, /aria-expanded/);
  assert.match(text, /function selectTweakFile/);
  assert.match(text, /omittedReason/);
  assert.match(text, /sourceKind/);
});

test("Tweaks Directory exposes one-click reload for changed installed tweaks", () => {
  const text = source("tweaks/tweaks-directory/index.cjs");
  assert.match(text, /if \(row\.installed\) actions\.push\(button\("Reload tweaks", \(\) => reloadInstalledTweaks\(state\)\)\)/);
  assert.match(text, /menu\.appendChild\(detailMenuItem\("Reload tweaks", \(\) => reloadInstalledTweaks\(state\)\)\)/);
  assert.match(text, /async function reloadInstalledTweaks\(state\)/);
  assert.match(text, /state\.api\.ipc\.invoke\(CHANNELS\.reload\)/);
  assert.match(text, /location\.reload\(\)/);
  assert.match(text, /Could not reload installed tweaks/);
});

test("Tweaks Directory settings explain safe mode and repair missing pages", () => {
  const text = source("tweaks/tweaks-directory/index.cjs");
  assert.match(text, /Tweaks health/);
  assert.match(text, /loaded, \$\{counts\.failed\} failed, \$\{counts\.mainOnly\} main-only/);
  assert.match(text, /Repair missing pages/);
  assert.match(text, /repairMissingRegisteredSettingsPages/);
  assert.match(text, /Expected a Settings page, but none is registered in the renderer/);
  assert.match(text, /status badges, inherited icons, file-tree insertion, and detail-row cleanup/);
  assert.match(text, /The Tweaks tab, installed-tweak files, and Settings pages still work/);
});

test("Projects page header shows Chrome Profile assignment status", () => {
  const text = source("tweaks/projects/index.js");
  assert.match(text, /projects-header-chrome-status/);
  assert.match(text, /function renderProjectsChromeHeaderStatus/);
  assert.match(text, /function projectsChromeHeaderStatus/);
  assert.match(text, /Chrome Profiles/);
  assert.match(text, /project-specific/);
  assert.match(text, /using default/);
  assert.match(text, /unset/);
});

test("Tweaks Directory hides disabled upstream originals when a fork is installed", () => {
  const text = source("tweaks/tweaks-directory/index.cjs");
  assert.match(text, /function forkedUpstreamIds\(installed\)/);
  assert.match(text, /manifest\.forkOf && item\.manifest\.forkOf\.upstreamId/);
  assert.match(text, /function shouldHideForkedUpstreamRow/);
  assert.match(text, /item\.enabled === false/);
  assert.match(text, /hiddenForkedUpstreamIds\.has\(id\)/);
  assert.match(text, /if \(shouldHideForkedUpstreamRow\(item, hiddenForkedUpstreamIds\)\) continue/);
  assert.match(text, /if \(hiddenForkedUpstreamIds\.has\(entry\.id\)\) continue/);
});

test("Stale branch label bug report is backed by a PR-review regression check", () => {
  const text = source("tweaks/ui-improvements/index.js");
  const report = maybeSource("docs/codex/stale-chat-branch-label-bug-report-2026-05-19.md");
  assert.match(text, /"clarify-stale-chat-branch-label"\(api\)/);
  assert.match(text, /Chat branch reflects active branch when last used/);
  assert.match(text, /Last used chat branch; opening or sending in the chat refreshes it/);
  assert.match(text, /node\.nodeValue = REPLACEMENT/);
  if (report !== null) {
    assert.match(report, /clearly label the old value as a historical last-used branch/);
    assert.match(report, /the local UI Improvements tweak rewrites the misleading hover copy/);
  }
});

test("Thread Summary Profiles avoids reinserting unchanged owned sections", () => {
  const text = source("tweaks/thread-summary-profiles/index.js");

  assert.match(text, /const SECTION_SIGNATURE_ATTR = "data-codexpp-thread-summary-profiles-signature"/);
  assert.match(text, /function profileSectionSignature/);
  assert.match(text, /existing\?\.getAttribute\(SECTION_SIGNATURE_ATTR\) === signature/);
  assert.match(text, /function shouldIgnoreProfileMutations/);
  assert.match(text, /const Observer = typeof MutationObserver === "function" \? MutationObserver : null/);
  assert.match(text, /new Observer\(\(mutations\) => \{/);
  assert.match(text, /observer\.observe\(panel, \{ childList: true, subtree: true \}\)/);
  assert.match(text, /rootObserver\.observe\(root, \{ childList: true, subtree: false \}\)/);
});

test("UI Improvements native menu scanners avoid bare div item sweeps", () => {
  const text = source("tweaks/ui-improvements/index.js");

  assert.doesNotMatch(text, /\[role="menuitem"\], \[data-radix-collection-item\], button, div/);
  assert.doesNotMatch(text, /button, \[role="button"\], \[role="menuitem"\], \[data-radix-collection-item\], div/);
  assert.match(text, /\[role="menuitem"\], \[data-radix-collection-item\], button/);
});

test("Public repo metadata does not expose personal developer name outside author metadata", () => {
  const blockedName = ["Thomas", "Hulihan"].join(" ");
  const files = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    // Skip vendored submodules (e.g. vendor/tweakers): they are separate published
    // repos with their own hardening, and git ls-files lists the gitlink as a dir.
    .filter((file) => !file.startsWith("vendor/"))
    .filter((file) => {
      const full = path.join(repo, file);
      return existsSync(full) && statSync(full).isFile();
    })
    .filter((file) => !file.endsWith(".map"));
  const allowedAuthorName = new RegExp(
    String.raw`"author"\s*:\s*\{[^{}]*"name"\s*:\s*"` + blockedName + String.raw`"[^{}]*\}`,
    "g",
  );
  const offenders = files.filter((file) => source(file).replace(allowedAuthorName, "").includes(blockedName));
  assert.deepEqual(offenders, []);
});
