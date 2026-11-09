import fs from "node:fs";
import path from "node:path";

import { createLogger } from "@pm/core";

import { MonitoringEngine } from "../core/MonitoringEngine";
import { BatchDataMonitoringEngine } from "../core/BatchDataMonitoringEngine";
import { loadCountyList } from "../lib/county-list";
import { parseArgs } from "./util";

function readCountiesFromCsv(csvPath: string): string[] {
  return loadCountyList(csvPath).map((e) => e.fips);
}

export async function monitorCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const vendor = (args.vendor ?? "attom").toLowerCase();
  if (vendor !== "attom" && vendor !== "batchdata") {
    throw new Error(`Unknown --vendor=${vendor}. Use attom or batchdata.`);
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
      "  restate monitor --vendor=batchdata --prospects=/path/file.csv --county-list=/path/counties.csv",
    );
  }

  const cwd = process.cwd();
  const stateDir = args["state-dir"];
  const outputDir = args.output ?? path.join(stateDir || path.join(cwd, ".restate"), "runs");
  const logger = createLogger(args.verbose !== "false");
  const runId = args["run-id"] ?? `monitor-${vendor}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  logger.info(`Starting ${vendor} monitoring run ${runId}`);

  const runOptions = {
    runId, logger, prospectsPath: args.prospects, counties,
    startDate: args.start, endDate: args.end, outputDir,
    scanAll: args["scan-all"] === "true",
    skipEnrichment: args["skip-enrichment"] === "true",
    skipPriorState: args["skip-prior-state"] === "true",
  };

  let manifest;
  if (vendor === "batchdata") {
    if (!countyList) throw new Error("--vendor=batchdata requires --county-list (FIPS-to-name lookup)");
    const engine = BatchDataMonitoringEngine.fromEnv(cwd, countyList, stateDir);
    manifest = await engine.execute(runOptions);
  } else {
    const engine = MonitoringEngine.fromEnv(cwd, stateDir);
    manifest = await engine.execute(runOptions);
  }
  process.stdout.write(`${manifest.outputs.clientCsv}\n`);
}
