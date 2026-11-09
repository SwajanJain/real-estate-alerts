import type { PropertyRecord } from "../core/types";
import type { CountyLookup } from "../lib/county-list";
import {
  applyRealEstateApiSaleDetail,
  normalizeBatchDataProperty,
  normalizeRealEstateApiDetail,
  normalizeRealEstateApiProperty,
} from "../parsers/source-normalizers";
import type { BatchDataClient } from "./batchdata";
import type { CacheVendor } from "./cache-store";
import { REAPI_MAX_BULK_IDS, RealEstateApiClient } from "./realestateapi";
import type { RealEstateApiClientOptions } from "./realestateapi";

// A deed-transaction vendor queried by county + date window.
// The monitoring engine and bulk-fetch only talk to this interface.
export interface TransactionPageResult {
  page: number;
  pageSize: number;
  properties: unknown[];
  total?: number;
  pages?: number;
  raw: unknown;
  fromCache: boolean;
}

export interface CountyPageRequest {
  fips: string;
  startDate: string;
  endDate: string;
  page: number;
}

export interface TransactionSource {
  readonly vendor: CacheVendor;
  // The date the vendor query filters the window on; the engine checks each
  // record with the same date. Defaults to "sale" (closing date).
  readonly windowDate?: "sale" | "recording";
  fetchCountyPage(args: CountyPageRequest): Promise<TransactionPageResult>;
  normalize(raw: unknown): PropertyRecord;
  // Free record count for a window, when the vendor offers one.
  countCountyRecords?(args: Omit<CountyPageRequest, "page">): Promise<number>;
  // Optional per-property deed lookup used to fill in sale parties the
  // county scan lacks. Billable, so the engine calls it sparingly.
  fetchSaleDetail?(propertyId: string): Promise<unknown>;
  applySaleDetail?(property: PropertyRecord, detail: unknown): PropertyRecord;
}

export class BatchDataSource implements TransactionSource {
  readonly vendor = "batchdata" as const;

  constructor(private readonly client: BatchDataClient, private readonly lookup: CountyLookup) {}

  fetchCountyPage(args: CountyPageRequest): Promise<TransactionPageResult> {
    const county = this.lookup.resolve(args.fips);
    return this.client.fetchCountyPage({
      countyName: county.countyName,
      state: county.state,
      startDate: args.startDate,
      endDate: args.endDate,
      page: args.page,
    });
  }

  normalize(raw: unknown): PropertyRecord {
    return normalizeBatchDataProperty(raw);
  }
}

// Legacy RealEstateAPI path: paid PropertySearch rows (sellers from the
// assessor's priorOwner), plus a single PropertyDetail at prospect addresses.
export class RealEstateApiSource implements TransactionSource {
  readonly vendor = "realestateapi" as const;

  constructor(private readonly client: RealEstateApiClient) {}

  get windowDate(): "sale" | "recording" {
    return this.client.dateField;
  }

  fetchCountyPage(args: CountyPageRequest): Promise<TransactionPageResult> {
    return this.client.fetchCountyPage(args);
  }

  normalize(raw: unknown): PropertyRecord {
    return normalizeRealEstateApiProperty(raw);
  }

  countCountyRecords(args: Omit<CountyPageRequest, "page">): Promise<number> {
    return this.client.fetchCountyCount(args);
  }

  fetchSaleDetail(propertyId: string): Promise<unknown> {
    return this.client.fetchPropertyDetail(propertyId);
  }

  applySaleDetail(property: PropertyRecord, detail: unknown): PropertyRecord {
    return applyRealEstateApiSaleDetail(property, detail);
  }
}

// Where the Bulk path keeps each county-window's ID list (CacheStore does this).
export interface IdListStore {
  readIdList(fips: string, startDate: string, endDate: string): string[] | null;
  writeIdList(fips: string, startDate: string, endDate: string, ids: string[]): void;
}

// Production RealEstateAPI path (verified 9 Nov 2026): list every property ID in
// the window with ids_only (free), then fetch the records with PropertyDetailBulk,
// 1,000 IDs a page, 1 credit per record. Every record carries the deed's buyers,
// sellers and document number, so no per-property detail lookup is needed.
export class RealEstateApiBulkSource implements TransactionSource {
  readonly vendor = "realestateapi" as const;

  constructor(private readonly client: RealEstateApiClient, private readonly ids: IdListStore) {}

  get windowDate(): "sale" | "recording" {
    return this.client.dateField;
  }

  private async idList(args: Omit<CountyPageRequest, "page">): Promise<string[]> {
    const saved = this.ids.readIdList(args.fips, args.startDate, args.endDate);
    if (saved) return saved;
    const fresh = await this.client.fetchCountyIds(args);
    this.ids.writeIdList(args.fips, args.startDate, args.endDate, fresh);
    return fresh;
  }

  async fetchCountyPage(args: CountyPageRequest): Promise<TransactionPageResult> {
    const all = await this.idList(args);
    const pageSize = REAPI_MAX_BULK_IDS;
    const chunk = all.slice((args.page - 1) * pageSize, args.page * pageSize);
    const records = await this.client.fetchDetailBulk(chunk);
    // Bulk returns records in its own order: put them back in ID-list order.
    const byId = new Map(records.map((r) => [String((r as { id?: unknown }).id), r]));
    const properties = chunk.map((id) => byId.get(id)).filter((r): r is unknown => r !== undefined);
    return {
      page: args.page,
      pageSize,
      properties,
      total: all.length,
      // An empty window still counts as one (empty) page so the scan manifest can complete.
      pages: Math.max(1, Math.ceil(all.length / pageSize)),
      raw: { idsRequested: chunk.length, recordsReturned: records.length },
      fromCache: false,
    };
  }

  normalize(raw: unknown): PropertyRecord {
    return normalizeRealEstateApiDetail(raw);
  }

  countCountyRecords(args: Omit<CountyPageRequest, "page">): Promise<number> {
    return this.client.fetchCountyCount(args);
  }
}

export type RealEstateApiFetchMode = "bulk" | "search";

// "bulk" (default): ids_only + PropertyDetailBulk, windows by recording date.
// "search": the legacy PropertySearch path, windows by closing date.
export function createRealEstateApiSource(
  options: RealEstateApiClientOptions,
  mode: RealEstateApiFetchMode,
  ids: IdListStore,
): TransactionSource {
  if (mode === "search") return new RealEstateApiSource(new RealEstateApiClient({ ...options, dateField: options.dateField ?? "sale" }));
  return new RealEstateApiBulkSource(new RealEstateApiClient({ ...options, dateField: options.dateField ?? "recording" }), ids);
}
