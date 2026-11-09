import type { OwnerType } from "../core/types";

const TRUST_RE = /\b(TRUST|TRST|REVOCABLE|IRREVOCABLE|FAMILY TRUST|LIVING TRUST)\b/i;
const LLC_RE = /\b(LLC|L\.L\.C\.)\b/i;
const CORP_RE = /\b(INC|CORP|CORPORATION|LP|LTD)\b/i;
const ESTATE_RE = /\b(ESTATE OF|EST OF|DECD)\b/i;
const JOINT_RE = /\b(&|AND|ETUX|ETVIR|JTRS)\b/i;

export function classifyOwnerEntity(raw: string): OwnerType {
  if (!raw.trim()) return "unknown";
  if (TRUST_RE.test(raw)) return "trust";
  if (LLC_RE.test(raw)) return "llc";
  if (CORP_RE.test(raw)) return "corporation";
  if (ESTATE_RE.test(raw)) return "estate";
  if (JOINT_RE.test(raw)) return "joint";
  return "individual";
}
