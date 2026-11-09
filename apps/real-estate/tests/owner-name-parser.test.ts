import test from "node:test";
import assert from "node:assert/strict";

import { parseOwnerName } from "../src/parsers/owner-name-parser";

test("parseOwnerName handles direct owners and co-owners", () => {
  const owners = parseOwnerName("SMITH JOHN A & JANE");
  assert.equal(owners.length, 2);
  assert.equal(owners[0].lastName, "smith");
  assert.equal(owners[0].firstName, "john");
  assert.equal(owners[1].lastName, "smith");
});

test("parseOwnerName extracts trust names", () => {
  const owners = parseOwnerName("JOHN A SMITH REVOCABLE TRUST");
  assert.equal(owners.length, 1);
  assert.equal(owners[0].firstName, "john");
  assert.equal(owners[0].lastName, "smith");
});

test("parseOwnerName returns empty for llc", () => {
  const owners = parseOwnerName("SMITH HOLDINGS LLC");
  assert.deepEqual(owners, []);
});
