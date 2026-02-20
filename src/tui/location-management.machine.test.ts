import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import type { LocationMatch, PersistLocationInput, PersistedLocation, PersistedLocationStoreLike } from "../lib/time-in-place";
import type { TimeInPlaceService } from "../lib/time-in-place";
import { locationManagementMachine } from "./location-management.machine";
import type { AppFeatureChoice, LocationActionChoice, TuiUi } from "./ui-contract";

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
}

interface UiQueues {
  locationActions?: LocationActionChoice[];
  lookupQueries?: string[];
  lookupResultIndexes?: Array<number | null>;
  nicknames?: Array<string | null>;
  removalSelections?: string[][];
}

function createStubUi(queues: UiQueues): TuiUi {
  const locationActions = [...(queues.locationActions ?? [])];
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
    async askLookupQuery(): Promise<string> {
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
  test("persists lookup result and defaults nickname to query when input is blank", async () => {
    const service: Pick<TimeInPlaceService, "lookupLocations"> = {
      async lookupLocations() {
        return [
          {
            name: "Berlin, Berlin, Germany",
            coords: { lat: 52.52, long: 13.405 },
            source: "test",
          },
        ];
      },
    };

    const store = new MemoryStore();
    const ui = createStubUi({
      locationActions: ["lookup", "back"],
      lookupQueries: ["Berlin"],
      nicknames: [""],
    });

    const actor = createActor(locationManagementMachine, {
      input: { service, store, ui },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.status === "done");

    const saved = await store.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("Berlin, Berlin, Germany");
    expect(saved[0]?.nickname).toBe("Berlin");

    actor.stop();
  });

  test("removes multiple persisted locations in one pass", async () => {
    const store = new MemoryStore([
      {
        id: "saved-1",
        name: "Tokyo, Tokyo, Japan",
        coords: { lat: 35.6762, long: 139.6503 },
        createdAtMs: 1,
      },
      {
        id: "saved-2",
        name: "Paris, Ile-de-France, France",
        coords: { lat: 48.8566, long: 2.3522 },
        createdAtMs: 2,
      },
    ]);

    const service: Pick<TimeInPlaceService, "lookupLocations"> = {
      async lookupLocations() {
        return [];
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
