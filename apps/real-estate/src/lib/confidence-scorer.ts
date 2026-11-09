import type { MatchFeatures, MatchScoreResult } from "../core/types";

export function variantWeight(value: MatchFeatures["variantType"]): number {
  switch (value) {
    case "exact": return 50;
    case "nickname": return 40;
    case "suffix_stripped": return 45;
    case "middle_dropped": return 42;
    case "initial_variant": return 43;
    case "trust_extracted": return 35;
    case "co_owner": return 30;
    case "fuzzy": return 20;
    default: return 0;
  }
}

// Label shown in match reasons — "exact" is first+last match (middle ignored), make that explicit
function nameLabel(variantType: MatchFeatures["variantType"]): string {
  if (variantType === "exact") return "first_last";
  return variantType;
}

function addressWeight(status: MatchFeatures["addressStatus"]): number {
  // For sellers the only address we have is the sold property's situs, and
  // it functions as the seller's prior residence (their "mailing" address
  // before the sale). So situs tiers are now weighted at parity with mailing.
  // Buyer-side mailing weights are untouched.
  switch (status) {
    case "mailing_exact":      return 45; // street address matches owner's home → strongest
    case "mailing_zip":        return 38; // ZIP matches owner's home → strong
    case "mailing_city_state": return 22; // city + state matches owner's home → moderate
    case "situs_exact":        return 45; // seller: prospect's address == sold property → prior residence
    case "situs_zip":          return 38; // seller: CRM ZIP matches sold property ZIP → strong
    case "situs_city_state":   return 22; // seller: same city/state as sold property
    case "mailing_state":      return 5;  // state only on owner's home → very weak
    case "situs_state":        return 3;  // property state only → weak corroboration
    default: return 0;
  }
}

export function scoreMatch(features: MatchFeatures): MatchScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // Name
  score += variantWeight(features.variantType);
  if (features.variantType !== "none") reasons.push(`name:${nameLabel(features.variantType)}`);

  // Address — mailing address weighted higher than situs
  const address = addressWeight(features.addressStatus);
  score += address;
  if (address > 0) reasons.push(`address:${features.addressStatus}`);

  // Penalties
  if (!features.stateMatch) {
    score -= 20;
    reasons.push("penalty:state_mismatch");
  }


  // Portfolio — noted for capacity context, does NOT inflate match confidence
  if (features.portfolioCorroborationCount > 1) {
    reasons.push(`portfolio:${features.portfolioCorroborationCount}_properties`);
  }

  let quality: MatchScoreResult["quality"] =
    score >= 85 ? "high" :
    score >= 65 ? "medium" :
    score >= 40 ? "low" :
    "review";

  if (features.addressStatus === "mismatch") {
    quality = "review";
  }

  return { combinedScore: score, quality, reasons };
}
