import { normalizeCacheToken } from "../lib/time-in-place/cache";
import type { LocationMatch } from "../lib/time-in-place/types";

const ENGLISH_REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function namesEquivalent(left: string, right: string): boolean {
  return normalizeCacheToken(left) === normalizeCacheToken(right);
}

function resolveEnglishCountryName(countryCode: string | undefined): string | undefined {
  if (!countryCode) {
    return undefined;
  }

  const normalizedCode = countryCode.trim().toUpperCase();
  if (normalizedCode.length !== 2) {
    return undefined;
  }

  const englishRegion = ENGLISH_REGION_NAMES.of(normalizedCode);
  return englishRegion?.trim() || undefined;
}

function resolveEnglishContext(match: Pick<LocationMatch, "englishName" | "admin">): string | undefined {
  const providerEnglish = match.englishName?.trim();
  if (providerEnglish) {
    return providerEnglish;
  }

  const englishCountry = resolveEnglishCountryName(match.admin.countryCode);
  if (!englishCountry) {
    return undefined;
  }

  if (match.admin.country && namesEquivalent(match.admin.country, englishCountry)) {
    return undefined;
  }

  return englishCountry;
}

export function formatLocationLabel(match: Pick<LocationMatch, "name" | "englishName" | "admin">): string {
  const context = resolveEnglishContext(match);
  if (!context || namesEquivalent(match.name, context)) {
    return match.name;
  }

  return `${match.name} (${context})`;
}
