export interface LocationMatchResult {
  status: "zip_match" | "city_state_match" | "city_match" | "state_match" | "state_mismatch" | "no_data";
  detail: string;
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  "puerto rico": "PR", "virgin islands": "VI", guam: "GU",
  "american samoa": "AS", "northern mariana islands": "MP",
};

const VALID_ABBREVIATIONS = new Set(Object.values(STATE_ABBREVIATIONS));

export function normalizeState(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (VALID_ABBREVIATIONS.has(upper)) return upper;
  return STATE_ABBREVIATIONS[trimmed.toLowerCase()] || upper;
}

export function normalizeCity(value: string): string {
  return (value || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeZip5(value: string): string {
  const digits = (value || "").replace(/\D/g, "");
  if (digits.length < 5) return "";
  return digits.slice(0, 5);
}

export function matchLocation(
  prospectCity: string,
  prospectState: string,
  prospectZip: string,
  donorCity: string,
  donorState: string,
  donorZip: string,
): LocationMatchResult {
  const pState = normalizeState(prospectState);
  const dState = normalizeState(donorState);
  const pCity = normalizeCity(prospectCity);
  const dCity = normalizeCity(donorCity);
  const pZip = normalizeZip5(prospectZip);
  const dZip = normalizeZip5(donorZip);

  if (pZip && dZip && pZip === dZip) {
    return { status: "zip_match", detail: `Zip match: ${pZip}` };
  }

  if (pCity && dCity && pState && dState && pCity === dCity && pState === dState) {
    return { status: "city_state_match", detail: `City/state match: ${dCity}, ${dState}` };
  }

  if (pCity && dCity && pCity === dCity && (!pState || !dState)) {
    return { status: "city_match", detail: `City match: ${dCity}` };
  }

  if (pState && dState) {
    if (pState === dState) {
      return { status: "state_match", detail: `State match: ${dState}` };
    }
    return { status: "state_mismatch", detail: `State mismatch: prospect ${pState} vs donor ${dState}` };
  }

  return { status: "no_data", detail: "Insufficient location data" };
}
