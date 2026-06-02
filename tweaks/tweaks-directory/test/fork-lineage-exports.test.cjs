"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const exported = require("../index.cjs").__test;

test("fork lineage normalization helpers are exposed for focused tests", () => {
  assert.equal(typeof exported.normalizeForkLineage, "function");
  assert.equal(typeof exported.normalizeForkLineageResult, "function");
  assert.equal(typeof exported.compareVersions, "function");
});
