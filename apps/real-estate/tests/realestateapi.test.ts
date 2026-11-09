import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger, StateStore } from "@pm/core";

import { TransactionMonitoringEngine } from "../src/core/TransactionMonitoringEngine";
import { CacheStore } from "../src/fetchers/cache-store";
import { RealEstateApiClient } from "../src/fetchers/realestateapi";
import { createRealEstateApiSource, RealEstateApiSource } from "../src/fetchers/transaction-sources";
import { assertWithinCreditBudget, estimateUncachedRecords } from "../src/lib/credit-preflight";
import {
  applyRealEstateApiSaleDetail,
  normalizeRealEstateApiDetail,
  normalizeRealEstateApiProperty,
  parseRealEstateApiParties,
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

test("parseRealEstateApiParties keeps the strongest reading of a repeated name", () => {
  const read = (raw: string) => parseRealEstateApiParties(raw).map((o) => [o.normalized, o.extractedFrom, o.role ?? ""]);
  // Live Waukesha deed (May 2026): the trust gives a borrowed-surname "Robert Waite";
  // the full "Robert J Waite Jr" that follows must win.
  const waite = [["robert waite", "direct", ""], ["susan waite", "direct", "trustee"]];
  assert.deepEqual(read("Robert And Susan Waite Revocable Trust, Robert J Waite Jr"), waite);
  assert.deepEqual(read("Robert J Waite Jr, Robert And Susan Waite Revocable Trust"), waite); // order of appearance does not matter
  assert.equal(parseRealEstateApiParties("Robert And Susan Waite Revocable Trust, Robert J Waite Jr")[0].raw, "Robert J Waite Jr");
  // Same points: the first reading is kept (unchanged behaviour).
  assert.deepEqual(read("Marion C Waterfall Living Trust, Marion C Waterfall"), [["marion waterfall", "direct", "trustee"]]);
  // Live deed: father and son share the key "robert uecker"; the first reading is kept.
  assert.equal(parseRealEstateApiParties("Robert G Uecker Sr Trust, Robert G Uecker Jr")[0].raw, "Robert G Uecker Sr");
  // Conflicting middle initials are different people: the stronger later one does not replace the first.
  const smith = parseRealEstateApiParties("John A & Mary Smith Trust, John B Smith");
  assert.deepEqual(smith.map((o) => [o.raw, o.extractedFrom]), [["John A Smith", "co_owner"], ["Mary Smith", "direct"]]);
});

test("applyRealEstateApiSaleDetail keeps the stronger reading when deed and search name the same person", () => {
  const property = normalizeRealEstateApiProperty(searchRow({ priorOwner: "Robert J Waite Jr, Susan H Waite" }));
  const enriched = applyRealEstateApiSaleDetail(property, {
    data: { lastSale: { saleDate: "2026-05-08", sellerNames: "Robert And Susan Waite Revocable Trust" } },
  });
  assert.deepEqual(enriched.parsedSellers.map((o) => [o.normalized, o.extractedFrom]), [["robert waite", "direct"], ["susan waite", "direct"]]);
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

// Records the URL and body of every call; replies with the next canned response.
function scriptedFetch(replies: unknown[], calls: Array<{ url: string; body: Record<string, unknown> }>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("RealEstateApiClient lists IDs by recording date with ids_only, paging past a full page", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new RealEstateApiClient({
    apiKey: "test",
    dateField: "recording",
    fetchImpl: scriptedFetch([{ resultCount: 3, data: [11, 12] }, { resultCount: 3, data: [13] }], calls),
  });
  const ids = await client.fetchCountyIds({ fips: "55133", startDate: "2026-05-01", endDate: "2026-05-31" });
  assert.deepEqual(ids, ["11", "12", "13"]);
  assert.match(calls[0].url, /\/PropertySearch$/);
  assert.deepEqual(calls[0].body, {
    fips: "55133", recording_date_min: "2026-05-01", recording_date_max: "2026-05-31",
    last_sale_arms_length: true, ids_only: true, size: 10000,
  });
  assert.equal(calls[1].body.resultIndex, 2);
});

test("RealEstateApiClient reads an empty ids_only window (200 with inner 404) as no IDs", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new RealEstateApiClient({ apiKey: "test", dateField: "recording", fetchImpl: scriptedFetch([{ statusCode: 404, data: [] }], calls) });
  assert.deepEqual(await client.fetchCountyIds({ fips: "42003", startDate: "2026-09-01", endDate: "2026-09-30" }), []);
  assert.equal(calls.length, 1);
});

test("RealEstateApiClient fetches PropertyDetailBulk with numeric IDs and refuses more than 1,000", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new RealEstateApiClient({ apiKey: "test", fetchImpl: scriptedFetch([{ statusCode: 200, data: [{ id: 2 }, { id: 1 }] }], calls) });
  const records = await client.fetchDetailBulk(["1", "2"]);
  assert.equal(records.length, 2);
  assert.match(calls[0].url, /\/PropertyDetailBulk$/);
  assert.deepEqual(calls[0].body, { ids: [1, 2] });
  await assert.rejects(client.fetchDetailBulk(Array.from({ length: 1001 }, (_, i) => String(i + 1))), /1,000/);
  assert.deepEqual(await client.fetchDetailBulk([]), []);
  assert.equal(calls.length, 1);
});

// Shape mirrors a live PropertyDetailBulk record (Nov 2026); names and addresses are synthetic.
function detailRecord(overrides: Record<string, unknown> = {}, sale: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 90000001,
    estimatedValue: 740000,
    openMortgageBalance: 0,
    ownerOccupied: true,
    absenteeOwner: false,
    propertyType: "SFR",
    lastSale: {
      documentNumber: "D-1001",
      armsLength: true,
      buyerNames: "Alan Quartermain, Beth Quartermain",
      sellerNames: "Zelda K Moorcroft",
      documentType: "Warranty Deed",
      documentTypeCode: "DTWD",
      recordingDate: "2026-05-04",
      saleAmount: 725000,
      saleDate: "2026-04-28T00:00:00.000Z",
      ...sale,
    },
    ownerInfo: {
      owner1FullName: "Alan Quartermain",
      mailAddress: { address: "77 Elm St", city: "Brookfield", state: "WI", zip: "53045", label: "77 Elm St Unit 4, Brookfield, WI 53045", street: "Elm" },
    },
    propertyInfo: {
      address: { address: "12 Oak Ridge Dr", city: "Brookfield", county: "Waukesha County", fips: "55133", state: "WI", zip: "53045", street: "Oak Ridge", label: "12 Oak Ridge Dr, Brookfield, WI 53045" },
      propertyUse: "Single Family Residence",
      propertyUseCode: 385,
    },
    taxInfo: { assessedValue: 610000, assessedLandValue: 150000, assessedImprovementValue: 460000 },
    lotInfo: { apn: "111-22-333" },
    saleHistory: [],
    ...overrides,
  };
}

test("normalizeRealEstateApiDetail reads deed buyers and sellers, the full street line and cut dates", () => {
  const p = normalizeRealEstateApiDetail(detailRecord());
  assert.equal(p.sourcePropertyId, "90000001");
  assert.equal(p.situsAddress, "12 Oak Ridge Dr"); // address.address, not address.street ("Oak Ridge")
  assert.equal(p.ownerMailingAddress, "77 Elm St Unit 4, Brookfield, WI 53045"); // full label, unit included
  assert.deepEqual(p.parsedSellers.map((o) => o.normalized), ["zelda moorcroft"]);
  assert.deepEqual(p.parsedOwners.map((o) => o.normalized), ["alan quartermain", "beth quartermain"]);
  assert.equal(p.saleDocumentNumber, "D-1001");
  assert.equal(p.saleTransactionDate, "2026-04-28");
  assert.equal(p.saleRecordDate, "2026-05-04");
  assert.equal(p.lastSalePrice, 725000);
  assert.equal(p.assessedTotal, 610000);
  assert.equal(p.countyFips, "55133");
  assert.equal(p.isArmsLength, true);
  assert.equal(p.quitClaimFlag, undefined);
});

test("normalizeRealEstateApiDetail: undisclosed price, quitclaim, owner fallback, single-detail wrapper", () => {
  assert.equal(normalizeRealEstateApiDetail(detailRecord({}, { saleAmount: 0 })).lastSalePrice, undefined);
  assert.equal(normalizeRealEstateApiDetail(detailRecord({}, { documentType: "Quit Claim Deed", documentTypeCode: "DTQC" })).quitClaimFlag, "true");
  assert.deepEqual(normalizeRealEstateApiDetail(detailRecord({}, { buyerNames: null })).parsedOwners.map((o) => o.normalized), ["alan quartermain"]);
  assert.equal(normalizeRealEstateApiDetail({ input: { id: 90000001 }, data: detailRecord() }).sourcePropertyId, "90000001");
});

// Serves ids_only, count and PropertyDetailBulk calls from a fixed record set.
function bulkApi(records: Array<Record<string, unknown>>, calls: Array<{ url: string; body: Record<string, unknown> }>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).endsWith("/PropertyDetailBulk")) {
      const wanted = new Set((body.ids as number[]).map(String));
      return reply({ statusCode: 200, data: records.filter((r) => wanted.has(String(r.id))).reverse() }); // vendor order differs
    }
    if (body.count) return reply({ resultCount: records.length, recordCount: 0, data: [] });
    return reply({ resultCount: records.length, recordCount: records.length, data: records.map((r) => r.id) });
  }) as unknown as typeof fetch;
}

test("RealEstateApiBulkSource pages 1,000 IDs at a time, restores ID order, and lists IDs once", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-reapi-bulk-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const cache = new CacheStore(stateStore, "realestateapi");
  const records = Array.from({ length: 2500 }, (_, i) => ({ id: 1000 + i })).filter((r) => r.id !== 1500); // one ID has no record
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const idsOnly = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (!String(url).endsWith("/PropertyDetailBulk")) {
      calls.push({ url: String(url), body });
      return new Response(JSON.stringify({ resultCount: 2500, data: Array.from({ length: 2500 }, (_, i) => 1000 + i) }), { status: 200 });
    }
    return bulkApi(records, calls)(url, init);
  }) as unknown as typeof fetch;
  const source = createRealEstateApiSource({ apiKey: "test", fetchImpl: idsOnly }, "bulk", cache);
  const window = { fips: "55133", startDate: "2026-05-01", endDate: "2026-05-31" };

  const first = await source.fetchCountyPage({ ...window, page: 1 });
  assert.equal(source.windowDate, "recording");
  assert.equal(first.pages, 3);
  assert.equal(first.properties.length, 999); // short page, but not the last one
  assert.deepEqual(first.properties.slice(0, 2).map((r) => (r as { id: number }).id), [1000, 1001]);
  const last = await source.fetchCountyPage({ ...window, page: 3 });
  assert.equal(last.properties.length, 500);
  const searches = calls.filter((c) => c.url.endsWith("/PropertySearch"));
  assert.equal(searches.length, 1); // the ID list is saved and reused
  assert.equal(searches[0].body.recording_date_min, "2026-05-01");
  assert.ok(calls.filter((c) => c.url.endsWith("/PropertyDetailBulk")).every((c) => (c.body.ids as number[]).length <= 1000));
});

test("Bulk path matches a deed seller in the month the deed was recorded, counts credits, and reruns from cache", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-reapi-bulk-engine-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const prospectsPath = path.join(tempDir, "prospects.csv");
  fs.writeFileSync(prospectsPath, ["prospect_id,name,address,city,state,zip", "p1,Zelda Moorcroft,12 Oak Ridge Drive,Brookfield,WI,53045"].join("\n"), "utf8");

  const records = [
    detailRecord(), // closed 28 April, recorded 4 May; deed seller Zelda K Moorcroft
    detailRecord(
      { id: 90000002, propertyInfo: { address: { address: "99 Elsewhere Ln", city: "Waukesha", fips: "55133", state: "WI", zip: "53188" } } },
      { sellerNames: "Someone Else", saleDate: "2026-05-02T00:00:00.000Z", recordingDate: "2026-05-10" },
    ),
  ];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const cache = new CacheStore(stateStore, "realestateapi");
  const engine = new TransactionMonitoringEngine({
    source: createRealEstateApiSource({ apiKey: "test", fetchImpl: bulkApi(records, calls) }, "bulk", cache),
    cache,
    logger: createLogger(false),
  });
  const runOptions = {
    runId: "reapi-bulk", logger: createLogger(false), prospectsPath, counties: ["55133"],
    startDate: "2026-05-01", endDate: "2026-05-31", outputDir: path.join(tempDir, "runs"),
  };

  const manifest = await engine.execute(runOptions);
  assert.equal(manifest.counts.acceptedMatches, 1);
  assert.equal(manifest.counts.billableRecords, 2);
  assert.equal(manifest.counts.detailLookups, 0);
  const csv = fs.readFileSync(manifest.outputs.clientCsv, "utf8");
  assert.match(csv, /Zelda Moorcroft,Zelda K Moorcroft,seller/);
  assert.match(csv, /high,street-verified/);

  const before = calls.length;
  const rerun = await engine.execute({ ...runOptions, runId: "reapi-bulk-2" });
  assert.equal(rerun.counts.apiCalls, 0);
  assert.equal(rerun.counts.billableRecords, 0);
  assert.equal(calls.length, before);
});
