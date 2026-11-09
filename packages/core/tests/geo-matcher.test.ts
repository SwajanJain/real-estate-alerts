import test from "node:test";
import assert from "node:assert/strict";

import { matchLocation, normalizeState, normalizeCity, normalizeZip5 } from "../src/geo-matcher";

test("normalizeState handles abbreviations and full names", () => {
  assert.equal(normalizeState("KY"), "KY");
  assert.equal(normalizeState("ky"), "KY");
  assert.equal(normalizeState("Kentucky"), "KY");
  assert.equal(normalizeState("kentucky"), "KY");
  assert.equal(normalizeState("  CA  "), "CA");
  assert.equal(normalizeState(""), "");
  assert.equal(normalizeState("New York"), "NY");
  assert.equal(normalizeState("District of Columbia"), "DC");
});

test("normalizeCity uppercases and strips punctuation", () => {
  assert.equal(normalizeCity("Louisville"), "LOUISVILLE");
  assert.equal(normalizeCity("St. Louis"), "ST LOUIS");
  assert.equal(normalizeCity("  new york city  "), "NEW YORK CITY");
  assert.equal(normalizeCity(""), "");
});

test("normalizeZip5 extracts first 5 digits", () => {
  assert.equal(normalizeZip5("40202"), "40202");
  assert.equal(normalizeZip5("402021234"), "40202");
  assert.equal(normalizeZip5("40202-1234"), "40202");
  assert.equal(normalizeZip5("1234"), "");
  assert.equal(normalizeZip5(""), "");
});

test("matchLocation returns zip_match when zips match", () => {
  const result = matchLocation("Louisville", "KY", "40202", "LOUISVILLE", "KY", "402021234");
  assert.equal(result.status, "zip_match");
});

test("matchLocation returns city_state_match when city and state match", () => {
  const result = matchLocation("Louisville", "KY", "", "LOUISVILLE", "Kentucky", "40202");
  assert.equal(result.status, "city_state_match");
});

test("matchLocation returns state_match when only state matches", () => {
  const result = matchLocation("Lexington", "KY", "", "Louisville", "KY", "");
  assert.equal(result.status, "state_match");
});

test("matchLocation returns state_mismatch when states differ", () => {
  const result = matchLocation("Louisville", "KY", "", "Portland", "OR", "");
  assert.equal(result.status, "state_mismatch");
});

test("matchLocation returns no_data when location data is missing", () => {
  const result = matchLocation("", "", "", "", "", "");
  assert.equal(result.status, "no_data");
});

test("matchLocation handles one side missing state gracefully", () => {
  const result = matchLocation("Louisville", "", "", "Louisville", "KY", "40202");
  assert.equal(result.status, "no_data");
});
