import fs from "node:fs";
import path from "node:path";

import { createLogger } from "@pm/core";

import { MonitoringEngine } from "../core/MonitoringEngine";
import { TransactionMonitoringEngine } from "../core/TransactionMonitoringEngine";
import type { RealEstateApiFetchMode } from "../fetchers/transaction-sources";
import { assertWithinCreditBudget, estimateUncachedRecords } from "../lib/credit-preflight";
import { loadCountyList } from "../lib/county-list";
import { parseArgs } from "./util";

const VENDORS = ["attom", "batchdata", "realestateapi"] as const;
const DEFAULT_MAX_CREDITS = 500;

function readCountiesFromCsv(csvPath: string): string[] {
  return loadCountyList(csvPath).map((e) => e.fips);
}

// RealEstateAPI fetch: "bulk" (default; ids_only + PropertyDetailBulk, deed
// sellers, recording-date windows) or "search" (legacy PropertySearch rows).
export function parseFetchMode(value: string | undefined): RealEstateApiFetchMode {
  const mode = (value ?? "bulk").toLowerCase();
  if (mode !== "bulk" && mode !== "search") throw new Error(`Unknown --fetch=${value}. Use bulk or search.`);
  return mode;
}

function isoDate(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export async function monitorCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const vendor = (args.vendor ?? "attom").toLowerCase() as (typeof VENDORS)[number];
  if (!VENDORS.includes(vendor)) {
    throw new Error(`Unknown --vendor=${vendor}. Use ${VENDORS.join(", ")}.`);
  }

  const countyList = args["county-list"];
  let counties: string[] | undefined;
  if (countyList) {
    if (!fs.existsSync(countyList)) throw new Error(`--county-list not found: ${countyList}`);
    counties = readCountiesFromCsv(countyList);
  } else if (args.counties) {
    counties = args.counties.split(",").map((v) => v.trim()).filter(Boolean);
  }

  if (!args.prospects || !counties || counties.length === 0) {
    throw new Error(
      "Usage:\n" +
      "  restate monitor --prospects=/path/file.csv --counties=11001,36061 [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]\n" +
      "  restate monitor --vendor=batchdata --prospects=/path/file.csv --county-list=/path/counties.csv\n" +
      "  restate monitor --vendor=realestateapi --prospects=/path/file.csv (--counties=55133 | --county-list=/path/counties.csv)\n" +
      "                  --start=YYYY-MM-DD --end=YYYY-MM-DD [--max-credits=500] [--dry-run=true]\n" +
      "                  [--fetch=bulk|search] [--max-detail-credits=100 (search only)] [--include-non-arms-length=true]",
    );
  }

  const cwd = process.cwd();
  const stateDir = args["state-dir"];
  const outputDir = args.output ?? path.join(stateDir || path.join(cwd, ".restate"), "runs");
  const logger = createLogger(args.verbose !== "false");
  const runId = args["run-id"] ?? `monitor-${vendor}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const runOptions = {
    runId, logger, prospectsPath: args.prospects, counties,
    startDate: args.start, endDate: args.end, outputDir,
    scanAll: args["scan-all"] === "true",
    skipEnrichment: args["skip-enrichment"] === "true",
    skipPriorState: args["skip-prior-state"] === "true",
    maxDetailLookups: Number(args["max-detail-credits"] ?? "100"),
  };

  let manifest;
  if (vendor === "batchdata" || vendor === "realestateapi") {
    if (vendor === "batchdata" && !countyList) {
      throw new Error("--vendor=batchdata requires --county-list (FIPS-to-name lookup)");
    }
    const fetchMode = parseFetchMode(args.fetch);
    const engine = TransactionMonitoringEngine.fromEnv(cwd, vendor, {
      countyListPath: countyList,
      stateDir,
      armsLengthOnly: args["include-non-arms-length"] !== "true",
      fetchMode,
    });

    if (vendor === "realestateapi") {
      const endDate = isoDate(args.end) ?? new Date().toISOString().slice(0, 10);
      const startDate = isoDate(args.start) ?? endDate;
      const estimate = await estimateUncachedRecords({
        source: engine.transactionSource, cache: engine.cacheStore, counties, startDate, endDate,
      });
      const maxCredits = Number(args["max-credits"] ?? DEFAULT_MAX_CREDITS);
      process.stderr.write(
        `Credit preflight (count-only requests, ${fetchMode} fetch): ~${estimate?.total ?? 0} billable records across ` +
        `${counties.length} counties, ${startDate} to ${endDate}; budget ${maxCredits}.` +
        (fetchMode === "search" ? ` Plus up to ${runOptions.maxDetailLookups} detail lookups for sales at prospect addresses.` : "") +
        "\n",
      );
      if (args["dry-run"] === "true") {
        for (const row of estimate?.counties ?? []) {
          process.stdout.write(`${row.fips},${row.cached ? "cached" : row.records}\n`);
        }
        return;
      }
      assertWithinCreditBudget(estimate, maxCredits);
    }

    logger.info(`Starting ${vendor} monitoring run ${runId}`);
    manifest = await engine.execute(runOptions);
  } else {
    logger.info(`Starting ${vendor} monitoring run ${runId}`);
    const engine = MonitoringEngine.fromEnv(cwd, stateDir);
    manifest = await engine.execute(runOptions);
  }
  process.stdout.write(`${manifest.outputs.clientCsv}\n`);
}
