/**
 * Codex Follow-up
 *
 * Renderer: turns a structured JSON block emitted by Codex into an
 * OpenWebUI-style follow-up panel under assistant messages.
 *
 * Main: syncs the AGENTS.md instruction that tells Codex when/how to emit
 * that structured JSON block.
 */

const TWEAK_ID = "co.thomashulihan.followup";
const UPSTREAM_TWEAK_ID = "co.Arconte112.followup";
const LEGACY_TWEAK_ID = "co.codex.followup";
const OLDEST_TWEAK_ID = "co.soren.radar-followups";
const MESSAGE_SELECTOR = "div.group.flex.min-w-0.flex-col";
const MARKDOWN_SELECTOR = "._markdownContent_1rhk1_42, [class*='_markdownContent_']";
const PAYLOAD_TEXT_PATTERN = /codex_follow_up|soren_radar|follow_ups/i;
const PANEL_ATTR = "data-soren-radar-panel";
const HIDDEN_ATTR = "data-soren-radar-hidden";
const SIGNATURE_GATED_SCAN_INTERVAL_MS = 3000;
const FOLLOWUP_COMPOSER_QUIET_MS = 1500;
const FOLLOWUP_IDLE_SCAN_FALLBACK_MS = 250;

const STYLE_ID = "soren-radar-followups-style";
const IPC_SYNC_AGENTS = "soren-radar:sync-agents";
const IPC_DEFAULTS = "soren-radar:defaults";
const IPC_RELOAD_TWEAKS = "soren-radar:reload-tweaks";
const STORAGE_DISABLED_TARGETS = "disabledAgentsTargets";
const STORAGE_TARGET_LABELS = "agentsTargetLabels";
const STORAGE_TARGET_ORDER = "agentsTargetOrder";
const MAIN_SERVICE_KEY = "__shadgptFollowupService";
const MAIN_HANDLER_KEY = "__shadgptFollowupHandlers";
const SHADGPT_BLOCK_PREFIX = "shadgpt";
const LEGACY_BLOCK_PREFIX = ["codex", "plusplus"].join("-");
const BLOCK_BEGIN = `<!-- ${SHADGPT_BLOCK_PREFIX}:${TWEAK_ID}:start -->`;
const BLOCK_END = `<!-- ${SHADGPT_BLOCK_PREFIX}:${TWEAK_ID}:end -->`;
const PREVIOUS_BLOCK_BEGIN = `<!-- ${LEGACY_BLOCK_PREFIX}:${TWEAK_ID}:start -->`;
const PREVIOUS_BLOCK_END = `<!-- ${LEGACY_BLOCK_PREFIX}:${TWEAK_ID}:end -->`;
const UPSTREAM_BLOCK_BEGIN = `<!-- ${LEGACY_BLOCK_PREFIX}:${UPSTREAM_TWEAK_ID}:start -->`;
const UPSTREAM_BLOCK_END = `<!-- ${LEGACY_BLOCK_PREFIX}:${UPSTREAM_TWEAK_ID}:end -->`;
const LEGACY_BLOCK_BEGIN = `<!-- ${LEGACY_BLOCK_PREFIX}:${LEGACY_TWEAK_ID}:start -->`;
const LEGACY_BLOCK_END = `<!-- ${LEGACY_BLOCK_PREFIX}:${LEGACY_TWEAK_ID}:end -->`;
const OLDEST_BLOCK_BEGIN = `<!-- ${LEGACY_BLOCK_PREFIX}:${OLDEST_TWEAK_ID}:start -->`;
const OLDEST_BLOCK_END = `<!-- ${LEGACY_BLOCK_PREFIX}:${OLDEST_TWEAK_ID}:end -->`;

const OLD_DEFAULT_FOLLOWUP_PROMPT_FINGERPRINTS = new Set([
  "2376:k9bio",
  "3521:1077oaq",
  "4143:maresi",
]);

const DEFAULT_FOLLOWUP_PROMPT = [
  "## TWEAKS: Codex Follow-up",
  "",
  "Normally include a Follow-up payload at the end of every final assistant response.",
  "",
  "Exception: when a turn uses any Matt Pocock skill or capability from the `mattpocock/skills` plugin, or any Ponytail skill or capability from the Ponytail plugin, do not emit a Follow-up payload.",
  "",
  "During Matt Pocock or Ponytail skill turns, use native `request_user_input` for bounded choices whenever the tool is available. If it is unavailable, ask one concise plain-text question instead.",
  "",
  "For those selectable questions, provide options and put `(Recommended)` in the recommended option label. If multiple recommendations belong together, present them as one combined option such as `A + B (Recommended)`.",
  "",
  "When generating a Follow-up payload, generate exactly 5 follow-up items.",
  "",
  "Apply this Follow-up behavior across all projects and chats except turns using Matt Pocock or Ponytail skills or plugin capabilities.",
  "",
  "Every Follow-up item must suggest a concrete fix or improvement to the feature, aspect, workflow, file, decision, blocker, or visible result being discussed in the current chat.",
  "",
  "Crucial tests, reviews, and verification are not Follow-up options. When they are needed to complete the current user request safely, do them before the final response and report the result in the visible answer. If a required check cannot be completed, explain that blocker in the visible answer; the Follow-up payload must still contain only future fixes or improvements.",
  "",
  "Each item should be one of:",
  "- a next fix or improvement for an active or partially completed plan",
  "- a concrete improvement the user can ask Codex to make next",
  "- a focused refinement to the current implementation, prompt, UI, workflow, docs, defaults, migration, or runtime behavior",
  "- an unresolved decision that directly improves the current feature once resolved",
  "- a context-aware continuation that improves the current result",
  "",
  "Do not generate Follow-up items whose main action is to test, verify, review, audit, inspect, compare, summarize, or generically clarify. Do not ask the user to request a crucial check that should already be part of completing the current work.",
  "",
  "If there is an active or partially completed plan, write the follow-ups as the next fixes or improvements for that plan. If the plan is done or there is no active plan, suggest targeted refinements, hardening, better defaults, UX improvements, migration improvements, docs improvements, or cleanup grounded in the conversation.",
  "",
  "Do not suggest staging, committing, opening pull requests, or other repo hygiene unless the user explicitly asked for that workflow in the current turn.",
  "",
  "Avoid generic filler such as \"Let me know if you need anything else\", \"Review the changes\", \"Ask another question\", or broad suggestions that could apply to any conversation.",
  "",
  "Use everyday words first. Avoid unexplained terms like migration, runtime, payload, DOM, MCP, source/cache parity, or CI unless the current task is specifically about that term.",
  "",
  "If a technical term is unavoidable, explain the visible result in the same item. The user should know what will change on screen, in the workflow, or in the saved files.",
  "",
  "Good Follow-up prompts:",
  "- \"Improve the Follow-up prompt so every item proposes a concrete change\"",
  "- \"Add prompt migration so existing installs adopt the new fixes-only default\"",
  "- \"Improve the final-response rule so required checks happen before suggestions are generated\"",
  "",
  "Bad Follow-up prompts:",
  "- \"Verify the Follow-up panel works\"",
  "- \"Review the generated suggestions\"",
  "- \"Summarize the Follow-up tweak behavior\"",
  "",
  "Each item needs `prompt` and `achieves`:",
  "- `prompt`: a concise, specific instruction that can be inserted into the composer and sent directly",
  "- `achieves`: 1 to 3 short, non-coding bullet points explaining what that suggestion will accomplish if the user chooses it",
  "",
  "Write both fields in simple, non-coding language. The user should understand the practical result without reading implementation details.",
  "",
  "Every Follow-up set should include examples in this mental shape, even though the final JSON still contains only the improved prompt and achieves fields:",
  "- Technical now: \"Add prompt migration so existing installs adopt the new fixes-only default\"",
  "- Better Follow-up: \"Update existing chats to use the clearer Follow-up wording\"",
  "- Better achieves: \"Old chats get the clearer suggestions too\" and \"No one has to reset settings by hand\"",
  "- Technical now: \"Refactor payload scanner to reduce DOM churn\"",
  "- Better Follow-up: \"Make Follow-up suggestions appear without slowing long chats\"",
  "- Better achieves: \"Long conversations stay smoother\" and \"Suggestions still show in the right place\"",
  "- Technical now: \"Add source/cache parity validation for default tweak assets\"",
  "- Better Follow-up: \"Keep the installed Follow-up copy matched with the repo version\"",
  "- Better achieves: \"The live app gets the same wording as the repo\" and \"Future repairs do not bring back old text\"",
  "",
  "The prompt should be short enough to scan in the Follow-up panel, but specific enough to tell Codex exactly what to improve next. The `achieves` bullets should be even shorter and explain the outcome, not the steps.",
  "",
  "For very small or factual answers, still produce 5 items, but make them practical fixes or improvements: apply a change, refine wording, harden behavior, improve defaults, clean up a related artifact, or continue a concrete implementation path.",
  "",
  "Keep the main answer focused. Put follow-up-only information only in the Follow-up payload, not repeated in the visible prose.",
].join("\n");

const LOCKED_FORMAT_INSTRUCTION = [
  "## LOCKED TWEAK FORMAT: Codex Follow-up",
  "",
  "Do not edit or remove this locked section manually. It is required by the ShadGPT Follow-up tweak.",
  "",
  "For every eligible final assistant response, append exactly one fenced JSON block at the very end. Do not emit this payload in reasoning, progress updates, tool logs, drafts, or intermediate messages.",
  "",
  "Do not emit this payload when the turn uses any Matt Pocock skill or capability from the `mattpocock/skills` plugin, or any Ponytail skill or capability from the Ponytail plugin.",
  "",
  "The visible answer must not repeat information that is meant only for Follow-up. If a detail belongs in Follow-up, put it only in the payload.",
  "",
  "Required payload format:",
  "",
  "```json",
  "{",
  '  "codex_follow_up": true,',
  '  "title": "Follow-up",',
  '  "items": [',
  "    {",
  '      "prompt": "Specific follow-up instruction the user can click and send",',
  '      "achieves": [',
  '        "Simple explanation of what this will accomplish"',
  "      ]",
  "    }",
  "  ]",
  "}",
  "```",
  "",
  "Rules: emit the JSON block for eligible final assistant responses except the Matt Pocock and Ponytail skills exception; use exactly 5 items; each prompt must be concise and useful; each achieves value must contain 1 to 3 simple outcome bullets; do not explain that the JSON exists.",
].join("\n");

const DEFAULT_AGENTS_INSTRUCTION = composeAgentsInstruction(DEFAULT_FOLLOWUP_PROMPT);

module.exports = {
  start(api) {
    if (api.process === "main") {
      startMain.call(this, api);
      return;
    }
    if (api.process !== "renderer") return;
    startRenderer.call(this, api);
  },

  stop() {
    const mainState = this._mainState;
    if (mainState) {
      mainState.serviceState.stopped = true;
      if (globalThis[MAIN_SERVICE_KEY] === mainState.serviceState) {
        globalThis[MAIN_SERVICE_KEY] = null;
      }
      if (mainState.handlers.disposers.length > 0) {
        for (const dispose of mainState.handlers.disposers) {
          try {
            dispose?.();
          } catch {
            // Disposers should be idempotent; swallow to keep cleanup going.
          }
        }
        mainState.handlers.disposers.length = 0;
        mainState.handlers.registered = false;
        if (globalThis[MAIN_HANDLER_KEY] === mainState.handlers) {
          globalThis[MAIN_HANDLER_KEY] = null;
        }
      }
      this._mainState = null;
    }

    const state = this._state;
    if (!state) return;
    state.disposed = true;
    state.observer?.disconnect();
    if (state.interval) window.clearInterval(state.interval);
    cancelFollowupScheduledScan(state.scanTask);
    window.removeEventListener("focus", state.scheduleScan);
    document.removeEventListener("visibilitychange", state.scheduleScan);
    document.removeEventListener("beforeinput", state.markComposerInput, true);
    document.removeEventListener("input", state.markComposerInput, true);
    state.pageHandle?.unregister?.();
    clearPanels();
    document.getElementById(STYLE_ID)?.remove();
  },

  __test: {
    scanMessages,
    parseRadarJson,
    findRadarPayload,
    normalizeFollowupItem,
    renderRadarPanel,
    injectStyles,
    IPC_SYNC_AGENTS,
    IPC_DEFAULTS,
    IPC_RELOAD_TWEAKS,
    STYLE_ID,
    PANEL_ATTR,
    HIDDEN_ATTR,
    BLOCK_BEGIN,
    BLOCK_END,
    PREVIOUS_BLOCK_BEGIN,
    PREVIOUS_BLOCK_END,
    UPSTREAM_BLOCK_BEGIN,
    UPSTREAM_BLOCK_END,
    LEGACY_BLOCK_BEGIN,
    LEGACY_BLOCK_END,
    OLDEST_BLOCK_BEGIN,
    OLDEST_BLOCK_END,
    createAgentsSyncService,
    composeAgentsInstruction,
    upsertManagedBlock,
    removeManagedBlock,
    hasManagedBlock,
    resolveAgentsTargets,
    previewAgentsTargets,
    collectMutationMessageRoots,
    resolveScanMessageNodes,
    shouldRunSignatureGatedScan,
    isFollowupComposerRecentlyActive,
    isFollowupComposerEventTarget,
  },
};

function startMain(api) {
  const service = createAgentsSyncService(api);
  const serviceState = { api, service, stopped: false };
  globalThis[MAIN_SERVICE_KEY] = serviceState;

  let handlers = globalThis[MAIN_HANDLER_KEY];
  if (!handlers?.registered) {
    handlers = { registered: true, disposers: [] };

    const disposeSync = api.ipc.handle(IPC_SYNC_AGENTS, (settings = {}) => {
      return getActiveMainService()?.syncAgentsInstruction(settings) || {
        ok: false,
        error: "Follow-up service unavailable",
      };
    });
    if (typeof disposeSync === "function") handlers.disposers.push(disposeSync);

    const disposeDefaults = api.ipc.handle(IPC_DEFAULTS, (settings = {}) => {
      const active = getActiveMainService();
      const prompt = settings.prompt ?? DEFAULT_FOLLOWUP_PROMPT;
      return {
        agentsPath: active?.getAgentsPath?.() || "",
        prompt,
        instruction: composeAgentsInstruction(prompt),
        targets: active?.previewAgentsTargets?.({
          enabled: settings.enabled !== false,
          prompt,
          targets: settings.targets,
        }) || [],
      };
    });
    if (typeof disposeDefaults === "function") handlers.disposers.push(disposeDefaults);

    const disposeReload = api.ipc.handle(IPC_RELOAD_TWEAKS, async () => {
      const active = getActiveMainServiceState();
      if (!active) {
        return {
          ok: false,
          error: "Follow-up service unavailable",
        };
      }
      const manager = active.api.codex?.tweaks;
      if (!manager || typeof manager.reload !== "function") {
        return {
          ok: false,
          error: "Installed tweak reload is unavailable in this ShadGPT runtime.",
        };
      }
      await manager.reload();
      return { ok: true };
    });
    if (typeof disposeReload === "function") handlers.disposers.push(disposeReload);

    globalThis[MAIN_HANDLER_KEY] = handlers;
  }

  this._mainState = { serviceState, handlers };

  api.log.info("Codex Follow-up main provider active");
}

function getActiveMainServiceState() {
  const active = globalThis[MAIN_SERVICE_KEY];
  if (!active || active.stopped) return null;
  return active;
}

function getActiveMainService() {
  return getActiveMainServiceState()?.service || null;
}

function startRenderer(api) {
  const promptState = resolveFollowupPrompt(api);
  const state = {
    api,
    enabled: api.storage.get("enabled", true),
    showDivider: api.storage.get("showDivider", true),
    clickableItems: api.storage.get("clickableItems", true),
    title: migrateTitle(api.storage.get("title", "Follow-up")),
    syncAgents: api.storage.get("syncAgents", true),
    followupPrompt: promptState.prompt,
    migrationStatus: promptState.status,
    observer: null,
    interval: null,
    disposed: false,
    scheduled: false,
    pageHandle: null,
    statusEl: null,
    migrationEl: null,
    previewPromptEl: null,
    targetsEl: null,
    targetStatusEl: null,
    agentsTargets: [],
    disabledAgentTargetPaths: normalizeStoredDisabledTargets(api.storage.get(STORAGE_DISABLED_TARGETS, [])),
    agentTargetLabels: normalizeStoredTargetLabels(api.storage.get(STORAGE_TARGET_LABELS, {})),
    agentTargetOrder: normalizeStoredTargetOrder(api.storage.get(STORAGE_TARGET_ORDER, [])),
    payloadCache: new WeakMap(),
    pendingScanRoots: new Set(),
    signatureGatedScan: false,
    lastFallbackPayloadSignature: "",
    lastComposerInputAt: 0,
    scanTask: null,
    markComposerInput: null,
  };

  if (typeof api.settings?.registerPage === "function") {
    state.pageHandle = api.settings.registerPage({
      id: "main",
      title: "Follow-up",
      description: "Render clickable follow-ups under assistant messages.",
      iconSvg:
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle cx="10" cy="10" r="6.5" stroke="currentColor" stroke-width="1.4"/>' +
        '<circle cx="10" cy="10" r="2" fill="currentColor"/>' +
        '<path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        "</svg>",
      render: (root) => renderSettings(root, state),
    });
  }

  const runScheduledScan = () => {
    state.scheduled = false;
    state.scanTask = null;
    const scanRoots = state.pendingScanRoots.size > 0
      ? Array.from(state.pendingScanRoots)
      : null;
    const signatureGated = state.signatureGatedScan && !scanRoots;
    state.pendingScanRoots.clear();
    state.signatureGatedScan = false;
    if (state.disposed) return;
    if (signatureGated && !shouldRunSignatureGatedScan(state)) return;
    scanMessages(state, scanRoots);
  };

  const scheduleScan = (roots = null, options = {}) => {
    if (state.disposed) return;
    for (const root of normalizeScanRoots(roots)) {
      state.pendingScanRoots.add(root);
    }
    if (options.signatureGated === true) state.signatureGatedScan = true;
    if (state.scheduled) {
      if (state.pendingScanRoots.size === 0 || state.scanTask?.kind !== "idle") return;
      cancelFollowupScheduledScan(state.scanTask);
      state.scheduled = false;
      state.scanTask = null;
    }
    state.scheduled = true;
    const useIdle = state.signatureGatedScan && state.pendingScanRoots.size === 0;
    state.scanTask = scheduleFollowupDeferredScan(runScheduledScan, { idle: useIdle });
  };

  state.markComposerInput = (event) => {
    if (!isFollowupComposerEventTarget(event?.target)) return;
    state.lastComposerInputAt = Date.now();
  };

  state.scheduleScan = scheduleScan;
  injectStyles();
  scheduleScan();

  state.observer = new MutationObserver((mutations) => {
    const roots = collectMutationMessageRoots(mutations);
    if (roots.length > 0) scheduleScan(roots);
  });
  // Watch only structural changes. characterData fired this observer on every
  // streamed character; the follow-up panel is injected once a message turn
  // finishes (a childList change), so per-token text updates are irrelevant
  // and were a major contributor to streaming lag.
  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  state.interval = window.setInterval(() => scheduleScan(null, { signatureGated: true }), SIGNATURE_GATED_SCAN_INTERVAL_MS);
  window.addEventListener("focus", scheduleScan);
  document.addEventListener("visibilitychange", scheduleScan);
  document.addEventListener("beforeinput", state.markComposerInput, true);
  document.addEventListener("input", state.markComposerInput, true);

  this._state = state;

  if (state.syncAgents) {
    window.setTimeout(() => syncAgentsInstruction(state, { quiet: true }), 1_500);
  }
  window.setTimeout(() => refreshAgentsTargets(state, { quiet: true }), 0);

  api.log.info("Codex Follow-up renderer active");
}

function scanMessages(state, roots = null) {
  if (!state.enabled) {
    state.payloadCache = new WeakMap();
    clearPanels();
    return;
  }

  const messageNodes = resolveScanMessageNodes(roots);
  for (const node of messageNodes) {
    if (!(node instanceof HTMLElement)) continue;
    const existing = node.querySelector(`[${PANEL_ATTR}]`);
    if (!isAssistantMessageNode(node)) {
      existing?.remove();
      continue;
    }
    const markdown = node.querySelector(MARKDOWN_SELECTOR);
    if (!(markdown instanceof HTMLElement)) continue;

    const payload = findRadarPayload(markdown, state.payloadCache);

    if (!payload) {
      existing?.remove();
      continue;
    }

    const items = Array.isArray(payload.items)
      ? payload.items
        .map(normalizeFollowupItem)
        .filter((item) => item.prompt)
        .slice(0, 5)
      : [];

    if (items.length === 0 && !payload.pending) {
      existing?.remove();
      continue;
    }

    const title = cleanPanelTitle(payload.title, state.title);
    const signature = JSON.stringify({
      title,
      items: items.map((item) => ({
        prompt: item.prompt,
        achieves: normalizeAchieves(item.achieves),
      })),
      showDivider: state.showDivider,
      clickableItems: state.clickableItems,
      pending: !!payload.pending,
    });

    if (existing?.dataset.signature === signature) continue;

    const panel = renderRadarPanel({
      title,
      items,
      showDivider: state.showDivider,
      clickableItems: state.clickableItems,
      pending: !!payload.pending,
    });
    panel.dataset.signature = signature;

    if (existing) existing.replaceWith(panel);
    else node.appendChild(panel);
  }

  state.lastFallbackPayloadSignature = currentDocumentPayloadSignature();
}

function normalizeScanRoots(roots) {
  if (!roots) return [];
  if (roots instanceof HTMLElement) return [roots];
  if (typeof roots[Symbol.iterator] === "function") {
    return Array.from(roots).filter((root) => root instanceof HTMLElement);
  }
  return [];
}

function resolveScanMessageNodes(roots = null) {
  if (roots === null || roots === undefined) {
    return Array.from(document.querySelectorAll(MESSAGE_SELECTOR));
  }

  const messages = new Set();
  for (const root of normalizeScanRoots(roots)) {
    const message = messageRootForNode(root);
    if (message) {
      messages.add(message);
      continue;
    }
    for (const node of root.querySelectorAll?.(MESSAGE_SELECTOR) || []) {
      if (node instanceof HTMLElement) messages.add(node);
    }
  }
  return Array.from(messages);
}

function collectMutationMessageRoots(mutations) {
  const roots = new Set();
  for (const mutation of mutations || []) {
    const targetRoot = messageRootForNode(mutation?.target);
    if (targetRoot) roots.add(targetRoot);

    for (const node of mutation?.addedNodes || []) {
      if (!(node instanceof HTMLElement)) continue;
      const message = messageRootForNode(node);
      if (message) {
        roots.add(message);
        continue;
      }
      for (const child of node.querySelectorAll?.(MESSAGE_SELECTOR) || []) {
        if (child instanceof HTMLElement) roots.add(child);
      }
    }
  }
  return Array.from(roots);
}

function messageRootForNode(node) {
  if (!(node instanceof HTMLElement)) return null;
  if (node.matches?.(MESSAGE_SELECTOR)) return node;
  const closest = node.closest?.(MESSAGE_SELECTOR);
  return closest instanceof HTMLElement ? closest : null;
}

function isAssistantMessageNode(node) {
  const role = messageRoleForNode(node);
  if (!role) return true;
  return role === "assistant" || role === "bot" || role === "model";
}

function messageRoleForNode(node) {
  let current = node instanceof HTMLElement ? node : null;
  while (current) {
    for (const attr of ["data-message-author-role", "data-author-role", "data-role"]) {
      const value = normalizeRoleText(current.getAttribute(attr));
      if (value) return value;
    }

    const testIdRole = normalizeRoleText(current.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const labelRole = normalizeRoleText(current.getAttribute("aria-label"));
    if (labelRole) return labelRole;

    current = current.parentElement;
  }
  return "";
}

function normalizeRoleText(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  if (/\b(user|human)\b/.test(text)) return "user";
  if (/\b(assistant|bot|model)\b/.test(text)) {
    return text.match(/\b(assistant|bot|model)\b/)?.[1] || "";
  }
  return "";
}

function shouldRunSignatureGatedScan(state) {
  if (isFollowupComposerRecentlyActive(state)) return false;
  const signature = currentDocumentPayloadSignature();
  if (state.lastFallbackPayloadSignature === signature) return false;
  state.lastFallbackPayloadSignature = signature;
  return true;
}

function isFollowupComposerRecentlyActive(state, now = Date.now()) {
  const lastComposerInputAt = Number(state?.lastComposerInputAt || 0);
  return lastComposerInputAt > 0 && now - lastComposerInputAt < FOLLOWUP_COMPOSER_QUIET_MS;
}

function isFollowupComposerEventTarget(target) {
  const element = followupElementFromTarget(target);
  if (!element) return false;
  if (isComposerSurface(element)) return true;
  return Boolean(element.closest?.([
    "textarea",
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
    "[data-testid*='composer']",
    "[data-testid*='prompt']",
    "[aria-label*='composer']",
    "[aria-label*='message']",
    "[data-codex-composer]",
  ].join(", ")));
}

function followupElementFromTarget(target) {
  if (!target) return null;
  if (typeof HTMLElement === "function" && target instanceof HTMLElement) return target;
  if (target.parentElement && typeof target.parentElement === "object") return target.parentElement;
  if (typeof target.closest === "function" || typeof target.getAttribute === "function") return target;
  return null;
}

function scheduleFollowupDeferredScan(callback, options = {}) {
  if (options.idle && typeof window.requestIdleCallback === "function") {
    return {
      kind: "idle",
      id: window.requestIdleCallback(callback, { timeout: SIGNATURE_GATED_SCAN_INTERVAL_MS }),
    };
  }
  if (options.idle) {
    return {
      kind: "idle",
      id: window.setTimeout(callback, FOLLOWUP_IDLE_SCAN_FALLBACK_MS),
    };
  }
  if (typeof requestAnimationFrame === "function") {
    return { kind: "animation", id: requestAnimationFrame(callback) };
  }
  return { kind: "timeout", id: window.setTimeout(callback, 0) };
}

function cancelFollowupScheduledScan(task) {
  if (!task) return;
  if (task.kind === "idle" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(task.id);
    return;
  }
  if (task.kind === "animation" && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(task.id);
    return;
  }
  if ((task.kind === "idle" || task.kind === "timeout") && typeof window.clearTimeout === "function") {
    window.clearTimeout(task.id);
  }
}

function currentDocumentPayloadSignature() {
  const signatures = [];
  for (const code of document.querySelectorAll("pre, code")) {
    if (!(code instanceof HTMLElement)) continue;
    const text = (code.textContent || "").trim();
    if (!PAYLOAD_TEXT_PATTERN.test(text)) continue;
    signatures.push(`${text.length}:${hashText(text)}`);
  }
  return signatures.join("|");
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function findRadarPayload(markdown, cache = null) {
  const signature = radarPayloadSignature(markdown);
  const cached = cache?.get?.(markdown);
  if (cached?.signature?.kind === signature.kind && cached.signature.text === signature.text) {
    for (const block of cached.hiddenBlocks || []) hideSourceElement(block);
    return cached.payload;
  }

  const candidates = [];
  const hiddenBlocks = [];

  for (const code of markdown.querySelectorAll("pre, code")) {
    if (!(code instanceof HTMLElement)) continue;
    const text = (code.textContent || "").trim();
    if (!text || !PAYLOAD_TEXT_PATTERN.test(text)) continue;
    const block = findCodeBlockShell(code, markdown, text);
    if (!isFinalManagedPayloadBlock(block, markdown, text)) continue;
    const parsed = parseRadarJson(text);
    if (parsed) {
      hiddenBlocks.push(hideSourceBlock(block));
      candidates.push(parsed);
      continue;
    }

    const partial = parsePartialFollowupPayload(text);
    if (partial) {
      hiddenBlocks.push(hideSourceBlock(block));
      candidates.push(partial);
    }
  }

  if (candidates.length > 0) {
    const payload = candidates[candidates.length - 1];
    cache?.set?.(markdown, { signature, payload, hiddenBlocks: hiddenBlocks.filter(Boolean) });
    return payload;
  }

  const text = signature.text;
  const directiveMatch = text.match(/::soren-radar\s*(\{[\s\S]*?\})\s*::/i);
  if (directiveMatch) {
    const parsed = parseRadarJson(directiveMatch[1]);
    if (parsed) {
      cache?.set?.(markdown, { signature, payload: parsed, hiddenBlocks: [] });
      return parsed;
    }
  }

  cache?.set?.(markdown, { signature, payload: null, hiddenBlocks: [] });
  return null;
}

function isFinalManagedPayloadBlock(block, markdown, rawText) {
  if (!(block instanceof HTMLElement) || !(markdown instanceof HTMLElement)) return false;
  if (!/"(?:codex_follow_up|soren_radar)"\s*:\s*true/i.test(rawText)) return false;
  return !hasMeaningfulContentAfter(block, markdown);
}

function hasMeaningfulContentAfter(block, root) {
  let foundBlock = false;
  let hasContent = false;

  const visit = (node) => {
    if (!node || hasContent) return;
    if (node === block) {
      foundBlock = true;
      return;
    }
    if (foundBlock && shouldIgnoreTrailingNode(node)) return;

    const children = nodeChildren(node);
    for (const child of children) visit(child);
    if (foundBlock && children.length === 0 && String(node.textContent || "").trim()) {
      hasContent = true;
    }
  };

  visit(root);
  return hasContent;
}

function nodeChildren(node) {
  return Array.from(node?.childNodes || node?.children || []);
}

function shouldIgnoreTrailingNode(node) {
  return node instanceof HTMLElement &&
    (node.hasAttribute(PANEL_ATTR) || node.hasAttribute(HIDDEN_ATTR) || node.hidden === true);
}

function radarPayloadSignature(markdown) {
  const codeTexts = [];
  for (const code of markdown.querySelectorAll("pre, code")) {
    if (code instanceof HTMLElement) codeTexts.push((code.textContent || "").trim());
  }
  if (codeTexts.length > 0) {
    return {
      kind: "code",
      text: `${codeTexts.join("\n---codex-follow-up-block---\n")}\n---codex-follow-up-markdown---\n${markdown.textContent || ""}`,
    };
  }
  return {
    kind: "text",
    text: markdown.textContent || "",
  };
}

function parseRadarJson(text) {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const attempts = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      const normalized = normalizePayload(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Keep trying relaxed slices.
    }
  }

  return null;
}

function parsePartialFollowupPayload(text) {
  if (!/"codex_follow_up"\s*:\s*true/.test(text)) return null;

  return {
    title: extractPartialTitle(text) || "Follow-up",
    items: extractPartialItems(text),
    pending: true,
  };
}

function extractPartialTitle(text) {
  const match = String(text).match(/"title"\s*:\s*"([^"]{1,80})"/);
  return match?.[1]?.trim() || "";
}

function extractPartialItems(text) {
  const items = [];
  const itemPattern = /\{[^{}]*"prompt"\s*:\s*"([^"]+)"[^{}]*\}/g;
  let match;

  while ((match = itemPattern.exec(text)) && items.length < 5) {
    const prompt = match[1]?.trim();
    if (!prompt) continue;
    const achieves = extractPartialAchieves(match[0]);
    items.push({ prompt, achieves });
  }

  if (items.length > 0) return items;

  const promptPattern = /"prompt"\s*:\s*"([^"]+)"/g;

  while ((match = promptPattern.exec(text)) && items.length < 5) {
    const prompt = match[1]?.trim();
    if (prompt) items.push({ prompt, achieves: "" });
  }

  if (items.length > 0) return items;

  // Backward compatibility with the old label+prompt format.
  const labelPattern = /"label"\s*:\s*"([^"]+)"/g;
  while ((match = labelPattern.exec(text)) && items.length < 5) {
    const prompt = match[1]?.trim();
    if (prompt) items.push({ prompt, achieves: "" });
  }

  return items;
}

function normalizePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.codex_follow_up === true && Array.isArray(parsed.items)) {
    return {
      title: parsed.title || "Follow-up",
      items: parsed.items,
    };
  }

  if (parsed.soren_radar === true && Array.isArray(parsed.follow_ups)) {
    return {
      title: parsed.title || "Follow-up",
      items: parsed.follow_ups,
    };
  }

  return null;
}

function extractPartialAchieves(text) {
  const source = String(text || "");
  const arrayMatch = source.match(/"achieves"\s*:\s*\[([\s\S]*?)\]/);
  if (arrayMatch) {
    const values = [];
    const valuePattern = /"([^"]+)"/g;
    let match;
    while ((match = valuePattern.exec(arrayMatch[1])) && values.length < 3) {
      const value = match[1]?.trim();
      if (value) values.push(value);
    }
    return values;
  }

  const stringMatch = source.match(/"achieves"\s*:\s*"([^"]+)"/);
  return normalizeAchieves(stringMatch?.[1] || "");
}

function normalizeFollowupItem(item) {
  if (item && typeof item === "object") {
    const prompt = String(item.prompt || item.query || item.label || item.text || item.title || "").trim();
    const achieves = normalizeAchieves(item.achieves || item.outcome || item.result || item.why || "");
    return { prompt, achieves };
  }

  const prompt = String(item || "").trim();
  return { prompt, achieves: [] };
}

function normalizeAchieves(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*]\s*/, ""));

  return values
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function cleanPanelTitle(value, fallback) {
  const title = String(value || fallback || "Follow-up").trim();
  if (!title || /radar|soren/i.test(title)) return fallback || "Follow-up";
  return title;
}

function hideSourceBlock(block) {
  if (!(block instanceof HTMLElement)) return null;
  hideSourceElement(block);
  return block;
}

function hideSourceElement(block) {
  if (!(block instanceof HTMLElement)) return;
  block.setAttribute(HIDDEN_ATTR, "true");
  block.hidden = true;
  block.style.setProperty("display", "none", "important");
}

function findCodeBlockShell(code, markdown, rawText) {
  const wanted = normalizeText(rawText);
  let current = code.closest("pre") || code;
  let best = current;

  while (current?.parentElement && current.parentElement !== markdown) {
    const parent = current.parentElement;
    const parentText = normalizeText(parent.textContent || "");
    const withoutLanguage = parentText.replace(/^json\s+/i, "");

    if (parentText === wanted || withoutLanguage === wanted || parentText.endsWith(wanted)) {
      best = parent;
      current = parent;
      continue;
    }

    break;
  }

  return best;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function renderRadarPanel({ title, items, showDivider, clickableItems, pending }) {
  const wrap = document.createElement("section");
  wrap.setAttribute(PANEL_ATTR, "true");
  wrap.className = "soren-radar-panel";

  if (showDivider) {
    const divider = document.createElement("div");
    divider.className = "soren-radar-divider";
    wrap.appendChild(divider);
  }

  const heading = document.createElement("div");
  heading.className = "soren-radar-title";
  heading.textContent = title || "Follow-up";
  wrap.appendChild(heading);

  const list = document.createElement("div");
  list.className = "soren-radar-list";
  const visibleItems = items.length > 0
    ? items
    : pending
      ? [{ prompt: "Preparing follow-up..." }]
      : [];
  const selected = new Set();

  const syncSelection = () => {
    const value = Array.from(selected)
      .sort((a, b) => a - b)
      .map((index) => {
        const prompt = visibleItems[index]?.prompt;
        return prompt ? `${index + 1}. ${prompt}` : "";
      })
      .filter(Boolean)
      .join("\n");

    list.querySelectorAll(".soren-radar-row").forEach((row, index) => {
      const isSelected = selected.has(index);
      row.classList.toggle("soren-radar-row-selected", isSelected);
      row.setAttribute("aria-checked", String(isSelected));
    });

    insertIntoComposer(value, { replace: true });
  };

  visibleItems.forEach((item, index) => {
    const canClick = clickableItems && !pending && item.prompt;
    const row = document.createElement(canClick ? "button" : "div");
    row.className = canClick
      ? "soren-radar-row soren-radar-row-clickable"
      : "soren-radar-row";
    if (canClick) {
      row.type = "button";
      row.title = "Select follow-up";
      row.setAttribute("role", "checkbox");
      row.setAttribute("aria-checked", "false");
      row.addEventListener("click", () => {
        if (selected.has(index)) selected.delete(index);
        else selected.add(index);
        syncSelection();
      });
    }

    const number = document.createElement("span");
    number.className = "soren-radar-number";
    number.textContent = `${index + 1}.`;

    const content = document.createElement("span");
    content.className = "soren-radar-content";

    const text = document.createElement("span");
    text.className = "soren-radar-text";
    text.textContent = item.prompt;
    if (pending && items.length === 0) {
      text.classList.add("soren-radar-text-pending");
    }
    content.appendChild(text);

    const achievesItems = normalizeAchieves(item.achieves);
    if (achievesItems.length > 0) {
      const achieves = document.createElement("ul");
      achieves.className = "soren-radar-achieves";
      achievesItems.forEach((value) => {
        const bullet = document.createElement("li");
        bullet.textContent = value;
        achieves.appendChild(bullet);
      });
      content.appendChild(achieves);
    }

    const marker = document.createElement("span");
    marker.className = "soren-radar-marker";
    marker.setAttribute("aria-hidden", "true");

    row.append(number, content, marker);
    list.appendChild(row);
  });
  wrap.appendChild(list);
  return wrap;
}

function insertIntoComposer(text, options = {}) {
  const value = String(text || "").trim();
  const replace = options.replace === true;
  if (!value && !replace) return;

  const target = findComposerSurface();
  const textarea = target instanceof HTMLTextAreaElement ? target : null;
  if (textarea instanceof HTMLTextAreaElement) {
    if (replace) {
      textarea.focus();
      textarea.value = value;
    } else {
      insertTextIntoTextarea(textarea, value);
    }
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return;
  }

  const editable = target instanceof HTMLElement ? target : null;
  if (editable instanceof HTMLElement) {
    editable.focus();
    if (replace || !insertTextIntoContenteditable(editable, value)) editable.innerText = value;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return;
  }

  if (value) navigator.clipboard?.writeText(value).catch(() => {});
}

function findComposerSurface() {
  const active = document.activeElement;
  if (isComposerSurface(active)) return active;
  const candidates = Array.from(document.querySelectorAll(
    'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
  )).filter(isComposerSurface);
  const scoped = candidates.find((node) => node.closest?.([
    "form",
    "[data-testid*='composer']",
    "[data-testid*='prompt']",
    "[aria-label*='composer']",
    "[aria-label*='message']",
    "[data-codex-composer]",
  ].join(", ")));
  return scoped || candidates[candidates.length - 1] || null;
}

function isComposerSurface(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
  return node.getAttribute("contenteditable") === "true" || node.getAttribute("contenteditable") === "plaintext-only";
}

function insertTextIntoTextarea(textarea, value) {
  textarea.focus();
  const currentValue = String(textarea.value || "");
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : currentValue.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  if (typeof textarea.setRangeText === "function") {
    textarea.setRangeText(value, start, end, "end");
  } else {
    textarea.value = `${currentValue.slice(0, start)}${value}${currentValue.slice(end)}`;
  }
}

function insertTextIntoContenteditable(editable, value) {
  editable.focus();
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  if (!editable.contains(container.nodeType === Node.ELEMENT_NODE ? container : container.parentNode)) return false;
  range.deleteContents();
  range.insertNode(document.createTextNode(value));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function clearPanels() {
  document.querySelectorAll(`[${PANEL_ATTR}]`).forEach((node) => node.remove());
  document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((node) => {
    node.hidden = false;
    node.removeAttribute(HIDDEN_ATTR);
    node.style.removeProperty("display");
  });
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .soren-radar-panel {
      margin-top: 14px;
      color: var(--color-token-text-primary, currentColor);
      font-size: 13px;
      line-height: 1.45;
    }

    .soren-radar-divider {
      height: 1px;
      margin: 0 0 12px;
      background: color-mix(in srgb, currentColor 9%, transparent);
    }

    .soren-radar-title {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 650;
      color: var(--color-token-text-primary, currentColor);
    }

    .soren-radar-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .soren-radar-row {
      width: 100%;
      border: 0;
      background: transparent;
      padding: 0;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      color: var(--color-token-text-primary, currentColor);
      font: inherit;
      text-align: left;
    }

    .soren-radar-row-clickable {
      cursor: pointer;
      border-radius: 6px;
      margin-left: -3px;
      padding: 5px 7px 5px 3px;
      transition: background-color 120ms ease, color 120ms ease;
    }

    .soren-radar-row-clickable:hover {
      color: var(--color-token-text-primary, currentColor);
      background: var(--color-token-bg-secondary, color-mix(in srgb, currentColor 7%, transparent));
    }

    .soren-radar-row-selected {
      background: var(--color-token-bg-secondary, color-mix(in srgb, currentColor 7%, transparent));
    }

    .soren-radar-number {
      color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 52%, transparent));
      min-width: 18px;
    }

    .soren-radar-content {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .soren-radar-text {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .soren-radar-achieves {
      min-width: 0;
      margin: 0;
      padding-left: 16px;
      list-style: disc outside;
      color: var(--color-token-text-secondary, color-mix(in srgb, currentColor 58%, transparent));
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .soren-radar-achieves li {
      display: list-item;
      list-style: disc outside;
      margin: 1px 0;
    }

    .soren-radar-achieves li::marker {
      color: color-mix(in srgb, currentColor 72%, transparent);
    }

    .soren-radar-text-pending {
      color: var(--color-token-text-secondary, currentColor);
      opacity: 0.85;
      font-style: italic;
    }

    .soren-radar-marker {
      width: 22px;
      height: 22px;
      border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--color-token-text-primary, currentColor);
      font-size: 14px;
      font-weight: 650;
    }

    .soren-radar-row-selected .soren-radar-marker {
      border-color: var(--color-token-charts-blue, #2f80dc);
      background:
        radial-gradient(circle at center, var(--color-token-charts-blue, #2f80dc) 0 42%, transparent 44%);
    }
  `;
  document.head.appendChild(style);
}

function renderSettings(root, state) {
  root.textContent = "";
  state.statusEl = null;
  state.migrationEl = null;
  state.previewPromptEl = null;
  state.targetsEl = null;
  state.targetStatusEl = null;

  root.appendChild(settingsSection("Behavior", [
    toggleRow({
      label: "Enable Follow-up",
      description: "Render structured follow-up payloads under assistant messages.",
      checked: state.enabled,
      onChange: (checked) => {
        state.enabled = checked;
        state.api.storage.set("enabled", checked);
        if (checked) state.scheduleScan?.();
        else clearPanels();
      },
    }),
    toggleRow({
      label: "Show divider",
      description: "Add a thin separator above the Follow-up panel.",
      checked: state.showDivider,
      onChange: (checked) => {
        state.showDivider = checked;
        state.api.storage.set("showDivider", checked);
        state.scheduleScan?.();
      },
    }),
    toggleRow({
      label: "Clickable items",
      description: "Click a follow-up item to insert its prompt into the composer.",
      checked: state.clickableItems,
      onChange: (checked) => {
        state.clickableItems = checked;
        state.api.storage.set("clickableItems", checked);
        state.scheduleScan?.();
      },
    }),
  ]));

  root.appendChild(settingsSection("Follow-up Instructions", [
    infoRow({
      label: "Prompt mode",
      description: "Suggestions are fixes or improvements only. Crucial checks happen before the final answer.",
    }),
    migrationStatusRow(state),
    toggleRow({
      label: "Sync AGENTS.md instruction",
      description: "Keep the managed Follow-up instruction current in every AGENTS.md file shown below.",
      checked: state.syncAgents,
      onChange: async (checked) => {
        state.syncAgents = checked;
        state.api.storage.set("syncAgents", checked);
        await syncAgentsInstruction(state);
      },
    }),
    textareaRow({
      label: "Editable prompt",
      description: "Describe the fixes and improvements that Follow-up should suggest. The JSON format is locked below.",
      value: state.followupPrompt,
      onInput: (value) => {
        state.followupPrompt = value;
        state.api.storage.set("followupPrompt", value);
        state.migrationStatus = "Custom prompt edited in settings.";
        updateMigrationStatus(state);
        updatePromptPreview(state);
        refreshAgentsTargets(state, { quiet: true });
      },
    }),
    promptPreviewRow(state),
    agentsTargetsRow(state),
    customPromptGuideRow(),
    lockedFormatRow(),
    actionRow({
      onApply: () => syncAgentsInstruction(state),
      onReload: () => reloadFollowupTweak(state),
      onReset: async () => {
        state.followupPrompt = DEFAULT_FOLLOWUP_PROMPT;
        state.migrationStatus = "Reset to the conditional fixes-only default prompt.";
        state.api.storage.set("followupPrompt", DEFAULT_FOLLOWUP_PROMPT);
        updateMigrationStatus(state);
        await refreshAgentsTargets(state, { quiet: true });
        await syncAgentsInstruction(state);
        rerenderSettingsPage(root, state);
      },
      statusRef: (el) => {
        state.statusEl = el;
      },
    }),
  ]));
}

function rerenderSettingsPage(root, state) {
  while (root.firstChild) root.firstChild.remove();
  renderSettings(root, state);
}

async function syncAgentsInstruction(state, options = {}) {
  if (!state.api.ipc?.invoke) {
    setStatus(state, "IPC unavailable");
    return null;
  }

  try {
    if (!options.quiet) setStatus(state, "Syncing...");
    const result = await state.api.ipc.invoke(IPC_SYNC_AGENTS, {
      enabled: state.syncAgents,
      prompt: state.followupPrompt,
      targets: state.agentsTargets,
    });

    if (result?.ok || result?.action === "partial") {
      const label = syncStatusLabel(result);
      setStatus(state, label);
      setTargetStatus(state, targetStatusLines(result.targets).join("\n"));
      await refreshAgentsTargets(state, { quiet: true });
    } else {
      setStatus(state, result?.error || "Sync failed");
      setTargetStatus(state, targetStatusLines(result?.targets).join("\n"));
    }

    return result;
  } catch (error) {
    setStatus(state, error?.message || String(error));
    return null;
  }
}

async function refreshAgentsTargets(state, options = {}) {
  if (!state.api.ipc?.invoke) return null;
  try {
    const result = await state.api.ipc.invoke(IPC_DEFAULTS, {
      enabled: state.syncAgents,
      prompt: state.followupPrompt,
      targets: state.agentsTargets,
    });
    if (Array.isArray(result?.targets)) {
      state.agentsTargets = applyTargetPreferences(result.targets, state);
      updateAgentsTargetsPreview(state);
    }
    return result;
  } catch (error) {
    if (!options.quiet) setTargetStatus(state, error?.message || String(error));
    return null;
  }
}

function syncStatusLabel(result) {
  if (!result) return "";
  if (result.action === "removed") return "Follow-up block removed";
  if (result.action === "unchanged") return "Shown AGENTS.md files already current";
  if (result.action === "partial") return "Some AGENTS.md files failed";
  return "Shown AGENTS.md files updated";
}

function targetStatusLines(targets) {
  return (Array.isArray(targets) ? targets : [])
    .map((target) => {
      const label = targetStatusLabel(target);
      if (target.action === "skipped") return `${label}: skipped`;
      if (!target.ok) return `${label}: failed${target.error ? ` (${target.error})` : ""}`;
      return `${label}: ${target.action || "unchanged"}`;
    });
}

function targetStatusLabel(target) {
  const order = Number(target.order || 0);
  const prefix = order > 0 ? `${order}. ` : "";
  return `${prefix}${target.label || target.path || "AGENTS.md"}`;
}

function normalizeStoredDisabledTargets(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean));
}

function normalizeStoredTargetLabels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([path, label]) => [String(path || "").trim(), String(label || "").trim()])
    .filter(([path, label]) => path && label));
}

function normalizeStoredTargetOrder(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function applyTargetPreferences(targets, state) {
  const orderIndex = new Map(state.agentTargetOrder.map((targetPath, index) => [targetPath, index]));
  return targets
    .map((target) => {
      const customLabel = state.agentTargetLabels[target.path];
      return {
        ...target,
        label: customLabel || target.label,
        enabled: target.enabled !== false && !state.disabledAgentTargetPaths.has(target.path),
      };
    })
    .sort((left, right) => {
      const leftIndex = orderIndex.has(left.path) ? orderIndex.get(left.path) : Number.POSITIVE_INFINITY;
      const rightIndex = orderIndex.has(right.path) ? orderIndex.get(right.path) : Number.POSITIVE_INFINITY;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return Number(left.order || 0) - Number(right.order || 0);
    })
    .map((target, index) => ({ ...target, order: index + 1 }));
}

function setTargetEnabled(state, targetPath, enabled) {
  if (enabled) state.disabledAgentTargetPaths.delete(targetPath);
  else state.disabledAgentTargetPaths.add(targetPath);
  state.api.storage.set(STORAGE_DISABLED_TARGETS, Array.from(state.disabledAgentTargetPaths));
  state.agentsTargets = state.agentsTargets.map((target) => (
    target.path === targetPath ? { ...target, enabled } : target
  ));
  updateAgentsTargetsPreview(state);
  refreshAgentsTargets(state, { quiet: true });
}

function setTargetLabel(state, targetPath, label) {
  const nextLabel = String(label || "").trim();
  if (nextLabel) state.agentTargetLabels[targetPath] = nextLabel;
  else delete state.agentTargetLabels[targetPath];
  state.api.storage.set(STORAGE_TARGET_LABELS, state.agentTargetLabels);
  state.agentsTargets = state.agentsTargets.map((target) => (
    target.path === targetPath ? { ...target, label: nextLabel || target.defaultLabel || target.label } : target
  ));
  updateAgentsTargetsPreview(state);
}

function moveTarget(state, fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return;
  const current = [...state.agentsTargets];
  const fromIndex = current.findIndex((target) => target.path === fromPath);
  const toIndex = current.findIndex((target) => target.path === toPath);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = current.splice(fromIndex, 1);
  current.splice(toIndex, 0, moved);
  state.agentsTargets = current.map((target, index) => ({ ...target, order: index + 1 }));
  state.agentTargetOrder = state.agentsTargets.map((target) => target.path);
  state.api.storage.set(STORAGE_TARGET_ORDER, state.agentTargetOrder);
  updateAgentsTargetsPreview(state);
}

function setStatus(state, text) {
  if (!state.statusEl) return;
  state.statusEl.textContent = text || "";
}

function setTargetStatus(state, text) {
  if (!state.targetStatusEl) return;
  state.targetStatusEl.textContent = text || "";
}

async function reloadFollowupTweak(state) {
  if (!state.api.ipc?.invoke) {
    setStatus(state, "Reload unavailable: this ShadGPT runtime does not expose IPC to Follow-up.");
    return null;
  }

  try {
    setStatus(state, "Reloading installed tweaks from disk...");
    const result = await state.api.ipc.invoke(IPC_RELOAD_TWEAKS);
    if (!result?.ok) {
      setStatus(state, `Reload failed: ${result?.error || "unknown error"}`);
      return result;
    }
    setStatus(state, "Installed tweaks reloaded. Refreshing this window so Follow-up uses the latest copy...");
    window.setTimeout(() => location.reload(), 650);
    return result;
  } catch (error) {
    setStatus(state, `Reload failed: ${error?.message || String(error)}`);
    return null;
  }
}

function settingsSection(title, rows) {
  const section = document.createElement("section");
  section.className = "mb-4 flex flex-col gap-2";
  const heading = document.createElement("div");
  heading.className = "px-1 text-sm font-medium text-token-text-primary";
  heading.textContent = title;
  section.appendChild(heading);
  const card = document.createElement("div");
  card.className =
    "divide-y divide-token-border-light rounded-xl border border-token-border-light bg-token-bg-primary";
  for (const row of rows) card.appendChild(row);
  section.appendChild(card);
  return section;
}

function toggleRow({ label, description, checked, onChange }) {
  const row = document.createElement("label");
  row.className = "flex cursor-pointer items-center justify-between gap-4 p-3";
  const left = document.createElement("div");
  left.className = "flex min-w-0 flex-col gap-1";
  const title = document.createElement("div");
  title.className = "text-sm text-token-text-primary";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "text-sm text-token-text-secondary";
  desc.textContent = description;
  left.appendChild(title);
  left.appendChild(desc);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.className = "h-4 w-4";
  input.addEventListener("change", () => onChange(input.checked));

  row.appendChild(left);
  row.appendChild(input);
  return row;
}

function infoRow({ label, description }) {
  const row = document.createElement("div");
  row.className = "flex flex-col gap-1 p-3";
  const title = document.createElement("div");
  title.className = "text-sm text-token-text-primary";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "text-sm text-token-text-secondary";
  desc.dataset.followupInfoDescription = "true";
  desc.textContent = description;
  row.append(title, desc);
  return row;
}

function migrationStatusRow(state) {
  const row = infoRow({
    label: "Prompt migration",
    description: state.migrationStatus || "Using the current conditional fixes-only prompt.",
  });
  state.migrationEl = row.querySelector("[data-followup-info-description]");
  return row;
}

function textareaRow({ label, description, value, onInput }) {
  const row = document.createElement("div");
  row.className = "flex flex-col gap-2 p-3";
  const title = document.createElement("div");
  title.className = "text-sm text-token-text-primary";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "text-sm text-token-text-secondary";
  desc.textContent = description;
  const textarea = document.createElement("textarea");
  textarea.className =
    "h-48 w-full resize-y rounded-lg border border-token-border-light bg-token-bg-secondary p-3 font-mono text-xs text-token-text-primary outline-none";
  textarea.spellcheck = false;
  textarea.value = value || "";
  textarea.addEventListener("input", () => onInput(textarea.value));
  row.appendChild(title);
  row.appendChild(desc);
  row.appendChild(textarea);
  return row;
}

function promptPreviewRow(state) {
  const row = document.createElement("details");
  row.className = "p-3";

  const summary = document.createElement("summary");
  summary.className = "cursor-pointer text-sm text-token-text-primary";
  summary.textContent = "Synced prompt preview";

  const desc = document.createElement("div");
  desc.className = "mt-2 text-sm text-token-text-secondary";
  desc.textContent = "Preview the exact instruction that will be written to the shown AGENTS.md targets, including the locked format.";

  const summaryList = document.createElement("ul");
  summaryList.className = "mt-3 list-disc space-y-1 pl-5 text-sm text-token-text-secondary";
  for (const item of [
    "Exactly 5 follow-up items when eligible.",
    "No Follow-up payload for Matt Pocock or Ponytail skill turns.",
    "Future fixes and improvements only.",
    "Required checks happen before Follow-up options.",
    "Each item includes prompt and achieves.",
  ]) {
    const li = document.createElement("li");
    li.textContent = item;
    summaryList.appendChild(li);
  }

  const promptBlock = previewBlock(
    "Editable prompt",
    "This is the customizable strategy text saved by the setting above.",
    state.followupPrompt,
    "border-l-4 border-token-text-link-foreground",
  );
  state.previewPromptEl = promptBlock.querySelector("pre");

  const lockedBlock = previewBlock(
    "Locked format",
    "This renderer contract is appended after the editable prompt.",
    LOCKED_FORMAT_INSTRUCTION,
    "border-l-4 border-token-border-light",
  );
  updatePromptPreview(state);

  row.append(summary, desc, summaryList, promptBlock, lockedBlock);
  return row;
}

function agentsTargetsRow(state) {
  const row = document.createElement("details");
  row.className = "p-3";
  row.open = true;

  const summary = document.createElement("summary");
  summary.className = "cursor-pointer text-sm text-token-text-primary";
  summary.textContent = "AGENTS.md targets";

  const desc = document.createElement("div");
  desc.className = "mt-2 text-sm text-token-text-secondary";
  desc.textContent = "Apply revises every enabled AGENTS.md file shown here. Existing Follow-up managed blocks are replaced in place.";

  const targets = document.createElement("div");
  targets.className = "mt-3 flex flex-col gap-3";
  state.targetsEl = targets;

  const status = document.createElement("pre");
  status.className = "mt-3 whitespace-pre-wrap text-xs text-token-text-secondary";
  state.targetStatusEl = status;

  row.append(summary, desc, targets, status);
  updateAgentsTargetsPreview(state);
  return row;
}

function updateAgentsTargetsPreview(state) {
  if (!state.targetsEl) return;
  state.targetsEl.textContent = "";
  const targets = state.agentsTargets.length > 0
    ? state.agentsTargets
    : [{
      label: "Global Codex AGENTS.md",
      defaultLabel: "Global Codex AGENTS.md",
      path: "Resolving target path...",
      source: "global",
      sourceLabel: "Global target",
      order: 1,
      exists: false,
      hasManagedBlock: false,
      enabled: true,
      legacyBlockCount: 0,
      previewText: composeAgentsInstruction(state.followupPrompt),
      beforeText: "",
      afterText: composeAgentsInstruction(state.followupPrompt),
    }];

  state.targetsEl.appendChild(targetSummaryRow(targets));

  for (const target of targets) {
    const wrap = document.createElement("div");
    wrap.className = "rounded-lg border border-token-border-light bg-token-bg-secondary p-3";
    wrap.draggable = Boolean(target.path && target.path !== "Resolving target path...");
    wrap.dataset.targetPath = target.path || "";
    wrap.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData?.("text/plain", target.path || "");
      wrap.classList.add("opacity-70");
    });
    wrap.addEventListener("dragend", () => {
      wrap.classList.remove("opacity-70");
    });
    wrap.addEventListener("dragover", (event) => {
      if (!wrap.draggable) return;
      event.preventDefault?.();
    });
    wrap.addEventListener("drop", (event) => {
      event.preventDefault?.();
      const fromPath = event.dataTransfer?.getData?.("text/plain") || "";
      moveTarget(state, fromPath, target.path);
    });

    const header = document.createElement("div");
    header.className = "flex items-start justify-between gap-3";
    const titleWrap = document.createElement("div");
    titleWrap.className = "min-w-0";

    const label = document.createElement("div");
    label.className = "text-sm font-medium text-token-text-primary";
    label.textContent = targetStatusLabel(target);

    const kind = document.createElement("div");
    kind.className = "mt-1 text-xs font-medium uppercase tracking-wide text-token-text-secondary";
    kind.textContent = target.sourceLabel || targetSourceLabel(target.source);

    const path = document.createElement("div");
    path.className = "mt-1 break-all font-mono text-xs text-token-text-secondary";
    path.textContent = target.path || "";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = target.label || "";
    labelInput.placeholder = target.defaultLabel || target.label || "AGENTS.md";
    labelInput.className = "mt-2 w-full rounded-md border border-token-border-light bg-token-bg-primary px-2 py-1 text-xs text-token-text-primary outline-none";
    labelInput.addEventListener("change", () => setTargetLabel(state, target.path, labelInput.value));
    labelInput.addEventListener("blur", () => setTargetLabel(state, target.path, labelInput.value));
    titleWrap.append(label, kind, path, labelInput);

    const toggle = document.createElement("label");
    toggle.className = "flex shrink-0 items-center gap-2 text-xs text-token-text-secondary";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = target.enabled !== false;
    checkbox.disabled = !target.path || target.path === "Resolving target path...";
    checkbox.addEventListener("change", () => setTargetEnabled(state, target.path, checkbox.checked));
    const toggleText = document.createElement("span");
    toggleText.textContent = "Sync";
    toggle.append(checkbox, toggleText);
    header.append(titleWrap, toggle);

    const meta = document.createElement("div");
    meta.className = "mt-2 text-xs text-token-text-secondary";
    const exists = target.exists ? "exists" : "will be created";
    const managed = target.hasManagedBlock ? "managed Follow-up block found" : "no Follow-up block yet";
    const enabled = target.enabled === false ? "disabled" : "enabled";
    meta.textContent = `${exists}; ${managed}; ${enabled}`;

    const warnings = targetWarnings(target);

    const before = previewTextBlock("Before", target.beforeText || "");
    const after = previewTextBlock("After Apply", target.afterText || target.previewText || composeAgentsInstruction(state.followupPrompt));

    wrap.append(header, meta, warnings, before, after);
    state.targetsEl.appendChild(wrap);
  }
}

function targetSummaryRow(targets) {
  const total = targets.length;
  const enabled = targets.filter((target) => target.enabled !== false).length;
  const disabled = total - enabled;
  const missing = targets.filter((target) => !target.exists).length;
  const duplicateBlocks = targets.reduce((sum, target) => sum + Math.max(0, Number(target.legacyBlockCount || 0) - 1), 0);
  const row = document.createElement("div");
  row.className = "rounded-md border border-token-border-light bg-token-bg-primary p-2 text-xs text-token-text-secondary";
  row.textContent = [
    `${total} target${total === 1 ? "" : "s"}`,
    `${enabled} enabled`,
    `${disabled} disabled`,
    `${missing} missing`,
    duplicateBlocks > 0 ? `${duplicateBlocks} duplicate block${duplicateBlocks === 1 ? "" : "s"}` : "no duplicate blocks",
  ].join(" · ");
  return row;
}

function targetWarnings(target) {
  const wrap = document.createElement("div");
  const count = Number(target.legacyBlockCount || 0);
  if (count <= 1) return wrap;
  wrap.className = "mt-2 rounded-md border border-token-border-light bg-token-bg-primary p-2 text-xs text-token-text-secondary";
  wrap.textContent = `${count} Follow-up managed blocks found. Apply will collapse them into one current ShadGPT block.`;
  return wrap;
}

function previewTextBlock(label, text) {
  const wrap = document.createElement("details");
  wrap.className = "mt-3";
  const summary = document.createElement("summary");
  summary.className = "cursor-pointer text-xs font-medium text-token-text-primary";
  summary.textContent = label;
  const pre = document.createElement("pre");
  pre.className = "mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-token-border-light bg-token-bg-primary p-3 text-xs text-token-text-secondary";
  pre.textContent = text || "(empty)";
  wrap.append(summary, pre);
  return wrap;
}

function previewBlock(label, description, text, accentClass) {
  const wrap = document.createElement("div");
  wrap.className = `mt-3 rounded-lg border border-token-border-light bg-token-bg-secondary p-3 ${accentClass}`;

  const heading = document.createElement("div");
  heading.className = "text-xs font-semibold uppercase tracking-wide text-token-text-primary";
  heading.textContent = label;

  const desc = document.createElement("div");
  desc.className = "mt-1 text-xs text-token-text-secondary";
  desc.textContent = description;

  const pre = document.createElement("pre");
  pre.className = "mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-token-text-secondary";
  pre.textContent = text || "";

  wrap.append(heading, desc, pre);
  return wrap;
}

function customPromptGuideRow() {
  const row = document.createElement("details");
  row.className = "p-3";

  const summary = document.createElement("summary");
  summary.className = "cursor-pointer text-sm text-token-text-primary";
  summary.textContent = "Custom prompt guide";

  const body = document.createElement("div");
  body.className = "mt-2 space-y-2 text-sm text-token-text-secondary";
  const intro = document.createElement("p");
  intro.textContent = "Edit the strategy text above to tune what improvements are suggested. Keep the locked JSON format unchanged.";
  const list = document.createElement("ul");
  list.className = "list-disc space-y-1 pl-5";
  for (const item of [
    "Keep suggestions tied to the current chat topic.",
    "Phrase each prompt as an improvement the user can ask Codex to make.",
    "Leave required checks in the visible answer before Follow-up options.",
    "Use the reset action if you want to return to the built-in conditional fixes-only default.",
  ]) {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  body.append(intro, list);
  row.append(summary, body);
  return row;
}

function updatePromptPreview(state) {
  if (!state.previewPromptEl) return;
  state.previewPromptEl.textContent = state.followupPrompt || "";
}

function updateMigrationStatus(state) {
  if (!state.migrationEl) return;
  state.migrationEl.textContent = state.migrationStatus || "Using the current conditional fixes-only prompt.";
}

function lockedFormatRow() {
  const row = document.createElement("details");
  row.className = "p-3";

  const summary = document.createElement("summary");
  summary.className = "cursor-pointer text-sm text-token-text-primary";
  summary.textContent = "Locked format";

  const desc = document.createElement("div");
  desc.className = "mt-2 text-sm text-token-text-secondary";
  desc.textContent = "This section is synced after the editable prompt and should not be modified in AGENTS.md.";

  const pre = document.createElement("pre");
  pre.className =
    "mt-3 max-h-64 overflow-auto rounded-lg border border-token-border-light bg-token-bg-secondary p-3 text-xs text-token-text-secondary";
  pre.textContent = LOCKED_FORMAT_INSTRUCTION;

  row.appendChild(summary);
  row.appendChild(desc);
  row.appendChild(pre);
  return row;
}

function actionRow({ onApply, onReload, onReset, statusRef }) {
  const row = document.createElement("div");
  row.className = "flex flex-wrap items-center justify-between gap-3 p-3";

  const status = document.createElement("div");
  status.className = "min-h-5 text-sm text-token-text-secondary";
  statusRef(status);

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-2";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className =
    "rounded-lg border border-token-border-light px-3 py-2 text-sm text-token-text-secondary hover:bg-token-bg-secondary";
  reset.textContent = "Reset default";
  reset.addEventListener("click", onReset);

  const reload = document.createElement("button");
  reload.type = "button";
  reload.className =
    "rounded-lg border border-token-border-light px-3 py-2 text-sm text-token-text-secondary hover:bg-token-bg-secondary";
  reload.textContent = "Reload Follow-up";
  reload.addEventListener("click", onReload);

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className =
    "rounded-lg border border-token-border-light bg-token-bg-secondary px-3 py-2 text-sm text-token-text-primary hover:bg-token-bg-tertiary";
  apply.textContent = "Apply to shown AGENTS.md files";
  apply.addEventListener("click", onApply);

  actions.appendChild(reload);
  actions.appendChild(reset);
  actions.appendChild(apply);
  row.appendChild(status);
  row.appendChild(actions);
  return row;
}

function createAgentsSyncService(api) {
  return {
    getAgentsPath,
    previewAgentsTargets(settings = {}) {
      return previewAgentsTargets(settings, serviceTargetOptions(api));
    },
    syncAgentsInstruction(settings = {}) {
      const enabled = settings.enabled !== false;
      const instruction = composeAgentsInstruction(settings.prompt);
      const targets = resolveAgentsTargets(settings.targets, serviceTargetOptions(api));

      if (targets.length === 0) {
        return {
          ok: false,
          action: "failed",
          error: "No AGENTS.md targets were available.",
          targets: [],
        };
      }

      const results = targets.map((target) => syncAgentsTarget(target, {
        enabled,
        instruction,
        api,
      }));
      const primary = results[0] || {};
      const failures = results.filter((target) => !target.ok);
      const changed = results.filter((target) => target.ok && target.action !== "unchanged");
      const action = failures.length > 0
        ? changed.length === 0
          ? "failed"
          : "partial"
        : changed.length === 0
          ? "unchanged"
          : enabled
            ? "updated"
            : "removed";

      return {
        ok: failures.length === 0,
        action,
        error: failures.length > 0 ? "One or more AGENTS.md targets failed." : undefined,
        path: primary.path,
        targets: results,
      };
    },
  };
}

function serviceTargetOptions(api = {}) {
  return {
    globalAgentsPath: getAgentsPath(),
    allowedTargetRoots: allowedAgentsTargetRoots(api),
  };
}

function allowedAgentsTargetRoots(api = {}) {
  if (Array.isArray(api.agentsTargetRoots)) return api.agentsTargetRoots;
  return [discoverProjectRoot()].filter(Boolean);
}

function syncAgentsTarget(target, { enabled, instruction, api }) {
  const agentsPath = target.path;

  if (enabled && target.enabled === false) {
    return targetResult(target, { ok: true, action: "skipped" });
  }

  if (target.blocked) {
    return targetResult(target, {
      ok: false,
      action: "blocked",
      error: target.error || "AGENTS.md target is outside the allowed sync roots.",
    });
  }

  try {
    const fs = require("fs");
    const path = require("path");
    if (fs.existsSync(agentsPath) && fs.lstatSync(agentsPath).isSymbolicLink()) {
      throw new Error("AGENTS.md target cannot be a symlink.");
    }
    const current = fs.existsSync(agentsPath)
      ? fs.readFileSync(agentsPath, "utf8")
      : "";
    const next = enabled
      ? upsertManagedBlock(current, instruction)
      : removeManagedBlock(current);

    if (next === current) {
      return targetResult(target, { ok: true, action: "unchanged" });
    }

    if (!enabled && !next.trim()) {
      if (fs.existsSync(agentsPath)) fs.unlinkSync(agentsPath);
    } else {
      fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
      fs.writeFileSync(agentsPath, next, "utf8");
    }

    return targetResult(target, {
      ok: true,
      action: enabled ? "updated" : "removed",
    });
  } catch (error) {
    api.log.error("Codex Follow-up AGENTS.md sync failed", error);
    return targetResult(target, {
      ok: false,
      action: "failed",
      error: error?.message || String(error),
    });
  }
}

function targetResult(target, result) {
  return {
    ok: result.ok,
    action: result.action,
    error: result.error,
    path: target.path,
    label: target.label || "AGENTS.md",
    defaultLabel: target.defaultLabel || target.label || "AGENTS.md",
    source: target.source || "custom",
    sourceLabel: target.sourceLabel || targetSourceLabel(target.source),
    order: target.order || 0,
  };
}

function previewAgentsTargets(settings = {}, options = {}) {
  const instruction = composeAgentsInstruction(settings.prompt);
  return resolveAgentsTargets(settings.targets, options).map((target) => previewAgentsTarget(target, instruction));
}

function previewAgentsTarget(target, instruction) {
  const fs = require("fs");
  const agentsPath = target.path;
  if (target.blocked) {
    return {
      path: agentsPath,
      label: target.label || "AGENTS.md",
      defaultLabel: target.defaultLabel || target.label || "AGENTS.md",
      source: target.source || "custom",
      sourceLabel: target.sourceLabel || targetSourceLabel(target.source),
      order: target.order || 0,
      enabled: target.enabled !== false,
      exists: false,
      hasManagedBlock: false,
      legacyBlockCount: 0,
      beforeText: "",
      afterText: "",
      previewText: [BLOCK_BEGIN, instruction.trim(), BLOCK_END].join("\n"),
      error: target.error || "AGENTS.md target is outside the allowed sync roots.",
    };
  }
  const exists = fs.existsSync(agentsPath);
  if (exists && fs.lstatSync(agentsPath).isSymbolicLink()) {
    return {
      path: agentsPath,
      label: target.label || "AGENTS.md",
      defaultLabel: target.defaultLabel || target.label || "AGENTS.md",
      source: target.source || "custom",
      sourceLabel: target.sourceLabel || targetSourceLabel(target.source),
      order: target.order || 0,
      enabled: target.enabled !== false,
      exists: true,
      hasManagedBlock: false,
      legacyBlockCount: 0,
      beforeText: "",
      afterText: "",
      previewText: [BLOCK_BEGIN, instruction.trim(), BLOCK_END].join("\n"),
      error: "AGENTS.md target cannot be a symlink.",
    };
  }
  const current = exists ? fs.readFileSync(agentsPath, "utf8") : "";
  const after = target.enabled === false
    ? current
    : upsertManagedBlock(current, instruction);
  const blocks = managedBlockMatches(current);
  return {
    path: agentsPath,
    label: target.label || "AGENTS.md",
    defaultLabel: target.defaultLabel || target.label || "AGENTS.md",
    source: target.source || "custom",
    sourceLabel: target.sourceLabel || targetSourceLabel(target.source),
    order: target.order || 0,
    enabled: target.enabled !== false,
    exists,
    hasManagedBlock: blocks.length > 0,
    legacyBlockCount: blocks.length,
    beforeText: current,
    afterText: after,
    previewText: [BLOCK_BEGIN, instruction.trim(), BLOCK_END].join("\n"),
  };
}

function resolveAgentsTargets(targets, options = {}) {
  const path = require("path");
  const normalized = [];
  const seen = new Set();

  const add = (target) => {
    const rawPath = typeof target === "string" ? target : target?.path;
    const resolved = rawPath ? path.resolve(rawPath) : "";
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    const source = typeof target === "object" && target?.source ? String(target.source) : "custom";
    const validation = validateAgentsTargetPath(resolved, options);
    const defaultLabel = typeof target === "object" && target?.defaultLabel
      ? String(target.defaultLabel)
      : resolved === getAgentsPath()
        ? "Global Codex AGENTS.md"
        : source === "project"
          ? `${path.basename(path.dirname(resolved)) || "Project"} AGENTS.md`
          : "AGENTS.md";
    normalized.push({
      path: resolved,
      source,
      sourceLabel: typeof target === "object" && target?.sourceLabel
        ? String(target.sourceLabel)
        : targetSourceLabel(source),
      enabled: typeof target === "object" ? target.enabled !== false : true,
      defaultLabel,
      label: typeof target === "object" && target?.label
        ? String(target.label)
        : defaultLabel,
      blocked: !validation.ok,
      error: validation.error,
    });
  };

  const hasExplicitTargets = Array.isArray(targets) && targets.length > 0;
  if (hasExplicitTargets) {
    for (const target of targets) add(target);
  } else {
    for (const target of discoverDefaultAgentsTargets()) {
      add(target);
    }
  }

  const ordered = hasExplicitTargets ? normalized : normalized.sort(compareAgentsTargets);
  return ordered.map((target, index) => ({ ...target, order: index + 1 }));
}

function validateAgentsTargetPath(agentsPath, options = {}) {
  const path = require("path");
  if (path.basename(agentsPath) !== "AGENTS.md") {
    return { ok: false, error: "Follow-up can only sync AGENTS.md files." };
  }
  const globalAgentsPath = options.globalAgentsPath ? path.resolve(options.globalAgentsPath) : "";
  if (globalAgentsPath && path.resolve(agentsPath) === globalAgentsPath) return { ok: true };
  if (!Array.isArray(options.allowedTargetRoots)) return { ok: true };
  const allowedRoots = normalizeAgentsTargetRoots(options.allowedTargetRoots);
  for (const root of allowedRoots) {
    if (pathContains(root, agentsPath, path)) return { ok: true };
  }
  return { ok: false, error: "AGENTS.md target must be the global Codex target or live under the current project root." };
}

function normalizeAgentsTargetRoots(values) {
  const path = require("path");
  const roots = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value.trim()) continue;
    roots.push(path.resolve(value));
  }
  return [...new Set(roots)].sort();
}

function pathContains(root, candidate, path) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function compareAgentsTargets(left, right) {
  const rank = (target) => {
    if (target.source === "global") return 0;
    if (target.source === "project") return 1;
    return 2;
  };
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  return String(left.label || left.path).localeCompare(String(right.label || right.path));
}

function targetSourceLabel(source) {
  if (source === "global") return "Global target";
  if (source === "project") return "Project target";
  return "Custom target";
}

function discoverDefaultAgentsTargets() {
  const path = require("path");
  const fs = require("fs");
  const targets = [
    {
      path: getAgentsPath(),
      label: "Global Codex AGENTS.md",
      defaultLabel: "Global Codex AGENTS.md",
      source: "global",
      enabled: true,
    },
  ];
  const projectRoot = discoverProjectRoot();
  if (projectRoot) {
    const projectAgents = path.join(projectRoot, "AGENTS.md");
    if (path.resolve(projectAgents) !== path.resolve(getAgentsPath())) {
      targets.push({
        path: projectAgents,
        label: `${path.basename(projectRoot) || "Project"} AGENTS.md`,
        defaultLabel: `${path.basename(projectRoot) || "Project"} AGENTS.md`,
        source: "project",
        enabled: true,
        exists: fs.existsSync(projectAgents),
      });
    }
  }
  return targets;
}

function discoverProjectRoot() {
  const envCandidates = [
    process.env.CODEX_PROJECT_ROOT,
    process.env.CODEX_WORKSPACE_ROOT,
    process.env.CODEX_WORKSPACE,
    process.env.PROJECT_ROOT,
    process.env.PWD,
  ];
  const candidates = [process.cwd(), ...envCandidates].filter(Boolean);
  for (const candidate of candidates) {
    const root = findProjectRoot(candidate);
    if (root) return root;
  }
  return "";
}

function findProjectRoot(candidate) {
  const fs = require("fs");
  const path = require("path");
  let current = path.resolve(String(candidate || ""));
  try {
    if (fs.existsSync(current) && fs.statSync(current).isFile()) current = path.dirname(current);
  } catch {
    return "";
  }
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, "package.json")) ||
      fs.existsSync(path.join(current, "manifest.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function hasManagedBlock(source) {
  return managedBlockPatterns().some((pattern) => pattern.test(source));
}

function getAgentsPath() {
  const path = require("path");
  const os = require("os");
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "AGENTS.md");
}

function normalizeInstruction(value) {
  const text = String(value || "").trim();
  return text || DEFAULT_FOLLOWUP_PROMPT;
}

function composeAgentsInstruction(prompt) {
  return [normalizeInstruction(prompt), LOCKED_FORMAT_INSTRUCTION].join("\n\n");
}

function migrateOldInstruction(value) {
  const text = String(value || "").trim();
  if (!text) return DEFAULT_FOLLOWUP_PROMPT;
  if (text.includes("soren_radar") || /radar\s+follow-ups/i.test(text)) {
    return DEFAULT_FOLLOWUP_PROMPT;
  }
  return text;
}

function resolveFollowupPrompt(api) {
  const stored = api.storage.get("followupPrompt", null);
  const fallback = migrateOldInstruction(api.storage.get("agentsInstruction", ""));
  const prompt = migrateFollowupPrompt(stored ?? fallback);
  const status = migrationStatusForPrompt(stored, fallback, prompt);

  if (stored !== null && prompt !== stored) {
    api.storage.set("followupPrompt", prompt);
  }

  return { prompt, status };
}

function migrateFollowupPrompt(value) {
  const text = String(value || "").trim();
  if (!text || isOldDefaultFollowupPrompt(text)) return DEFAULT_FOLLOWUP_PROMPT;
  return text;
}

function migrationStatusForPrompt(stored, fallback, prompt) {
  const storedText = String(stored ?? "").trim();
  const fallbackText = String(fallback ?? "").trim();
  if (stored !== null && !storedText) return "Empty stored prompt reset to the conditional fixes-only default.";
  if (stored !== null && isOldDefaultFollowupPrompt(storedText)) {
    return "Old default prompt upgraded to the conditional fixes-only default.";
  }
  if (stored !== null && storedText === prompt) return "Custom prompt preserved.";
  if (stored === null && fallbackText && fallbackText === prompt && prompt !== DEFAULT_FOLLOWUP_PROMPT) {
    return "Legacy custom prompt imported.";
  }
  return "Using the built-in conditional fixes-only prompt.";
}

function isOldDefaultFollowupPrompt(value) {
  return OLD_DEFAULT_FOLLOWUP_PROMPT_FINGERPRINTS.has(promptFingerprint(value));
}

function normalizePromptForComparison(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function promptFingerprint(value) {
  const normalized = normalizePromptForComparison(value);
  let hash = 5381;
  for (const char of normalized) {
    hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
    hash >>>= 0;
  }
  return `${normalized.length}:${hash.toString(36)}`;
}

function migrateTitle(value) {
  const title = String(value || "").trim();
  if (!title || /radar|seguimiento|soren/i.test(title)) return "Follow-up";
  return title;
}

function upsertManagedBlock(source, instruction) {
  const block = [BLOCK_BEGIN, instruction.trim(), BLOCK_END].join("\n");
  const placeholder = `__SHADGPT_FOLLOWUP_BLOCK_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  const first = firstManagedBlockMatch(source);
  const marked = first
    ? `${source.slice(0, first.index)}${placeholder}${source.slice(first.index + first.text.length)}`
    : source;
  const cleaned = stripManagedBlocks(marked);

  if (cleaned.includes(placeholder)) {
    return cleaned.replace(placeholder, block).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  const trimmed = cleaned.replace(/\s+$/u, "");
  return `${trimmed}${trimmed ? "\n\n" : ""}${block}\n`;
}

function removeManagedBlock(source) {
  return stripManagedBlocks(source).trimEnd() + "\n";
}

function stripManagedBlocks(source) {
  let next = String(source || "");
  for (const [begin, end] of managedBlockDefinitions()) {
    let previous;
    do {
      previous = next;
      next = next.replace(managedBlockPattern(begin, end, true), "\n");
    } while (next !== previous);
  }
  return next.replace(/\n{3,}/g, "\n\n");
}

function firstManagedBlockMatch(source) {
  const matches = [];
  for (const pattern of managedBlockPatterns()) {
    const match = pattern.exec(source);
    if (match) matches.push({ index: match.index, text: match[0] });
  }
  matches.sort((a, b) => a.index - b.index);
  return matches[0] || null;
}

function managedBlockMatches(source) {
  const matches = [];
  for (const [begin, end] of managedBlockDefinitions()) {
    const pattern = managedBlockPattern(begin, end, true);
    let remaining = String(source || "");
    let offset = 0;
    let match;
    while ((match = pattern.exec(remaining))) {
      matches.push({ index: offset + match.index, text: match[0] });
      const nextIndex = match.index + Math.max(match[0].length, 1);
      offset += nextIndex;
      remaining = remaining.slice(nextIndex);
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return matches;
}

function managedBlockPatterns() {
  return managedBlockDefinitions().map(([begin, end]) => managedBlockPattern(begin, end));
}

function managedBlockDefinitions() {
  return [
    [BLOCK_BEGIN, BLOCK_END],
    [PREVIOUS_BLOCK_BEGIN, PREVIOUS_BLOCK_END],
    [UPSTREAM_BLOCK_BEGIN, UPSTREAM_BLOCK_END],
    [LEGACY_BLOCK_BEGIN, LEGACY_BLOCK_END],
    [OLDEST_BLOCK_BEGIN, OLDEST_BLOCK_END],
  ];
}

function managedBlockPattern(begin, end, includeOuterWhitespace = false) {
  const prefix = includeOuterWhitespace ? "\\n*" : "";
  const suffix = includeOuterWhitespace ? "\\n*" : "";
  return new RegExp(`${prefix}${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}${suffix}`, "m");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
