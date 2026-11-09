import { parsePersonName } from "@pm/core";

import type { ParsedOwner } from "../core/types";

const TRUSTEE_SUFFIX_RE = /^(.+?)\s+(?:TTEE|TR|TRS|TRUSTEE|TRUSTEES)$/i;
const REVOCABLE_RE = /^(.+?)\s+(?:REVOCABLE|IRREVOCABLE|LIVING|FAMILY)\s+TRUST/i;
const FAMILY_TRUST_RE = /^(?:THE\s+)?([A-Z' -]+)\s+FAMILY\s+TRUST/i;

function buildParsedOwner(raw: string, parsed: ReturnType<typeof parsePersonName>): ParsedOwner[] {
  if (!parsed) return [];
  return [{
    raw,
    normalized: parsed.normalized,
    firstName: parsed.firstName,
    middleName: parsed.middleName,
    lastName: parsed.lastName,
    suffix: parsed.suffix,
    extractedFrom: "trust_name",
  }];
}

export function extractFromTrustName(raw: string): ParsedOwner[] {
  const trusteeMatch = raw.match(TRUSTEE_SUFFIX_RE);
  if (trusteeMatch) {
    return buildParsedOwner(raw, parsePersonName(trusteeMatch[1]));
  }

  const revocableMatch = raw.match(REVOCABLE_RE);
  if (revocableMatch) {
    return buildParsedOwner(raw, parsePersonName(revocableMatch[1]));
  }

  const familyMatch = raw.match(FAMILY_TRUST_RE);
  if (familyMatch) {
    const lastName = familyMatch[1].trim().toLowerCase();
    return [{
      raw,
      normalized: lastName,
      lastName,
      extractedFrom: "trust_name",
    }];
  }

  return [];
}
