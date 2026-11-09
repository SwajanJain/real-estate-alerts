import { parsePersonName } from "@pm/core";

import type { ParsedOwner } from "../core/types";
import { expandAbbreviations } from "../lib/abbreviation-expander";
import { classifyOwnerEntity } from "../lib/owner-entity-classifier";
import { splitMultiOwner } from "../lib/multi-owner-splitter";
import { extractFromTrustName } from "../lib/trust-name-resolver";

function parseLastFirst(raw: string): ParsedOwner[] {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const pieces = cleaned.split(" ").filter(Boolean);
  if (pieces.length < 2) return [];
  const [lastName, firstName, ...rest] = pieces;
  const middleAndSuffix = rest.join(" ");
  const parsed = parsePersonName([firstName, middleAndSuffix, lastName].filter(Boolean).join(" "));
  if (!parsed) return [];
  return [{
    raw,
    normalized: parsed.normalized,
    firstName: parsed.firstName,
    middleName: parsed.middleName,
    lastName: parsed.lastName,
    suffix: parsed.suffix,
    extractedFrom: "direct",
  }];
}

function isLikelyLastFirst(raw: string): boolean {
  const cleaned = raw.trim();
  if (!cleaned || cleaned.includes(",")) return false;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  return cleaned === cleaned.toUpperCase();
}

export function parseOwnerName(raw: string): ParsedOwner[] {
  const initial = raw.trim().replace(/\s+/g, " ");
  if (!initial) return [];

  const withoutCareOf = initial.split(/\s+(?:%|C\/O)\s+/i)[0].trim();
  const { cleaned } = expandAbbreviations(withoutCareOf.toUpperCase());
  const ownerType = classifyOwnerEntity(cleaned);

  if (ownerType === "llc" || ownerType === "corporation") return [];
  if (ownerType === "trust") return extractFromTrustName(cleaned);
  if (ownerType === "estate") {
    const estateName = cleaned.replace(/\bESTATE OF\b/i, "").trim();
    const parsedEstate = parsePersonName(estateName);
    if (!parsedEstate) return [];
    return [{
      raw,
      normalized: parsedEstate.normalized,
      firstName: parsedEstate.firstName,
      middleName: parsedEstate.middleName,
      lastName: parsedEstate.lastName,
      suffix: parsedEstate.suffix,
      extractedFrom: "trustee_field",
    }];
  }

  const split = splitMultiOwner(cleaned, ownerType);
  const parsedOwners: ParsedOwner[] = [];
  for (const entry of split) {
    if (isLikelyLastFirst(entry)) {
      const parsedLastFirst = parseLastFirst(entry);
      if (parsedLastFirst.length > 0) {
        parsedOwners.push(...parsedLastFirst.map((owner) => ({
          ...owner,
          extractedFrom: split.length > 1 ? "co_owner" : owner.extractedFrom,
        })));
        continue;
      }
    }
    const parsedStandard = parsePersonName(entry);
    if (parsedStandard) {
      parsedOwners.push({
        raw: entry,
        normalized: parsedStandard.normalized,
        firstName: parsedStandard.firstName,
        middleName: parsedStandard.middleName,
        lastName: parsedStandard.lastName,
        suffix: parsedStandard.suffix,
        extractedFrom: split.length > 1 ? "co_owner" : "direct",
      });
      continue;
    }
    parsedOwners.push(...parseLastFirst(entry));
  }

  return parsedOwners;
}
