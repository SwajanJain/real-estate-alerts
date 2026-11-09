// Types
export type { PersonNameParts, ProspectRecord, VariantType, EmployerMatchResult, ProspectLoadFailure, ProspectLoadSummary } from "./types";

// Name parsing
export { parseFecName, parsePersonName, NAME_SUFFIXES_RE } from "./name-parser";

// Name variants & indexing
export { NICKNAME_GROUPS, NICKNAME_LOOKUP, generateNameVariants, buildProspectIndex } from "./name-index";
export type { IndexedProspect, ProspectIndexBuild } from "./name-index";

// Employer matching
export { LEGAL_SUFFIXES_RE, stripLegalSuffixes, matchEmployer } from "./employer-matcher";

// Geographic matching
export { normalizeState, normalizeCity, normalizeZip5, matchLocation } from "./geo-matcher";
export type { LocationMatchResult } from "./geo-matcher";

// Prospect loading
export { loadProspects, loadProspectsDetailed } from "./prospect-loader";

// CSV utilities
export { parseCsvLine, escapeCsvValue } from "./csv";

// State store
export { StateStore } from "./state-store";
export type { StateStorePaths } from "./state-store";

// Logger
export { createLogger } from "./logger";
export type { Logger } from "./logger";

// Config
export { loadConfig } from "./config";
export type { AppConfig } from "./config";
