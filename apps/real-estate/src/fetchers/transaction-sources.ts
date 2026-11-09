import type { PropertyRecord } from "../core/types";
import type { CountyLookup } from "../lib/county-list";
import {
  applyRealEstateApiSaleDetail,
  normalizeBatchDataProperty,
  normalizeRealEstateApiProperty,
} from "../parsers/source-normalizers";
import type { BatchDataClient } from "./batchdata";
import type { CacheVendor } from "./cache-store";
import type { RealEstateApiClient } from "./realestateapi";

// A deed-transaction vendor queried by county + sale-date window.
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

export class RealEstateApiSource implements TransactionSource {
  readonly vendor = "realestateapi" as const;

  constructor(private readonly client: RealEstateApiClient) {}

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
