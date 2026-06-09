"use strict";

/**
 * T5.2 — usage-analytics relink static tests
 *
 * Verify that show-usage-in-sidebar uses the shared IPC path when the
 * usage-analytics tweak is present (no second independent /wham/usage loop),
 * and falls back gracefully when it is absent.
 *
 * All checks are static source-analysis (no DOM, no live runtime) to match
 * the harness pattern of the existing ui-improvements tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");

// ── helper: extract the source of show-usage-in-sidebar feature ─────────────
// We isolate the feature body so assertions don't accidentally match
// elsewhere in the large file.
function extractFeatureSource(featureId) {
  // Find `"show-usage-in-sidebar"(api) {` and extract up to the next
  // top-level feature entry (FEATURES object key at the same indent level).
  const startRe = new RegExp(`"${featureId}"\\s*\\(api\\)\\s*\\{`);
  const startMatch = startRe.exec(source);
  assert.ok(startMatch, `Feature "${featureId}" not found in source`);
  // Walk from the opening brace to find the matching close — we use a
  // simple brace counter rather than the full parser used by the observer
  // tests, which is sufficient for this purpose.
  let depth = 0;
  let i = startMatch.index + startMatch[0].lastIndexOf("{");
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(startMatch.index, i + 1);
}

const usageFeatureSrc = extractFeatureSource("show-usage-in-sidebar");

// ─── 1. Single shared IPC path ──────────────────────────────────────────────

test("show-usage-in-sidebar uses api.ipc.invoke(usage-fetch) as the primary data path", () => {
  // The IPC call must be present in the feature source.
  assert.match(
    usageFeatureSrc,
    /api\.ipc\.invoke\s*\(\s*["']usage-fetch["']\s*,\s*["']\/wham\/usage["']\s*\)/,
    'Expected api.ipc.invoke("usage-fetch", "/wham/usage") in show-usage-in-sidebar',
  );
});

test("show-usage-in-sidebar declares ipcUsageConfirmed guard", () => {
  assert.match(
    usageFeatureSrc,
    /let ipcUsageConfirmed = false/,
    "Expected ipcUsageConfirmed state variable",
  );
  assert.match(
    usageFeatureSrc,
    /ipcUsageConfirmed = true/,
    "Expected ipcUsageConfirmed to be set true on IPC success",
  );
});

test("show-usage-in-sidebar does NOT invoke fetchCodexAppServerJson (removed duplicate loop)", () => {
  // The old independent polling function must be gone. Presence of
  // fetchCodexAppServerJson in the feature body would indicate the duplicate
  // loop was not removed.
  assert.doesNotMatch(
    usageFeatureSrc,
    /fetchCodexAppServerJson/,
    "fetchCodexAppServerJson must not appear inside show-usage-in-sidebar (duplicate loop)",
  );
});

test("renderer bridge is guarded by ipcUsageConfirmed so it is never activated when IPC works", () => {
  // The bridge fallback code must be present (for backward compat) but
  // gated so it is only reached when IPC is not confirmed.
  assert.match(
    usageFeatureSrc,
    /if\s*\(\s*ipcUsageConfirmed\s*\)/,
    "Expected ipcUsageConfirmed guard in bridge fallback path",
  );
  // The bridge function must only be called from the IPC catch branch.
  assert.match(
    usageFeatureSrc,
    /fetchViaRendererBridge/,
    "Expected fetchViaRendererBridge fallback function",
  );
});

// ─── 2. No duplicate independent polling loop ───────────────────────────────

test("show-usage-in-sidebar does not create a second MutationObserver for usage", () => {
  // Count MutationObserver instantiations in the feature source.
  // There should be at most one (the existing childList+subtree observer
  // for DOM-anchor tracking) — not a second one for usage text scanning.
  const moMatches = [...usageFeatureSrc.matchAll(/new MutationObserver\s*\(/g)];
  assert.equal(
    moMatches.length,
    1,
    `Expected exactly 1 MutationObserver in show-usage-in-sidebar, found ${moMatches.length}`,
  );
});

test("show-usage-in-sidebar rAF-debounces its MutationObserver callback", () => {
  // The MutationObserver callback must schedule via rAF.
  assert.match(
    usageFeatureSrc,
    /requestAnimationFrame/,
    "MutationObserver callback must use requestAnimationFrame",
  );
});

// ─── 3. No characterData observers ──────────────────────────────────────────

test("show-usage-in-sidebar does not add characterData observers", () => {
  // characterData must not appear as an observe option anywhere in the feature.
  assert.doesNotMatch(
    usageFeatureSrc,
    /characterData\s*:\s*true/,
    "characterData: true must not appear in show-usage-in-sidebar",
  );
});

test("file-level grep: no characterData observer added anywhere in index.js", () => {
  // Global rule — no new characterData observers must appear anywhere in
  // the entire source file (comments that say "No characterData" are fine).
  const obs = [...source.matchAll(/characterData\s*:\s*true/g)];
  assert.equal(
    obs.length,
    0,
    `Expected 0 occurrences of characterData: true, found ${obs.length}`,
  );
});

// ─── 4. Backward compatibility — no regression when analytics absent ────────

test("show-usage-in-sidebar retains DOM fallback (scanBreakdown + scanCompactUsage)", () => {
  // DOM fallback paths must remain for when IPC is unavailable (analytics
  // absent or older runtime).
  assert.match(usageFeatureSrc, /findBreakdownGrid/, "findBreakdownGrid must be present");
  assert.match(usageFeatureSrc, /scanBreakdown/, "scanBreakdown must be present");
  assert.match(usageFeatureSrc, /scanCompactUsage/, "scanCompactUsage must be present");
  assert.match(
    usageFeatureSrc,
    /if\s*\(!directUsageAvailable\)/,
    "DOM scan must be guarded by !directUsageAvailable",
  );
});

test("show-usage-in-sidebar retains snapshotFromUsageStatus for API response parsing", () => {
  assert.match(
    usageFeatureSrc,
    /snapshotFromUsageStatus/,
    "snapshotFromUsageStatus must remain for parsing API responses",
  );
});

test("show-usage-in-sidebar ipcUsageConfirmed check prevents bridge re-activation on transient errors", () => {
  // When ipcUsageConfirmed is true and a subsequent IPC call throws,
  // the bridge path must not be re-entered.
  assert.match(
    usageFeatureSrc,
    /if\s*\(\s*ipcUsageConfirmed\s*\)\s*\{[\s\S]*?return false/,
    "Transient IPC error with ipcUsageConfirmed must return early without activating bridge",
  );
});

// ─── 5. Existing bridge guard tests still hold ──────────────────────────────

test("usage request bridge machinery is present as fallback (backward compat)", () => {
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
