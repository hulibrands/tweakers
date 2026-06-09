#!/usr/bin/env node
const { verifyBundledChromeRouting } = require("./chrome-routing");

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const result = verifyBundledChromeRouting();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("Chrome routing verifier");
  console.log(`scripts: ${result.scripts?.scriptsDir || "missing"}`);
  console.log(`default: ${result.routing.default.profileName || "unset"} (${result.routing.default.profileDirectory || "none"})`);
  console.log(`TRR: ${result.routing.trr.profileName || "unset"} (${result.routing.trr.profileDirectory || "none"})`);
  if (result.routing.project) {
    console.log(`project: ${result.routing.project.profileName || "unset"} (${result.routing.project.profileDirectory || "none"})`);
  }
  if (result.activeChromeProfile) {
    console.log(`active: ${result.activeChromeProfile.profileName || result.activeChromeProfile.profileDirectory} (${result.activeChromeProfile.profileDirectory})`);
  }
  console.log(`profile routing: ${result.sections.profile ? "ok" : "problem"}`);
  console.log(`extension selected profiles: ${result.sections.extension ? "ok" : "problem"}`);
  console.log(`native backend: ${result.sections.backend ? "ok" : "problem"}`);
  console.log(`shared locks: ${result.sections.locks ? "ok" : "stale locks found"}`);
  console.log("");
  console.log("Next fixes:");
  for (const fix of result.fixes || []) {
    console.log(`- ${fix.section}: ${fix.action}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
