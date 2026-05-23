"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.BETTER_BROWSER_TEST = "1";

const {
  __test: {
    mirrorBrowserCommentOverlaySessionToBaseConversation,
    rememberBrowserDirectCommentAlias,
    routeBrowserDirectCommentAlias,
  },
} = require("../index");

test("browser comment overlay alias persists through mount before submit", () => {
  const state = { directCommentAliases: new Map() };
  const event = { sender: { id: 42 } };

  rememberBrowserDirectCommentAlias(state, 42, "thread-1", "thread-1:browser:tab-a", "session-1");

  const mounted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
    surfaceSize: { width: 420, height: 120 },
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 2);

  const submitted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-1",
    body: "annotated",
  });

  assert.equal(submitted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 0);
});

test("browser comment overlay alias works when lifecycle messages come from overlay window", () => {
  const state = { directCommentAliases: new Map() };
  const browserOwnerEvent = { sender: { id: 42 } };
  const overlayWindowEvent = { sender: { id: 143 } };

  rememberBrowserDirectCommentAlias(state, 42, "thread-1", "thread-1:browser:tab-a", "session-1");

  const mounted = routeBrowserDirectCommentAlias(state, overlayWindowEvent, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
    surfaceSize: { width: 420, height: 120 },
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 2);

  const submitted = routeBrowserDirectCommentAlias(state, browserOwnerEvent, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-1",
    body: "annotated",
  });

  assert.equal(submitted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 0);
});

test("browser comment overlay aliases stay isolated across browser tabs", () => {
  const state = { directCommentAliases: new Map() };
  const firstTabEvent = { sender: { id: 42 } };
  const secondTabEvent = { sender: { id: 43 } };
  const firstOverlayEvent = { sender: { id: 143 } };
  const secondOverlayEvent = { sender: { id: 144 } };

  rememberBrowserDirectCommentAlias(state, 42, "thread-1", "thread-1:browser:tab-a", "session-a");
  rememberBrowserDirectCommentAlias(state, 43, "thread-2", "thread-2:browser:tab-b", "session-b");

  const firstMounted = routeBrowserDirectCommentAlias(state, firstOverlayEvent, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-a",
  });
  const secondMounted = routeBrowserDirectCommentAlias(state, secondOverlayEvent, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-2",
    sessionId: "session-b",
  });

  assert.equal(firstMounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(secondMounted.conversationId, "thread-2:browser:tab-b");
  assert.equal(state.directCommentAliases.size, 4);

  const secondSubmitted = routeBrowserDirectCommentAlias(state, secondTabEvent, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-2",
    sessionId: "session-b",
    body: "second tab",
  });
  const firstSubmitted = routeBrowserDirectCommentAlias(state, firstTabEvent, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-a",
    body: "first tab",
  });

  assert.equal(secondSubmitted.conversationId, "thread-2:browser:tab-b");
  assert.equal(firstSubmitted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 0);
});

test("browser comment overlay alias routes preview and delete lifecycle messages", () => {
  const state = { directCommentAliases: new Map() };
  const event = { sender: { id: 9 } };

  rememberBrowserDirectCommentAlias(state, 9, "thread-2", "thread-2:browser:tab-b", "session-2");

  const preview = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-preview-open-changed",
    conversationId: "thread-2",
    sessionId: "session-2",
    previewOpen: true,
  });

  assert.equal(preview.conversationId, "thread-2:browser:tab-b");
  assert.equal(state.directCommentAliases.size, 2);

  const deleted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-delete",
    conversationId: "thread-2",
    sessionId: "session-2",
    commentId: "comment-1",
  });

  assert.equal(deleted.conversationId, "thread-2:browser:tab-b");
  assert.equal(state.directCommentAliases.size, 0);
});

test("browser comment overlay alias route miss logs once per missed lifecycle message", () => {
  const warnings = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
  };
  const event = { sender: { id: 143 } };
  const message = {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-3",
    sessionId: "session-3",
    body: "annotated",
  };

  const first = routeBrowserDirectCommentAlias(state, event, message);
  const second = routeBrowserDirectCommentAlias(state, event, message);

  assert.equal(first, message);
  assert.equal(second, message);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "browser comment overlay alias route miss");
  assert.equal(warnings[0][1].reason, "missing-alias");
  assert.equal(warnings[0][1].senderWebContentsId, 143);
});

test("browser comment overlay alias treats unaliased base mount as valid", () => {
  const warnings = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
  };
  const event = { sender: { id: 143 } };

  const mounted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-3",
    sessionId: "session-3",
  });

  assert.equal(mounted.conversationId, "thread-3");
  assert.equal(warnings.length, 0);
  assert.equal(state.directCommentAliases.size, 2);
});

test("browser comment overlay alias suppresses base close noise without hiding submit misses", () => {
  const warnings = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
  };
  const event = { sender: { id: 143 } };

  routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-close",
    conversationId: "thread-3",
    sessionId: "session-3",
  });
  routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-3",
    sessionId: "session-4",
    body: "annotated",
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].messageType, "browser-sidebar-comment-overlay-submit");
});

test("browser comment overlay alias can use matching page state with stale owner metadata", (t) => {
  const previousServices = globalThis.__codexpp_window_services__;
  t.after(() => {
    if (previousServices === undefined) delete globalThis.__codexpp_window_services__;
    else globalThis.__codexpp_window_services__ = previousServices;
  });

  const owner = { id: 42, isDestroyed: () => false };
  const staleOwner = { id: 99, isDestroyed: () => false };
  const browserWebContents = {
    id: 101,
    isDestroyed: () => false,
    isFocused: () => true,
  };
  const pageState = {
    conversationId: "thread-1:browser:tab-a",
    webContentsId: 101,
    windowState: { owner: staleOwner },
  };
  globalThis.__codexpp_window_services__ = {
    browserSidebarManager: {
      findPageStateForWebContentsId(webContentsId) {
        return webContentsId === 101 ? pageState : null;
      },
      getCurrentWindowState() {
        return {};
      },
    },
  };

  const state = {
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map(),
    webContentsEntries: new Map([[101, { wc: browserWebContents }]]),
  };

  const mounted = routeBrowserDirectCommentAlias(state, { sender: owner }, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
});

test("browser comment overlay alias falls back to active right-panel browser conversation", () => {
  const state = {
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map([
      [
        42,
        {
          rightPanelBrowserConversationId: "thread-1:browser:tab-a",
        },
      ],
    ]),
  };
  const event = { sender: { id: 42 } };

  const mounted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 2);

  const submitted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-1",
    body: "annotated",
  });

  assert.equal(submitted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 0);
});

test("browser comment overlay alias accepts base browser conversation fallback without warning", () => {
  const warnings = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map([
      [
        42,
        {
          rightPanelBrowserConversationId: "thread-1",
        },
      ],
    ]),
  };
  const event = { sender: { id: 42 } };

  const mounted = routeBrowserDirectCommentAlias(state, event, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });

  assert.equal(mounted.conversationId, "thread-1");
  assert.equal(warnings.length, 0);
  assert.equal(state.directCommentAliases.size, 2);
});

test("browser comment overlay alias fallback ignores other base conversations", () => {
  const warnings = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map([
      [
        42,
        {
          rightPanelBrowserConversationId: "thread-2:browser:tab-a",
        },
      ],
    ]),
  };
  const event = { sender: { id: 42 } };
  const message = {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-1",
    body: "annotated",
  };

  const routed = routeBrowserDirectCommentAlias(state, event, message);

  assert.equal(routed, message);
  assert.equal(state.directCommentAliases.size, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].reason, "missing-alias");
});

test("browser comment overlay alias falls back to browser manager active conversation", (t) => {
  const previousServices = globalThis.__codexpp_window_services__;
  t.after(() => {
    if (previousServices === undefined) delete globalThis.__codexpp_window_services__;
    else globalThis.__codexpp_window_services__ = previousServices;
  });

  const owner = { id: 42, isDestroyed: () => false };
  const browserWebContents = {
    id: 99,
    getURL: () => "http://localhost:2323/",
    isDestroyed: () => false,
  };
  const pageState = {
    conversationId: "thread-1:browser:tab-a",
    webContentsId: 99,
    windowState: { owner },
  };
  globalThis.__codexpp_window_services__ = {
    browserSidebarManager: {
      findPageStateForConversationId(conversationId) {
        return conversationId === "thread-1:browser:tab-a" ? pageState : null;
      },
      findPageStateForWebContentsId(webContentsId) {
        return webContentsId === 99 ? pageState : null;
      },
      getCurrentWindowState() {
        return { activeConversationId: "thread-1:browser:tab-a" };
      },
    },
  };

  const state = {
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map(),
    webContentsEntries: new Map([[99, { wc: browserWebContents }]]),
  };

  const mounted = routeBrowserDirectCommentAlias(state, { sender: owner }, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 2);
});

test("browser comment overlay alias scans browser page entries for current toolbar sender", (t) => {
  const previousServices = globalThis.__codexpp_window_services__;
  t.after(() => {
    if (previousServices === undefined) delete globalThis.__codexpp_window_services__;
    else globalThis.__codexpp_window_services__ = previousServices;
  });

  const owner = { id: 42, isDestroyed: () => false };
  const unrelatedOwner = { id: 43, isDestroyed: () => false };
  const browserWebContents = {
    id: 99,
    isDestroyed: () => false,
    isFocused: () => true,
  };
  const unrelatedBrowserWebContents = {
    id: 100,
    isDestroyed: () => false,
    isFocused: () => false,
  };
  const pageState = {
    conversationId: "thread-1:browser:tab-a",
    webContentsId: 99,
    windowState: { owner },
  };
  const unrelatedPageState = {
    conversationId: "thread-2:browser:tab-b",
    webContentsId: 100,
    windowState: { owner: unrelatedOwner },
  };
  globalThis.__codexpp_window_services__ = {
    browserSidebarManager: {
      findPageStateForWebContentsId(webContentsId) {
        if (webContentsId === 99) return pageState;
        if (webContentsId === 100) return unrelatedPageState;
        return null;
      },
      getCurrentWindowState() {
        return {};
      },
    },
  };

  const state = {
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map(),
    webContentsEntries: new Map([
      [100, { wc: unrelatedBrowserWebContents }],
      [99, { wc: browserWebContents }],
    ]),
  };

  const mounted = routeBrowserDirectCommentAlias(state, { sender: owner }, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 2);
});

test("browser comment overlay alias prefers suffixed tab over base conversation fallback", (t) => {
  const previousServices = globalThis.__codexpp_window_services__;
  t.after(() => {
    if (previousServices === undefined) delete globalThis.__codexpp_window_services__;
    else globalThis.__codexpp_window_services__ = previousServices;
  });

  const owner = { id: 42, isDestroyed: () => false };
  const browserWebContents = {
    id: 99,
    isDestroyed: () => false,
    isFocused: () => true,
  };
  const pageState = {
    conversationId: "thread-1:browser:tab-a",
    webContentsId: 99,
    windowState: { owner },
  };
  globalThis.__codexpp_window_services__ = {
    browserSidebarManager: {
      findPageStateForWebContentsId(webContentsId) {
        return webContentsId === 99 ? pageState : null;
      },
      getCurrentWindowState() {
        return {};
      },
    },
  };

  const state = {
    directCommentAliases: new Map(),
    shortcutStateByWebContentsId: new Map([
      [
        42,
        {
          rightPanelBrowserConversationId: "thread-1",
        },
      ],
    ]),
    webContentsEntries: new Map([[99, { wc: browserWebContents }]]),
  };

  const mounted = routeBrowserDirectCommentAlias(state, { sender: owner }, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
});

test("runtime smoke: overlay session seeds base lifecycle routing", () => {
  const warnings = [];
  const sent = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
  };
  const ownerWebContents = { id: 1 };
  const entry = {
    originalSend: {
      call(_this, channel, message) {
        sent.push({ channel, message });
      },
    },
  };

  const mirrored = mirrorBrowserCommentOverlaySessionToBaseConversation(
    state,
    ownerWebContents,
    entry,
    {
      type: "browser-sidebar-comment-overlay-session",
      conversationId: "thread-1:browser:tab-a",
      session: {
        conversationId: "thread-1:browser:tab-a",
        sessionId: "session-1",
        target: { mode: "create" },
      },
      visible: true,
    },
  );

  assert.equal(mirrored, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.conversationId, "thread-1:browser:tab-a");
  assert.equal(sent[1].message.conversationId, "thread-1");
  assert.equal(sent[1].message.session.conversationId, "thread-1");

  const mounted = routeBrowserDirectCommentAlias(state, { sender: ownerWebContents }, {
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-1",
    sessionId: "session-1",
  });
  const submitted = routeBrowserDirectCommentAlias(state, { sender: ownerWebContents }, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-1",
    body: "annotated",
  });

  assert.equal(mounted.conversationId, "thread-1:browser:tab-a");
  assert.equal(submitted.conversationId, "thread-1:browser:tab-a");
  assert.equal(state.directCommentAliases.size, 0);
  assert.equal(warnings.length, 0);
});

test("runtime smoke: overlay session can recover browser id from nested session", () => {
  const sent = [];
  const state = { directCommentAliases: new Map() };
  const ownerWebContents = { id: 1 };
  const entry = {
    originalSend: {
      call(_this, channel, message) {
        sent.push({ channel, message });
      },
    },
  };

  const mirrored = mirrorBrowserCommentOverlaySessionToBaseConversation(
    state,
    ownerWebContents,
    entry,
    {
      type: "browser-sidebar-comment-overlay-session",
      conversationId: "thread-1",
      session: {
        conversationId: "thread-1:browser:tab-a",
        sessionId: "session-2",
        target: { mode: "create" },
      },
    },
  );

  assert.equal(mirrored, true);
  assert.equal(sent[0].message.conversationId, "thread-1:browser:tab-a");
  assert.equal(sent[0].message.session.conversationId, "thread-1:browser:tab-a");
  assert.equal(sent[1].message.conversationId, "thread-1");
  assert.equal(sent[1].message.session.conversationId, "thread-1");

  const submitted = routeBrowserDirectCommentAlias(state, { sender: ownerWebContents }, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    sessionId: "session-2",
    body: "annotated",
  });

  assert.equal(submitted.conversationId, "thread-1:browser:tab-a");
});

test("runtime smoke: lifecycle message with nested browser id routes without warning", () => {
  const warnings = [];
  const state = {
    api: { log: { warn: (...args) => warnings.push(args) } },
    directCommentAliases: new Map(),
  };

  const submitted = routeBrowserDirectCommentAlias(state, { sender: { id: 1 } }, {
    type: "browser-sidebar-comment-overlay-submit",
    conversationId: "thread-1",
    browserConversationId: "thread-1:browser:tab-a",
    sessionId: "session-3",
    body: "annotated",
  });

  assert.equal(submitted.conversationId, "thread-1:browser:tab-a");
  assert.equal(warnings.length, 0);
});
