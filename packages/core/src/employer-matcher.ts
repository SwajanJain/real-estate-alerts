import { EmployerMatchResult } from "./types";

export const LEGAL_SUFFIXES_RE = /\b(inc\.?|incorporated|corp\.?|corporation|company|co\.?|llc|ltd\.?|limited|plc|lp|l\.?p\.?|group|holdings|enterprises?|partners|partnership|& co\.?)\b/gi;

const NON_INFORMATIVE_EMPLOYERS = new Set([
  "retired",
  "self-employed",
  "self employed",
  "self",
  "none",
  "n/a",
  "na",
  "not employed",
  "homemaker",
  "home maker",
  "student",
  "information requested",
  "information requested per best efforts",
]);

export function stripLegalSuffixes(name: string): string {
  return (name || "")
    .replace(LEGAL_SUFFIXES_RE, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function firstToken(value: string): string {
  return value.split(/\s+/).find(Boolean) ?? "";
}

export function matchEmployer(prospectCompany: string, donorEmployer: string): EmployerMatchResult {
  const prospect = stripLegalSuffixes(prospectCompany);
  const donor = stripLegalSuffixes(donorEmployer);

  if (!prospect && !donor) {
    return { status: "missing", note: "Prospect company and donor employer missing", scoreImpact: 0 };
  }

  if (!donor) {
    return { status: "missing", note: "Donor employer missing", scoreImpact: -5 };
  }

  if (NON_INFORMATIVE_EMPLOYERS.has(donor)) {
    return { status: "non_informative", note: `Donor employer non-informative: ${donorEmployer}`, scoreImpact: -5 };
  }

  if (!prospect) {
    return { status: "missing", note: "Prospect company missing", scoreImpact: -5 };
  }

  if (prospect === donor) {
    return { status: "confirmed", note: `Employer confirmed: ${donorEmployer}`, scoreImpact: 35 };
  }

  if (prospect.includes(donor) || donor.includes(prospect)) {
    return { status: "likely", note: `Employer likely match: ${prospectCompany} vs ${donorEmployer}`, scoreImpact: 25 };
  }

  if (firstToken(prospect) && firstToken(prospect) === firstToken(donor)) {
    return { status: "weak_overlap", note: `Weak employer overlap: ${prospectCompany} vs ${donorEmployer}`, scoreImpact: 10 };
  }

  return { status: "mismatch", note: `Employer mismatch: ${prospectCompany} vs ${donorEmployer}`, scoreImpact: -35 };
}
