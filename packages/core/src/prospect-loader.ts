import fs from "node:fs";

import { ProspectLoadSummary, ProspectRecord } from "./types";
import { parseCsvLine } from "./csv";
import { stripLegalSuffixes } from "./employer-matcher";
import { parsePersonName } from "./name-parser";

const COLUMN_ALIASES: Record<string, string[]> = {
  prospectId: ["prospect_id", "id", "prospectid"],
  name: ["name", "prospect_name", "fullname", "full_name"],
  aliasName: ["prospect_alias_name", "alias_name", "alias_names", "aliases"],
  company: ["company", "employer", "organization", "org", "prospect_company"],
  otherCompany: ["prospect_other_company", "other_company", "other_companies", "custom_companies"],
  address: ["address", "address_block", "street", "street_address", "mailing_address"],
  city: ["city", "location"],
  state: ["state"],
  zip: ["zip", "postcode", "postal_code", "zip_code"],
  country: ["country"],
  title: ["title", "designation", "job_title", "position"],
  externalId: ["external_id", "externalid", "crm_id"],
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex((header) => aliases.includes(header));
}

export function loadProspects(csvPath: string): ProspectRecord[] {
  return loadProspectsDetailed(csvPath).prospects;
}

export function loadProspectsDetailed(csvPath: string): {
  prospects: ProspectRecord[];
  summary: ProspectLoadSummary;
} {
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Prospect CSV is empty or missing data rows: ${csvPath}`);
  }

  const headers = parseCsvLine(lines[0]);
  const nameIndex = findColumn(headers, COLUMN_ALIASES.name);
  const idIndex = findColumn(headers, COLUMN_ALIASES.prospectId);
  const aliasNameIndex = findColumn(headers, COLUMN_ALIASES.aliasName);
  const companyIndex = findColumn(headers, COLUMN_ALIASES.company);
  const otherCompanyIndex = findColumn(headers, COLUMN_ALIASES.otherCompany);
  const addressIndex = findColumn(headers, COLUMN_ALIASES.address);
  const cityIndex = findColumn(headers, COLUMN_ALIASES.city);
  const stateIndex = findColumn(headers, COLUMN_ALIASES.state);
  const zipIndex = findColumn(headers, COLUMN_ALIASES.zip);
  const titleIndex = findColumn(headers, COLUMN_ALIASES.title);
  const countryIndex = findColumn(headers, COLUMN_ALIASES.country);
  const externalIdIndex = findColumn(headers, COLUMN_ALIASES.externalId);

  if (nameIndex === -1) {
    throw new Error(`Prospect CSV must contain a name column. Headers: ${headers.join(", ")}`);
  }

  const results: ProspectRecord[] = [];
  const failures: ProspectLoadSummary["failures"] = [];

  for (let i = 1; i < lines.length; i++) {
    const columns = parseCsvLine(lines[i]);
    const rawName = columns[nameIndex] ?? "";
    const parsedName = parsePersonName(rawName);
    if (!parsedName) {
      failures.push({ row: i + 1, name: rawName });
      continue;
    }

    const aliasNamesRaw = aliasNameIndex >= 0 ? columns[aliasNameIndex] ?? "" : "";
    const aliasNames = aliasNamesRaw
      ? aliasNamesRaw.split(";").map((s) => s.trim()).filter(Boolean)
      : [];
    const otherCompanyRaw = otherCompanyIndex >= 0 ? columns[otherCompanyIndex] ?? "" : "";
    const otherCompanies = otherCompanyRaw
      ? otherCompanyRaw.split(";").map((s) => s.trim()).filter(Boolean)
      : [];
    const companyRaw = companyIndex >= 0 ? columns[companyIndex] ?? "" : "";
    const allCompanies = [companyRaw, ...otherCompanies].filter(Boolean);

    results.push({
      prospectId: (idIndex >= 0 ? columns[idIndex] : "") || `prospect-${i}`,
      nameRaw: rawName,
      firstName: parsedName.firstName,
      middleName: parsedName.middleName,
      middleInitial: parsedName.middleInitial,
      lastName: parsedName.lastName,
      suffix: parsedName.suffix,
      nameNormalized: parsedName.normalized,
      nameNormalizedFull: parsedName.normalizedFull,
      aliasNames,
      otherCompanies,
      companyRaw,
      companyNormalized: stripLegalSuffixes(companyRaw),
      allCompaniesNormalized: allCompanies.map((c) => stripLegalSuffixes(c)),
      title: titleIndex >= 0 ? columns[titleIndex] ?? "" : "",
      address: addressIndex >= 0 ? columns[addressIndex] ?? "" : "",
      city: cityIndex >= 0 ? columns[cityIndex] ?? "" : "",
      state: stateIndex >= 0 ? columns[stateIndex] ?? "" : "",
      zip: zipIndex >= 0 ? columns[zipIndex] ?? "" : "",
      country: countryIndex >= 0 ? columns[countryIndex] ?? "" : "",
      externalId: externalIdIndex >= 0 ? columns[externalIdIndex] ?? "" : "",
    });
  }

  const totalRows = lines.length - 1;
  const skippedRows = failures.length;
  const summary: ProspectLoadSummary = {
    totalRows,
    loadedRows: results.length,
    skippedRows,
    skippedRate: totalRows > 0 ? skippedRows / totalRows : 0,
    failures,
  };

  return { prospects: results, summary };
}
