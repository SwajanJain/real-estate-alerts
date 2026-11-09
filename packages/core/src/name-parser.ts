import { PersonNameParts } from "./types";

export const NAME_SUFFIXES_RE = /\b(jr|sr|iii|iv|ii|md|phd|esq)\.?(?=\s|$)/gi;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSegment(value: string): string {
  return collapseWhitespace(
    value
      .toLowerCase()
      .replace(/[.]/g, "")
      .replace(/\s*-\s*/g, "-"),
  );
}

function buildNameParts(raw: string, first: string, middle: string, last: string, suffix: string): PersonNameParts {
  const firstName = normalizeSegment(first);
  const middleName = normalizeSegment(middle);
  const lastName = normalizeSegment(last);
  const cleanSuffix = normalizeSegment(suffix);
  const normalized = collapseWhitespace(`${firstName} ${lastName}`);
  const normalizedFull = collapseWhitespace([firstName, middleName, lastName, cleanSuffix].filter(Boolean).join(" "));

  return {
    raw,
    firstName,
    middleName,
    middleInitial: middleName ? middleName.charAt(0) : "",
    lastName,
    suffix: cleanSuffix,
    normalized,
    normalizedFull,
  };
}

function extractSuffixFromTail(value: string): { value: string; suffix: string } {
  const matches = Array.from(value.matchAll(NAME_SUFFIXES_RE));
  if (matches.length === 0) return { value, suffix: "" };
  const suffix = matches[matches.length - 1][0];
  const stripped = collapseWhitespace(value.replace(NAME_SUFFIXES_RE, ""));
  return { value: stripped, suffix: normalizeSegment(suffix) };
}

export function parseFecName(rawName: string): PersonNameParts | null {
  const raw = collapseWhitespace(rawName || "");
  if (!raw || raw.length < 3 || !raw.includes(",")) return null;

  const [lastPart, remainder] = raw.split(/,(.+)/).filter(Boolean);
  if (!lastPart || !remainder) return null;

  const lastName = normalizeSegment(lastPart);
  const extracted = extractSuffixFromTail(remainder);
  const pieces = collapseWhitespace(extracted.value).split(" ").filter(Boolean);
  if (pieces.length === 0) return null;

  const [firstName, ...middle] = pieces;
  return buildNameParts(raw, firstName, middle.join(" "), lastName, extracted.suffix);
}

export function parsePersonName(rawName: string): PersonNameParts | null {
  const raw = collapseWhitespace(rawName || "");
  if (!raw || raw.length < 3) return null;

  if (raw.includes(",")) {
    return parseFecName(raw);
  }

  const extracted = extractSuffixFromTail(raw);
  const pieces = collapseWhitespace(extracted.value).split(" ").filter(Boolean);
  if (pieces.length < 2) return null;

  const firstName = pieces[0];
  const lastName = pieces[pieces.length - 1];
  const middleName = pieces.slice(1, -1).join(" ");
  return buildNameParts(raw, firstName, middleName, lastName, extracted.suffix);
}
