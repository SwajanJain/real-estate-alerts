import path from "node:path";

import type { MonitoringManifest } from "./types";

export function createEmptyManifest(
  runId: string,
  mode: MonitoringManifest["mode"],
  prospectsPath: string,
  outputDir: string,
  monitoredCounties: string[],
): MonitoringManifest {
  const runDir = path.join(outputDir, runId);
  return {
    runId,
    startedAt: new Date().toISOString(),
    mode,
    prospectsPath,
    monitoredCounties,
    prospectLoad: null,
    counts: {
      countiesScanned: 0,
      propertyRecordsProcessed: 0,
      apiCalls: 0,
      cacheHits: 0,
      ownersParsed: 0,
      candidateMatches: 0,
      acceptedMatches: 0,
      reviewMatches: 0,
    },
    outputs: {
      clientCsv: path.join(runDir, "client.csv"),
      reviewCsv: path.join(runDir, "review.csv"),
      summaryTxt: path.join(runDir, "summary.txt"),
      manifestJson: path.join(runDir, "manifest.json"),
      statsJson: path.join(runDir, "stats.json"),
    },
  };
}
