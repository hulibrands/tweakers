"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  analyzeExtension,
  collectReferencedFiles,
  extractManifestProfile,
} = require("../extension-analysis");

const fixtureDir = path.join(__dirname, "fixtures", "static-extension");

test("extracts MV3 manifest surfaces", () => {
  const { staticProfile } = analyzeExtension(fixtureDir, {
    generatedAt: "2026-05-06T00:00:00.000Z",
  });
  const manifest = staticProfile.manifest;

  assert.equal(manifest.manifestVersion, 3);
  assert.equal(manifest.name, "Static Fixture Extension");
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "declarativeNetRequest"]);
  assert.deepEqual(manifest.hostPermissions, ["https://shop.example.com/*"]);
  assert.equal(manifest.contentScripts.length, 1);
  assert.deepEqual(manifest.contentScripts[0].js, ["content.js"]);
  assert.deepEqual(manifest.contentScripts[0].css, ["content.css"]);
  assert.equal(manifest.contentScripts[0].runAt, "document_idle");
  assert.equal(manifest.contentScripts[0].allFrames, true);
  assert.equal(manifest.background.serviceWorker, "background.js");
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.actions.action.defaultPopup, "popup.html");
  assert.deepEqual(manifest.actions.action.defaultIconFiles, ["icon.svg"]);
  assert.equal(manifest.commands[0].name, "toggle-panel");
  assert.equal(manifest.declarativeNetRequest.ruleResources[0].ruleCount, 1);
  assert.deepEqual(manifest.declarativeNetRequest.ruleResources[0].actions, ["block"]);
  assert.deepEqual(manifest.declarativeNetRequest.ruleResources[0].resourceTypes, ["script", "xmlhttprequest"]);
  assert.deepEqual(manifest.webAccessibleResources[0].resources, ["panel.css", "assets/helper.js"]);
  assert.deepEqual(manifest.externallyConnectable.matches, ["https://partner.example.com/*"]);
});

test("collects direct and popup-linked source files without executing them", () => {
  const manifest = require(path.join(fixtureDir, "manifest.json"));
  const refs = collectReferencedFiles(fixtureDir, manifest, extractManifestProfile(manifest));
  const sourcePaths = refs.sourceRefs.map((ref) => ref.relativePath).sort();

  assert.deepEqual(sourcePaths, [
    "assets/helper.js",
    "background.js",
    "content.css",
    "content.js",
    "panel.css",
    "popup.css",
    "popup.html",
    "popup.js",
  ]);
});

test("scans selectors, page mutation, network, storage, messages, CSS injection, and extension APIs", () => {
  const { staticProfile } = analyzeExtension(fixtureDir, {
    generatedAt: "2026-05-06T00:00:00.000Z",
  });
  const heuristics = staticProfile.heuristics;

  const selectors = heuristics.selectors.map((item) => item.selector);
  assert.ok(selectors.includes(".price"));
  assert.ok(selectors.includes("[data-product-id]"));
  assert.ok(selectors.includes("#checkout-root"));
  assert.ok(selectors.includes("button.buy"));
  assert.ok(selectors.includes("#panel-root"));
  assert.ok(selectors.includes(".fixture-panel"));

  const domWrites = heuristics.domWrites.map((item) => item.kind);
  assert.ok(domWrites.includes("textContent assignment"));
  assert.ok(domWrites.includes("insertAdjacentHTML"));
  assert.ok(domWrites.includes("classList.add"));
  assert.ok(domWrites.includes("style or dataset assignment"));

  assert.ok(heuristics.eventListeners.some((item) => item.event === "click"));
  assert.ok(heuristics.eventListeners.some((item) => item.api === "chrome.commands.onCommand.addListener"));

  assert.ok(heuristics.networkCalls.some((item) => item.kind === "fetch" && item.url === "https://api.example.com/collect"));
  assert.ok(
    heuristics.networkCalls.some(
      (item) => item.kind === "navigator.sendBeacon" && item.url === "https://metrics.example.com/ping",
    ),
  );
  assert.ok(heuristics.networkCalls.some((item) => item.kind === "XMLHttpRequest.open:GET"));

  assert.ok(heuristics.storageApis.some((item) => item.api === "chrome.storage.local.set"));
  assert.ok(heuristics.storageApis.some((item) => item.api === "localStorage.setItem"));

  assert.ok(heuristics.messagePassing.some((item) => item.api === "chrome.runtime.sendMessage"));
  assert.ok(heuristics.messagePassing.some((item) => item.api === "chrome.runtime.onMessage.addListener"));
  assert.ok(heuristics.messagePassing.some((item) => item.api === "chrome.tabs.sendMessage"));
  assert.ok(heuristics.messagePassing.some((item) => item.api === "window.postMessage"));

  assert.ok(heuristics.cssInjection.some((item) => item.kind === "scripting.insertCSS"));
  assert.ok(heuristics.cssInjection.some((item) => item.kind === "style element creation"));

  assert.ok(heuristics.extensionApis.some((item) => item.api === "chrome.storage.local.set"));
  assert.ok(heuristics.extensionApis.some((item) => item.api === "chrome.declarativeNetRequest.getEnabledRulesets"));
});

test("summarizes capabilities and clean-room risks", () => {
  const { staticProfile } = analyzeExtension(fixtureDir, {
    generatedAt: "2026-05-06T00:00:00.000Z",
  });
  const capabilities = staticProfile.capabilities;
  const riskIds = staticProfile.riskSummary.map((risk) => risk.id);

  assert.deepEqual(capabilities.hostAccess, ["https://shop.example.com/*"]);
  assert.equal(capabilities.contentScriptCount, 1);
  assert.equal(capabilities.contentScriptsRunInAllFrames, true);
  assert.equal(capabilities.modifiesDom, true);
  assert.equal(capabilities.networkActivity, true);
  assert.equal(capabilities.storageAccess, true);
  assert.equal(capabilities.messagePassing, true);
  assert.equal(capabilities.cssInjection, true);
  assert.equal(capabilities.declarativeNetRequest, true);
  assert.equal(capabilities.externallyConnectable, true);

  assert.ok(riskIds.includes("host-access"));
  assert.ok(riskIds.includes("dom-mutation"));
  assert.ok(riskIds.includes("remote-network"));
  assert.ok(riskIds.includes("storage-access"));
  assert.ok(riskIds.includes("message-bridge"));
  assert.ok(riskIds.includes("style-injection"));
  assert.ok(riskIds.includes("request-rules"));
});

test("generates concise clean-room report artifacts", () => {
  const { reports } = analyzeExtension(fixtureDir, {
    generatedAt: "2026-05-06T00:00:00.000Z",
  });
  const parsedProfile = JSON.parse(reports.staticProfileJson);

  assert.equal(parsedProfile.schemaVersion, 1);
  assert.match(reports.extensionBehaviorMarkdown, /# Extension Behavior/);
  assert.match(reports.extensionBehaviorMarkdown, /Source-Use Caveat/);
  assert.match(reports.extensionBehaviorMarkdown, /Manifest version: 3/);
  assert.match(reports.extensionBehaviorMarkdown, /DOM writes/);
  assert.match(reports.implementationBriefMarkdown, /# Clean-Room Implementation Brief/);
  assert.match(reports.implementationBriefMarkdown, /Do not copy extension source code/);
  assert.match(reports.implementationBriefMarkdown, /fresh ShadGPT tweak implementation/);
  assert.doesNotMatch(reports.implementationBriefMarkdown, /Fixture price reviewed/);
  assert.doesNotMatch(reports.implementationBriefMarkdown, /insertAdjacentHTML\("beforeend"/);
});
