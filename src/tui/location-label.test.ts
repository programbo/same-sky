import { describe, expect, test } from "bun:test";
import type { LocationMatch } from "../lib/time-in-place/types";
import { formatLocationLabel } from "./location-label";

function makeMatch(overrides: Partial<LocationMatch> = {}): LocationMatch {
  return {
    id: overrides.id ?? "test:1",
    name: overrides.name ?? "Kalaallit Nunaat",
    englishName: overrides.englishName,
    fullName: overrides.fullName ?? "Kalaallit Nunaat",
    coords: overrides.coords ?? { lat: 64.0, long: -42.0 },
    source: overrides.source ?? "test",
    granularity: overrides.granularity ?? "country",
    isLocalityClass: overrides.isLocalityClass ?? false,
    admin: overrides.admin ?? {
      country: "Kalaallit Nunaat",
      countryCode: "GL",
    },
    boundingBox: overrides.boundingBox,
    timezonePreview: overrides.timezonePreview,
  };
}

describe("formatLocationLabel", () => {
  test("shows provider-supplied English context in parentheses", () => {
    const label = formatLocationLabel(
      makeMatch({
        name: "Kalaallit Nunaat",
        englishName: "Greenland",
      }),
    );

    expect(label).toBe("Kalaallit Nunaat (Greenland)");
  });

  test("falls back to country code English name when provider context is absent", () => {
    const label = formatLocationLabel(
      makeMatch({
        name: "Kalaallit Nunaat",
        englishName: undefined,
      }),
    );

    expect(label).toBe("Kalaallit Nunaat (Greenland)");
  });

  test("does not duplicate when name is already English", () => {
    const label = formatLocationLabel(
      makeMatch({
        name: "Greenland",
        englishName: "Greenland",
        admin: {
          country: "Greenland",
          countryCode: "GL",
        },
      }),
    );

    expect(label).toBe("Greenland");
  });
});
