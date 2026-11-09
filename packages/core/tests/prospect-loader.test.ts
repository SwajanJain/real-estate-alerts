import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { loadProspects } from "../src/prospect-loader";

test("loadProspects skips unparseable names and returns valid ones", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfund-prospect-test-"));
  const csvPath = path.join(tempDir, "prospects.csv");
  fs.writeFileSync(
    csvPath,
    [
      "name,company",
      "John Smith,Google",
      "X,Apple",             // Too short, should be skipped
      ",Microsoft",          // Empty, should be skipped
      "Jane Doe,Amazon",
    ].join("\n"),
    "utf8",
  );

  const prospects = loadProspects(csvPath);
  assert.equal(prospects.length, 2);
  assert.equal(prospects[0].firstName, "john");
  assert.equal(prospects[1].firstName, "jane");
});

test("loadProspects succeeds when all names are valid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfund-prospect-test-"));
  const csvPath = path.join(tempDir, "prospects.csv");
  fs.writeFileSync(
    csvPath,
    ["name,company", "John Smith,Google", "Jane Doe,Amazon"].join("\n"),
    "utf8",
  );

  const prospects = loadProspects(csvPath);
  assert.equal(prospects.length, 2);
  assert.equal(prospects[0].firstName, "john");
  assert.equal(prospects[1].firstName, "jane");
});

test("loadProspects assigns auto IDs when id column missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfund-prospect-test-"));
  const csvPath = path.join(tempDir, "prospects.csv");
  fs.writeFileSync(
    csvPath,
    ["name,company", "John Smith,Google", "Jane Doe,Amazon"].join("\n"),
    "utf8",
  );

  const prospects = loadProspects(csvPath);
  assert.equal(prospects[0].prospectId, "prospect-1");
  assert.equal(prospects[1].prospectId, "prospect-2");
});
