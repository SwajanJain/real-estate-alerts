import test from "node:test";
import assert from "node:assert/strict";

import { classifyPropertyChange, buildOwnerFingerprints } from "../src/lib/change-classifier";
import type { PriorStateRecord, PropertyRecord } from "../src/core/types";

function baseProperty(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    source: "attom",
    sourcePropertyId: "100",
    situsAddress: "1 Main St",
    ownerRaw: "JOHN SMITH",
    ownerType: "individual",
    parsedOwners: [{ raw: "JOHN SMITH", normalized: "john smith", firstName: "john", lastName: "smith", extractedFrom: "direct" }],
    parsedSellers: [],
    lastSaleDate: "2025-06-01",
    lastSalePrice: 500000,
    mortgageAmount: 300000,
    assessedTotal: 480000,
    ...overrides,
  };
}

function basePrior(overrides: Partial<PriorStateRecord> = {}): PriorStateRecord {
  return {
    sourcePropertyId: "100",
    ownerFingerprints: ["john smith"],
    lastSaleDate: "2025-06-01",
    lastSalePrice: 500000,
    mortgageAmount: 300000,
    assessedTotal: 480000,
    lastSeen: "2026-03-08T00:00:00.000Z",
    ...overrides,
  };
}

test("new_to_cache when no prior state exists", () => {
  assert.equal(classifyPropertyChange(baseProperty(), null), "new_to_cache");
});

test("no_change when nothing differs", () => {
  assert.equal(classifyPropertyChange(baseProperty(), basePrior()), "no_change");
});

test("owner_change when owner names differ", () => {
  const property = baseProperty({
    parsedOwners: [{ raw: "JANE DOE", normalized: "jane doe", firstName: "jane", lastName: "doe", extractedFrom: "direct" }],
  });
  assert.equal(classifyPropertyChange(property, basePrior()), "owner_change");
});

test("sale_update when sale date changes", () => {
  const property = baseProperty({ lastSaleDate: "2026-03-01" });
  assert.equal(classifyPropertyChange(property, basePrior()), "sale_update");
});

test("sale_update when sale price changes", () => {
  const property = baseProperty({ lastSalePrice: 600000 });
  assert.equal(classifyPropertyChange(property, basePrior()), "sale_update");
});

test("refinance when mortgage amount changes", () => {
  const property = baseProperty({ mortgageAmount: 250000 });
  assert.equal(classifyPropertyChange(property, basePrior()), "refinance");
});

test("assessment_update when assessed total changes", () => {
  const property = baseProperty({ assessedTotal: 520000 });
  assert.equal(classifyPropertyChange(property, basePrior()), "assessment_update");
});

test("owner_change takes priority over sale_update", () => {
  const property = baseProperty({
    parsedOwners: [{ raw: "NEW OWNER", normalized: "new owner", firstName: "new", lastName: "owner", extractedFrom: "direct" }],
    lastSaleDate: "2026-03-09",
    lastSalePrice: 700000,
  });
  assert.equal(classifyPropertyChange(property, basePrior()), "owner_change");
});

test("buildOwnerFingerprints sorts and lowercases", () => {
  const property = baseProperty({
    parsedOwners: [
      { raw: "B OWNER", normalized: "b owner", extractedFrom: "direct" },
      { raw: "A OWNER", normalized: "a owner", extractedFrom: "direct" },
    ],
  });
  assert.deepEqual(buildOwnerFingerprints(property), ["a owner", "b owner"]);
});
