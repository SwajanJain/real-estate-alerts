import type { IndexedProspect, Logger, ProspectLoadSummary, ProspectRecord, VariantType } from "@pm/core";

export type MatchQuality = "high" | "medium" | "low" | "review";
export type OwnerType = "individual" | "joint" | "trust" | "llc" | "corporation" | "estate" | "unknown";
export type MatchRole = "buyer" | "seller";
export type ChangeType =
  | "new_to_cache"
  | "owner_change"
  | "sale_update"
  | "refinance"
  | "assessment_update"
  | "no_change";

export interface ParsedOwner {
  raw: string;
  normalized: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  role?: "trustee" | "manager" | "co_owner";
  extractedFrom: "direct" | "co_owner" | "trust_name" | "trustee_field";
}

export interface PropertyTransaction {
  date?: string;
  type?: string;
  amount?: number;
  parties?: string[];
  documentNumber?: string;
  isArmsLength?: boolean;
}

export interface PropertySignal {
  tier: 1 | 2 | 3;
  signal: string;
  detail: string;
  action: string;
}

export interface CapacityEstimate {
  fiveYearCapacity: number;
  primaryResidenceValue: number;
  additionalPropertyValue: number;
  totalPropertyValue: number;
  totalMortgage: number;
  equityRatio: number;
  mortgageBonus: boolean;
  propertyCount: number;
}

export interface AddressMatchResult {
  // Hierarchy (strongest → weakest):
  // mailing_exact      — full street address matches owner's home address (need prospect street)
  // mailing_zip        — ZIP code matches owner's home ZIP (need prospect ZIP)
  // mailing_city_state — city + state matches owner's home city
  // mailing_state      — state only on owner's home address
  // situs_exact        — full street address matches sold property (seller's prior home)
  // situs_zip          — ZIP matches sold property ZIP (seller's prior ZIP)
  // situs_city_state   — city + state matches property location
  // situs_state        — state only on property location
  status: "mailing_exact" | "mailing_zip" | "mailing_city_state" | "mailing_state" | "situs_exact" | "situs_zip" | "situs_city_state" | "situs_state" | "mismatch";
  confidence: number;
  matchedAgainst: "mailing" | "situs" | "none";
}

export interface MatchFeatures {
  role: MatchRole;
  variantType: VariantType | "trust_extracted" | "co_owner" | "fuzzy" | "none";
  addressStatus: AddressMatchResult["status"];
  stateMatch: boolean;
  portfolioCorroborationCount: number;
  changeType: ChangeType;
}

export interface MatchScoreResult {
  combinedScore: number;
  quality: MatchQuality;
  reasons: string[];
}

export interface PropertyRecord {
  source: "attom" | "batchdata" | "county_fixture";
  sourcePropertyId: string;
  parcelId?: string;
  countyFips?: string;
  county?: string;
  sourceCalendardate?: string;

  situsAddress: string;
  situsCity?: string;
  situsState?: string;
  situsZip?: string;

  ownerRaw: string;
  ownerRaw2?: string;
  ownerType: OwnerType;
  parsedOwners: ParsedOwner[];
  sellerRaw?: string;
  parsedSellers: ParsedOwner[];

  ownerMailingAddress?: string;
  ownerMailingCity?: string;
  ownerMailingState?: string;
  ownerMailingZip?: string;

  propertyType?: string;
  useCode?: string;

  assessedLand?: number;
  assessedImprovement?: number;
  assessedTotal?: number;
  estimatedValue?: number;

  lastSaleDate?: string;
  lastSalePrice?: number;
  saleRecordDate?: string;
  saleTransactionDate?: string;
  saleSearchDate?: string;
  saleDocumentNumber?: string;
  saleTransactionType?: string;
  saleTransactionId?: string;
  quitClaimFlag?: string;
  isArmsLength?: boolean;
  mortgageAmount?: number;
  mortgageLender?: string;

  isOwnerOccupied?: boolean;
  isAbsenteeOwner?: boolean;
  transactionHistory?: PropertyTransaction[];
  raw?: unknown;
}

export interface PriorStateRecord {
  sourcePropertyId: string;
  ownerFingerprints: string[];
  lastSaleDate?: string;
  lastSalePrice?: number;
  mortgageAmount?: number;
  assessedTotal?: number;
  lastSeen: string;
}

export interface PropertyMatch {
  prospectId: string;
  prospectName: string;
  prospectAddress?: string;
  role: MatchRole;
  property: PropertyRecord;
  matchedOwner: ParsedOwner;
  sourceNameOnRecord: string;
  disclaimer?: string;
  changeType: ChangeType;
  nameScore: number;
  addressScore: number;
  combinedScore: number;
  quality: MatchQuality;
  matchReasons: string[];
  signals: PropertySignal[];
  estimatedCapacity5yr?: number;
}

export interface CountyWatermark {
  lastCompleted?: string;
  lastStarted?: string;
  status: "idle" | "partial" | "complete";
}

export interface MonitoringStats {
  countiesScanned: number;
  propertyRecordsProcessed: number;
  apiCalls: number;
  cacheHits: number;
  ownersParsed: number;
  candidateMatches: number;
  acceptedMatches: number;
  reviewMatches: number;
}

export interface MonitoringManifest {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  mode: "monitor" | "run";
  prospectsPath: string;
  monitoredCounties: string[];
  prospectLoad: ProspectLoadSummary | null;
  counts: MonitoringStats;
  outputs: {
    clientCsv: string;
    reviewCsv: string;
    summaryTxt: string;
    manifestJson: string;
    statsJson: string;
  };
}

export interface MonitoringRunOptions {
  runId: string;
  logger: Logger;
  prospectsPath: string;
  counties: string[];
  startDate?: string;
  endDate?: string;
  outputDir: string;
  scanAll?: boolean;
  skipEnrichment?: boolean;
  skipPriorState?: boolean;
}

export interface MonitorContext {
  prospectIndex: Map<string, IndexedProspect[]>;
  prospects: ProspectRecord[];
  rarityByName: Map<string, number>;
}

export interface AttomApiResponse {
  property?: unknown[];
  status?: {
    total?: number;
    page?: number;
    pagesize?: number;
    pages?: number;
    msg?: string;
  };
}

export interface AttomFetchPageResult {
  page: number;
  pageSize: number;
  properties: unknown[];
  total?: number;
  pages?: number;
  raw: AttomApiResponse;
  fromCache: boolean;
}
