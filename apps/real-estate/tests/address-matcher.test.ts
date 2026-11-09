import test from "node:test";
import assert from "node:assert/strict";

import { compareAddresses } from "../src/lib/address-matcher";

test("mailing city_state match when mailing city and state agree", () => {
  const result = compareAddresses("UNKNOWN, Austin, TX", { mailing: "UNKNOWN, Austin, TX 78701" });
  assert.equal(result.status, "mailing_city_state");
  assert.equal(result.confidence, 55);
  assert.equal(result.matchedAgainst, "mailing");
});

test("situs city_state match when only situs provided and city/state agree", () => {
  const result = compareAddresses("UNKNOWN, Austin, TX", { situs: "UNKNOWN, Austin, TX 78701" });
  assert.equal(result.status, "situs_city_state");
  assert.equal(result.confidence, 30);
  assert.equal(result.matchedAgainst, "situs");
});

test("mailing match preferred over situs match", () => {
  const result = compareAddresses("UNKNOWN, Austin, TX", {
    mailing: "UNKNOWN, Austin, TX 78701",
    situs: "UNKNOWN, Dallas, TX 75201",
  });
  assert.equal(result.status, "mailing_city_state");
  assert.equal(result.matchedAgainst, "mailing");
});

test("falls back to situs when mailing does not match but situs does", () => {
  const result = compareAddresses("UNKNOWN, Austin, TX", {
    mailing: "UNKNOWN, Chicago, IL 60601",
    situs: "UNKNOWN, Austin, TX 78701",
  });
  assert.equal(result.status, "situs_city_state");
  assert.equal(result.matchedAgainst, "situs");
});

test("mailing_state match when only state agrees on mailing", () => {
  const result = compareAddresses("UNKNOWN, Dallas, TX", { mailing: "UNKNOWN, Austin, TX 78701" });
  assert.equal(result.status, "mailing_state");
  assert.equal(result.confidence, 15);
  assert.equal(result.matchedAgainst, "mailing");
});

test("mismatch when nothing agrees", () => {
  const result = compareAddresses("UNKNOWN, Chicago, IL", { situs: "UNKNOWN, Austin, TX 78701" });
  assert.equal(result.status, "mismatch");
  assert.equal(result.confidence, 0);
});

test("mismatch when prospect has no address", () => {
  const result = compareAddresses(undefined, { situs: "UNKNOWN, Austin, TX 78701" });
  assert.equal(result.status, "mismatch");
  assert.equal(result.matchedAgainst, "none");
});
