import { createMainlineAdapter, type MainlineAdapter, type MainlineCommand, type MainlinePage, type MainlineResult } from "react-mainline"
import type { PersistedLocationApiResult } from "../../pages/useHomeClockModel"
import type { LocationProfile } from "./useLocationProfiles"

interface LookupResult {
  id: string
  name: string
  fullName?: string
  lat: number
  long: number
  granularity?: string
  timezonePreview?: string
}

interface PersistedApiResponse {
  result: PersistedLocationApiResult
}

interface MainlineAdapterDependencies {
  savedLocations: PersistedLocationApiResult[]
  activeProfile: LocationProfile | null
  profiles: LocationProfile[]
  secondOrderEnabled: boolean
  setSecondOrderEnabled: (next: boolean) => void
  setSelectedId: (locationId: string | null) => void
  reloadSavedLocations: () => Promise<void>
  setActiveProfile: (profileId: string) => void
  createProfile: (name: string) => LocationProfile
  renameProfile: (profileId: string, name: string) => boolean
  deleteProfile: (profileId: string) => boolean
  addLocationToActiveProfile: (locationId: string) => void
  removeLocationEverywhere: (locationId: string) => void
}

const PAGE_IDS = {
  ROOT: "root",
  LOCATION_SWITCH: "location.switch",
  LOCATION_ADD_QUERY: "location.add.query",
  LOCATION_ADD_RESULTS: "location.add.results",
  LOCATION_ADD_NICKNAME: "location.add.nickname",
  LOCATION_RENAME_PICK: "location.rename.pick",
  LOCATION_RENAME_INPUT: "location.rename.input",
  LOCATION_DELETE_PICK: "location.delete.pick",
  DATASET_SWITCH: "dataset.switch",
  DATASET_CREATE_INPUT: "dataset.create.input",
  DATASET_RENAME_PICK: "dataset.rename.pick",
  DATASET_RENAME_INPUT: "dataset.rename.input",
  DATASET_DELETE_PICK: "dataset.delete.pick",
} as const

function locationLabel(location: PersistedLocationApiResult): string {
  return location.nickname?.trim() || location.adminCity?.trim() || location.name
}

function locationSubtitle(location: PersistedLocationApiResult): string {
  const timezone = location.timezone ?? "Timezone unavailable"
  return `${timezone} · ${location.lat.toFixed(4)}, ${location.long.toFixed(4)}`
}

function parseId(prefixedId: string, prefix: string): string | null {
  if (!prefixedId.startsWith(prefix)) {
    return null
  }

  return prefixedId.slice(prefix.length)
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = (await response.json()) as T & {
    error?: {
      message?: string
    }
  }

  if (!response.ok) {
    throw new Error(payload.error?.message ?? fallbackMessage)
  }

  return payload
}

function buildRootPage(deps: MainlineAdapterDependencies, visibleLocations: PersistedLocationApiResult[]): MainlinePage {
  const hasLocations = visibleLocations.length > 0
  const canDeleteProfiles = deps.profiles.length > 1

  return {
    id: PAGE_IDS.ROOT,
    title: "react-mainline",
    subtitle: deps.activeProfile ? `Profile: ${deps.activeProfile.name}` : "No active profile",
    items: [
      {
        id: "root.location.switch",
        label: "Switch location",
        subtitle: "Jump to a saved location in this profile",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_SWITCH,
        disabled: !hasLocations,
      },
      {
        id: "root.location.add",
        label: "Add location",
        subtitle: "Search and save a location to the active profile",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_ADD_QUERY,
      },
      {
        id: "root.location.rename",
        label: "Rename location",
        subtitle: "Update a saved location nickname globally",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_RENAME_PICK,
        disabled: !hasLocations,
      },
      {
        id: "root.location.delete",
        label: "Delete location",
        subtitle: "Delete from persisted storage and all profiles",
        intent: "page",
        childPageId: PAGE_IDS.LOCATION_DELETE_PICK,
        disabled: !hasLocations,
      },
      {
        id: "root.location.refresh",
        label: "Refresh locations",
        subtitle: "Reload saved location data",
        intent: "action",
      },
      {
        id: "root.dataset.switch",
        label: "Switch dataset",
        subtitle: "Change active profile for location scope",
        intent: "page",
        childPageId: PAGE_IDS.DATASET_SWITCH,
      },
      {
        id: "root.dataset.create",
        label: "Create dataset",
        subtitle: "Create a new location profile",
        intent: "page",
        childPageId: PAGE_IDS.DATASET_CREATE_INPUT,
      },
      {
        id: "root.dataset.rename",
        label: "Rename dataset",
        subtitle: "Rename an existing profile",
        intent: "page",
        childPageId: PAGE_IDS.DATASET_RENAME_PICK,
        disabled: deps.profiles.length === 0,
      },
      {
        id: "root.dataset.delete",
        label: "Delete dataset",
        subtitle: "Remove a profile (must keep at least one)",
        intent: "page",
        childPageId: PAGE_IDS.DATASET_DELETE_PICK,
        disabled: !canDeleteProfiles,
      },
      {
        id: "root.setting.second-order",
        label: deps.secondOrderEnabled ? "Disable second-order sky factors" : "Enable second-order sky factors",
        subtitle: deps.secondOrderEnabled ? "Using enhanced sky model" : "Using first-order sky model",
        intent: "action",
      },
    ],
  }
}

export function createSameSkyMainlineAdapter(deps: MainlineAdapterDependencies): MainlineAdapter {
  const activeLocationIdSet = new Set(deps.activeProfile?.locationIds ?? [])
  const visibleLocations = deps.savedLocations.filter((location) => activeLocationIdSet.has(location.id))

  const makeLocationList = (pageId: string, title: string, intent: "action" | "page", childPageId?: string): MainlinePage => {
    const items: MainlineCommand[] = visibleLocations.map((location) => ({
      id: `${pageId}:${location.id}`,
      label: locationLabel(location),
      subtitle: locationSubtitle(location),
      intent,
      childPageId,
      keywords: [location.name, location.timezone ?? "", location.adminCity ?? ""],
      meta: { location },
    }))

    return {
      id: pageId,
      title,
      emptyStateText: "No locations available in the active profile.",
      items,
    }
  }

  const makeDatasetList = (pageId: string, title: string, intent: "action" | "page", childPageId?: string): MainlinePage => {
    const items: MainlineCommand[] = deps.profiles.map((profile) => ({
      id: `${pageId}:${profile.id}`,
      label: profile.name,
      subtitle: `${profile.locationIds.length} saved ${profile.locationIds.length === 1 ? "location" : "locations"}`,
      intent,
      childPageId,
      disabled: pageId === PAGE_IDS.DATASET_DELETE_PICK && deps.profiles.length <= 1,
      meta: { profile },
    }))

    return {
      id: pageId,
      title,
      items,
      emptyStateText: "No dataset profiles available.",
    }
  }

  return createMainlineAdapter({
    async loadRoot() {
      return buildRootPage(deps, visibleLocations)
    },

    async loadChild(pageId, _itemId, query, meta) {
      switch (pageId) {
        case PAGE_IDS.LOCATION_SWITCH:
          return makeLocationList(PAGE_IDS.LOCATION_SWITCH, "Switch location", "action")
        case PAGE_IDS.LOCATION_ADD_QUERY:
          return {
            id: PAGE_IDS.LOCATION_ADD_QUERY,
            mode: "input",
            title: "Add location",
            subtitle: "Type a place name and press Enter",
            placeholder: "Search locations",
            submitLabel: "Search",
            items: [],
          }
        case PAGE_IDS.LOCATION_ADD_NICKNAME: {
          const lookup = (meta as { lookup?: LookupResult } | undefined)?.lookup
          if (!lookup) {
            return { kind: "error", message: "Location lookup context missing." }
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
          }
        }
        case PAGE_IDS.LOCATION_RENAME_PICK:
          return makeLocationList(PAGE_IDS.LOCATION_RENAME_PICK, "Rename location", "page", PAGE_IDS.LOCATION_RENAME_INPUT)
        case PAGE_IDS.LOCATION_RENAME_INPUT: {
          const location = (meta as { location?: PersistedLocationApiResult } | undefined)?.location
          if (!location) {
            return { kind: "error", message: "Location context missing for rename." }
          }

          return {
            id: PAGE_IDS.LOCATION_RENAME_INPUT,
            mode: "input",
            title: `Rename ${locationLabel(location)}`,
            subtitle: "Updates the global nickname for this saved location.",
            placeholder: location.nickname ?? location.adminCity ?? location.name,
            submitLabel: "Rename",
            items: [],
            meta,
          }
        }
        case PAGE_IDS.LOCATION_DELETE_PICK:
          return makeLocationList(PAGE_IDS.LOCATION_DELETE_PICK, "Delete location", "action")
        case PAGE_IDS.DATASET_SWITCH:
          return makeDatasetList(PAGE_IDS.DATASET_SWITCH, "Switch dataset", "action")
        case PAGE_IDS.DATASET_CREATE_INPUT:
          return {
            id: PAGE_IDS.DATASET_CREATE_INPUT,
            mode: "input",
            title: "Create dataset",
            subtitle: "Create a new profile for scoped locations.",
            placeholder: "Dataset name",
            submitLabel: "Create",
            items: [],
          }
        case PAGE_IDS.DATASET_RENAME_PICK:
          return makeDatasetList(PAGE_IDS.DATASET_RENAME_PICK, "Rename dataset", "page", PAGE_IDS.DATASET_RENAME_INPUT)
        case PAGE_IDS.DATASET_RENAME_INPUT: {
          const profile = (meta as { profile?: LocationProfile } | undefined)?.profile
          if (!profile) {
            return { kind: "error", message: "Dataset context missing for rename." }
          }

          return {
            id: PAGE_IDS.DATASET_RENAME_INPUT,
            mode: "input",
            title: `Rename ${profile.name}`,
            placeholder: profile.name,
            submitLabel: "Rename",
            items: [],
            meta,
          }
        }
        case PAGE_IDS.DATASET_DELETE_PICK:
          return makeDatasetList(PAGE_IDS.DATASET_DELETE_PICK, "Delete dataset", "action")
        default:
          return { kind: "error", message: `Unsupported command page: ${pageId}` }
      }
    },

    async execute(itemId, pageId) {
      if (itemId === "root.location.refresh") {
        await deps.reloadSavedLocations()
        return { kind: "refreshPage" }
      }

      if (itemId === "root.setting.second-order") {
        deps.setSecondOrderEnabled(!deps.secondOrderEnabled)
        return { kind: "refreshPage" }
      }

      if (pageId === PAGE_IDS.LOCATION_SWITCH) {
        const locationId = parseId(itemId, `${PAGE_IDS.LOCATION_SWITCH}:`)
        if (!locationId) {
          return { kind: "error", message: "Invalid location selection." }
        }

        deps.setSelectedId(locationId)
        return { kind: "close" }
      }

      if (pageId === PAGE_IDS.LOCATION_DELETE_PICK) {
        const locationId = parseId(itemId, `${PAGE_IDS.LOCATION_DELETE_PICK}:`)
        if (!locationId) {
          return { kind: "error", message: "Invalid location deletion command." }
        }

        const url = new URL(`/api/locations/persisted/${locationId}`, window.location.origin)
        const response = await fetch(url, { method: "DELETE" })
        await readJson(response, "Unable to delete saved location.")
        deps.removeLocationEverywhere(locationId)
        await deps.reloadSavedLocations()
        return { kind: "close" }
      }

      if (pageId === PAGE_IDS.DATASET_SWITCH) {
        const profileId = parseId(itemId, `${PAGE_IDS.DATASET_SWITCH}:`)
        if (!profileId) {
          return { kind: "error", message: "Invalid dataset selection." }
        }

        deps.setActiveProfile(profileId)
        return { kind: "close" }
      }

      if (pageId === PAGE_IDS.DATASET_DELETE_PICK) {
        const profileId = parseId(itemId, `${PAGE_IDS.DATASET_DELETE_PICK}:`)
        if (!profileId) {
          return { kind: "error", message: "Invalid dataset deletion command." }
        }

        const deleted = deps.deleteProfile(profileId)
        if (!deleted) {
          return { kind: "error", message: "Unable to delete dataset. At least one profile must remain." }
        }

        return { kind: "close" }
      }

      return { kind: "stay" }
    },

    async submit(pageId, query, meta) {
      const trimmed = query.trim()

      if (pageId === PAGE_IDS.LOCATION_ADD_QUERY) {
        if (!trimmed) {
          return { kind: "error", message: "Location query cannot be empty." }
        }

        const lookupUrl = new URL("/api/locations/lookup", window.location.origin)
        lookupUrl.searchParams.set("q", trimmed)
        lookupUrl.searchParams.set("limit", "8")
        const lookupResponse = await fetch(lookupUrl)
        const payload = await readJson<{ results: LookupResult[] }>(lookupResponse, "Unable to look up locations.")

        if (payload.results.length === 0) {
          return { kind: "error", message: "No matching locations found." }
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
        }

        return { kind: "pushPage", page: resultsPage }
      }

      if (pageId === PAGE_IDS.LOCATION_ADD_NICKNAME) {
        const lookup = (meta as { lookup?: LookupResult; query?: string } | undefined)?.lookup
        const lookupQuery = (meta as { lookup?: LookupResult; query?: string } | undefined)?.query ?? ""

        if (!lookup) {
          return { kind: "error", message: "Missing selected location for save." }
        }

        const persistResponse = await fetch(new URL("/api/locations/persisted", window.location.origin), {
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
        })

        const saved = await readJson<PersistedApiResponse>(persistResponse, "Unable to save selected location.")
        await deps.reloadSavedLocations()
        deps.addLocationToActiveProfile(saved.result.id)
        deps.setSelectedId(saved.result.id)
        return { kind: "close" }
      }

      if (pageId === PAGE_IDS.LOCATION_RENAME_INPUT) {
        const location = (meta as { location?: PersistedLocationApiResult } | undefined)?.location
        if (!location) {
          return { kind: "error", message: "Missing location context for rename." }
        }

        if (!trimmed) {
          return { kind: "error", message: "Nickname cannot be empty." }
        }

        const patchResponse = await fetch(new URL(`/api/locations/persisted/${location.id}`, window.location.origin), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nickname: trimmed }),
        })

        await readJson(patchResponse, "Unable to rename location.")
        await deps.reloadSavedLocations()
        return { kind: "close" }
      }

      if (pageId === PAGE_IDS.DATASET_CREATE_INPUT) {
        if (!trimmed) {
          return { kind: "error", message: "Dataset name cannot be empty." }
        }

        deps.createProfile(trimmed)
        return { kind: "close" }
      }

      if (pageId === PAGE_IDS.DATASET_RENAME_INPUT) {
        const profile = (meta as { profile?: LocationProfile } | undefined)?.profile
        if (!profile) {
          return { kind: "error", message: "Missing dataset context for rename." }
        }

        const renamed = deps.renameProfile(profile.id, trimmed)
        if (!renamed) {
          return { kind: "error", message: "Dataset name cannot be empty." }
        }

        return { kind: "close" }
      }

      return { kind: "stay" }
    },
  })
}

export default createSameSkyMainlineAdapter
