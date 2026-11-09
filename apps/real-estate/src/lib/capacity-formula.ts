import type { CapacityEstimate } from "../core/types";

function multiplier(value: number, additional: boolean): number {
  if (value < 500_000) return additional ? 0.075 : 0.05;
  if (value < 1_000_000) return additional ? 0.10 : 0.075;
  return additional ? 0.15 : 0.10;
}

export function estimateGivingCapacity(
  properties: Array<{ value: number; isOwnerOccupied: boolean; mortgageAmount?: number }>,
): CapacityEstimate {
  const ranked = [...properties].sort((a, b) => b.value - a.value);
  const primaryIndex = ranked.findIndex((property) => property.isOwnerOccupied);
  const primaryResidence = primaryIndex >= 0 ? ranked[primaryIndex] : ranked[0];
  const additional = ranked.filter((property) => property !== primaryResidence);
  const primaryResidenceValue = primaryResidence?.value ?? 0;
  const additionalPropertyValue = additional.reduce((sum, property) => sum + property.value, 0);
  const totalPropertyValue = primaryResidenceValue + additionalPropertyValue;
  const totalMortgage = ranked.reduce((sum, property) => sum + (property.mortgageAmount ?? 0), 0);

  let fiveYearCapacity =
    primaryResidenceValue * multiplier(primaryResidenceValue, false) +
    additional.reduce((sum, property) => sum + property.value * multiplier(property.value, true), 0);

  const mortgageBonus = totalPropertyValue > 0 && totalMortgage <= totalPropertyValue * 0.5;
  if (mortgageBonus) fiveYearCapacity *= 1.05;

  return {
    fiveYearCapacity: Math.round(fiveYearCapacity),
    primaryResidenceValue,
    additionalPropertyValue,
    totalPropertyValue,
    totalMortgage,
    equityRatio: totalPropertyValue > 0 ? (totalPropertyValue - totalMortgage) / totalPropertyValue : 0,
    mortgageBonus,
    propertyCount: ranked.length,
  };
}
