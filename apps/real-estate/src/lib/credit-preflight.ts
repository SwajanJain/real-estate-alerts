import type { CacheStore } from "../fetchers/cache-store";
import type { TransactionSource } from "../fetchers/transaction-sources";

export interface CreditEstimate {
  total: number;
  counties: Array<{ fips: string; records: number; cached: boolean }>;
}

// Uses the vendor's count endpoint (one request per uncached county, no
// record credits) to price a run before pulling records. Counties whose
// window is already fully cached are not queried at all.
export async function estimateUncachedRecords(args: {
  source: TransactionSource;
  cache: CacheStore;
  counties: string[];
  startDate: string;
  endDate: string;
  concurrency?: number;
}): Promise<CreditEstimate | null> {
  const count = args.source.countCountyRecords?.bind(args.source);
  if (!count) return null;

  const results: CreditEstimate["counties"] = new Array(args.counties.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < args.counties.length) {
      const index = next++;
      const fips = args.counties[index];
      const manifest = args.cache.readScanManifest(fips, args.startDate, args.endDate);
      if (manifest?.status === "complete") {
        results[index] = { fips, records: 0, cached: true };
        continue;
      }
      results[index] = { fips, records: await count({ fips, startDate: args.startDate, endDate: args.endDate }), cached: false };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency ?? 4) }, worker));
  return { total: results.reduce((sum, row) => sum + row.records, 0), counties: results };
}

export function assertWithinCreditBudget(estimate: CreditEstimate | null, maxCredits: number): void {
  if (!estimate || estimate.total <= maxCredits) return;
  const top = [...estimate.counties]
    .filter((row) => !row.cached)
    .sort((a, b) => b.records - a.records)
    .slice(0, 10)
    .map((row) => `${row.fips}=${row.records}`)
    .join(", ");
  throw new Error(
    `This run would fetch ~${estimate.total} billable records (1 credit each), over --max-credits=${maxCredits}. ` +
    `Largest uncached counties: ${top}. Re-run with a higher --max-credits to proceed.`,
  );
}
