import type { AttomApiResponse, AttomFetchPageResult } from "../core/types";

export interface AttomClientOptions {
  apiKeys: string[];
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class AttomClient {
  private readonly apiKeys: string[];
  private activeKeyIndex: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AttomClientOptions) {
    this.apiKeys = options.apiKeys.filter(Boolean);
    if (this.apiKeys.length === 0) throw new Error("At least one ATTOM API key is required");
    this.activeKeyIndex = 0;
    this.baseUrl = options.baseUrl ?? "https://api.gateway.attomdata.com/propertyapi/v1.0.0";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchCountyPage(args: {
    fips: string;
    startDate: string;
    endDate: string;
    page: number;
    pageSize?: number;
  }): Promise<AttomFetchPageResult> {
    const pageSize = args.pageSize ?? 100;
    const query = new URLSearchParams({
      fips: args.fips,
      startcalendardate: args.startDate,
      endcalendardate: args.endDate,
      page: String(args.page),
      pageSize: String(pageSize),
    });
    const url = `${this.baseUrl}/property/expandedprofile?${query.toString()}`;

    const response = await this.fetchWithRotation(url);
    const body = await response.text();
    const parsed = JSON.parse(body) as AttomApiResponse;
    // ATTOM returns 400 with "SuccessWithoutResult" when no data exists — not a real error
    if (!response.ok && parsed.status?.msg !== "SuccessWithoutResult") {
      throw new Error(`ATTOM request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const properties = Array.isArray(parsed.property) ? parsed.property : [];
    return {
      page: args.page,
      pageSize,
      properties,
      total: parsed.status?.total,
      pages: parsed.status?.pages,
      raw: parsed,
      fromCache: false,
    };
  }

  async fetchExpandedHistory(attomId: string): Promise<unknown> {
    const query = new URLSearchParams({ attomId });
    const url = `${this.baseUrl}/saleshistory/expandedhistory?${query.toString()}`;
    const response = await this.fetchWithRotation(url);
    const body = await response.text();
    const parsed = JSON.parse(body) as AttomApiResponse;
    if (!response.ok && parsed.status?.msg !== "SuccessWithoutResult") {
      throw new Error(`ATTOM history request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    return parsed;
  }

  private async fetchWithRotation(url: string): Promise<Response> {
    const startIndex = this.activeKeyIndex;
    while (true) {
      const response = await this.fetchImpl(url, {
        headers: {
          APIKey: this.apiKeys[this.activeKeyIndex],
          Accept: "application/json",
        },
      });
      if (response.status !== 401) return response;

      // 401 — try the next key
      const nextIndex = (this.activeKeyIndex + 1) % this.apiKeys.length;
      if (nextIndex === startIndex) {
        // All keys exhausted
        return response;
      }
      this.activeKeyIndex = nextIndex;
    }
  }
}
