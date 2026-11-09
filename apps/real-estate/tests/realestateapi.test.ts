import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger, StateStore } from "@pm/core";

import { TransactionMonitoringEngine } from "../src/core/TransactionMonitoringEngine";
import { CacheStore } from "../src/fetchers/cache-store";
import { RealEstateApiClient } from "../src/fetchers/realestateapi";
import { RealEstateApiSource } from "../src/fetchers/transaction-sources";
import { assertWithinCreditBudget, estimateUncachedRecords } from "../src/lib/credit-preflight";
import {
  applyRealEstateApiSaleDetail,
  normalizeRealEstateApiProperty,
  parseRealEstateApiParty,
  splitRealEstateApiParties,
} from "../src/parsers/source-normalizers";

// Shape mirrors a live PropertySearch row (Oct 2026); names and addresses are synthetic.
function searchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "90000001",
    apn: "111-22-333",
    address: {
      address: "12 Oak Ridge Dr, Brookfield, WI 53045",
      street: "12 Oak Ridge Dr",
      city: "Brookfield",
      county: "Waukesha County",
      fips: "55133",
      state: "WI",
      zip: "53045",
    },
    mailAddress: {
      address: "12 Oak Ridge Dr, Brookfield, WI 53045",
      street: "12 Oak Ridge Dr",
      city: "Brookfield",
      state: "WI",
      zip: "53045",
    },
    lastSaleBuyerNames: "Alan Quartermain, Beth Quartermain",
    owner1FirstName: "Alan",
    owner1LastName: "Quartermain",
    owner2FirstName: "Beth",
    owner2LastName: "Quartermain",
    companyName: null,
    priorOwner: "Zelda Moorcroft",
    priorOwnerAddress: null,
    lastSaleDate: "2026-05-08",
    recordingDate: "2026-05-14",
    lastSaleAmount: "725000",
    lastSaleArmsLength: true,
    documentType: "Warranty Deed",
    documentTypeCode: "DTWD",
    estimatedValue: 740000,
    assessedValue: 610000,
    openMortgageBalance: 580000,
    ownerOccupied: true,
    absenteeOwner: false,
    propertyType: "SFR",
    propertyUse: "Single Family Residence",
    propertyUseCode: 385,
    ...overrides,
  };
}

test("splitRealEstateApiParties handles comma lists and Last, First pairs", () => {
  assert.deepEqual(splitRealEstateApiParties("Alan Quartermain, Beth Quartermain"), ["Alan Quartermain", "Beth Quartermain"]);
  assert.deepEqual(splitRealEstateApiParties("Moorcroft, Zelda"), ["Moorcroft,Zelda"]);
  assert.deepEqual(splitRealEstateApiParties("Kozely,Peter"), ["Kozely,Peter"]);
  assert.deepEqual(
    splitRealEstateApiParties("Marion C Waterfall,  M C Waterfall Living Trust"),
    ["Marion C Waterfall", "M C Waterfall Living Trust"],
  );
});

test("parseRealEstateApiParty reads first-name-first names without flipping them", () => {
  const [owner] = parseRealEstateApiParty("Grace Qianqian Zheng");
  assert.equal(owner.firstName, "grace");
  assert.equal(owner.lastName, "zheng");
  assert.equal(owner.normalized, "grace zheng");

  const [lastFirst] = parseRealEstateApiParty("Kozely,Peter");
  assert.equal(lastFirst.normalized, "peter kozely");
});

test("parseRealEstateApiParty splits joint names, resolves trusts and skips companies", () => {
  const joint = parseRealEstateApiParty("John & Mary Smith");
  assert.deepEqual(joint.map((o) => o.normalized), ["john smith", "mary smith"]);
  assert.deepEqual(joint.map((o) => o.extractedFrom), ["co_owner", "direct"]); // only the borrowed surname is weaker
  assert.deepEqual(parseRealEstateApiParty("Marion C Waterfall Living Trust").map((o) => o.normalized), ["marion waterfall"]);
  assert.deepEqual(parseRealEstateApiParty("Opendoor Property J LLC"), []);
});

test("normalizeRealEstateApiProperty maps buyers, sellers, dates and money fields", () => {
  const p = normalizeRealEstateApiProperty(searchRow());
  assert.equal(p.source, "realestateapi");
  assert.equal(p.sourcePropertyId, "90000001");
  assert.equal(p.countyFips, "55133");
  assert.equal(p.situsAddress, "12 Oak Ridge Dr");
  assert.deepEqual(p.parsedOwners.map((o) => o.normalized), ["alan quartermain", "beth quartermain"]);
  assert.deepEqual(p.parsedSellers.map((o) => o.normalized), ["zelda moorcroft"]);
  assert.equal(p.ownerMailingCity, "Brookfield");
  assert.equal(p.ownerMailingZip, "53045");
  assert.equal(p.saleTransactionDate, "2026-05-08");
  assert.equal(p.saleRecordDate, "2026-05-14");
  assert.equal(p.lastSalePrice, 725000);
  assert.equal(p.isArmsLength, true);
  assert.equal(p.saleTransactionType, "Warranty Deed");
  assert.equal(p.mortgageAmount, 580000);
  assert.equal(p.isOwnerOccupied, true);
  assert.equal(p.quitClaimFlag, undefined);
});

test("normalizeRealEstateApiProperty treats a $0 price as undisclosed and flags quitclaims", () => {
  const nonDisclosure = normalizeRealEstateApiProperty(searchRow({ lastSaleAmount: "0" }));
  assert.equal(nonDisclosure.lastSalePrice, undefined);
  const quitclaim = normalizeRealEstateApiProperty(searchRow({ documentType: "Quit Claim Deed", documentTypeCode: "DTQC" }));
  assert.equal(quitclaim.quitClaimFlag, "true");
});

test("normalizeRealEstateApiProperty falls back to owner fields when the buyer string is missing", () => {
  const p = normalizeRealEstateApiProperty(searchRow({ lastSaleBuyerNames: null }));
  assert.deepEqual(p.parsedOwners.map((o) => o.normalized), ["alan quartermain", "beth quartermain"]);
});

function mockFetch(responder: (body: Record<string, unknown>) => unknown, calls: Array<Record<string, unknown>>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return new Response(JSON.stringify(responder(body)), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("RealEstateApiClient sends fips + sale window + arm's-length, and pages by resultIndex", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = new RealEstateApiClient({
    apiKey: "test",
    fetchImpl: mockFetch((body) => body.count
      ? { resultCount: 600, recordCount: 0, data: [] }
      : { resultCount: 600, recordCount: 1, data: [searchRow()] }, calls),
  });
  const window = { fips: "55133", startDate: "2026-05-01", endDate: "2026-05-31" };

  assert.equal(await client.fetchCountyCount(window), 600);
  assert.deepEqual(calls[0], { fips: "55133", last_sale_date_min: "2026-05-01", last_sale_date_max: "2026-05-31", last_sale_arms_length: true, count: true });

  const page = await client.fetchCountyPage({ ...window, page: 3 });
  assert.equal(calls[1].size, 250);
  assert.equal(calls[1].resultIndex, 500);
  assert.equal(calls[1].count, undefined);
  assert.equal(page.pages, 3);
  assert.equal(page.total, 600);
});

test("RealEstateApiClient reads an empty window (200 with inner 404) as zero", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = new RealEstateApiClient({
    apiKey: "test",
    fetchImpl: mockFetch(() => ({ statusCode: 404, statusMessage: "Not Found", data: [], count: 0 }), calls),
  });
  const window = { fips: "42003", startDate: "2026-09-01", endDate: "2026-09-30" };
  assert.equal(await client.fetchCountyCount(window), 0);
  const page = await client.fetchCountyPage({ ...window, page: 1 });
  assert.equal(page.properties.length, 0);
  assert.equal(page.pages, 1);
});

test("credit preflight skips cached counties and enforces the budget", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-reapi-preflight-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const cache = new CacheStore(stateStore, "realestateapi");
  cache.markPageComplete("55089", "2026-05-01", "2026-05-31", 1, 1);
  const calls: Array<Record<string, unknown>> = [];
  const source = new RealEstateApiSource(new RealEstateApiClient({
    apiKey: "test",
    fetchImpl: mockFetch(() => ({ resultCount: 562, recordCount: 0, data: [] }), calls),
  }));

  const estimate = await estimateUncachedRecords({
    source, cache, counties: ["55133", "55089"], startDate: "2026-05-01", endDate: "2026-05-31",
  });
  assert.equal(estimate?.total, 562);
  assert.equal(calls.length, 1);
  assert.ok(calls.every((body) => body.count === true));
  assert.throws(() => assertWithinCreditBudget(estimate, 500), /562 billable records/);
  assert.doesNotThrow(() => assertWithinCreditBudget(estimate, 600));
});

test("TransactionMonitoringEngine matches a RealEstateAPI seller at their CRM address", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-reapi-engine-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const prospectsPath = path.join(tempDir, "prospects.csv");
  fs.writeFileSync(prospectsPath, [
    "prospect_id,name,address,city,state,zip",
    "p1,Zelda Moorcroft,12 Oak Ridge Dr,Brookfield,WI,53045",
  ].join("\n"), "utf8");

  const calls: Array<Record<string, unknown>> = [];
  const engine = new TransactionMonitoringEngine({
    source: new RealEstateApiSource(new RealEstateApiClient({
      apiKey: "test",
      fetchImpl: mockFetch(() => ({ resultCount: 1, recordCount: 1, data: [searchRow()] }), calls),
    })),
    cache: new CacheStore(stateStore, "realestateapi"),
    logger: createLogger(false),
  });

  const runOptions = {
    runId: "reapi-test",
    logger: createLogger(false),
    prospectsPath,
    counties: ["55133"],
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    outputDir: path.join(tempDir, "runs"),
    maxDetailLookups: 0, // search-row sellers only; also exercises the detail budget cap
  };
  const manifest = await engine.execute(runOptions);
  assert.equal(manifest.counts.apiCalls, 1);
  assert.equal(manifest.counts.acceptedMatches, 1);

  const csv = fs.readFileSync(manifest.outputs.clientCsv, "utf8");
  assert.match(csv, /Zelda Moorcroft/);
  assert.match(csv, /seller/);
  assert.match(csv, /street-verified/);
  assert.doesNotMatch(csv, /flag:warranty_deed/);

  // A rerun of the same window is served from cache and spends nothing.
  const rerun = await engine.execute({ ...runOptions, runId: "reapi-test-2" });
  assert.equal(rerun.counts.apiCalls, 0);
  assert.equal(calls.length, 1);
});

test("parseRealEstateApiParty extracts named grantors from first-name-first trust names", () => {
  const names = (raw: string) => parseRealEstateApiParty(raw).map((o) => o.normalized);
  assert.deepEqual(names("Peter J And Jill R Machi Revocable Trust"), ["peter machi", "jill machi"]);
  assert.deepEqual(names("Paul E Lehner & Deann R Lehner Liv Tr"), ["paul lehner", "deann lehner"]);
  assert.deepEqual(names("The Robert And Lynelle Sukalich Revocabl"), ["robert sukalich", "lynelle sukalich"]);
  assert.deepEqual(names("Marion C Waterfall Living Trust"), ["marion waterfall"]);
  assert.deepEqual(names("Smith Family Trust"), []);
  assert.ok(parseRealEstateApiParty("Marion C Waterfall Living Trust").every((o) => o.role === "trustee"));
});

test("applyRealEstateApiSaleDetail swaps in deed sellers only for the same sale", () => {
  const property = normalizeRealEstateApiProperty(searchRow({ priorOwner: null }));
  assert.equal(property.parsedSellers.length, 0);
  const sameSale = { data: { lastSale: { saleDate: "2026-05-08T00:00:00.000Z", sellerNames: "Zelda K Moorcroft", buyerNames: "Alan Quartermain, Beth Quartermain", documentNumber: "D-1" } } };
  const enriched = applyRealEstateApiSaleDetail(property, sameSale);
  assert.deepEqual(enriched.parsedSellers.map((o) => o.normalized), ["zelda moorcroft"]);
  // Deed and search sellers are unioned, so a deed typo cannot hide the search-row spelling.
  const typo = applyRealEstateApiSaleDetail(
    normalizeRealEstateApiProperty(searchRow({ priorOwner: "Ruric C Anderson Iii" })),
    { data: { lastSale: { saleDate: "2026-05-08", sellerNames: "Rurie C Anderson Ii" } } },
  );
  assert.deepEqual(typo.parsedSellers.map((o) => o.normalized).sort(), ["ruric anderson", "rurie anderson"]);
  assert.equal(enriched.saleDocumentNumber, "D-1");
  const otherSale = { data: { lastSale: { saleDate: "2019-01-01T00:00:00.000Z", sellerNames: "Someone Else" } } };
  assert.equal(applyRealEstateApiSaleDetail(property, otherSale).parsedSellers.length, 0);
});

test("engine looks up deed detail only for sales at a prospect address, and caches it", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-reapi-detail-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const prospectsPath = path.join(tempDir, "prospects.csv");
  fs.writeFileSync(prospectsPath, [
    "prospect_id,name,address,city,state,zip",
    "p1,Zelda Moorcroft,12 Oak Ridge Drive,Brookfield,WI,53045-1234",
  ].join("\n"), "utf8");

  const otherSale = searchRow({
    id: "90000002",
    priorOwner: null,
    address: { street: "99 Elsewhere Ln", city: "Waukesha", state: "WI", zip: "53188", fips: "55133" },
  });
  const searchCalls: Array<Record<string, unknown>> = [];
  const detailIds: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(url).endsWith("/PropertyDetail")) {
      detailIds.push(String(body.id));
      return new Response(JSON.stringify({ data: { lastSale: { saleDate: "2026-05-08", sellerNames: "Zelda K Moorcroft" } } }), { status: 200 });
    }
    searchCalls.push(body);
    return new Response(JSON.stringify({ resultCount: 2, recordCount: 2, data: [searchRow({ priorOwner: null }), otherSale] }), { status: 200 });
  }) as unknown as typeof fetch;

  const engine = new TransactionMonitoringEngine({
    source: new RealEstateApiSource(new RealEstateApiClient({ apiKey: "test", fetchImpl })),
    cache: new CacheStore(stateStore, "realestateapi"),
    logger: createLogger(false),
  });
  const runOptions = {
    runId: "reapi-detail",
    logger: createLogger(false),
    prospectsPath,
    counties: ["55133"],
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    outputDir: path.join(tempDir, "runs"),
  };

  const manifest = await engine.execute(runOptions);
  assert.deepEqual(detailIds, ["90000001"]);
  assert.equal(manifest.counts.detailLookups, 1);
  assert.equal(manifest.counts.apiCalls, 2);
  const csv = fs.readFileSync(manifest.outputs.clientCsv, "utf8");
  assert.match(csv, /Zelda Moorcroft.*seller.*high,street-verified/);

  const rerun = await engine.execute({ ...runOptions, runId: "reapi-detail-2" });
  assert.equal(rerun.counts.apiCalls, 0);
  assert.equal(detailIds.length, 1);
  assert.equal(searchCalls.length, 1);
});
