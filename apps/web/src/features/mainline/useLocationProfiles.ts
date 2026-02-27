import { useCallback, useEffect, useMemo, useState } from "react"

const STORAGE_KEY = "mainline.profiles.v1"

export interface LocationProfile {
  id: string
  name: string
  locationIds: string[]
  createdAtMs: number
  updatedAtMs: number
}

interface ProfileStore {
  profiles: LocationProfile[]
}

interface UseLocationProfilesOptions {
  savedLocationIds: string[]
  hasLoadedSavedLocations: boolean
  activeProfileId: string | null
  onActiveProfileIdChange: (profileId: string | null) => void
}

export interface UseLocationProfilesResult {
  profiles: LocationProfile[]
  activeProfile: LocationProfile | null
  visibleLocationIds: string[]
  setActiveProfile: (profileId: string) => void
  createProfile: (name: string) => LocationProfile
  renameProfile: (profileId: string, name: string) => boolean
  deleteProfile: (profileId: string) => boolean
  addLocationToActiveProfile: (locationId: string) => void
  removeLocationEverywhere: (locationId: string) => void
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readProfiles(): LocationProfile[] {
  if (typeof window === "undefined") {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as ProfileStore
    if (!parsed || !Array.isArray(parsed.profiles)) {
      return []
    }

    return parsed.profiles.filter((profile): profile is LocationProfile => {
      return (
        typeof profile.id === "string" &&
        typeof profile.name === "string" &&
        Array.isArray(profile.locationIds) &&
        typeof profile.createdAtMs === "number" &&
        typeof profile.updatedAtMs === "number"
      )
    })
  } catch {
    return []
  }
}

export function useLocationProfiles(options: UseLocationProfilesOptions): UseLocationProfilesResult {
  const [profiles, setProfiles] = useState<LocationProfile[]>(() => readProfiles())

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles }))
  }, [profiles])

  useEffect(() => {
    if (!options.hasLoadedSavedLocations || profiles.length > 0) {
      return
    }

    const now = Date.now()
    const seeded: LocationProfile = {
      id: generateId("profile"),
      name: "Saved locations",
      locationIds: [...options.savedLocationIds],
      createdAtMs: now,
      updatedAtMs: now,
    }

    setProfiles([seeded])
    options.onActiveProfileIdChange(seeded.id)
  }, [options.hasLoadedSavedLocations, options.savedLocationIds, options.onActiveProfileIdChange, profiles.length])

  useEffect(() => {
    if (profiles.length === 0) {
      if (options.activeProfileId !== null) {
        options.onActiveProfileIdChange(null)
      }
      return
    }

    const activeExists = options.activeProfileId ? profiles.some((profile) => profile.id === options.activeProfileId) : false
    if (activeExists) {
      return
    }

    options.onActiveProfileIdChange(profiles[0]?.id ?? null)
  }, [profiles, options.activeProfileId, options.onActiveProfileIdChange])

  useEffect(() => {
    if (!options.hasLoadedSavedLocations || profiles.length === 0) {
      return
    }

    const validIds = new Set(options.savedLocationIds)
    setProfiles((prev) => {
      let changed = false
      const next = prev.map((profile) => {
        const filtered = profile.locationIds.filter((locationId) => validIds.has(locationId))
        if (filtered.length === profile.locationIds.length) {
          return profile
        }

        changed = true
        return {
          ...profile,
          locationIds: filtered,
          updatedAtMs: Date.now(),
        }
      })

      return changed ? next : prev
    })
  }, [options.hasLoadedSavedLocations, options.savedLocationIds, profiles.length])

  const activeProfile = useMemo(() => {
    if (!options.activeProfileId) {
      return profiles[0] ?? null
    }

    return profiles.find((profile) => profile.id === options.activeProfileId) ?? profiles[0] ?? null
  }, [profiles, options.activeProfileId])

  const setActiveProfile = useCallback(
    (profileId: string) => {
      if (!profiles.some((profile) => profile.id === profileId)) {
        return
      }

      options.onActiveProfileIdChange(profileId)
    },
    [profiles, options.onActiveProfileIdChange],
  )

  const createProfile = useCallback((name: string): LocationProfile => {
    const now = Date.now()
    const profile: LocationProfile = {
      id: generateId("profile"),
      name: name.trim() || "Untitled profile",
      locationIds: [],
      createdAtMs: now,
      updatedAtMs: now,
    }

    setProfiles((prev) => [...prev, profile])
    options.onActiveProfileIdChange(profile.id)
    return profile
  }, [options.onActiveProfileIdChange])

  const renameProfile = useCallback((profileId: string, name: string): boolean => {
    const trimmed = name.trim()
    if (!trimmed) {
      return false
    }

    let changed = false
    setProfiles((prev) =>
      prev.map((profile) => {
        if (profile.id !== profileId) {
          return profile
        }

        changed = true
        return {
          ...profile,
          name: trimmed,
          updatedAtMs: Date.now(),
        }
      }),
    )

    return changed
  }, [])

  const deleteProfile = useCallback((profileId: string): boolean => {
    if (profiles.length <= 1 || !profiles.some((profile) => profile.id === profileId)) {
      return false
    }

    const next = profiles.filter((profile) => profile.id !== profileId)
    setProfiles(next)

    if (options.activeProfileId === profileId) {
      options.onActiveProfileIdChange(next[0]?.id ?? null)
    }

    return true
  }, [profiles, options.activeProfileId, options.onActiveProfileIdChange])

  const addLocationToActiveProfile = useCallback(
    (locationId: string) => {
      const targetId = activeProfile?.id
      if (!targetId) {
        return
      }

      setProfiles((prev) =>
        prev.map((profile) => {
          if (profile.id !== targetId || profile.locationIds.includes(locationId)) {
            return profile
          }

          return {
            ...profile,
            locationIds: [...profile.locationIds, locationId],
            updatedAtMs: Date.now(),
          }
        }),
      )
    },
    [activeProfile?.id],
  )

  const removeLocationEverywhere = useCallback((locationId: string) => {
    setProfiles((prev) => {
      let changed = false
      const next = prev.map((profile) => {
        if (!profile.locationIds.includes(locationId)) {
          return profile
        }

        changed = true
        return {
          ...profile,
          locationIds: profile.locationIds.filter((candidate) => candidate !== locationId),
          updatedAtMs: Date.now(),
        }
      })

      return changed ? next : prev
    })
  }, [])

  return {
    profiles,
    activeProfile,
    visibleLocationIds: activeProfile?.locationIds ?? [],
    setActiveProfile,
    createProfile,
    renameProfile,
    deleteProfile,
    addLocationToActiveProfile,
    removeLocationEverywhere,
  }
}

export default useLocationProfiles
