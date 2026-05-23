"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.BETTER_BROWSER_TEST = "1";

const {
  __test: {
    loadPatchOverrides,
    patchAppShell,
    patchRendererAsset,
    patchReviewRuntimeBridge,
    patchThreadAppShellChrome,
    patchThreadSidePanelTabs,
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

test("thread app shell chrome patch supports current Codex 26.519 browser action anchors", () => {
  const source = [
    "function nt(e){",
    "let Ne=Me,Le=k&&!D.some(st),Re=j.kind===`git`&&!D.some(ot);",
    "function st(e){return e.tabId===se.BROWSER}",
    "}",
  ].join("");

  const patched = patchThreadAppShellChrome(source);

  assert.ok(patched.includes("Le=k&&D.filter(st).length<25"));
  assert.ok(
    patched.includes(
      'function st(e){return e.tabId===se.BROWSER||typeof e.tabId==="string"&&e.tabId.startsWith(se.BROWSER+":")}',
    ),
  );
});

test("thread side panel tabs patch supports current Codex 26.519 browser open helper", () => {
  const source = [
    "function Ng(e){let t=(0,q.c)(23),{browserConversationId:n,browserHostDisplayName:r,browserTransferSourceConversationId:i,cwd:a,isAgentWorking:o}=e,s=ye(He),c=K(Dt.activeTab$),l=K(tt),u=K($e),d=Fe(`489124297`),f=Fe(`2327881676`),p=Je(),m=K(qi),h=he(M,n)??o,g=he(H,n)??il,_=he(ae,n),v=he(ee,n),y;t[0]===g?y=t[1]:(y=el(g),t[0]=g,t[1]=y);let b=y,x;t[2]===g?x=t[3]:(x=$c(g),t[2]=g,t[3]=x);let S=x,C=l&&c?.tabId===Tt.BROWSER,w=C&&u,T;t[4]!==p||t[5]!==s?(T=()=>{Ki(s,{prefersReducedMotion:p})},t[4]=p,t[5]=s,t[6]=T):T=t[6];let E;return t[7]!==b||t[8]!==S||t[9]!==n||t[10]!==r||t[11]!==i||t[12]!==v||t[13]!==a||t[14]!==d||t[15]!==m||t[16]!==h||t[17]!==f||t[18]!==C||t[19]!==_||t[20]!==w||t[21]!==T?(E=(0,Y.jsx)(`div`,{className:`relative h-full min-h-0`,children:(0,Y.jsx)(Yf,{autoFocusOnOpen:!0,conversationId:n,conversationUpdatedAt:v,cwd:a,hostDisplayName:r,rolloutPath:_,agentBrowserControlLabel:b,agentBrowserControlTurnId:S,isAgentControllingBrowser:h,isDeviceToolbarMenuItemVisible:d,isFloatingComposerMenuItemVisible:w,isFloatingComposerVisible:m,isTweaksEnabled:f,isVisible:C,onToggleFloatingComposer:T,transferSourceConversationId:i})}),t[7]=b,t[8]=S,t[9]=n,t[10]=r,t[11]=i,t[12]=v,t[13]=a,t[14]=d,t[15]=m,t[16]=h,t[17]=f,t[18]=C,t[19]=_,t[20]=w,t[21]=T,t[22]=E):E=t[22],E}",
    "function Pg(e){let t=(0,q.c)(19),{browserConversationId:n,browserTabFallbackTitle:r,isAgentWorking:i,transferSourceConversationId:a}=e,o=ye(He),s=he(M,n)??i??!1,c=he(H,n)??il,l;t[0]!==n||t[1]!==a?(l=()=>Ct.getSnapshot(n,a),t[0]=n,t[1]=a,t[2]=l):l=t[2];let u=l,d=(0,J.useSyncExternalStore)(Ig,u,u),f,p;t[3]===n?(f=t[4],p=t[5]):(f=()=>Ct.getBrowserUseActiveState(n),p=()=>Ct.getBrowserUseActiveState(n),t[3]=n,t[4]=f,t[5]=p);let m=(0,J.useSyncExternalStore)(Fg,f,p),h;t[6]!==d||t[7]!==r||t[8]!==m||t[9]!==c||t[10]!==s?(h=al({browserSnapshot:d,browserTabFallbackTitle:r,browserUseActiveState:m,conversationTurns:c,isResponseInProgress:s}),t[6]=d,t[7]=r,t[8]=m,t[9]=c,t[10]=s,t[11]=h):h=t[11];let g=h,_,v;return t[12]!==g.faviconUrl||t[13]!==g.isHighlighted||t[14]!==g.isShimmering||t[15]!==g.title||t[16]!==o?(_=()=>{Dt.updateTab(o,Tt.BROWSER,{highlightedIcon:(0,Y.jsx)(Na,{className:`size-[13px]`}),icon:(0,Y.jsx)(Le,{alt:``,className:`size-full rounded-2xs`,logoUrl:g.faviconUrl,fallback:(0,Y.jsx)(pr,{className:`size-full`})}),isHighlighted:g.isHighlighted,isShimmering:g.isShimmering,title:g.title})},v=[g.faviconUrl,g.isHighlighted,g.isShimmering,g.title,o],t[12]=g.faviconUrl,t[13]=g.isHighlighted,t[14]=g.isShimmering,t[15]=g.title,t[16]=o,t[17]=_,t[18]=v):(_=t[17],v=t[18]),(0,J.useEffect)(_,v),null}",
    "function Rg(e,t=!0,n={},r=`right`){let i=e.value,a=Ve(i),o=n.browserConversationId??a;if(o==null)return!1;let s=e.get(Mn).formatMessage({id:`thread.sidePanel.browserTab`,defaultMessage:`Browser`,description:`Title for the browser tab in the thread side panel`}),c=n.isAgentWorking??Oe(e,M,o)??!1,l=al({browserSnapshot:Ct.getSnapshot(o,n.browserTransferSourceConversationId),browserTabFallbackTitle:s,browserUseActiveState:Ct.getBrowserUseActiveState(o),conversationTurns:Oe(e,H,o)??il,isResponseInProgress:c});return e.set(ar,{conversationId:o,...n.browserTransferSourceConversationId==null?{}:{transferSourceConversationId:n.browserTransferSourceConversationId}}),Rn(r).openTab(e,Ng,{highlightedIcon:(0,J.createElement)(Na,{className:`size-[13px]`}),icon:(0,J.createElement)(Le,{alt:``,className:`icon-xs shrink-0 rounded-2xs`,logoUrl:l.faviconUrl,fallback:(0,J.createElement)(pr,{className:`size-full`})}),isHighlighted:l.isHighlighted,isShimmering:l.isShimmering,props:{browserConversationId:o,browserHostDisplayName:n.browserHostDisplayName??e.get(Tn).display_name,...n.browserTransferSourceConversationId==null?{}:{browserTransferSourceConversationId:n.browserTransferSourceConversationId},cwd:n.cwd??e.get(wn),isAgentWorking:c},id:Tt.BROWSER,activate:t,onClose:()=>{e.set(ar,null),Ae.dispatchMessage(`browser-sidebar-command`,{conversationId:o,command:{type:`reset`}})},title:l.title}),t&&zn(e,r),!0}function zg(e,t){return!0}",
  ].join("");

  const patched = patchThreadSidePanelTabs(source);

  assert.ok(patched.includes("browserTabId:bt=Tt.BROWSER"));
  assert.ok(patched.includes("Dt.updateTab(o,b,{"));
  assert.ok(patched.includes("d.length>=25"));
  assert.ok(patched.includes("id:p,activate:t"));
  assert.ok(patched.includes("conversationId:m"));
});

test("moved browser asset routing ignores non-browser thread chrome chunks", () => {
  const source = "function unrelatedThreadChrome(){return `openai-hosted-browser-shell`}";
  assert.equal(patchThreadAppShellChrome(source), source);
});

test("moved browser asset routing ignores non-browser side panel chunks", () => {
  const source = "function unrelatedSidePanelTabs(){return `openai-hosted-browser-shell`}";
  assert.equal(patchThreadSidePanelTabs(source), source);
});

test("current Codex browser asset filenames route without false patch conflicts", (t) => {
  const assetsDir = "/tmp/codex-app-asar/webview/assets";
  if (!fs.existsSync(assetsDir)) {
    t.skip("current Codex app.asar assets are not extracted at /tmp/codex-app-asar");
    return;
  }

  const browserAssetPrefixes = [
    "app-shell-",
    "review-runtime-bridge-",
    "thread-app-shell-chrome-",
    "thread-side-panel-tabs-",
    "use-model-settings-",
  ];
  const expectedChanged = new Set([
    "app-shell-JLpboL12.js",
    "review-runtime-bridge-CwAfd3Nn.js",
    "thread-app-shell-chrome-qFOIuoul.js",
    "thread-side-panel-tabs-DydIzOtr.js",
  ]);
  const seenChanged = new Set();

  const files = fs
    .readdirSync(assetsDir)
    .filter((file) => browserAssetPrefixes.some((prefix) => file.startsWith(prefix)) && file.endsWith(".js"))
    .sort();

  assert.ok(files.length > 0, "expected current Codex browser asset files");

  for (const file of files) {
    const filePath = path.join(assetsDir, file);
    const source = fs.readFileSync(filePath, "utf8");
    const patched = patchRendererAsset(`file://${filePath}`, source);

    assert.equal(typeof patched, "string", `${file} should return patched source text`);

    if (patched !== source) seenChanged.add(file);
    else assert.equal(expectedChanged.has(file), false, `${file} should have been patched`);
  }

  assert.deepEqual(seenChanged, expectedChanged);
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

test("loadPatchOverrides reads smart-repatch override file from ShadGPT user root", (t) => {
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
