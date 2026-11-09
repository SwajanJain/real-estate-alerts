import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { StateStore } from "@pm/core";

import { CacheStore } from "../src/fetchers/cache-store";

test("CacheStore caches pages and watermarks", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-cache-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const cache = new CacheStore(stateStore);

  cache.writePage("11001", "2026/03/09", "2026/03/09", 1, { hello: "world" });
  cache.markPageComplete("11001", "2026/03/09", "2026/03/09", 1, 1);
  cache.writeWatermark("11001", { lastCompleted: "2026-03-09", status: "complete" });

  assert.deepEqual(cache.readPage("11001", "2026/03/09", "2026/03/09", 1), { hello: "world" });
  assert.equal(cache.readScanManifest("11001", "2026/03/09", "2026/03/09")?.status, "complete");
  assert.equal(cache.readWatermark("11001")?.lastCompleted, "2026-03-09");
});
