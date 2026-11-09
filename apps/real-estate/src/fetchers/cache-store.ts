import fs from "node:fs";
import path from "node:path";

import { StateStore } from "@pm/core";

import type { CountyWatermark, PriorStateRecord } from "../core/types";

interface ScanManifest {
  totalPages: number | null;
  completedPages: number[];
  status: "partial" | "complete";
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export type CacheVendor = "attom" | "batchdata";

export class CacheStore {
  constructor(
    private readonly stateStore: StateStore,
    private readonly vendor: CacheVendor = "attom",
  ) {}

  pagePath(fips: string, startDate: string, endDate: string, page: number): string {
    return path.join(this.stateStore.paths.raw, this.vendor, fips, `${startDate}_${endDate}`, `page-${page}.json`);
  }

  scanManifestPath(fips: string, startDate: string, endDate: string): string {
    return path.join(this.stateStore.paths.raw, this.vendor, fips, `${startDate}_${endDate}`, "scan-manifest.json");
  }

  readPage<T>(fips: string, startDate: string, endDate: string, page: number): T | null {
    return this.stateStore.readJson<T>(this.pagePath(fips, startDate, endDate, page));
  }

  writePage(fips: string, startDate: string, endDate: string, page: number, value: unknown): void {
    this.stateStore.writeJson(this.pagePath(fips, startDate, endDate, page), value);
  }

  readScanManifest(fips: string, startDate: string, endDate: string): ScanManifest | null {
    return this.stateStore.readJson<ScanManifest>(this.scanManifestPath(fips, startDate, endDate));
  }

  markPageComplete(
    fips: string,
    startDate: string,
    endDate: string,
    page: number,
    totalPages?: number,
  ): ScanManifest {
    const existing = this.readScanManifest(fips, startDate, endDate) ?? {
      totalPages: totalPages ?? null,
      completedPages: [],
      status: "partial" as const,
    };

    if (!existing.completedPages.includes(page)) existing.completedPages.push(page);
    existing.completedPages.sort((a, b) => a - b);
    if (typeof totalPages === "number") existing.totalPages = totalPages;
    if (existing.totalPages && existing.completedPages.length >= existing.totalPages) {
      existing.status = "complete";
    }
    this.stateStore.writeJson(this.scanManifestPath(fips, startDate, endDate), existing);
    return existing;
  }

  priorStatePath(propertyId: string): string {
    return path.join(this.stateStore.paths.normalized, "prior-state", `${propertyId}.json`);
  }

  readPriorState(propertyId: string): PriorStateRecord | null {
    return this.stateStore.readJson<PriorStateRecord>(this.priorStatePath(propertyId));
  }

  writePriorStates(records: PriorStateRecord[]): void {
    for (const record of records) {
      this.stateStore.writeJson(this.priorStatePath(record.sourcePropertyId), record);
    }
  }

  watermarksPath(): string {
    return path.join(this.stateStore.paths.cursors, "real-estate-watermarks.json");
  }

  readWatermarks(): Record<string, CountyWatermark> {
    return this.stateStore.readJson<Record<string, CountyWatermark>>(this.watermarksPath()) ?? {};
  }

  readWatermark(fips: string): CountyWatermark | null {
    return this.readWatermarks()[fips] ?? null;
  }

  writeWatermark(fips: string, watermark: CountyWatermark): void {
    const all = this.readWatermarks();
    all[fips] = watermark;
    this.stateStore.writeJson(this.watermarksPath(), all);
  }
}
