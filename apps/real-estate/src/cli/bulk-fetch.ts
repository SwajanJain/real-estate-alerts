import fs from "node:fs";
import path from "node:path";

import { StateStore } from "@pm/core";

import { AttomClient } from "../fetchers/attom";
import { BatchDataClient } from "../fetchers/batchdata";
import { CacheStore } from "../fetchers/cache-store";
import { CountyLookup, loadCountyList } from "../lib/county-list";
import { parseArgs, readEnvFile } from "./util";

interface Fetcher {
  fetchCountyPage(args: { fips: string; startDate: string; endDate: string; page: number }): Promise<{
    properties: unknown[];
    pageSize: number;
    pages?: number;
  }>;
}

class AttomFetcherAdapter implements Fetcher {
  constructor(private readonly client: AttomClient) {}
  fetchCountyPage(args: { fips: string; startDate: string; endDate: string; page: number }) {
    return this.client.fetchCountyPage(args);
  }
}

class BatchDataFetcherAdapter implements Fetcher {
  constructor(private readonly client: BatchDataClient, private readonly lookup: CountyLookup) {}
  fetchCountyPage(args: { fips: string; startDate: string; endDate: string; page: number }) {
    const c = this.lookup.resolve(args.fips);
    return this.client.fetchCountyPage({
      countyName: c.countyName, state: c.state,
      startDate: args.startDate, endDate: args.endDate, page: args.page,
    });
  }
}

export async function bulkFetchCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const vendor = (args.vendor ?? "attom").toLowerCase();
  if (vendor !== "attom" && vendor !== "batchdata") {
    throw new Error(`Unknown --vendor=${vendor}. Use attom or batchdata.`);
  }

  let counties: string[];
  if (args["county-list"]) {
    if (!fs.existsSync(args["county-list"])) throw new Error(`--county-list not found: ${args["county-list"]}`);
    counties = loadCountyList(args["county-list"]).map((e) => e.fips);
  } else if (args.counties) {
    counties = args.counties.split(",").map((c) => c.trim()).filter(Boolean);
  } else {
    throw new Error(
      "Usage:\n" +
      "  restate bulk-fetch --counties=11001,36061 --start=YYYY/MM/DD --end=YYYY/MM/DD [--delay=2000]\n" +
      "  restate bulk-fetch --vendor=batchdata --county-list=/path/counties.csv --start=YYYY-MM-DD --end=YYYY-MM-DD",
    );
  }
  if (!args.start || !args.end) {
    throw new Error("--start and --end (YYYY-MM-DD for batchdata, YYYY/MM/DD for attom) are required");
  }

  const cwd = process.cwd();
  const envValues = readEnvFile(cwd);
  const root = args["state-dir"] ?? process.env.RESTATE_STATE_DIR ?? envValues.RESTATE_STATE_DIR ?? path.join(cwd, ".restate");
  const stateStore = new StateStore(root);
  stateStore.ensure();

  let fetcher: Fetcher;
  let cacheStore: CacheStore;
  if (vendor === "batchdata") {
    const apiKey = process.env.BATCHDATA_API_KEY ?? envValues.BATCHDATA_API_KEY ?? "";
    if (!apiKey) throw new Error("Missing BATCHDATA_API_KEY in environment or .env");
    if (!args["county-list"]) throw new Error("--vendor=batchdata requires --county-list (for FIPS→name lookup)");
    cacheStore = new CacheStore(stateStore, "batchdata");
    fetcher = new BatchDataFetcherAdapter(
      new BatchDataClient({ apiKey }),
      CountyLookup.fromCsv(args["county-list"]),
    );
  } else {
    const apiKeyRaw = process.env.ATTOM_API_KEY ?? envValues.ATTOM_API_KEY ?? "";
    const apiKeys = apiKeyRaw.split(",").map((k) => k.trim()).filter(Boolean);
    if (apiKeys.length === 0) throw new Error("Missing ATTOM_API_KEY in environment or .env");
    cacheStore = new CacheStore(stateStore, "attom");
    fetcher = new AttomFetcherAdapter(new AttomClient({ apiKeys }));
  }

  const { start, end } = args;
  const delayMs = Number(args.delay || "2000");

  let countiesComplete = 0;
  let countiesSkipped = 0;
  let countiesFailed = 0;
  let totalPages = 0;
  let totalProperties = 0;

  process.stderr.write(`Bulk fetch: ${counties.length} counties, ${start} → ${end}, ${delayMs}ms delay\n\n`);

  for (let i = 0; i < counties.length; i++) {
    const fips = counties[i];
    const prefix = `[${i + 1}/${counties.length}] ${fips}`;

    // Skip if already fully cached for this exact date range
    const existing = cacheStore.readScanManifest(fips, start, end);
    if (existing?.status === "complete") {
      process.stderr.write(`${prefix}: already cached (${existing.totalPages ?? "?"} pages) — skipping\n`);
      countiesSkipped++;
      continue;
    }

    try {
      let page = existing?.completedPages?.length
        ? Math.max(...existing.completedPages) + 1
        : 1;

      // If we're resuming a partial scan, start from the first missing page
      if (existing?.completedPages?.length) {
        for (let p = 1; p <= (existing.totalPages ?? page); p++) {
          if (!existing.completedPages.includes(p)) { page = p; break; }
        }
      }

      let countyTotalPages: number | undefined = existing?.totalPages ?? undefined;
      let countyProperties = 0;

      while (true) {
        const cached = cacheStore.readPage(fips, start, end, page);
        if (cached) {
          cacheStore.markPageComplete(fips, start, end, page, countyTotalPages);
          page++;
          if (countyTotalPages !== undefined && page > countyTotalPages) break;
          continue;
        }

        process.stderr.write(`${prefix}: fetching page ${page}${countyTotalPages ? `/${countyTotalPages}` : ""}...\r`);
        let result;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            result = await fetcher.fetchCountyPage({ fips, startDate: start, endDate: end, page });
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const isTransient = /504|503|502|ECONNRESET|timeout/i.test(msg);
            if (!isTransient || attempt === 4) throw err;
            const waitMs = attempt * 5000;
            process.stderr.write(`${prefix}: page ${page} attempt ${attempt} failed (${msg.slice(0, 60)}), retrying in ${waitMs / 1000}s...\n`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }
        if (!result) throw new Error("fetch failed after retries");

        if (typeof result.pages === "number") countyTotalPages = result.pages;
        countyProperties += result.properties.length;

        cacheStore.writePage(fips, start, end, page, result);
        cacheStore.markPageComplete(fips, start, end, page, countyTotalPages);
        totalPages++;

        const done = result.properties.length < result.pageSize
          || (typeof countyTotalPages === "number" && page >= countyTotalPages);

        if (done) break;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        page++;
      }

      totalProperties += countyProperties;
      countiesComplete++;
      process.stderr.write(`${prefix}: done — ${countyProperties} properties, ${page} page(s)           \n`);
    } catch (error) {
      countiesFailed++;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${prefix}: FAILED — ${message}\n`);
    }
  }

  process.stderr.write(`\nDone. ${countiesComplete} fetched, ${countiesSkipped} skipped (cached), ${countiesFailed} failed.\n`);
  process.stderr.write(`Total: ${totalPages} API pages, ~${totalProperties} property records.\n`);
}
