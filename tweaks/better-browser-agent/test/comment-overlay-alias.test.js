"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.BETTER_BROWSER_TEST = "1";

const {
  __test: {
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
    type: "browser-sidebar-comment-overlay-mounted",
    conversationId: "thread-3",
    sessionId: "session-3",
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
