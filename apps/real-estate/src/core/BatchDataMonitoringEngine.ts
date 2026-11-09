import fs from "node:fs";
import path from "node:path";

import {
  buildProspectIndex,
  createLogger,
  generateNameVariants,
  loadProspectsDetailed,
  StateStore,
} from "@pm/core";
import type { IndexedProspect, Logger, ProspectRecord, VariantType } from "@pm/core";

import { createEmptyManifest } from "./run-manifest";
import type {
  MatchQuality,
  MonitoringManifest,
  MonitoringRunOptions,
  ParsedOwner,
  PropertyMatch,
  PropertyRecord,
} from "./types";
import { compareAddresses } from "../lib/address-matcher";
import { scoreMatch, variantWeight } from "../lib/confidence-scorer";
import { estimateGivingCapacity } from "../lib/capacity-formula";
import { buildMatchFeatures } from "../lib/match-features";
import { routeMatch } from "../lib/review-router";
import { writeMatchCsv, writeSummary } from "../io/csv-export";
import { normalizeBatchDataProperty } from "../parsers/source-normalizers";
import { BatchDataClient } from "../fetchers/batchdata";
import type { BatchDataFetchPageResult } from "../fetchers/batchdata";
import { CacheStore } from "../fetchers/cache-store";
import { CountyLookup } from "../lib/county-list";
import { readEnvFile } from "../cli/util";

interface BatchDataMonitoringDeps {
  client: BatchDataClient;
  cache: CacheStore;
  countyLookup: CountyLookup;
  logger?: Logger;
}

const SELLER_LOCATION_DISCLAIMER = "Location shown is the sold property address, not a verified seller residence.";

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDateRange(date: string | undefined, startDate: string, endDate: string): boolean {
  if (!date) return false;
  return date >= startDate && date <= endDate;
}

// BatchData's /property/search filters on sale.lastSaleDate, which is the
// CLOSING/transaction date (saleTransactionDate), NOT the recording date.
// Recording lags the sale by 1-3 weeks, so filtering on recording date drops
// the freshest ~20% of the sales we actually fetched. Stay consistent with the
// fetch filter: use the transaction (closing) date as the canonical event date.
function effectiveSaleDate(p: PropertyRecord): string | undefined {
  return normalizeDate(p.saleTransactionDate) ?? normalizeDate(p.saleRecordDate) ?? normalizeDate(p.lastSaleDate);
}

function prospectAddressLike(prospect: ProspectRecord): string | undefined {
  if (prospect.address && prospect.city && prospect.state) {
    const stateZip = prospect.zip ? `${prospect.state} ${prospect.zip}` : prospect.state;
    return `${prospect.address}, ${prospect.city}, ${stateZip}`;
  }
  if (!prospect.city && !prospect.state) return undefined;
  const stateZip = prospect.zip ? `${prospect.state} ${prospect.zip}` : prospect.state;
  return `UNKNOWN, ${prospect.city}, ${stateZip}`.trim();
}

function prospectAddressDisplay(prospect: ProspectRecord): string {
  const parts: string[] = [];
  if (prospect.address) parts.push(prospect.address);
  if (prospect.city) parts.push(prospect.city);
  const stateZip = [prospect.state, prospect.zip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ");
}

// Build a comma-delimited "street, city, state zip" string from the structured
// fields so normalizeAddress can parse components AND compare the real street.
// (Previously the street was replaced with "UNKNOWN", which made exact-street
// matches impossible — they fell back to ZIP-tier and lost the precision signal.)
function streetOnly(address: string | undefined): string {
  return (address ?? "").split(",")[0].trim() || "UNKNOWN";
}

function propertyAddressLike(property: PropertyRecord, role: "buyer" | "seller"): { situs?: string; mailing?: string } {
  const situs = property.situsCity && property.situsState
    ? `${streetOnly(property.situsAddress)}, ${property.situsCity}, ${property.situsState} ${property.situsZip ?? ""}`.trim()
    : property.situsAddress;
  if (role === "seller") return { situs };
  const mailing = property.ownerMailingCity && property.ownerMailingState
    ? `${streetOnly(property.ownerMailingAddress)}, ${property.ownerMailingCity}, ${property.ownerMailingState} ${property.ownerMailingZip ?? ""}`.trim()
    : property.ownerMailingAddress;
  return { situs, mailing };
}

function normalizedPartyKeys(owner: ParsedOwner): Array<{ key: string; variantType: VariantType | "trust_extracted" | "co_owner" }> {
  const results = new Map<string, VariantType | "trust_extracted" | "co_owner">();
  if (owner.normalized) {
    results.set(
      owner.normalized,
      owner.extractedFrom === "trust_name" ? "trust_extracted" :
      owner.extractedFrom === "co_owner" ? "co_owner" : "exact",
    );
  }
  for (const variant of generateNameVariants(owner.raw)) {
    results.set(variant.value, variant.variantType);
  }
  return Array.from(results.entries()).map(([key, variantType]) => ({ key, variantType }));
}

function transactionKey(p: PropertyRecord): string {
  const date = effectiveSaleDate(p) ?? "unknown-date";
  const doc = p.saleDocumentNumber || p.saleTransactionId || "unknown-doc";
  return `${p.sourcePropertyId}|${doc}|${date}`;
}

function dedupeMatches(matches: PropertyMatch[]): PropertyMatch[] {
  const best = new Map<string, PropertyMatch>();
  for (const m of matches) {
    const k = `${m.prospectId}|${m.role}|${transactionKey(m.property)}`;
    const cur = best.get(k);
    if (!cur || cur.combinedScore < m.combinedScore) best.set(k, m);
  }
  return Array.from(best.values());
}

function qualitySortValue(q: MatchQuality): number {
  return q === "high" ? 4 : q === "medium" ? 3 : q === "low" ? 2 : 1;
}

function hasMatchableParty(p: PropertyRecord): boolean {
  return p.parsedOwners.length > 0 || p.parsedSellers.length > 0;
}

function isTransactionCandidate(p: PropertyRecord, alertStart: string, alertEnd: string): boolean {
  const saleDate = normalizeDate(p.saleTransactionDate) ?? normalizeDate(p.saleRecordDate);
  if (!inDateRange(saleDate, alertStart, alertEnd)) return false;
  if (!hasMatchableParty(p)) return false;
  // Only reject when the price is KNOWN and nominal ($1 quitclaims etc.). A
  // missing price is a vendor data gap, not evidence of a non-sale — dropping
  // those would lose real transactions (e.g. arms-length warranty deeds where
  // BatchData has no price). Non-arms-length transfers are flagged, not dropped.
  if (p.lastSalePrice !== undefined && p.lastSalePrice <= 100) return false;
  return true;
}

function buildSignals(p: PropertyRecord, role: "buyer" | "seller") {
  const verb = role === "buyer" ? "purchase" : "sale";
  const action = role === "buyer"
    ? "Review for buyer capacity and recent acquisition context"
    : "Review for liquidity or relocation context";
  return [{
    tier: 1 as const,
    signal: `Recent property ${verb} recorded at ${p.situsAddress}`,
    detail: p.situsAddress,
    action,
  }];
}

export class BatchDataMonitoringEngine {
  private readonly client: BatchDataClient;
  private readonly cache: CacheStore;
  private readonly countyLookup: CountyLookup;
  private readonly logger: Logger;

  constructor(deps: BatchDataMonitoringDeps) {
    this.client = deps.client;
    this.cache = deps.cache;
    this.countyLookup = deps.countyLookup;
    this.logger = deps.logger ?? createLogger(true);
  }

  async execute(options: MonitoringRunOptions): Promise<MonitoringManifest> {
    const manifest = createEmptyManifest(options.runId, "monitor", options.prospectsPath, options.outputDir, options.counties);
    const { prospects, summary } = loadProspectsDetailed(options.prospectsPath);
    manifest.prospectLoad = summary;
    const { prospectIndex } = buildProspectIndex(prospects);

    // BatchData filters on sale.lastSaleDate, which we treat as the alert window directly.
    // No extra lookback needed (ATTOM's calendardate problem doesn't apply here).
    const alertEnd = normalizeDate(options.endDate) ?? todayIsoDate();
    const alertStart = normalizeDate(options.startDate) ?? alertEnd;

    const accepted: PropertyMatch[] = [];
    const review: PropertyMatch[] = [];
    const errors: Array<{ county: string; error: string }> = [];

    for (let ci = 0; ci < options.counties.length; ci++) {
      const fips = options.counties[ci];
      const county = this.countyLookup.resolve(fips);
      this.logger.info(`[${ci + 1}/${options.counties.length}] ${fips} ${county.countyName} County, ${county.state}...`);

      try {
        this.cache.writeWatermark(fips, {
          lastCompleted: this.cache.readWatermark(fips)?.lastCompleted,
          lastStarted: alertEnd,
          status: "partial",
        });

        const matches: PropertyMatch[] = [];
        let page = 1;
        let pages: number | undefined;

        while (true) {
          const pageResult = await this.loadPage(fips, county.countyName, county.state, alertStart, alertEnd, page);
          manifest.counts.apiCalls += pageResult.fromCache ? 0 : 1;
          manifest.counts.cacheHits += pageResult.fromCache ? 1 : 0;
          if (typeof pageResult.pages === "number") pages = pageResult.pages;
          this.cache.markPageComplete(fips, alertStart, alertEnd, page, pages);

          for (const raw of pageResult.properties) {
            const property = normalizeBatchDataProperty(raw);
            if (!property.sourcePropertyId) continue;
            manifest.counts.propertyRecordsProcessed += 1;
            manifest.counts.ownersParsed += property.parsedOwners.length + property.parsedSellers.length;
            if (!isTransactionCandidate(property, alertStart, alertEnd)) continue;
            const propertyMatches = this.matchProperty(property, prospectIndex);
            matches.push(...propertyMatches);
            manifest.counts.candidateMatches += propertyMatches.length;
          }

          if (pageResult.properties.length < pageResult.pageSize) break;
          if (typeof pages === "number" && page >= pages) break;
          page += 1;
        }

        this.cache.writeWatermark(fips, {
          lastCompleted: alertEnd,
          lastStarted: alertEnd,
          status: "complete",
        });
        manifest.counts.countiesScanned += 1;
        this.logger.info(`  ${fips}: ${page} page(s), ${matches.length} raw matches`);

        const deduped = dedupeMatches(matches);
        for (const m of deduped.sort((a, b) => qualitySortValue(b.quality) - qualitySortValue(a.quality) || b.combinedScore - a.combinedScore)) {
          if (routeMatch(m.quality) === "client") {
            accepted.push(m);
            manifest.counts.acceptedMatches += 1;
          } else {
            review.push(m);
            manifest.counts.reviewMatches += 1;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`County ${fips} failed: ${message}`);
        errors.push({ county: fips, error: message });
      }
    }

    if (errors.length > 0) {
      this.logger.warn(`${errors.length} county scan(s) failed: ${errors.map((e) => e.county).join(", ")}`);
    }

    fs.mkdirSync(path.join(options.outputDir, options.runId), { recursive: true });
    writeMatchCsv(manifest.outputs.clientCsv, accepted);
    writeMatchCsv(manifest.outputs.reviewCsv, review);
    writeSummary(manifest.outputs.summaryTxt, accepted, review, manifest.counts, {
      startDate: alertStart, endDate: alertEnd, prospectsPath: options.prospectsPath,
    });
    manifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(manifest.outputs.statsJson, `${JSON.stringify(manifest.counts, null, 2)}\n`, "utf8");
    fs.writeFileSync(manifest.outputs.manifestJson, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  private async loadPage(
    fips: string, countyName: string, state: string,
    startDate: string, endDate: string, page: number,
  ): Promise<BatchDataFetchPageResult> {
    const cached = this.cache.readPage<BatchDataFetchPageResult>(fips, startDate, endDate, page);
    if (cached) return { ...cached, fromCache: true };
    const fetched = await this.client.fetchCountyPage({ countyName, state, startDate, endDate, page });
    this.cache.writePage(fips, startDate, endDate, page, fetched);
    return fetched;
  }

  private matchProperty(p: PropertyRecord, index: Map<string, IndexedProspect[]>): PropertyMatch[] {
    return [
      ...this.matchParties("buyer", p.parsedOwners, p, index),
      ...this.matchParties("seller", p.parsedSellers, p, index),
    ];
  }

  private matchParties(
    role: "buyer" | "seller",
    parties: ParsedOwner[],
    property: PropertyRecord,
    prospectIndex: Map<string, IndexedProspect[]>,
  ): PropertyMatch[] {
    const matches: PropertyMatch[] = [];
    for (const party of parties) {
      const candidates = new Map<string, { prospect: ProspectRecord; variantType: VariantType | "trust_extracted" | "co_owner" }>();
      for (const key of normalizedPartyKeys(party)) {
        for (const indexed of prospectIndex.get(key.key) ?? []) {
          if (!candidates.has(indexed.prospect.prospectId)) {
            candidates.set(indexed.prospect.prospectId, { prospect: indexed.prospect, variantType: key.variantType });
          }
        }
      }
      for (const candidate of candidates.values()) {
        const addressMatch = compareAddresses(prospectAddressLike(candidate.prospect), propertyAddressLike(property, role));
        const features = buildMatchFeatures({
          prospect: candidate.prospect,
          property,
          role,
          variantType: candidate.variantType,
          addressMatch,
          portfolioCorroborationCount: 1,
          changeType: "sale_update",
        });
        const scored = scoreMatch(features);
        const reasons = [...scored.reasons];
        if (property.quitClaimFlag?.toLowerCase() === "true") reasons.push("flag:quitclaim");
        if (property.isArmsLength === false) reasons.push("flag:non_arms_length");
        if (property.saleTransactionType && !property.saleTransactionType.toLowerCase().includes("arms-length")) {
          reasons.push(`flag:${property.saleTransactionType.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
        }
        const capacity = estimateGivingCapacity([{
          value: property.estimatedValue ?? property.assessedTotal ?? 0,
          isOwnerOccupied: property.isOwnerOccupied ?? false,
          mortgageAmount: property.mortgageAmount,
        }]);
        matches.push({
          prospectId: candidate.prospect.prospectId,
          prospectName: candidate.prospect.nameRaw,
          prospectAddress: prospectAddressDisplay(candidate.prospect),
          role,
          property,
          matchedOwner: party,
          sourceNameOnRecord: party.raw,
          disclaimer: role === "seller" ? SELLER_LOCATION_DISCLAIMER : undefined,
          changeType: "sale_update",
          nameScore: variantWeight(candidate.variantType),
          addressScore: addressMatch.confidence,
          combinedScore: scored.combinedScore,
          quality: scored.quality,
          matchReasons: reasons,
          signals: buildSignals(property, role),
          estimatedCapacity5yr: capacity.fiveYearCapacity,
        });
      }
    }
    return matches;
  }

  static fromEnv(cwd: string, countyListPath: string, stateDir?: string): BatchDataMonitoringEngine {
    const env = readEnvFile(cwd);
    const apiKey = process.env.BATCHDATA_API_KEY || env.BATCHDATA_API_KEY || "";
    if (!apiKey) throw new Error("Missing BATCHDATA_API_KEY in environment or .env");
    const root = stateDir || process.env.RESTATE_STATE_DIR || env.RESTATE_STATE_DIR || path.join(cwd, ".restate");
    const stateStore = new StateStore(root);
    stateStore.ensure();
    return new BatchDataMonitoringEngine({
      client: new BatchDataClient({ apiKey }),
      cache: new CacheStore(stateStore, "batchdata"),
      countyLookup: CountyLookup.fromCsv(countyListPath),
    });
  }
}
