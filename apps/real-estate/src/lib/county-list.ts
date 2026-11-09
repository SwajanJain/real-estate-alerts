import fs from "node:fs";

import { parseCsvLine } from "@pm/core";

export interface CountyEntry {
  fips: string;
  countyName: string;
  state: string;
}

// Loads a county list CSV with columns including fips, county, state.
// Used to translate FIPS codes into BatchData's text-query format ("Maricopa County, AZ").
export function loadCountyList(csvPath: string): CountyEntry[] {
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fipsIdx = header.indexOf("fips");
  const countyIdx = header.indexOf("county");
  const stateIdx = header.indexOf("state");
  if (fipsIdx < 0 || countyIdx < 0 || stateIdx < 0) {
    throw new Error(`County list ${csvPath} must have columns: fips, county, state`);
  }

  const entries: CountyEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const fips = (cells[fipsIdx] ?? "").trim();
    const countyName = (cells[countyIdx] ?? "").trim();
    const state = (cells[stateIdx] ?? "").trim().toUpperCase();
    if (fips && countyName && state) {
      entries.push({ fips, countyName, state });
    }
  }
  return entries;
}

export class CountyLookup {
  private readonly byFips = new Map<string, CountyEntry>();

  constructor(entries: CountyEntry[]) {
    for (const entry of entries) this.byFips.set(entry.fips, entry);
  }

  static fromCsv(csvPath: string): CountyLookup {
    return new CountyLookup(loadCountyList(csvPath));
  }

  resolve(fips: string): CountyEntry {
    const entry = this.byFips.get(fips);
    if (!entry) throw new Error(`FIPS ${fips} not in county list`);
    return entry;
  }

  all(): CountyEntry[] {
    return Array.from(this.byFips.values());
  }
}
