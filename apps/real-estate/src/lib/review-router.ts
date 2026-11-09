import type { MatchQuality } from "../core/types";

export function routeMatch(quality: MatchQuality): "client" | "review" {
  return quality === "high" || quality === "medium" ? "client" : "review";
}
