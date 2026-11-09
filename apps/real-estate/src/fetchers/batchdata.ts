// BatchData Property Search API client.
//
// API contract pinned by live probes (June 2026):
//   POST https://api.batchdata.com/api/v1/property/search
//   Auth: Authorization: Bearer <token>
//   County selection: ONLY via searchCriteria.query as text ("Maricopa County, AZ").
//   FIPS / address-object selection is silently ignored or returns 500.
//   Sale window: searchCriteria.sale.lastSaleDate.{minDate,maxDate} (YYYY-MM-DD).
//   Datasets: options.datasets — token must be provisioned (we use "core").
//   Pagination: options.skip + options.take. resultsFound returned in meta.

export interface BatchDataApiResponse {
  status?: { code?: number; text?: string; message?: string };
  results?: {
    properties?: unknown[];
    meta?: {
      results?: {
        resultCount?: number;
        resultsFound?: number;
      };
    };
  };
  warnings?: Array<{ code?: string; message?: string }>;
}

export interface BatchDataFetchPageResult {
  page: number;
  pageSize: number;
  properties: unknown[];
  total?: number;
  pages?: number;
  raw: BatchDataApiResponse;
  fromCache: boolean;
}

// BatchData's text-query parser accepts "<Name> County, <ST>" for regular
// counties but fails (silently returns 0) when the same suffix is appended
// to special-naming entities: independent cities (Census suffix "(city)"),
// SF-style City-County consolidations, or DC. For those we send just
// "<Name>, <ST>". Verified against live count probes.
export function buildCountyQuery(countyName: string, state: string): string {
  const name = countyName.trim();
  const lower = name.toLowerCase();
  // Independent cities: "Falls Church (city)", "Baltimore (city)", etc.
  if (/\(city\)\s*$/i.test(name)) {
    return `${name.replace(/\s*\(city\)\s*$/i, "")}, ${state}`;
  }
  // SF-style: "City and County of San Francisco" → "San Francisco, CA"
  if (lower.startsWith("city and county of ")) {
    return `${name.replace(/^city and county of\s+/i, "")}, ${state}`;
  }
  // DC is a federal district, not a county
  if (lower === "district of columbia") {
    return `District of Columbia, DC`;
  }
  return `${name} County, ${state}`;
}

export interface BatchDataClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  datasets?: string[];
}

export class BatchDataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly datasets: string[];

  constructor(options: BatchDataClientOptions) {
    if (!options.apiKey) throw new Error("BATCHDATA_API_KEY is required");
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.batchdata.com/api/v1";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.datasets = options.datasets ?? ["core"];
  }

  async fetchCountyPage(args: {
    countyName: string;
    state: string;
    startDate: string;
    endDate: string;
    page: number;
    pageSize?: number;
  }): Promise<BatchDataFetchPageResult> {
    const pageSize = args.pageSize ?? 100;
    const skip = (args.page - 1) * pageSize;
    const body = {
      searchCriteria: {
        query: buildCountyQuery(args.countyName, args.state),
        sale: {
          lastSaleDate: { minDate: args.startDate, maxDate: args.endDate },
        },
      },
      options: { skip, take: pageSize, datasets: this.datasets },
    };

    const response = await this.fetchImpl(`${this.baseUrl}/property/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const parsed = JSON.parse(text) as BatchDataApiResponse;

    if (!response.ok) {
      const warning = parsed.warnings?.[0]?.message ?? parsed.status?.message ?? text.slice(0, 300);
      throw new Error(`BatchData request failed (${response.status}): ${warning}`);
    }

    const properties = parsed.results?.properties ?? [];
    const resultsFound = parsed.results?.meta?.results?.resultsFound;
    const pages = typeof resultsFound === "number" ? Math.ceil(resultsFound / pageSize) : undefined;

    return {
      page: args.page,
      pageSize,
      properties,
      total: resultsFound,
      pages,
      raw: parsed,
      fromCache: false,
    };
  }

  async fetchCountyCount(args: {
    countyName: string;
    state: string;
    startDate: string;
    endDate: string;
  }): Promise<number> {
    const result = await this.fetchCountyPage({ ...args, page: 1, pageSize: 0 });
    return result.total ?? 0;
  }
}
