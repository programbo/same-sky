import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createSameSkyMainlineAdapter } from "./sameSkyMainlineAdapter";
import type { PersistedLocationApiResult } from "../../pages/useHomeClockModel";
import type { LocationProfile } from "./useLocationProfiles";

function makeLocation(
  overrides: Partial<PersistedLocationApiResult> = {},
): PersistedLocationApiResult {
  return {
    id: "loc-1",
    name: "Paris, Ile-de-France, France",
    lat: 48.8566,
    long: 2.3522,
    timezone: "Europe/Paris",
    createdAtMs: 1_735_689_600_000,
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<LocationProfile> = {},
): LocationProfile {
  return {
    id: "profile-1",
    name: "Saved locations",
    locationIds: ["loc-1"],
    createdAtMs: 1_735_689_600_000,
    updatedAtMs: 1_735_689_600_000,
    ...overrides,
  };
}

describe("createSameSkyMainlineAdapter", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "http://127.0.0.1:3000",
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  test("root action toggles second-order sky factors", async () => {
    const setSecondOrderEnabled = mock(() => {});
    const adapter = createSameSkyMainlineAdapter({
      savedLocations: [makeLocation()],
      activeProfile: makeProfile(),
      profiles: [makeProfile()],
      secondOrderEnabled: false,
      setSecondOrderEnabled,
      setSelectedId: mock(() => {}),
      reloadSavedLocations: mock(async () => {}),
      setActiveProfile: mock(() => {}),
      createProfile: mock((name: string) => makeProfile({ id: name, name })),
      renameProfile: mock(() => true),
      deleteProfile: mock(() => true),
      addLocationToActiveProfile: mock(() => {}),
      removeLocationEverywhere: mock(() => {}),
    });

    const result = await adapter.execute("root.setting.second-order", "root");

    expect(result).toEqual({ kind: "refreshPage" });
    expect(setSecondOrderEnabled).toHaveBeenCalledWith(true);
  });

  test("delete location executes API delete and profile cleanup", async () => {
    const removeLocationEverywhere = mock(() => {});
    const reloadSavedLocations = mock(async () => {});

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ result: { id: "loc-1" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const adapter = createSameSkyMainlineAdapter({
      savedLocations: [makeLocation()],
      activeProfile: makeProfile(),
      profiles: [makeProfile()],
      secondOrderEnabled: false,
      setSecondOrderEnabled: mock(() => {}),
      setSelectedId: mock(() => {}),
      reloadSavedLocations,
      setActiveProfile: mock(() => {}),
      createProfile: mock((name: string) => makeProfile({ id: name, name })),
      renameProfile: mock(() => true),
      deleteProfile: mock(() => true),
      addLocationToActiveProfile: mock(() => {}),
      removeLocationEverywhere,
    });

    const result = await adapter.execute(
      "location.edit.detail:delete:loc-1",
      "location.edit.detail",
    );

    expect(result).toEqual({ kind: "close" });
    expect(removeLocationEverywhere).toHaveBeenCalledWith("loc-1");
    expect(reloadSavedLocations).toHaveBeenCalled();
  });

  test("add location flow resolves lookup then persists selected result", async () => {
    const addLocationToActiveProfile = mock(() => {});
    const setSelectedId = mock(() => {});
    const reloadSavedLocations = mock(async () => {});

    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/locations/lookup")) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  id: "lookup-paris",
                  name: "Paris",
                  fullName: "Paris, Ile-de-France, France",
                  lat: 48.8566,
                  long: 2.3522,
                  granularity: "city",
                  timezonePreview: "Europe/Paris",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (
          url.includes("/api/locations/persisted") &&
          init?.method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              result: makeLocation({ id: "saved-paris", nickname: "Paris" }),
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({ error: { message: "unexpected request" } }),
          { status: 500 },
        );
      },
    ) as typeof fetch;

    globalThis.fetch = fetchMock;

    const adapter = createSameSkyMainlineAdapter({
      savedLocations: [makeLocation()],
      activeProfile: makeProfile(),
      profiles: [makeProfile()],
      secondOrderEnabled: false,
      setSecondOrderEnabled: mock(() => {}),
      setSelectedId,
      reloadSavedLocations,
      setActiveProfile: mock(() => {}),
      createProfile: mock((name: string) => makeProfile({ id: name, name })),
      renameProfile: mock(() => true),
      deleteProfile: mock(() => true),
      addLocationToActiveProfile,
      removeLocationEverywhere: mock(() => {}),
    });

    const lookupResult = await adapter.submit("location.add.query", "Paris");
    expect(lookupResult.kind).toBe("pushPage");

    if (lookupResult.kind !== "pushPage") {
      throw new Error("Expected pushPage result");
    }

    const selectedMeta = lookupResult.page.items[0]?.meta;
    const persistResult = await adapter.submit(
      "location.add.nickname",
      "Paris",
      selectedMeta,
    );
    expect(persistResult).toEqual({ kind: "close" });

    expect(addLocationToActiveProfile).toHaveBeenCalledWith("saved-paris");
    expect(setSelectedId).toHaveBeenCalledWith("saved-paris");
    expect(reloadSavedLocations).toHaveBeenCalled();
  });

  test("root menu and edit-detail flows expose add/edit actions for locations and collections", async () => {
    const deleteProfile = mock(() => true);
    const setActiveProfile = mock(() => {});
    const profileOne = makeProfile({ id: "profile-1", name: "Alpha" });
    const profileTwo = makeProfile({
      id: "profile-2",
      name: "Beta",
      locationIds: [],
    });

    const adapter = createSameSkyMainlineAdapter({
      savedLocations: [makeLocation()],
      activeProfile: profileOne,
      profiles: [profileOne, profileTwo],
      secondOrderEnabled: false,
      setSecondOrderEnabled: mock(() => {}),
      setSelectedId: mock(() => {}),
      reloadSavedLocations: mock(async () => {}),
      setActiveProfile,
      createProfile: mock((name: string) => makeProfile({ id: name, name })),
      renameProfile: mock(() => true),
      deleteProfile,
      addLocationToActiveProfile: mock(() => {}),
      removeLocationEverywhere: mock(() => {}),
    });

    const root = await adapter.loadRoot();
    expect(root.items.map((item) => item.label)).toEqual([
      "Add location",
      "Edit locations",
      "Switch collection",
      "Add collection",
      "Edit collections",
      "Enable second-order sky factors",
    ]);

    const locationList = await adapter.loadChild(
      "location.edit.list",
      "root.location.edit",
    );
    if ("kind" in locationList) {
      throw new Error("Expected location edit list page");
    }

    const locationItem = locationList.items[0];
    expect(locationItem?.label).toBe("Paris, Ile-de-France, France");
    expect(locationItem?.childPageId).toBe("location.edit.detail");

    const locationDetail = await adapter.loadChild(
      "location.edit.detail",
      locationItem?.id ?? "",
      undefined,
      locationItem?.meta,
    );
    if ("kind" in locationDetail) {
      throw new Error("Expected location detail page");
    }

    expect(locationDetail.items.map((item) => item.label)).toEqual([
      "Rename location",
      "Delete location",
    ]);

    const page = await adapter.loadChild(
      "collection.edit.list",
      "root.collection.edit",
    );
    if ("kind" in page) {
      throw new Error("Expected collection edit list page");
    }

    const betaItem = page.items.find(
      (item) => item.id === "collection.edit.list:item:profile-2",
    );
    expect(betaItem?.label).toBe("Beta");

    const detail = await adapter.loadChild(
      "collection.edit.detail",
      betaItem?.id ?? "",
      undefined,
      betaItem?.meta,
    );
    if ("kind" in detail) {
      throw new Error("Expected collection detail page");
    }

    expect(detail.items.map((item) => item.label)).toEqual([
      "Rename collection",
      "Delete collection",
    ]);

    const result = await adapter.execute(
      "collection.edit.detail:delete:profile-2",
      "collection.edit.detail",
    );
    expect(result).toEqual({ kind: "close" });
    expect(deleteProfile).toHaveBeenCalledWith("profile-2");

    const switchResult = await adapter.execute(
      "collection.switch.list:profile-2",
      "collection.switch.list",
    );
    expect(switchResult).toEqual({ kind: "close" });
    expect(setActiveProfile).toHaveBeenCalledWith("profile-2");
  });
});
