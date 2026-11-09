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
  AttomFetchPageResult,
  ChangeType,
  MatchQuality,
  MonitoringManifest,
  MonitoringRunOptions,
  ParsedOwner,
  PriorStateRecord,
  PropertyMatch,
  PropertyRecord,
} from "./types";
import { compareAddresses } from "../lib/address-matcher";
import { buildOwnerFingerprints } from "../lib/change-classifier";
import { scoreMatch, variantWeight } from "../lib/confidence-scorer";
import { estimateGivingCapacity } from "../lib/capacity-formula";
import { buildMatchFeatures } from "../lib/match-features";
import { routeMatch } from "../lib/review-router";
import { writeMatchCsv, writeSummary } from "../io/csv-export";
import { normalizeAttomProperty } from "../parsers/source-normalizers";
import { parseOwnerName } from "../parsers/owner-name-parser";
import { AttomClient } from "../fetchers/attom";
import { CacheStore } from "../fetchers/cache-store";
import { readEnvFile } from "../cli/util";

interface MonitoringEngineDeps {
  attomClient: AttomClient;
  cacheStore: CacheStore;
  logger?: Logger;
}

interface HistoryTransactionRow {
  buyerName?: string;
  sellerName?: string;
  saleRecordDate?: string;
  saleTransactionDate?: string;
  saleDocumentNumber?: string;
}

const REFRESH_LOOKBACK_DAYS = 90;
const SELLER_LOCATION_DISCLAIMER = "Location shown is the sold property address, not a verified seller residence.";

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10).replace(/-/g, "/");
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toCalendarDate(value: string): string {
  return value.replace(/-/g, "/");
}

function shiftCalendarDate(value: string, days: number): string {
  const normalized = normalizeDate(value);
  if (!normalized) return value;
  const date = new Date(`${normalized}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
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

function propertyAddressLike(property: PropertyRecord, role: "buyer" | "seller"): { situs?: string; mailing?: string } {
  const situs = property.situsCity && property.situsState
    ? `UNKNOWN, ${property.situsCity}, ${property.situsState} ${property.situsZip ?? ""}`.trim()
    : property.situsAddress;

  if (role === "seller") {
    return { situs };
  }

  const mailing = property.ownerMailingCity && property.ownerMailingState
    ? `UNKNOWN, ${property.ownerMailingCity}, ${property.ownerMailingState} ${property.ownerMailingZip ?? ""}`.trim()
    : property.ownerMailingAddress;

  return { situs, mailing };
}

function normalizedPartyKeys(owner: ParsedOwner): Array<{ key: string; variantType: VariantType | "trust_extracted" | "co_owner" }> {
  const results = new Map<string, VariantType | "trust_extracted" | "co_owner">();
  if (owner.normalized) {
    results.set(
      owner.normalized,
      owner.extractedFrom === "trust_name"
        ? "trust_extracted"
        : owner.extractedFrom === "co_owner"
          ? "co_owner"
          : "exact",
    );
  }
  for (const variant of generateNameVariants(owner.raw)) {
    results.set(variant.value, variant.variantType);
  }
  return Array.from(results.entries()).map(([key, variantType]) => ({ key, variantType }));
}

function effectiveSaleDate(property: PropertyRecord): string | undefined {
  return normalizeDate(property.saleRecordDate) ?? normalizeDate(property.saleTransactionDate) ?? normalizeDate(property.lastSaleDate);
}

function inDateRange(date: string | undefined, startDate: string, endDate: string): boolean {
  if (!date) return false;
  return date >= startDate && date <= endDate;
}

function transactionKey(property: PropertyRecord): string {
  const saleDate = effectiveSaleDate(property) ?? "unknown-date";
  const doc = property.saleDocumentNumber || property.saleTransactionId || "unknown-doc";
  return `${property.sourcePropertyId}|${doc}|${saleDate}`;
}

function dedupeMatches(matches: PropertyMatch[]): PropertyMatch[] {
  const bestByKey = new Map<string, PropertyMatch>();
  for (const match of matches) {
    const key = `${match.prospectId}|${match.role}|${transactionKey(match.property)}`;
    const existing = bestByKey.get(key);
    if (!existing || existing.combinedScore < match.combinedScore) {
      bestByKey.set(key, match);
    }
  }
  return Array.from(bestByKey.values());
}

function buildPriorState(property: PropertyRecord): PriorStateRecord {
  return {
    sourcePropertyId: property.sourcePropertyId,
    ownerFingerprints: buildOwnerFingerprints(property),
    lastSaleDate: property.lastSaleDate,
    lastSalePrice: property.lastSalePrice,
    mortgageAmount: property.mortgageAmount,
    assessedTotal: property.assessedTotal,
    lastSeen: new Date().toISOString(),
  };
}

function buildSignals(property: PropertyRecord, role: "buyer" | "seller") {
  const signal = role === "buyer"
    ? `Recent property purchase recorded at ${property.situsAddress}`
    : `Recent property sale recorded at ${property.situsAddress}`;
  const action = role === "buyer"
    ? "Review for buyer capacity and recent acquisition context"
    : "Review for liquidity or relocation context";
  return [{
    tier: 1 as const,
    signal,
    detail: property.situsAddress,
    action,
  }];
}

function qualitySortValue(quality: MatchQuality): number {
  switch (quality) {
    case "high": return 4;
    case "medium": return 3;
    case "low": return 2;
    default: return 1;
  }
}

function hasMatchableParty(property: PropertyRecord): boolean {
  return property.parsedOwners.length > 0 || property.parsedSellers.length > 0;
}

function isTransactionCandidate(property: PropertyRecord, alertStartDate: string, alertEndDate: string): boolean {
  const saleDate = normalizeDate(property.saleRecordDate) ?? normalizeDate(property.saleTransactionDate);
  if (!inDateRange(saleDate, alertStartDate, alertEndDate)) return false;
  if (!hasMatchableParty(property)) return false;
  if ((property.lastSalePrice ?? 0) <= 100) return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractHistoryRows(payload: unknown): HistoryTransactionRow[] {
  const root = asRecord(payload);
  const propertyEntries = Array.isArray(root.property) ? root.property : [];
  const rows: HistoryTransactionRow[] = [];

  for (const entry of propertyEntries) {
    const property = asRecord(entry);
    const saleHistory = Array.isArray(property.saleHistory)
      ? property.saleHistory
      : Array.isArray(property.salehistory)
        ? property.salehistory
        : [];

    for (const historyEntry of saleHistory) {
      const history = asRecord(historyEntry);
      rows.push({
        buyerName: getString(history.buyerName),
        sellerName: getString(history.sellerName),
        saleRecordDate: normalizeDate(getString(history.saleRecDate)),
        saleTransactionDate: normalizeDate(getString(history.saleTransDate)),
        saleDocumentNumber: getString(history.saleDocNum),
      });
    }
  }

  return rows;
}

function historyMatchesTransaction(row: HistoryTransactionRow, property: PropertyRecord): boolean {
  const propertyDate = effectiveSaleDate(property);
  const rowDate = row.saleRecordDate ?? row.saleTransactionDate;
  if (property.saleDocumentNumber && row.saleDocumentNumber) {
    return property.saleDocumentNumber === row.saleDocumentNumber;
  }
  if (propertyDate && rowDate) {
    return propertyDate === rowDate;
  }
  return true;
}

function historyConfirmsParty(match: PropertyMatch, rows: HistoryTransactionRow[]): boolean {
  for (const row of rows) {
    if (!historyMatchesTransaction(row, match.property)) continue;
    const partyName = match.role === "buyer" ? row.buyerName : row.sellerName;
    if (!partyName) continue;
    const parsed = parseOwnerName(partyName);
    if (parsed.some((entry) => entry.normalized && entry.normalized === match.matchedOwner.normalized)) {
      return true;
    }
  }
  return false;
}

function variantForScore(value: VariantType | "trust_extracted" | "co_owner"): VariantType | "trust_extracted" | "co_owner" {
  return value;
}

export class MonitoringEngine {
  private readonly attomClient: AttomClient;
  private readonly cacheStore: CacheStore;
  private readonly logger: Logger;

  constructor(deps: MonitoringEngineDeps) {
    this.attomClient = deps.attomClient;
    this.cacheStore = deps.cacheStore;
    this.logger = deps.logger ?? createLogger(true);
  }

  async execute(options: MonitoringRunOptions): Promise<MonitoringManifest> {
    const manifest = createEmptyManifest(options.runId, "monitor", options.prospectsPath, options.outputDir, options.counties);
    const { prospects, summary } = loadProspectsDetailed(options.prospectsPath);
    manifest.prospectLoad = summary;
    const { prospectIndex } = buildProspectIndex(prospects);

    const alertEndDate = normalizeDate(options.endDate) ?? normalizeDate(isoDate(new Date()))!;
    const alertStartDate = normalizeDate(options.startDate) ?? alertEndDate;
    const scanEndDate = toCalendarDate(alertEndDate);
    const scanStartDate = shiftCalendarDate(scanEndDate, -(REFRESH_LOOKBACK_DAYS - 1));
    const accepted: PropertyMatch[] = [];
    const review: PropertyMatch[] = [];
    const countyErrors: Array<{ county: string; error: string }> = [];

    for (let ci = 0; ci < options.counties.length; ci++) {
      const county = options.counties[ci];
      this.logger.info(`[${ci + 1}/${options.counties.length}] County ${county}...`);
      try {
        const watermark = this.cacheStore.readWatermark(county);
        this.cacheStore.writeWatermark(county, {
          lastCompleted: watermark?.lastCompleted,
          lastStarted: alertEndDate,
          status: "partial",
        });

        const priorStateWrites: PriorStateRecord[] = [];
        const matchesForCounty: PropertyMatch[] = [];
        let page = 1;
        let totalPages: number | undefined;

        while (true) {
          const pageResult = await this.loadPage(county, scanStartDate, scanEndDate, page);
          manifest.counts.apiCalls += pageResult.fromCache ? 0 : 1;
          manifest.counts.cacheHits += pageResult.fromCache ? 1 : 0;
          if (typeof pageResult.pages === "number") totalPages = pageResult.pages;
          this.cacheStore.markPageComplete(county, scanStartDate, scanEndDate, page, totalPages);

          for (const rawProperty of pageResult.properties) {
            const property = normalizeAttomProperty(rawProperty);
            if (!property.sourcePropertyId) continue;
            manifest.counts.propertyRecordsProcessed += 1;
            manifest.counts.ownersParsed += property.parsedOwners.length + property.parsedSellers.length;
            if (!options.skipPriorState) priorStateWrites.push(buildPriorState(property));

            if (!isTransactionCandidate(property, alertStartDate, alertEndDate)) continue;
            const propertyMatches = this.matchProperty(property, prospectIndex);
            matchesForCounty.push(...propertyMatches);
            manifest.counts.candidateMatches += propertyMatches.length;
          }

          if (pageResult.properties.length < pageResult.pageSize) break;
          if (typeof totalPages === "number" && page >= totalPages) break;
          page += 1;
        }

        if (!options.skipPriorState) this.cacheStore.writePriorStates(priorStateWrites);
        this.cacheStore.writeWatermark(county, {
          lastCompleted: alertEndDate,
          lastStarted: alertEndDate,
          status: "complete",
        });
        manifest.counts.countiesScanned += 1;
        this.logger.info(`  ${county}: ${page} pages, ${matchesForCounty.length} raw matches`);

        const deduped = dedupeMatches(matchesForCounty);
        if (!options.skipEnrichment) {
          await this.enrichAmbiguousMatches(deduped);
        }

        for (const match of deduped.sort((a, b) => qualitySortValue(b.quality) - qualitySortValue(a.quality) || b.combinedScore - a.combinedScore)) {
          if (routeMatch(match.quality) === "client") {
            accepted.push(match);
            manifest.counts.acceptedMatches += 1;
          } else {
            review.push(match);
            manifest.counts.reviewMatches += 1;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`County ${county} failed: ${message}`);
        countyErrors.push({ county, error: message });
      }
    }

    if (countyErrors.length > 0) {
      this.logger.warn(`${countyErrors.length} county scan(s) failed: ${countyErrors.map((e) => e.county).join(", ")}`);
    }

    const runDir = path.join(options.outputDir, options.runId);
    fs.mkdirSync(runDir, { recursive: true });
    writeMatchCsv(manifest.outputs.clientCsv, accepted);
    writeMatchCsv(manifest.outputs.reviewCsv, review);
    writeSummary(manifest.outputs.summaryTxt, accepted, review, manifest.counts, {
      startDate: alertStartDate,
      endDate: alertEndDate,
      prospectsPath: options.prospectsPath,
    });
    manifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(manifest.outputs.statsJson, `${JSON.stringify(manifest.counts, null, 2)}\n`, "utf8");
    fs.writeFileSync(manifest.outputs.manifestJson, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  private async loadPage(fips: string, startDate: string, endDate: string, page: number): Promise<AttomFetchPageResult> {
    const cached = this.cacheStore.readPage<AttomFetchPageResult>(fips, startDate, endDate, page);
    if (cached) {
      return { ...cached, fromCache: true };
    }
    const fetched = await this.attomClient.fetchCountyPage({ fips, startDate, endDate, page });
    this.cacheStore.writePage(fips, startDate, endDate, page, fetched);
    return fetched;
  }

  private matchProperty(
    property: PropertyRecord,
    prospectIndex: Map<string, IndexedProspect[]>,
  ): PropertyMatch[] {
    return [
      ...this.matchParties("buyer", property.parsedOwners, property, prospectIndex),
      ...this.matchParties("seller", property.parsedSellers, property, prospectIndex),
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
          variantType: variantForScore(candidate.variantType),
          addressMatch,
          portfolioCorroborationCount: 1,
          changeType: "sale_update",
        });
        const scored = scoreMatch(features);
        const reasons = [...scored.reasons];
        if (property.quitClaimFlag?.toLowerCase() === "true") {
          reasons.push("flag:quitclaim");
        }
        if (property.saleTransactionType && property.saleTransactionType !== "Resale") {
          reasons.push(`flag:${property.saleTransactionType.toLowerCase().replace(/\s+/g, "_")}`);
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
          nameScore: variantWeight(variantForScore(candidate.variantType)),
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

  private async enrichAmbiguousMatches(matches: PropertyMatch[]): Promise<void> {
    const targets = Array.from(new Set(
      matches
        .filter((match) => match.quality !== "high")
        .map((match) => match.property.sourcePropertyId)
        .filter(Boolean),
    ));

    if (targets.length === 0) return;

    const historyByProperty = new Map<string, HistoryTransactionRow[]>();

    for (const attomId of targets) {
      try {
        const payload = await this.attomClient.fetchExpandedHistory(attomId);
        historyByProperty.set(attomId, extractHistoryRows(payload));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Expanded history lookup failed for ${attomId}: ${message}`);
      }
    }

    for (const match of matches) {
      const rows = historyByProperty.get(match.property.sourcePropertyId);
      if (!rows || rows.length === 0) continue;
      if (historyConfirmsParty(match, rows)) {
        match.matchReasons = Array.from(new Set([...match.matchReasons, `history:${match.role}_confirmed`]));
      }
    }
  }

  static fromEnv(cwd: string, stateDir?: string): MonitoringEngine {
    const envValues = readEnvFile(cwd);
    const apiKeyRaw = process.env.ATTOM_API_KEY || envValues.ATTOM_API_KEY || "";
    const apiKeys = apiKeyRaw.split(",").map((k) => k.trim()).filter(Boolean);
    if (apiKeys.length === 0) throw new Error("Missing ATTOM_API_KEY in environment or .env");
    const root = stateDir || process.env.RESTATE_STATE_DIR || envValues.RESTATE_STATE_DIR || path.join(cwd, ".restate");
    const stateStore = new StateStore(root);
    stateStore.ensure();
    return new MonitoringEngine({
      attomClient: new AttomClient({ apiKeys }),
      cacheStore: new CacheStore(stateStore),
    });
  }
}
