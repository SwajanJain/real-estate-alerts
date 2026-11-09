export type VariantType =
  | "exact"
  | "nickname"
  | "suffix_stripped"
  | "middle_dropped"
  | "dehyphenated"
  | "initial_variant";

export interface PersonNameParts {
  raw: string;
  firstName: string;
  middleName: string;
  middleInitial: string;
  lastName: string;
  suffix: string;
  normalized: string;
  normalizedFull: string;
}

export interface ProspectRecord {
  prospectId: string;
  nameRaw: string;
  firstName: string;
  middleName: string;
  middleInitial: string;
  lastName: string;
  suffix: string;
  nameNormalized: string;
  nameNormalizedFull: string;
  aliasNames: string[];
  otherCompanies: string[];
  companyRaw: string;
  companyNormalized: string;
  allCompaniesNormalized: string[];
  title: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  externalId: string;
}

export interface EmployerMatchResult {
  status: "confirmed" | "likely" | "weak_overlap" | "non_informative" | "missing" | "mismatch";
  note: string;
  scoreImpact: number;
}

export interface ProspectLoadFailure {
  row: number;
  name: string;
}

export interface ProspectLoadSummary {
  totalRows: number;
  loadedRows: number;
  skippedRows: number;
  skippedRate: number;
  failures: ProspectLoadFailure[];
}
