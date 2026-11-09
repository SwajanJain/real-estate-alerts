import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createLogger, StateStore } from "@pm/core";

import { MonitoringEngine } from "../src/core/MonitoringEngine";
import type { AttomApiResponse } from "../src/core/types";
import { CacheStore } from "../src/fetchers/cache-store";
import { AttomClient } from "../src/fetchers/attom";

function writeFixture(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("MonitoringEngine produces an alert CSV from ATTOM county scan", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restate-monitor-"));
  const stateStore = new StateStore(path.join(tempDir, ".restate"));
  stateStore.ensure();
  const cacheStore = new CacheStore(stateStore);
  const outputDir = path.join(tempDir, "runs");
  const prospectsPath = path.join(tempDir, "prospects.csv");

  writeFixture(
    prospectsPath,
    [
      "prospect_id,name,address,city,state,zip",
      "p1,John Smith,500 Elm St,Austin,TX,78702",
      "p2,Mary Seller,1 Main St,Austin,TX,78701",
    ].join("\n"),
  );

  const payload: AttomApiResponse = {
    property: [{
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
        assessed: { assdTtlValue: "1200000" },
      },
      avm: { amount: { value: "1500000" } },
      sale: {
        sellerName: "Mary Seller",
        saleTransDate: "2026-03-08",
        transactionIdent: "txn-1",
        amount: { saleRecDate: "2026-03-09", saleAmt: "980000", saleDocNum: "DOC-1", saleTransType: "Resale" },
      },
      mortgage: { amount: "400000", lendername: "Test Bank" },
      calendarDate: "2026/03/09",
    }],
    status: {
      total: 1,
      page: 1,
      pagesize: 100,
      pages: 1,
    },
  };

  const client = new AttomClient({
    apiKeys: ["test"],
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/saleshistory/expandedhistory")) {
        return new Response(JSON.stringify({
          property: [{
            saleHistory: [{
              buyerName: "John Smith",
              sellerName: "Mary Seller",
              saleRecDate: "2026-03-09",
              saleTransDate: "2026-03-08",
              saleDocNum: "DOC-1",
            }],
          }],
          status: { total: 1 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const engine = new MonitoringEngine({
    attomClient: client,
    cacheStore,
    logger: createLogger(false),
  });

  const manifest = await engine.execute({
    runId: "test-run",
    logger: createLogger(false),
    prospectsPath,
    counties: ["48453"],
    startDate: "2026/03/09",
    endDate: "2026/03/09",
    outputDir,
  });

  const clientCsv = fs.readFileSync(manifest.outputs.clientCsv, "utf8");
  assert.match(clientCsv, /John Smith/);
  assert.match(clientCsv, /buyer/);
  assert.match(clientCsv, /seller/);
  // Seller match now reaches "high" on situs_exact, so the per-property
  // expanded-history enrichment is skipped (it only runs for sub-high matches).
  assert.match(clientCsv, /Location shown is the sold property address, not a verified seller residence\./);
});
