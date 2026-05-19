"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.BETTER_BROWSER_TEST = "1";

const {
  __test: {
    loadPatchOverrides,
    patchAppShell,
    patchReviewRuntimeBridge,
  },
} = require("../index");

test("review runtime bridge patch supports current browser plus-menu minifier variant", () => {
  const source = [
    "let A=k,M;t[5]!==c||t[6]!==s?(M=c&&!s.some(Tr),t[5]=c,t[6]=s,t[7]=M):M=t[7];",
    "function Tr(e){return e.tabId===d.BROWSER}",
    "function find(){if(!n||e!==d.BROWSER)return!1;}",
    "let p=i?.tabId!==d.BROWSER||!a||o;",
  ].join("");

  const patched = patchReviewRuntimeBridge(source);

  assert.ok(patched.includes("M=c&&s.filter(Tr).length<25"));
  assert.ok(
    patched.includes(
      'function Tr(e){return e.tabId===d.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(d.BROWSER+":")}',
    ),
  );
  assert.ok(
    patched.includes(
      'if(!n||!(e===d.BROWSER||typeof e==="string"&&e.startsWith(d.BROWSER+":")))return!1;',
    ),
  );
});

test("review runtime bridge patch supports current local-environment plus-menu minifier variant", () => {
  const source = [
    "let M=u&&!l.some(Dr),N=M;",
    "function Dr(e){return e.tabId===g.BROWSER}",
    "function find(){if(!n||e!==g.BROWSER)return!1;}",
    "let p=i?.tabId!==g.BROWSER||!a||o;",
  ].join("");

  const patched = patchReviewRuntimeBridge(source);

  assert.ok(patched.includes("M=u&&l.filter(Dr).length<25"));
  assert.ok(
    patched.includes(
      'function Dr(e){return e.tabId===g.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(g.BROWSER+":")}',
    ),
  );
  assert.ok(
    patched.includes(
      'if(!n||!(e===g.BROWSER||typeof e==="string"&&e.startsWith(g.BROWSER+":")))return!1;',
    ),
  );
  assert.ok(
    patched.includes(
      'p=!(i?.tabId===g.BROWSER||typeof i?.tabId==="string"&&i.tabId.startsWith(g.BROWSER+":"))||!a||o',
    ),
  );
});

test("app shell patch supports current close-active-tab minifier variant", () => {
  const source = [
    "function an(){",
    "let m=s?.tabId===l.BROWSER?u:null;",
    "s?.tabId===l.BROWSER&&j.closeTab(n,s.tabId)",
    "}",
  ].join("");

  const patched = patchAppShell(source);

  assert.ok(
    patched.includes(
      'm=(s?.tabId===l.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(l.BROWSER+":"))?u:null',
    ),
  );
  assert.ok(
    patched.includes(
      '(s?.tabId===l.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(l.BROWSER+":"))&&j.closeTab(n,s.tabId)',
    ),
  );
});

test("app shell patch supports current image-preview minifier variant", () => {
  const source = [
    "function ln(){",
    "let m=s?.tabId===h.BROWSER?l:null;",
    "s?.tabId===h.BROWSER&&c.closeTab(t,s.tabId)",
    "}",
  ].join("");

  const patched = patchAppShell(source);

  assert.ok(
    patched.includes(
      'm=(s?.tabId===h.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(h.BROWSER+":"))?l:null',
    ),
  );
  assert.ok(
    patched.includes(
      '(s?.tabId===h.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(h.BROWSER+":"))&&c.closeTab(t,s.tabId)',
    ),
  );
});

test("review runtime bridge patch consumes smart-repatch override anchors", () => {
  const state = makeOverrideState([
    {
      id: "review-runtime-bridge-browser-plus-menu-cap",
      asset: "review-runtime-bridge-*.js",
      anchor: "Q=u&&!l.some(Fr)",
      replacement: "Q=u&&l.filter(Fr).length<25",
    },
  ]);
  const source = [
    "let Q=u&&!l.some(Fr),N=Q;",
    "function Dr(e){return e.tabId===g.BROWSER}",
    "function find(){if(!n||e!==g.BROWSER)return!1;}",
    "let p=i?.tabId!==g.BROWSER||!a||o;",
  ].join("");

  const patched = patchReviewRuntimeBridge(source, state);

  assert.ok(patched.includes("Q=u&&l.filter(Fr).length<25"));
  assert.ok(!patched.includes("Q=u&&!l.some(Fr)"));
});

test("app shell patch consumes smart-repatch override anchors", () => {
  const state = makeOverrideState([
    {
      id: "app-shell-browser-shortcut-active-tab",
      asset: "app-shell-*.js",
      anchor: "q=s?.tabId===z.BROWSER?l:null",
      replacement:
        'q=(s?.tabId===z.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(z.BROWSER+":"))?l:null',
    },
  ]);
  const source = [
    "function ln(){",
    "q=s?.tabId===z.BROWSER?l:null;",
    "s?.tabId===h.BROWSER&&c.closeTab(t,s.tabId)",
    "}",
  ].join("");

  const patched = patchAppShell(source, state);

  assert.ok(
    patched.includes(
      'q=(s?.tabId===z.BROWSER||typeof s?.tabId==="string"&&s.tabId.startsWith(z.BROWSER+":"))?l:null',
    ),
  );
  assert.ok(!patched.includes("q=s?.tabId===z.BROWSER?l:null"));
});

test("loadPatchOverrides reads smart-repatch override file from Codex++ user root", (t) => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const root = mkdtempSync(join(tmpdir(), "better-browser-overrides-"));
  const previous = process.env.CODEX_PLUSPLUS_USER_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_PLUSPLUS_USER_ROOT;
    else process.env.CODEX_PLUSPLUS_USER_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  process.env.CODEX_PLUSPLUS_USER_ROOT = root;
  const overrideDir = join(
    root,
    "tweak-source-overrides",
    "co.thomashulihan.better-browser-agent",
  );
  mkdirSync(overrideDir, { recursive: true });
  writeFileSync(
    join(overrideDir, "patches.override.json"),
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      patches: [
        {
          id: "review-runtime-bridge-browser-plus-menu-cap",
          asset: "review-runtime-bridge-*.js",
          anchor: "from",
          replacement: "to",
        },
      ],
    }),
  );

  const overrides = loadPatchOverrides({ log: { warn() {} } });

  assert.equal(overrides.patchesById.size, 1);
  assert.equal(overrides.patchesById.get("review-runtime-bridge-browser-plus-menu-cap").anchor, "from");
});

function makeOverrideState(patches) {
  return {
    api: {
      log: {
        info() {},
        warn() {},
      },
    },
    patchOverrideWarnings: new Set(),
    patchOverrides: {
      patchesById: new Map(patches.map((patch) => [patch.id, patch])),
    },
  };
}
