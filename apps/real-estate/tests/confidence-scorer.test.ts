import test from "node:test";
import assert from "node:assert/strict";

import { scoreMatch } from "../src/lib/confidence-scorer";
import type { MatchFeatures } from "../src/core/types";

function baseFeatures(overrides: Partial<MatchFeatures> = {}): MatchFeatures {
  return {
    role: "buyer",
    variantType: "exact",
    addressStatus: "mismatch",
    stateMatch: true,
    portfolioCorroborationCount: 1,
    changeType: "sale_update",
    ...overrides,
  };
}

test("exact name only stays in review", () => {
  const result = scoreMatch(baseFeatures());
  assert.equal(result.quality, "review");
  assert.equal(result.combinedScore, 50);
});

test("buyer exact name + mailing exact reaches high quality", () => {
  const result = scoreMatch(baseFeatures({ addressStatus: "mailing_exact" }));
  assert.equal(result.quality, "high");
  assert.equal(result.combinedScore, 95);
});

test("buyer exact name + mailing city_state reaches medium quality", () => {
  const result = scoreMatch(baseFeatures({ addressStatus: "mailing_city_state" }));
  assert.equal(result.quality, "medium");
  assert.equal(result.combinedScore, 72);
});

// Seller situs tiers now mirror buyer mailing tiers (sold property = prior residence).
test("seller exact name + situs city_state reaches medium (parity with mailing_city_state)", () => {
  const result = scoreMatch(baseFeatures({ role: "seller", addressStatus: "situs_city_state" }));
  assert.equal(result.quality, "medium");
  assert.equal(result.combinedScore, 72);
});

test("seller exact name + situs exact reaches high (no auto-cap)", () => {
  const result = scoreMatch(baseFeatures({ role: "seller", addressStatus: "situs_exact" }));
  assert.equal(result.quality, "high");
  assert.equal(result.combinedScore, 95);
});

test("state mismatch penalty is 20 points", () => {
  const base = scoreMatch(baseFeatures());
  const mismatch = scoreMatch(baseFeatures({ stateMatch: false }));
  assert.equal(base.combinedScore - mismatch.combinedScore, 20);
});

test("state mismatch penalty applied", () => {
  const base = scoreMatch(baseFeatures());
  const mismatch = scoreMatch(baseFeatures({ stateMatch: false }));
  assert.equal(base.combinedScore - mismatch.combinedScore, 20);
  assert.ok(mismatch.reasons.includes("penalty:state_mismatch"));
});

test("portfolio noted in reasons but does not inflate score", () => {
  const single = scoreMatch(baseFeatures({ portfolioCorroborationCount: 1 }));
  const multi = scoreMatch(baseFeatures({ portfolioCorroborationCount: 3 }));
  assert.equal(multi.combinedScore, single.combinedScore);
  assert.ok(multi.reasons.some((r) => r.startsWith("portfolio:")));
  assert.ok(!single.reasons.some((r) => r.startsWith("portfolio:")));
});

test("nickname variant scores lower than exact", () => {
  const exact = scoreMatch(baseFeatures({ variantType: "exact" }));
  const nickname = scoreMatch(baseFeatures({ variantType: "nickname" }));
  assert.ok(exact.combinedScore > nickname.combinedScore);
});

test("sale updates do not add synthetic change bonuses", () => {
  const result = scoreMatch(baseFeatures({ changeType: "sale_update" }));
  assert.ok(!result.reasons.some((r) => r.startsWith("change:")));
});

test("new_to_cache does not appear in reasons", () => {
  const result = scoreMatch(baseFeatures({ changeType: "new_to_cache" }));
  assert.ok(!result.reasons.some((r) => r.startsWith("change:")));
});

test("no_change gets zero change bonus", () => {
  const result = scoreMatch(baseFeatures({ changeType: "no_change" }));
  assert.ok(!result.reasons.some((r) => r.startsWith("change:")));
});

test("exact name reason shows first_last not exact", () => {
  const result = scoreMatch(baseFeatures({ variantType: "exact" }));
  assert.ok(result.reasons.includes("name:first_last"));
  assert.ok(!result.reasons.includes("name:exact"));
});

// Buyer mailing and seller situs at city+state level are now scored equally
// (sold property is the seller's prior residence — functional parity).
test("mailing and situs city+state are scored at parity", () => {
  const mailing = scoreMatch(baseFeatures({ addressStatus: "mailing_city_state", changeType: "no_change" }));
  const situs = scoreMatch(baseFeatures({ role: "seller", addressStatus: "situs_city_state", changeType: "no_change" }));
  assert.equal(mailing.combinedScore, situs.combinedScore);
});

test("quality thresholds: high >= 85, medium >= 65, low >= 40, review < 40", () => {
  assert.equal(scoreMatch(baseFeatures({ addressStatus: "mailing_exact" })).quality, "high");
  assert.equal(scoreMatch(baseFeatures({ addressStatus: "mailing_city_state" })).quality, "medium");
  assert.equal(scoreMatch(baseFeatures()).quality, "review");
  assert.equal(scoreMatch(baseFeatures({ variantType: "fuzzy", changeType: "no_change" })).quality, "review");
});
