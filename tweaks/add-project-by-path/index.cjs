const IPC_VALIDATE_PATH = "validate-project-path";
const STATE_KEY = "__codexppAddProjectByPath";
const MAIN_HANDLER_KEY = "__codexppAddProjectByPathMainHandler";
const INJECTED_ATTR = "data-codexpp-add-project-by-path";
const STYLE_ID = "codexpp-add-project-by-path-style";

let nodeModules = null;

/** @type {import("@codex-plusplus/sdk").Tweak} */
module.exports = {
  start(api) {
    if (api.process === "main") {
      startMain(api);
      return;
    }
    startRenderer.call(this, api);
  },

  stop() {
    const state = this._state || globalThis[STATE_KEY];
    if (!state) return;
    cleanupRenderer(state);
    this._state = null;
  },
};

function startMain(api) {
  if (!globalThis[MAIN_HANDLER_KEY]) {
    api.ipc.handle(IPC_VALIDATE_PATH, (rawPath) => validateProjectPath(rawPath));
    globalThis[MAIN_HANDLER_KEY] = true;
  }
  api.log.info("[add-project-by-path] main validation handler active");
}

function validateProjectPath(rawPath) {
  const { fs, path } = getNodeModules();
  const cleaned = cleanProjectPathInput(rawPath);
  const expanded = expandPath(cleaned);
  if (!expanded) return { ok: false, error: "Enter a project path." };
  if (!path.isAbsolute(expanded)) return { ok: false, error: "Use an absolute path." };

  const resolved = path.resolve(expanded);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { ok: false, error: statErrorMessage(error, "read") };
    }

    try {
      fs.mkdirSync(resolved, { recursive: true });
      stat = fs.statSync(resolved);
    } catch (createError) {
      return { ok: false, error: statErrorMessage(createError, "create") };
    }
  }

  if (!stat.isDirectory()) {
    return { ok: false, error: "A file already exists at that path." };
  }

  return { ok: true, path: resolved };
}

function expandPath(value) {
  const { os, path } = getNodeModules();
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function statErrorMessage(error, action) {
  switch (error?.code) {
    case "EACCES":
    case "EPERM":
      return action === "create"
        ? "Codex does not have permission to create that folder."
        : "Codex does not have permission to read that folder.";
    case "ENOTDIR":
      return "Part of that path is a file, not a folder.";
    case "EROFS":
      return "That location is read-only.";
    case "ELOOP":
      return "That path contains a broken or circular symlink.";
    case "ENAMETOOLONG":
      return "That path is too long.";
    default:
      return action === "create"
        ? "Could not create that folder."
        : "Could not read that folder.";
  }
}

function cleanProjectPathInput(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";

  raw = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  raw = stripCommandPrefix(raw);
  raw = stripWrappingQuotes(raw);

  if (/^file:\/\//i.test(raw)) {
    raw = fileUrlToPath(raw);
  }

  raw = raw.replace(/\\ /g, " ");
  raw = raw.replace(/\\([()&;'"$`!])/g, "$1");
  raw = stripCommandTail(raw);
  return stripWrappingQuotes(raw).trim();
}

function stripCommandPrefix(value) {
  let raw = value.trim();
  raw = raw.replace(/^open\s+(?:-a\s+\S+\s+)?/i, "");
  raw = raw.replace(/^code\s+/i, "");
  raw = raw.replace(/^cd\s+/i, "");
  return raw.trim();
}

function stripWrappingQuotes(value) {
  let raw = value.trim();
  while (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function stripCommandTail(value) {
  const raw = value.trim();
  let quote = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if ((char === "'" || char === '"') && raw[index - 1] !== "\\") {
      quote = quote === char ? "" : quote || char;
      continue;
    }
    if (quote) continue;

    const rest = raw.slice(index);
    if (rest.startsWith(" && ") || rest.startsWith(" || ") || rest.startsWith(";")) {
      return raw.slice(0, index).trim();
    }
  }
  return raw.replace(/\s*(?:&&|\|\||;)\s*$/g, "").trim();
}

function fileUrlToPath(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return value;
    return decodeURIComponent(url.pathname || "");
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

function getNodeModules() {
  if (nodeModules) return nodeModules;
  nodeModules = {
    fs: require("node:fs"),
    os: require("node:os"),
    path: require("node:path"),
  };
  return nodeModules;
}

function startRenderer(api) {
  cleanupRenderer(globalThis[STATE_KEY]);

  const state = {
    api,
    observer: null,
    disposed: false,
    modal: null,
    lastPath: "",
  };

  this._state = state;
  globalThis[STATE_KEY] = state;

  installStyles();
  scanForProjectMenus(state);

  state.observer = new MutationObserver(() => scanForProjectMenus(state));
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
  api.log.info("[add-project-by-path] renderer menu hook active");
}

function cleanupRenderer(state) {
  if (!state) return;
  state.disposed = true;
  state.observer?.disconnect();
  state.observer = null;
  closeModal(state);

  for (const node of document.querySelectorAll(`[${INJECTED_ATTR}]`)) {
    node.remove();
  }
  document.getElementById(STYLE_ID)?.remove();

  if (globalThis[STATE_KEY] === state) globalThis[STATE_KEY] = null;
}

function scanForProjectMenus(state) {
  if (state.disposed) return;

  for (const existingItem of findActionItemsByText("Use an existing folder")) {
    const menu = findProjectMenuForItem(existingItem);
    if (menu.querySelector(`[${INJECTED_ATTR}]`)) continue;
    injectPathEntry(state, existingItem);
  }
}

function findActionItemsByText(text) {
  const wanted = compactText(text);
  const seen = new WeakSet();
  const matches = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (!(node instanceof HTMLElement)) continue;
    if (compactText(node.textContent) !== wanted) continue;

    const item = findActionItemRoot(node, wanted);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    matches.push(item);
  }
  return matches;
}

function findActionItemRoot(node, wantedText) {
  const interactive = node.closest("button,[role='menuitem'],[cmdk-item]");
  if (interactive instanceof HTMLElement && compactText(interactive.textContent) === wantedText) {
    return interactive;
  }

  let current = node;
  let best = node;
  while (current.parentElement && compactText(current.parentElement.textContent) === wantedText) {
    best = current.parentElement;
    current = current.parentElement;
  }
  return best instanceof HTMLElement ? best : null;
}

function findProjectMenuForItem(item) {
  let node = item.parentElement;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    const text = compactText(node.textContent);
    if (!text.includes("Start from scratch")) continue;
    if (!text.includes("Use an existing folder")) continue;
    if (text.includes("Enter project path")) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.width <= 900 && rect.height <= 480) {
      return node;
    }
  }
  return item.parentElement;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function injectPathEntry(state, referenceItem) {
  const row = buildMenuRow(referenceItem);
  row.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openModal(state);
  });

  row.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openModal(state);
  });

  referenceItem.insertAdjacentElement("afterend", row);
}

function buildMenuRow(referenceItem) {
  const row = referenceItem.cloneNode(true);
  if (row instanceof HTMLButtonElement) row.type = "button";
  if (!row.hasAttribute("role") && !(row instanceof HTMLButtonElement)) {
    row.setAttribute("role", "menuitem");
    row.tabIndex = 0;
  }
  row.setAttribute(INJECTED_ATTR, "true");
  row.removeAttribute("id");
  row.removeAttribute("aria-labelledby");
  row.removeAttribute("aria-describedby");
  row.setAttribute("aria-label", "Enter project path");

  replaceText(row, "Use an existing folder", "Enter project path");

  if (!/\bw-full\b/.test(row.className)) row.className += " w-full";
  if (!/\bcursor-interaction\b/.test(row.className)) row.className += " cursor-interaction";

  return row;
}

function replaceText(root, from, to) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.nodeValue.includes(from)) continue;
    node.nodeValue = node.nodeValue.replace(from, to);
    return true;
  }
  root.textContent = to;
  return false;
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .codexpp-path-entry-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: color-mix(in srgb, var(--color-token-bg-primary, #000) 34%, transparent);
    }
    .codexpp-path-entry-error {
      min-height: 20px;
    }
    .codexpp-path-entry-drop-active {
      box-shadow:
        0 0 0 1px var(--color-token-focus-border),
        0 0 0 6px color-mix(in srgb, var(--color-token-focus-border) 18%, transparent);
    }
  `;
  document.head.appendChild(style);
}

function openModal(state) {
  closeModal(state);

  const backdrop = document.createElement("div");
  backdrop.className = "codexpp-path-entry-backdrop";
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className =
    "codex-dialog relative z-50 w-[460px] max-w-[92vw] rounded-3xl bg-token-dropdown-background/90 text-token-foreground ring-[0.5px] ring-token-border shadow-lg backdrop-blur-xl outline-none";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "codexpp-path-entry-title");
  dialog.tabIndex = -1;

  const body = document.createElement("form");
  body.className = "flex flex-col gap-0 px-5 py-5 text-base leading-normal tracking-normal";

  const header = document.createElement("div");
  header.className = "flex w-full flex-col pt-3 first:pt-0";

  const headerInner = document.createElement("div");
  headerInner.className = "flex min-w-0 flex-1 flex-col gap-1 self-stretch";

  const title = document.createElement("div");
  title.id = "codexpp-path-entry-title";
  title.className = "heading-dialog min-w-0 font-semibold";
  title.textContent = "Add project by path";

  const copy = document.createElement("div");
  copy.className = "text-token-description-foreground text-sm leading-normal tracking-normal";
  copy.textContent = "Paste a path or drop a folder here to add it as the active project.";

  const field = document.createElement("label");
  field.className = "flex w-full flex-col gap-2 pt-4";

  const label = document.createElement("span");
  label.className = "text-sm font-medium text-token-text-primary";
  label.textContent = "Project path";

  const input = document.createElement("input");
  input.className =
    "border-token-border bg-token-foreground/5 text-token-text-primary h-token-button-composer rounded-md border px-3 text-sm outline-none placeholder:text-token-text-tertiary focus-visible:ring-2 focus-visible:ring-token-focus-border";
  input.placeholder = "/Users/adriendevoe/project";
  input.value = cleanProjectPathInput(state.lastPath || "");
  input.spellcheck = false;
  input.autocomplete = "off";

  const error = document.createElement("div");
  error.className = "codexpp-path-entry-error text-token-charts-red text-sm leading-5";
  error.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "flex w-full flex-col pt-3 first:pt-0";

  const actionsInner = document.createElement("div");
  actionsInner.className = "flex w-full items-center justify-end gap-3";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className =
    "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 whitespace-nowrap rounded-lg border bg-token-bg-fog px-4 py-1.5 text-base leading-[18px] text-token-button-tertiary-foreground focus:outline-none enabled:hover:bg-token-list-hover-background disabled:cursor-not-allowed disabled:opacity-40";
  cancel.textContent = "Cancel";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className =
    "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 whitespace-nowrap rounded-lg border bg-token-foreground px-4 py-1.5 text-base leading-[18px] text-token-dropdown-background focus:outline-none enabled:hover:bg-token-foreground/80 disabled:cursor-not-allowed disabled:opacity-40";
  submit.textContent = "Add";

  headerInner.append(title, copy);
  header.appendChild(headerInner);
  field.append(label, input, error);
  actionsInner.append(cancel, submit);
  actions.appendChild(actionsInner);
  body.append(header, field, actions);
  dialog.appendChild(body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  state.modal = { backdrop, input, error, submit };

  const onCancel = () => closeModal(state);
  const onBackdropPointerDown = (event) => {
    if (event.target === backdrop) closeModal(state);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") closeModal(state);
  };
  const onSubmit = async (event) => {
    event.preventDefault();
    await submitProjectPath(state);
  };
  const onPaste = (event) => {
    const text = event.clipboardData?.getData("text");
    if (!text) return;
    const cleaned = cleanProjectPathInput(text);
    if (!cleaned || cleaned === text) return;
    event.preventDefault();
    setInputPath(state, cleaned);
  };
  const onDragEnter = (event) => {
    if (!hasPathDrop(event)) return;
    event.preventDefault();
    dialog.classList.add("codexpp-path-entry-drop-active");
  };
  const onDragOver = (event) => {
    if (!hasPathDrop(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event) => {
    if (dialog.contains(event.relatedTarget)) return;
    dialog.classList.remove("codexpp-path-entry-drop-active");
  };
  const onDrop = (event) => {
    if (!hasPathDrop(event)) return;
    event.preventDefault();
    dialog.classList.remove("codexpp-path-entry-drop-active");

    const droppedPath = pathFromDrop(event);
    if (droppedPath) {
      setInputPath(state, droppedPath);
      return;
    }

    error.textContent = "Drop a folder, or paste its path.";
  };

  cancel.addEventListener("click", onCancel);
  backdrop.addEventListener("pointerdown", onBackdropPointerDown);
  body.addEventListener("submit", onSubmit);
  input.addEventListener("paste", onPaste);
  dialog.addEventListener("dragenter", onDragEnter);
  dialog.addEventListener("dragover", onDragOver);
  dialog.addEventListener("dragleave", onDragLeave);
  dialog.addEventListener("drop", onDrop);
  document.addEventListener("keydown", onKeyDown);

  state.modal.dispose = () => {
    cancel.removeEventListener("click", onCancel);
    backdrop.removeEventListener("pointerdown", onBackdropPointerDown);
    body.removeEventListener("submit", onSubmit);
    input.removeEventListener("paste", onPaste);
    dialog.removeEventListener("dragenter", onDragEnter);
    dialog.removeEventListener("dragover", onDragOver);
    dialog.removeEventListener("dragleave", onDragLeave);
    dialog.removeEventListener("drop", onDrop);
    document.removeEventListener("keydown", onKeyDown);
  };

  requestAnimationFrame(() => {
    dialog.focus();
    input.focus();
    input.select();
  });
}

function closeModal(state) {
  if (!state?.modal) return;
  state.modal.dispose?.();
  state.modal.backdrop.remove();
  state.modal = null;
}

function setInputPath(state, value) {
  const modal = state.modal;
  if (!modal) return;
  const cleaned = cleanProjectPathInput(value);
  modal.input.value = cleaned;
  modal.error.textContent = "";
  state.lastPath = cleaned;
  modal.input.focus();
  modal.input.select();
}

function hasPathDrop(event) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).some((type) =>
    ["Files", "text/uri-list", "text/plain"].includes(type),
  );
}

function pathFromDrop(event) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return "";

  const file = dataTransfer.files?.[0];
  if (file && window.electronBridge?.getPathForFile) {
    const filePath = window.electronBridge.getPathForFile(file);
    if (filePath) return cleanProjectPathInput(filePath);
  }

  const uri = dataTransfer.getData?.("text/uri-list");
  if (uri) return cleanProjectPathInput(uri.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || uri);

  const text = dataTransfer.getData?.("text/plain");
  return cleanProjectPathInput(text || "");
}

async function submitProjectPath(state) {
  const modal = state.modal;
  if (!modal) return;

  const rawPath = cleanProjectPathInput(modal.input.value);
  modal.input.value = rawPath;
  state.lastPath = rawPath;
  modal.error.textContent = "";
  modal.submit.disabled = true;
  modal.submit.textContent = "Adding...";

  try {
    const result = await state.api.ipc.invoke(IPC_VALIDATE_PATH, rawPath);
    if (!result?.ok) {
      modal.error.textContent = result?.error || "Could not use that path.";
      return;
    }

    const bridge = window.electronBridge;
    if (!bridge || typeof bridge.sendMessageFromView !== "function") {
      modal.error.textContent = "Codex workspace bridge is not ready.";
      return;
    }

    await bridge.sendMessageFromView({
      type: "electron-add-new-workspace-root-option",
      root: result.path,
    });
    closeModal(state);
  } catch (error) {
    state.api.log.warn("[add-project-by-path] failed to add project path", error);
    modal.error.textContent = "Could not add that project path.";
  } finally {
    if (state.modal === modal) {
      modal.submit.disabled = false;
      modal.submit.textContent = "Add";
    }
  }
}
