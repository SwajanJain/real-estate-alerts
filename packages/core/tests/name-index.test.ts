import test from "node:test";
import assert from "node:assert/strict";

import { generateNameVariants, NICKNAME_LOOKUP } from "../src/name-index";

test("nickname variants do not cascade across unrelated groups", () => {
  // "chris" appears in both ["christopher", "chris"] and ["christine", "christina", "chris", "tina"]
  // If "Christopher Smith" generates "Chris Smith", the nickname loop should NOT
  // then process "Chris Smith" and generate "Tina Smith" via the Christine group.
  const variants = generateNameVariants("Christopher Smith");
  const values = variants.map((v) => v.value);
  assert.ok(values.includes("chris smith"), "Should include chris smith");
  assert.ok(!values.includes("tina smith"), "Should NOT include tina smith (cascading)");
  assert.ok(!values.includes("christina smith"), "Should NOT include christina smith (cascading)");
});

test("nickname variants are generated from base form only", () => {
  const variants = generateNameVariants("William Johnson");
  const values = variants.map((v) => v.value);
  assert.ok(values.includes("bill johnson"), "Should include bill johnson");
  assert.ok(values.includes("will johnson"), "Should include will johnson");
  assert.ok(values.includes("billy johnson"), "Should include billy johnson");
});

test("nickname lookup contains expected mappings", () => {
  assert.ok(NICKNAME_LOOKUP["william"]?.includes("bill"));
  assert.ok(NICKNAME_LOOKUP["robert"]?.includes("bob"));
  assert.ok(NICKNAME_LOOKUP["elizabeth"]?.includes("liz"));
});

test("generateNameVariants produces suffix-stripped form", () => {
  const variants = generateNameVariants("John Smith Jr");
  const values = variants.map((v) => v.value);
  assert.ok(values.includes("john smith"), "Should include suffix-stripped form");
});

test("generateNameVariants produces middle-dropped form", () => {
  const variants = generateNameVariants("John Michael Smith");
  const values = variants.map((v) => v.value);
  assert.ok(values.includes("john smith"), "Should include middle-dropped form");
});
