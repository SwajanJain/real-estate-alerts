import type { ProspectRecord, VariantType } from "@pm/core";

import type { AddressMatchResult, ChangeType, MatchFeatures, PropertyRecord } from "../core/types";

export function buildMatchFeatures(args: {
  prospect: ProspectRecord;
  property: PropertyRecord;
  role: "buyer" | "seller";
  variantType: VariantType | "trust_extracted" | "co_owner" | "fuzzy" | "none";
  addressMatch: AddressMatchResult;
  portfolioCorroborationCount: number;
  changeType: ChangeType;
}): MatchFeatures {
  return {
    role: args.role,
    variantType: args.variantType,
    addressStatus: args.addressMatch.status,
    stateMatch: args.prospect.state
      ? (args.prospect.state.toLowerCase() === args.property.ownerMailingState?.toLowerCase()
          || args.prospect.state.toLowerCase() === args.property.situsState?.toLowerCase())
      : true,  // no prospect state = no data to contradict, treat as neutral
    portfolioCorroborationCount: args.portfolioCorroborationCount,
    changeType: args.changeType,
  };
}

export function propertySignalFromChange(changeType: ChangeType, property: PropertyRecord): string {
  switch (changeType) {
    case "sale_update":
      return `Recent sale recorded at ${property.situsAddress}`;
    case "owner_change":
      return `New owner detected at ${property.situsAddress}`;
    case "new_to_cache":
      return `First observed owned property at ${property.situsAddress}`;
    case "refinance":
      return `Mortgage update at ${property.situsAddress}`;
    default:
      return `Property activity at ${property.situsAddress}`;
  }
}
