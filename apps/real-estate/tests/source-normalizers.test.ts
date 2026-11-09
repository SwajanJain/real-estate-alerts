import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAttomProperty } from "../src/parsers/source-normalizers";

test("normalizeAttomProperty maps ATTOM payload into canonical property record", () => {
  const property = normalizeAttomProperty({
    identifier: { attomId: "123", apn: "APN-1" },
    address: {
      oneLine: "1 Main St, Austin, TX 78701",
      locality: "Austin",
      countrySubd: "TX",
      postal1: "78701",
      fips: "48453",
      county: "Travis",
    },
    summary: { propType: "SFR", propclass: "RES", quitClaimFlag: "False" },
    assessment: {
      owner: {
        owner1: { fullName: "John Smith", lastName: "Smith", firstNameAndMi: "John A" },
        mailingAddressOneLine: "500 Elm St, Austin, TX 78702",
        absenteeOwnerStatus: "O",
      },
      assessed: { assdTtlValue: "1200000", assdImprValue: "850000" },
    },
    avm: { amount: { value: "1500000" } },
    sale: {
      sellerName: "Mary Seller",
      saleTransDate: "2026-03-08",
      transactionIdent: "txn-1",
      amount: { saleRecDate: "2026-03-10", saleAmt: "980000", saleDocNum: "DOC-1", saleTransType: "Resale" },
    },
    mortgage: { amount: "400000", lendername: "Test Bank" },
    calendarDate: "2026/03/09",
  });

  assert.equal(property.sourcePropertyId, "123");
  assert.equal(property.parsedOwners[0].normalized, "john smith");
  assert.equal(property.parsedSellers[0].normalized, "seller mary");
  assert.equal(property.ownerMailingCity, "AUSTIN");
  assert.equal(property.estimatedValue, 1500000);
  assert.equal(property.lastSalePrice, 980000);
  assert.equal(property.saleRecordDate, "2026-03-10");
  assert.equal(property.saleDocumentNumber, "DOC-1");
  assert.equal(property.mortgageLender, "Test Bank");
});
