"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  compareVersions,
  forkLineageBuiltFromLabel,
  forkLineageLatestLabel,
  forkLineageSummary,
  latestUpstreamVersionFromStore,
  normalizeForkLineage,
  normalizeForkLineageResult,
} = require("../index.cjs").__test;

const source = readFileSync(join(__dirname, "..", "index.cjs"), "utf8");

test("fork lineage shows built-from version and update status from upstream metadata", () => {
  const lineage = normalizeForkLineage(manifest({
    id: "co.thomashulihan.account-switcher",
    upstreamId: "me.erkin.codex-plusplus-account-switcher",
    upstreamGithubRepo: "erknvl/codex-plusplus-account-switcher",
    upstreamVersion: "1.1.0",
  }), {
    remote: { latestVersion: "1.3.0", status: "ok" },
  });

  assert.equal(forkLineageBuiltFromLabel(lineage), "1.1.0");
  assert.equal(forkLineageLatestLabel(lineage), "1.3.0");
  assert.equal(lineage.statusLabel, "Update available");
  assert.match(forkLineageSummary(lineage), /Built from 1\.1\.0/);
  assert.match(forkLineageSummary(lineage), /Latest 1\.3\.0/);
});

test("fork lineage marks current when latest upstream matches built-from version", () => {
  for (const sample of [
    ["co.thomashulihan.add-project-by-path", "co.sakushi.add-project-by-path", "0.1.0"],
    ["co.thomashulihan.better-browser-agent", "co.bennett.better-browser", "0.1.2"],
    ["co.thomashulihan.followup", "co.Arconte112.followup", "0.3.0"],
    ["co.thomashulihan.ui-improvements", "co.bennett.ui-improvements", "1.0.3"],
  ]) {
    const [id, upstreamId, version] = sample;
    const lineage = normalizeForkLineage(manifest({
      id,
      upstreamId,
      upstreamGithubRepo: "owner/repo",
      upstreamVersion: version,
    }), {
      remote: { latestVersion: version, status: "ok" },
    });

    assert.equal(lineage.builtFromVersion, version);
    assert.equal(lineage.latestVersion, version);
    assert.equal(lineage.statusLabel, "Current");
  }
});

test("fork lineage can derive latest upstream version from store entries", () => {
  const storeEntries = [
    { id: "co.sakushi.add-project-by-path", manifest: { id: "co.sakushi.add-project-by-path", version: "0.1.0" } },
  ];

  assert.equal(latestUpstreamVersionFromStore("co.sakushi.add-project-by-path", storeEntries), "0.1.0");

  const lineage = normalizeForkLineage(manifest({
    upstreamId: "co.sakushi.add-project-by-path",
    upstreamVersion: "0.1.0",
  }), { storeEntries });

  assert.equal(lineage.latestVersion, "0.1.0");
  assert.equal(lineage.source, "store");
  assert.equal(lineage.statusLabel, "Current");
});

test("fork lineage reports unknown and source missing fallback states", () => {
  const unknown = normalizeForkLineage(manifest({
    upstreamId: "co.example.unknown",
    upstreamGithubRepo: "example/unknown",
    upstreamVersion: "0.1.0",
  }));
  assert.equal(forkLineageLatestLabel(unknown), "Unknown");
  assert.equal(unknown.statusLabel, "Unknown");

  const missing = normalizeForkLineage(manifest({
    upstreamId: "",
    upstreamGithubRepo: "",
    upstreamVersion: "0.1.0",
  }));
  assert.equal(forkLineageLatestLabel(missing), "Source missing");
  assert.equal(missing.statusLabel, "Source missing");
});

test("fork lineage result normalization keeps local fallback when remote data is absent", () => {
  const manifests = [
    manifest({
      id: "co.thomashulihan.followup",
      upstreamId: "co.Arconte112.followup",
      upstreamVersion: "0.3.0",
    }),
  ];
  const result = normalizeForkLineageResult({ status: "ok", byId: {} }, manifests, [
    { id: "co.Arconte112.followup", manifest: { id: "co.Arconte112.followup", version: "0.3.0" } },
  ]);

  assert.equal(result.byId["co.thomashulihan.followup"].latestVersion, "0.3.0");
  assert.equal(result.byId["co.thomashulihan.followup"].statusLabel, "Current");
});

test("version comparison handles dotted numeric versions", () => {
  assert.equal(compareVersions("1.3.0", "1.1.0"), 1);
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
  assert.equal(compareVersions("0.1.2", "0.1.10"), -1);
});

test("detail UI uses built-from/latest upstream lineage labels", () => {
  assert.match(source, /detailRow\("Built from"/);
  assert.match(source, /detailRow\("Latest upstream"/);
  assert.match(source, /detailRow\("Upstream status"/);
  assert.match(source, /forkLineageSummary/);
});

function manifest(forkOf) {
  return {
    id: forkOf.id || "co.thomashulihan.sample",
    version: "0.1.0",
    forkOf: {
      upstreamId: forkOf.upstreamId,
      upstreamGithubRepo: forkOf.upstreamGithubRepo,
      upstreamVersion: forkOf.upstreamVersion,
      upstreamCommitSha: "abc123",
    },
  };
}
