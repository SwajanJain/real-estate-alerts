import test from "node:test";
import assert from "node:assert/strict";

import { matchEmployer } from "../src/employer-matcher";

test("matchEmployer confirms normalized company match", () => {
  const result = matchEmployer("Google", "GOOGLE INC");
  assert.equal(result.status, "confirmed");
});

test("matchEmployer flags mismatch", () => {
  const result = matchEmployer("Google", "Microsoft");
  assert.equal(result.status, "mismatch");
});

test("matchEmployer handles non informative values", () => {
  const result = matchEmployer("Google", "RETIRED");
  assert.equal(result.status, "non_informative");
});
