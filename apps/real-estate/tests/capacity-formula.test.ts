import test from "node:test";
import assert from "node:assert/strict";

import { estimateGivingCapacity } from "../src/lib/capacity-formula";

test("single owner-occupied property under 500K", () => {
  const result = estimateGivingCapacity([{ value: 400000, isOwnerOccupied: true }]);
  // 400K * 5% = 20K, no mortgage bonus (no mortgage data, equity ratio = 1.0 > 0.5 → bonus)
  assert.equal(result.fiveYearCapacity, Math.round(400000 * 0.05 * 1.05));
  assert.equal(result.primaryResidenceValue, 400000);
  assert.equal(result.propertyCount, 1);
  assert.equal(result.mortgageBonus, true);
});

test("single property over 1M with mortgage > 50%", () => {
  const result = estimateGivingCapacity([{ value: 2000000, isOwnerOccupied: true, mortgageAmount: 1200000 }]);
  // 2M * 10% = 200K, mortgage 60% > 50% → no bonus
  assert.equal(result.fiveYearCapacity, 200000);
  assert.equal(result.mortgageBonus, false);
  assert.ok(result.equityRatio < 0.5);
});

test("primary + additional property", () => {
  const result = estimateGivingCapacity([
    { value: 800000, isOwnerOccupied: true },   // primary: 800K * 7.5% = 60K
    { value: 300000, isOwnerOccupied: false },   // additional: 300K * 7.5% = 22.5K
  ]);
  // total = 82.5K, no mortgage → bonus 1.05 → 86625
  assert.equal(result.fiveYearCapacity, Math.round(82500 * 1.05));
  assert.equal(result.primaryResidenceValue, 800000);
  assert.equal(result.additionalPropertyValue, 300000);
  assert.equal(result.propertyCount, 2);
});

test("no owner-occupied uses highest value as primary", () => {
  const result = estimateGivingCapacity([
    { value: 200000, isOwnerOccupied: false },
    { value: 500000, isOwnerOccupied: false },
  ]);
  assert.equal(result.primaryResidenceValue, 500000);
  assert.equal(result.additionalPropertyValue, 200000);
});

test("empty properties returns zero capacity", () => {
  const result = estimateGivingCapacity([]);
  assert.equal(result.fiveYearCapacity, 0);
  assert.equal(result.propertyCount, 0);
});

test("mortgage bonus applies when equity > 50%", () => {
  const withBonus = estimateGivingCapacity([{ value: 1000000, isOwnerOccupied: true, mortgageAmount: 400000 }]);
  const withoutBonus = estimateGivingCapacity([{ value: 1000000, isOwnerOccupied: true, mortgageAmount: 600000 }]);
  assert.equal(withBonus.mortgageBonus, true);
  assert.equal(withoutBonus.mortgageBonus, false);
  assert.ok(withBonus.fiveYearCapacity > withoutBonus.fiveYearCapacity);
});
