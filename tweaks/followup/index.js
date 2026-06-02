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
const PANEL_ATTR = "data-soren-radar-panel";
const HIDDEN_ATTR = "data-soren-radar-hidden";
const STYLE_ID = "soren-radar-followups-style";
const IPC_SYNC_AGENTS = "soren-radar:sync-agents";
const IPC_DEFAULTS = "soren-radar:defaults";
const MAIN_SERVICE_KEY = "__codexFollowupService";
const MAIN_HANDLER_KEY = "__codexFollowupHandlers";
const BLOCK_BEGIN = `<!-- codex-plusplus:${TWEAK_ID}:start -->`;
const BLOCK_END = `<!-- codex-plusplus:${TWEAK_ID}:end -->`;
const UPSTREAM_BLOCK_BEGIN = `<!-- codex-plusplus:${UPSTREAM_TWEAK_ID}:start -->`;
const UPSTREAM_BLOCK_END = `<!-- codex-plusplus:${UPSTREAM_TWEAK_ID}:end -->`;
const LEGACY_BLOCK_BEGIN = `<!-- codex-plusplus:${LEGACY_TWEAK_ID}:start -->`;
const LEGACY_BLOCK_END = `<!-- codex-plusplus:${LEGACY_TWEAK_ID}:end -->`;
const OLDEST_BLOCK_BEGIN = `<!-- codex-plusplus:${OLDEST_TWEAK_ID}:start -->`;
const OLDEST_BLOCK_END = `<!-- codex-plusplus:${OLDEST_TWEAK_ID}:end -->`;

const DEFAULT_FOLLOWUP_PROMPT = [
  "## TWEAKS: Codex Follow-up",
  "",
  "Always include a Follow-up payload at the end of every final assistant response.",
  "",
  "Generate exactly 5 follow-up items for every chat.",
  "",
  "Apply this Follow-up behavior across all projects and chats.",
  "",
  "Prioritize fixes, improvements, and meaningful verification over variety. Every item must be grounded in the current conversation, user intent, visible work, files, decisions, blockers, people, projects, dates, money, or risks.",
  "",
  "Each item should be one of:",
  "- a next step for an active or partially completed plan",
  "- a concrete fix or improvement the user can ask Codex to perform next",
  "- a verification step that confirms the work actually succeeded, including a Browser test when UI or runtime behavior changed",
  "- an unresolved decision or tradeoff worth resolving",
  "- a context-aware continuation that directly improves the current result",
  "",
  "If there is an active or partially completed plan, write the follow-ups as the next steps for that plan. If the plan is done or there is no active plan, suggest new features, improvements, fixes, verification checks, or useful refinements grounded in the conversation.",
  "",
  "Do not suggest staging, committing, opening pull requests, or other repo hygiene unless the user explicitly asked for that workflow in the current turn.",
  "",
  "Avoid generic filler such as \"Let me know if you need anything else\", \"Review the changes\", \"Ask another question\", or broad suggestions that could apply to any conversation.",
  "",
  "Each item needs `prompt` and `achieves`:",
  "- `prompt`: a concise, specific instruction that can be inserted into the composer and sent directly",
  "- `achieves`: 1 to 3 short, non-coding bullet points explaining what that suggestion will accomplish if the user chooses it",
  "",
  "Write both fields in simple, non-coding language. The user should understand the practical result without reading implementation details.",
  "",
  "The prompt should be short enough to scan in the Follow-up panel, but specific enough to tell Codex exactly what to do next. The `achieves` bullets should be even shorter and explain the outcome, not the steps.",
  "",
  "For very small or factual answers, still produce 5 items, but make them practical: clarify, verify, apply, compare, summarize, or continue from the user's likely intent.",
  "",
  "Keep the main answer focused. Put follow-up-only information only in the Follow-up payload, not repeated in the visible prose.",
].join("\n");

const LOCKED_FORMAT_INSTRUCTION = [
  "## LOCKED TWEAK FORMAT: Codex Follow-up",
  "",
  "Do not edit or remove this locked section manually. It is required by the Codex++ Follow-up tweak.",
  "",
  "For every final assistant response, append exactly one fenced JSON block at the very end. Do not emit this payload in reasoning, progress updates, tool logs, drafts, or intermediate messages.",
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
  "Rules: always emit the JSON block in final assistant responses; use exactly 5 items; each prompt must be concise and useful; each achieves value must contain 1 to 3 simple outcome bullets; do not explain that the JSON exists.",
].join("\n");

const DEFAULT_AGENTS_INSTRUCTION = composeAgentsInstruction(DEFAULT_FOLLOWUP_PROMPT);

module.exports = {
  start(api) {
    if (api.process === "main") {
      startMain(api);
      return;
    }
    if (api.process !== "renderer") return;
    startRenderer.call(this, api);
  },

  stop() {
    const state = this._state;
    if (!state) return;
    state.disposed = true;
    state.observer?.disconnect();
    if (state.interval) window.clearInterval(state.interval);
    if (state.startupSyncTimer) window.clearTimeout(state.startupSyncTimer);
    state.startupSyncTimer = null;
    window.removeEventListener("focus", state.scheduleScan);
    document.removeEventListener("visibilitychange", state.scheduleScan);
    state.pageHandle?.unregister?.();
    clearPanels();
    document.getElementById(STYLE_ID)?.remove();
  },
};

function startMain(api) {
  const service = createAgentsSyncService(api);
  globalThis[MAIN_SERVICE_KEY] = service;

  if (!globalThis[MAIN_HANDLER_KEY]) {
    api.ipc.handle(IPC_SYNC_AGENTS, (settings = {}) => {
      const active = globalThis[MAIN_SERVICE_KEY];
      return active?.syncAgentsInstruction(settings) || {
        ok: false,
        error: "Follow-up service unavailable",
      };
    });

    api.ipc.handle(IPC_DEFAULTS, () => {
      const active = globalThis[MAIN_SERVICE_KEY];
      return {
        agentsPath: active?.getAgentsPath?.() || "",
        prompt: DEFAULT_FOLLOWUP_PROMPT,
        instruction: DEFAULT_AGENTS_INSTRUCTION,
      };
    });

    globalThis[MAIN_HANDLER_KEY] = true;
  }

  api.log.info("Codex Follow-up main provider active");
}

function startRenderer(api) {
  const state = {
    api,
    enabled: api.storage.get("enabled", true),
    showDivider: api.storage.get("showDivider", true),
    clickableItems: api.storage.get("clickableItems", true),
    title: migrateTitle(api.storage.get("title", "Follow-up")),
    syncAgents: api.storage.get("syncAgents", true),
    followupPrompt: api.storage.get(
      "followupPrompt",
      migrateOldInstruction(api.storage.get("agentsInstruction", "")),
    ),
    observer: null,
    interval: null,
    startupSyncTimer: null,
    disposed: false,
    scheduled: false,
    pageHandle: null,
    statusEl: null,
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

  const scheduleScan = () => {
    if (state.disposed || state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      if (!state.disposed) scanMessages(state);
    });
  };

  state.scheduleScan = scheduleScan;
  injectStyles();
  scheduleScan();

  state.observer = new MutationObserver(scheduleScan);
  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  state.interval = window.setInterval(scheduleScan, 3_000);
  window.addEventListener("focus", scheduleScan);
  document.addEventListener("visibilitychange", scheduleScan);

  this._state = state;

  if (state.syncAgents) {
    state.startupSyncTimer = window.setTimeout(() => {
      state.startupSyncTimer = null;
      if (!state.disposed) syncAgentsInstruction(state, { quiet: true });
    }, 1_500);
  }

  api.log.info("Codex Follow-up renderer active");
}

function scanMessages(state) {
  if (!state.enabled) {
    clearPanels();
    return;
  }

  const messageNodes = document.querySelectorAll("div.group.flex.min-w-0.flex-col");
  for (const node of messageNodes) {
    if (!(node instanceof HTMLElement)) continue;
    const markdown = node.querySelector(
      "._markdownContent_1rhk1_42, [class*='_markdownContent_']",
    );
    if (!(markdown instanceof HTMLElement)) continue;

    const payload = findRadarPayload(markdown);
    const existing = node.querySelector(`[${PANEL_ATTR}]`);

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
      items: items.map((item) => item.prompt),
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
}

function findRadarPayload(markdown) {
  const candidates = [];

  for (const code of markdown.querySelectorAll("pre, code")) {
    if (!(code instanceof HTMLElement)) continue;
    const text = (code.textContent || "").trim();
    if (!text || !/codex_follow_up|soren_radar|follow_ups/.test(text)) continue;
    const parsed = parseRadarJson(text);
    if (parsed) {
      hideSourceBlock(code, markdown, text);
      candidates.push(parsed);
      continue;
    }

    const partial = parsePartialFollowupPayload(text);
    if (partial) {
      hideSourceBlock(code, markdown, text);
      candidates.push(partial);
    }
  }

  if (candidates.length > 0) return candidates[candidates.length - 1];

  const text = markdown.textContent || "";
  const directiveMatch = text.match(/::soren-radar\s*(\{[\s\S]*?\})\s*::/i);
  if (directiveMatch) {
    const parsed = parseRadarJson(directiveMatch[1]);
    if (parsed) return parsed;
  }

  return null;
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

function hideSourceBlock(code, markdown, rawText) {
  const block = findCodeBlockShell(code, markdown, rawText) || code.closest("pre") || code;
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
    list.querySelectorAll(".soren-radar-row").forEach((row, index) => {
      const isSelected = selected.has(index);
      row.classList.toggle("soren-radar-row-selected", isSelected);
      row.setAttribute("aria-checked", String(isSelected));
    });
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
        if (selected.has(index)) {
          selected.delete(index);
        } else {
          selected.add(index);
          insertIntoComposer(item.prompt);
        }
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

function insertIntoComposer(text) {
  const value = String(text || "").trim();
  if (!value) return;

  const control = findComposerControl();
  if (control instanceof HTMLTextAreaElement) {
    control.focus();
    insertIntoTextControl(control, value);
    return;
  }

  if (control instanceof HTMLElement) {
    control.focus();
    insertIntoContentEditable(control, value);
    return;
  }

  navigator.clipboard?.writeText(value).catch(() => {});
}

function findComposerControl() {
  const selectors = [
    "textarea[aria-label*='message' i]",
    "textarea[placeholder*='message' i]",
    "textarea[name*='message' i]",
    "[data-testid*='composer' i] textarea",
    "[data-testid*='prompt' i] textarea",
    "[aria-label*='message' i][contenteditable='true']",
    "[aria-label*='message' i][contenteditable='plaintext-only']",
    "[data-testid*='composer' i] [contenteditable='true']",
    "[data-testid*='composer' i] [contenteditable='plaintext-only']",
    "[data-testid*='prompt' i] [contenteditable='true']",
    "[data-testid*='prompt' i] [contenteditable='plaintext-only']",
    "form textarea",
    "main textarea",
    "textarea",
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
  ];

  for (const selector of selectors) {
    const candidate = Array.from(document.querySelectorAll(selector)).find(isUsableComposerControl);
    if (candidate) return candidate;
  }

  return null;
}

function isUsableComposerControl(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
  if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
  const editable = node.getAttribute("contenteditable");
  return editable === "true" || editable === "plaintext-only";
}

function insertIntoTextControl(textarea, insertion) {
  const current = String(textarea.value || "");
  const hasSelection = typeof textarea.selectionStart === "number" &&
    typeof textarea.selectionEnd === "number";

  if (hasSelection) {
    const start = Math.max(0, Math.min(textarea.selectionStart, current.length));
    const end = Math.max(start, Math.min(textarea.selectionEnd, current.length));
    const next = insertWithSpacing(current, insertion, start, end);
    textarea.value = next.value;
    textarea.setSelectionRange?.(next.cursor, next.cursor);
  } else {
    textarea.value = appendWithSpacing(current, insertion);
    const cursor = textarea.value.length;
    textarea.setSelectionRange?.(cursor, cursor);
  }

  dispatchComposerInput(textarea, insertion);
}

function insertIntoContentEditable(editable, insertion) {
  const selection = document.getSelection?.();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

  if (range && editable.contains(range.commonAncestorContainer)) {
    const beforeText = range.startContainer?.textContent || "";
    const afterText = range.endContainer?.textContent || "";
    const before = beforeText.slice(0, range.startOffset || 0);
    const after = afterText.slice(range.endOffset || 0);
    const prefix = before && !/\s$/.test(before) ? "\n\n" : "";
    const suffix = after && !/^\s/.test(after) ? "\n\n" : "";
    const node = document.createTextNode(`${prefix}${insertion}${suffix}`);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter?.(node);
    range.collapse?.(true);
    selection.removeAllRanges?.();
    selection.addRange?.(range);
  } else {
    editable.innerText = appendWithSpacing(editable.innerText || editable.textContent || "", insertion);
  }

  dispatchComposerInput(editable, insertion);
}

function appendWithSpacing(current, insertion) {
  const base = String(current || "").replace(/\s+$/u, "");
  return `${base}${base ? "\n\n" : ""}${insertion}`;
}

function insertWithSpacing(current, insertion, start, end) {
  const before = current.slice(0, start);
  const after = current.slice(end);
  const prefix = before && !/\s$/.test(before) ? "\n\n" : "";
  const suffix = after && !/^\s/.test(after) ? "\n\n" : "";
  const inserted = `${prefix}${insertion}${suffix}`;
  return {
    value: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length,
  };
}

function dispatchComposerInput(target, data) {
  const event = typeof InputEvent === "function"
    ? new InputEvent("input", { bubbles: true, inputType: "insertText", data })
    : typeof Event === "function"
      ? new Event("input", { bubbles: true })
      : null;
  if (event) target.dispatchEvent(event);
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
      color: #000000;
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
      color: #000000;
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
      color: #000000;
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
      color: #000000;
      background: color-mix(in srgb, currentColor 7%, transparent);
    }

    .soren-radar-row-selected {
      background: color-mix(in srgb, currentColor 7%, transparent);
    }

    .soren-radar-number {
      color: color-mix(in srgb, currentColor 52%, transparent);
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
      color: color-mix(in srgb, currentColor 58%, transparent);
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
      opacity: 0.7;
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
      color: var(--color-token-text-primary, #0f0f0f);
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
    toggleRow({
      label: "Sync AGENTS.md instruction",
      description: "Keep a managed follow-up instruction block in the global Codex memory.",
      checked: state.syncAgents,
      onChange: async (checked) => {
        state.syncAgents = checked;
        state.api.storage.set("syncAgents", checked);
        await syncAgentsInstruction(state);
      },
    }),
    textareaRow({
      label: "Editable prompt",
      description: "Describe when follow-ups should appear. The JSON format is locked below.",
      value: state.followupPrompt,
      onInput: (value) => {
        state.followupPrompt = value;
        state.api.storage.set("followupPrompt", value);
      },
    }),
    lockedFormatRow(),
    actionRow({
      onApply: () => syncAgentsInstruction(state),
      onReset: async () => {
        state.followupPrompt = DEFAULT_FOLLOWUP_PROMPT;
        state.api.storage.set("followupPrompt", DEFAULT_FOLLOWUP_PROMPT);
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
    });

    if (result?.ok) {
      const label =
        result.action === "removed"
          ? "Instruction removed"
          : result.action === "unchanged"
            ? "AGENTS.md already current"
            : "AGENTS.md updated";
      setStatus(state, label);
    } else {
      setStatus(state, result?.error || "Sync failed");
    }

    return result;
  } catch (error) {
    setStatus(state, error?.message || String(error));
    return null;
  }
}

function setStatus(state, text) {
  if (!state.statusEl) return;
  state.statusEl.textContent = text || "";
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
    "min-h-56 w-full resize-y rounded-lg border border-token-border-light bg-token-bg-secondary p-3 font-mono text-xs text-token-text-primary outline-none";
  textarea.spellcheck = false;
  textarea.value = value || "";
  textarea.addEventListener("input", () => onInput(textarea.value));
  row.appendChild(title);
  row.appendChild(desc);
  row.appendChild(textarea);
  return row;
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

function actionRow({ onApply, onReset, statusRef }) {
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

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className =
    "rounded-lg border border-token-border-light bg-token-bg-secondary px-3 py-2 text-sm text-token-text-primary hover:bg-token-bg-tertiary";
  apply.textContent = "Apply to AGENTS.md";
  apply.addEventListener("click", onApply);

  actions.appendChild(reset);
  actions.appendChild(apply);
  row.appendChild(status);
  row.appendChild(actions);
  return row;
}

function createAgentsSyncService(api) {
  return {
    getAgentsPath,
    syncAgentsInstruction(settings = {}) {
      const enabled = settings.enabled !== false;
      const instruction = composeAgentsInstruction(settings.prompt);
      const agentsPath = getAgentsPath();

      try {
        const fs = require("fs");
        const current = fs.existsSync(agentsPath)
          ? fs.readFileSync(agentsPath, "utf8")
          : "";
        const next = enabled
          ? upsertManagedBlock(current, instruction)
          : removeManagedBlock(current);

        if (next === current) {
          return { ok: true, action: "unchanged", path: agentsPath };
        }

        fs.mkdirSync(require("path").dirname(agentsPath), { recursive: true });
        fs.writeFileSync(agentsPath, next, "utf8");
        return {
          ok: true,
          action: enabled ? "updated" : "removed",
          path: agentsPath,
        };
      } catch (error) {
        api.log.error("Codex Follow-up AGENTS.md sync failed", error);
        return {
          ok: false,
          error: error?.message || String(error),
          path: agentsPath,
        };
      }
    },
  };
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

function migrateTitle(value) {
  const title = String(value || "").trim();
  if (!title || /radar|seguimiento|soren/i.test(title)) return "Follow-up";
  return title;
}

function upsertManagedBlock(source, instruction) {
  const block = [BLOCK_BEGIN, instruction.trim(), BLOCK_END].join("\n");
  const pattern = managedBlockPattern(BLOCK_BEGIN, BLOCK_END);
  const upstreamPattern = managedBlockPattern(UPSTREAM_BLOCK_BEGIN, UPSTREAM_BLOCK_END);
  const legacyPattern = managedBlockPattern(LEGACY_BLOCK_BEGIN, LEGACY_BLOCK_END);
  const oldestPattern = managedBlockPattern(OLDEST_BLOCK_BEGIN, OLDEST_BLOCK_END);
  const withoutLegacy = source
    .replace(managedBlockPattern(UPSTREAM_BLOCK_BEGIN, UPSTREAM_BLOCK_END, true), "\n")
    .replace(managedBlockPattern(LEGACY_BLOCK_BEGIN, LEGACY_BLOCK_END, true), "\n")
    .replace(managedBlockPattern(OLDEST_BLOCK_BEGIN, OLDEST_BLOCK_END, true), "\n");

  if (pattern.test(withoutLegacy)) {
    return withoutLegacy.replace(pattern, block).replace(/\n{3,}/g, "\n\n");
  }

  if (upstreamPattern.test(source)) {
    return source.replace(upstreamPattern, block).replace(/\n{3,}/g, "\n\n");
  }

  if (legacyPattern.test(source)) {
    return source.replace(legacyPattern, block).replace(/\n{3,}/g, "\n\n");
  }

  if (oldestPattern.test(source)) {
    return source.replace(oldestPattern, block).replace(/\n{3,}/g, "\n\n");
  }

  const trimmed = withoutLegacy.replace(/\s+$/u, "");
  return `${trimmed}${trimmed ? "\n\n" : ""}${block}\n`;
}

function removeManagedBlock(source) {
  return source
    .replace(managedBlockPattern(BLOCK_BEGIN, BLOCK_END, true), "\n")
    .replace(managedBlockPattern(UPSTREAM_BLOCK_BEGIN, UPSTREAM_BLOCK_END, true), "\n")
    .replace(managedBlockPattern(LEGACY_BLOCK_BEGIN, LEGACY_BLOCK_END, true), "\n")
    .replace(managedBlockPattern(OLDEST_BLOCK_BEGIN, OLDEST_BLOCK_END, true), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

function managedBlockPattern(begin, end, includeOuterWhitespace = false) {
  const prefix = includeOuterWhitespace ? "\\n*" : "";
  const suffix = includeOuterWhitespace ? "\\n*" : "";
  return new RegExp(`${prefix}${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}${suffix}`, "m");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
