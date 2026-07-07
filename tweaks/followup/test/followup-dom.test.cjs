const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const followupModule = loadCommonJs(path.join(__dirname, "../index.js"));
const tweak = followupModule.__test;

test("scanMessages renders and hides payloads for historical and newest assistant messages", () => {
  const restore = installFakeDom();
  try {
    const first = assistantMessage("Improve docs");
    const second = assistantMessage("Fix lint");
    document.body.append(first, second);

    tweak.scanMessages({
      enabled: true,
      title: "Follow-up",
      showDivider: false,
      clickableItems: true,
    });

    const panels = document.body.querySelectorAll(`[${tweak.PANEL_ATTR}]`);
    const hiddenBlocks = document.body.querySelectorAll(`[${tweak.HIDDEN_ATTR}]`);
    assert.equal(panels.length, 2);
    assert.equal(hiddenBlocks.length, 2);
    assert.match(panels[0].textContent, /Improve docs/);
    assert.match(panels[1].textContent, /Fix lint/);
    assert.equal(hiddenBlocks[0].hidden, true);
    assert.equal(hiddenBlocks[1].hidden, true);
  } finally {
    restore();
  }
});

test("scanMessages leaves non-final example payloads visible", () => {
  const restore = installFakeDom();
  try {
    const message = assistantMessage("Example prompt");
    const markdown = message.querySelector("[class*='_markdownContent_']");
    const trailingText = document.createElement("p");
    trailingText.textContent = "This JSON is an example, not the final Follow-up payload.";
    markdown.appendChild(trailingText);
    document.body.append(message);

    tweak.scanMessages({
      enabled: true,
      title: "Follow-up",
      showDivider: false,
      clickableItems: true,
    });

    assert.equal(document.body.querySelectorAll(`[${tweak.PANEL_ATTR}]`).length, 0);
    assert.equal(document.body.querySelectorAll(`[${tweak.HIDDEN_ATTR}]`).length, 0);
    assert.match(document.body.textContent, /Example prompt/);
    assert.match(document.body.textContent, /This JSON is an example/);
  } finally {
    restore();
  }
});

test("scanMessages ignores explicit user-role payload messages", () => {
  const restore = installFakeDom();
  try {
    const message = assistantMessage("Do not render");
    message.setAttribute("data-message-author-role", "user");
    document.body.append(message);

    tweak.scanMessages({
      enabled: true,
      title: "Follow-up",
      showDivider: false,
      clickableItems: true,
    });

    assert.equal(document.body.querySelectorAll(`[${tweak.PANEL_ATTR}]`).length, 0);
    assert.equal(document.body.querySelectorAll(`[${tweak.HIDDEN_ATTR}]`).length, 0);
  } finally {
    restore();
  }
});

test("scanMessages can scan only provided message roots", () => {
  const restore = installFakeDom();
  try {
    const first = assistantMessage("Skip for now");
    const second = assistantMessage("Render this one");
    document.body.append(first, second);

    tweak.scanMessages({
      enabled: true,
      title: "Follow-up",
      showDivider: false,
      clickableItems: true,
    }, [second]);

    assert.equal(first.querySelectorAll(`[${tweak.PANEL_ATTR}]`).length, 0);
    assert.equal(second.querySelectorAll(`[${tweak.PANEL_ATTR}]`).length, 1);
    assert.match(second.textContent, /Render this one/);
  } finally {
    restore();
  }
});

test("mutation root collection returns changed message roots only", () => {
  const restore = installFakeDom();
  try {
    const first = assistantMessage("First");
    const second = assistantMessage("Second");
    const wrapper = document.createElement("div");
    wrapper.appendChild(second);
    document.body.append(first, wrapper);

    const roots = tweak.collectMutationMessageRoots([
      { target: first.querySelector("pre"), addedNodes: [] },
      { target: document.body, addedNodes: [wrapper] },
    ]);

    assert.deepEqual(roots, [first, second]);
  } finally {
    restore();
  }
});

test("signature-gated scans skip unchanged payload signatures", () => {
  const restore = installFakeDom();
  try {
    const message = assistantMessage("Initial");
    document.body.append(message);
    const state = {};

    assert.equal(tweak.shouldRunSignatureGatedScan(state), true);
    assert.equal(tweak.shouldRunSignatureGatedScan(state), false);

    message.querySelector("code").textContent = JSON.stringify({
      codex_follow_up: true,
      title: "Follow-up",
      items: [{ prompt: "Changed", achieves: ["Done"] }],
    });

    assert.equal(tweak.shouldRunSignatureGatedScan(state), true);
  } finally {
    restore();
  }
});

test("signature-gated scans wait while the composer was recently active", () => {
  const restore = installFakeDom();
  const previousNow = Date.now;
  try {
    const message = assistantMessage("Initial");
    document.body.append(message);
    const state = { lastComposerInputAt: 1000 };

    Date.now = () => 1200;
    assert.equal(tweak.isFollowupComposerRecentlyActive(state), true);
    assert.equal(tweak.shouldRunSignatureGatedScan(state), false);

    Date.now = () => 2600;
    assert.equal(tweak.isFollowupComposerRecentlyActive(state), false);
    assert.equal(tweak.shouldRunSignatureGatedScan(state), true);

    const textarea = document.createElement("textarea");
    assert.equal(tweak.isFollowupComposerEventTarget(textarea), true);
  } finally {
    Date.now = previousNow;
    restore();
  }
});

test("renderer observer skips characterData streaming mutations", () => {
  const restore = installFakeDom();
  try {
    const observers = [];
    global.MutationObserver = class FakeMutationObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(target, options) {
        this.target = target;
        this.options = options;
      }

      disconnect() {
        this.disconnected = true;
      }
    };

    const context = {};
    followupModule.start.call(context, fakeRendererApi());

    assert.equal(observers.length, 1);
    assert.deepEqual(observers[0].options, {
      childList: true,
      subtree: true,
    });

    followupModule.stop.call(context);
    assert.equal(observers[0].disconnected, true);
  } finally {
    restore();
  }
});

test("signature-gated interval scans use idle callbacks", () => {
  const restore = installFakeDom();
  try {
    const intervals = [];
    const idleCallbacks = [];
    let cancelledIdle = null;
    global.window.setInterval = (callback, ms) => {
      intervals.push({ callback, ms });
      return 1;
    };
    global.window.requestIdleCallback = (callback, options) => {
      idleCallbacks.push({ callback, options });
      return 42;
    };
    global.window.cancelIdleCallback = (id) => {
      cancelledIdle = id;
    };
    global.MutationObserver = class FakeMutationObserver {
      observe() {}
      disconnect() {}
    };

    const context = {};
    followupModule.start.call(context, fakeRendererApi());

    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].ms, 3000);
    intervals[0].callback();
    assert.equal(idleCallbacks.length, 1);
    assert.equal(idleCallbacks[0].options.timeout, 3000);

    followupModule.stop.call(context);
    assert.equal(cancelledIdle, 42);
  } finally {
    restore();
  }
});

test("main IPC handlers become inert after stop when runtime cannot dispose them", async () => {
  resetMainGlobals();
  const handlers = new Map();
  const api = fakeMainApi({
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false);
      handlers.set(channel, handler);
    },
  });

  const context = {};
  followupModule.start.call(context, api);
  followupModule.stop.call(context);

  const result = await handlers.get(tweak.IPC_SYNC_AGENTS)({ enabled: false });
  assert.deepEqual(result, {
    ok: false,
    error: "Follow-up service unavailable",
  });

  followupModule.start.call(context, api);
  assert.equal(handlers.size, 3);
  followupModule.stop.call(context);
  resetMainGlobals();
});

test("main IPC handlers are disposed when runtime returns disposers", () => {
  resetMainGlobals();
  const disposed = [];
  const api = fakeMainApi({
    handle(channel) {
      return () => disposed.push(channel);
    },
  });

  const context = {};
  followupModule.start.call(context, api);
  followupModule.stop.call(context);

  assert.deepEqual(disposed.sort(), [
    tweak.IPC_DEFAULTS,
    tweak.IPC_RELOAD_TWEAKS,
    tweak.IPC_SYNC_AGENTS,
  ].sort());
  resetMainGlobals();
});

test("main defaults IPC returns the same prompt used for previews", async () => {
  resetMainGlobals();
  const handlers = new Map();
  const api = fakeMainApi({
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  });

  const context = {};
  followupModule.start.call(context, api);

  const result = await handlers.get(tweak.IPC_DEFAULTS)({
    prompt: "CUSTOM PROMPT",
    targets: [],
  });

  assert.equal(result.prompt, "CUSTOM PROMPT");
  assert.match(result.instruction, /CUSTOM PROMPT/);

  followupModule.stop.call(context);
  resetMainGlobals();
});

test("main defaults IPC includes skill no-follow-up exceptions", async () => {
  resetMainGlobals();
  const handlers = new Map();
  const api = fakeMainApi({
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  });

  const context = {};
  followupModule.start.call(context, api);

  const result = await handlers.get(tweak.IPC_DEFAULTS)({ targets: [] });

  assert.match(result.prompt, /Matt Pocock skill/);
  assert.match(result.prompt, /mattpocock\/skills/);
  assert.match(result.prompt, /Ponytail skill/);
  assert.match(result.prompt, /Ponytail plugin/);
  assert.match(result.prompt, /request_user_input/);
  assert.match(result.prompt, /\(Recommended\)/);
  assert.match(result.prompt, /Use everyday words first/);
  assert.match(result.prompt, /Technical now:/);
  assert.match(result.prompt, /Better Follow-up:/);
  assert.match(result.prompt, /Update existing chats to use the clearer Follow-up wording/);
  assert.match(result.prompt, /Make Follow-up suggestions appear without slowing long chats/);
  assert.match(result.instruction, /Do not emit this payload when the turn uses any Matt Pocock skill/);
  assert.match(result.instruction, /any Ponytail skill/);
  assert.doesNotMatch(result.instruction, /Always include a Follow-up payload/);
  assert.doesNotMatch(result.instruction, /Rules: always emit/);

  followupModule.stop.call(context);
  resetMainGlobals();
});

test("injected panel CSS uses Codex token variables instead of hard-coded black", () => {
  const restore = installFakeDom();
  try {
    tweak.injectStyles();
    const style = document.getElementById(tweak.STYLE_ID);
    assert.ok(style);
    assert.doesNotMatch(style.textContent, /#000000/i);
    assert.match(style.textContent, /--color-token-text-primary/);
    assert.match(style.textContent, /--color-token-text-secondary/);
    assert.match(style.textContent, /--color-token-bg-secondary/);
  } finally {
    restore();
  }
});

test("scanMessages refreshes an existing panel when achieves text changes", () => {
  const restore = installFakeDom();
  try {
    const message = assistantMessage("Fix docs", ["Old result"]);
    document.body.append(message);
    const state = {
      enabled: true,
      title: "Follow-up",
      showDivider: false,
      clickableItems: true,
    };

    tweak.scanMessages(state);
    assert.match(document.body.textContent, /Old result/);

    const code = message.querySelector("code");
    code.textContent = JSON.stringify({
      codex_follow_up: true,
      title: "Follow-up",
      items: [{ prompt: "Fix docs", achieves: ["New result"] }],
    });

    tweak.scanMessages(state);

    assert.doesNotMatch(document.body.textContent, /Old result/);
    assert.match(document.body.textContent, /New result/);
  } finally {
    restore();
  }
});

test("findRadarPayload caches unchanged markdown and invalidates changed payload text", () => {
  const restore = installFakeDom();
  try {
    const message = assistantMessage("Fix docs", ["Old result"]);
    const markdown = message.querySelector("[class*='_markdownContent_']");
    const block = message.querySelector("pre");
    const code = message.querySelector("code");
    const cache = new WeakMap();

    const first = tweak.findRadarPayload(markdown, cache);
    assert.equal(first.items[0].prompt, "Fix docs");
    assert.equal(block.hidden, true);

    block.hidden = false;
    block.removeAttribute(tweak.HIDDEN_ATTR);
    block.style.removeProperty("display");

    const cached = tweak.findRadarPayload(markdown, cache);
    assert.equal(cached, first);
    assert.equal(block.hidden, true);
    assert.equal(block.hasAttribute(tweak.HIDDEN_ATTR), true);

    code.textContent = JSON.stringify({
      codex_follow_up: true,
      title: "Follow-up",
      items: [{ prompt: "Fix tests", achieves: ["New result"] }],
    });

    const changed = tweak.findRadarPayload(markdown, cache);
    assert.notEqual(changed, first);
    assert.equal(changed.items[0].prompt, "Fix tests");
  } finally {
    restore();
  }
});

test("multi-select composer insertion preserves numbering and clears when deselected", () => {
  const restore = installFakeDom();
  try {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    const panel = tweak.renderRadarPanel({
      title: "Follow-up",
      items: [
        { prompt: "First prompt" },
        { prompt: "Second prompt" },
        { prompt: "Third prompt" },
        { prompt: "Fourth prompt" },
      ],
      showDivider: false,
      clickableItems: true,
      pending: false,
    });
    document.body.appendChild(panel);

    const rows = panel.querySelectorAll(".soren-radar-row-clickable");
    rows[1].dispatchEvent({ type: "click" });
    assert.equal(textarea.value, "2. Second prompt");

    rows[3].dispatchEvent({ type: "click" });
    assert.equal(textarea.value, "2. Second prompt\n4. Fourth prompt");

    rows[1].dispatchEvent({ type: "click" });
    assert.equal(textarea.value, "4. Fourth prompt");

    rows[3].dispatchEvent({ type: "click" });
    assert.equal(textarea.value, "");
  } finally {
    restore();
  }
});

test("composer insertion targets the active composer instead of an earlier settings textarea", () => {
  const restore = installFakeDom();
  try {
    const settingsTextarea = document.createElement("textarea");
    settingsTextarea.value = "settings";
    const composer = document.createElement("textarea");
    composer.value = "Start: ";
    composer.selectionStart = composer.value.length;
    composer.selectionEnd = composer.value.length;
    document.body.append(settingsTextarea, composer);
    document.activeElement = composer;

    const panel = tweak.renderRadarPanel({
      title: "Follow-up",
      items: [{ prompt: "First prompt" }],
      showDivider: false,
      clickableItems: true,
      pending: false,
    });
    document.body.appendChild(panel);

    panel.querySelector(".soren-radar-row-clickable").dispatchEvent({ type: "click" });
    assert.equal(settingsTextarea.value, "settings");
    assert.equal(composer.value, "1. First prompt");
  } finally {
    restore();
  }
});

test("managed AGENTS block replacement revises current block in place", () => {
  const source = [
    "# Repo",
    "",
    tweak.BLOCK_BEGIN,
    "old follow-up text",
    tweak.BLOCK_END,
    "",
    "## Keep",
  ].join("\n");

  const next = tweak.upsertManagedBlock(source, "new follow-up text");

  assert.match(next, /^# Repo\n\n<!-- shadgpt:co\.thomashulihan\.followup:start -->/);
  assert.match(next, /new follow-up text/);
  assert.doesNotMatch(next, /old follow-up text/);
  assert.match(next, /## Keep\n$/);
  assert.equal(countOccurrences(next, tweak.BLOCK_BEGIN), 1);
});

test("managed AGENTS block replacement collapses multiple legacy blocks", () => {
  const source = [
    "# Repo",
    "",
    tweak.UPSTREAM_BLOCK_BEGIN,
    "upstream text",
    tweak.UPSTREAM_BLOCK_END,
    "",
    "Middle",
    "",
    tweak.OLDEST_BLOCK_BEGIN,
    "oldest text",
    tweak.OLDEST_BLOCK_END,
    "",
    "Tail",
  ].join("\n");

  const next = tweak.upsertManagedBlock(source, "current text");

  assert.match(next, /current text/);
  assert.match(next, /# Repo/);
  assert.match(next, /Middle/);
  assert.match(next, /Tail/);
  assert.equal(countOccurrences(next, tweak.BLOCK_BEGIN), 1);
  assert.equal(countOccurrences(next, tweak.UPSTREAM_BLOCK_BEGIN), 0);
  assert.equal(countOccurrences(next, tweak.OLDEST_BLOCK_BEGIN), 0);
});

test("managed AGENTS removal deletes only Follow-up blocks", () => {
  const source = [
    "# Repo",
    "",
    tweak.BLOCK_BEGIN,
    "remove me",
    tweak.BLOCK_END,
    "",
    "Keep this instruction.",
  ].join("\n");

  const next = tweak.removeManagedBlock(source);

  assert.match(next, /^# Repo\n/);
  assert.match(next, /Keep this instruction\.\n$/);
  assert.equal(countOccurrences(next, tweak.BLOCK_BEGIN), 0);
});

test("sync service writes every shown AGENTS target and reports per-file status", () => {
  const root = tempDir();
  const first = path.join(root, "one", "AGENTS.md");
  const second = path.join(root, "two", "AGENTS.md");
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.writeFileSync(first, [
    "# One",
    "",
    tweak.LEGACY_BLOCK_BEGIN,
    "old custom text",
    tweak.LEGACY_BLOCK_END,
    "",
    "Keep one.",
  ].join("\n"), "utf8");

  const service = tweak.createAgentsSyncService({
    agentsTargetRoots: [root],
    log: {
      error: () => {},
    },
  });
  const result = service.syncAgentsInstruction({
    prompt: "CUSTOM PROMPT",
    targets: [
      { path: first, label: "First AGENTS.md" },
      { path: second, label: "Second AGENTS.md" },
    ],
  });
  const firstText = fs.readFileSync(first, "utf8");
  const secondText = fs.readFileSync(second, "utf8");

  assert.equal(result.ok, true);
  assert.equal(result.action, "updated");
  assert.equal(result.targets.length, 2);
  assert.deepEqual(result.targets.map((target) => target.action), ["updated", "updated"]);
  assert.match(firstText, /CUSTOM PROMPT/);
  assert.match(firstText, /Keep one\./);
  assert.equal(countOccurrences(firstText, tweak.BLOCK_BEGIN), 1);
  assert.equal(countOccurrences(firstText, tweak.LEGACY_BLOCK_BEGIN), 0);
  assert.match(secondText, /CUSTOM PROMPT/);
  assert.equal(countOccurrences(secondText, tweak.BLOCK_BEGIN), 1);
});

test("sync service skips disabled shown AGENTS targets", () => {
  const root = tempDir();
  const enabled = path.join(root, "enabled", "AGENTS.md");
  const disabled = path.join(root, "disabled", "AGENTS.md");
  fs.mkdirSync(path.dirname(enabled), { recursive: true });
  fs.mkdirSync(path.dirname(disabled), { recursive: true });
  fs.writeFileSync(disabled, "# Disabled\n", "utf8");

  const service = tweak.createAgentsSyncService({
    agentsTargetRoots: [root],
    log: {
      error: () => {},
    },
  });
  const result = service.syncAgentsInstruction({
    prompt: "CUSTOM PROMPT",
    targets: [
      { path: enabled, label: "Enabled AGENTS.md", enabled: true },
      { path: disabled, label: "Disabled AGENTS.md", enabled: false },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.targets.find((target) => target.label === "Enabled AGENTS.md")?.action, "updated");
  assert.equal(result.targets.find((target) => target.label === "Disabled AGENTS.md")?.action, "skipped");
  assert.match(fs.readFileSync(enabled, "utf8"), /CUSTOM PROMPT/);
  assert.equal(fs.readFileSync(disabled, "utf8"), "# Disabled\n");
});

test("sync service preserves explicit target ordering and custom labels", () => {
  const root = tempDir();
  const third = path.join(root, "third", "AGENTS.md");
  const first = path.join(root, "first", "AGENTS.md");
  fs.mkdirSync(path.dirname(third), { recursive: true });
  fs.mkdirSync(path.dirname(first), { recursive: true });

  const service = tweak.createAgentsSyncService({
    agentsTargetRoots: [root],
    log: {
      error: () => {},
    },
  });
  const result = service.syncAgentsInstruction({
    prompt: "CUSTOM PROMPT",
    targets: [
      { path: third, label: "3. Custom Third", defaultLabel: "Third AGENTS.md", source: "custom", order: 1 },
      { path: first, label: "1. Custom First", defaultLabel: "First AGENTS.md", source: "custom", order: 2 },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.targets.map((target) => target.label), ["3. Custom Third", "1. Custom First"]);
  assert.deepEqual(result.targets.map((target) => target.order), [1, 2]);
  assert.match(fs.readFileSync(third, "utf8"), /CUSTOM PROMPT/);
  assert.match(fs.readFileSync(first, "utf8"), /CUSTOM PROMPT/);
});

test("sync service removes only Follow-up blocks from shown AGENTS targets when disabled", () => {
  const root = tempDir();
  const agents = path.join(root, "AGENTS.md");
  fs.writeFileSync(agents, [
    "# Global",
    "",
    tweak.BLOCK_BEGIN,
    "remove me",
    tweak.BLOCK_END,
    "",
    "Keep global.",
  ].join("\n"), "utf8");

  const service = tweak.createAgentsSyncService({
    agentsTargetRoots: [root],
    log: {
      error: () => {},
    },
  });
  const result = service.syncAgentsInstruction({
    enabled: false,
    targets: [{ path: agents, label: "Global Codex AGENTS.md" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "removed");
  const agentsText = fs.readFileSync(agents, "utf8");
  assert.match(agentsText, /^# Global\n/);
  assert.match(agentsText, /Keep global\.\n$/);
  assert.equal(countOccurrences(agentsText, tweak.BLOCK_BEGIN), 0);
});

test("sync service blocks explicit AGENTS targets outside the allowed root", () => {
  const root = tempDir();
  const outside = tempDir();
  const outsideAgents = path.join(outside, "AGENTS.md");
  fs.writeFileSync(outsideAgents, "# Outside\n", "utf8");

  const service = tweak.createAgentsSyncService({
    agentsTargetRoots: [root],
    log: {
      error: () => {},
    },
  });
  const result = service.syncAgentsInstruction({
    prompt: "CUSTOM PROMPT",
    targets: [{ path: outsideAgents, label: "Outside AGENTS.md" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.action, "failed");
  assert.equal(result.targets[0].action, "blocked");
  assert.match(result.targets[0].error, /global Codex target or live under the current project root/);
  assert.equal(fs.readFileSync(outsideAgents, "utf8"), "# Outside\n");
});

test("target preview includes project AGENTS target and before-after text", () => {
  const root = tempDir();
  const codexHome = path.join(root, "codex-home");
  const project = path.join(root, "repo");
  const projectAgents = path.join(project, "AGENTS.md");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), "{}", "utf8");
  fs.writeFileSync(projectAgents, [
    "# Repo",
    "",
    tweak.UPSTREAM_BLOCK_BEGIN,
    "old prompt",
    tweak.UPSTREAM_BLOCK_END,
    "",
    tweak.OLDEST_BLOCK_BEGIN,
    "older prompt",
    tweak.OLDEST_BLOCK_END,
  ].join("\n"), "utf8");

  const previousHome = process.env.CODEX_HOME;
  const previousCwd = process.cwd();
  try {
    process.env.CODEX_HOME = codexHome;
    process.chdir(project);
    const targets = tweak.previewAgentsTargets({ prompt: "NEXT PROMPT" });
    const projectTarget = targets.find((target) => samePath(target.path, projectAgents));

    assert.ok(targets.some((target) => samePath(target.path, path.join(codexHome, "AGENTS.md"))));
    assert.equal(targets[0].source, "global");
    assert.equal(targets[0].sourceLabel, "Global target");
    assert.equal(targets[0].order, 1);
    assert.equal(targets[1].source, "project");
    assert.equal(targets[1].sourceLabel, "Project target");
    assert.equal(targets[1].order, 2);
    assert.ok(projectTarget);
    assert.equal(projectTarget.exists, true);
    assert.equal(projectTarget.hasManagedBlock, true);
    assert.equal(projectTarget.legacyBlockCount, 2);
    assert.match(projectTarget.beforeText, /old prompt/);
    assert.match(projectTarget.afterText, /NEXT PROMPT/);
    assert.equal(countOccurrences(projectTarget.afterText, tweak.BLOCK_BEGIN), 1);
    assert.equal(countOccurrences(projectTarget.afterText, tweak.UPSTREAM_BLOCK_BEGIN), 0);
    assert.equal(countOccurrences(projectTarget.afterText, tweak.OLDEST_BLOCK_BEGIN), 0);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
  }
});

function assistantMessage(prompt, achieves = ["Done"]) {
  const message = document.createElement("div");
  message.className = "group flex min-w-0 flex-col";
  const markdown = document.createElement("div");
  markdown.className = "_markdownContent_1rhk1_42";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = JSON.stringify({
    codex_follow_up: true,
    title: "Follow-up",
    items: [{ prompt, achieves }],
  });
  pre.appendChild(code);
  markdown.appendChild(pre);
  message.appendChild(markdown);
  return message;
}

function tempDir() {
  return fs.mkdtempSync(path.join(require("node:os").tmpdir(), "followup-test-"));
}

function countOccurrences(value, needle) {
  return String(value).split(needle).length - 1;
}

function samePath(left, right) {
  return fs.realpathSync.native(path.dirname(left)) === fs.realpathSync.native(path.dirname(right)) &&
    path.basename(left) === path.basename(right);
}

function installFakeDom() {
  const previous = {
    document: global.document,
    HTMLElement: global.HTMLElement,
    HTMLButtonElement: global.HTMLButtonElement,
    HTMLTextAreaElement: global.HTMLTextAreaElement,
    InputEvent: global.InputEvent,
    MutationObserver: global.MutationObserver,
    navigator: global.navigator,
    requestAnimationFrame: global.requestAnimationFrame,
    window: global.window,
  };
  global.HTMLElement = FakeElement;
  global.HTMLButtonElement = FakeElement;
  global.HTMLTextAreaElement = FakeElement;
  global.InputEvent = class FakeInputEvent {
    constructor(type, options = {}) {
      this.type = type;
      Object.assign(this, options);
    }
  };
  global.document = new FakeDocument();
  global.navigator = {
    clipboard: {
      writeText: () => Promise.resolve(),
    },
  };
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  global.window = {
    clearTimeout: () => {},
    clearInterval: () => {},
    setInterval: () => 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (callback) => {
      callback();
      return 1;
    },
  };
  return () => {
    global.document = previous.document;
    global.HTMLElement = previous.HTMLElement;
    global.HTMLButtonElement = previous.HTMLButtonElement;
    global.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    global.InputEvent = previous.InputEvent;
    global.MutationObserver = previous.MutationObserver;
    global.navigator = previous.navigator;
    global.requestAnimationFrame = previous.requestAnimationFrame;
    global.window = previous.window;
  };
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.documentElement.append(this.head, this.body);
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return this.documentElement.querySelectorAll("*").find((node) => node.id === id) || null;
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.listeners = new Map();
    this._className = "";
    this._textContent = "";
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = value;
      },
      removeProperty: (name) => {
        delete this.style[name];
      },
    };
    this.classList = {
      add: (...classes) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const item of classes) current.add(item);
        this.className = Array.from(current).join(" ");
      },
      toggle: (className, force) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) current.add(className);
        else current.delete(className);
        this.className = Array.from(current).join(" ");
      },
    };
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || "");
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this.textContent = value;
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children.length = 0;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  replaceWith(node) {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) {
      node.parentElement = this.parentElement;
      siblings.splice(index, 1, node);
      this.parentElement = null;
    }
  }

  remove() {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }

  focus() {
    this.focused = true;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      if (node.matches(selector)) results.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return results;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  matches(selector) {
    return selector.split(",").map((part) => part.trim()).some((part) => {
      if (part === "*") return true;
      if (part === "pre" || part === "code" || part === "textarea") return this.tagName.toLowerCase() === part;
      if (part === "div.group.flex.min-w-0.flex-col") return this.tagName === "DIV" && hasClasses(this, ["group", "flex", "min-w-0", "flex-col"]);
      if (part.startsWith("._markdownContent_")) return this.className.split(/\s+/).some((item) => item.startsWith("_markdownContent_"));
      if (part === "[class*='_markdownContent_']") return this.className.includes("_markdownContent_");
      if (part === '[contenteditable="true"]') return this.getAttribute("contenteditable") === "true";
      const attr = part.match(/^\[([^\]]+)\]$/)?.[1];
      if (attr) return this.hasAttribute(attr);
      const className = part.match(/^\.([\w-]+)$/)?.[1];
      if (className) return hasClasses(this, [className]);
      return false;
    });
  }
}

function hasClasses(node, classNames) {
  const current = new Set(String(node.className || "").split(/\s+/).filter(Boolean));
  return classNames.every((className) => current.has(className));
}

function fakeRendererApi() {
  return {
    process: "renderer",
    storage: {
      get: (_key, fallback) => fallback,
      set: () => {},
    },
    settings: {},
    ipc: {},
    log: {
      info: () => {},
      error: () => {},
    },
  };
}

function fakeMainApi(ipc) {
  return {
    process: "main",
    ipc,
    codex: {
      tweaks: {
        reload: async () => {},
      },
    },
    log: {
      info: () => {},
      error: () => {},
    },
  };
}

function resetMainGlobals() {
  globalThis.__shadgptFollowupService = null;
  globalThis.__shadgptFollowupHandlers = null;
}

function loadCommonJs(filename) {
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const source = fs.readFileSync(filename, "utf8");
  const wrapped = Module.wrap(source);
  const script = new vm.Script(wrapped, { filename });
  const compiled = script.runInThisContext();
  compiled.call(mod.exports, mod.exports, mod.require.bind(mod), mod, filename, path.dirname(filename));
  return mod.exports;
}
