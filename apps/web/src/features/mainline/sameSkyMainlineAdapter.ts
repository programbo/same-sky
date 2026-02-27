import {
  createMainlineAdapter,
  type MainlineAdapter,
  type MainlineCommand,
  type MainlinePage,
  type MainlineResult,
} from "react-mainline";
import type { PersistedLocationApiResult } from "../../pages/useHomeClockModel";
import type { LocationProfile } from "./useLocationProfiles";

interface LookupResult {
  id: string;
  name: string;
  fullName?: string;
  lat: number;
  long: number;
  granularity?: string;
  timezonePreview?: string;
}

interface PersistedApiResponse {
  result: PersistedLocationApiResult;
}

interface MainlineAdapterDependencies {
  savedLocations: PersistedLocationApiResult[];
  activeProfile: LocationProfile | null;
  profiles: LocationProfile[];
  secondOrderEnabled: boolean;
  setSecondOrderEnabled: (next: boolean) => void;
  setSelectedId: (locationId: string | null) => void;
  reloadSavedLocations: () => Promise<void>;
  setActiveProfile: (profileId: string) => void;
  createProfile: (name: string) => LocationProfile;
  renameProfile: (profileId: string, name: string) => boolean;
  deleteProfile: (profileId: string) => boolean;
  addLocationToActiveProfile: (locationId: string) => void;
  removeLocationEverywhere: (locationId: string) => void;
}

const PAGE_IDS = {
  ROOT: "root",
  LOCATION_ADD_QUERY: "location.add.query",
  LOCATION_ADD_RESULTS: "location.add.results",
  LOCATION_ADD_NICKNAME: "location.add.nickname",
  LOCATION_EDIT_LIST: "location.edit.list",
  LOCATION_EDIT_DETAIL: "location.edit.detail",
  LOCATION_RENAME_INPUT: "location.rename.input",
  COLLECTION_SWITCH_LIST: "collection.switch.list",
  COLLECTION_ADD_INPUT: "collection.add.input",
  COLLECTION_EDIT_LIST: "collection.edit.list",
  COLLECTION_EDIT_DETAIL: "collection.edit.detail",
  COLLECTION_EDIT_RENAME_INPUT: "collection.edit.rename.input",
} as const;

const LOCATION_EDIT_ITEM_PREFIX = `${PAGE_IDS.LOCATION_EDIT_LIST}:item:`;
const LOCATION_DETAIL_RENAME_PREFIX = `${PAGE_IDS.LOCATION_EDIT_DETAIL}:rename:`;
const LOCATION_DETAIL_DELETE_PREFIX = `${PAGE_IDS.LOCATION_EDIT_DETAIL}:delete:`;
const COLLECTION_EDIT_ITEM_PREFIX = `${PAGE_IDS.COLLECTION_EDIT_LIST}:item:`;
const COLLECTION_DETAIL_RENAME_PREFIX = `${PAGE_IDS.COLLECTION_EDIT_DETAIL}:rename:`;
const COLLECTION_DETAIL_DELETE_PREFIX = `${PAGE_IDS.COLLECTION_EDIT_DETAIL}:delete:`;

function locationLabel(location: PersistedLocationApiResult): string {
  return (
    location.nickname?.trim() || location.adminCity?.trim() || location.name
  );
}

function locationSubtitle(location: PersistedLocationApiResult): string {
  const timezone = location.timezone ?? "Timezone unavailable";
  return `${timezone} · ${location.lat.toFixed(4)}, ${location.long.toFixed(4)}`;
}

function parseId(prefixedId: string, prefix: string): string | null {
  if (!prefixedId.startsWith(prefix)) {
    return null;
  }

  return prefixedId.slice(prefix.length);
}

async function readJson<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const payload = (await response.json()) as T & {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? fallbackMessage);
  }

  return payload;
}

function buildRootPage(
  deps: MainlineAdapterDependencies,
  _visibleLocations: PersistedLocationApiResult[],
): MainlinePage {
  const hasLocations = deps.savedLocations.length > 0;

  return {
    id: PAGE_IDS.ROOT,
    title: "react-mainline",
    subtitle: deps.activeProfile
      ? `Profile: ${deps.activeProfile.name}`
      : "No active profile",
    items: [
      {
        id: "root.location.add",
        label: "Add location",
        subtitle: "Search and save a location to the active profile",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_ADD_QUERY,
      },
      {
        id: "root.location.edit",
        label: "Edit locations",
        subtitle: "Open location details to rename or delete",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_EDIT_LIST,
        disabled: !hasLocations,
      },
      {
        id: "root.collection.switch",
        label: "Switch collection",
        subtitle: "Select the active collection profile",
        intent: "page",
        childPageId: PAGE_IDS.COLLECTION_SWITCH_LIST,
        disabled: deps.profiles.length === 0,
      },
      {
        id: "root.collection.add",
        label: "Add collection",
        subtitle: "Create a new collection profile",
        intent: "page",
        childPageId: PAGE_IDS.COLLECTION_ADD_INPUT,
      },
      {
        id: "root.collection.edit",
        label: "Edit collections",
        subtitle: "Open collection details to rename or delete",
        intent: "page",
        childPageId: PAGE_IDS.COLLECTION_EDIT_LIST,
        disabled: deps.profiles.length === 0,
      },
      {
        id: "root.setting.second-order",
        label: deps.secondOrderEnabled
          ? "Disable second-order sky factors"
          : "Enable second-order sky factors",
        subtitle: deps.secondOrderEnabled
          ? "Using enhanced sky model"
          : "Using first-order sky model",
        intent: "action",
      },
    ],
  };
}

export function createSameSkyMainlineAdapter(
  deps: MainlineAdapterDependencies,
): MainlineAdapter {
  const activeLocationIdSet = new Set(deps.activeProfile?.locationIds ?? []);
  const visibleLocations = deps.savedLocations.filter((location) =>
    activeLocationIdSet.has(location.id),
  );

  const makeLocationEditList = (): MainlinePage => {
    const items: MainlineCommand[] = deps.savedLocations.map((location) => ({
      id: `${LOCATION_EDIT_ITEM_PREFIX}${location.id}`,
      label: locationLabel(location),
      subtitle: locationSubtitle(location),
      intent: "page",
      childPageId: PAGE_IDS.LOCATION_EDIT_DETAIL,
      keywords: [
        location.name,
        location.timezone ?? "",
        location.adminCity ?? "",
      ],
      meta: { location },
    }));

    return {
      id: PAGE_IDS.LOCATION_EDIT_LIST,
      title: "Edit locations",
      subtitle: "Press Enter to open location details",
      emptyStateText: "No saved locations available.",
      items,
    };
  };

  const makeLocationDetailPage = (
    location: PersistedLocationApiResult,
  ): MainlinePage => ({
    id: PAGE_IDS.LOCATION_EDIT_DETAIL,
    title: `Edit ${locationLabel(location)}`,
    subtitle: locationSubtitle(location),
    items: [
      {
        id: `${LOCATION_DETAIL_RENAME_PREFIX}${location.id}`,
        label: "Rename location",
        subtitle: "Update the saved location nickname globally",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_RENAME_INPUT,
        meta: { location },
      },
      {
        id: `${LOCATION_DETAIL_DELETE_PREFIX}${location.id}`,
        label: "Delete location",
        subtitle: "Delete from persisted storage and all collections",
        intent: "action",
        meta: { location },
      },
    ],
  });

  const makeCollectionEditList = (): MainlinePage => {
    const items: MainlineCommand[] = deps.profiles.map((profile) => ({
      id: `${COLLECTION_EDIT_ITEM_PREFIX}${profile.id}`,
      label: profile.name,
      subtitle: `${profile.locationIds.length} saved ${profile.locationIds.length === 1 ? "location" : "locations"}`,
      intent: "page",
      childPageId: PAGE_IDS.COLLECTION_EDIT_DETAIL,
      meta: { profile },
    }));

    return {
      id: PAGE_IDS.COLLECTION_EDIT_LIST,
      title: "Edit collections",
      subtitle: "Press Enter to open collection details",
      items,
      emptyStateText: "No collections available.",
    };
  };

  const makeCollectionSwitchList = (): MainlinePage => {
    const items: MainlineCommand[] = deps.profiles.map((profile) => ({
      id: `collection.switch.list:${profile.id}`,
      label: profile.name,
      subtitle:
        profile.id === deps.activeProfile?.id
          ? "Currently active"
          : `${profile.locationIds.length} saved ${profile.locationIds.length === 1 ? "location" : "locations"}`,
      intent: "action",
      meta: { profile },
    }));

    return {
      id: PAGE_IDS.COLLECTION_SWITCH_LIST,
      title: "Switch collection",
      subtitle: "Choose the active collection profile",
      items,
      emptyStateText: "No collections available.",
    };
  };

  const makeCollectionDetailPage = (
    profile: LocationProfile,
  ): MainlinePage => ({
    id: PAGE_IDS.COLLECTION_EDIT_DETAIL,
    title: `Edit ${profile.name}`,
    subtitle: `${profile.locationIds.length} saved ${profile.locationIds.length === 1 ? "location" : "locations"}`,
    items: [
      {
        id: `${COLLECTION_DETAIL_RENAME_PREFIX}${profile.id}`,
        label: "Rename collection",
        subtitle: "Change the collection name",
        intent: "page",
        childPageId: PAGE_IDS.COLLECTION_EDIT_RENAME_INPUT,
        meta: { profile },
      },
      {
        id: `${COLLECTION_DETAIL_DELETE_PREFIX}${profile.id}`,
        label: "Delete collection",
        subtitle: "Remove this collection profile",
        intent: "action",
        disabled: deps.profiles.length <= 1,
        meta: { profile },
      },
    ],
  });

  return createMainlineAdapter({
    async loadRoot() {
      return buildRootPage(deps, visibleLocations);
    },

    async loadChild(pageId, itemId, _query, meta) {
      switch (pageId) {
        case PAGE_IDS.LOCATION_ADD_QUERY:
          return {
            id: PAGE_IDS.LOCATION_ADD_QUERY,
            mode: "input",
            title: "Add location",
            subtitle: "Type a place name and press Enter",
            placeholder: "Search locations",
            submitLabel: "Search",
            items: [],
          };
        case PAGE_IDS.LOCATION_ADD_NICKNAME: {
          const lookup = (meta as { lookup?: LookupResult } | undefined)
            ?.lookup;
          if (!lookup) {
            return {
              kind: "error",
              message: "Location lookup context missing.",
            };
          }

          return {
            id: PAGE_IDS.LOCATION_ADD_NICKNAME,
            mode: "input",
            title: "Choose nickname",
            subtitle: lookup.fullName ?? lookup.name,
            placeholder: "Nickname",
            submitLabel: "Save",
            items: [],
            meta,
          };
        }
        case PAGE_IDS.LOCATION_EDIT_LIST:
          return makeLocationEditList();
        case PAGE_IDS.LOCATION_EDIT_DETAIL: {
          const locationId = parseId(itemId, LOCATION_EDIT_ITEM_PREFIX);
          const location =
            (meta as { location?: PersistedLocationApiResult } | undefined)
              ?.location ??
            deps.savedLocations.find((item) => item.id === locationId);
          if (!location) {
            return { kind: "error", message: "Location context missing." };
          }

          return makeLocationDetailPage(location);
        }
        case PAGE_IDS.LOCATION_RENAME_INPUT: {
          const location = (
            meta as { location?: PersistedLocationApiResult } | undefined
          )?.location;
          if (!location) {
            return {
              kind: "error",
              message: "Location context missing for rename.",
            };
          }

          return {
            id: PAGE_IDS.LOCATION_RENAME_INPUT,
            mode: "input",
            title: `Rename ${locationLabel(location)}`,
            subtitle: "Updates the global nickname for this saved location.",
            placeholder:
              location.nickname ?? location.adminCity ?? location.name,
            submitLabel: "Rename",
            items: [],
            meta,
          };
        }
        case PAGE_IDS.COLLECTION_ADD_INPUT:
          return {
            id: PAGE_IDS.COLLECTION_ADD_INPUT,
            mode: "input",
            title: "Create collection",
            subtitle: "Create a new profile for scoped locations.",
            placeholder: "Collection name",
            submitLabel: "Create",
            items: [],
          };
        case PAGE_IDS.COLLECTION_SWITCH_LIST:
          return makeCollectionSwitchList();
        case PAGE_IDS.COLLECTION_EDIT_LIST:
          return makeCollectionEditList();
        case PAGE_IDS.COLLECTION_EDIT_DETAIL: {
          if (typeof itemId !== "string") {
            return { kind: "error", message: "Collection item is missing." };
          }

          const profileId = parseId(itemId, COLLECTION_EDIT_ITEM_PREFIX);
          const profile =
            (meta as { profile?: LocationProfile } | undefined)?.profile ??
            deps.profiles.find((item) => item.id === profileId);
          if (!profile) {
            return { kind: "error", message: "Collection context missing." };
          }

          return makeCollectionDetailPage(profile);
        }
        case PAGE_IDS.COLLECTION_EDIT_RENAME_INPUT: {
          const profile = (meta as { profile?: LocationProfile } | undefined)
            ?.profile;
          if (!profile) {
            return {
              kind: "error",
              message: "Missing collection context for rename.",
            };
          }

          return {
            id: PAGE_IDS.COLLECTION_EDIT_RENAME_INPUT,
            mode: "input",
            title: `Rename ${profile.name}`,
            subtitle: "Update the collection name.",
            placeholder: profile.name,
            submitLabel: "Rename",
            items: [],
            meta,
          };
        }
        default:
          return {
            kind: "error",
            message: `Unsupported command page: ${pageId}`,
          };
      }
    },

    async execute(itemId, pageId) {
      if (itemId === "root.setting.second-order") {
        deps.setSecondOrderEnabled(!deps.secondOrderEnabled);
        return { kind: "refreshPage" };
      }

      if (
        pageId === PAGE_IDS.LOCATION_EDIT_DETAIL &&
        itemId.startsWith(LOCATION_DETAIL_DELETE_PREFIX)
      ) {
        const locationId = parseId(itemId, LOCATION_DETAIL_DELETE_PREFIX);
        if (!locationId) {
          return {
            kind: "error",
            message: "Invalid location deletion command.",
          };
        }

        const url = new URL(
          `/api/locations/persisted/${locationId}`,
          window.location.origin,
        );
        const response = await fetch(url, { method: "DELETE" });
        await readJson(response, "Unable to delete saved location.");
        deps.removeLocationEverywhere(locationId);
        await deps.reloadSavedLocations();
        return { kind: "close" };
      }

      if (
        pageId === PAGE_IDS.COLLECTION_SWITCH_LIST &&
        itemId.startsWith("collection.switch.list:")
      ) {
        const profileId = parseId(itemId, "collection.switch.list:");
        if (!profileId) {
          return { kind: "error", message: "Invalid collection selection." };
        }

        deps.setActiveProfile(profileId);
        return { kind: "close" };
      }

      if (
        pageId === PAGE_IDS.COLLECTION_EDIT_DETAIL &&
        itemId.startsWith(COLLECTION_DETAIL_DELETE_PREFIX)
      ) {
        const profileId = parseId(itemId, COLLECTION_DETAIL_DELETE_PREFIX);
        if (!profileId) {
          return {
            kind: "error",
            message: "Invalid collection deletion command.",
          };
        }

        const deleted = deps.deleteProfile(profileId);
        if (!deleted) {
          return {
            kind: "error",
            message:
              "Unable to delete collection. At least one profile must remain.",
          };
        }

        return { kind: "close" };
      }

      return { kind: "stay" };
    },

    async submit(pageId, query, meta) {
      const trimmed = query.trim();

      if (pageId === PAGE_IDS.LOCATION_ADD_QUERY) {
        if (!trimmed) {
          return { kind: "error", message: "Location query cannot be empty." };
        }

        const lookupUrl = new URL(
          "/api/locations/lookup",
          window.location.origin,
        );
        lookupUrl.searchParams.set("q", trimmed);
        lookupUrl.searchParams.set("limit", "8");
        const lookupResponse = await fetch(lookupUrl);
        const payload = await readJson<{ results: LookupResult[] }>(
          lookupResponse,
          "Unable to look up locations.",
        );

        if (payload.results.length === 0) {
          return { kind: "error", message: "No matching locations found." };
        }

        const resultsPage: MainlinePage = {
          id: PAGE_IDS.LOCATION_ADD_RESULTS,
          title: "Choose location",
          subtitle: "Select a location result to continue.",
          items: payload.results.map((result) => ({
            id: `${PAGE_IDS.LOCATION_ADD_RESULTS}:${result.id}`,
            label: result.fullName ?? result.name,
            subtitle: `${result.granularity ?? "unknown"} · ${result.lat.toFixed(4)}, ${result.long.toFixed(4)}`,
            intent: "page",
            childPageId: PAGE_IDS.LOCATION_ADD_NICKNAME,
            meta: {
              lookup: result,
              query: trimmed,
            },
          })),
        };

        return { kind: "pushPage", page: resultsPage };
      }

      if (pageId === PAGE_IDS.LOCATION_ADD_NICKNAME) {
        const lookup = (
          meta as { lookup?: LookupResult; query?: string } | undefined
        )?.lookup;
        const lookupQuery =
          (meta as { lookup?: LookupResult; query?: string } | undefined)
            ?.query ?? "";

        if (!lookup) {
          return {
            kind: "error",
            message: "Missing selected location for save.",
          };
        }

        const persistResponse = await fetch(
          new URL("/api/locations/persisted", window.location.origin),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: lookup.fullName ?? lookup.name,
              lat: lookup.lat,
              long: lookup.long,
              nickname: trimmed || lookupQuery || lookup.name,
              timezone: lookup.timezonePreview,
              granularity: lookup.granularity,
            }),
          },
        );

        const saved = await readJson<PersistedApiResponse>(
          persistResponse,
          "Unable to save selected location.",
        );
        await deps.reloadSavedLocations();
        deps.addLocationToActiveProfile(saved.result.id);
        deps.setSelectedId(saved.result.id);
        return { kind: "close" };
      }

      if (pageId === PAGE_IDS.LOCATION_RENAME_INPUT) {
        const location = (
          meta as { location?: PersistedLocationApiResult } | undefined
        )?.location;
        if (!location) {
          return {
            kind: "error",
            message: "Missing location context for rename.",
          };
        }

        if (!trimmed) {
          return { kind: "error", message: "Nickname cannot be empty." };
        }

        const patchResponse = await fetch(
          new URL(
            `/api/locations/persisted/${location.id}`,
            window.location.origin,
          ),
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ nickname: trimmed }),
          },
        );

        await readJson(patchResponse, "Unable to rename location.");
        await deps.reloadSavedLocations();
        return { kind: "close" };
      }

      if (pageId === PAGE_IDS.COLLECTION_ADD_INPUT) {
        if (!trimmed) {
          return { kind: "error", message: "Collection name cannot be empty." };
        }

        deps.createProfile(trimmed);
        return { kind: "close" };
      }

      if (pageId === PAGE_IDS.COLLECTION_EDIT_RENAME_INPUT) {
        const profile = (meta as { profile?: LocationProfile } | undefined)
          ?.profile;
        if (!profile) {
          return {
            kind: "error",
            message: "Missing collection context for rename.",
          };
        }

        const renamed = deps.renameProfile(profile.id, trimmed);
        if (!renamed) {
          return { kind: "error", message: "Collection name cannot be empty." };
        }

        return { kind: "close" };
      }

      return { kind: "stay" };
    },
  });
}

export default createSameSkyMainlineAdapter;
