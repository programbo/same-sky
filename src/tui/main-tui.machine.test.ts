import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import type {
  LocationMatch,
  PersistLocationInput,
  PersistedLocation,
  PersistedLocationStoreLike,
  TimeInPlaceService,
} from "../lib/time-in-place";
import { mainTuiMachine } from "./main-tui.machine";
import type { AppFeatureChoice, LocationActionChoice, TuiUi } from "./ui-contract";

class MemoryStore implements PersistedLocationStoreLike {
  private readonly locations: PersistedLocation[] = [];

  async list(): Promise<PersistedLocation[]> {
    return [...this.locations];
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

function createServiceStub(): TimeInPlaceService {
  return {
    async lookupLocations(): Promise<LocationMatch[]> {
      return [];
    },
  } as unknown as TimeInPlaceService;
}

interface MainUiOptions {
  appFeatures?: AppFeatureChoice[];
  locationActions?: LocationActionChoice[];
}

function createMainUi(options: MainUiOptions): { ui: TuiUi; calls: { appFeatureCalls: number } } {
  const appFeatures = [...(options.appFeatures ?? [])];
  const locationActions = [...(options.locationActions ?? [])];

  const calls = { appFeatureCalls: 0 };

  return {
    calls,
    ui: {
      printHeader() {},
      printInfo() {},
      printSuccess() {},
      printWarning() {},
      printError() {},
      async chooseAppFeature(): Promise<AppFeatureChoice> {
        calls.appFeatureCalls += 1;
        return appFeatures.shift() ?? "exit";
      },
      async chooseLocationAction(): Promise<LocationActionChoice> {
        return locationActions.shift() ?? "back";
      },
      async askLookupQuery(): Promise<string> {
        return "";
      },
      async chooseLookupResult(): Promise<number | null> {
        return null;
      },
      async askNickname(): Promise<string | null> {
        return null;
      },
      async chooseRemovalIds(): Promise<string[]> {
        return [];
      },
    },
  };
}

describe("mainTuiMachine", () => {
  test("exits directly when Exit is selected in top-level menu", async () => {
    const store = new MemoryStore();
    const { ui } = createMainUi({ appFeatures: ["exit"] });

    const actor = createActor(mainTuiMachine, {
      input: {
        argv: [],
        ui,
        service: createServiceStub(),
        store,
      },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.matches("done") || snapshot.matches("failed"));

    expect(actor.getSnapshot().matches("done")).toBe(true);

    actor.stop();
  });

  test("shows feature menu by default and runs location feature", async () => {
    const store = new MemoryStore();
    const { ui } = createMainUi({ appFeatures: ["location"], locationActions: ["back"] });

    const actor = createActor(mainTuiMachine, {
      input: {
        argv: [],
        ui,
        service: createServiceStub(),
        store,
      },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.matches("done") || snapshot.matches("failed"));

    expect(actor.getSnapshot().matches("done")).toBe(true);

    actor.stop();
  });

  test("returns to feature menu after Back in location feature", async () => {
    const store = new MemoryStore();
    const { ui, calls } = createMainUi({ appFeatures: ["location", "exit"], locationActions: ["back"] });

    const actor = createActor(mainTuiMachine, {
      input: {
        argv: [],
        ui,
        service: createServiceStub(),
        store,
      },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.matches("done") || snapshot.matches("failed"));

    expect(actor.getSnapshot().matches("done")).toBe(true);
    expect(calls.appFeatureCalls).toBe(2);

    actor.stop();
  });

  test("bypasses app feature menu when first arg is location", async () => {
    const store = new MemoryStore();
    const { ui, calls } = createMainUi({ appFeatures: ["exit"], locationActions: ["back"] });

    const actor = createActor(mainTuiMachine, {
      input: {
        argv: ["location"],
        ui,
        service: createServiceStub(),
        store,
      },
    });

    actor.start();
    await waitFor(actor, snapshot => snapshot.matches("done") || snapshot.matches("failed"));

    expect(actor.getSnapshot().matches("done")).toBe(true);
    expect(calls.appFeatureCalls).toBe(1);

    actor.stop();
  });
});
