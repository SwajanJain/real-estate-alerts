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

// ---------------------------------------------------------------------------
// RealEstateAPI (PropertySearch rows)
//
// Party strings are first-name-first and comma separated, e.g.
//   "Samuel Steffl, Rayna Steffl"
//   "Marion C Waterfall,  M C Waterfall Living Trust"
// Older deeds sometimes use "Last,First" with no space ("Kozely,Peter"),
// which parsePersonName already reads FEC-style.

const REAPI_QUITCLAIM_CODES = new Set(["DTQC"]);

function personFromParts(raw: string, extractedFrom: ParsedOwner["extractedFrom"]): ParsedOwner[] {
  const parsed = parsePersonName(raw);
  if (!parsed) return [];
  return [{
    raw,
    normalized: parsed.normalized,
    firstName: parsed.firstName,
    middleName: parsed.middleName,
    lastName: parsed.lastName,
    suffix: parsed.suffix,
    extractedFrom,
  }];
}

// Split a party list into one string per party.
export function splitRealEstateApiParties(raw: string): string[] {
  const pieces = raw.split(/[;|]|,\s+/).map((piece) => piece.trim()).filter(Boolean);
  const parties: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    // "Smith, John" written with a space splits into a lone surname followed
    // by the given name(s). A real one-word party is rare, so re-join it as
    // "Smith,John" for the comma-aware parser.
    if (!/\s/.test(piece) && !piece.includes(",") && i + 1 < pieces.length) {
      parties.push(`${piece},${pieces[i + 1]}`);
      i += 1;
      continue;
    }
    parties.push(piece);
  }
  return parties;
}

// Words that start the trust-description tail of a first-name-first trust
// name. Vendor strings are often abbreviated or truncated ("Liv Tr",
// "Revocabl"), so match prefixes of the common forms.
const TRUST_TAIL_TOKEN_RE = /^(?:revoc\w*|rev|irrev\w*|irrevoc\w*|liv|living|family|fam|joint|trust\w*|trst|tr|trs|tru|tst|ttee|ttees|dtd|dated|declaration|decl|u\/?a|utd|survivors?)$/i;
const TRUST_MARKER_RE = /\b(?:trust\w*|trst|tr|trs|ttee|ttees|revoc\w*|irrevoc\w*)\b/i;

// "John & Mary Smith" -> John Smith (surname borrowed), Mary Smith;
// "Peter J And Jill R Machi" -> Peter J Machi (borrowed), Jill R Machi.
// A leading piece that is only a given name, optionally with initials,
// borrows the surname of the last piece. Borrowed names are inferred, so
// they are scored as co-owners; names written out in full count as direct.
interface JointName { name: string; borrowedSurname: boolean }

function splitJointNames(names: string): JointName[] {
  const pieces = names.split(/\s+(?:&|and)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (pieces.length < 2) return pieces.map((name) => ({ name, borrowedSurname: false }));
  const lastTokens = pieces[pieces.length - 1].split(" ");
  const surname = lastTokens.length > 1 ? lastTokens[lastTokens.length - 1] : "";
  return pieces.map((piece, index) => {
    if (index === pieces.length - 1 || !surname || piece.includes(",")) return { name: piece, borrowedSurname: false };
    const tokens = piece.split(" ");
    const onlyGivenName = tokens.length === 1 || tokens.slice(1).every((token) => /^[A-Za-z]\.?$/.test(token));
    return onlyGivenName ? { name: `${piece} ${surname}`, borrowedSurname: true } : { name: piece, borrowedSurname: false };
  });
}

function jointPeople(people: JointName[]): ParsedOwner[] {
  return people.flatMap((person) => personFromParts(person.name, person.borrowedSurname ? "co_owner" : "direct"));
}

// First-name-first trust names: "Marion C Waterfall Living Trust",
// "Paul E Lehner & Deann R Lehner Liv Tr", "The Robert And Lynelle Sukalich Revocabl".
// The named grantors are returned as people (role "trustee") so they match
// at full first+last strength; a surname-only "Smith Family Trust" yields
// nothing because it cannot identify a person.
export function parseRealEstateApiTrust(raw: string): ParsedOwner[] {
  const tokens = raw.trim().replace(/\s+/g, " ").replace(/^the\s+/i, "").split(" ");
  const tailStart = tokens.findIndex((token) => TRUST_TAIL_TOKEN_RE.test(token.replace(/[.,]/g, "")));
  const names = (tailStart >= 0 ? tokens.slice(0, tailStart) : tokens).join(" ").trim();
  if (!names) return [];
  const people = splitJointNames(names);
  if (people.length === 1 && people[0].name.split(" ").length < 2) return [];
  return jointPeople(people).map((owner) => ({ ...owner, role: "trustee" as const }));
}

// Parse one first-name-first party. Entities yield nothing; trusts go through
// the first-name-first trust parser; estates use the shared resolver;
// "John & Mary Smith" becomes two people sharing the trailing surname.
export function parseRealEstateApiParty(raw: string): ParsedOwner[] {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return [];
  const type = classifyOwnerEntity(trimmed.toUpperCase());
  if (type === "llc" || type === "corporation") return [];
  if (type === "trust" || TRUST_MARKER_RE.test(trimmed)) return parseRealEstateApiTrust(trimmed);
  if (type === "estate") return parseOwnerName(trimmed);

  const joint = splitJointNames(trimmed);
  if (joint.length > 1) return jointPeople(joint);
  return personFromParts(trimmed, "direct");
}

export function parseRealEstateApiParties(raw: string): ParsedOwner[] {
  const seen = new Set<string>();
  const owners: ParsedOwner[] = [];
  for (const party of splitRealEstateApiParties(raw)) {
    for (const owner of parseRealEstateApiParty(party)) {
      if (seen.has(owner.normalized)) continue;
      seen.add(owner.normalized);
      owners.push(owner);
    }
  }
  return owners;
}

// Current-owner fields, used only when the deed's buyer string is missing.
function ownerFieldsAsPartyString(root: AnyRecord): string {
  const people = [1, 2]
    .map((n) => [getString(root[`owner${n}FirstName`]), getString(root[`owner${n}LastName`])].filter(Boolean).join(" "))
    .filter(Boolean);
  const company = getString(root.companyName);
  return [...people, company].filter(Boolean).join(", ");
}

export function normalizeRealEstateApiProperty(payload: unknown): PropertyRecord {
  const root = asRecord(payload);
  const address = asRecord(root.address);
  const mail = asRecord(root.mailAddress);

  const buyerRaw = getString(root.lastSaleBuyerNames) || ownerFieldsAsPartyString(root);
  const sellerRaw = getString(root.priorOwner);
  const parsedOwners = parseRealEstateApiParties(buyerRaw);
  const parsedSellers = parseRealEstateApiParties(sellerRaw);

  const saleDate = normalizeIsoDate(getString(root.lastSaleDate));
  const recordingDate = normalizeIsoDate(getString(root.recordingDate));
  // Non-disclosure states report the price as 0. Treat that as unknown, not
  // as a nominal-price transfer, or every TX/UT/etc. sale would be dropped.
  const rawPrice = getNumber(root.lastSaleAmount);
  const salePrice = rawPrice !== undefined && rawPrice > 0 ? rawPrice : undefined;
  const documentType = getString(root.documentType);
  const documentTypeCode = getString(root.documentTypeCode).toUpperCase();
  const ownerOccupied = typeof root.ownerOccupied === "boolean" ? root.ownerOccupied : undefined;
  const absentee = typeof root.absenteeOwner === "boolean" ? root.absenteeOwner : undefined;
  const useCode = root.propertyUseCode;

  return {
    source: "realestateapi",
    sourcePropertyId: String(root.id ?? root.propertyId ?? ""),
    parcelId: getString(root.apn) || undefined,
    countyFips: getString(address.fips) || undefined,
    county: getString(address.county) || undefined,
    sourceCalendardate: undefined,
    situsAddress: firstString(address.street, address.address),
    situsCity: getString(address.city) || undefined,
    situsState: getString(address.state) || undefined,
    situsZip: getString(address.zip) || undefined,
    ownerRaw: buyerRaw,
    ownerRaw2: undefined,
    ownerType: classifyOwnerEntity(buyerRaw.toUpperCase()),
    parsedOwners,
    sellerRaw,
    parsedSellers,
    ownerMailingAddress: firstString(mail.address, mail.street) || undefined,
    ownerMailingCity: getString(mail.city) || undefined,
    ownerMailingState: getString(mail.state) || undefined,
    ownerMailingZip: getString(mail.zip) || undefined,
    propertyType: firstString(root.propertyUse, root.propertyType) || undefined,
    useCode: typeof useCode === "number" || typeof useCode === "string" ? String(useCode) : undefined,
    assessedLand: getNumber(root.assessedLandValue),
    assessedImprovement: getNumber(root.assessedImprovementValue),
    assessedTotal: getNumber(root.assessedValue),
    estimatedValue: getNumber(root.estimatedValue),
    lastSaleDate: recordingDate || saleDate,
    lastSalePrice: salePrice,
    saleRecordDate: recordingDate,
    saleTransactionDate: saleDate,
    saleSearchDate: undefined,
    saleDocumentNumber: undefined,
    saleTransactionType: documentType || undefined,
    saleTransactionId: undefined,
    quitClaimFlag: REAPI_QUITCLAIM_CODES.has(documentTypeCode) || /quit\s*claim/i.test(documentType) ? "true" : undefined,
    isArmsLength: typeof root.lastSaleArmsLength === "boolean" ? root.lastSaleArmsLength : undefined,
    mortgageAmount: getNumber(root.openMortgageBalance),
    mortgageLender: getString(root.lenderName) || undefined,
    isOwnerOccupied: ownerOccupied,
    isAbsenteeOwner: absentee,
    raw: payload,
  };
}

// PropertySearch's priorOwner is the assessor's previous owner, which can be
// empty or name later heirs (e.g. after a transfer-on-death deed). The deed's
// grantor list lives in PropertyDetail.lastSale.sellerNames. We keep the union
// of both lists, because each side has errors the other lacks (a deed typo like
// "Rurie" for "Ruric", or a priorOwner naming heirs instead of grantors).
// Only applied when the detail's sale is the same sale as the search row's.
function unionOwners(a: ParsedOwner[], b: ParsedOwner[]): ParsedOwner[] {
  const seen = new Set(a.map((owner) => owner.normalized));
  return [...a, ...b.filter((owner) => !seen.has(owner.normalized))];
}

export function applyRealEstateApiSaleDetail(property: PropertyRecord, detailPayload: unknown): PropertyRecord {
  const detail = asRecord(asRecord(detailPayload).data ?? detailPayload);
  const lastSale = asRecord(detail.lastSale);
  const detailSaleDate = normalizeIsoDate(getString(lastSale.saleDate));
  if (detailSaleDate && property.saleTransactionDate && detailSaleDate !== property.saleTransactionDate) return property;
  const sellerRaw = getString(lastSale.sellerNames);
  const buyerRaw = getString(lastSale.buyerNames);
  return {
    ...property,
    sellerRaw: [sellerRaw, property.sellerRaw].filter(Boolean).join(" | "),
    parsedSellers: unionOwners(parseRealEstateApiParties(sellerRaw), property.parsedSellers),
    ownerRaw: [buyerRaw, property.ownerRaw].filter((v, i, all) => v && all.indexOf(v) === i).join(" | "),
    parsedOwners: unionOwners(parseRealEstateApiParties(buyerRaw), property.parsedOwners),
    saleDocumentNumber: getString(lastSale.documentNumber) || property.saleDocumentNumber,
  };
}
