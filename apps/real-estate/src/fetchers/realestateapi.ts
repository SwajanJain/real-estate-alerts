// RealEstateAPI Property Search client.
//
// API contract pinned by live probes (October 2026):
//   POST https://api.realestateapi.com/v2/PropertySearch
//   Auth: x-api-key header.
//   County selection: `fips` (5-digit county FIPS) works directly, so no
//     county-name formatting is needed (unlike BatchData's text query).
//   Sale window: last_sale_date_min / last_sale_date_max (YYYY-MM-DD). This is
//     the sale (closing) date; `recordingDate` is returned separately.
//   Arm's-length filter: last_sale_arms_length=true drops $0 intrafamily and
//     other non-arm's-length transfers (~40% of all recorded transfers). It is
//     safe in non-disclosure states (TX keeps ~70% of rows), unlike a price floor.
//   Paging: size (max 250) + resultIndex (records to skip). resultCount = total.
//   Billing: 1 credit per property returned. The docs say `count: true` costs
//     0 credits, but on the $200 pay-as-you-go test wallet ~1,450 count requests
//     plus ~600 record credits emptied the balance, so wallets appear to bill
//     per request too. Treat count calls as cheap, not free, until confirmed.
//   Search rows already carry buyer names (lastSaleBuyerNames + owner1/owner2),
//   seller names (priorOwner) and the buyer mailing address, so PropertyDetail
//   is not needed for monitoring.

export const REAPI_MAX_PAGE_SIZE = 250;

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

  constructor(options: RealEstateApiClientOptions) {
    if (!options.apiKey) throw new Error("REALESTATEAPI_API_KEY is required");
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.realestateapi.com/v2";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.armsLengthOnly = options.armsLengthOnly ?? true;
  }

  buildSearchBody(window: CountySaleWindow): Record<string, unknown> {
    const body: Record<string, unknown> = {
      fips: window.fips,
      last_sale_date_min: window.startDate,
      last_sale_date_max: window.endDate,
    };
    if (this.armsLengthOnly) body.last_sale_arms_length = true;
    return body;
  }

  private async post(body: Record<string, unknown>): Promise<RealEstateApiSearchResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/PropertySearch`, {
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
      throw new Error(`RealEstateAPI returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
    }
    if (!response.ok) {
      throw new Error(`RealEstateAPI request failed (${response.status}): ${parsed.message ?? parsed.error ?? text.slice(0, 300)}`);
    }
    return parsed;
  }

  // 0 record credits per the docs (may still be billed per request on
  // pay-as-you-go wallets). An empty result comes back as HTTP 200 with
  // statusCode 404 and no resultCount, which means zero matches.
  async fetchCountyCount(window: CountySaleWindow): Promise<number> {
    const parsed = await this.post({ ...this.buildSearchBody(window), count: true });
    if (parsed.recordCount) {
      throw new Error(`count request unexpectedly returned ${parsed.recordCount} billable records`);
    }
    return parsed.resultCount ?? 0;
  }

  // Billable: 1 credit. Full record for one property, including the deed's
  // lastSale.sellerNames (the grantors), which search rows do not carry.
  async fetchPropertyDetail(id: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/PropertyDetail`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`RealEstateAPI PropertyDetail failed (${response.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
  }

  // Billable: 1 credit per property returned.
  async fetchCountyPage(args: CountySaleWindow & { page: number; pageSize?: number }): Promise<RealEstateApiFetchPageResult> {
    const pageSize = Math.min(args.pageSize ?? REAPI_MAX_PAGE_SIZE, REAPI_MAX_PAGE_SIZE);
    const parsed = await this.post({
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
