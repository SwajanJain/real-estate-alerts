import test from "node:test";
import assert from "node:assert/strict";

import { parseFecName } from "../src/name-parser";

test("parseFecName handles standard suffix format", () => {
  const parsed = parseFecName("SMITH, JOHN A JR");
  assert.ok(parsed);
  assert.equal(parsed.firstName, "john");
  assert.equal(parsed.middleInitial, "a");
  assert.equal(parsed.lastName, "smith");
  assert.equal(parsed.suffix, "jr");
  assert.equal(parsed.normalized, "john smith");
});

test("parseFecName handles compound last names", () => {
  const parsed = parseFecName("DE LA CRUZ, MARIA");
  assert.ok(parsed);
  assert.equal(parsed.lastName, "de la cruz");
  assert.equal(parsed.firstName, "maria");
});

test("parseFecName rejects organizations", () => {
  assert.equal(parseFecName("ACTBLUE"), null);
});
