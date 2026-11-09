import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeBatchDataProperty } from "../src/parsers/source-normalizers";

// Single-buyer / single-seller arms-length sale, captured from a live probe.
const SINGLE_BUYER = {
  _id: "c25e8818f1fd4b16badddb1b516cacf7",
  address: {
    street: "24755 N 164th Dr",
    city: "Surprise",
    county: "Maricopa",
    state: "AZ",
    zip: "85387",
    countyFipsCode: "04013",
  },
  ids: { apn: "503-68-448-A" },
  owner: {
    fullName: "Anthony Giudice",
    mailingAddress: {
      street: "24755 N 164th Dr",
      city: "Surprise",
      state: "AZ",
      zip: "85387",
    },
  },
  sale: {
    lastSale: {
      documentNumber: "308016",
      documentType: "Special Warranty Deed",
      documentTypeCode: "BQ",
      price: 389490,
      recordingDate: "2026-05-21T00:00:00.000Z",
      saleDate: "2026-05-15T00:00:00.000Z",
      saleBuyers: ["Giudice Anthony"],
      saleSellers: ["Lennar Arizona Llc"],
      transactionType: "Arms-length residential transactions (purchase/resales)",
      transactionTypeCode: "B",
    },
  },
  assessment: { totalAssessedValue: 12603 },
  general: { propertyTypeCategory: "Residential", propertyTypeDetail: "Vacant Land" },
};

// Joint-seller (husband + wife) sale, also from live data.
const JOINT_SELLERS = {
  _id: "x_joint_001",
  address: { street: "100 Main St", city: "Pittsburgh", state: "PA", zip: "15213", countyFipsCode: "42003" },
  ids: { apn: "0001-A" },
  owner: { fullName: "Jennifer Giordano", mailingAddress: { street: "100 Main St", city: "Pittsburgh", state: "PA", zip: "15213" } },
  sale: {
    lastSale: {
      documentTypeCode: "AC",
      price: 250000,
      recordingDate: "2026-06-01T00:00:00.000Z",
      saleDate: "2026-05-28T00:00:00.000Z",
      saleBuyers: ["Giordano Jennifer"],
      saleSellers: ["White David", "White Kara M"],
      transactionType: "Arms-length residential transactions (purchase/resales)",
      transactionTypeCode: "B",
    },
  },
  assessment: { totalAssessedValue: 75000 },
  general: { propertyTypeDetail: "Single Family Residence" },
};

test("normalizeBatchDataProperty extracts every contracted field for a single-buyer sale", () => {
  const r = normalizeBatchDataProperty(SINGLE_BUYER);
  assert.equal(r.source, "batchdata");
  assert.equal(r.sourcePropertyId, "c25e8818f1fd4b16badddb1b516cacf7");
  assert.equal(r.countyFips, "04013");
  assert.equal(r.situsAddress, "24755 N 164th Dr");
  assert.equal(r.situsState, "AZ");
  assert.equal(r.situsZip, "85387");
  assert.equal(r.lastSalePrice, 389490);
  assert.equal(r.saleRecordDate, "2026-05-21");
  assert.equal(r.saleTransactionDate, "2026-05-15");
  assert.equal(r.lastSaleDate, "2026-05-21");  // prefers recording date
  assert.equal(r.saleDocumentNumber, "308016");
  assert.equal(r.isArmsLength, true);
  assert.equal(r.assessedTotal, 12603);
  assert.equal(r.propertyType, "Vacant Land");
});

test("buyer string in title-case LASTFIRST is parsed to a person, not an entity", () => {
  const r = normalizeBatchDataProperty(SINGLE_BUYER);
  assert.equal(r.parsedOwners.length, 1);
  assert.equal(r.parsedOwners[0].firstName?.toLowerCase(), "anthony");
  assert.equal(r.parsedOwners[0].lastName?.toLowerCase(), "giudice");
});

test("LLC seller is correctly identified as an entity (no parsed person)", () => {
  const r = normalizeBatchDataProperty(SINGLE_BUYER);
  assert.equal(r.parsedSellers.length, 0);  // "Lennar Arizona Llc" must not be parsed as a person
});

test("joint sellers are extracted as TWO parsed people", () => {
  const r = normalizeBatchDataProperty(JOINT_SELLERS);
  assert.equal(r.parsedSellers.length, 2);
  const lastNames = new Set(r.parsedSellers.map((s) => s.lastName?.toLowerCase()));
  assert.ok(lastNames.has("white"));
});

test("owner-occupied is true when buyer mailing equals situs", () => {
  const r = normalizeBatchDataProperty(SINGLE_BUYER);
  assert.equal(r.isOwnerOccupied, true);
  assert.equal(r.isAbsenteeOwner, false);
});

test("buyer mailing address (= post-sale owner mailing) is preserved for corroboration", () => {
  const r = normalizeBatchDataProperty(SINGLE_BUYER);
  assert.equal(r.ownerMailingAddress, "24755 N 164th Dr");
  assert.equal(r.ownerMailingCity, "Surprise");
  assert.equal(r.ownerMailingState, "AZ");
  assert.equal(r.ownerMailingZip, "85387");
});

test("absent dataset (basic-token shape) does not crash and yields no parties", () => {
  const stub = {
    _id: "stub",
    address: { street: "1 X", city: "Y", state: "AZ", zip: "00000", countyFipsCode: "04013" },
    ids: { apn: "x" },
    owner: { fullName: "Some Person", mailingAddress: { street: "1 X", city: "Y", state: "AZ", zip: "00000" } },
  };
  const r = normalizeBatchDataProperty(stub);
  assert.equal(r.parsedOwners.length, 0);
  assert.equal(r.parsedSellers.length, 0);
  assert.equal(r.lastSalePrice, undefined);
  assert.equal(r.saleRecordDate, undefined);
});
