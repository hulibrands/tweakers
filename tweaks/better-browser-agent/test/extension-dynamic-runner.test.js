"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  allocateRemoteDebuggingPort,
  buildChromeLaunchArgs,
  compareObservations,
  findChromeExecutable,
  prepareChromeLaunchConfig,
  redactSensitiveData,
  redactUrl,
  renderDynamicReportMarkdown,
  shapeDynamicAnalysisReport,
} = require("../extension-dynamic-runner");

const fixtureDir = path.join(__dirname, "fixtures", "dynamic-page");
const extensionDir = path.join(fixtureDir, "extension");

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));
}

test("findChromeExecutable checks explicit, env, and common candidates without requiring Chrome", () => {
  const fakeFs = {
    statSync(candidatePath) {
      if (candidatePath === "/tmp/fake-chrome") {
        return { isFile: () => true };
      }
      throw new Error("missing");
    },
  };

  const found = findChromeExecutable({
    explicitPath: "/tmp/fake-chrome",
    env: { CHROME_PATH: "/tmp/env-chrome" },
    platform: "darwin",
    homeDir: "/Users/example",
    fsImpl: fakeFs,
  });

  assert.equal(found.executablePath, "/tmp/fake-chrome");
  assert.equal(found.source, "explicit");
  assert.equal(found.exists, true);
  assert.ok(
    found.candidates.some((candidate) =>
      candidate.path.endsWith("Google Chrome.app/Contents/MacOS/Google Chrome"),
    ),
  );
});

test("prepareChromeLaunchConfig builds a safe launch plan when Chrome is missing", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-runner-test-"));
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }));

  const config = await prepareChromeLaunchConfig({
    extensionDir,
    targetUrl: "https://fixture.test/dashboard?token=target-secret-token&view=home",
    userDataDir: path.join(tempRoot, "profile"),
    remoteDebuggingPort: 9333,
    chrome: {
      env: {},
      platform: "darwin",
      homeDir: tempRoot,
      fsImpl: {
        statSync() {
          throw new Error("not installed");
        },
      },
    },
  });

  assert.equal(config.canLaunch, false);
  assert.equal(config.missingChrome, true);
  assert.equal(config.remoteDebuggingPort, 9333);
  assert.equal(config.userDataDirCreated, false);
  assert.ok(config.args.includes(`--load-extension=${extensionDir}`));
  assert.ok(config.args.includes(`--disable-extensions-except=${extensionDir}`));
  assert.ok(config.args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(config.args.includes("--no-first-run"));
  assert.ok(config.commandPreview.includes("<chrome-or-chromium>"));
  assert.ok(config.commandPreview.includes("token=%3Credacted%3E"));
  assert.doesNotMatch(config.commandPreview, /target-secret-token/);
});

test("prepareChromeLaunchConfig can use an explicit executable and allocated port", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-runner-test-"));
  t.after(() => fs.rmSync(tempRoot, { force: true, recursive: true }));
  const fakeChrome = path.join(tempRoot, "chrome");
  fs.writeFileSync(fakeChrome, "#!/bin/sh\n");

  const config = await prepareChromeLaunchConfig({
    extensionDir,
    targetUrl: "https://fixture.test/",
    userDataDir: path.join(tempRoot, "profile"),
    chromePath: fakeChrome,
  });

  assert.equal(config.canLaunch, true);
  assert.equal(config.executablePath, fakeChrome);
  assert.equal(typeof config.remoteDebuggingPort, "number");
  assert.ok(config.remoteDebuggingPort > 0);
  assert.ok(config.command);
});

test("buildChromeLaunchArgs rejects unsafe overrides by default", () => {
  assert.throws(
    () =>
      buildChromeLaunchArgs({
        extensionDir,
        userDataDir: os.tmpdir(),
        targetUrl: "https://fixture.test/",
        remoteDebuggingPort: 9444,
        extraArgs: ["--disable-web-security"],
      }),
    /unsafe Chrome launch argument/,
  );
});

test("allocateRemoteDebuggingPort accepts an explicit port", async () => {
  assert.equal(await allocateRemoteDebuggingPort({ port: "9555" }), 9555);
});

test("redaction removes sensitive headers, query params, and token strings", () => {
  const redactedUrl = redactUrl(
    "https://example.test/path?api_key=raw-api-secret&session_id=raw-session-secret&view=ok",
  );
  assert.equal(
    redactedUrl,
    "https://example.test/path?api_key=%3Credacted%3E&session_id=%3Credacted%3E&view=ok",
  );

  const redacted = redactSensitiveData({
    url: "https://example.test/path?token=raw-token-secret",
    headers: {
      Authorization: "Bearer raw-header-secret",
      Cookie: "sessionid=raw-cookie-secret",
      Accept: "text/html",
    },
    message: "sent token=raw-message-secret",
  });

  assert.equal(redacted.headers.Authorization, "<redacted>");
  assert.equal(redacted.headers.Cookie, "<redacted>");
  assert.equal(redacted.headers.Accept, "text/html");
  assert.match(redacted.message, /token=<redacted>/);
  assert.doesNotMatch(JSON.stringify(redacted), /raw-/);
});

test("compareObservations creates safe page deltas from fixture observations", () => {
  const baseline = readFixture("baseline-observation.json");
  const extension = readFixture("extension-observation.json");
  const delta = compareObservations(baseline, extension);
  const serialized = JSON.stringify(delta);

  assert.equal(delta.summary.consoleAdded, 1);
  assert.equal(delta.summary.networkAdded, 1);
  assert.equal(delta.summary.mutationsAdded, 2);
  assert.equal(delta.summary.domSelectorsAdded, 1);
  assert.equal(delta.summary.screenshotChanges, 1);
  assert.equal(delta.summary.extensionTargetsAdded, 1);
  assert.equal(delta.dom.addedSelectors[0], "div[data-extension-badge]");
  assert.match(delta.network.added[0].url, /api_key=%3Credacted%3E/);
  assert.match(delta.timeline.combined.at(-1).url, /api_key=%3Credacted%3E/);
  assert.doesNotMatch(serialized, /extension-api-key-secret/);
  assert.doesNotMatch(serialized, /extension-network-secret/);
  assert.doesNotMatch(serialized, /extension-cookie-secret/);
  assert.doesNotMatch(serialized, /extension-console-secret/);
  assert.doesNotMatch(serialized, /extension-dom-token-secret/);
});

test("shapeDynamicAnalysisReport and markdown stay clean-room and redacted", () => {
  const baseline = readFixture("baseline-observation.json");
  const extension = readFixture("extension-observation.json");
  const report = shapeDynamicAnalysisReport({
    baselineObservation: baseline,
    extensionObservation: extension,
    extensionDir,
    extensionName: "Fixture Extension",
    generatedAt: "2026-05-06T21:05:00.000Z",
    launchConfig: {
      canLaunch: false,
      missingChrome: true,
      remoteDebuggingHost: "127.0.0.1",
      remoteDebuggingPort: 9333,
      commandPreview:
        "chrome --load-extension=/fixture https://fixture.test/dashboard?token=launch-secret-token",
      redactedArgs: [
        "--load-extension=/fixture",
        "https://fixture.test/dashboard?token=<redacted>",
      ],
      warnings: ["Chrome/Chromium executable was not found; launch args were prepared for planning only."],
    },
  });
  const markdown = renderDynamicReportMarkdown(report);
  const serialized = JSON.stringify(report) + markdown;

  assert.equal(report.delta.summary.domSelectorsAdded, 1);
  assert.match(markdown, /# Extension Dynamic Behavior Report/);
  assert.match(markdown, /Chrome launch: prepared, Chrome executable not found/);
  assert.match(markdown, /DOM selectors added: 1/);
  assert.match(markdown, /Clean Room Notes/);
  assert.match(markdown, /observable page behavior/);
  assert.doesNotMatch(serialized, /launch-secret-token/);
  assert.doesNotMatch(serialized, /extension-api-key-secret/);
  assert.doesNotMatch(serialized, /extension-network-secret/);
  assert.doesNotMatch(serialized, /extension-cookie-secret/);
  assert.doesNotMatch(serialized, /extension-console-secret/);
});
