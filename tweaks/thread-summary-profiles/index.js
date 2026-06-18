const TWEAK_ID = "co.thomashulihan.thread-summary-profiles";
const PROJECTS_TWEAK_ID = "co.thomashulihan.projects";
const CHROME_TWEAK_ID = "co.thomashulihan.project-chrome-profile";
const IPC_GET_SUMMARY = "getThreadProfileSummary";
const IPC_OPEN_ACTION = "openThreadProfileAction";
const SECTION_ATTR = "data-codexpp-thread-summary-profiles";
const SECTION_SIGNATURE_ATTR = "data-codexpp-thread-summary-profiles-signature";
const OPEN_STATE_KEY = "profiles-section:open";
const ROW_ORDER = Object.freeze(["chrome", "supabase", "github", "google-drive", "gmail", "modal", "decodo", "railway"]);
const SUMMARY_CACHE_TTL_MS = 5000;
const MODAL_CLI_CACHE_TTL_MS = 60000;

let activeCleanup = [];
let summaryCache = new Map();
let modalCliCache = new Map();

module.exports = {
  start(api) {
    stopActiveCleanup();
    activeCleanup = [];
    if (api.process === "main") startMain(api, activeCleanup);
    if (api.process === "renderer") startRenderer(api, activeCleanup);
  },

  stop() {
    stopActiveCleanup();
  },

  __test: {
    SECTION_ATTR,
    OPEN_STATE_KEY,
    ROW_ORDER,
    SUMMARY_CACHE_TTL_MS,
    MODAL_CLI_CACHE_TTL_MS,
    getCachedThreadProfileSummary,
    buildThreadProfileSummary,
    resolveThreadSummaryContext,
    buildProfileRows,
    normalizeProfileRow,
    parseGithubRemote,
    parseSupabaseConfigToml,
    sanitizeAction,
    activeModalWorkspaceContextCached,
    inferRendererProjectContext,
    extractProjectPathFromVisibleText,
    injectProfilesSection,
    findThreadSummaryPanels,
    profileSectionSignature,
    shouldIgnoreProfileMutations,
    createProfilesSection,
    clearThreadProfileCaches,
  },
};

function stopActiveCleanup() {
  for (const cleanup of activeCleanup) {
    try {
      cleanup();
    } catch {}
  }
  activeCleanup = [];
}

function startMain(api, cleanup) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const childProcess = require("node:child_process");
  const home = os.homedir();
  const userRoot = userRootForPlatform(home, path);

  cleanup.push(api.ipc.handle(IPC_GET_SUMMARY, (input = {}) => getCachedThreadProfileSummary(input, {
    fs,
    os,
    path,
    childProcess,
    home,
    userRoot,
    env: process.env,
  })));
  cleanup.push(api.ipc.handle(IPC_OPEN_ACTION, (action) => openProfileAction(action, { childProcess })));
  cleanup.push(() => clearThreadProfileCaches());
}

function startRenderer(api, cleanup) {
  installStyles();

  let scheduled = false;
  let raf = 0;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      raf = 0;
      injectProfilesSection(document, api).catch((error) => {
        api.log?.warn?.("[thread-summary-profiles] renderer injection failed", error?.message || String(error));
      });
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(run);
    else setTimeout(run, 0);
  };

  schedule();
  const observer = new MutationObserver((mutations) => {
    if (shouldIgnoreProfileMutations(mutations)) return;
    schedule();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  cleanup.push(() => {
    observer.disconnect();
    if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    document.querySelectorAll(`[${SECTION_ATTR}="true"]`).forEach((node) => node.remove());
  });
}

function buildThreadProfileSummary(input = {}, options = {}) {
  return buildThreadProfileSummaryFromContext(resolveThreadSummaryContext(input, options), options);
}

function getCachedThreadProfileSummary(input = {}, options = {}) {
  const context = resolveThreadSummaryContext(input, options);
  const cache = options.summaryCache === false ? null : (options.summaryCache || summaryCache);
  const ttlMs = cacheTtlMs(options.summaryCacheTtlMs, SUMMARY_CACHE_TTL_MS);
  const now = currentTimeMs(options);
  const key = context.projectPath || "__unknown__";
  if (cache && ttlMs > 0 && !input.forceRefresh && !input.refresh) {
    const cached = cache.get(key);
    if (cached && now - cached.cachedAt <= ttlMs) {
      const summary = cloneSummary(cached.summary);
      if (context.projectName) summary.projectName = context.projectName;
      return summary;
    }
  }
  const summary = buildThreadProfileSummaryFromContext(context, options);
  if (cache && ttlMs > 0) cache.set(key, { cachedAt: now, summary: cloneSummary(summary) });
  return summary;
}

function resolveThreadSummaryContext(input = {}, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const rawProjectPath = resolveProjectPathInput(input, options);
  const normalizedProjectPath = normalizeProjectPath(rawProjectPath, { path, home, allowEmpty: true });
  const requestedPath = resolveStoredProjectPrefix(normalizedProjectPath, options) || normalizedProjectPath;
  const projectPath = requestedPath || inferCurrentWorkingDirectoryProjectPath(options) || inferSingleConfiguredProjectPath(options);
  const projectName = cleanText(input.projectName || (projectPath ? path.basename(projectPath) : ""), 120) || "Unknown project";
  return { projectPath, projectName };
}

function buildThreadProfileSummaryFromContext(context = {}, options = {}) {
  const projectPath = context.projectPath || "";
  const projectName = context.projectName || "Unknown project";
  return {
    projectPath,
    projectName,
    rows: buildProfileRows(projectPath, projectName, options),
  };
}

function buildProfileRows(projectPath, projectName, options = {}) {
  const rows = [
    chromeRow(projectPath, options),
    supabaseRow(projectPath, options),
    githubRow(projectPath, options),
    googleWorkspaceRow(projectPath, "google-drive", options),
    googleWorkspaceRow(projectPath, "gmail", options),
    modalRow(projectPath, options),
    decodoRow(projectPath, options),
    railwayRow(projectPath, options),
  ];
  return rows.map(normalizeProfileRow).filter((row) => row.state !== "unset");
}

function chromeRow(projectPath, options = {}) {
  const assignment = readChromeStorage(options).assignments[projectPath] || null;
  const preferred = normalizeChromePreferredProfiles(assignment);
  const primary = preferred[0] || {};
  if (!assignment) {
    return baseRow("chrome", "Chrome", "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  const value = cleanText(primary.profileName || assignment.profileName || primary.profileDirectory || assignment.profileDirectory || "Set", 120);
  const detail = cleanText(primary.profileDirectory || assignment.profileDirectory || "", 120);
  return baseRow("chrome", "Chrome", value, {
    detail,
    state: "set",
    status: freshness("Assigned locally", assignment.updatedAt),
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function supabaseRow(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const configPath = projectPath ? path.join(projectPath, ".codex", "config.toml") : "";
  let binding = null;
  try {
    binding = parseSupabaseConfigToml(fs.readFileSync(configPath, "utf8"));
  } catch {}
  if (!binding?.projectRef) {
    return baseRow("supabase", "Supabase", "No project", {
      state: "unset",
      status: "Status unknown",
      action: fileAction(configPath || ".codex/config.toml"),
    });
  }
  return baseRow("supabase", "Supabase", binding.projectRef, {
    detail: binding.features.length ? binding.features.join(", ") : ".codex/config.toml",
    state: "set",
    status: "Config detected",
    freshness: configPath,
    action: fileAction(configPath),
  });
}

function githubRow(projectPath, options = {}) {
  const repo = gitRepositoriesForProject(projectPath, options)[0] || null;
  if (!repo) {
    return baseRow("github", "GitHub", "No repo detected", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  return baseRow("github", "GitHub", repo.fullName, {
    detail: repo.remotes.join(", ") || "remote",
    state: "set",
    status: "Remote detected",
    href: repo.url,
    action: externalAction(repo.url),
  });
}

function googleWorkspaceRow(projectPath, service, options = {}) {
  const storage = readProjectsStorage(options);
  const assignment = storage.googleWorkspaceAssignments?.[projectPath]?.[service] || null;
  const label = service === "gmail" ? "Gmail" : "Google Drive";
  if (!assignment) {
    return baseRow(service, label, "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  return baseRow(service, label, assignment.email || assignment.accountName || "Set", {
    detail: assignment.source ? `Source: ${assignment.source}` : "",
    state: "set",
    status: freshness("Project default", assignment.updatedAt),
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function modalRow(projectPath, options = {}) {
  const storage = readProjectsStorage(options);
  const assignment = storage.modalWorkspaceAssignments?.[projectPath] || null;
  if (!assignment) {
    return baseRow("modal", "Modal", "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  const cliContext = activeModalWorkspaceContextCached(projectPath, options);
  const conflict = modalWorkspaceConflict(assignment, cliContext);
  const value = assignment.workspace || assignment.accountName || assignment.profile || "Set";
  const checked = modalCliCheckedSuffix(cliContext);
  let detail = checked ? `Active CLI unavailable${checked}` : "Active CLI unavailable";
  let status = assignment.updatedAt ? `Assigned ${shortDate(assignment.updatedAt)}` : "Assigned locally";
  let state = "set";
  if (conflict) {
    detail = `Active CLI: ${conflict.activeProfile} / ${conflict.activeWorkspace}${checked}`;
    status = "CLI conflict";
    state = "warning";
  } else if (cliContext.profile || cliContext.workspace) {
    detail = assignment.profile ? `Profile ${assignment.profile}${checked}` : `Active CLI matches${checked}`;
    status = "CLI checked";
  } else if (assignment.profile) {
    detail = `Profile ${assignment.profile}`;
  }
  return baseRow("modal", "Modal", value, {
    detail,
    state,
    status,
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function decodoRow(projectPath, options = {}) {
  const storage = readProjectsStorage(options);
  const assignment = storage.decodoAssignments?.[projectPath] || null;
  if (!assignment) {
    return baseRow("decodo", "Decodo", "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  return baseRow("decodo", "Decodo", assignment.accountName || assignment.username || "Set", {
    detail: assignment.username || "",
    state: "set",
    status: freshness("Project default", assignment.updatedAt),
    freshness: assignment.updatedAt || "",
    action: settingsAction("projects"),
  });
}

function railwayRow(projectPath, options = {}) {
  const config = readRailwayProjectConfig(projectPath, options);
  if (!config) {
    return baseRow("railway", "Railway", "Unset", {
      state: "unset",
      status: "Status unknown",
      action: settingsAction("projects"),
    });
  }
  return baseRow("railway", "Railway", config.projectName || config.projectId || "Project linked", {
    detail: config.environmentName || config.environmentId || config.source,
    state: "set",
    status: "Project config detected",
    freshness: config.source,
    action: fileAction(config.filePath),
  });
}

function readRailwayProjectConfig(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  if (!projectPath) return null;
  for (const rel of [".railway/project.json", ".railway/environment.json", "railway.json"]) {
    const filePath = path.join(projectPath, rel);
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseJsonObject(raw);
    if (!parsed) continue;
    return {
      projectId: cleanText(parsed.projectId || parsed.project_id || parsed.id || "", 120),
      projectName: cleanText(parsed.projectName || parsed.project_name || parsed.name || "", 120),
      environmentId: cleanText(parsed.environmentId || parsed.environment_id || "", 120),
      environmentName: cleanText(parsed.environmentName || parsed.environment_name || "", 120),
      source: rel,
      filePath,
    };
  }
  return null;
}

function baseRow(id, label, value, extra = {}) {
  return { id, label, value, detail: "", status: "Status unknown", freshness: "", href: "", state: "unset", action: null, ...extra };
}

function normalizeProfileRow(row) {
  const id = ROW_ORDER.includes(row?.id) ? row.id : "chrome";
  const state = ["set", "unset", "warning", "error"].includes(row?.state) ? row.state : "unset";
  return {
    id,
    label: cleanText(row?.label || id, 80),
    value: cleanText(row?.value || "Unset", 160),
    detail: cleanText(row?.detail || "", 200),
    status: cleanText(row?.status || "Status unknown", 160),
    freshness: cleanText(row?.freshness || "", 240),
    href: safeExternalUrl(row?.href || ""),
    state,
    action: sanitizeAction(row?.action),
  };
}

async function injectProfilesSection(rootDocument, api) {
  const panels = findThreadSummaryPanels(rootDocument);
  pruneOrphanProfilesSections(rootDocument, panels);
  if (!panels.length) return 0;
  const context = inferRendererProjectContext(rootDocument, panels);
  let summary = null;
  try {
    summary = await api.ipc.invoke(IPC_GET_SUMMARY, context);
  } catch {
    // Renderer fallback: buildProfileRows reads local storage via require("node:fs"),
    // which is undefined in the browser context and threw "require is not defined",
    // aborting every injection. The renderer can't read files anyway — degrade to
    // empty rows (the panel is removed when rows.length === 0).
    summary = { projectPath: context.projectPath || "", projectName: context.projectName || "", rows: [] };
  }
  const rows = Array.isArray(summary.rows) ? summary.rows.map(normalizeProfileRow).filter((row) => row.state !== "unset") : [];
  let count = 0;
  for (const panel of panels) {
    const template = findSidePanelSectionTemplate(panel);
    if (!template && hasNativeSidePanelSections(panel)) {
      panel.querySelector(`[${SECTION_ATTR}="true"]`)?.remove();
      continue;
    }
    const signature = profileSectionSignature(summary, rows, template);
    const existing = panel.querySelector(`[${SECTION_ATTR}="true"]`);
    if (existing?.getAttribute(SECTION_SIGNATURE_ATTR) === signature) {
      count += 1;
      continue;
    }
    const next = createProfilesSection(summary, {
      template,
      storage: api.storage,
      onAction: (action) => handleRendererAction(api, action),
    });
    next.setAttribute(SECTION_SIGNATURE_ATTR, signature);
    if (existing) existing.remove();
    insertProfilesSection(panel, next, template);
    count += 1;
  }
  return count;
}

function profileSectionSignature(summary = {}, rows = [], template = null) {
  const templateShape = template
    ? {
        mode: template.mode || "native",
        heading: template.heading || "",
        hasTrigger: Boolean(template.trigger),
        hasContent: Boolean(template.content),
        hasRow: Boolean(template.row),
      }
    : { mode: "fallback", heading: "", hasTrigger: false, hasContent: false, hasRow: false };
  return JSON.stringify({
    projectPath: cleanText(summary.projectPath || "", 240),
    projectName: cleanText(summary.projectName || "", 120),
    template: templateShape,
    rows: rows.map((row) => ({
      id: row.id,
      label: row.label,
      value: row.value,
      detail: row.detail,
      status: row.status,
      freshness: row.freshness,
      href: row.href,
      state: row.state,
      action: row.action,
    })),
  });
}

function shouldIgnoreProfileMutations(mutations = []) {
  const list = Array.from(mutations || []);
  return list.length > 0 && list.every((mutation) => {
    if (isProfileSectionOwnedNode(mutation.target)) return true;
    const changed = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
    return changed.length > 0 && changed.every(isProfileSectionOwnedNode);
  });
}

function isProfileSectionOwnedNode(node) {
  if (!isElement(node)) return false;
  for (let current = node; isElement(current); current = current.parentElement) {
    if (current.getAttribute?.(SECTION_ATTR) === "true" || current.hasAttribute?.(SECTION_ATTR)) return true;
  }
  return false;
}

function pruneOrphanProfilesSections(rootDocument, panels) {
  const activePanels = new Set(panels || []);
  rootDocument.querySelectorAll(`[${SECTION_ATTR}="true"]`).forEach((node) => {
    if (![...activePanels].some((panel) => panel.contains(node))) node.remove();
  });
}

function findThreadSummaryPanels(rootDocument = document) {
  const candidates = Array.from(rootDocument.querySelectorAll("aside, section, div")).filter((node) => {
    if (!isElement(node) || node.hasAttribute(SECTION_ATTR)) return false;
    if (isEditableTree(node)) return false;
    const text = normalizeVisibleText(node.textContent);
    if (!text || text.length > 2000) return false;
    const headings = ["environment", "sources", "progress", "subagents"].filter((heading) => text.includes(heading));
    return headings.length >= 2;
  });
  return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
}

function insertProfilesSection(panel, section, template = null) {
  const anchor = findProfilesInsertionAnchor(panel, template);
  if (anchor?.parentElement) {
    insertAfter(anchor.parentElement, section, anchor);
    return;
  }
  const sections = Array.from(panel.children || []).filter(isElement);
  const progress = sections.find((node) => normalizeVisibleText(node.textContent).startsWith("progress"));
  if (progress?.parentElement === panel) panel.insertBefore(section, progress);
  else panel.appendChild(section);
}

function findProfilesInsertionAnchor(panel, template = null) {
  const sources = findSidePanelSectionByHeading(panel, "sources", { interactiveOnly: false });
  if (sources?.parentElement) return sources;
  if (template?.section?.parentElement) return template.section;
  return null;
}

function insertAfter(parent, node, anchor) {
  const children = Array.from(parent?.children || []);
  const index = children.indexOf(anchor);
  if (index < 0 || index === children.length - 1) parent.appendChild(node);
  else parent.insertBefore(node, children[index + 1]);
}

function createProfilesSection(summary = {}, options = {}) {
  const rows = Array.isArray(summary.rows) ? summary.rows.map(normalizeProfileRow).filter((row) => row.state !== "unset") : [];
  if (options.template?.mode === "static") return createStaticProfilesSection(rows, options);
  if (options.template) return createNativeProfilesSection(rows, options);

  const section = document.createElement("section");
  section.setAttribute(SECTION_ATTR, "true");
  section.className = "codexpp-thread-summary-profiles codexpp-thread-summary-profiles--fallback";

  const details = document.createElement("details");
  details.className = "codexpp-thread-summary-profiles__details";
  details.open = readProfilesOpenState(options.storage, true);

  const summaryNode = document.createElement("summary");
  summaryNode.className = "codexpp-thread-summary-profiles__summary";
  const title = document.createElement("span");
  title.className = "codexpp-thread-summary-profiles__title";
  title.textContent = "Profiles";
  const collapsedSummary = document.createElement("span");
  collapsedSummary.className = "codexpp-thread-summary-profiles__collapsed-summary";
  collapsedSummary.textContent = profileCollapsedSummary(rows);
  collapsedSummary.hidden = details.open;
  const chevron = document.createElement("span");
  chevron.className = "codexpp-thread-summary-profiles__chevron";
  chevron.setAttribute("aria-hidden", "true");
  summaryNode.append(title, collapsedSummary, chevron);
  details.appendChild(summaryNode);
  details.addEventListener?.("toggle", () => {
    writeProfilesOpenState(options.storage, details.open);
    collapsedSummary.hidden = details.open;
  });

  const body = document.createElement("div");
  body.className = "codexpp-thread-summary-profiles__content";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "codexpp-thread-summary-profiles__empty";
    empty.hidden = true;
    empty.textContent = "No profiles connected";
    body.appendChild(empty);
  }
  for (const row of rows) body.appendChild(createProfileRow(row, options));
  details.appendChild(body);
  section.appendChild(details);
  return section;
}

function findSidePanelSectionTemplate(panel) {
  for (const preferred of ["progress", "environment", "subagents", "sources", "outputs", "side chats"]) {
    const section = findSidePanelSectionByHeading(panel, preferred, { interactiveOnly: true });
    if (!section) continue;
    const trigger = findSectionTrigger(section, preferred, { interactiveOnly: true });
    return {
      section,
      heading: preferred,
      trigger,
      content: findSectionContent(section, trigger),
      row: findNativeRowTemplate(section, trigger),
    };
  }
  const sources = findSidePanelSectionByHeading(panel, "sources", { interactiveOnly: false });
  if (sources) {
    return {
      mode: "static",
      section: sources,
      heading: "sources",
      trigger: findSectionTrigger(sources, "sources", { interactiveOnly: false }),
      content: findSectionContent(sources, null),
      row: findNativeRowTemplate(sources, null),
    };
  }
  return null;
}

function findSidePanelSectionByHeading(panel, heading, options = {}) {
  const wanted = normalizeVisibleText(heading);
  const candidates = flattenElements(panel)
    .filter((node) => {
      if (!isElement(node) || node === panel || node.hasAttribute?.(SECTION_ATTR)) return false;
      const text = normalizeVisibleText(node.textContent);
      if (!text.startsWith(wanted)) return false;
      const trigger = findSectionTrigger(node, wanted, { interactiveOnly: options.interactiveOnly });
      if (options.interactiveOnly && !trigger) return false;
      if (!trigger && !hasSectionBodyChild(node, wanted)) return false;
      return true;
    })
    .map((node) => sectionOwnerForHeading(panel, node, wanted))
    .filter(Boolean)
    .filter((node, index, all) => all.indexOf(node) === index)
    .sort((left, right) => elementDepth(right) - elementDepth(left));
  return candidates[0] || null;
}

function sectionOwnerForHeading(panel, node, heading) {
  let owner = node;
  for (let current = node; isElement(current?.parentElement) && current.parentElement !== panel; current = current.parentElement) {
    const parentText = normalizeVisibleText(current.parentElement.textContent);
    if (!parentText.startsWith(heading)) break;
    owner = current.parentElement;
  }
  return owner;
}

function hasSectionBodyChild(section, heading) {
  return Array.from(section?.children || []).some((child) => {
    if (!isElement(child)) return false;
    const text = normalizeVisibleText(child.textContent);
    return text && text !== heading && !text.startsWith(`${heading} `);
  });
}

function hasNativeSidePanelSections(panel) {
  return ["environment", "progress", "subagents", "outputs", "side chats"].some((heading) => {
    const section = findSidePanelSectionByHeading(panel, heading, { interactiveOnly: true });
    return Boolean(section);
  });
}

function createNativeProfilesSection(rows, options = {}) {
  const template = options.template;
  const section = cloneTemplateShell(template.section, "section");
  appendClass(section, "codexpp-thread-summary-profiles codexpp-thread-summary-profiles--native");
  section.setAttribute(SECTION_ATTR, "true");

  const collapsedSummary = profileCollapsedSummary(rows);
  const trigger = createNativeProfilesTrigger(template, collapsedSummary);
  appendClass(trigger, "codexpp-thread-summary-profiles__native-trigger");
  if (String(trigger.tagName || "").toLowerCase() === "button" && !trigger.getAttribute("type")) trigger.setAttribute("type", "button");

  const body = template.content ? cloneTemplateShell(template.content, "div") : document.createElement("div");
  appendClass(body, "codexpp-thread-summary-profiles__content codexpp-thread-summary-profiles__native-content");

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "codexpp-thread-summary-profiles__empty";
    empty.hidden = true;
    empty.textContent = "No profiles connected";
    body.appendChild(empty);
  }
  for (const row of rows) body.appendChild(createProfileRow(row, { ...options, template }));

  const setOpen = (open) => {
    const state = open ? "open" : "closed";
    section.setAttribute("data-state", state);
    trigger.setAttribute("data-state", state);
    trigger.setAttribute("aria-expanded", String(open));
    body.setAttribute("data-state", state);
    body.hidden = !open;
    const summaryNode = trigger.querySelector?.(".codexpp-thread-summary-profiles__collapsed-summary");
    if (summaryNode) summaryNode.hidden = open;
  };

  trigger.addEventListener("click", (event) => {
    event?.preventDefault?.();
    const nextOpen = body.hidden;
    writeProfilesOpenState(options.storage, nextOpen);
    setOpen(nextOpen);
  });

  setOpen(readProfilesOpenState(options.storage, true));
  section.append(trigger, body);
  return section;
}

function createStaticProfilesSection(rows, options = {}) {
  const template = options.template;
  const cloned = cloneTemplateTreeWithMap(template.section);
  const section = cloned.node;
  appendClass(section, "codexpp-thread-summary-profiles codexpp-thread-summary-profiles--native codexpp-thread-summary-profiles--static");
  section.setAttribute(SECTION_ATTR, "true");

  const titleSource = findStaticHeadingTemplate(template.section, template.content);
  const contentSource = template.content || findStaticContentTemplate(template.section, titleSource);
  let body = cloned.map.get(contentSource) || findSectionContent(section, null);
  let title = cloned.map.get(titleSource) || findStaticHeadingTemplate(section, body);
  if (!title) {
    title = document.createElement("div");
    section.insertBefore(title, section.firstChild || null);
  }
  appendClass(title, "codexpp-thread-summary-profiles__static-title");
  title.textContent = "Profiles";

  if (!body) {
    body = template.content ? cloneTemplateShell(template.content, "div") : document.createElement("div");
    section.appendChild(body);
  }
  appendClass(body, "codexpp-thread-summary-profiles__static-content");
  body.textContent = "";

  if (!rows.length) {
    const empty = document.createElement("span");
    empty.className = "codexpp-thread-summary-profiles__static-empty";
    empty.textContent = "No profiles connected";
    body.appendChild(empty);
  } else {
    for (const row of rows) body.appendChild(createStaticProfileIcon(row, options));
  }
  copyStaticTemplateComputedStyles(template, section, title, body);
  return section;
}

function findStaticHeadingTemplate(section, content = null) {
  const heading = sectionHeadingName(section);
  const label = heading ? findHeadingLabelNode(section, heading) : null;
  if (label && label !== content) return label;
  const children = Array.from(section?.children || []).filter(isElement);
  return children.find((child) => child !== content && normalizeVisibleText(child.textContent)) || null;
}

function findStaticContentTemplate(section, title = null) {
  const siblings = Array.from(title?.parentElement?.children || []).filter(isElement);
  const afterTitle = siblings.slice(Math.max(0, siblings.indexOf(title) + 1)).find((node) => node !== title);
  if (afterTitle) return afterTitle;
  return findSectionContent(section, null);
}

function createStaticProfileIcon(row, options = {}) {
  const action = sanitizeAction(row.action);
  const tag = action?.type === "external" && action.target ? "a" : action ? "button" : "span";
  const node = document.createElement(tag);
  node.className = "codexpp-thread-summary-profiles__static-icon";
  node.setAttribute("data-profile-row", row.id);
  node.title = profileFullText(row);
  node.setAttribute("title", profileFullText(row));
  node.setAttribute("aria-label", profileFullText(row));
  if (tag === "a") {
    node.href = action.target;
    node.target = "_blank";
    node.rel = "noreferrer";
  } else if (tag === "button") {
    node.type = "button";
    node.addEventListener("click", () => options.onAction?.(action));
  }
  node.appendChild(createProviderIcon(row.id));
  copyStaticIconComputedStyle(options.template?.content, node);
  return node;
}

function copyStaticTemplateComputedStyles(template, section, title, body) {
  if (typeof getComputedStyle !== "function") return;
  copyComputedStyleProperties(template?.section, section, [
    "display", "boxSizing", "width", "maxWidth", "minWidth", "gridColumn", "flex", "flexBasis",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
  ]);
  const sourceTitle = findStaticHeadingTemplate(template?.section, template?.content);
  copyComputedStyleProperties(sourceTitle, title, [
    "display", "boxSizing", "color", "font", "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "lineHeight", "letterSpacing", "textTransform", "padding", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  ]);
  copyComputedStyleProperties(template?.content, body, [
    "display", "alignItems", "justifyContent", "gap", "columnGap", "rowGap", "boxSizing",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "color", "font", "fontFamily", "fontSize", "fontWeight", "lineHeight",
  ]);
}

function copyStaticIconComputedStyle(sourceContent, node) {
  if (typeof getComputedStyle !== "function") return;
  const sourceIcon = Array.from(sourceContent?.children || []).find(isElement);
  copyComputedStyleProperties(sourceIcon, node, [
    "display", "alignItems", "justifyContent", "width", "height", "minWidth", "minHeight",
    "maxWidth", "maxHeight", "color", "font", "fontFamily", "fontSize", "fontWeight",
    "lineHeight", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  ]);
}

function copyComputedStyleProperties(source, target, properties) {
  if (!isElement(source) || !isElement(target) || typeof getComputedStyle !== "function") return;
  let computed = null;
  try {
    computed = getComputedStyle(source);
  } catch {
    return;
  }
  for (const property of properties) {
    const value = computed?.[property];
    if (value) target.style[property] = value;
  }
}

function createNativeProfilesTrigger(template, collapsedSummary) {
  const trigger = cloneTemplateShell(template.trigger, "button");
  const labelTemplate = findHeadingLabelNode(template.trigger, template.heading);
  const label = labelTemplate ? cloneTemplateShell(labelTemplate, "span") : document.createElement("span");
  label.textContent = "Profiles";

  const summary = labelTemplate ? cloneTemplateShell(labelTemplate, "span") : document.createElement("span");
  appendClass(summary, "codexpp-thread-summary-profiles__collapsed-summary");
  summary.textContent = collapsedSummary;

  const chevronTemplate = findChevronTemplate(template.trigger, labelTemplate);
  const chevron = chevronTemplate ? cloneTemplateTree(chevronTemplate) : document.createElement("span");
  if (!chevronTemplate) {
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
  }

  trigger.textContent = "";
  trigger.append(label, summary, chevron);
  return trigger;
}

function profileCollapsedSummary(rows) {
  const labels = rows.map((row) => row.label).filter(Boolean);
  if (!labels.length) return "No profiles";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.length} connected`;
}

function sectionHeadingName(section) {
  const text = normalizeVisibleText(section?.textContent);
  for (const heading of ["environment", "profiles", "progress", "outputs", "side chats", "subagents", "sources"]) {
    if (text.startsWith(heading)) return heading;
  }
  return "";
}

function findSectionTrigger(section, heading, options = {}) {
  const interactive = Array.from(section.querySelectorAll?.("button, summary, [role=\"button\"], [aria-expanded]") || [])
    .filter((node) => isElement(node) && normalizeVisibleText(node.textContent).includes(heading));
  if (interactive.length) return interactive[0];
  if (options.interactiveOnly) return null;
  const children = Array.from(section.children || []).filter(isElement);
  return children.find((node) => normalizeVisibleText(node.textContent).startsWith(heading)) || null;
}

function findSectionContent(section, trigger) {
  const children = Array.from(section.children || []).filter((node) => isElement(node) && node !== trigger);
  return children.find((node) => !normalizeVisibleText(node.textContent).startsWith(sectionHeadingName(section))) || null;
}

function findNativeRowTemplate(section, trigger) {
  const content = findSectionContent(section, trigger);
  const candidates = flattenElements(content).filter((node) => {
    if (node === content || node.hasAttribute?.(SECTION_ATTR)) return false;
    const text = normalizeVisibleText(node.textContent);
    if (!text || text.length > 180) return false;
    return hasIconLikeChild(node) && hasTextLikeChild(node);
  });
  return candidates.sort((left, right) => elementDepth(left) - elementDepth(right))[0] || null;
}

function hasIconLikeChild(node) {
  return Array.from(node.children || []).some((child) => isElement(child) && (isIconSlotLike(child) || isChevronLike(child)));
}

function hasTextLikeChild(node) {
  return Array.from(node.children || []).some((child) => isElement(child) && normalizeVisibleText(child.textContent));
}

function cloneTemplateShell(source, fallbackTag) {
  const tagName = isElement(source) ? String(source.tagName || fallbackTag).toLowerCase() : fallbackTag;
  const clone = document.createElement(tagName || fallbackTag);
  copyTemplateAttributes(source, clone);
  return clone;
}

function cloneTemplateTree(source) {
  return cloneTemplateTreeWithMap(source).node;
}

function cloneTemplateTreeWithMap(source, map = new WeakMap()) {
  const clone = cloneTemplateShell(source, "div");
  if (isElement(source)) map.set(source, clone);
  const childNodes = Array.from(source?.childNodes || source?.children || []);
  if (!childNodes.length) {
    clone.textContent = source?.textContent || "";
    return { node: clone, map };
  }
  for (const child of childNodes) {
    if (isElement(child)) {
      clone.appendChild(cloneTemplateTreeWithMap(child, map).node);
    } else if (child?.nodeType === 3 && typeof document.createTextNode === "function") {
      clone.appendChild(document.createTextNode(child.textContent || ""));
    }
  }
  return { node: clone, map };
}

function findHeadingLabelNode(root, heading) {
  const target = normalizeVisibleText(heading);
  const matches = flattenElements(root).filter((node) => {
    const text = normalizeVisibleText(node.textContent);
    return text === target || text.startsWith(`${target} `);
  });
  return matches.sort((left, right) => elementDepth(right) - elementDepth(left))[0] || null;
}

function findChevronTemplate(root, label) {
  const elements = flattenElements(root);
  const start = label ? elements.indexOf(label) + 1 : 0;
  for (const node of elements.slice(Math.max(0, start))) {
    if (isChevronLike(node)) return node;
  }
  return null;
}

function isChevronLike(node) {
  if (!isElement(node)) return false;
  const tagName = String(node.tagName || "").toLowerCase();
  const text = normalizeVisibleText(node.textContent);
  if (tagName === "svg") return true;
  if (/^[›>⌄⌃∨∧⌵⌃⌄]+$/.test(text)) return true;
  const className = String(node.className || "").toLowerCase();
  const label = String(node.getAttribute?.("aria-label") || "").toLowerCase();
  return className.includes("chevron") || label.includes("expand") || label.includes("collapse");
}

function flattenElements(root) {
  const result = [];
  const visit = (node) => {
    if (!isElement(node)) return;
    result.push(node);
    for (const child of Array.from(node.children || [])) visit(child);
  };
  visit(root);
  return result;
}

function elementDepth(node) {
  let depth = 0;
  for (let current = node; isElement(current?.parentElement); current = current.parentElement) depth += 1;
  return depth;
}

function copyTemplateAttributes(source, target) {
  if (!isElement(source) || !target) return;
  if (source.className) target.className = String(source.className);
  for (const attr of elementAttributes(source)) {
    const name = String(attr.name || "").toLowerCase();
    if (!name || name === "id" || name === "aria-controls" || name === SECTION_ATTR) continue;
    target.setAttribute(attr.name, attr.value);
  }
}

function elementAttributes(node) {
  if (!node?.attributes) return [];
  return Array.from(node.attributes).map((attr) => Array.isArray(attr) ? { name: attr[0], value: attr[1] } : attr);
}

function appendClass(node, className) {
  const existing = String(node?.className || "").split(/\s+/).filter(Boolean);
  const next = String(className || "").split(/\s+/).filter(Boolean);
  node.className = [...new Set([...existing, ...next])].join(" ");
}

function createProfileRow(row, options = {}) {
  if (options.template?.row) return createNativeProfileRow(row, options);
  const action = sanitizeAction(row.action);
  const tag = action?.type === "external" && action.target ? "a" : action ? "button" : "div";
  const node = document.createElement(tag);
  node.className = `codexpp-thread-summary-profiles__row is-${row.state}`;
  node.setAttribute("data-profile-row", row.id);
  if (tag === "a") {
    node.href = action.target;
    node.target = "_blank";
    node.rel = "noreferrer";
  } else if (tag === "button") {
    node.type = "button";
    node.addEventListener("click", () => options.onAction?.(action));
  }
  if (action) node.setAttribute("aria-label", `${row.label}: ${row.value}`);

  const icon = document.createElement("span");
  icon.className = `codexpp-thread-summary-profiles__icon icon-${row.id}`;
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "codexpp-thread-summary-profiles__body";
  const main = document.createElement("span");
  main.className = "codexpp-thread-summary-profiles__main";
  const label = document.createElement("span");
  label.className = "codexpp-thread-summary-profiles__label";
  label.textContent = row.label;
  const value = document.createElement("span");
  value.className = "codexpp-thread-summary-profiles__value";
  value.textContent = row.value;
  main.append(label, value);
  const meta = document.createElement("span");
  meta.className = "codexpp-thread-summary-profiles__meta";
  meta.textContent = [row.detail, row.status].filter(Boolean).join(" - ") || "Status unknown";
  body.append(main, meta);
  node.append(icon, body);
  return node;
}

function createNativeProfileRow(row, options = {}) {
  const action = sanitizeAction(row.action);
  const tag = action?.type === "external" && action.target ? "a" : action ? "button" : "div";
  const source = options.template.row;
  const node = document.createElement(tag);
  copyTemplateAttributes(source, node);
  appendClass(node, `codexpp-thread-summary-profiles__row codexpp-thread-summary-profiles__row--native is-${row.state}`);
  node.setAttribute("data-profile-row", row.id);
  if (tag === "a") {
    node.href = action.target;
    node.target = "_blank";
    node.rel = "noreferrer";
  } else if (tag === "button") {
    node.type = "button";
    node.addEventListener("click", () => options.onAction?.(action));
  }
  if (action) node.setAttribute("aria-label", `${row.label}: ${row.value}`);

  const iconSource = findNativeIconTemplate(source);
  const icon = iconSource ? cloneTemplateShell(iconSource, "span") : document.createElement("span");
  appendClass(icon, "codexpp-thread-summary-profiles__native-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "";
  icon.appendChild(createProviderIcon(row.id));

  const textSource = findNativeTextTemplate(source, iconSource);
  const text = textSource ? cloneTemplateShell(textSource, "span") : document.createElement("span");
  appendClass(text, "codexpp-thread-summary-profiles__native-text");
  text.textContent = profileOneLineText(row);
  text.title = profileFullText(row);
  node.textContent = "";
  node.append(icon, text);
  return node;
}

function findNativeIconTemplate(row) {
  return Array.from(row?.children || []).find((node) => isElement(node) && isIconSlotLike(node)) || null;
}

function findNativeTextTemplate(row, iconSource = null) {
  return Array.from(row?.children || []).find((node) => {
    if (!isElement(node) || node === iconSource) return false;
    return Boolean(normalizeVisibleText(node.textContent));
  }) || null;
}

function isIconSlotLike(node) {
  if (!isElement(node)) return false;
  const tagName = String(node.tagName || "").toLowerCase();
  if (tagName === "svg") return true;
  const className = String(node.className || "").toLowerCase();
  const text = normalizeVisibleText(node.textContent);
  if (className.includes("icon")) return true;
  if (node.getAttribute?.("aria-hidden") === "true" && text.length <= 2) return true;
  return !text && Array.from(node.children || []).some((child) => String(child.tagName || "").toLowerCase() === "svg");
}

function profileOneLineText(row) {
  return [row.label, row.value].filter(Boolean).join(" ");
}

function profileFullText(row) {
  return [profileOneLineText(row), row.detail, row.status].filter(Boolean).join(" - ");
}

function createProviderIcon(id) {
  const kind = ROW_ORDER.includes(id) ? id : "chrome";
  const svg = createSvgElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: `codexpp-thread-summary-profiles__provider-icon icon-${kind}`,
  });
  if (kind === "chrome") {
    appendSvgElement(svg, "circle", { cx: "12", cy: "12", r: "10" });
    appendSvgElement(svg, "path", { d: "M2 12h20" });
    appendSvgElement(svg, "path", { d: "M12 2a15.3 15.3 0 0 1 0 20" });
    appendSvgElement(svg, "path", { d: "M12 2a15.3 15.3 0 0 0 0 20" });
    return svg;
  }
  if (kind === "github") {
    appendSvgElement(svg, "line", { x1: "6", y1: "3", x2: "6", y2: "15" });
    appendSvgElement(svg, "circle", { cx: "18", cy: "6", r: "3" });
    appendSvgElement(svg, "circle", { cx: "6", cy: "18", r: "3" });
    appendSvgElement(svg, "path", { d: "M18 9a9 9 0 0 1-9 9" });
    return svg;
  }
  if (kind === "supabase") {
    appendSvgElement(svg, "ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" });
    appendSvgElement(svg, "path", { d: "M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" });
    appendSvgElement(svg, "path", { d: "M3 12c0 1.7 4 3 9 3s9-1.3 9-3" });
    return svg;
  }
  if (kind === "gmail") {
    appendSvgElement(svg, "rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" });
    appendSvgElement(svg, "path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" });
    return svg;
  }
  if (kind === "google-drive") {
    appendSvgElement(svg, "path", { d: "M4 20h16" });
    appendSvgElement(svg, "path", { d: "M7 20 12 4l5 16" });
    appendSvgElement(svg, "path", { d: "M9.5 12h5" });
    return svg;
  }
  if (kind === "modal") {
    appendSvgElement(svg, "polyline", { points: "4 17 10 11 4 5" });
    appendSvgElement(svg, "line", { x1: "12", y1: "19", x2: "20", y2: "19" });
    return svg;
  }
  if (kind === "railway") {
    appendSvgElement(svg, "rect", { x: "4", y: "3", width: "16", height: "16", rx: "2" });
    appendSvgElement(svg, "path", { d: "M8 19l-2 3" });
    appendSvgElement(svg, "path", { d: "M16 19l2 3" });
    appendSvgElement(svg, "path", { d: "M8 7h8" });
    appendSvgElement(svg, "path", { d: "M8 12h8" });
    return svg;
  }
  appendSvgElement(svg, "circle", { cx: "12", cy: "12", r: "3" });
  appendSvgElement(svg, "path", { d: "M12 2v4" });
  appendSvgElement(svg, "path", { d: "M12 18v4" });
  appendSvgElement(svg, "path", { d: "m4.93 4.93 2.83 2.83" });
  appendSvgElement(svg, "path", { d: "m16.24 16.24 2.83 2.83" });
  appendSvgElement(svg, "path", { d: "M2 12h4" });
  appendSvgElement(svg, "path", { d: "M18 12h4" });
  return svg;
}

function createSvgElement(tagName, attrs = {}, text = "") {
  const node = typeof document.createElementNS === "function"
    ? document.createElementNS("http://www.w3.org/2000/svg", tagName)
    : document.createElement(tagName);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text) node.textContent = text;
  return node;
}

function appendSvgElement(parent, tagName, attrs = {}, text = "") {
  const node = createSvgElement(tagName, attrs, text);
  parent.appendChild(node);
  return node;
}

function handleRendererAction(api, action) {
  const safe = sanitizeAction(action);
  if (!safe) return;
  if (safe.type === "settings") {
    try {
      if (api.codex?.openRegisteredTweakPage?.("co.thomashulihan.projects")) return;
    } catch {}
  }
  api.ipc?.invoke?.(IPC_OPEN_ACTION, safe).catch(() => {});
}

function openProfileAction(action, options = {}) {
  const safe = sanitizeAction(action);
  if (!safe) return { ok: false, reason: "unsafe-action" };
  if (safe.type === "external") return openExternal(safe.target, options);
  if (safe.type === "file") return openPath(safe.target, options);
  return { ok: true, reason: "metadata-only" };
}

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const type = String(action.type || "").trim();
  const target = String(action.target || "").trim();
  if (type === "settings" && target === "projects") return { type, target };
  if (type === "external") {
    const href = safeExternalUrl(target);
    return href ? { type, target: href } : null;
  }
  if (type === "file" && isAllowedProfileFileTarget(target)) return { type, target };
  return null;
}

function readChromeStorage(options = {}) {
  const value = readStorageFile(CHROME_TWEAK_ID, options);
  return { ...value, assignments: isPlainObject(value.assignments) ? value.assignments : {} };
}

function readProjectsStorage(options = {}) {
  const value = readStorageFile(PROJECTS_TWEAK_ID, options);
  return {
    ...value,
    googleWorkspaceAssignments: isPlainObject(value.googleWorkspaceAssignments) ? value.googleWorkspaceAssignments : {},
    modalWorkspaceAssignments: isPlainObject(value.modalWorkspaceAssignments) ? value.modalWorkspaceAssignments : {},
    decodoAssignments: isPlainObject(value.decodoAssignments) ? value.decodoAssignments : {},
  };
}

function readStorageFile(tweakId, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  const userRoot = options.userRoot || userRootForPlatform(home, path);
  const file = path.join(userRoot, "storage", `${tweakId}.json`);
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

function normalizeChromePreferredProfiles(assignment) {
  const path = require("node:path");
  if (!isPlainObject(assignment)) return [];
  if (Array.isArray(assignment.preferredProfiles) && assignment.preferredProfiles.length) return assignment.preferredProfiles.filter(isPlainObject);
  if (Array.isArray(assignment.preferencesPaths) && assignment.preferencesPaths.length) {
    return assignment.preferencesPaths.map((preferencesPath, index) => ({
      profileDirectory: Array.isArray(assignment.profileDirectories) ? assignment.profileDirectories[index] : path.basename(path.dirname(preferencesPath)),
      profileName: Array.isArray(assignment.profileNames) ? assignment.profileNames[index] : path.basename(path.dirname(preferencesPath)),
      preferencesPath,
    }));
  }
  return assignment.profileDirectory || assignment.preferencesPath ? [{
    profileDirectory: assignment.profileDirectory,
    profileName: assignment.profileName,
    preferencesPath: assignment.preferencesPath,
  }] : [];
}

function gitRepositoriesForProject(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const home = options.home || require("node:os").homedir();
  const projectPath = normalizeProjectPath(projectPathInput, { path, home, allowEmpty: true });
  if (!projectPath || projectPath.startsWith("codex-sidebar://") || !fs.existsSync(projectPath)) return [];
  const gitRoot = gitRootForProject(projectPath, { fs, path, childProcess });
  if (!gitRoot) return [];
  const output = safeExec("git", ["-C", gitRoot, "remote", "-v"], childProcess);
  const repos = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const repo = parseGithubRemote(match[2]);
    if (!repo) continue;
    const key = `${repo.owner}/${repo.name}`;
    const existing = repos.get(key) || { ...repo, remotes: new Set(), purposes: new Set() };
    existing.remotes.add(match[1]);
    existing.purposes.add(match[3]);
    repos.set(key, existing);
  }
  return [...repos.values()].map((repo) => ({
    owner: repo.owner,
    name: repo.name,
    fullName: `${repo.owner}/${repo.name}`,
    url: `https://github.com/${repo.owner}/${repo.name}`,
    remotes: [...repo.remotes].sort(),
    purposes: [...repo.purposes].sort(),
    gitRoot,
  }));
}

function gitRootForProject(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const root = safeExec("git", ["-C", projectPath, "rev-parse", "--show-toplevel"], childProcess);
  if (root) return path.resolve(root);
  let current = projectPath;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return null;
}

function parseGithubRemote(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  if (!value || looksSecret(value) || /[?#]/.test(value)) return null;
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (ssh) return cleanGithubRepository(ssh[1], ssh[2]);
  const sshUrl = /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (sshUrl) return cleanGithubRepository(sshUrl[1], sshUrl[2]);
  const gh = /^gh:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (gh) return cleanGithubRepository(gh[1], gh[2]);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    return cleanGithubRepository(segments[0], segments[1].replace(/\.git$/i, ""));
  } catch {}
  return null;
}

function cleanGithubRepository(owner, name) {
  const cleanOwner = String(owner || "").trim();
  const cleanName = String(name || "").trim().replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(cleanOwner) || !/^[A-Za-z0-9_.-]+$/.test(cleanName)) return null;
  if (looksSecret(cleanOwner) || looksSecret(cleanName)) return null;
  return { owner: cleanOwner, name: cleanName };
}

function parseSupabaseConfigToml(content) {
  const block = findTomlTableBlock(String(content || ""), "mcp_servers.supabase");
  if (!block) return null;
  const url = tomlStringValue(block.body, "url");
  let projectRef = "";
  let features = [];
  if (url) {
    try {
      const parsed = new URL(url);
      projectRef = parsed.searchParams.get("project_ref") || "";
      features = (parsed.searchParams.get("features") || "").split(",").map((value) => value.trim()).filter(Boolean);
    } catch {}
  }
  return { projectRef, features };
}

function parseJsonObject(content) {
  try {
    const parsed = JSON.parse(String(content || ""));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function activeModalWorkspaceContext(projectPathInput, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const childProcess = options.childProcess || require("node:child_process");
  const env = { ...process.env, ...(options.env || {}) };
  const projectPath = normalizeProjectPath(projectPathInput, { path, home: options.home, allowEmpty: true });
  if (options.skipModalCli) return { profile: null, workspace: null, source: null, error: "Modal CLI skipped." };
  const candidates = modalPythonCommandCandidates(projectPath, { fs, path, env });
  let lastError = "";
  for (const candidate of candidates) {
    try {
      const stdout = childProcess.execFileSync(candidate.command, [...candidate.args, "-m", "modal", "profile", "list", "--json"], {
        cwd: projectPath && fs.existsSync(projectPath) ? projectPath : undefined,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      const rows = JSON.parse(stdout || "[]");
      const active = Array.isArray(rows) ? rows.find((row) => isPlainObject(row) && row.active === true) : null;
      return {
        profile: cleanText(active?.name || "", 120) || null,
        workspace: cleanText(active?.workspace || "", 120) || null,
        source: candidate.label,
        error: null,
      };
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }
  return { profile: null, workspace: null, source: null, error: lastError || "Modal CLI profile unavailable." };
}

function activeModalWorkspaceContextCached(projectPathInput, options = {}) {
  const path = options.path || require("node:path");
  const projectPath = normalizeProjectPath(projectPathInput, { path, home: options.home, allowEmpty: true });
  const now = currentTimeMs(options);
  if (options.skipModalCli) {
    return { ...activeModalWorkspaceContext(projectPath, options), checkedAt: now, ageMs: 0, cached: false };
  }
  const cache = options.modalCliCache === false ? null : (options.modalCliCache || modalCliCache);
  const ttlMs = cacheTtlMs(options.modalCliCacheTtlMs, MODAL_CLI_CACHE_TTL_MS);
  const key = projectPath || "__unknown__";
  if (cache && ttlMs > 0 && !options.refreshModalCli) {
    const cached = cache.get(key);
    if (cached && now - cached.checkedAt <= ttlMs) {
      return { ...cached.context, checkedAt: cached.checkedAt, ageMs: Math.max(0, now - cached.checkedAt), cached: true };
    }
  }
  const context = activeModalWorkspaceContext(projectPath, options);
  if (cache && ttlMs > 0) cache.set(key, { checkedAt: now, context: { ...context } });
  return { ...context, checkedAt: now, ageMs: 0, cached: false };
}

function modalCliCheckedSuffix(cliContext) {
  if (!cliContext || cliContext.checkedAt == null || cliContext.error === "Modal CLI skipped.") return "";
  return ` - checked ${formatAge(cliContext.ageMs || 0)} ago`;
}

function formatAge(ageMs) {
  const seconds = Math.max(0, Math.floor(Number(ageMs || 0) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function modalPythonCommandCandidates(projectPath, options = {}) {
  const fs = options.fs || require("node:fs");
  const path = options.path || require("node:path");
  const env = options.env || process.env;
  const candidates = [];
  const add = (command, args = [], label = command) => {
    if (command && !candidates.some((candidate) => candidate.command === command && candidate.args.join(" ") === args.join(" "))) {
      candidates.push({ command, args, label });
    }
  };
  if (env.CODEX_PROJECTS_MODAL_PYTHON) add(env.CODEX_PROJECTS_MODAL_PYTHON, [], env.CODEX_PROJECTS_MODAL_PYTHON);
  if (projectPath) {
    for (const candidate of [path.join(projectPath, ".venv", "bin", "python"), path.join(projectPath, "TRR-Backend", ".venv", "bin", "python")]) {
      try {
        if (fs.existsSync(candidate)) add(candidate, [], candidate);
      } catch {}
    }
  }
  add("python3");
  add("python");
  return candidates;
}

function modalWorkspaceConflict(assignment, cliContext) {
  if (!assignment || !cliContext || cliContext.error) return null;
  const expectedProfile = String(assignment.profile || "").trim();
  const expectedWorkspace = String(assignment.workspace || "").trim();
  const activeProfile = String(cliContext.profile || "").trim();
  const activeWorkspace = String(cliContext.workspace || "").trim();
  if (!expectedProfile || !expectedWorkspace || !activeProfile || !activeWorkspace) return null;
  if (expectedProfile === activeProfile && expectedWorkspace === activeWorkspace) return null;
  return { expectedProfile, expectedWorkspace, activeProfile, activeWorkspace };
}

function inferRendererProjectContext(rootDocument = document, panels = null) {
  const context = { projectPath: "", projectName: "" };
  const cwdNode = rootDocument.querySelector("[data-codex-cwd], [data-project-path], [data-codexpp-project-path]");
  context.projectPath = cwdNode?.getAttribute("data-codex-cwd") || cwdNode?.getAttribute("data-project-path") || cwdNode?.getAttribute("data-codexpp-project-path") || "";
  if (!context.projectPath) {
    for (const source of [...(panels || []), rootDocument.body || rootDocument]) {
      context.projectPath = extractProjectPathFromVisibleText(visibleTextWithSeparators(source));
      if (context.projectPath) break;
    }
  }
  const nameNode = rootDocument.querySelector("[data-project-name], [data-codexpp-project-name]");
  context.projectName = nameNode?.getAttribute("data-project-name") || nameNode?.getAttribute("data-codexpp-project-name") || "";
  return context;
}

function inferProjectPath(input) {
  return input.cwd || input.path || input.workspacePath || "";
}

function resolveProjectPathInput(input = {}, options = {}) {
  const direct = input.projectPath || inferProjectPath(input);
  if (direct) return direct;
  const visiblePath = extractProjectPathFromVisibleText(input.visibleText || input.threadText || "");
  if (visiblePath) return visiblePath;
  return projectPathFromStoredProjectName(input.projectName || input.project || "", options);
}

function projectPathFromStoredProjectName(name, options = {}) {
  const wanted = cleanText(name || "", 120).toLowerCase();
  if (!wanted) return "";
  const storage = readProjectsStorage(options);
  const match = (storage.sidebarProjects || []).find((project) => cleanText(project.name || "", 120).toLowerCase() === wanted);
  return match?.projectPath || "";
}

function resolveStoredProjectPrefix(projectPath, options = {}) {
  if (!projectPath) return "";
  const normalized = projectPath.toLowerCase();
  const storage = readProjectsStorage(options);
  const projects = [...(storage.sidebarProjects || [])]
    .map((project) => project.projectPath || "")
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return projects.find((project) => normalized === project.toLowerCase() || normalized.startsWith(`${project.toLowerCase()}/`)) || "";
}

function extractProjectPathFromVisibleText(text) {
  const normalized = String(text || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  const labeled = /(?:^|\n|\b)(?:cwd|workspace|project(?: path)?)\s*[:=]?\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|((?:~?\/|[A-Za-z]:[\\/])[^\n]+))/i.exec(normalized);
  if (labeled) return cleanVisiblePathCandidate(labeled[1] || labeled[2] || labeled[3] || labeled[4] || "");
  const absolute = /((?:~?\/|[A-Za-z]:[\\/])Users\/[^\n]*?\/(?:Projects|Applications)\/[^\s,;:)]+(?:[^\n,;)]*?))/i.exec(normalized);
  return absolute ? cleanVisiblePathCandidate(absolute[1]) : "";
}

function cleanVisiblePathCandidate(value) {
  let text = String(value || "")
    .replace(/\s+(?:environment|sources|progress|subagents|changes|local|main|commit|create pull request)\b.*$/i, "")
    .replace(/[),.;\]]+$/g, "")
    .trim();
  text = text.replace(/\/\.{3}.*$/, "");
  if (!/^(?:~?\/|[A-Za-z]:[\\/])/.test(text) || looksSecret(text)) return "";
  return text;
}

function visibleTextWithSeparators(node) {
  if (!node) return "";
  const children = Array.from(node.childNodes || []);
  if (!children.length) return node.textContent || "";
  return children.map(visibleTextWithSeparators).filter(Boolean).join("\n");
}

function inferSingleConfiguredProjectPath(options = {}) {
  const projects = new Set();
  for (const key of Object.keys(readChromeStorage(options).assignments || {})) {
    if (key) projects.add(key);
  }
  const projectStorage = readProjectsStorage(options);
  for (const group of [
    projectStorage.googleWorkspaceAssignments,
    projectStorage.modalWorkspaceAssignments,
    projectStorage.decodoAssignments,
  ]) {
    for (const key of Object.keys(group || {})) {
      if (key) projects.add(key);
    }
  }
  return projects.size === 1 ? [...projects][0] : "";
}

function inferCurrentWorkingDirectoryProjectPath(options = {}) {
  const path = options.path || require("node:path");
  const raw = cleanText(options.cwd || safeProcessCwd(), 500);
  if (!raw) return "";
  const normalized = normalizeProjectPath(raw, { path, home: options.home, allowEmpty: true });
  return resolveStoredProjectPrefix(normalized, options);
}

function safeProcessCwd() {
  try {
    return process.cwd();
  } catch {
    return "";
  }
}

function normalizeProjectPath(input, options = {}) {
  const path = options.path || require("node:path");
  const home = options.home || require("node:os").homedir();
  if (typeof input !== "string" || input.trim() === "") {
    if (options.allowEmpty) return "";
    throw new Error("Project path is required.");
  }
  if (input.startsWith("codex-sidebar://")) return input;
  return path.resolve(input.replace(/^~(?=$|\/|\\)/, home));
}

function userRootForPlatform(home, path = require("node:path")) {
  if (process.env.CODEX_PLUSPLUS_USER_ROOT) return path.resolve(process.env.CODEX_PLUSPLUS_USER_ROOT);
  if (process.env.CODEX_PLUSPLUS_HOME) return path.resolve(process.env.CODEX_PLUSPLUS_HOME);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "codex-plusplus");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codex-plusplus");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "codex-plusplus");
}

function findTomlTableBlock(content, tableName) {
  const header = `[${tableName}]`;
  const start = content.indexOf(header);
  if (start < 0) return null;
  const rest = content.slice(start + header.length);
  const nextMatch = /\n\[[^\]]+\]/.exec(rest);
  const end = nextMatch ? start + header.length + nextMatch.index + 1 : content.length;
  return { start, end, body: content.slice(start + header.length, end) };
}

function tomlStringValue(blockBody, key) {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*$`, "m").exec(blockBody);
  if (!match) return "";
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function safeExec(command, args, childProcess) {
  try {
    return childProcess.execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function openExternal(target, options = {}) {
  try {
    const electron = require("electron");
    if (electron.shell?.openExternal) {
      electron.shell.openExternal(target);
      return { ok: true };
    }
  } catch {}
  return openWithPlatform(target, options);
}

function openPath(target, options = {}) {
  try {
    const electron = require("electron");
    if (electron.shell?.openPath) {
      electron.shell.openPath(target);
      return { ok: true };
    }
  } catch {}
  return openWithPlatform(target, options);
}

function openWithPlatform(target, options = {}) {
  const childProcess = options.childProcess || require("node:child_process");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    childProcess.spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

function installStyles() {
  if (typeof document === "undefined" || document.getElementById("codexpp-thread-summary-profiles-style")) return;
  const style = document.createElement("style");
  style.id = "codexpp-thread-summary-profiles-style";
  style.textContent = `
    [${SECTION_ATTR}="true"] { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; flex: 0 0 100%; grid-column: 1 / -1; }
    [${SECTION_ATTR}="true"].codexpp-thread-summary-profiles--fallback { padding: 14px 28px 16px; border-top: 1px solid var(--border-light, rgba(127,127,127,.18)); font: inherit; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__details { width: 100%; max-width: 100%; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__summary { box-sizing: border-box; display: flex; min-width: 0; width: 100%; align-items: center; gap: 8px; padding: 0; list-style: none; color: var(--text-secondary, #6b7280); font: inherit; font-weight: 400; cursor: pointer; user-select: none; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__summary::-webkit-details-marker { display: none; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__summary::marker { content: ""; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__summary:focus-visible { outline: 2px solid var(--focus-border, rgba(37,99,235,.6)); outline-offset: 2px; border-radius: 4px; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: inherit; font-weight: inherit; color: inherit; padding: 0; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__chevron { width: 8px; height: 8px; flex: 0 0 auto; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); transition: transform .16s ease; opacity: .9; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__details:not([open]) .codexpp-thread-summary-profiles__chevron { transform: rotate(-45deg); }
    .codexpp-thread-summary-profiles__collapsed-summary { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary, #6b7280); font: inherit; opacity: .85; }
    .codexpp-thread-summary-profiles--fallback .codexpp-thread-summary-profiles__content { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; }
    .codexpp-thread-summary-profiles__row { box-sizing: border-box; width: 100%; min-width: 0; border: 0; background: transparent; color: inherit; text-align: left; text-decoration: none; font: inherit; }
    .codexpp-thread-summary-profiles__row:not(.codexpp-thread-summary-profiles__row--native) { min-height: 30px; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; align-items: start; padding: 3px 0; border-radius: 6px; }
    .codexpp-thread-summary-profiles__row--native { color: inherit; }
    button.codexpp-thread-summary-profiles__row, a.codexpp-thread-summary-profiles__row { cursor: pointer; }
    button.codexpp-thread-summary-profiles__row:hover, a.codexpp-thread-summary-profiles__row:hover, button.codexpp-thread-summary-profiles__row:focus-visible, a.codexpp-thread-summary-profiles__row:focus-visible { background: var(--background-modifier-hover, rgba(127,127,127,.12)); outline: none; }
    .codexpp-thread-summary-profiles__native-icon { flex: 0 0 auto; color: inherit; opacity: .9; }
    .codexpp-thread-summary-profiles__provider-icon { display: block; width: 1em; height: 1em; color: currentColor; }
    .codexpp-thread-summary-profiles__native-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; font: inherit; line-height: inherit; }
    .codexpp-thread-summary-profiles__static-content { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .codexpp-thread-summary-profiles__static-icon { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-decoration: none; cursor: default; }
    button.codexpp-thread-summary-profiles__static-icon, a.codexpp-thread-summary-profiles__static-icon { cursor: pointer; }
    .codexpp-thread-summary-profiles__icon { position: relative; width: 14px; height: 14px; margin-top: 2px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; opacity: .9; overflow: hidden; flex: 0 0 auto; }
    .codexpp-thread-summary-profiles__icon::before, .codexpp-thread-summary-profiles__icon::after { content: ""; position: absolute; box-sizing: border-box; }
    .codexpp-thread-summary-profiles__icon.icon-chrome { border-radius: 50%; background: conic-gradient(#e11d48 0 33%, #f59e0b 0 66%, #16a34a 0); }
    .codexpp-thread-summary-profiles__icon.icon-chrome::after { inset: 4px; border-radius: 50%; background: #2563eb; box-shadow: 0 0 0 2px var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__icon.icon-supabase { background: #16a34a; clip-path: polygon(18% 8%, 82% 50%, 18% 92%); }
    .codexpp-thread-summary-profiles__icon.icon-github { border-radius: 50%; background: currentColor; }
    .codexpp-thread-summary-profiles__icon.icon-github::after { width: 8px; height: 4px; left: 3px; bottom: -1px; border-radius: 4px 4px 0 0; background: var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__icon.icon-google-drive { background: conic-gradient(from 30deg, #16a34a 0 33%, #f59e0b 0 66%, #2563eb 0); clip-path: polygon(50% 0, 100% 86%, 0 86%); }
    .codexpp-thread-summary-profiles__icon.icon-gmail { border-radius: 3px; border: 2px solid #dc2626; border-top-color: #f59e0b; background: transparent; }
    .codexpp-thread-summary-profiles__icon.icon-modal { border-radius: 3px; background: currentColor; }
    .codexpp-thread-summary-profiles__icon.icon-modal::after { inset: 3px; border-left: 2px solid var(--background-primary, #fff); border-right: 2px solid var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__icon.icon-decodo { border-radius: 50%; background: currentColor; }
    .codexpp-thread-summary-profiles__icon.icon-decodo::after { inset: 4px; border-radius: 50%; background: var(--background-primary, #fff); }
    .codexpp-thread-summary-profiles__icon.icon-railway { background: currentColor; clip-path: polygon(50% 0, 95% 86%, 5% 86%); }
    .codexpp-thread-summary-profiles__body { min-width: 0; display: flex; flex-direction: column; gap: 0; }
    .codexpp-thread-summary-profiles__main { min-width: 0; display: grid; grid-template-columns: minmax(58px, .42fr) minmax(0, 1fr); align-items: baseline; gap: 10px; }
    .codexpp-thread-summary-profiles__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--text-secondary, #6b7280); }
    .codexpp-thread-summary-profiles__value { min-width: 0; max-width: 100%; justify-self: end; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; color: var(--text-primary, currentColor); }
    .codexpp-thread-summary-profiles__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 15px; color: var(--text-secondary, #6b7280); }
    .codexpp-thread-summary-profiles__row--native .codexpp-thread-summary-profiles__body { flex: 1 1 auto; min-width: 0; }
    .codexpp-thread-summary-profiles__row--native .codexpp-thread-summary-profiles__main { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
    .codexpp-thread-summary-profiles__row--native .codexpp-thread-summary-profiles__label, .codexpp-thread-summary-profiles__row--native .codexpp-thread-summary-profiles__value { font: inherit; line-height: inherit; color: inherit; }
    .codexpp-thread-summary-profiles__row--native .codexpp-thread-summary-profiles__value { margin-left: auto; }
    .codexpp-thread-summary-profiles__row--native .codexpp-thread-summary-profiles__meta { font: inherit; line-height: inherit; color: var(--text-secondary, #6b7280); opacity: .9; }
    .codexpp-thread-summary-profiles__empty[hidden] { display: none !important; }
    .codexpp-thread-summary-profiles__row.is-warning .codexpp-thread-summary-profiles__meta { color: #b45309; }
    .codexpp-thread-summary-profiles__row.is-error .codexpp-thread-summary-profiles__meta { color: #b91c1c; }
    @media (max-width: 420px) {
      [${SECTION_ATTR}="true"].codexpp-thread-summary-profiles--fallback { padding-left: 22px; padding-right: 22px; }
      .codexpp-thread-summary-profiles__main { grid-template-columns: minmax(48px, .38fr) minmax(0, 1fr); gap: 8px; }
    }
  `;
  document.head?.appendChild(style);
}

function settingsAction(target) {
  return { type: "settings", target };
}

function fileAction(target) {
  return { type: "file", target };
}

function externalAction(target) {
  return { type: "external", target };
}

function currentTimeMs(options = {}) {
  return Number.isFinite(options.now) ? Number(options.now) : Date.now();
}

function cacheTtlMs(value, fallback) {
  if (value == null) return fallback;
  const ttl = Number(value);
  return Number.isFinite(ttl) ? Math.max(0, ttl) : fallback;
}

function cloneSummary(summary) {
  return {
    projectPath: summary?.projectPath || "",
    projectName: summary?.projectName || "",
    rows: Array.isArray(summary?.rows) ? summary.rows.map((row) => ({ ...row, action: row.action ? { ...row.action } : null })) : [],
  };
}

function clearThreadProfileCaches() {
  summaryCache = new Map();
  modalCliCache = new Map();
}

function safeExternalUrl(value) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : "";
  } catch {
    return "";
  }
}

function looksSecret(value) {
  return /(token|cookie|secret|bearer|oauth|password|passwd|credential)/i.test(String(value || ""));
}

function isAllowedProfileFileTarget(target) {
  if (!target || looksSecret(target)) return false;
  const normalized = String(target).replace(/\\/g, "/");
  return normalized === ".codex/config.toml" ||
    normalized.endsWith("/.codex/config.toml") ||
    normalized.endsWith("/.railway/project.json") ||
    normalized.endsWith("/.railway/environment.json") ||
    normalized.endsWith("/railway.json");
}

function freshness(prefix, updatedAt) {
  return updatedAt ? `${prefix} ${shortDate(updatedAt)}` : prefix || "Status unknown";
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function cleanText(value, limit) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}...` : text;
}

function readProfilesOpenState(storage, fallback = true) {
  try {
    return storage?.get?.(OPEN_STATE_KEY, fallback) !== false;
  } catch {
    return fallback;
  }
}

function writeProfilesOpenState(storage, open) {
  try {
    storage?.set?.(OPEN_STATE_KEY, !!open);
  } catch {}
}

function normalizeVisibleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isElement(node) {
  return node && typeof node === "object" && node.nodeType === 1;
}

function isEditableTree(node) {
  if (!isElement(node)) return false;
  for (let current = node; isElement(current); current = current.parentElement) {
    if (isEditableSurface(current)) return true;
  }
  return hasEditableDescendant(node);
}

function hasEditableDescendant(node) {
  const children = Array.from(node?.children || []);
  for (const child of children) {
    if (isEditableSurface(child) || hasEditableDescendant(child)) return true;
  }
  return false;
}

function isEditableSurface(node) {
  if (!isElement(node)) return false;
  const tagName = String(node.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tagName)) return true;
  const contentEditable = String(node.getAttribute?.("contenteditable") || "").trim().toLowerCase();
  if (contentEditable && contentEditable !== "false") return true;
  const role = String(node.getAttribute?.("role") || "").trim().toLowerCase();
  return ["textbox", "combobox", "searchbox"].includes(role);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
