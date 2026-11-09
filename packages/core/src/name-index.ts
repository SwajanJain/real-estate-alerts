import { ProspectRecord, VariantType } from "./types";
import { NAME_SUFFIXES_RE, parsePersonName } from "./name-parser";

export const NICKNAME_GROUPS = [
  ["william", "bill", "will", "billy", "willy"],
  ["robert", "bob", "rob", "bobby", "robbie"],
  ["elizabeth", "liz", "beth", "lizzy", "betty", "eliza"],
  ["richard", "rick", "rich", "dick"],
  ["james", "jim", "jimmy", "jamie"],
  ["michael", "mike"],
  ["thomas", "tom", "tommy"],
  ["edward", "ed", "eddie", "ted", "teddy"],
  ["joseph", "joe", "joey"],
  ["charles", "charlie", "chuck"],
  ["david", "dave"],
  ["christopher", "chris"],
  ["daniel", "dan", "danny"],
  ["matthew", "matt"],
  ["anthony", "tony"],
  ["catherine", "katherine", "kate", "katie", "kathy", "cathy"],
  ["margaret", "maggie", "meg", "peggy"],
  ["jennifer", "jen", "jenny"],
  ["patricia", "pat", "patty", "trish"],
  ["barbara", "barb"],
  ["benjamin", "ben", "benny"],
  ["jonathan", "jon"],
  ["nicholas", "nick"],
  ["stephen", "steven", "steve"],
  ["timothy", "tim"],
  ["lawrence", "larry"],
  ["raymond", "ray"],
  ["gregory", "greg"],
  ["andrew", "andy", "drew"],
  ["kenneth", "ken", "kenny"],
  ["donald", "don"],
  ["frederick", "fred", "freddy"],
  ["gerald", "jerry"],
  ["jeffrey", "jeff"],
  ["leonard", "leo", "len"],
  ["peter", "pete"],
  ["alexander", "alexandra", "alex"],
  ["douglas", "doug"],
  ["philip", "phil"],
  ["ronald", "ron"],
  ["samuel", "sam"],
  ["theodore", "theo"],
  ["walter", "walt"],
  ["nathaniel", "nathan", "nate"],
  ["rebecca", "becky", "becca"],
  ["victoria", "vicky", "tori"],
  ["deborah", "debra", "deb", "debbie"],
  ["pamela", "pam"],
  ["sandra", "sandy"],
  ["susan", "sue", "susie"],
  ["cynthia", "cindy"],
  ["dorothy", "dot", "dotty"],
  ["christine", "christina", "chris", "tina"],
];

export const NICKNAME_LOOKUP: Record<string, string[]> = {};
for (const group of NICKNAME_GROUPS) {
  for (const name of group) {
    if (!NICKNAME_LOOKUP[name]) NICKNAME_LOOKUP[name] = [];
    for (const variant of group) {
      if (variant !== name && !NICKNAME_LOOKUP[name].includes(variant)) {
        NICKNAME_LOOKUP[name].push(variant);
      }
    }
  }
}

export interface IndexedProspect {
  prospect: ProspectRecord;
  variantType: VariantType;
}

export interface ProspectIndexBuild {
  prospectIndex: Map<string, IndexedProspect[]>;
  prospectById: Map<string, ProspectRecord>;
}

function addVariant(
  index: Map<string, IndexedProspect[]>,
  variant: string,
  prospect: ProspectRecord,
  variantType: VariantType,
): void {
  const normalized = variant.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized || normalized.length < 4) return;
  const existing = index.get(normalized) ?? [];
  if (!existing.some((entry) => entry.prospect.prospectId === prospect.prospectId && entry.variantType === variantType)) {
    existing.push({ prospect, variantType });
    index.set(normalized, existing);
  }
}

export function generateNameVariants(name: string): Array<{ value: string; variantType: VariantType }> {
  const variants = new Map<string, VariantType>();
  let cleaned = name.replace(/,/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!cleaned) return [];
  variants.set(cleaned, "exact");

  const suffixStripped = cleaned.replace(NAME_SUFFIXES_RE, "").replace(/\s+/g, " ").trim();
  if (suffixStripped && suffixStripped !== cleaned && suffixStripped.length >= 4) {
    variants.set(suffixStripped, "suffix_stripped");
  }

  const baseForms = Array.from(new Set([cleaned, suffixStripped].filter(Boolean)));

  for (const base of baseForms) {
    if (base.includes("-")) {
      const dehyphenated = base.replace(/-/g, " ").replace(/\s+/g, " ").trim();
      if (dehyphenated.length >= 4) variants.set(dehyphenated, "dehyphenated");
    }

    const parts = base.split(/\s+/);
    if (parts.length >= 3) {
      const originalLast = cleaned.split(/\s+/).pop() ?? "";
      const lastIsHyphenated = originalLast.includes("-");
      if (!lastIsHyphenated) {
        const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
        if (firstLast.length >= 4) variants.set(firstLast, "middle_dropped");
      }
    }

    const baseParts = base.split(/\s+/);
    if (baseParts.length >= 2) {
      const [firstName, ...rest] = baseParts;
      const nicknames = NICKNAME_LOOKUP[firstName] || [];
      for (const nickname of nicknames) {
        variants.set(`${nickname} ${rest.join(" ")}`.trim(), "nickname");
        if (baseParts.length >= 3) {
          variants.set(`${nickname} ${baseParts[baseParts.length - 1]}`.trim(), "nickname");
        }
      }
    }
  }

  const parsed = parsePersonName(name);
  if (parsed?.firstName && parsed.lastName) {
    variants.set(`${parsed.firstName} ${parsed.lastName}`, "exact");
    if (parsed.middleName) {
      variants.set(`${parsed.firstName} ${parsed.middleInitial} ${parsed.lastName}`, "initial_variant");
    }
  }

  return Array.from(variants.entries()).map(([value, variantType]) => ({ value, variantType }));
}

export function buildProspectIndex(prospects: ProspectRecord[]): ProspectIndexBuild {
  const prospectIndex = new Map<string, IndexedProspect[]>();
  const prospectById = new Map<string, ProspectRecord>();

  for (const prospect of prospects) {
    prospectById.set(prospect.prospectId, prospect);
    const variants = generateNameVariants(prospect.nameRaw);
    for (const variant of variants) {
      addVariant(prospectIndex, variant.value, prospect, variant.variantType);
    }
    if (prospect.nameNormalized) {
      addVariant(prospectIndex, prospect.nameNormalized, prospect, "exact");
    }
    for (const alias of prospect.aliasNames) {
      const aliasVariants = generateNameVariants(alias);
      for (const variant of aliasVariants) {
        addVariant(prospectIndex, variant.value, prospect, variant.variantType);
      }
    }
  }

  return { prospectIndex, prospectById };
}
