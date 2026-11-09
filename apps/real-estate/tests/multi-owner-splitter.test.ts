import test from "node:test";
import assert from "node:assert/strict";

import { splitMultiOwner } from "../src/lib/multi-owner-splitter";

test("splits two owners on &", () => {
  const result = splitMultiOwner("SMITH JOHN & JANE", "joint");
  assert.equal(result.length, 2);
  assert.equal(result[0], "SMITH JOHN");
  assert.equal(result[1], "SMITH JANE");
});

test("splits two owners on AND", () => {
  const result = splitMultiOwner("SMITH JOHN AND JANE", "joint");
  assert.equal(result.length, 2);
  assert.equal(result[0], "SMITH JOHN");
  assert.equal(result[1], "SMITH JANE");
});

test("does not split LLC entities", () => {
  const result = splitMultiOwner("SMITH & JONES LLC", "llc");
  assert.equal(result.length, 1);
  assert.equal(result[0], "SMITH & JONES LLC");
});

test("does not split corporation entities", () => {
  const result = splitMultiOwner("A & B CORP", "corporation");
  assert.equal(result.length, 1);
});

test("preserves surname for short second name", () => {
  const result = splitMultiOwner("WILLIAMS ROBERT & MARY", "joint");
  assert.equal(result[1], "WILLIAMS MARY");
});

test("does not prepend surname when second name is long", () => {
  const result = splitMultiOwner("WILLIAMS ROBERT & JONES MARY ANN", "joint");
  assert.equal(result[1], "JONES MARY ANN");
});

test("returns single element when no separator", () => {
  const result = splitMultiOwner("SMITH JOHN", "individual");
  assert.equal(result.length, 1);
  assert.equal(result[0], "SMITH JOHN");
});
