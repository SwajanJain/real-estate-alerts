import { parsePersonName } from "@pm/core";

import type { ParsedOwner, PropertyRecord } from "../core/types";
import { classifyOwnerEntity } from "../lib/owner-entity-classifier";
import { parseOwnerName } from "./owner-name-parser";
import { normalizeAddress } from "./address-normalizer";

// BatchData saleBuyers/saleSellers come as title-case "Last First" strings
// (one party per array entry). Uppercase so the LASTFIRST heuristic in
// parseOwnerName fires; the parser is the single source of truth for the rest.
function parseBatchDataParty(raw: string): ParsedOwner[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return parseOwnerName(trimmed.toUpperCase());
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" ? value as AnyRecord : {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = getString(value);
    if (normalized) return normalized;
  }
  return "";
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeOwner(ownerPayload: AnyRecord): ParsedOwner[] {
  const last = firstString(ownerPayload.lastname, ownerPayload.lastName);
  const firstAndMi = firstString(ownerPayload.firstnameandmi, ownerPayload.firstNameAndMi);
  const full = firstString(ownerPayload.fullname, ownerPayload.fullName) || [firstAndMi, last].filter(Boolean).join(" ").trim();
  if (!full) return [];

  const parsed = parsePersonName(full);
  if (parsed) {
    return [{
      raw: full,
      normalized: parsed.normalized,
      firstName: parsed.firstName,
      middleName: parsed.middleName,
      lastName: parsed.lastName,
      suffix: parsed.suffix,
      extractedFrom: "direct",
    }];
  }
  return parseOwnerName(full);
}

export function normalizeAttomProperty(payload: unknown): PropertyRecord {
  const root = asRecord(payload);
  const identifier = asRecord(root.identifier);
  const address = asRecord(root.address);
  const summary = asRecord(root.summary);
  const assessment = asRecord(root.assessment);
  const assessed = asRecord(assessment.assessed);
  const avm = asRecord(asRecord(root.avm).amount);
  const sale = asRecord(root.sale);
  const saleAmount = asRecord(sale.amount);
  const mortgage = asRecord(root.mortgage);
  const owner = asRecord(assessment.owner);

  const ownerPayloads = [owner.owner1, owner.owner2, owner.owner3, owner.owner4].map(asRecord);
  const parsedOwners = ownerPayloads.flatMap(normalizeOwner);
  const ownerRaw = ownerPayloads.map((entry) => firstString(entry.fullname, entry.fullName)).filter(Boolean).join(" | ");
  const ownerMailingAddress = firstString(owner.mailingaddressoneline, owner.mailingAddressOneLine);
  const mailing = normalizeAddress(ownerMailingAddress);
  const situs = normalizeAddress(firstString(address.oneLine, address.line1));
  const ownerType = classifyOwnerEntity(ownerRaw || getString(owner.owner1));
  const absenteeStatus = firstString(owner.absenteeownerstatus, owner.absenteeOwnerStatus).toUpperCase();
  const sellerRaw = getString(sale.sellerName);
  const parsedSellers = parseOwnerName(sellerRaw);
  const saleRecordDate = firstString(saleAmount.saleRecDate, saleAmount.salerecdate);
  const saleTransactionDate = firstString(sale.saleTransDate, sale.saleTransdate);
  const saleSearchDate = firstString(sale.saleSearchDate, sale.salesearchdate);
  const saleAmountValue = getNumber(saleAmount.saleAmt ?? saleAmount.value ?? sale.amount);
  const saleDocumentNumber = firstString(saleAmount.saleDocNum, saleAmount.saledocnum);
  const saleTransactionType = firstString(saleAmount.saleTransType, saleAmount.saleTranstype);
  const quitClaimFlag = firstString(summary.quitClaimFlag, summary.quitclaimflag);
  const propertyType = firstString(summary.propType, summary.proptype);
  const assessedTotal = getNumber(assessed.assdTtlValue ?? assessed.assdttlvalue);

  return {
    source: "attom",
    sourcePropertyId: String(identifier.attomId ?? identifier.Id ?? identifier.id ?? root.id ?? ""),
    parcelId: getString(identifier.apn),
    countyFips: getString(address.fips),
    county: getString(address.county),
    sourceCalendardate: firstString(root.calendardate, root.calendarDate),
    situsAddress: firstString(address.oneLine, address.line1) || situs?.line1 || "",
    situsCity: getString(address.locality) || situs?.city,
    situsState: getString(address.countrySubd) || situs?.state,
    situsZip: getString(address.postal1) || situs?.zip,
    ownerRaw,
    ownerRaw2: firstString(asRecord(owner.owner2).fullname, asRecord(owner.owner2).fullName),
    ownerType,
    parsedOwners,
    sellerRaw,
    parsedSellers,
    ownerMailingAddress,
    ownerMailingCity: mailing?.city,
    ownerMailingState: mailing?.state,
    ownerMailingZip: mailing?.zip,
    propertyType,
    useCode: getString(summary.propclass),
    assessedLand: getNumber(assessed.assdLandValue ?? assessed.assdlandvalue),
    assessedImprovement: getNumber(assessed.assdImprValue ?? assessed.assdimprvalue),
    assessedTotal,
    estimatedValue: getNumber(avm.value),
    lastSaleDate: saleRecordDate || saleTransactionDate || saleSearchDate,
    lastSalePrice: saleAmountValue,
    saleRecordDate,
    saleTransactionDate,
    saleSearchDate,
    saleDocumentNumber,
    saleTransactionType,
    saleTransactionId: getString(sale.transactionIdent),
    quitClaimFlag,
    mortgageAmount: getNumber(mortgage.amount),
    mortgageLender: getString(mortgage.lendername),
    isOwnerOccupied: absenteeStatus === "O",
    isAbsenteeOwner: absenteeStatus === "A",
    raw: payload,
  };
}

// BatchData document type codes that indicate non-arms-length transfers.
// We surface them as flags in the match reasons rather than dropping rows.
const QUITCLAIM_CODES = new Set(["QC", "Q"]);

function normalizeIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizeBatchDataProperty(payload: unknown): PropertyRecord {
  const root = asRecord(payload);
  const address = asRecord(root.address);
  const ids = asRecord(root.ids);
  const ownerPayload = asRecord(root.owner);
  const ownerMailing = asRecord(ownerPayload.mailingAddress);
  const general = asRecord(root.general);
  const assessment = asRecord(root.assessment);
  const sale = asRecord(root.sale);
  const lastSale = asRecord(sale.lastSale);

  const buyerStrings = Array.isArray(lastSale.saleBuyers) ? lastSale.saleBuyers as unknown[] : [];
  const sellerStrings = Array.isArray(lastSale.saleSellers) ? lastSale.saleSellers as unknown[] : [];
  const parsedOwners = buyerStrings.flatMap((entry) => parseBatchDataParty(getString(entry)));
  const parsedSellers = sellerStrings.flatMap((entry) => parseBatchDataParty(getString(entry)));

  const ownerRaw = buyerStrings.map(getString).filter(Boolean).join(" | ")
    || getString(ownerPayload.fullName);
  const ownerType = classifyOwnerEntity(ownerRaw);

  const situsAddress = firstString(address.street, address.oneLine);
  const mailingAddress = firstString(ownerMailing.street, ownerMailing.oneLine);
  const salePrice = getNumber(lastSale.price);
  const saleDate = normalizeIsoDate(getString(lastSale.saleDate));
  const recordingDate = normalizeIsoDate(getString(lastSale.recordingDate));
  const docTypeCode = getString(lastSale.documentTypeCode).toUpperCase();
  const transactionTypeCode = getString(lastSale.transactionTypeCode).toUpperCase();
  // BatchData's core dataset only populates transactionTypeCode ~9% of the time.
  // Treat the missing case as unknown (undefined) rather than non-arms-length —
  // otherwise we'd falsely flag the 91% of records where BatchData simply has
  // no opinion.
  const isArmsLength: boolean | undefined =
    transactionTypeCode === "B" || transactionTypeCode === "1" ? true :
    transactionTypeCode === "" ? undefined : false;

  // Owner-occupied heuristic: situs street == mailing street (post-sale buyer).
  const isOwnerOccupied = situsAddress && mailingAddress
    ? situsAddress.toLowerCase() === mailingAddress.toLowerCase()
    : undefined;

  return {
    source: "batchdata",
    sourcePropertyId: getString(root._id),
    parcelId: getString(ids.apn),
    countyFips: getString(address.countyFipsCode),
    county: getString(address.county),
    sourceCalendardate: undefined,
    situsAddress: situsAddress || "",
    situsCity: getString(address.city),
    situsState: getString(address.state),
    situsZip: getString(address.zip),
    ownerRaw,
    ownerRaw2: buyerStrings.length > 1 ? getString(buyerStrings[1]) : undefined,
    ownerType,
    parsedOwners,
    sellerRaw: sellerStrings.map(getString).filter(Boolean).join(" | "),
    parsedSellers,
    ownerMailingAddress: mailingAddress || undefined,
    ownerMailingCity: getString(ownerMailing.city) || undefined,
    ownerMailingState: getString(ownerMailing.state) || undefined,
    ownerMailingZip: getString(ownerMailing.zip) || undefined,
    propertyType: firstString(general.propertyTypeDetail, general.propertyTypeCategory) || undefined,
    useCode: getString(general.standardizedLandUseCode) || undefined,
    assessedLand: getNumber(assessment.assessedLandValue),
    assessedImprovement: getNumber(assessment.assessedImprovementValue),
    assessedTotal: getNumber(assessment.totalAssessedValue),
    estimatedValue: getNumber(asRecord(root.valuation).estimatedValue),
    lastSaleDate: recordingDate || saleDate,
    lastSalePrice: salePrice,
    saleRecordDate: recordingDate,
    saleTransactionDate: saleDate,
    saleSearchDate: undefined,
    saleDocumentNumber: getString(lastSale.documentNumber) || undefined,
    saleTransactionType: getString(lastSale.transactionType) || undefined,
    saleTransactionId: getString(lastSale.transactionId) || undefined,
    quitClaimFlag: QUITCLAIM_CODES.has(docTypeCode) ? "true" : undefined,
    isArmsLength,
    mortgageAmount: undefined,
    mortgageLender: undefined,
    isOwnerOccupied,
    isAbsenteeOwner: isOwnerOccupied === undefined ? undefined : !isOwnerOccupied,
    raw: payload,
  };
}
