const ABBREVIATIONS: Record<string, string> = {
  TTEE: "TRUSTEE",
  TR: "TRUSTEE",
  TRS: "TRUSTEES",
  TRST: "TRUST",
  JTRS: "JOINT_TENANTS_ROS",
  ETUX: "AND_WIFE",
  ETVIR: "AND_HUSBAND",
  ETAL: "AND_OTHERS",
  DECD: "DECEASED",
  EST: "ESTATE",
  FBO: "FOR_BENEFIT_OF",
  AKA: "ALSO_KNOWN_AS",
  DBA: "DOING_BUSINESS_AS",
};

export { ABBREVIATIONS };

export function expandAbbreviations(raw: string): { cleaned: string; found: string[] } {
  const found: string[] = [];
  let cleaned = raw;

  for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
    const pattern = new RegExp(`\\b${abbr}\\b`, "g");
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, expansion);
      found.push(abbr);
    }
  }

  return {
    cleaned: cleaned.replace(/\s+/g, " ").trim(),
    found,
  };
}
