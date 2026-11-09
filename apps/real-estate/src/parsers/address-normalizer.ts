export interface NormalizedAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
  normalizedKey: string;
}

function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

// USPS-style street-type and directional abbreviations, canonicalized to the
// short form. CRMs spell streets out ("Avenue", "Road") while vendor data
// abbreviates ("Ave", "Rd"); without this, an exact-street match silently fails
// on the most common formatting difference. Maps both forms to one canonical.
const STREET_ABBREV: Record<string, string> = {
  STREET: "ST", ST: "ST",
  AVENUE: "AVE", AVE: "AVE", AV: "AVE",
  ROAD: "RD", RD: "RD",
  DRIVE: "DR", DR: "DR",
  LANE: "LN", LN: "LN",
  BOULEVARD: "BLVD", BLVD: "BLVD",
  COURT: "CT", CT: "CT",
  PLACE: "PL", PL: "PL",
  CIRCLE: "CIR", CIR: "CIR",
  TERRACE: "TER", TER: "TER", TERR: "TER",
  PARKWAY: "PKWY", PKWY: "PKWY",
  HIGHWAY: "HWY", HWY: "HWY",
  SQUARE: "SQ", SQ: "SQ",
  TRAIL: "TRL", TRL: "TRL",
  POINT: "PT", PT: "PT",
  COVE: "CV", CV: "CV",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  APARTMENT: "APT", APT: "APT", SUITE: "STE", STE: "STE", FLOOR: "FL",
};

function normalizeStreetLine(line: string): string {
  return line
    .split(" ")
    .map((tok) => STREET_ABBREV[tok] ?? tok)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAddress(raw: string | undefined): NormalizedAddress | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const segments = cleaned.split(",").map((value) => value.trim()).filter(Boolean);
  if (segments.length >= 3) {
    const line1 = normalizeStreetLine(normalizeToken(segments[0]));
    const city = normalizeToken(segments[1]);
    const stateZip = segments[2].trim().split(/\s+/);
    const state = normalizeToken(stateZip[0] ?? "");
    // Normalize ZIP+4 ("15108-9794") down to the 5-digit ZIP ("15108") so that
    // CRM ZIP+4 entries compare cleanly against BatchData's 5-digit mailing ZIPs.
    const zip = (stateZip[1] ?? "").trim().split("-")[0];
    return {
      line1,
      city,
      state,
      zip,
      normalizedKey: [line1, city, state, zip].filter(Boolean).join("|"),
    };
  }

  const fallback = normalizeStreetLine(normalizeToken(cleaned));
  return {
    line1: fallback,
    city: "",
    state: "",
    zip: "",
    normalizedKey: fallback,
  };
}
