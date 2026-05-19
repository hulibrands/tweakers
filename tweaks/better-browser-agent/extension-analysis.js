"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".htm"]);
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const CSS_EXTENSIONS = new Set([".css"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024;

function analyzeExtension(extensionDir, options = {}) {
  const root = path.resolve(extensionDir);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJsonFile(manifestPath);
  const manifestProfile = extractManifestProfile(manifest);
  const references = collectReferencedFiles(root, manifest, manifestProfile);
  manifestProfile.fileReferences = references.fileReferences;
  manifestProfile.declarativeNetRequest = summarizeDeclarativeNetRequest(
    root,
    manifestProfile.declarativeNetRequest,
  );

  const sourceAnalysis = scanReferencedSources(root, references.sourceRefs, options);
  const staticProfile = buildStaticProfile(root, manifestProfile, sourceAnalysis, options);
  const reports = generateCleanRoomArtifacts(staticProfile);

  return {
    staticProfile,
    reports,
  };
}

function buildStaticProfile(root, manifestProfile, sourceAnalysis, options = {}) {
  const profile = {
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    extensionPath: root,
    manifest: manifestProfile,
    sources: {
      scannedFiles: sourceAnalysis.scannedFiles,
      missingFiles: sourceAnalysis.missingFiles,
      skippedFiles: sourceAnalysis.skippedFiles,
    },
    heuristics: sourceAnalysis.heuristics,
    capabilities: {},
    riskSummary: [],
    cleanRoom: {},
  };

  profile.capabilities = summarizeCapabilities(profile);
  profile.riskSummary = summarizeRisks(profile);
  profile.cleanRoom = buildCleanRoomSummary(profile);
  return profile;
}

function extractManifestProfile(manifest) {
  const contentScripts = asArray(manifest.content_scripts).map((entry, index) => ({
    index,
    matches: asStringArray(entry.matches),
    excludeMatches: asStringArray(entry.exclude_matches),
    js: asStringArray(entry.js),
    css: asStringArray(entry.css),
    runAt: entry.run_at || null,
    allFrames: entry.all_frames === true,
    matchAboutBlank: entry.match_about_blank === true,
    world: entry.world || null,
  }));

  const background = normalizeBackground(manifest.background);
  const actions = normalizeActions(manifest);
  const permissions = asStringArray(manifest.permissions);
  const hostPermissions = asStringArray(manifest.host_permissions);
  const optionalPermissions = asStringArray(manifest.optional_permissions);

  return {
    name: manifest.name || null,
    version: manifest.version || null,
    manifestVersion: manifest.manifest_version || null,
    description: manifest.description || null,
    permissions,
    hostPermissions,
    optionalPermissions,
    optionalHostPermissions: asStringArray(manifest.optional_host_permissions),
    hostPermissionLikePermissions: permissions.filter(isHostPattern),
    contentScripts,
    background,
    actions,
    commands: normalizeCommands(manifest.commands),
    declarativeNetRequest: normalizeDeclarativeNetRequest(manifest.declarative_net_request),
    webAccessibleResources: normalizeWebAccessibleResources(manifest.web_accessible_resources),
    externallyConnectable: manifest.externally_connectable || null,
    optionsPage: manifest.options_page || null,
    optionsUiPage: manifest.options_ui?.page || null,
    sidePanelDefaultPath: manifest.side_panel?.default_path || null,
    devtoolsPage: manifest.devtools_page || null,
    fileReferences: [],
  };
}

function normalizeBackground(background = {}) {
  if (!background || typeof background !== "object") {
    return {
      serviceWorker: null,
      scripts: [],
      page: null,
      type: null,
      persistent: null,
    };
  }

  return {
    serviceWorker: background.service_worker || null,
    scripts: asStringArray(background.scripts),
    page: background.page || null,
    type: background.type || null,
    persistent: typeof background.persistent === "boolean" ? background.persistent : null,
  };
}

function normalizeActions(manifest) {
  return {
    action: normalizeAction(manifest.action),
    browserAction: normalizeAction(manifest.browser_action),
    pageAction: normalizeAction(manifest.page_action),
  };
}

function normalizeAction(action = {}) {
  if (!action || typeof action !== "object") {
    return {
      defaultPopup: null,
      defaultTitle: null,
      defaultIconFiles: [],
      defaultFiles: [],
    };
  }

  const defaultIconFiles = collectStringValues(action.default_icon);
  const defaultFiles = [
    ...collectStringValues(action.default_popup),
    ...defaultIconFiles,
  ];

  return {
    defaultPopup: typeof action.default_popup === "string" ? action.default_popup : null,
    defaultTitle: typeof action.default_title === "string" ? action.default_title : null,
    defaultIconFiles,
    defaultFiles,
  };
}

function normalizeCommands(commands = {}) {
  if (!commands || typeof commands !== "object") return [];

  return Object.entries(commands).map(([name, value]) => ({
    name,
    description: typeof value?.description === "string" ? value.description : null,
    suggestedKey: value?.suggested_key || null,
  }));
}

function normalizeDeclarativeNetRequest(dnr = {}) {
  const ruleResources = asArray(dnr?.rule_resources).map((resource) => ({
    id: resource.id || null,
    enabled: resource.enabled !== false,
    path: resource.path || null,
    ruleCount: null,
    actions: [],
    resourceTypes: [],
    parseError: null,
  }));

  return {
    ruleResources,
  };
}

function normalizeWebAccessibleResources(resources = []) {
  return asArray(resources).map((entry, index) => {
    if (typeof entry === "string") {
      return {
        index,
        resources: [entry],
        matches: [],
        extensionIds: [],
        useDynamicUrl: false,
      };
    }

    return {
      index,
      resources: asStringArray(entry.resources),
      matches: asStringArray(entry.matches),
      extensionIds: asStringArray(entry.extension_ids),
      useDynamicUrl: entry.use_dynamic_url === true,
    };
  });
}

function summarizeDeclarativeNetRequest(root, dnrProfile) {
  const ruleResources = dnrProfile.ruleResources.map((resource) => {
    if (!resource.path) return resource;
    const absolutePath = resolveManifestPath(root, resource.path);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      return {
        ...resource,
        parseError: "rule resource missing",
      };
    }

    try {
      const rules = readJsonFile(absolutePath);
      const ruleArray = Array.isArray(rules) ? rules : [];
      return {
        ...resource,
        ruleCount: ruleArray.length,
        actions: unique(ruleArray.map((rule) => rule?.action?.type).filter(Boolean)),
        resourceTypes: unique(ruleArray.flatMap((rule) => asStringArray(rule?.condition?.resourceTypes))),
      };
    } catch (error) {
      return {
        ...resource,
        parseError: error.message,
      };
    }
  });

  return {
    ruleResources,
  };
}

function collectReferencedFiles(root, manifest, manifestProfile = extractManifestProfile(manifest)) {
  const sourceRefsByPath = new Map();
  const fileRefsByKey = new Map();

  const addFileRef = (rawPath, kind, owner, options = {}) => {
    if (typeof rawPath !== "string" || rawPath.trim() === "") return;
    const normalizedPath = normalizeManifestPath(rawPath, options.baseDir);
    const reference = {
      path: rawPath,
      normalizedPath,
      kind,
      owner,
      source: options.source || "manifest",
      scanCandidate: options.scanCandidate !== false,
    };

    const key = `${kind}|${owner}|${rawPath}|${options.baseDir || ""}`;
    if (!fileRefsByKey.has(key)) {
      fileRefsByKey.set(key, reference);
    }

    if (!reference.scanCandidate || !normalizedPath) return;
    for (const expandedPath of expandReferencedPath(root, normalizedPath)) {
      if (!isSourcePath(expandedPath)) continue;
      const relativePath = toPosixPath(path.relative(root, expandedPath));
      if (!sourceRefsByPath.has(expandedPath)) {
        sourceRefsByPath.set(expandedPath, {
          absolutePath: expandedPath,
          relativePath,
          kind: sourceKindForPath(expandedPath),
          owners: [],
        });
      }
      sourceRefsByPath.get(expandedPath).owners.push(owner);
    }
  };

  manifestProfile.contentScripts.forEach((script) => {
    script.js.forEach((file) => addFileRef(file, "content_script_js", `content_scripts[${script.index}]`));
    script.css.forEach((file) => addFileRef(file, "content_script_css", `content_scripts[${script.index}]`));
  });

  if (manifestProfile.background.serviceWorker) {
    addFileRef(manifestProfile.background.serviceWorker, "background_service_worker", "background");
  }
  manifestProfile.background.scripts.forEach((file) => addFileRef(file, "background_script", "background"));
  if (manifestProfile.background.page) {
    addFileRef(manifestProfile.background.page, "background_page", "background");
  }

  for (const [actionName, action] of Object.entries(manifestProfile.actions)) {
    if (action.defaultPopup) addFileRef(action.defaultPopup, `${actionName}_popup`, actionName);
    action.defaultIconFiles.forEach((file) => {
      addFileRef(file, `${actionName}_default_icon`, actionName, { scanCandidate: false });
    });
  }

  if (manifestProfile.optionsPage) addFileRef(manifestProfile.optionsPage, "options_page", "options");
  if (manifestProfile.optionsUiPage) addFileRef(manifestProfile.optionsUiPage, "options_ui_page", "options_ui");
  if (manifestProfile.sidePanelDefaultPath) {
    addFileRef(manifestProfile.sidePanelDefaultPath, "side_panel_default_path", "side_panel");
  }
  if (manifestProfile.devtoolsPage) addFileRef(manifestProfile.devtoolsPage, "devtools_page", "devtools");

  manifestProfile.declarativeNetRequest.ruleResources.forEach((resource) => {
    if (resource.path) {
      addFileRef(resource.path, "declarative_net_request_rules", resource.id || "dnr", { scanCandidate: false });
    }
  });

  manifestProfile.webAccessibleResources.forEach((entry) => {
    entry.resources.forEach((file) => {
      addFileRef(file, "web_accessible_resource", `web_accessible_resources[${entry.index}]`);
    });
  });

  expandHtmlLinkedSources(root, sourceRefsByPath, fileRefsByKey);

  return {
    sourceRefs: [...sourceRefsByPath.values()].map((ref) => ({
      ...ref,
      owners: unique(ref.owners),
    })),
    fileReferences: [...fileRefsByKey.values()],
  };
}

function expandHtmlLinkedSources(root, sourceRefsByPath, fileRefsByKey) {
  const visitedHtml = new Set();
  const queue = [...sourceRefsByPath.values()].filter((ref) => HTML_EXTENSIONS.has(path.extname(ref.absolutePath)));

  while (queue.length > 0) {
    const htmlRef = queue.shift();
    if (visitedHtml.has(htmlRef.absolutePath)) continue;
    visitedHtml.add(htmlRef.absolutePath);

    if (!fs.existsSync(htmlRef.absolutePath)) continue;

    let html;
    try {
      html = fs.readFileSync(htmlRef.absolutePath, "utf8");
    } catch {
      continue;
    }

    const baseDir = path.posix.dirname(htmlRef.relativePath);
    for (const linked of extractHtmlLinkedFiles(html)) {
      const normalizedPath = normalizeManifestPath(linked.path, baseDir);
      const reference = {
        path: linked.path,
        normalizedPath,
        kind: linked.kind,
        owner: htmlRef.relativePath,
        source: "html",
        scanCandidate: true,
      };
      const fileRefKey = `${linked.kind}|${htmlRef.relativePath}|${linked.path}|${baseDir}`;
      if (!fileRefsByKey.has(fileRefKey)) {
        fileRefsByKey.set(fileRefKey, reference);
      }

      if (!normalizedPath) continue;
      for (const expandedPath of expandReferencedPath(root, normalizedPath)) {
        if (!isSourcePath(expandedPath)) continue;
        const relativePath = toPosixPath(path.relative(root, expandedPath));
        if (!sourceRefsByPath.has(expandedPath)) {
          const nestedRef = {
            absolutePath: expandedPath,
            relativePath,
            kind: sourceKindForPath(expandedPath),
            owners: [htmlRef.relativePath],
          };
          sourceRefsByPath.set(expandedPath, nestedRef);
          if (HTML_EXTENSIONS.has(path.extname(expandedPath))) queue.push(nestedRef);
        } else {
          sourceRefsByPath.get(expandedPath).owners.push(htmlRef.relativePath);
        }
      }
    }
  }
}

function extractHtmlLinkedFiles(html) {
  const linked = [];

  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    if (attrs.src) {
      linked.push({
        path: attrs.src,
        kind: "html_script",
      });
    }
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseHtmlAttributes(tag);
    const rel = (attrs.rel || "").toLowerCase();
    if (attrs.href && (rel.includes("stylesheet") || CSS_EXTENSIONS.has(path.extname(attrs.href)))) {
      linked.push({
        path: attrs.href,
        kind: "html_stylesheet",
      });
    }
  }

  return linked;
}

function scanReferencedSources(root, sourceRefs, options = {}) {
  const heuristics = {
    selectors: [],
    domWrites: [],
    eventListeners: [],
    networkCalls: [],
    storageApis: [],
    messagePassing: [],
    cssInjection: [],
    extensionApis: [],
  };
  const seen = new Set();
  const scannedFiles = [];
  const missingFiles = [];
  const skippedFiles = [];
  const maxBytes = options.maxSourceBytes || DEFAULT_MAX_SOURCE_BYTES;

  for (const sourceRef of sourceRefs) {
    if (!fs.existsSync(sourceRef.absolutePath)) {
      missingFiles.push({
        path: sourceRef.relativePath,
        kind: sourceRef.kind,
        owners: sourceRef.owners,
      });
      continue;
    }

    const stat = fs.statSync(sourceRef.absolutePath);
    if (!stat.isFile()) {
      skippedFiles.push({
        path: sourceRef.relativePath,
        kind: sourceRef.kind,
        reason: "not a file",
      });
      continue;
    }
    if (stat.size > maxBytes) {
      skippedFiles.push({
        path: sourceRef.relativePath,
        kind: sourceRef.kind,
        reason: `larger than ${maxBytes} bytes`,
      });
      continue;
    }

    const source = fs.readFileSync(sourceRef.absolutePath, "utf8");
    scannedFiles.push({
      path: sourceRef.relativePath,
      kind: sourceRef.kind,
      bytes: stat.size,
      lineCount: source.split(/\r?\n/).length,
      owners: sourceRef.owners,
    });

    scanSourceText(sourceRef.relativePath, sourceRef.kind, source, heuristics, seen);
  }

  return {
    scannedFiles,
    missingFiles,
    skippedFiles,
    heuristics,
  };
}

function scanSourceText(relativePath, kind, source, heuristics, seen) {
  const extension = path.extname(relativePath).toLowerCase();
  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    scanJavaScript(relativePath, source, heuristics, seen);
  } else if (CSS_EXTENSIONS.has(extension)) {
    scanCss(relativePath, source, heuristics, seen);
  } else if (HTML_EXTENSIONS.has(extension)) {
    scanHtml(relativePath, source, heuristics, seen);
  } else if (kind === "html_script") {
    scanJavaScript(relativePath, source, heuristics, seen);
  }
}

function scanJavaScript(file, source, heuristics, seen) {
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => scanJavaScriptLine(file, index + 1, line, heuristics, seen));
}

function scanJavaScriptLine(file, lineNumber, line, heuristics, seen) {
  let foundFetchOnLine = false;

  forEachMatch(/\b(?:[A-Za-z_$][\w$]*\.)?(querySelector(?:All)?|closest|matches)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g, line, (match) => {
    addHeuristic(heuristics, seen, "selectors", {
      selector: cleanLiteral(match[3]),
      kind: match[1],
      source: "js-call",
      file,
      line: lineNumber,
      confidence: "medium",
    });
  });

  forEachMatch(/\bgetElementById\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, line, (match) => {
    addHeuristic(heuristics, seen, "selectors", {
      selector: `#${cleanLiteral(match[2])}`,
      kind: "getElementById",
      source: "js-call",
      file,
      line: lineNumber,
      confidence: "high",
    });
  });

  forEachMatch(/\bgetElementsByClassName\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, line, (match) => {
    const classSelector = cleanLiteral(match[2])
      .split(/\s+/)
      .filter(Boolean)
      .map((value) => `.${value}`)
      .join("");
    addHeuristic(heuristics, seen, "selectors", {
      selector: classSelector,
      kind: "getElementsByClassName",
      source: "js-call",
      file,
      line: lineNumber,
      confidence: "medium",
    });
  });

  forEachMatch(/\bgetElementsByTagName\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, line, (match) => {
    addHeuristic(heuristics, seen, "selectors", {
      selector: cleanLiteral(match[2]),
      kind: "getElementsByTagName",
      source: "js-call",
      file,
      line: lineNumber,
      confidence: "low",
    });
  });

  forEachMatch(/\$\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, line, (match) => {
    addHeuristic(heuristics, seen, "selectors", {
      selector: cleanLiteral(match[2]),
      kind: "jquery",
      source: "js-call",
      file,
      line: lineNumber,
      confidence: "low",
    });
  });

  const domPropertyRe = /\.(innerHTML|outerHTML|textContent|innerText|value)\s*=/g;
  forEachMatch(domPropertyRe, line, (match) => {
    addHeuristic(heuristics, seen, "domWrites", {
      kind: `${match[1]} assignment`,
      file,
      line: lineNumber,
      confidence: match[1] === "innerHTML" || match[1] === "outerHTML" ? "high" : "medium",
    });
  });

  const domMethodPatterns = [
    ["appendChild", /\.appendChild\s*\(/g],
    ["append", /\.append\s*\(/g],
    ["prepend", /\.prepend\s*\(/g],
    ["replaceChildren", /\.replaceChildren\s*\(/g],
    ["replaceWith", /\.replaceWith\s*\(/g],
    ["insertAdjacentHTML", /\.insertAdjacentHTML\s*\(/g],
    ["insertAdjacentText", /\.insertAdjacentText\s*\(/g],
    ["insertAdjacentElement", /\.insertAdjacentElement\s*\(/g],
    ["remove", /\.remove\s*\(/g],
    ["removeChild", /\.removeChild\s*\(/g],
    ["setAttribute", /\.setAttribute\s*\(/g],
    ["removeAttribute", /\.removeAttribute\s*\(/g],
    ["classList.add", /\.classList\.add\s*\(/g],
    ["classList.remove", /\.classList\.remove\s*\(/g],
    ["classList.toggle", /\.classList\.toggle\s*\(/g],
  ];

  for (const [kind, regex] of domMethodPatterns) {
    if (regex.test(line)) {
      addHeuristic(heuristics, seen, "domWrites", {
        kind,
        file,
        line: lineNumber,
        confidence: "medium",
      });
    }
  }

  if (/\.(style|dataset)\.[A-Za-z_$][\w$-]*\s*=/.test(line)) {
    addHeuristic(heuristics, seen, "domWrites", {
      kind: "style or dataset assignment",
      file,
      line: lineNumber,
      confidence: "medium",
    });
  }

  forEachMatch(/\baddEventListener\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g, line, (match) => {
    const event = cleanLiteral(match[2]);
    addHeuristic(heuristics, seen, "eventListeners", {
      event,
      api: "addEventListener",
      file,
      line: lineNumber,
      confidence: "high",
    });
    if (event === "message") {
      addHeuristic(heuristics, seen, "messagePassing", {
        api: "window message event",
        direction: "receive",
        file,
        line: lineNumber,
        confidence: "medium",
      });
    }
  });

  forEachMatch(/\b(on[a-z][a-z0-9_]*)\s*=/gi, line, (match) => {
    addHeuristic(heuristics, seen, "eventListeners", {
      event: match[1].slice(2).toLowerCase(),
      api: `${match[1]} assignment`,
      file,
      line: lineNumber,
      confidence: "low",
    });
  });

  forEachMatch(/\b(chrome|browser)\.([A-Za-z0-9_.]*on[A-Z][A-Za-z0-9_.]*)\.addListener\b/g, line, (match) => {
    addHeuristic(heuristics, seen, "eventListeners", {
      event: match[2],
      api: `${match[1]}.${match[2]}.addListener`,
      file,
      line: lineNumber,
      confidence: "high",
    });
  });

  forEachMatch(/\b(fetch|sendBeacon)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g, line, (match) => {
    foundFetchOnLine = foundFetchOnLine || match[1] === "fetch";
    addHeuristic(heuristics, seen, "networkCalls", {
      kind: match[1] === "sendBeacon" ? "navigator.sendBeacon" : "fetch",
      url: cleanLiteral(match[3]),
      file,
      line: lineNumber,
      confidence: "high",
    });
  });

  if (/\bfetch\s*\(/.test(line) && !foundFetchOnLine) {
    addHeuristic(heuristics, seen, "networkCalls", {
      kind: "fetch",
      url: null,
      dynamic: true,
      file,
      line: lineNumber,
      confidence: "low",
    });
  }

  forEachMatch(/\bnew\s+(WebSocket|EventSource)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g, line, (match) => {
    addHeuristic(heuristics, seen, "networkCalls", {
      kind: match[1],
      url: cleanLiteral(match[3]),
      file,
      line: lineNumber,
      confidence: "high",
    });
  });

  if (/\bXMLHttpRequest\b/.test(line)) {
    addHeuristic(heuristics, seen, "networkCalls", {
      kind: "XMLHttpRequest",
      url: null,
      file,
      line: lineNumber,
      confidence: "medium",
    });
  }

  forEachMatch(/\.open\s*\(\s*(['"`])([A-Za-z]+)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/g, line, (match) => {
    addHeuristic(heuristics, seen, "networkCalls", {
      kind: `XMLHttpRequest.open:${match[2].toUpperCase()}`,
      url: cleanLiteral(match[4]),
      file,
      line: lineNumber,
      confidence: "medium",
    });
  });

  forEachMatch(/\b(chrome|browser)\.storage(?:\.(local|sync|session|managed))?\.(get|set|remove|clear|getBytesInUse)\b/g, line, (match) => {
    const area = match[2] || "unspecified";
    addHeuristic(heuristics, seen, "storageApis", {
      api: `${match[1]}.storage.${area}.${match[3]}`,
      area,
      operation: match[3],
      file,
      line: lineNumber,
      confidence: "high",
    });
  });

  forEachMatch(/\b(localStorage|sessionStorage)\.(getItem|setItem|removeItem|clear)\b/g, line, (match) => {
    addHeuristic(heuristics, seen, "storageApis", {
      api: `${match[1]}.${match[2]}`,
      area: match[1],
      operation: match[2],
      file,
      line: lineNumber,
      confidence: "medium",
    });
  });

  if (/\bindexedDB\b/.test(line)) {
    addHeuristic(heuristics, seen, "storageApis", {
      api: "indexedDB",
      area: "indexedDB",
      operation: "unknown",
      file,
      line: lineNumber,
      confidence: "low",
    });
  }

  forEachMatch(/\b(chrome|browser)\.(runtime|tabs)\.(sendMessage|sendNativeMessage|connect|onMessage\.addListener|onMessageExternal\.addListener|onConnect\.addListener|onConnectExternal\.addListener)\b/g, line, (match) => {
    const operation = match[3];
    addHeuristic(heuristics, seen, "messagePassing", {
      api: `${match[1]}.${match[2]}.${operation}`,
      direction: operation.includes("on") ? "receive" : "send",
      file,
      line: lineNumber,
      confidence: "high",
    });
  });

  if (/\bwindow\.postMessage\s*\(/.test(line)) {
    addHeuristic(heuristics, seen, "messagePassing", {
      api: "window.postMessage",
      direction: "send",
      file,
      line: lineNumber,
      confidence: "medium",
    });
  }

  if (/\b(chrome|browser)\.(scripting|tabs)\.insertCSS\b/.test(line)) {
    addHeuristic(heuristics, seen, "cssInjection", {
      kind: line.includes(".tabs.insertCSS") ? "tabs.insertCSS" : "scripting.insertCSS",
      file,
      line: lineNumber,
      confidence: "high",
    });
  }

  if (/\bdocument\.createElement\s*\(\s*(['"`])style\1/.test(line)) {
    addHeuristic(heuristics, seen, "cssInjection", {
      kind: "style element creation",
      file,
      line: lineNumber,
      confidence: "medium",
    });
  }

  if (/\b(CSSStyleSheet|adoptedStyleSheets)\b|\.insertRule\s*\(|\.replaceSync\s*\(/.test(line)) {
    addHeuristic(heuristics, seen, "cssInjection", {
      kind: "constructable stylesheet",
      file,
      line: lineNumber,
      confidence: "medium",
    });
  }

  forEachMatch(/\b(chrome|browser)\.([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?(?:\.([A-Za-z_][\w]*))?/g, line, (match) => {
    const parts = [match[1], match[2], match[3], match[4]].filter(Boolean);
    addHeuristic(heuristics, seen, "extensionApis", {
      api: parts.join("."),
      namespace: match[2],
      file,
      line: lineNumber,
      confidence: "high",
    });
  });
}

function scanCss(file, source, heuristics, seen) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectorRe = /([^{}]+)\{/g;

  forEachMatch(selectorRe, css, (match) => {
    const selectorBlock = match[1].split("}").pop().trim();
    if (!selectorBlock || selectorBlock.startsWith("@")) return;

    const line = lineNumberAt(css, match.index);
    selectorBlock
      .split(",")
      .map((selector) => selector.trim())
      .filter(isLikelyCssSelector)
      .forEach((selector) => {
        addHeuristic(heuristics, seen, "selectors", {
          selector,
          kind: "css-rule",
          source: "css",
          file,
          line,
          confidence: "medium",
        });
      });
  });
}

function scanHtml(file, source, heuristics, seen) {
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    forEachMatch(/\bid\s*=\s*(['"])(.*?)\1/gi, line, (match) => {
      addHeuristic(heuristics, seen, "selectors", {
        selector: `#${match[2].trim()}`,
        kind: "html-id",
        source: "html",
        file,
        line: lineNumber,
        confidence: "medium",
      });
    });

    forEachMatch(/\bclass\s*=\s*(['"])(.*?)\1/gi, line, (match) => {
      match[2]
        .split(/\s+/)
        .map((className) => className.trim())
        .filter(Boolean)
        .forEach((className) => {
          addHeuristic(heuristics, seen, "selectors", {
            selector: `.${className}`,
            kind: "html-class",
            source: "html",
            file,
            line: lineNumber,
            confidence: "low",
          });
        });
    });

    forEachMatch(/\b(data-[A-Za-z0-9_-]+)(?:\s*=|\s|>)/g, line, (match) => {
      addHeuristic(heuristics, seen, "selectors", {
        selector: `[${match[1]}]`,
        kind: "html-data-attribute",
        source: "html",
        file,
        line: lineNumber,
        confidence: "low",
      });
    });

    forEachMatch(/\bon([a-z][\w-]*)\s*=/gi, line, (match) => {
      addHeuristic(heuristics, seen, "eventListeners", {
        event: match[1].toLowerCase(),
        api: "html event attribute",
        file,
        line: lineNumber,
        confidence: "low",
      });
    });

    if (line.includes("<script")) scanJavaScriptLine(file, lineNumber, line, heuristics, seen);
  });
}

function summarizeCapabilities(profile) {
  const manifest = profile.manifest;
  const heuristics = profile.heuristics;
  const contentScriptMatches = manifest.contentScripts.flatMap((entry) => entry.matches);
  const hostAccess = unique([
    ...manifest.hostPermissions,
    ...manifest.hostPermissionLikePermissions,
    ...contentScriptMatches,
  ]);
  const cssContentScripts = manifest.contentScripts.flatMap((entry) => entry.css);
  const dnrRuleCount = manifest.declarativeNetRequest.ruleResources.reduce(
    (sum, resource) => sum + (Number(resource.ruleCount) || 0),
    0,
  );

  return {
    hostAccess,
    broadHostAccess: hostAccess.some(isBroadHostPattern),
    contentScriptCount: manifest.contentScripts.length,
    contentScriptsRunInAllFrames: manifest.contentScripts.some((entry) => entry.allFrames),
    modifiesDom: heuristics.domWrites.length > 0,
    observesSelectors: heuristics.selectors.length > 0,
    networkActivity: heuristics.networkCalls.length > 0,
    storageAccess:
      heuristics.storageApis.length > 0 ||
      manifest.permissions.includes("storage") ||
      manifest.optionalPermissions.includes("storage"),
    messagePassing: heuristics.messagePassing.length > 0,
    cssInjection: heuristics.cssInjection.length > 0 || cssContentScripts.length > 0,
    declarativeNetRequest:
      dnrRuleCount > 0 ||
      manifest.permissions.some((permission) => permission.startsWith("declarativeNetRequest")),
    externallyConnectable: !!manifest.externallyConnectable,
  };
}

function summarizeRisks(profile) {
  const risks = [];
  const capabilities = profile.capabilities;

  if (capabilities.broadHostAccess) {
    risks.push({
      id: "broad-host-access",
      level: "high",
      title: "Broad host access",
      evidence: capabilities.hostAccess.filter(isBroadHostPattern),
      cleanRoomNote: "Preserve least-privilege host matching in any Codex++ tweak.",
    });
  } else if (capabilities.hostAccess.length > 0) {
    risks.push({
      id: "host-access",
      level: "medium",
      title: "Page host access",
      evidence: capabilities.hostAccess,
      cleanRoomNote: "Treat host matches as scope evidence, not permission to copy implementation.",
    });
  }

  if (capabilities.modifiesDom) {
    risks.push({
      id: "dom-mutation",
      level: "medium",
      title: "Page DOM mutation",
      evidence: profile.heuristics.domWrites.slice(0, 6).map(formatEvidenceLocation),
      cleanRoomNote: "Recreate only the user-visible behavior from fresh code.",
    });
  }

  if (capabilities.networkActivity) {
    risks.push({
      id: "remote-network",
      level: "medium",
      title: "Remote network activity",
      evidence: profile.heuristics.networkCalls.slice(0, 6).map((call) => call.url || `${call.kind} dynamic URL`),
      cleanRoomNote: "Do not reuse endpoints unless the target implementation owns or is authorized to call them.",
    });
  }

  if (capabilities.storageAccess) {
    risks.push({
      id: "storage-access",
      level: "medium",
      title: "Extension or page storage access",
      evidence: profile.heuristics.storageApis.slice(0, 6).map((api) => api.api),
      cleanRoomNote: "Avoid copying stored schemas unless they are documented public contracts.",
    });
  }

  if (capabilities.messagePassing || capabilities.externallyConnectable) {
    risks.push({
      id: "message-bridge",
      level: capabilities.externallyConnectable ? "high" : "medium",
      title: "Message passing surface",
      evidence: [
        ...profile.heuristics.messagePassing.slice(0, 6).map((api) => api.api),
        ...(profile.manifest.externallyConnectable ? ["externally_connectable"] : []),
      ],
      cleanRoomNote: "Define a fresh, minimal message contract for any replacement.",
    });
  }

  if (capabilities.cssInjection) {
    risks.push({
      id: "style-injection",
      level: "low",
      title: "CSS or style injection",
      evidence: [
        ...profile.manifest.contentScripts.flatMap((entry) => entry.css),
        ...profile.heuristics.cssInjection.slice(0, 6).map(formatEvidenceLocation),
      ].filter(Boolean),
      cleanRoomNote: "Restyle with original design choices for the new tweak, not copied CSS.",
    });
  }

  if (capabilities.declarativeNetRequest) {
    risks.push({
      id: "request-rules",
      level: "medium",
      title: "Declarative request rules",
      evidence: profile.manifest.declarativeNetRequest.ruleResources.map((resource) => {
        const count = resource.ruleCount == null ? "unknown" : resource.ruleCount;
        return `${resource.id || resource.path}: ${count} rules`;
      }),
      cleanRoomNote: "Recreate rule intent from allowed behavior, not from proprietary rule text.",
    });
  }

  return risks;
}

function buildCleanRoomSummary(profile) {
  return {
    caveats: [
      "Static analysis only; no extension source was executed.",
      "License terms are not inferred. Confirm the extension license before using any non-behavioral material.",
      "Selectors, permissions, and API names are behavior evidence. Do not copy source files, bundled logic, assets, or expression structure.",
      "Use the generated brief as a fresh implementation target for Codex++ behavior, not as a clone recipe.",
    ],
    implementationGuidance: generateImplementationGuidance(profile),
  };
}

function generateCleanRoomArtifacts(staticProfile) {
  return {
    staticProfileJson: `${JSON.stringify(staticProfile, null, 2)}\n`,
    extensionBehaviorMarkdown: generateExtensionBehaviorMarkdown(staticProfile),
    implementationBriefMarkdown: generateImplementationBriefMarkdown(staticProfile),
  };
}

function generateExtensionBehaviorMarkdown(profile) {
  const manifest = profile.manifest;
  const capabilities = profile.capabilities;
  const selectors = profile.heuristics.selectors.slice(0, 12).map((item) => {
    return `${item.selector} (${item.file}:${item.line}, ${item.source})`;
  });
  const domWrites = profile.heuristics.domWrites.slice(0, 8).map((item) => {
    return `${item.kind} (${item.file}:${item.line})`;
  });
  const networkCalls = profile.heuristics.networkCalls.slice(0, 8).map((item) => {
    return `${item.kind}${item.url ? ` to ${item.url}` : " with dynamic URL"} (${item.file}:${item.line})`;
  });
  const extensionApis = profile.heuristics.extensionApis.slice(0, 12).map((item) => {
    return `${item.api} (${item.file}:${item.line})`;
  });

  return [
    "# Extension Behavior",
    "",
    "## Source-Use Caveat",
    ...profile.cleanRoom.caveats.map((caveat) => `- ${caveat}`),
    "",
    "## Manifest Summary",
    `- Name: ${manifest.name || "unknown"}`,
    `- Manifest version: ${manifest.manifestVersion || "unknown"}`,
    `- Permissions: ${formatList(manifest.permissions)}`,
    `- Host access: ${formatList(capabilities.hostAccess)}`,
    `- Content scripts: ${manifest.contentScripts.length}`,
    `- Background: ${manifest.background.serviceWorker || formatList(manifest.background.scripts) || "none detected"}`,
    `- Action popup: ${firstPresent([
      manifest.actions.action.defaultPopup,
      manifest.actions.browserAction.defaultPopup,
      manifest.actions.pageAction.defaultPopup,
    ]) || "none detected"}`,
    "",
    "## Page Surfaces",
    bulletList(selectors, "No selectors detected."),
    "",
    "## Runtime Behavior Hints",
    "- DOM writes:",
    indentBullets(domWrites, "None detected."),
    "- Event listeners:",
    indentBullets(
      profile.heuristics.eventListeners.slice(0, 8).map((item) => {
        return `${item.api} ${item.event} (${item.file}:${item.line})`;
      }),
      "None detected.",
    ),
    "- Network calls:",
    indentBullets(networkCalls, "None detected."),
    "- Storage APIs:",
    indentBullets(
      profile.heuristics.storageApis.slice(0, 8).map((item) => `${item.api} (${item.file}:${item.line})`),
      "None detected.",
    ),
    "- Message passing:",
    indentBullets(
      profile.heuristics.messagePassing.slice(0, 8).map((item) => {
        return `${item.api} ${item.direction || "unknown"} (${item.file}:${item.line})`;
      }),
      "None detected.",
    ),
    "- CSS injection:",
    indentBullets(
      profile.heuristics.cssInjection.slice(0, 8).map((item) => `${item.kind} (${item.file}:${item.line})`),
      "None detected.",
    ),
    "",
    "## Extension APIs",
    bulletList(extensionApis, "No chrome.* or browser.* APIs detected."),
    "",
    "## Risk Summary",
    bulletList(
      profile.riskSummary.map((risk) => `${risk.level.toUpperCase()}: ${risk.title}`),
      "No notable static risks detected.",
    ),
    "",
  ].join("\n");
}

function generateImplementationBriefMarkdown(profile) {
  const guidance = profile.cleanRoom.implementationGuidance;
  const manifest = profile.manifest;
  const selectors = profile.heuristics.selectors.slice(0, 10).map((item) => item.selector);
  const hostAccess = profile.capabilities.hostAccess;

  return [
    "# Clean-Room Implementation Brief",
    "",
    "## Boundary",
    "- Do not copy extension source code, bundled logic, assets, minified code, comments, file structure, or private endpoints.",
    "- Use this brief as behavior evidence for a fresh Codex++ tweak implementation.",
    "- Verify licensing separately before using names, images, styles, or text from the original extension.",
    "",
    "## Behavior To Recreate",
    `- Extension family: ${manifest.name || "unknown Chrome extension"} using Manifest V${manifest.manifestVersion || "unknown"}.`,
    `- Page scope evidence: ${formatList(hostAccess, "No host access found in the manifest.")}`,
    `- Page surfaces to inspect: ${formatList(unique(selectors), "No static selectors found.")}`,
    ...guidance.map((item) => `- ${item}`),
    "",
    "## Codex++ Tweak Guidance",
    "- Start with least-privilege page matching and a small, documented message contract.",
    "- Rebuild DOM and style changes from user-visible behavior instead of mirroring source structure.",
    "- Keep network and storage behavior opt-in unless the Codex++ use case requires it.",
    "- Record static evidence separately from any dynamic observation so the implementation trail remains auditable.",
    "",
    "## Avoid",
    "- Do not port proprietary helper functions, selectors-as-control-flow, bundled libraries, or exact CSS declarations.",
    "- Do not call third-party endpoints unless the new tweak is authorized to use them.",
    "- Do not treat this static report as proof of runtime behavior without a separate dynamic observation pass.",
    "",
  ].join("\n");
}

function generateImplementationGuidance(profile) {
  const guidance = [];

  if (profile.capabilities.modifiesDom) {
    guidance.push("Recreate visible DOM augmentation with fresh component structure and minimal page mutation.");
  }
  if (profile.capabilities.cssInjection) {
    guidance.push("Plan a new style layer for the Codex++ tweak; use selectors only as page-surface evidence.");
  }
  if (profile.capabilities.networkActivity) {
    guidance.push("Review whether any remote calls are necessary; replace vendor endpoints with owned services or omit them.");
  }
  if (profile.capabilities.storageAccess) {
    guidance.push("Define a fresh storage schema with explicit migration and privacy notes.");
  }
  if (profile.capabilities.messagePassing) {
    guidance.push("Design a narrow message interface with validation, origin checks, and bounded payloads.");
  }
  if (profile.capabilities.declarativeNetRequest) {
    guidance.push("Translate request-rule intent into documented allow/block behavior before implementation.");
  }
  if (profile.capabilities.contentScriptsRunInAllFrames) {
    guidance.push("Decide whether all-frame behavior is actually needed in Codex++ before enabling it.");
  }

  if (guidance.length === 0) {
    guidance.push("No strong implementation behavior was detected statically; use dynamic observation before coding.");
  }

  return guidance;
}

function addHeuristic(heuristics, seen, bucket, item) {
  const keyParts = [
    bucket,
    item.file,
    item.line,
    item.kind,
    item.selector,
    item.event,
    item.api,
    item.operation,
    item.url,
    item.direction,
  ];
  const key = keyParts.map((part) => (part == null ? "" : String(part))).join("|");
  if (seen.has(key)) return;
  seen.add(key);
  heuristics[bucket].push(item);
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  const attrRe = /\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  forEachMatch(attrRe, tag, (match) => {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  });
  return attrs;
}

function expandReferencedPath(root, normalizedPath) {
  if (normalizedPath.includes("*") || normalizedPath.includes("?")) {
    return expandSimpleGlob(root, normalizedPath);
  }

  const resolved = resolveManifestPath(root, normalizedPath);
  return resolved ? [resolved] : [];
}

function expandSimpleGlob(root, pattern) {
  const regex = globPatternToRegExp(pattern);
  return walkFiles(root).filter((file) => {
    const relativePath = toPosixPath(path.relative(root, file));
    return regex.test(relativePath);
  });
}

function globPatternToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function walkFiles(root, maxFiles = 5000) {
  const files = [];
  const stack = [root];
  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function resolveManifestPath(root, rawPath) {
  const normalizedPath = normalizeManifestPath(rawPath);
  if (!normalizedPath) return null;

  const resolved = path.resolve(root, ...normalizedPath.split("/"));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function normalizeManifestPath(rawPath, baseDir = "") {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim();
  if (!trimmed || isRemotePath(trimmed)) return null;

  const withoutFragment = trimmed.split("#")[0].split("?")[0];
  const startsAtExtensionRoot = withoutFragment.startsWith("/");
  const withoutLeadingSlash = withoutFragment.replace(/^\/+/, "");
  const normalized = path.posix.normalize(
    path.posix.join(startsAtExtensionRoot ? "" : baseDir || "", withoutLeadingSlash),
  );
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

function isRemotePath(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//") || value.startsWith("data:");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value) {
  return asArray(value).filter((item) => typeof item === "string");
}

function collectStringValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectStringValues);
}

function cleanLiteral(value) {
  return String(value || "")
    .replace(/\\(["'`\\])/g, "$1")
    .trim();
}

function sourceKindForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (JAVASCRIPT_EXTENSIONS.has(extension)) return "javascript";
  if (CSS_EXTENSIONS.has(extension)) return "css";
  if (HTML_EXTENSIONS.has(extension)) return "html";
  return "text";
}

function isSourcePath(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isHostPattern(value) {
  return (
    typeof value === "string" &&
    (value === "<all_urls>" ||
      value.includes("://") ||
      value.startsWith("file://") ||
      value.startsWith("*://"))
  );
}

function isBroadHostPattern(value) {
  return value === "<all_urls>" || value === "*://*/*" || value === "http://*/*" || value === "https://*/*";
}

function isLikelyCssSelector(selector) {
  if (!selector || selector.length > 180) return false;
  if (selector.startsWith("@")) return false;
  if (/^(from|to|\d+%)$/i.test(selector)) return false;
  if (selector.includes(";")) return false;
  return true;
}

function formatList(values, fallback = "none detected") {
  const cleanValues = unique(asArray(values).filter(Boolean));
  return cleanValues.length ? cleanValues.join(", ") : fallback;
}

function bulletList(values, fallback) {
  if (!values.length) return `- ${fallback}`;
  return values.map((value) => `- ${value}`).join("\n");
}

function indentBullets(values, fallback) {
  if (!values.length) return `  - ${fallback}`;
  return values.map((value) => `  - ${value}`).join("\n");
}

function firstPresent(values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "") || null;
}

function formatEvidenceLocation(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  return `${item.kind || item.api || "evidence"} at ${item.file}:${item.line}`;
}

function forEachMatch(regex, text, callback) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    callback(match);
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function runCli(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const extensionDir = args.find((arg) => arg !== "--json") || process.cwd();

  try {
    const result = analyzeExtension(extensionDir);
    if (json) {
      process.stdout.write(result.reports.staticProfileJson);
    } else {
      process.stdout.write(result.reports.extensionBehaviorMarkdown);
      process.stdout.write("\n");
      process.stdout.write(result.reports.implementationBriefMarkdown);
    }
  } catch (error) {
    process.stderr.write(`Extension analysis failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  analyzeExtension,
  buildStaticProfile,
  collectReferencedFiles,
  extractManifestProfile,
  generateCleanRoomArtifacts,
  generateExtensionBehaviorMarkdown,
  generateImplementationBriefMarkdown,
  scanReferencedSources,
  summarizeCapabilities,
  summarizeRisks,
};

if (require.main === module) {
  runCli(process.argv);
}
