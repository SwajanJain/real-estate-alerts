import type { AddressMatchResult } from "../core/types";
import { normalizeAddress } from "../parsers/address-normalizer";
import type { NormalizedAddress } from "../parsers/address-normalizer";

// Exact-street match: same street line, confirmed to be the same locality via
// EITHER matching ZIP or matching city+state. We compare components directly
// rather than the full normalizedKey, because the key bakes in the ZIP — so a
// prospect with a street but no ZIP on file would never match a property's key
// even when street + city + state are identical. (Street numbers repeat across
// towns, so the locality confirmation is required.)
function streetMatches(prospect: NormalizedAddress, other: NormalizedAddress): boolean {
  if (!prospect.line1 || prospect.line1 === "UNKNOWN") return false;
  if (!other.line1 || other.line1 === "UNKNOWN") return false;
  if (prospect.line1 !== other.line1) return false;
  if (prospect.zip && other.zip && prospect.zip === other.zip) return true;
  if (prospect.city && prospect.state && prospect.city === other.city && prospect.state === other.state) return true;
  return false;
}

export function compareAddresses(
  prospectAddress: string | undefined,
  propertyAddresses: { situs?: string; mailing?: string },
): AddressMatchResult {
  const prospect = normalizeAddress(prospectAddress);
  if (!prospect) return { status: "mismatch", confidence: 0, matchedAgainst: "none" };

  const mailing = normalizeAddress(propertyAddresses.mailing);
  const situs = normalizeAddress(propertyAddresses.situs);

  // Evaluate BOTH mailing and situs to their best tier, then return whichever is
  // strongest. (Earlier this short-circuited on the first mailing tier — so a weak
  // mailing_state match would mask a strong situs_zip match and silently downgrade.)
  const candidates: AddressMatchResult[] = [];

  // Mailing address = where the owner lives → strongest identity corroboration.
  if (mailing) {
    if (streetMatches(prospect, mailing)) {
      candidates.push({ status: "mailing_exact", confidence: 100, matchedAgainst: "mailing" });
    } else if (prospect.zip && prospect.zip === mailing.zip) {
      candidates.push({ status: "mailing_zip", confidence: 80, matchedAgainst: "mailing" });
    } else if (prospect.city && prospect.state && prospect.city === mailing.city && prospect.state === mailing.state) {
      candidates.push({ status: "mailing_city_state", confidence: 55, matchedAgainst: "mailing" });
    } else if (prospect.state && prospect.state === mailing.state) {
      candidates.push({ status: "mailing_state", confidence: 15, matchedAgainst: "mailing" });
    }
  }

  // Situs address — for sellers this is their prior residence, so tiers mirror
  // the mailing tiers above (street → ZIP → city+state → state).
  if (situs) {
    if (streetMatches(prospect, situs)) {
      candidates.push({ status: "situs_exact", confidence: 70, matchedAgainst: "situs" });
    } else if (prospect.zip && prospect.zip === situs.zip) {
      candidates.push({ status: "situs_zip", confidence: 60, matchedAgainst: "situs" });
    } else if (prospect.city && prospect.state && prospect.city === situs.city && prospect.state === situs.state) {
      candidates.push({ status: "situs_city_state", confidence: 30, matchedAgainst: "situs" });
    } else if (prospect.state && prospect.state === situs.state) {
      candidates.push({ status: "situs_state", confidence: 5, matchedAgainst: "situs" });
    }
  }

  if (candidates.length === 0) return { status: "mismatch", confidence: 0, matchedAgainst: "none" };
  return candidates.reduce((best, c) => (c.confidence > best.confidence ? c : best));
}
