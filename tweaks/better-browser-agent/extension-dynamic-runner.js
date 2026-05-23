"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const DEFAULT_REMOTE_DEBUGGING_HOST = "127.0.0.1";
const DEFAULT_REDACTION = "<redacted>";
const DEFAULT_MAX_STRING_LENGTH = 800;

const CHROME_ENV_KEYS = Object.freeze([
  "CHROME_PATH",
  "CHROME_EXECUTABLE",
  "CHROME_BIN",
  "GOOGLE_CHROME_BIN",
  "CHROMIUM_BIN",
  "PUPPETEER_EXECUTABLE_PATH",
]);

const SENSITIVE_KEY_EXACT = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "jwt",
  "bearer",
  "credential",
  "credentials",
  "csrf",
  "xsrf",
]);

const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
  "token",
  "apikey",
  "secret",
  "password",
  "passwd",
  "session",
  "cookie",
  "authorization",
  "authtoken",
  "authheader",
  "oauth",
  "jwt",
  "clientsecret",
  "privatekey",
  "accesskey",
  "refresh",
  "credential",
]);

const URL_KEYS = new Set([
  "url",
  "href",
  "documenturl",
  "targeturl",
  "requesturl",
  "responseurl",
  "originurl",
]);

const DISALLOWED_EXTRA_ARG_PREFIXES = Object.freeze([
  "--allow-running-insecure-content",
  "--disable-web-security",
  "--ignore-certificate-errors",
  "--remote-allow-origins=*",
  "--user-data-dir",
  "--load-extension",
  "--disable-extensions-except",
  "--remote-debugging-port",
]);

function findChromeExecutable(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const candidates = collectChromeCandidates(options);
  const checkedCandidates = candidates.map((candidate) => ({
    ...candidate,
    exists: executableExists(candidate.path, fsImpl),
  }));
  const found = checkedCandidates.find((candidate) => candidate.exists);

  return {
    executablePath: found?.path || null,
    source: found?.source || null,
    exists: Boolean(found),
    candidates: checkedCandidates,
  };
}

function collectChromeCandidates(options = {}) {
  const candidates = [];
  const seen = new Set();
  const env = options.env || process.env || {};
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir?.();

  addCandidate(candidates, seen, options.explicitPath || options.chromePath || options.executablePath, "explicit");

  for (const key of CHROME_ENV_KEYS) {
    addCandidate(candidates, seen, env[key], `env:${key}`);
  }

  for (const candidatePath of commonChromePaths(platform, homeDir)) {
    addCandidate(candidates, seen, candidatePath, "common");
  }

  return candidates;
}

function addCandidate(candidates, seen, candidatePath, source) {
  if (typeof candidatePath !== "string") return;
  const trimmed = candidatePath.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  candidates.push({ path: trimmed, source });
}

function commonChromePaths(platform, homeDir) {
  const paths = [];

  if (platform === "darwin") {
    const appRoots = ["/Applications"];
    if (homeDir) appRoots.push(path.join(homeDir, "Applications"));

    for (const appRoot of appRoots) {
      paths.push(
        path.join(appRoot, "Google Chrome.app/Contents/MacOS/Google Chrome"),
        path.join(appRoot, "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
        path.join(appRoot, "Chromium.app/Contents/MacOS/Chromium"),
        path.join(appRoot, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
      );
    }
    return paths;
  }

  if (platform === "win32") {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    for (const root of programFiles) {
      paths.push(
        path.join(root, "Google/Chrome/Application/chrome.exe"),
        path.join(root, "Chromium/Application/chrome.exe"),
        path.join(root, "Microsoft/Edge/Application/msedge.exe"),
      );
    }
    return paths;
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
}

function executableExists(candidatePath, fsImpl) {
  if (!candidatePath) return false;
  try {
    if (typeof fsImpl.statSync === "function") {
      const stat = fsImpl.statSync(candidatePath);
      return Boolean(stat?.isFile?.() || stat?.isSymbolicLink?.());
    }
    return Boolean(fsImpl.existsSync?.(candidatePath));
  } catch {
    return false;
  }
}

async function allocateRemoteDebuggingPort(options = {}) {
  const requested = options.remoteDebuggingPort ?? options.port;
  if (requested != null) return normalizePort(requested, "remoteDebuggingPort");

  const host = options.host || DEFAULT_REMOTE_DEBUGGING_HOST;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref?.();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error("failed to allocate remote debugging port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function prepareChromeLaunchConfig(options = {}) {
  const extensionDir = normalizeDirectory(options.extensionDir, "extensionDir");
  const targetUrl = normalizeTargetUrl(options.targetUrl);
  const remoteDebuggingHost = options.remoteDebuggingHost || DEFAULT_REMOTE_DEBUGGING_HOST;
  const remoteDebuggingPort = await allocateRemoteDebuggingPort({
    host: remoteDebuggingHost,
    remoteDebuggingPort: options.remoteDebuggingPort,
  });
  const userDataDir = options.userDataDir
    ? normalizeDirectory(options.userDataDir, "userDataDir")
    : fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-extension-lab-"));
  const chrome = findChromeExecutable({ ...options, ...(options.chrome || {}) });
  const args = buildChromeLaunchArgs({
    extensionDir,
    userDataDir,
    targetUrl,
    remoteDebuggingHost,
    remoteDebuggingPort,
    extraArgs: options.extraArgs,
    allowUnsafeExtraArgs: options.allowUnsafeExtraArgs,
  });
  const redactedArgs = args.map(redactCommandArg);
  const executableForPreview = chrome.executablePath || "<chrome-or-chromium>";

  return {
    executablePath: chrome.executablePath,
    chrome,
    canLaunch: Boolean(chrome.executablePath),
    missingChrome: !chrome.executablePath,
    extensionDir,
    targetUrl,
    redactedTargetUrl: redactUrl(targetUrl),
    userDataDir,
    userDataDirCreated: !options.userDataDir,
    remoteDebuggingHost,
    remoteDebuggingPort,
    args,
    redactedArgs,
    command: chrome.executablePath ? { executablePath: chrome.executablePath, args } : null,
    commandPreview: buildCommandPreview(executableForPreview, redactedArgs),
    warnings: chrome.executablePath
      ? []
      : ["Chrome/Chromium executable was not found; launch args were prepared for planning only."],
  };
}

function buildChromeLaunchArgs(options = {}) {
  const extensionDir = normalizeDirectory(options.extensionDir, "extensionDir");
  const userDataDir = normalizeDirectory(options.userDataDir, "userDataDir");
  const targetUrl = normalizeTargetUrl(options.targetUrl);
  const remoteDebuggingPort = normalizePort(options.remoteDebuggingPort, "remoteDebuggingPort");
  const remoteDebuggingHost = options.remoteDebuggingHost || DEFAULT_REMOTE_DEBUGGING_HOST;
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];

  if (!isLocalRemoteDebuggingHost(remoteDebuggingHost)) {
    throw new TypeError("remoteDebuggingHost must be localhost, 127.0.0.1, or ::1");
  }

  for (const arg of extraArgs) {
    if (typeof arg !== "string" || !arg.trim()) {
      throw new TypeError("extraArgs must contain non-empty strings");
    }
    if (!options.allowUnsafeExtraArgs && isUnsafeChromeArg(arg)) {
      throw new Error(`refusing unsafe Chrome launch argument: ${arg}`);
    }
  }

  return [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-address=${remoteDebuggingHost}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-client-side-phishing-detection",
    "--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter",
    "--metrics-recording-only",
    "--password-store=basic",
    "--use-mock-keychain",
    "--new-window",
    ...extraArgs,
    targetUrl,
  ];
}

function isLocalRemoteDebuggingHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isUnsafeChromeArg(arg) {
  const lower = String(arg).trim().toLowerCase();
  if (lower.startsWith("--remote-debugging-address=")) {
    const host = lower.slice("--remote-debugging-address=".length);
    return !isLocalRemoteDebuggingHost(host);
  }
  return DISALLOWED_EXTRA_ARG_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}=`));
}

function buildCommandPreview(executablePath, args) {
  return [shellQuote(executablePath), ...args.map(shellQuote)].join(" ");
}

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_/:=.,@%+\-]+$/.test(stringValue)) return stringValue;
  return `'${stringValue.replace(/'/g, "'\\''")}'`;
}

function normalizeDirectory(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return path.resolve(value);
}

function normalizeTargetUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("targetUrl must be a non-empty absolute URL");
  }
  const trimmed = value.trim();
  try {
    new URL(trimmed);
  } catch {
    throw new TypeError("targetUrl must be a non-empty absolute URL");
  }
  return trimmed;
}

function normalizePort(value, name) {
  const port = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`${name} must be an integer port between 1 and 65535`);
  }
  return port;
}

function compareObservations(baselineObservation = {}, extensionObservation = {}, options = {}) {
  const baseline = redactSensitiveData(baselineObservation, options);
  const extension = redactSensitiveData(extensionObservation, options);
  const consoleDelta = diffItems(baseline.console, extension.console, consoleKey);
  const networkDelta = diffItems(baseline.network, extension.network, networkKey);
  const mutationDelta = diffItems(baseline.mutations, extension.mutations, mutationKey);
  const targetDelta = diffItems(baseline.extensionTargets, extension.extensionTargets, extensionTargetKey);
  const timeline = buildTimelineDelta(baseline.timeline, extension.timeline);

  const delta = {
    targetUrl: redactUrl(extension.url || baseline.url || options.targetUrl || ""),
    console: consoleDelta,
    network: {
      ...networkDelta,
      failures: asArray(extension.network).filter(isNetworkFailure),
    },
    mutations: mutationDelta,
    screenshots: buildScreenshotDelta(baseline.screenshots, extension.screenshots),
    dom: buildDomDelta(baseline.domSummary, extension.domSummary),
    extensionTargets: targetDelta,
    timeline,
  };

  delta.summary = buildDeltaSummary(delta);
  return delta;
}

function shapeDynamicAnalysisReport(options = {}) {
  const baselineObservation = options.baselineObservation || options.baseline || {};
  const extensionObservation = options.extensionObservation || options.extension || {};
  const delta = compareObservations(baselineObservation, extensionObservation, {
    targetUrl: options.targetUrl,
    maxStringLength: options.maxStringLength,
  });

  return redactSensitiveData({
    kind: "extension-dynamic-behavior-report",
    generatedAt: options.generatedAt || new Date().toISOString(),
    targetUrl: delta.targetUrl,
    extension: {
      directory: options.extensionDir ? path.resolve(options.extensionDir) : undefined,
      id: options.extensionId,
      name: options.extensionName,
    },
    launch: sanitizeLaunchConfig(options.launchConfig),
    observations: {
      baseline: summarizeObservation(baselineObservation),
      extension: summarizeObservation(extensionObservation),
    },
    delta,
    cleanRoom: {
      sourceUse:
        "This report describes observable page behavior from supplied runtime observations and does not copy extension source or bundled logic.",
      allowed: [
        "Describe observable page behavior.",
        "Reference redacted network, console, DOM, screenshot, and target evidence.",
        "Use the behavior profile as implementation guidance for a new ShadGPT tweak.",
      ],
      avoid: [
        "Do not copy extension source, proprietary assets, private tokens, or distinctive implementation details.",
        "Do not infer cookie, storage, or request-body contents from redacted observations.",
      ],
    },
  });
}

function renderDynamicReportMarkdown(report, options = {}) {
  const safeReport = redactSensitiveData(report, options);
  const delta = safeReport.delta || {};
  const summary = delta.summary || {};
  const lines = [];

  lines.push("# Extension Dynamic Behavior Report", "");
  lines.push(`Target: ${safeReport.targetUrl || delta.targetUrl || "unknown"}`);
  lines.push(`Generated: ${safeReport.generatedAt || "unknown"}`);
  lines.push(`Chrome launch: ${formatLaunchStatus(safeReport.launch)}`);
  if (safeReport.launch?.remoteDebugging) {
    lines.push(
      `Remote debugging: ${safeReport.launch.remoteDebugging.host}:${safeReport.launch.remoteDebugging.port}`,
    );
  }
  lines.push("");

  lines.push("## Delta Summary");
  lines.push(`- Console messages added: ${summary.consoleAdded ?? 0}`);
  lines.push(`- Network requests added: ${summary.networkAdded ?? 0}`);
  lines.push(`- DOM mutations added: ${summary.mutationsAdded ?? 0}`);
  lines.push(`- DOM selectors added: ${summary.domSelectorsAdded ?? 0}`);
  lines.push(`- Screenshot changes: ${summary.screenshotChanges ?? 0}`);
  lines.push(`- Extension targets observed: ${summary.extensionTargetsAdded ?? 0}`);
  lines.push("");

  lines.push("## Timeline");
  for (const event of limited(delta.timeline?.combined, options.timelineLimit || 20)) {
    lines.push(`- ${formatTimelineEvent(event)}`);
  }
  if (!delta.timeline?.combined?.length) lines.push("- No timeline events supplied.");
  lines.push("");

  lines.push("## Behavior Deltas");
  lines.push("### Console");
  for (const entry of limited(delta.console?.added, options.listLimit || 10)) {
    lines.push(`- ${formatConsoleEntry(entry)}`);
  }
  if (!delta.console?.added?.length) lines.push("- No extension-only console messages.");

  lines.push("", "### Network");
  for (const request of limited(delta.network?.added, options.listLimit || 10)) {
    lines.push(`- ${formatNetworkRequest(request)}`);
  }
  if (!delta.network?.added?.length) lines.push("- No extension-only network requests.");

  lines.push("", "### DOM And Mutations");
  for (const selector of limited(delta.dom?.addedSelectors, options.listLimit || 10)) {
    lines.push(`- Added selector: ${selector}`);
  }
  for (const mutation of limited(delta.mutations?.added, options.listLimit || 10)) {
    lines.push(`- Mutation: ${formatMutation(mutation)}`);
  }
  if (!delta.dom?.addedSelectors?.length && !delta.mutations?.added?.length) {
    lines.push("- No extension-only DOM changes.");
  }

  lines.push("", "### Screenshots");
  for (const screenshot of limited(delta.screenshots?.changed, options.listLimit || 10)) {
    lines.push(`- ${formatScreenshotChange(screenshot)}`);
  }
  if (!delta.screenshots?.changed?.length) lines.push("- No screenshot hash changes supplied.");

  lines.push("", "### Extension Targets");
  for (const target of limited(delta.extensionTargets?.added, options.listLimit || 10)) {
    lines.push(`- ${formatExtensionTarget(target)}`);
  }
  if (!delta.extensionTargets?.added?.length) lines.push("- No extension background/service-worker targets supplied.");

  lines.push("", "## Clean Room Notes");
  const cleanRoom = safeReport.cleanRoom || {};
  lines.push(`- ${cleanRoom.sourceUse || "Use this as behavior evidence only."}`);
  for (const item of asArray(cleanRoom.avoid)) {
    lines.push(`- ${item}`);
  }

  return redactString(lines.join("\n"), {
    ...options,
    maxStringLength: options.maxStringLength || 100000,
  }) + "\n";
}

function sanitizeLaunchConfig(launchConfig) {
  if (!launchConfig) {
    return { prepared: false };
  }
  return {
    prepared: true,
    canLaunch: Boolean(launchConfig.canLaunch),
    missingChrome: Boolean(launchConfig.missingChrome),
    chromeSource: launchConfig.chrome?.source || null,
    executablePath: launchConfig.executablePath || null,
    commandPreview: redactString(launchConfig.commandPreview || ""),
    args: asArray(launchConfig.redactedArgs || launchConfig.args).map(redactCommandArg),
    remoteDebugging: {
      host: launchConfig.remoteDebuggingHost || DEFAULT_REMOTE_DEBUGGING_HOST,
      port: launchConfig.remoteDebuggingPort || null,
    },
    extensionDir: launchConfig.extensionDir,
    userDataDir: launchConfig.userDataDir,
    warnings: asArray(launchConfig.warnings),
  };
}

function summarizeObservation(observation) {
  const safe = redactSensitiveData(observation || {});
  return {
    label: safe.label,
    url: safe.url,
    consoleCount: asArray(safe.console).length,
    networkCount: asArray(safe.network).length,
    mutationCount: asArray(safe.mutations).length,
    screenshotCount: asArray(safe.screenshots).length,
    extensionTargetCount: asArray(safe.extensionTargets).length,
    timelineCount: asArray(safe.timeline).length,
    dom: {
      title: safe.domSummary?.title,
      selectorCount: collectDomSelectors(safe.domSummary).length,
    },
  };
}

function redactSensitiveData(value, options = {}, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value, options);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((item) => redactSensitiveData(item, options, seen));
    seen.delete(value);
    return output;
  }

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = DEFAULT_REDACTION;
      continue;
    }
    if (typeof nestedValue === "string" && isUrlKey(key)) {
      output[key] = redactUrl(nestedValue, options);
      continue;
    }
    output[key] = redactSensitiveData(nestedValue, options, seen);
  }

  seen.delete(value);
  return output;
}

function redactCommandArg(arg) {
  const value = String(arg);
  if (looksLikeAbsoluteUrl(value)) return redactUrl(value);
  if (value.startsWith("--remote-debugging-port=")) return value;
  if (value.startsWith("--remote-debugging-address=")) return value;
  return redactString(value);
}

function redactString(value, options = {}) {
  let output = String(value);
  output = output.replace(/\b(?:https?|file|chrome-extension):\/\/[^\s<>"')]+/gi, (url) => redactUrl(url, options));
  return redactSecretPatterns(output, options);
}

function redactSecretPatterns(value, options = {}) {
  let output = String(value);
  output = output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${DEFAULT_REDACTION}`);
  output = output.replace(
    /\b((?:access[_-]?)?token|api[_-]?key|secret|password|session[_-]?id|jwt|auth)=([^&\s"')]+)/gi,
    `$1=${DEFAULT_REDACTION}`,
  );
  output = output.replace(/\b(cookie|set-cookie):\s*[^\n]+/gi, `$1: ${DEFAULT_REDACTION}`);
  const maxLength = options.maxStringLength || DEFAULT_MAX_STRING_LENGTH;
  if (output.length > maxLength) {
    return `${output.slice(0, maxLength)}...<truncated>`;
  }
  return output;
}

function redactUrl(value, options = {}) {
  if (typeof value !== "string" || !value) return value;
  try {
    const parsed = new URL(value);
    for (const [key, paramValue] of parsed.searchParams.entries()) {
      if (isSensitiveKey(key) || looksTokenish(paramValue)) {
        parsed.searchParams.set(key, DEFAULT_REDACTION);
      }
    }
    return parsed.toString();
  } catch {
    return redactSecretPatterns(value, options);
  }
}

function isSensitiveKey(key) {
  const compact = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_KEY_EXACT.has(compact)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => compact.includes(fragment));
}

function isUrlKey(key) {
  const compact = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return URL_KEYS.has(compact);
}

function looksLikeAbsoluteUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value));
}

function looksTokenish(value) {
  return typeof value === "string" && value.length >= 24 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}

function diffItems(baselineItems, extensionItems, keyFn) {
  const baseline = asArray(baselineItems);
  const extension = asArray(extensionItems);
  const baselineKeys = new Set(baseline.map((item) => keyFn(item)));
  const extensionKeys = new Set(extension.map((item) => keyFn(item)));

  return {
    added: extension.filter((item) => !baselineKeys.has(keyFn(item))),
    removed: baseline.filter((item) => !extensionKeys.has(keyFn(item))),
  };
}

function consoleKey(entry) {
  return stableStringify({
    level: entry?.level,
    text: entry?.text || entry?.message,
    source: entry?.source,
  });
}

function networkKey(request) {
  return stableStringify({
    method: request?.method || "GET",
    url: request?.url,
    status: request?.status,
    type: request?.type || request?.resourceType,
    errorText: request?.errorText,
  });
}

function mutationKey(mutation) {
  return stableStringify({
    type: mutation?.type,
    selector: mutation?.selector,
    attributeName: mutation?.attributeName,
    addedNodes: mutation?.addedNodes,
    removedNodes: mutation?.removedNodes,
    oldValue: mutation?.oldValue,
    newValue: mutation?.newValue,
    text: mutation?.text,
  });
}

function extensionTargetKey(target) {
  return stableStringify({
    type: target?.type,
    url: target?.url,
    title: target?.title,
  });
}

function timelineKey(event) {
  return stableStringify({
    source: event?.source,
    type: event?.type,
    message: event?.message || event?.text,
    selector: event?.selector,
    url: event?.url,
  });
}

function buildTimelineDelta(baselineTimeline, extensionTimeline) {
  const baseline = asArray(baselineTimeline).map((event) => ({ run: "baseline", ...event }));
  const extension = asArray(extensionTimeline).map((event) => ({ run: "extension", ...event }));
  const extensionOnly = diffItems(baselineTimeline, extensionTimeline, timelineKey).added.map((event) => ({
    run: "extension",
    ...event,
  }));
  const combined = [...baseline, ...extension].sort(compareTimelineEvents);
  return { combined, extensionOnly };
}

function compareTimelineEvents(left, right) {
  const leftTime = Number.isFinite(left?.timeMs) ? left.timeMs : Number.MAX_SAFE_INTEGER;
  const rightTime = Number.isFinite(right?.timeMs) ? right.timeMs : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left?.timestamp || "").localeCompare(String(right?.timestamp || ""));
}

function buildScreenshotDelta(baselineScreenshots, extensionScreenshots) {
  const baselineByLabel = new Map();
  asArray(baselineScreenshots).forEach((screenshot, index) => {
    baselineByLabel.set(screenshot?.label || `index:${index}`, screenshot);
  });

  const changed = [];
  const added = [];
  asArray(extensionScreenshots).forEach((screenshot, index) => {
    const label = screenshot?.label || `index:${index}`;
    const baseline = baselineByLabel.get(label);
    if (!baseline) {
      added.push(screenshot);
      return;
    }
    const baselineHash = baseline.sha256 || baseline.hash || null;
    const extensionHash = screenshot?.sha256 || screenshot?.hash || null;
    if (baselineHash !== extensionHash) {
      changed.push({
        label,
        baseline: {
          sha256: baselineHash,
          path: baseline.path || null,
        },
        extension: {
          sha256: extensionHash,
          path: screenshot?.path || null,
        },
      });
    }
  });

  return { changed, added };
}

function buildDomDelta(baselineDom, extensionDom) {
  const baselineSelectors = collectDomSelectors(baselineDom);
  const extensionSelectors = collectDomSelectors(extensionDom);
  const baselineSelectorSet = new Set(baselineSelectors);
  const extensionSelectorSet = new Set(extensionSelectors);
  const baselineNodes = nodeMapBySelector(baselineDom?.nodes);
  const extensionNodes = nodeMapBySelector(extensionDom?.nodes);
  const changedNodes = [];
  const addedNodes = [];

  for (const [selector, node] of extensionNodes.entries()) {
    const baselineNode = baselineNodes.get(selector);
    if (!baselineNode) {
      addedNodes.push(node);
      continue;
    }
    if (stableStringify(baselineNode) !== stableStringify(node)) {
      changedNodes.push({ selector, baseline: baselineNode, extension: node });
    }
  }

  return {
    titleChanged: baselineDom?.title !== extensionDom?.title,
    baselineTitle: baselineDom?.title || null,
    extensionTitle: extensionDom?.title || null,
    addedSelectors: extensionSelectors.filter((selector) => !baselineSelectorSet.has(selector)),
    removedSelectors: baselineSelectors.filter((selector) => !extensionSelectorSet.has(selector)),
    addedNodes,
    changedNodes,
  };
}

function collectDomSelectors(domSummary) {
  const selectors = new Set();
  for (const selector of asArray(domSummary?.selectors)) {
    if (typeof selector === "string" && selector.trim()) selectors.add(selector);
  }
  for (const node of asArray(domSummary?.nodes)) {
    if (typeof node?.selector === "string" && node.selector.trim()) selectors.add(node.selector);
  }
  return [...selectors];
}

function nodeMapBySelector(nodes) {
  const map = new Map();
  for (const node of asArray(nodes)) {
    if (typeof node?.selector === "string" && node.selector.trim()) {
      map.set(node.selector, node);
    }
  }
  return map;
}

function isNetworkFailure(request) {
  const status = Number(request?.status);
  return Boolean(request?.errorText || request?.failed || (Number.isFinite(status) && status >= 400));
}

function buildDeltaSummary(delta) {
  return {
    consoleAdded: asArray(delta.console?.added).length,
    networkAdded: asArray(delta.network?.added).length,
    networkFailures: asArray(delta.network?.failures).length,
    mutationsAdded: asArray(delta.mutations?.added).length,
    domSelectorsAdded: asArray(delta.dom?.addedSelectors).length,
    domNodesChanged: asArray(delta.dom?.changedNodes).length,
    screenshotChanges: asArray(delta.screenshots?.changed).length,
    extensionTargetsAdded: asArray(delta.extensionTargets?.added).length,
    timelineEvents: asArray(delta.timeline?.combined).length,
    extensionOnlyTimelineEvents: asArray(delta.timeline?.extensionOnly).length,
  };
}

function stableStringify(value) {
  return JSON.stringify(sortForStringify(value));
}

function sortForStringify(value) {
  if (Array.isArray(value)) return value.map(sortForStringify);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = sortForStringify(value[key]);
  }
  return output;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function limited(items, limit) {
  return asArray(items).slice(0, limit);
}

function formatLaunchStatus(launch) {
  if (!launch?.prepared) return "not prepared";
  if (launch.canLaunch) return "prepared";
  return "prepared, Chrome executable not found";
}

function formatTimelineEvent(event) {
  const time = Number.isFinite(event?.timeMs) ? `${event.timeMs}ms` : event?.timestamp || "time unknown";
  const source = [event?.run, event?.source, event?.type].filter(Boolean).join("/");
  const detail = event?.message || event?.text || event?.selector || event?.url || "event";
  return `${time} [${source || "event"}] ${detail}`;
}

function formatConsoleEntry(entry) {
  return `${entry?.level || "log"}: ${entry?.text || entry?.message || ""}`;
}

function formatNetworkRequest(request) {
  const method = request?.method || "GET";
  const status = request?.status ?? request?.errorText ?? "pending";
  return `${method} ${request?.url || "unknown URL"} -> ${status}`;
}

function formatMutation(mutation) {
  const type = mutation?.type || "mutation";
  const selector = mutation?.selector || "unknown selector";
  const detail = mutation?.attributeName ? ` ${mutation.attributeName}` : "";
  return `${type} at ${selector}${detail}`;
}

function formatScreenshotChange(change) {
  return `${change?.label || "screenshot"} changed: ${change?.baseline?.sha256 || "unknown"} -> ${
    change?.extension?.sha256 || "unknown"
  }`;
}

function formatExtensionTarget(target) {
  return `${target?.type || "target"} ${target?.url || target?.title || ""}`.trim();
}

module.exports = {
  DEFAULT_REMOTE_DEBUGGING_HOST,
  DEFAULT_REDACTION,
  allocateRemoteDebuggingPort,
  buildChromeLaunchArgs,
  buildCommandPreview,
  compareObservations,
  findChromeExecutable,
  prepareChromeLaunchConfig,
  redactSensitiveData,
  redactString,
  redactUrl,
  renderDynamicReportMarkdown,
  shapeDynamicAnalysisReport,
};
