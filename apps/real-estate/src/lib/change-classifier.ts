import type { ChangeType, PriorStateRecord, PropertyRecord } from "../core/types";

export function buildOwnerFingerprints(property: PropertyRecord): string[] {
  const owners = property.parsedOwners.length > 0
    ? property.parsedOwners.map((owner) => owner.normalized || owner.raw.toLowerCase())
    : [property.ownerRaw.toLowerCase()];
  return owners.filter(Boolean).sort();
}

export function classifyPropertyChange(property: PropertyRecord, prior: PriorStateRecord | null): ChangeType {
  if (!prior) return "new_to_cache";

  const currentOwners = buildOwnerFingerprints(property);
  const ownerChanged = currentOwners.join("|") !== prior.ownerFingerprints.join("|");
  if (ownerChanged) return "owner_change";

  if (property.lastSaleDate !== prior.lastSaleDate || property.lastSalePrice !== prior.lastSalePrice) {
    return "sale_update";
  }

  if (property.mortgageAmount !== prior.mortgageAmount) return "refinance";
  if (property.assessedTotal !== prior.assessedTotal) return "assessment_update";
  return "no_change";
}
