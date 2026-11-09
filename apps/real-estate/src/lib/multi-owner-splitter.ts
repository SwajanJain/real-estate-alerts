import type { OwnerType } from "../core/types";

function extractLeadingSurname(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  return parts[0] ?? "";
}

export function splitMultiOwner(raw: string, ownerType: OwnerType): string[] {
  if (ownerType === "llc" || ownerType === "corporation") return [raw.trim()];
  if (!/\s(&|AND)\s/i.test(raw)) return [raw.trim()];

  const parts = raw.split(/\s+(?:&|AND)\s+/i).map((value) => value.trim()).filter(Boolean);
  if (parts.length < 2) return [raw.trim()];

  const surname = extractLeadingSurname(parts[0]);
  return parts.map((value, index) => {
    if (index === 0 || !surname) return value;
    const tokens = value.split(/\s+/);
    if (tokens.length <= 2 && !tokens[0].includes(",")) {
      return `${surname} ${value}`.replace(/\s+/g, " ").trim();
    }
    return value;
  });
}
