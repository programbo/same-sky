import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import type {
  LocationMatch,
  PersistLocationInput,
  PersistLocationPatch,
  PersistedLocation,
  PersistedLocationStoreLike,
} from "../lib/time-in-place";
import type { TimeInPlaceService } from "../lib/time-in-place";
import { locationManagementMachine } from "./location-management.machine";
import type { AppFeatureChoice, LocationActionChoice, RefinementActionChoice, TuiUi } from "./ui-contract";

function makeMatch(overrides: Partial<LocationMatch> = {}): LocationMatch {
  return {
    id: overrides.id ?? "test:1",
    name: overrides.name ?? "Berlin, Berlin, Germany",
    fullName: overrides.fullName ?? "Berlin, Berlin, Germany",
    coords: overrides.coords ?? { lat: 52.52, long: 13.405 },
    source: overrides.source ?? "test",
    granularity: overrides.granularity ?? "city",
    isLocalityClass: overrides.isLocalityClass ?? true,
    admin: overrides.admin ?? {
      country: "Germany",
      region: "Berlin",
      locality: "Berlin",
    },
    boundingBox: overrides.boundingBox,
    timezonePreview: overrides.timezonePreview ?? "Europe/Berlin",
  };
}

class MemoryStore implements PersistedLocationStoreLike {
  private readonly locations: PersistedLocation[];

  constructor(seed: PersistedLocation[] = []) {
    this.locations = [...seed];
  }

  async list(): Promise<PersistedLocation[]> {
    return [...this.locations].sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  async add(input: PersistLocationInput): Promise<PersistedLocation> {
    const entry: PersistedLocation = {
      id: `id-${this.locations.length + 1}`,
      name: input.name,
      coords: input.coords,
      nickname: input.nickname,
      timezone: input.timezone,
      granularity: input.granularity,
      createdAtMs: 1_700_000_000_000 + this.locations.length,
    };

    this.locations.push(entry);
    return entry;
  }

  async remove(id: string): Promise<PersistedLocation | null> {
    const index = this.locations.findIndex(location => location.id === id);
    if (index < 0) {
      return null;
    }

    const [removed] = this.locations.splice(index, 1);
    return removed ?? null;
  }

  async update(id: string, patch: PersistLocationPatch): Promise<PersistedLocation | null> {
    const index = this.locations.findIndex(location => location.id === id);
    if (index < 0) {
      return null;
    }

    const existing = this.locations[index];
    if (!existing) {
      return null;
    }

    const updated: PersistedLocation = {
      ...existing,
      timezone: patch.timezone ?? existing.timezone,
      granularity: patch.granularity ?? existing.granularity,
    };
    this.locations[index] = updated;
    return updated;
  }
}

interface UiQueues {
  locationActions?: LocationActionChoice[];
  refinementActions?: RefinementActionChoice[];
  lookupQueries?: string[];
  lookupResultIndexes?: Array<number | null>;
  nicknames?: Array<string | null>;
  removalSelections?: string[][];
}

function createStubUi(queues: UiQueues): TuiUi {
  const locationActions = [...(queues.locationActions ?? [])];
  const refinementActions = [...(queues.refinementActions ?? [])];
  const lookupQueries = [...(queues.lookupQueries ?? [])];
  const lookupResultIndexes = [...(queues.lookupResultIndexes ?? [])];
  const nicknames = [...(queues.nicknames ?? [])];
  const removalSelections = [...(queues.removalSelections ?? [])];

  return {
    printHeader() {},
    printInfo() {},
    printSuccess() {},
    printWarning() {},
    printError() {},

    async chooseAppFeature(): Promise<AppFeatureChoice> {
      return "exit";
    },
    async chooseLocationAction(): Promise<LocationActionChoice> {
      return locationActions.shift() ?? "back";
    },
    async chooseRefinementAction(_scopeLabel: string): Promise<RefinementActionChoice> {
      return refinementActions.shift() ?? "restart";
    },
    async askLookupQuery(_message?: string): Promise<string> {
      return lookupQueries.shift() ?? "";
    },
    async chooseLookupResult(_results: LocationMatch[]): Promise<number | null> {
      return lookupResultIndexes.shift() ?? null;
    },
    async askNickname(_defaultNickname: string): Promise<string | null> {
      return nicknames.shift() ?? null;
    },
    async chooseRemovalIds(_locations: PersistedLocation[]): Promise<string[]> {
      return removalSelections.shift() ?? [];
    },
  };
}

describe("locationManagementMachine", () => {
  test("does not force refinement for small country-sized areas", async () => {
    const service: Pick<TimeInPlaceService, "lookupLocations" | "getTimeForLocation"> = {
      async lookupLocations(query) {
        if (query.toLowerCase() === "singapore") {
          return [
            makeMatch({
              id: "sg",
              name: "Singapore",
              fullName: "Singapore",
              granularity: "country",
              isLocalityClass: false,
              admin: {
                country: "Singapore",
                region: "Singapore",
                locality: "Singapore",
              },
              boundingBox: { south: 1.1303611, north: 1.5143183, west: 103.557576, east: 104.5712337 },
              timezonePreview: "Asia/Singapore",
            }),
          ];
        }

        return [];
      },
      async getTimeForLocation(coords) {
        if (coords.long > 104.3) {
          return {
            timestampMs: 1_700_000_000_000,
            timezone: "Asia/Kuala_Lumpur",
            offsetSeconds: 28_800,
          };
        }

        return {
          timestampMs: 1_700_000_000_000,
          timezone: "Asia/Singapore",
          offsetSeconds: 28_800,
        };
      },
    };

    const store = new MemoryStore();
    const ui = createStubUi({
      locationActions: ["lookup", "back"],
      lookupQueries: ["Singapore"],
      nicknames: [""],
    });

    const actor = createActor(locationManagementMachine, {
      input: { service, store, ui },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.status === "done");

    const saved = await store.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("Singapore");
    expect(saved[0]?.nickname).toBe("Singapore");
    expect(saved[0]?.granularity).toBe("country");
    expect(saved[0]?.timezone).toBe("Asia/Singapore");

    actor.stop();
  });

  test("requires narrowing from broad region to locality before persisting", async () => {
    const calls: Array<{ query: string; localityOnly?: boolean }> = [];
    const service: Pick<TimeInPlaceService, "lookupLocations" | "getTimeForLocation"> = {
      async lookupLocations(query, options) {
        calls.push({ query, localityOnly: options?.localityOnly });
        if (query === "Australia") {
          return [
            makeMatch({
              id: "au",
              name: "Australia",
              fullName: "Australia",
              granularity: "country",
              isLocalityClass: false,
              admin: {
                country: "Australia",
              },
              boundingBox: { south: -43.6, north: -9.2, west: 112.9, east: 153.6 },
              timezonePreview: "Australia/Darwin",
            }),
          ];
        }

        return [
          makeMatch({
            id: "wodonga",
            name: "Wodonga, Victoria, Australia",
            fullName: "Wodonga, City of Wodonga, Victoria, Australia",
            coords: { lat: -36.1206, long: 146.8881 },
            granularity: "city",
            isLocalityClass: true,
            admin: {
              country: "Australia",
              region: "Victoria",
              locality: "Wodonga",
            },
            timezonePreview: "Australia/Melbourne",
          }),
        ];
      },
      async getTimeForLocation(coords) {
        if (coords.long >= 145) {
          return {
            timestampMs: 1_700_000_000_000,
            timezone: "Australia/Sydney",
            offsetSeconds: 39_600,
          };
        }

        if (coords.long <= 120) {
          return {
            timestampMs: 1_700_000_000_000,
            timezone: "Australia/Perth",
            offsetSeconds: 28_800,
          };
        }

        return {
          timestampMs: 1_700_000_000_000,
          timezone: "Australia/Darwin",
          offsetSeconds: 34_200,
        };
      },
    };

    const store = new MemoryStore();
    const ui = createStubUi({
      locationActions: ["lookup", "back"],
      refinementActions: ["search"],
      lookupQueries: ["Australia", "Wodonga"],
      lookupResultIndexes: [0],
      nicknames: [""],
    });

    const actor = createActor(locationManagementMachine, {
      input: { service, store, ui },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.status === "done");

    const saved = await store.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("Wodonga, Victoria, Australia");
    expect(saved[0]?.nickname).toBe("Wodonga, Victoria, Australia");
    expect(saved[0]?.granularity).toBe("city");
    expect(saved[0]?.timezone).toBe("Australia/Melbourne");

    expect(calls).toEqual([
      { query: "Australia", localityOnly: false },
      { query: "Wodonga", localityOnly: true },
    ]);

    actor.stop();
  });

  test("removes multiple persisted locations in one pass", async () => {
    const store = new MemoryStore([
      {
        id: "saved-1",
        name: "Tokyo, Tokyo, Japan",
        coords: { lat: 35.6762, long: 139.6503 },
        timezone: "Asia/Tokyo",
        granularity: "city",
        createdAtMs: 1,
      },
      {
        id: "saved-2",
        name: "Paris, Ile-de-France, France",
        coords: { lat: 48.8566, long: 2.3522 },
        timezone: "Europe/Paris",
        granularity: "city",
        createdAtMs: 2,
      },
    ]);

    const service: Pick<TimeInPlaceService, "lookupLocations" | "getTimeForLocation"> = {
      async lookupLocations() {
        return [];
      },
      async getTimeForLocation() {
        return {
          timestampMs: 1_700_000_000_000,
          timezone: "UTC",
          offsetSeconds: 0,
        };
      },
    };

    const ui = createStubUi({
      locationActions: ["remove", "back"],
      removalSelections: [["saved-1", "saved-2"]],
    });

    const actor = createActor(locationManagementMachine, {
      input: { service, store, ui },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.status === "done");

    expect(await store.list()).toHaveLength(0);

    actor.stop();
  });
});
