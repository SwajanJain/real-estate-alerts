import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CountyLookup, loadCountyList } from "../src/lib/county-list";

// __dirname after tsc compile is dist/tests/, so walk up two levels to the app root.
const PILOT_CSV = path.resolve(__dirname, "..", "..", "data", "cmu-hotchkiss-counties.csv");

test("loadCountyList reads the frozen pilot CSV and yields 248 entries", () => {
  assert.ok(fs.existsSync(PILOT_CSV), "frozen county list must exist");
  const entries = loadCountyList(PILOT_CSV);
  assert.equal(entries.length, 248);
  for (const entry of entries) {
    assert.match(entry.fips, /^\d{5}$/, `bad FIPS: ${entry.fips}`);
    assert.equal(entry.state.length, 2);
    assert.ok(entry.countyName.length > 0);
  }
});

test("CountyLookup.resolve returns the canonical (county, state) for a FIPS", () => {
  const lookup = CountyLookup.fromCsv(PILOT_CSV);
  // Allegheny PA is rank 1 for CMU+Hotchkiss
  const allegheny = lookup.resolve("42003");
  assert.equal(allegheny.countyName.toLowerCase(), "allegheny");
  assert.equal(allegheny.state, "PA");
  // Manhattan NY is in the list as well
  const manhattan = lookup.resolve("36061");
  assert.equal(manhattan.state, "NY");
  assert.match(manhattan.countyName.toLowerCase(), /new york/);
});

test("CountyLookup.resolve throws for an unknown FIPS rather than guessing", () => {
  const lookup = CountyLookup.fromCsv(PILOT_CSV);
  assert.throws(() => lookup.resolve("99999"), /99999/);
});
