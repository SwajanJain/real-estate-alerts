// RealEstateAPI client.
//
// API contract (live probes Oct 2026; production workflow verified 9 Nov 2026 on the Pro plan):
//   Base https://api.realestateapi.com/v2, POST with a JSON body, auth header x-api-key.
//   County selection: `fips` (5-digit county FIPS). Connecticut needs its legacy county
//     codes (09001 to 09015); the 2022 planning-region codes return no sales.
//   Date window: recording_date_min/max (when the county recorded the deed) or
//     last_sale_date_min/max (the closing date). Production scans by recording date, so a
//     late-recorded deed is seen once, in the month it was filed.
//   Arm's-length filter: last_sale_arms_length=true drops $0 intrafamily and other
//     non-arm's-length transfers (about 40% of recorded transfers). It is safe in
//     non-disclosure states, unlike a price floor.
//   Credits on a paid plan (9 Nov 2026: the dashboard showed 571 credits for 36 calls):
//     PropertySearch count: true      0
//     PropertySearch ids_only: true   0 (up to 10,000 IDs a call; 1 credit a call on pay-as-you-go)
//     PropertyDetailBulk              1 per record (up to 1,000 IDs a call)
//     PropertySearch rows             1 per row
//   Search rows carry only `priorOwner`, the assessor's previous owner, which was the deed
//   seller on just 77% of sales. The deed's sellers (lastSale.sellerNames) and document
//   number come only from PropertyDetail / PropertyDetailBulk.
//   Bulk responses carry no credit count and return records in their own order: join on `id`.
//   Never call the premium endpoints (Involuntary Lien, AVM, Skip Tracing): they are billed
//   outside the plan.

export const REAPI_MAX_PAGE_SIZE = 250;
export const REAPI_MAX_IDS_PER_CALL = 10_000;
export const REAPI_MAX_BULK_IDS = 1_000;

type Endpoint = "PropertySearch" | "PropertyDetail" | "PropertyDetailBulk";

// Which date the county/date window filters on.
export type ReapiDateField = "recording" | "sale";

export interface RealEstateApiSearchResponse {
  statusCode?: number;
  statusMessage?: string;
  message?: string;
  error?: string;
  resultCount?: number;
  resultIndex?: number;
  recordCount?: number;
  data?: unknown[];
}

export interface RealEstateApiFetchPageResult {
  page: number;
  pageSize: number;
  properties: unknown[];
  total?: number;
  pages?: number;
  raw: RealEstateApiSearchResponse;
  fromCache: boolean;
}

export interface RealEstateApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  armsLengthOnly?: boolean;
  // Defaults to "sale" (closing date), the search path's original behaviour.
  dateField?: ReapiDateField;
}

export interface CountySaleWindow {
  fips: string;
  startDate: string;
  endDate: string;
}

export class RealEstateApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly armsLengthOnly: boolean;
  readonly dateField: ReapiDateField;

  constructor(options: RealEstateApiClientOptions) {
    if (!options.apiKey) throw new Error("REALESTATEAPI_API_KEY is required");
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.realestateapi.com/v2";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.armsLengthOnly = options.armsLengthOnly ?? true;
    this.dateField = options.dateField ?? "sale";
  }

  buildSearchBody(window: CountySaleWindow): Record<string, unknown> {
    const prefix = this.dateField === "recording" ? "recording_date" : "last_sale_date";
    const body: Record<string, unknown> = {
      fips: window.fips,
      [`${prefix}_min`]: window.startDate,
      [`${prefix}_max`]: window.endDate,
    };
    if (this.armsLengthOnly) body.last_sale_arms_length = true;
    return body;
  }

  private async post(endpoint: Endpoint, body: Record<string, unknown>): Promise<RealEstateApiSearchResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: RealEstateApiSearchResponse;
    try {
      parsed = JSON.parse(text) as RealEstateApiSearchResponse;
    } catch {
      throw new Error(`RealEstateAPI ${endpoint} returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
    }
    if (!response.ok) {
      throw new Error(`RealEstateAPI ${endpoint} failed (${response.status}): ${parsed.message ?? parsed.error ?? text.slice(0, 300)}`);
    }
    return parsed;
  }

  // 0 credits on a paid plan. An empty result comes back as HTTP 200 with
  // statusCode 404 and no resultCount, which means zero matches.
  async fetchCountyCount(window: CountySaleWindow): Promise<number> {
    const parsed = await this.post("PropertySearch", { ...this.buildSearchBody(window), count: true });
    if (parsed.recordCount) {
      throw new Error(`count request unexpectedly returned ${parsed.recordCount} billable records`);
    }
    return parsed.resultCount ?? 0;
  }

  // 0 credits on a paid plan. Every property ID in the window, paging by
  // resultIndex when a county has more than 10,000 sales.
  async fetchCountyIds(window: CountySaleWindow): Promise<string[]> {
    const ids: string[] = [];
    for (let call = 0; call < 100; call++) {
      const body: Record<string, unknown> = { ...this.buildSearchBody(window), ids_only: true, size: REAPI_MAX_IDS_PER_CALL };
      if (ids.length > 0) body.resultIndex = ids.length;
      const parsed = await this.post("PropertySearch", body);
      const data = Array.isArray(parsed.data) ? parsed.data : [];
      ids.push(...data.map((id) => String(id)));
      const total = typeof parsed.resultCount === "number" ? parsed.resultCount : ids.length;
      if (data.length === 0 || ids.length >= total) break;
    }
    return [...new Set(ids)];
  }

  // Billable: 1 credit per record returned. Full Property Detail records,
  // including the deed's lastSale.sellerNames and documentNumber. Records come
  // back in the vendor's own order.
  async fetchDetailBulk(ids: string[]): Promise<unknown[]> {
    if (ids.length === 0) return [];
    if (ids.length > REAPI_MAX_BULK_IDS) throw new Error(`PropertyDetailBulk takes at most 1,000 IDs, got ${ids.length}`);
    const numeric = ids.map(Number);
    if (numeric.some((id) => !Number.isInteger(id))) throw new Error("PropertyDetailBulk needs numeric property IDs");
    const parsed = await this.post("PropertyDetailBulk", { ids: numeric });
    return Array.isArray(parsed.data) ? parsed.data : [];
  }

  // Billable: 1 credit. Full record for one property.
  async fetchPropertyDetail(id: string): Promise<unknown> {
    return this.post("PropertyDetail", { id });
  }

  // Billable: 1 credit per property returned.
  async fetchCountyPage(args: CountySaleWindow & { page: number; pageSize?: number }): Promise<RealEstateApiFetchPageResult> {
    const pageSize = Math.min(args.pageSize ?? REAPI_MAX_PAGE_SIZE, REAPI_MAX_PAGE_SIZE);
    const parsed = await this.post("PropertySearch", {
      ...this.buildSearchBody(args),
      size: pageSize,
      resultIndex: (args.page - 1) * pageSize,
    });
    const properties = Array.isArray(parsed.data) ? parsed.data : [];
    const total = typeof parsed.resultCount === "number" ? parsed.resultCount : properties.length === 0 ? 0 : undefined;
    return {
      page: args.page,
      pageSize,
      properties,
      total,
      // An empty window still counts as one (empty) page so the scan manifest can complete.
      pages: typeof total === "number" ? Math.max(1, Math.ceil(total / pageSize)) : undefined,
      raw: { ...parsed, data: undefined },
      fromCache: false,
    };
  }
}
