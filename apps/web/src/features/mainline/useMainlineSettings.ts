import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "mainline.settings.v1"

export interface MainlineSettingsState {
  secondOrderEnabled: boolean
  activeProfileId: string | null
}

const DEFAULT_SETTINGS: MainlineSettingsState = {
  secondOrderEnabled: false,
  activeProfileId: null,
}

function readSettings(): MainlineSettingsState {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }

    const parsed = JSON.parse(raw) as Partial<MainlineSettingsState>
    return {
      secondOrderEnabled: parsed.secondOrderEnabled ?? false,
      activeProfileId: typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : null,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export interface UseMainlineSettingsResult {
  secondOrderEnabled: boolean
  activeProfileId: string | null
  setSecondOrderEnabled: (next: boolean) => void
  setActiveProfileId: (profileId: string | null) => void
}

export function useMainlineSettings(): UseMainlineSettingsResult {
  const [settings, setSettings] = useState<MainlineSettingsState>(() => readSettings())

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const setSecondOrderEnabled = useCallback((next: boolean) => {
    setSettings((prev) => ({ ...prev, secondOrderEnabled: next }))
  }, [])

  const setActiveProfileId = useCallback((profileId: string | null) => {
    setSettings((prev) => ({ ...prev, activeProfileId: profileId }))
  }, [])

  return {
    secondOrderEnabled: settings.secondOrderEnabled,
    activeProfileId: settings.activeProfileId,
    setSecondOrderEnabled,
    setActiveProfileId,
  }
}

export default useMainlineSettings
