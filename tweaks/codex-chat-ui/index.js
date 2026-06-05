"use strict";

// Renderer-only bridge from structured assistant JSON to compact chat UI blocks.
const TWEAK_ID = "co.thomashulihan.codex-chat-ui";
const STYLE_ID = "codexpp-chat-ui-style";
const PANEL_ATTR = "data-codexpp-chat-ui-panel";
const MENTIONED_FILES_ATTR = "data-codexpp-chat-ui-mentioned-files";
const BLOCK_ATTR = "data-codexpp-chat-ui-block";
const HIDDEN_ATTR = "data-codexpp-chat-ui-hidden";
const IPC_RELOAD_TWEAKS = "codex-chat-ui:reload-tweaks";
const MAX_BLOCKS = 3;
const MAX_ITEMS = 8;
const MAX_ACTIONS = 3;
const MAX_TEXT = 1_200;

const SUPPORTED_BLOCK_KINDS = Object.freeze([
  "summary_card",
  "action_list",
  "progress_panel",
  "data_table",
  "file_preview",
]);

const chatUiPayloadCache = new WeakMap();

/** @type {import("@codex-plusplus/sdk").Tweak} */
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
      for (const dispose of mainState.disposers) {
        try {
          dispose?.();
        } catch {
          // Keep shutdown idempotent during hot reload.
        }
      }
      mainState.disposers.length = 0;
      this._mainState = null;
    }

    const state = this._state;
    if (!state) return;
    state.disposed = true;
    state.observer?.disconnect();
    if (state.interval) window.clearInterval(state.interval);
    window.removeEventListener("focus", state.scheduleScan);
    document.removeEventListener("visibilitychange", state.scheduleScan);
    state.pageHandle?.unregister?.();
    clearPanels();
    document.getElementById(STYLE_ID)?.remove();
    this._state = null;
  },

  __test: {
    scanMessages,
    parseChatUiJson,
    normalizeRenderableBlocks,
    renderChatUiPanel,
    sanitizeDataObject,
    cleanText,
    PANEL_ATTR,
    HIDDEN_ATTR,
  },
};

function startMain(api) {
  const mainState = { disposers: [] };
  const disposeReload = api.ipc?.handle?.(IPC_RELOAD_TWEAKS, async () => {
    const manager = api.codex?.tweaks;
    if (!manager || typeof manager.reload !== "function") {
      return {
        ok: false,
        error: "Installed tweak reload is unavailable in this ShadGPT runtime.",
      };
    }
    await manager.reload();
    return { ok: true };
  });
  if (typeof disposeReload === "function") mainState.disposers.push(disposeReload);
  this._mainState = mainState;
  api.log.info(`${TWEAK_ID} main provider active`);
}

function startRenderer(api) {
  const state = {
    api,
    enabled: api.storage.get("enabled", true),
    showFallbacks: api.storage.get("showFallbacks", true),
    clickableActions: api.storage.get("clickableActions", true),
    blockKinds: {
      summary_card: api.storage.get("summary_card", true),
      action_list: api.storage.get("action_list", true),
      progress_panel: api.storage.get("progress_panel", true),
      data_table: api.storage.get("data_table", true),
      file_preview: api.storage.get("file_preview", true),
    },
    observer: null,
    interval: null,
    disposed: false,
    scheduled: false,
    pageHandle: null,
    statusEl: null,
    probeEl: null,
  };

  if (typeof api.settings?.registerPage === "function") {
    state.pageHandle = api.settings.registerPage({
      id: "main",
      title: "Codex Chat UI",
      description: "Render safe shadcn-style UI blocks inside Codex chat messages.",
      iconSvg:
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<rect x="3.5" y="4.5" width="13" height="11" rx="2.2" stroke="currentColor" stroke-width="1.4"/>' +
        '<path d="M6.5 8h7M6.5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
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
  // Avoid characterData: Codex streams assistant text through text-node updates,
  // and parsing candidate JSON on every token makes message rendering lag.
  // Structural changes plus the periodic scan are enough to discover finished
  // codex_ui payloads.
  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  state.interval = window.setInterval(scheduleScan, 3_000);
  window.addEventListener("focus", scheduleScan);
  document.addEventListener("visibilitychange", scheduleScan);

  this._state = state;
  api.log.info(`${TWEAK_ID} renderer active`);
}

function scanMessages(state) {
  if (!state.enabled) {
    clearPanels();
    return;
  }

  const messageNodes = document.querySelectorAll("div.group.flex.min-w-0.flex-col");
  const lastNode = messageNodes.length ? messageNodes[messageNodes.length - 1] : null;

  for (const node of messageNodes) {
    if (!(node instanceof HTMLElement)) continue;
    const markdown = node.querySelector(
      "._markdownContent_1rhk1_42, [class*='_markdownContent_']",
    );
    if (!(markdown instanceof HTMLElement)) continue;
    syncMentionedFilesPanel(node, markdown, state);

    let record;
    if (node !== lastNode && chatUiPayloadCache.has(node)) {
      record = chatUiPayloadCache.get(node);
    } else {
      record = findChatUiPayload(markdown);
      if (node !== lastNode) chatUiPayloadCache.set(node, record);
    }

    const existing = node.querySelector(`[${PANEL_ATTR}]`);
    if (!record?.payload) {
      existing?.remove();
      showHiddenSourceBlocks(node);
      continue;
    }

    const renderedBlocks = normalizeRenderableBlocks(record.payload, state);
    if (renderedBlocks.length === 0) {
      existing?.remove();
      showSourceBlocks(record.sourceBlocks);
      continue;
    }

    const signature = JSON.stringify({
      blocks: renderedBlocks,
      showFallbacks: state.showFallbacks,
      clickableActions: state.clickableActions,
      blockKinds: state.blockKinds,
    });

    if (existing?.dataset.signature === signature) {
      hideSourceBlocks(record.sourceBlocks);
      continue;
    }

    const panel = renderChatUiPanel(renderedBlocks, state);
    panel.dataset.signature = signature;
    if (existing) existing.replaceWith(panel);
    else node.appendChild(panel);
    hideSourceBlocks(record.sourceBlocks);
  }
}

function syncMentionedFilesPanel(messageNode, markdown, state) {
  const existing = messageNode.querySelector(`[${MENTIONED_FILES_ATTR}]`);
  const files = collectMentionedLocalFiles(markdown);
  if (files.length === 0 || !state.clickableActions) {
    existing?.remove();
    return;
  }

  const signature = JSON.stringify(files.map((file) => file.path));
  if (existing?.dataset.signature === signature) return;

  const panel = renderMentionedFilesPanel(files, state);
  panel.dataset.signature = signature;
  if (existing) existing.replaceWith(panel);
  else messageNode.insertBefore(panel, markdown);
}

function collectMentionedLocalFiles(markdown) {
  const files = [];
  const seen = new Set();
  for (const link of markdown.querySelectorAll("a")) {
    if (!(link instanceof HTMLElement)) continue;
    const path = localFilePathFromLink(link);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    files.push({
      name: basenameFromPath(path),
      path,
      kind: "file",
      description: fileTypeDescription(path),
      children: [],
      depth: 0,
    });
    if (files.length >= MAX_ITEMS) break;
  }
  return files;
}

function localFilePathFromLink(link) {
  const candidates = [
    link.getAttribute("href") || "",
    link.getAttribute("data-href") || "",
    link.textContent || "",
  ];
  for (const candidate of candidates) {
    const path = normalizeLocalFileLink(candidate);
    if (path) return path;
  }
  return "";
}

function normalizeLocalFileLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(raw).pathname);
    } catch {
      return "";
    }
  }
  if (/^\/(?:Users|Volumes|private|tmp|var)\//.test(raw)) return raw;
  return "";
}

function renderMentionedFilesPanel(files, state) {
  const panel = document.createElement("section");
  panel.setAttribute(MENTIONED_FILES_ATTR, "true");
  panel.className = "codexpp-chat-ui-mentioned-files";
  panel.setAttribute("aria-label", "Mentioned files");

  const visibleFiles = files.slice(0, 3);
  for (const file of visibleFiles) panel.appendChild(renderMentionedFileRow(file, state));
  if (files.length > visibleFiles.length) {
    const more = document.createElement("div");
    more.className = "codexpp-chat-ui-mentioned-files-more";
    more.textContent = `Show ${files.length - visibleFiles.length} more`;
    panel.appendChild(more);
  }
  return panel;
}

function renderMentionedFileRow(file, state) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "codexpp-chat-ui-mentioned-file-row";
  row.addEventListener("click", () => openFilePreviewPath(file.path, state));

  const icon = document.createElement("span");
  icon.className = `codexpp-chat-ui-mentioned-file-icon codexpp-chat-ui-mentioned-file-icon-${fileExtension(file.path) || "file"}`;
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = mentionedFileIconLabel(file.path);

  const content = document.createElement("span");
  content.className = "codexpp-chat-ui-mentioned-file-content";
  const name = document.createElement("span");
  name.className = "codexpp-chat-ui-mentioned-file-name";
  name.textContent = file.name;
  const meta = document.createElement("span");
  meta.className = "codexpp-chat-ui-mentioned-file-meta";
  meta.textContent = file.description || "Open file";
  content.append(name, meta);

  const action = document.createElement("span");
  action.className = "codexpp-chat-ui-mentioned-file-action";
  action.textContent = "Open in";

  row.append(icon, content, action);
  return row;
}

function findChatUiPayload(markdown) {
  const candidates = [];

  for (const code of markdown.querySelectorAll("pre, code")) {
    if (!(code instanceof HTMLElement)) continue;
    const text = (code.textContent || "").trim();
    if (!text || !/codex_ui|codex_in_chat_ui/.test(text)) continue;
    const payload = parseChatUiJson(text);
    if (!payload) continue;
    const sourceBlock = findCodeBlockShell(code, markdown, text) || code.closest("pre") || code;
    candidates.push({
      payload,
      sourceBlocks: sourceBlock instanceof HTMLElement ? [sourceBlock] : [],
    });
  }

  return candidates.length ? candidates[candidates.length - 1] : null;
}

function parseChatUiJson(text) {
  const cleaned = String(text || "")
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
      if (normalized) return normalized;
    } catch {
      // Invalid JSON should remain visible as normal chat text.
    }
  }

  return null;
}

function normalizePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.codex_ui !== true && parsed.codex_in_chat_ui !== true) return null;
  if (Number(parsed.version || 1) !== 1) return null;
  if (!Array.isArray(parsed.blocks)) return null;

  const blocks = parsed.blocks
    .map(normalizeBlock)
    .filter(Boolean)
    .slice(0, MAX_BLOCKS);

  return blocks.length > 0 ? { version: 1, blocks } : null;
}

function normalizeBlock(block, index) {
  if (!block || typeof block !== "object") return null;
  const kind = cleanToken(block.kind || "").slice(0, 64);
  if (!kind) return null;
  const props = sanitizeDataObject(block.props || {});
  const fallbackText = cleanText(block.fallbackText || block.fallback || "");
  return {
    id: cleanToken(block.id || `${kind}-${index + 1}`),
    kind,
    props,
    fallbackText,
  };
}

function normalizeRenderableBlocks(payload, state) {
  return payload.blocks
    .map((block) => {
      const supported = SUPPORTED_BLOCK_KINDS.includes(block.kind);
      const enabled = supported && state.blockKinds[block.kind] !== false;
      if (supported && enabled) return { mode: "component", block };
      if (state.showFallbacks && block.fallbackText) {
        return {
          mode: "fallback",
          block: {
            ...block,
            props: {
              title: supported ? "Block disabled" : "Unsupported block",
              body: block.fallbackText,
            },
          },
        };
      }
      return null;
    })
    .filter(Boolean);
}

function sanitizeDataObject(value, depth = 0) {
  if (depth > 8) return {};
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => sanitizeDataObject(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return sanitizePrimitive(value);
  }

  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const safeKey = cleanToken(key).slice(0, 64);
    if (!safeKey || /^on[A-Z]/.test(safeKey) || safeKey.startsWith("on")) continue;
    out[safeKey] = sanitizeDataObject(rawValue, depth + 1);
  }
  return out;
}

function sanitizePrimitive(value) {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  return "";
}

function cleanToken(value) {
  return String(value || "").replace(/[^\w.-]/g, "").trim();
}

function cleanText(value, max = MAX_TEXT) {
  return String(value || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=/gi, " ")
    .replace(/javascript:/gi, "")
    .trim()
    .slice(0, max);
}

function renderChatUiPanel(renderedBlocks, state) {
  const panel = document.createElement("section");
  panel.setAttribute(PANEL_ATTR, "true");
  panel.className = "codexpp-chat-ui-panel";
  panel.setAttribute("aria-label", "Codex chat UI");

  for (const item of renderedBlocks) {
    if (item.mode === "fallback") {
      panel.appendChild(renderFallbackBlock(item.block));
      continue;
    }

    if (item.block.kind === "summary_card") panel.appendChild(renderSummaryCard(item.block, state));
    else if (item.block.kind === "action_list") panel.appendChild(renderActionList(item.block, state));
    else if (item.block.kind === "progress_panel") panel.appendChild(renderProgressPanel(item.block, state));
    else if (item.block.kind === "data_table") panel.appendChild(renderDataTable(item.block));
    else if (item.block.kind === "file_preview") panel.appendChild(renderFilePreview(item.block, state));
  }

  return panel;
}

function renderSummaryCard(block, state) {
  const props = block.props || {};
  const card = createBlockShell(block.kind);
  const header = document.createElement("header");
  header.className = "codexpp-chat-ui-card-header";

  const titleRow = document.createElement("div");
  titleRow.className = "codexpp-chat-ui-title-row";
  const title = document.createElement("h3");
  title.className = "codexpp-chat-ui-title";
  title.textContent = cleanText(props.title || "Summary", 160);
  titleRow.appendChild(title);

  const status = normalizeStatus(props.status);
  if (status) titleRow.appendChild(statusBadge(status));
  header.appendChild(titleRow);

  const subtitle = cleanText(props.subtitle || props.description || "", 260);
  if (subtitle) {
    const subtitleEl = document.createElement("p");
    subtitleEl.className = "codexpp-chat-ui-subtitle";
    subtitleEl.textContent = subtitle;
    header.appendChild(subtitleEl);
  }
  card.appendChild(header);

  const items = normalizeItems(props.items);
  if (items.length > 0) card.appendChild(renderKeyValueList(items));

  const actions = normalizeActions(props.actions);
  if (actions.length > 0) card.appendChild(renderActions(actions, state));

  const footer = cleanText(props.footer || "", 260);
  if (footer) card.appendChild(footerEl(footer));
  return card;
}

function renderActionList(block, state) {
  const props = block.props || {};
  const card = createBlockShell(block.kind);
  const header = compactHeader(
    cleanText(props.title || "Actions", 160),
    cleanText(props.description || props.subtitle || "", 260),
    normalizeStatus(props.status),
  );
  card.appendChild(header);

  const items = Array.isArray(props.items) ? props.items.slice(0, MAX_ITEMS) : [];
  const list = document.createElement("div");
  list.className = "codexpp-chat-ui-action-list";

  items.forEach((item, index) => {
    const normalized = normalizeActionItem(item, index);
    if (!normalized.label && !normalized.prompt) return;
    const row = document.createElement(normalized.prompt && state.clickableActions ? "button" : "div");
    row.className = normalized.prompt && state.clickableActions
      ? "codexpp-chat-ui-action-row codexpp-chat-ui-action-row-clickable"
      : "codexpp-chat-ui-action-row";
    if (row instanceof HTMLButtonElement) {
      row.type = "button";
      row.addEventListener("click", () => insertIntoComposer(normalized.prompt));
    }

    const number = document.createElement("span");
    number.className = "codexpp-chat-ui-action-number";
    number.textContent = `${index + 1}.`;

    const content = document.createElement("span");
    content.className = "codexpp-chat-ui-action-content";
    const label = document.createElement("span");
    label.className = "codexpp-chat-ui-action-label";
    label.textContent = normalized.label || normalized.prompt;
    content.appendChild(label);
    if (normalized.description) {
      const description = document.createElement("span");
      description.className = "codexpp-chat-ui-action-description";
      description.textContent = normalized.description;
      content.appendChild(description);
    }

    row.append(number, content);
    list.appendChild(row);
  });

  if (list.childNodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "codexpp-chat-ui-empty";
    empty.textContent = "No actions available.";
    card.appendChild(empty);
  } else {
    card.appendChild(list);
  }
  return card;
}

function renderProgressPanel(block) {
  const props = block.props || {};
  const card = createBlockShell(block.kind);
  card.appendChild(compactHeader(
    cleanText(props.title || "Progress", 160),
    cleanText(props.subtitle || props.description || "", 260),
    normalizeStatus(props.status),
  ));

  const progress = clampNumber(props.progress ?? props.percent ?? 0, 0, 100);
  const progressWrap = document.createElement("div");
  progressWrap.className = "codexpp-chat-ui-progress-wrap";
  const progressMeta = document.createElement("div");
  progressMeta.className = "codexpp-chat-ui-progress-meta";
  progressMeta.textContent = `${Math.round(progress)}%`;
  const track = document.createElement("div");
  track.className = "codexpp-chat-ui-progress-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(Math.round(progress)));
  const fill = document.createElement("div");
  fill.className = "codexpp-chat-ui-progress-fill";
  fill.style.width = `${progress}%`;
  track.appendChild(fill);
  progressWrap.append(progressMeta, track);
  card.appendChild(progressWrap);

  const steps = normalizeSteps(props.steps);
  if (steps.length > 0) card.appendChild(renderSteps(steps));

  const footer = cleanText(props.footer || "", 260);
  if (footer) card.appendChild(footerEl(footer));
  return card;
}

function renderDataTable(block) {
  const props = block.props || {};
  const card = createBlockShell(block.kind);
  card.appendChild(compactHeader(
    cleanText(props.title || "Data table", 160),
    cleanText(props.subtitle || props.description || "", 260),
    normalizeStatus(props.status),
  ));

  const columns = normalizeColumns(props.columns);
  const rows = normalizeRows(props.rows, columns);
  if (columns.length === 0 || rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "codexpp-chat-ui-empty";
    empty.textContent = "No table data available.";
    card.appendChild(empty);
    return card;
  }

  const scroll = document.createElement("div");
  scroll.className = "codexpp-chat-ui-table-scroll";
  const table = document.createElement("table");
  table.className = "codexpp-chat-ui-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = row[column.key] || "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  card.appendChild(scroll);

  const footer = cleanText(props.footer || "", 260);
  if (footer) card.appendChild(footerEl(footer));
  return card;
}

function renderFilePreview(block, state) {
  const props = block.props || {};
  const card = createBlockShell(block.kind);
  card.appendChild(compactHeader(
    cleanText(props.title || "Files", 160),
    cleanText(props.subtitle || props.root || props.description || "", 260),
    normalizeStatus(props.status),
  ));

  const files = normalizeFiles(props.files || props.tree);
  if (files.length === 0) {
    const empty = document.createElement("p");
    empty.className = "codexpp-chat-ui-empty";
    empty.textContent = "No files available.";
    card.appendChild(empty);
    return card;
  }

  const tree = document.createElement("div");
  tree.className = "codexpp-chat-ui-file-tree";
  tree.setAttribute("role", "list");
  for (const file of files) tree.appendChild(renderFileTreeRow(file, state));
  card.appendChild(tree);

  const actions = normalizeActions(props.actions);
  if (actions.length > 0) card.appendChild(renderActions(actions, state));

  const footer = cleanText(props.footer || "", 260);
  if (footer) card.appendChild(footerEl(footer));
  return card;
}

function renderFallbackBlock(block) {
  const card = createBlockShell("fallback");
  card.classList.add("codexpp-chat-ui-fallback");
  card.appendChild(compactHeader(
    cleanText(block.props?.title || "Fallback", 120),
    "",
    "warning",
  ));
  const body = document.createElement("p");
  body.className = "codexpp-chat-ui-fallback-body";
  body.textContent = cleanText(block.props?.body || block.fallbackText || "This UI block is not available here.");
  card.appendChild(body);
  return card;
}

function createBlockShell(kind) {
  const card = document.createElement("section");
  card.setAttribute(BLOCK_ATTR, kind);
  card.className = "codexpp-chat-ui-card";
  return card;
}

function compactHeader(titleText, subtitleText, status) {
  const header = document.createElement("header");
  header.className = "codexpp-chat-ui-card-header";
  const titleRow = document.createElement("div");
  titleRow.className = "codexpp-chat-ui-title-row";
  const title = document.createElement("h3");
  title.className = "codexpp-chat-ui-title";
  title.textContent = titleText || "Codex UI";
  titleRow.appendChild(title);
  if (status) titleRow.appendChild(statusBadge(status));
  header.appendChild(titleRow);
  if (subtitleText) {
    const subtitle = document.createElement("p");
    subtitle.className = "codexpp-chat-ui-subtitle";
    subtitle.textContent = subtitleText;
    header.appendChild(subtitle);
  }
  return header;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      label: cleanText(item?.label || item?.name || "", 80),
      value: cleanText(item?.value || item?.text || "", 220),
    }))
    .filter((item) => item.label || item.value);
}

function renderKeyValueList(items) {
  const list = document.createElement("dl");
  list.className = "codexpp-chat-ui-kv-list";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "codexpp-chat-ui-kv-row";
    const dt = document.createElement("dt");
    dt.textContent = item.label;
    const dd = document.createElement("dd");
    dd.textContent = item.value;
    row.append(dt, dd);
    list.appendChild(row);
  }
  return list;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .slice(0, MAX_ACTIONS)
    .map((action) => ({
      type: cleanToken(action?.type || ""),
      label: cleanText(action?.label || action?.title || "", 80),
      prompt: cleanText(action?.prompt || action?.message || "", 600),
      text: cleanText(action?.text || action?.value || "", 600),
    }))
    .filter((action) => action.label && ["send_message", "copy_text", "toggle_local_state"].includes(action.type));
}

function normalizeColumns(columns) {
  if (!Array.isArray(columns)) return [];
  return columns
    .slice(0, 6)
    .map((column, index) => {
      if (typeof column === "string") {
        const label = cleanText(column, 80);
        return { key: cleanToken(label || `column${index + 1}`), label };
      }
      return {
        key: cleanToken(column?.key || column?.id || column?.label || `column${index + 1}`),
        label: cleanText(column?.label || column?.title || column?.key || `Column ${index + 1}`, 80),
      };
    })
    .filter((column) => column.key && column.label);
}

function normalizeRows(rows, columns) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_ITEMS).map((row) => {
    const out = {};
    if (Array.isArray(row)) {
      columns.forEach((column, index) => {
        out[column.key] = cleanText(row[index] ?? "", 180);
      });
      return out;
    }
    if (!row || typeof row !== "object") return out;
    for (const column of columns) out[column.key] = cleanText(row[column.key] ?? "", 180);
    return out;
  });
}

function normalizeFiles(value, depth = 0) {
  if (!Array.isArray(value) || depth > 4) return [];
  return value
    .slice(0, MAX_ITEMS)
    .map((file) => {
      if (typeof file === "string") {
        return {
          name: basenameFromPath(file),
          path: cleanText(file, 360),
          kind: file.endsWith("/") ? "directory" : "file",
          status: "",
          description: "",
          children: [],
          depth,
        };
      }
      const path = cleanText(file?.path || file?.name || "", 360);
      const name = cleanText(file?.name || basenameFromPath(path) || "File", 120);
      const kind = normalizeFileKind(file?.kind || file?.type || (Array.isArray(file?.children) ? "directory" : "file"));
      return {
        name,
        path,
        kind,
        status: normalizeStatus(file?.status || ""),
        description: cleanText(file?.description || file?.summary || file?.size || "", 180),
        children: normalizeFiles(file?.children, depth + 1),
        depth,
      };
    })
    .filter((file) => file.name || file.path);
}

function renderFileTreeRow(file, state) {
  const wrap = document.createElement("div");
  wrap.className = "codexpp-chat-ui-file-row-wrap";
  wrap.setAttribute("role", "listitem");

  const row = document.createElement("div");
  row.className = "codexpp-chat-ui-file-row";
  row.style.paddingLeft = `${6 + (file.depth || 0) * 16}px`;

  const icon = document.createElement("span");
  const iconDescriptor = fileIconDescriptor(file);
  icon.className = [
    "codexpp-chat-ui-file-icon",
    `codexpp-chat-ui-file-icon-${iconDescriptor.tone}`,
    iconDescriptor.extension ? `codexpp-chat-ui-file-ext-${iconDescriptor.extension}` : "",
  ].filter(Boolean).join(" ");
  icon.setAttribute("aria-hidden", "true");
  icon.title = iconDescriptor.title;
  icon.textContent = iconDescriptor.label;

  const content = document.createElement("span");
  content.className = "codexpp-chat-ui-file-content";
  const name = document.createElement("span");
  name.className = "codexpp-chat-ui-file-name";
  name.textContent = file.name || file.path;
  content.appendChild(name);

  const metaText = [file.path && file.path !== file.name ? file.path : "", file.description].filter(Boolean).join(" - ");
  if (metaText) {
    const meta = document.createElement("span");
    meta.className = "codexpp-chat-ui-file-meta";
    meta.textContent = metaText;
    content.appendChild(meta);
  }

  row.append(icon, content);
  if (file.status) row.append(fileStatusIcon(file.status), statusBadge(file.status));
  if (file.path && state.clickableActions) {
    row.className = `${row.className} codexpp-chat-ui-file-row-clickable`;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("title", `Open ${file.path}`);
    row.addEventListener("click", () => openFilePreviewPath(file.path, state));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault?.();
      openFilePreviewPath(file.path, state);
    });

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "codexpp-chat-ui-file-copy";
    copy.textContent = "Copy path";
    copy.addEventListener("click", (event) => {
      event.stopPropagation?.();
      navigator.clipboard?.writeText(file.path).catch(() => {});
    });
    row.appendChild(copy);
  }
  wrap.appendChild(row);

  if (file.children.length > 0) {
    const children = document.createElement("div");
    children.className = "codexpp-chat-ui-file-children";
    children.setAttribute("role", "list");
    for (const child of file.children) children.appendChild(renderFileTreeRow(child, state));
    wrap.appendChild(children);
  }
  return wrap;
}

function openFilePreviewPath(filePath, state) {
  const path = cleanText(filePath, 360);
  if (!path) return;
  const request = {
    path,
    openMode: "workspace",
  };
  fetch("vscode://codex/open-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }).catch((error) => {
    state.api?.log?.warn?.("[codex-chat-ui] failed to open file preview row", error?.message || String(error));
  });
}

function normalizeFileKind(kind) {
  const value = cleanToken(kind || "").toLowerCase();
  return ["directory", "folder", "dir"].includes(value) ? "directory" : "file";
}

function fileIconDescriptor(file) {
  if (file.kind === "directory") return { label: "DIR", title: "Directory", tone: "directory", extension: "" };
  const extension = fileExtension(file.path || file.name);
  const known = {
    js: "JS",
    jsx: "JSX",
    ts: "TS",
    tsx: "TSX",
    json: "JSON",
    md: "MD",
    css: "CSS",
    html: "HTML",
    yml: "YML",
    yaml: "YML",
    toml: "TOML",
    lock: "LOCK",
  };
  const label = known[extension] || (extension ? extension.slice(0, 4).toUpperCase() : "FILE");
  return { label, title: extension ? `${extension.toUpperCase()} file` : "File", tone: extension ? "typed" : "file", extension };
}

function fileExtension(value) {
  const name = basenameFromPath(value).toLowerCase();
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return "";
  return cleanToken(name.slice(index + 1)).slice(0, 8);
}

function fileTypeDescription(value) {
  const extension = fileExtension(value);
  if (!extension) return "Open file";
  if (["csv", "tsv", "xlsx", "xls"].includes(extension)) return `Spreadsheet · ${extension.toUpperCase()}`;
  if (["md", "markdown", "txt", "pdf", "doc", "docx"].includes(extension)) return `Document · ${extension.toUpperCase()}`;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return `Image · ${extension.toUpperCase()}`;
  if (["js", "jsx", "ts", "tsx", "css", "html", "json", "yml", "yaml", "toml"].includes(extension)) return `Code · ${extension.toUpperCase()}`;
  return `File · ${extension.toUpperCase()}`;
}

function mentionedFileIconLabel(value) {
  const extension = fileExtension(value);
  if (["csv", "tsv", "xlsx", "xls"].includes(extension)) return "X";
  if (["md", "markdown", "txt", "pdf", "doc", "docx"].includes(extension)) return "DOC";
  if (extension) return extension.slice(0, 3).toUpperCase();
  return "FILE";
}

function fileStatusIcon(status) {
  const value = normalizeStatus(status);
  const icon = document.createElement("span");
  icon.className = `codexpp-chat-ui-file-status-icon codexpp-chat-ui-file-status-${value}`;
  icon.setAttribute("aria-hidden", "true");
  if (value === "done" || value === "ready") icon.textContent = "OK";
  else if (value === "running") icon.textContent = "...";
  else if (value === "warning" || value === "blocked") icon.textContent = "!";
  else icon.textContent = "-";
  return icon;
}

function basenameFromPath(path) {
  const cleaned = String(path || "").replace(/\/+$/, "");
  return cleaned.split(/[\\/]/).filter(Boolean).pop() || cleaned;
}

function renderActions(actions, state) {
  const wrap = document.createElement("div");
  wrap.className = "codexpp-chat-ui-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "codexpp-chat-ui-button";
    button.textContent = action.label;
    button.disabled = !state.clickableActions;
    button.addEventListener("click", () => runAction(action));
    wrap.appendChild(button);
  }
  return wrap;
}

function runAction(action) {
  if (action.type === "send_message") {
    insertIntoComposer(action.prompt || action.text);
    return;
  }
  if (action.type === "copy_text") {
    const text = action.text || action.prompt;
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
    return;
  }
  if (action.type === "toggle_local_state") {
    // First-release local state is limited to native details elements.
    const details = document.activeElement?.closest?.("details");
    if (details instanceof HTMLDetailsElement) details.open = !details.open;
  }
}

function normalizeActionItem(item, index) {
  if (typeof item === "string") {
    return { label: cleanText(item, 140), description: "", prompt: cleanText(item, 600) };
  }
  return {
    label: cleanText(item?.label || item?.title || item?.prompt || `Action ${index + 1}`, 140),
    description: cleanText(item?.description || item?.achieves || item?.outcome || "", 240),
    prompt: cleanText(item?.prompt || item?.message || item?.label || "", 600),
  };
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .slice(0, MAX_ITEMS)
    .map((step) => ({
      label: cleanText(step?.label || step?.title || "", 140),
      status: normalizeStatus(step?.status || ""),
      description: cleanText(step?.description || step?.detail || "", 240),
    }))
    .filter((step) => step.label || step.description);
}

function renderSteps(steps) {
  const list = document.createElement("ol");
  list.className = "codexpp-chat-ui-steps";
  for (const step of steps) {
    const item = document.createElement("li");
    item.className = "codexpp-chat-ui-step";
    const marker = document.createElement("span");
    marker.className = `codexpp-chat-ui-step-marker codexpp-chat-ui-step-${step.status || "ready"}`;
    marker.setAttribute("aria-hidden", "true");
    const content = document.createElement("span");
    content.className = "codexpp-chat-ui-step-content";
    const label = document.createElement("span");
    label.className = "codexpp-chat-ui-step-label";
    label.textContent = step.label;
    content.appendChild(label);
    if (step.description) {
      const description = document.createElement("span");
      description.className = "codexpp-chat-ui-step-description";
      description.textContent = step.description;
      content.appendChild(description);
    }
    item.append(marker, content);
    list.appendChild(item);
  }
  return list;
}

function statusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `codexpp-chat-ui-badge codexpp-chat-ui-badge-${status}`;
  badge.textContent = statusLabel(status);
  return badge;
}

function normalizeStatus(status) {
  const value = cleanToken(status || "").toLowerCase();
  return ["ready", "running", "done", "warning", "blocked"].includes(value) ? value : "";
}

function statusLabel(status) {
  return {
    ready: "Ready",
    running: "Running",
    done: "Done",
    warning: "Warning",
    blocked: "Blocked",
  }[status] || "Ready";
}

function footerEl(text) {
  const footer = document.createElement("div");
  footer.className = "codexpp-chat-ui-footer";
  footer.textContent = text;
  return footer;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function insertIntoComposer(text) {
  const value = cleanText(text || "", 2_000);
  if (!value) return;

  const textarea = document.querySelector("textarea");
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus();
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return;
  }

  const editable = document.querySelector('[contenteditable="true"]');
  if (editable instanceof HTMLElement) {
    editable.focus();
    editable.innerText = value;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return;
  }

  navigator.clipboard?.writeText(value).catch(() => {});
}

function samplePayloadText() {
  return [
    "```json",
    JSON.stringify({
      codex_ui: true,
      version: 1,
      blocks: [
        {
          kind: "summary_card",
          id: "sample-summary",
          props: {
            title: "Codex Chat UI sample",
            subtitle: "This payload exercises every first-release block kind.",
            status: "ready",
            items: [
              { label: "Renderer", value: "Installed tweak" },
              { label: "Fallback", value: "Included" },
            ],
            actions: [
              {
                type: "copy_text",
                label: "Copy sample note",
                text: "Codex Chat UI sample payload rendered.",
              },
            ],
          },
          fallbackText: "Codex Chat UI sample summary is ready.",
        },
        {
          kind: "data_table",
          id: "sample-table",
          props: {
            title: "Sample table",
            status: "done",
            columns: ["Kind", "Purpose", "State"],
            rows: [
              ["summary_card", "Compact status", "ready"],
              ["data_table", "Small tabular data", "ready"],
              ["file_preview", "File tree", "ready"],
            ],
          },
          fallbackText: "Sample table: summary_card, data_table, and file_preview are ready.",
        },
        {
          kind: "file_preview",
          id: "sample-files",
          props: {
            title: "Sample file tree",
            status: "ready",
            files: [
              {
                name: "thomashulihan-codex-chat-ui",
                kind: "directory",
                path: "tweaks/base/thomashulihan-codex-chat-ui",
                children: [
                  { path: "index.js", description: "Renderer and settings" },
                  { path: "manifest.json", description: "Tweak metadata" },
                  { path: "test/chat-ui-static.test.js", description: "Static coverage" },
                ],
              },
            ],
          },
          fallbackText: "Sample file tree lists the Codex Chat UI tweak files.",
        },
      ],
    }, null, 2),
    "```",
  ].join("\n");
}

function hideSourceBlocks(blocks) {
  for (const block of blocks || []) {
    if (!(block instanceof HTMLElement)) continue;
    block.setAttribute(HIDDEN_ATTR, "true");
    block.hidden = true;
    block.style.setProperty("display", "none", "important");
  }
}

function showSourceBlocks(blocks) {
  for (const block of blocks || []) {
    if (!(block instanceof HTMLElement)) continue;
    block.hidden = false;
    block.removeAttribute(HIDDEN_ATTR);
    block.style.removeProperty("display");
  }
}

function showHiddenSourceBlocks(root) {
  if (!(root instanceof HTMLElement)) return;
  showSourceBlocks(root.querySelectorAll(`[${HIDDEN_ATTR}]`));
}

function clearPanels() {
  document.querySelectorAll(`[${PANEL_ATTR}]`).forEach((node) => node.remove());
  document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((node) => {
    node.hidden = false;
    node.removeAttribute(HIDDEN_ATTR);
    node.style.removeProperty("display");
  });
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

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .codexpp-chat-ui-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
      color: var(--foreground, #09090b);
      font-family: var(--font-sans, system-ui, sans-serif);
      font-size: 13px;
      line-height: 1.45;
    }

    .codexpp-chat-ui-card {
      width: min(100%, 720px);
      border: 1px solid var(--border, #d4d4d8);
      border-radius: min(var(--radius, 0.5rem), 8px);
      background: var(--card, #ffffff);
      color: var(--card-foreground, #09090b);
      box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06));
      padding: 12px;
    }

    .codexpp-chat-ui-mentioned-files {
      display: flex;
      flex-direction: column;
      margin: 14px 0 16px;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: min(var(--radius, 0.5rem), 8px);
      background: var(--card, #ffffff);
      box-shadow: var(--codexpp-shadcn-shadow, 0 1px 2px rgb(9 9 11 / 0.06));
      overflow: hidden;
    }

    .codexpp-chat-ui-mentioned-file-row {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 74px;
      border: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border, #d4d4d8) 80%, transparent);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 12px 18px;
      text-align: left;
    }

    .codexpp-chat-ui-mentioned-file-row:hover {
      background: var(--accent, #f4f4f5);
    }

    .codexpp-chat-ui-mentioned-file-row:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--ring, #18181b) 70%, transparent);
      outline-offset: -2px;
    }

    .codexpp-chat-ui-mentioned-file-icon {
      display: inline-flex;
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: 8px;
      background: var(--muted, #f4f4f5);
      color: var(--muted-foreground, #52525b);
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
    }

    .codexpp-chat-ui-mentioned-file-icon-csv,
    .codexpp-chat-ui-mentioned-file-icon-xlsx,
    .codexpp-chat-ui-mentioned-file-icon-xls {
      border-color: color-mix(in srgb, #15803d 30%, var(--border, #d4d4d8));
      background: #15803d;
      color: #ffffff;
    }

    .codexpp-chat-ui-mentioned-file-content {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 3px;
    }

    .codexpp-chat-ui-mentioned-file-name {
      color: var(--foreground, #09090b);
      font-size: 15px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-mentioned-file-meta {
      color: var(--muted-foreground, #52525b);
      font-size: 13px;
    }

    .codexpp-chat-ui-mentioned-file-action {
      border: 1px solid var(--border, #d4d4d8);
      border-radius: 8px;
      background: var(--background, #ffffff);
      color: var(--foreground, #09090b);
      font-size: 14px;
      padding: 7px 13px;
      white-space: nowrap;
    }

    .codexpp-chat-ui-mentioned-files-more {
      padding: 12px 18px;
      color: var(--muted-foreground, #52525b);
      font-size: 14px;
      text-align: center;
    }

    .codexpp-chat-ui-card-header {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
    }

    .codexpp-chat-ui-title-row {
      display: flex;
      min-width: 0;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .codexpp-chat-ui-title {
      min-width: 0;
      margin: 0;
      color: var(--card-foreground, #09090b);
      font-size: 14px;
      font-weight: 650;
      letter-spacing: 0;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-subtitle,
    .codexpp-chat-ui-footer,
    .codexpp-chat-ui-empty,
    .codexpp-chat-ui-fallback-body {
      margin: 0;
      color: var(--muted-foreground, #52525b);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-badge {
      flex: 0 0 auto;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: 999px;
      background: var(--muted, #f4f4f5);
      color: var(--muted-foreground, #52525b);
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 650;
      line-height: 1.25;
    }

    .codexpp-chat-ui-badge-done,
    .codexpp-chat-ui-badge-ready {
      background: color-mix(in srgb, var(--primary, #18181b) 8%, var(--card, #ffffff));
      color: var(--foreground, #09090b);
    }

    .codexpp-chat-ui-badge-running {
      background: color-mix(in srgb, var(--codexpp-shadcn-ui-accent, #1d4ed8) 12%, var(--card, #ffffff));
      color: var(--codexpp-shadcn-ui-accent, #1d4ed8);
    }

    .codexpp-chat-ui-badge-warning,
    .codexpp-chat-ui-badge-blocked {
      background: color-mix(in srgb, var(--destructive, #dc2626) 10%, var(--card, #ffffff));
      color: var(--destructive, #b91c1c);
    }

    .codexpp-chat-ui-kv-list {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
      margin: 10px 0 0;
      border-top: 1px solid var(--border, #d4d4d8);
    }

    .codexpp-chat-ui-kv-row {
      display: grid;
      grid-template-columns: minmax(88px, 0.35fr) minmax(0, 1fr);
      gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border, #d4d4d8) 64%, transparent);
    }

    .codexpp-chat-ui-kv-row dt,
    .codexpp-chat-ui-kv-row dd {
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-kv-row dt {
      color: var(--muted-foreground, #52525b);
      font-size: 12px;
    }

    .codexpp-chat-ui-kv-row dd {
      color: var(--foreground, #09090b);
      font-size: 12px;
      font-weight: 500;
    }

    .codexpp-chat-ui-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .codexpp-chat-ui-button,
    .codexpp-chat-ui-action-row-clickable {
      cursor: pointer;
    }

    .codexpp-chat-ui-button {
      border: 1px solid var(--border, #d4d4d8);
      border-radius: min(calc(var(--radius, 0.5rem) - 2px), 6px);
      background: var(--background, #ffffff);
      color: var(--foreground, #09090b);
      padding: 6px 10px;
      font: inherit;
      font-size: 12px;
      font-weight: 550;
    }

    .codexpp-chat-ui-button:hover:not(:disabled),
    .codexpp-chat-ui-action-row-clickable:hover {
      background: var(--accent, #f4f4f5);
      color: var(--accent-foreground, #18181b);
    }

    .codexpp-chat-ui-button:focus-visible,
    .codexpp-chat-ui-action-row-clickable:focus-visible {
      outline: 2px solid var(--ring, #18181b);
      outline-offset: 2px;
    }

    .codexpp-chat-ui-button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .codexpp-chat-ui-footer {
      margin-top: 10px;
      border-top: 1px solid var(--border, #d4d4d8);
      padding-top: 8px;
    }

    .codexpp-chat-ui-action-list,
    .codexpp-chat-ui-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 10px 0 0;
      padding: 0;
    }

    .codexpp-chat-ui-action-row {
      width: 100%;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      border: 0;
      border-radius: min(calc(var(--radius, 0.5rem) - 2px), 6px);
      background: transparent;
      color: inherit;
      font: inherit;
      padding: 6px;
      text-align: left;
    }

    .codexpp-chat-ui-action-number {
      color: var(--muted-foreground, #52525b);
      font-size: 12px;
    }

    .codexpp-chat-ui-action-content,
    .codexpp-chat-ui-step-content {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    .codexpp-chat-ui-action-label,
    .codexpp-chat-ui-step-label {
      color: var(--foreground, #09090b);
      font-size: 12px;
      font-weight: 550;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-action-description,
    .codexpp-chat-ui-step-description {
      color: var(--muted-foreground, #52525b);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-progress-wrap {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 10px;
    }

    .codexpp-chat-ui-progress-meta {
      color: var(--muted-foreground, #52525b);
      font-size: 12px;
      text-align: right;
    }

    .codexpp-chat-ui-progress-track {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--muted, #f4f4f5);
    }

    .codexpp-chat-ui-progress-fill {
      height: 100%;
      border-radius: inherit;
      background: var(--primary, #18181b);
      transition: width 160ms ease;
    }

    .codexpp-chat-ui-steps {
      list-style: none;
    }

    .codexpp-chat-ui-step {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 9px;
      align-items: start;
    }

    .codexpp-chat-ui-step-marker {
      width: 9px;
      height: 9px;
      margin-top: 4px;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: 999px;
      background: var(--background, #ffffff);
    }

    .codexpp-chat-ui-step-done {
      background: var(--primary, #18181b);
      border-color: var(--primary, #18181b);
    }

    .codexpp-chat-ui-step-running {
      background: var(--codexpp-shadcn-ui-accent, #1d4ed8);
      border-color: var(--codexpp-shadcn-ui-accent, #1d4ed8);
    }

    .codexpp-chat-ui-step-warning,
    .codexpp-chat-ui-step-blocked {
      background: var(--destructive, #dc2626);
      border-color: var(--destructive, #dc2626);
    }

    .codexpp-chat-ui-table-scroll {
      max-width: 100%;
      margin-top: 10px;
      overflow-x: auto;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: min(calc(var(--radius, 0.5rem) - 2px), 6px);
    }

    .codexpp-chat-ui-table {
      width: 100%;
      min-width: 420px;
      border-collapse: collapse;
      font-size: 12px;
    }

    .codexpp-chat-ui-table th,
    .codexpp-chat-ui-table td {
      min-width: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border, #d4d4d8) 72%, transparent);
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-table th {
      background: var(--muted, #f4f4f5);
      color: var(--muted-foreground, #52525b);
      font-weight: 650;
    }

    .codexpp-chat-ui-table tr:last-child td {
      border-bottom: 0;
    }

    .codexpp-chat-ui-file-tree {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 10px;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: min(calc(var(--radius, 0.5rem) - 2px), 6px);
      padding: 5px;
    }

    .codexpp-chat-ui-file-row-wrap {
      min-width: 0;
    }

    .codexpp-chat-ui-file-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 6px;
      border-radius: min(calc(var(--radius, 0.5rem) - 3px), 5px);
    }

    .codexpp-chat-ui-file-row:hover {
      background: var(--accent, #f4f4f5);
    }

    .codexpp-chat-ui-file-row-clickable {
      cursor: pointer;
    }

    .codexpp-chat-ui-file-row-clickable:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--ring, #18181b) 70%, transparent);
      outline-offset: 2px;
    }

    .codexpp-chat-ui-file-icon {
      display: inline-flex;
      min-width: 34px;
      justify-content: center;
      border: 1px solid var(--border, #d4d4d8);
      border-radius: 6px;
      background: color-mix(in srgb, var(--muted, #f4f4f5) 70%, var(--card, #ffffff));
      color: var(--muted-foreground, #52525b);
      font-size: 10px;
      font-weight: 650;
      line-height: 1.5;
      text-transform: uppercase;
    }

    .codexpp-chat-ui-file-icon-directory {
      border-color: color-mix(in srgb, var(--codexpp-shadcn-ui-accent, #1d4ed8) 22%, var(--border, #d4d4d8));
      background: color-mix(in srgb, var(--codexpp-shadcn-ui-accent, #1d4ed8) 8%, var(--card, #ffffff));
      color: var(--codexpp-shadcn-ui-accent, #1d4ed8);
    }

    .codexpp-chat-ui-file-icon-typed {
      color: var(--foreground, #09090b);
    }

    .codexpp-chat-ui-file-ext-ts,
    .codexpp-chat-ui-file-ext-tsx {
      border-color: color-mix(in srgb, #2563eb 26%, var(--border, #d4d4d8));
      background: color-mix(in srgb, #2563eb 10%, var(--card, #ffffff));
      color: #1d4ed8;
    }

    .codexpp-chat-ui-file-ext-js,
    .codexpp-chat-ui-file-ext-jsx {
      border-color: color-mix(in srgb, #ca8a04 28%, var(--border, #d4d4d8));
      background: color-mix(in srgb, #ca8a04 12%, var(--card, #ffffff));
      color: #854d0e;
    }

    .codexpp-chat-ui-file-ext-json,
    .codexpp-chat-ui-file-ext-yml,
    .codexpp-chat-ui-file-ext-yaml,
    .codexpp-chat-ui-file-ext-toml,
    .codexpp-chat-ui-file-ext-lock {
      border-color: color-mix(in srgb, #64748b 24%, var(--border, #d4d4d8));
      background: color-mix(in srgb, #64748b 10%, var(--card, #ffffff));
      color: #475569;
    }

    .codexpp-chat-ui-file-ext-md {
      border-color: color-mix(in srgb, #7c3aed 24%, var(--border, #d4d4d8));
      background: color-mix(in srgb, #7c3aed 9%, var(--card, #ffffff));
      color: #6d28d9;
    }

    .codexpp-chat-ui-file-ext-css,
    .codexpp-chat-ui-file-ext-html {
      border-color: color-mix(in srgb, #0891b2 24%, var(--border, #d4d4d8));
      background: color-mix(in srgb, #0891b2 10%, var(--card, #ffffff));
      color: #0e7490;
    }

    .codexpp-chat-ui-file-status-icon {
      display: inline-flex;
      min-width: 22px;
      justify-content: center;
      border-radius: 999px;
      background: var(--muted, #f4f4f5);
      color: var(--muted-foreground, #52525b);
      font-size: 10px;
      font-weight: 700;
      line-height: 1.6;
    }

    .codexpp-chat-ui-file-status-done,
    .codexpp-chat-ui-file-status-ready {
      background: color-mix(in srgb, var(--primary, #18181b) 8%, var(--card, #ffffff));
      color: var(--foreground, #09090b);
    }

    .codexpp-chat-ui-file-status-running {
      background: color-mix(in srgb, var(--codexpp-shadcn-ui-accent, #1d4ed8) 12%, var(--card, #ffffff));
      color: var(--codexpp-shadcn-ui-accent, #1d4ed8);
    }

    .codexpp-chat-ui-file-status-warning,
    .codexpp-chat-ui-file-status-blocked {
      background: color-mix(in srgb, var(--destructive, #dc2626) 10%, var(--card, #ffffff));
      color: var(--destructive, #b91c1c);
    }

    .codexpp-chat-ui-file-content {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 1px;
    }

    .codexpp-chat-ui-file-name {
      color: var(--foreground, #09090b);
      font-size: 12px;
      font-weight: 550;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-file-meta {
      color: var(--muted-foreground, #52525b);
      font-size: 11px;
      overflow-wrap: anywhere;
    }

    .codexpp-chat-ui-file-copy {
      border: 1px solid var(--border, #d4d4d8);
      border-radius: min(calc(var(--radius, 0.5rem) - 3px), 5px);
      background: var(--background, #ffffff);
      color: var(--muted-foreground, #52525b);
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      padding: 3px 6px;
    }

    .codexpp-chat-ui-file-copy:hover {
      background: var(--muted, #f4f4f5);
      color: var(--foreground, #09090b);
    }

    .codexpp-chat-ui-file-children {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .codexpp-chat-ui-fallback {
      background: color-mix(in srgb, var(--muted, #f4f4f5) 54%, var(--card, #ffffff));
    }

    @media (max-width: 640px) {
      .codexpp-chat-ui-card {
        width: 100%;
      }

      .codexpp-chat-ui-kv-row {
        grid-template-columns: 1fr;
        gap: 2px;
      }
    }
  `;
  document.head.appendChild(style);
}

function renderSettings(root, state) {
  root.textContent = "";
  root.appendChild(settingsSection("Behavior", [
    toggleRow({
      label: "Enable Codex Chat UI",
      description: "Render structured Codex UI payloads under assistant messages.",
      checked: state.enabled,
      onChange: (checked) => {
        state.enabled = checked;
        state.api.storage.set("enabled", checked);
        if (checked) state.scheduleScan?.();
        else clearPanels();
      },
    }),
    toggleRow({
      label: "Clickable actions",
      description: "Allow safe buttons to insert prompts, copy text, or toggle local details.",
      checked: state.clickableActions,
      onChange: (checked) => {
        state.clickableActions = checked;
        state.api.storage.set("clickableActions", checked);
        state.scheduleScan?.();
      },
    }),
    toggleRow({
      label: "Fallback panels",
      description: "Show plain fallback text for disabled or unsupported UI blocks.",
      checked: state.showFallbacks,
      onChange: (checked) => {
        state.showFallbacks = checked;
        state.api.storage.set("showFallbacks", checked);
        state.scheduleScan?.();
      },
    }),
  ]));

  root.appendChild(settingsSection("Block kinds", SUPPORTED_BLOCK_KINDS.map((kind) => toggleRow({
    label: blockKindLabel(kind),
    description: blockKindDescription(kind),
    checked: state.blockKinds[kind] !== false,
    onChange: (checked) => {
      state.blockKinds[kind] = checked;
      state.api.storage.set(kind, checked);
      state.scheduleScan?.();
    },
  }))));

  root.appendChild(settingsSection("Contract", [
    infoRow({
      label: "Payload marker",
      description: "Assistant messages can include fenced JSON with codex_ui: true, version: 1, and a blocks array.",
    }),
    infoRow({
      label: "Safety boundary",
      description: "UI actions cannot run commands or call APIs directly. Mutating work must stay in normal Codex chat and approval flows.",
    }),
    actionRow({
      label: "Sample payload",
      description: "Insert a sample codex_ui payload into the composer so the next assistant message can render all block kinds.",
      button: "Insert sample",
      onClick: () => {
        insertIntoComposer(samplePayloadText());
        setStatus(state, "Sample payload inserted into the composer.");
      },
      statusRef: () => {},
    }),
    actionRow({
      label: "React fiber probe",
      description: "Inspect the latest visible native message node and copy a safe summary of its React owner props.",
      button: "Probe message",
      onClick: () => probeNativeMessageFiber(state),
      statusRef: (el) => {
        state.probeEl = el;
      },
    }),
    actionRow({
      label: "Reload installed tweaks",
      description: "Reloads installed tweaks from disk, then refreshes this window so runtime copies take effect.",
      button: "Reload tweaks",
      onClick: () => reloadInstalledTweaks(state),
      statusRef: (el) => {
        state.statusEl = el;
      },
    }),
  ]));
}

function settingsSection(title, rows) {
  const section = document.createElement("section");
  section.className = "mb-4 flex flex-col gap-2";
  const heading = document.createElement("div");
  heading.className = "px-1 text-sm font-medium text-token-text-primary";
  heading.textContent = title;
  section.appendChild(heading);
  const card = document.createElement("div");
  card.className = "divide-y divide-token-border-light rounded-xl border border-token-border-light bg-token-bg-primary";
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
  left.append(title, desc);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.className = "h-4 w-4";
  input.addEventListener("change", () => onChange(input.checked));

  row.append(left, input);
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
  desc.textContent = description;
  row.append(title, desc);
  return row;
}

function actionRow({ label, description, button, onClick, statusRef }) {
  const row = document.createElement("div");
  row.className = "flex flex-wrap items-center justify-between gap-3 p-3";
  const left = document.createElement("div");
  left.className = "flex min-w-0 flex-col gap-1";
  const title = document.createElement("div");
  title.className = "text-sm text-token-text-primary";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "text-sm text-token-text-secondary";
  desc.textContent = description;
  const status = document.createElement("div");
  status.className = "min-h-5 text-sm text-token-text-secondary";
  statusRef(status);
  left.append(title, desc, status);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "rounded-lg border border-token-border-light bg-token-bg-secondary px-3 py-2 text-sm text-token-text-primary hover:bg-token-bg-tertiary";
  action.textContent = button;
  action.addEventListener("click", onClick);

  row.append(left, action);
  return row;
}

async function reloadInstalledTweaks(state) {
  if (!state.api.ipc?.invoke) {
    setStatus(state, "Reload unavailable in this ShadGPT runtime.");
    return;
  }

  try {
    setStatus(state, "Reloading installed tweaks...");
    const result = await state.api.ipc.invoke(IPC_RELOAD_TWEAKS);
    if (!result?.ok) {
      setStatus(state, `Reload failed: ${result?.error || "unknown error"}`);
      return;
    }
    setStatus(state, "Installed tweaks reloaded. Refreshing window...");
    window.setTimeout(() => location.reload(), 650);
  } catch (error) {
    setStatus(state, `Reload failed: ${error?.message || String(error)}`);
  }
}

function setStatus(state, text) {
  if (!state.statusEl) return;
  state.statusEl.textContent = text || "";
}

function setProbeStatus(state, text) {
  if (!state.probeEl) return;
  state.probeEl.textContent = text || "";
}

function probeNativeMessageFiber(state) {
  const node = latestNativeMessageNode();
  if (!node) {
    setProbeStatus(state, "No native message node found in the current chat view.");
    return;
  }

  const reactApi = state.api.react;
  if (!reactApi?.getFiber) {
    setProbeStatus(state, "React fiber API is unavailable in this renderer.");
    return;
  }

  const fiber = reactApi.getFiber(node);
  if (!fiber) {
    setProbeStatus(state, "No React fiber found for the latest message node.");
    return;
  }

  const owners = summarizeFiberOwners(fiber);
  const summary = {
    messageSelector: "div.group.flex.min-w-0.flex-col",
    nodeTextSample: cleanText(node.textContent || "", 180),
    owners,
  };
  const text = JSON.stringify(summary, null, 2);
  navigator.clipboard?.writeText(text).catch(() => {});
  setProbeStatus(state, `Copied ${owners.length} owner frame${owners.length === 1 ? "" : "s"} to clipboard.`);
}

function latestNativeMessageNode() {
  const nodes = Array.from(document.querySelectorAll("div.group.flex.min-w-0.flex-col"));
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node instanceof HTMLElement && !node.hasAttribute(PANEL_ATTR)) return node;
  }
  return null;
}

function summarizeFiberOwners(fiber) {
  const owners = [];
  let current = fiber;
  while (current && owners.length < 12) {
    owners.push({
      name: fiberName(current),
      propKeys: safeKeys(current.memoizedProps),
      stateType: current.memoizedState === null ? "null" : Array.isArray(current.memoizedState) ? "array" : typeof current.memoizedState,
    });
    current = current.return;
  }
  return owners;
}

function fiberName(fiber) {
  const type = fiber?.type;
  if (typeof type === "string") return type;
  if (typeof type === "function") return type.displayName || type.name || "anonymous";
  if (type && typeof type === "object") return type.displayName || type.name || type.$$typeof?.toString?.() || "object";
  return typeof type;
}

function safeKeys(value) {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).slice(0, 24);
}

function blockKindLabel(kind) {
  return {
    summary_card: "Summary card",
    action_list: "Action list",
    progress_panel: "Progress panel",
    data_table: "Data table",
    file_preview: "File preview",
  }[kind] || kind;
}

function blockKindDescription(kind) {
  return {
    summary_card: "Compact status, key facts, footer, and safe action buttons.",
    action_list: "Suggested next actions that can insert prompts into the composer.",
    progress_panel: "Progress bar plus step state for longer-running work.",
    data_table: "Small readable tables with horizontal scrolling for narrow chats.",
    file_preview: "File tree previews with safe copy-path actions.",
  }[kind] || "Render this Codex UI block kind.";
}
