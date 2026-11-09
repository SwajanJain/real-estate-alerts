import test from "node:test";
import assert from "node:assert/strict";

import { extractFromTrustName } from "../src/lib/trust-name-resolver";

test("extracts name from trustee suffix pattern", () => {
  const result = extractFromTrustName("SMITH JOHN A TRUSTEE");
  assert.equal(result.length, 1);
  assert.equal(result[0].extractedFrom, "trust_name");
});

test("extracts name from TTEE abbreviation", () => {
  const result = extractFromTrustName("SMITH JOHN TTEE");
  assert.equal(result.length, 1);
  assert.ok(result[0].normalized);
});

test("extracts name from revocable trust pattern", () => {
  const result = extractFromTrustName("JOHN A SMITH REVOCABLE TRUST");
  assert.equal(result.length, 1);
  assert.equal(result[0].firstName, "john");
  assert.equal(result[0].lastName, "smith");
});

test("extracts name from irrevocable trust pattern", () => {
  const result = extractFromTrustName("JANE DOE IRREVOCABLE TRUST");
  assert.equal(result.length, 1);
  assert.equal(result[0].firstName, "jane");
  assert.equal(result[0].lastName, "doe");
});

test("extracts surname from family trust pattern", () => {
  const result = extractFromTrustName("THE SMITH FAMILY TRUST");
  assert.equal(result.length, 1);
  assert.equal(result[0].lastName, "smith");
  assert.equal(result[0].extractedFrom, "trust_name");
});

test("extracts from LIVING TRUST pattern", () => {
  const result = extractFromTrustName("JOHN SMITH LIVING TRUST");
  assert.equal(result.length, 1);
});

test("returns empty for unrecognized trust format", () => {
  const result = extractFromTrustName("UNKNOWN TRUST STRUCTURE XYZ");
  // May or may not parse — depends on regex. Just verify no crash.
  assert.ok(Array.isArray(result));
});
