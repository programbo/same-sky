import { useEffect, useState } from "react"
import { UNSTABLE_ToastQueue as ToastQueue } from "react-aria-components"

export interface KeyboardHelpToastContent {
  title: string
  description: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const KEYBOARD_HELP_TOAST_SESSION_KEY = "same_sky_home_keyboard_help_seen_v1"
export const KEYBOARD_HELP_TOAST_TIMEOUT_MS = 5_500
export const KEYBOARD_HELP_TOAST_CONTENT: KeyboardHelpToastContent = {
  title: "Keyboard navigation",
  description: "Use arrow keys to move between locations. Press Space or Enter to select.",
}
export const KEYBOARD_HELP_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "])
export const keyboardHelpToastQueue = new ToastQueue<KeyboardHelpToastContent>()
let latestKeyboardModality = false

export function isKeyboardNavigationTriggerKey(key: string): boolean {
  return KEYBOARD_HELP_KEYS.has(key)
}

function getSessionStorageSafe(): StorageLike | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function hasSeenKeyboardHelpToast(storage: StorageLike | null): boolean {
  return storage?.getItem(KEYBOARD_HELP_TOAST_SESSION_KEY) === "1"
}

export function markKeyboardHelpToastSeen(storage: StorageLike | null): void {
  storage?.setItem(KEYBOARD_HELP_TOAST_SESSION_KEY, "1")
}

export function enqueueKeyboardHelpToastOnce(): boolean {
  const storage = getSessionStorageSafe()
  if (hasSeenKeyboardHelpToast(storage)) {
    return false
  }

  markKeyboardHelpToastSeen(storage)
  keyboardHelpToastQueue.add(KEYBOARD_HELP_TOAST_CONTENT, { timeout: KEYBOARD_HELP_TOAST_TIMEOUT_MS })
  return true
}

export function isKeyboardModalityActive(): boolean {
  return latestKeyboardModality
}

export function useKeyboardModality(): boolean {
  const [isKeyboardModality, setIsKeyboardModality] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isKeyboardNavigationTriggerKey(event.key)) {
        latestKeyboardModality = true
        setIsKeyboardModality(true)
      }
    }
    const onPointerInput = () => {
      latestKeyboardModality = false
      setIsKeyboardModality(false)
    }

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("pointerdown", onPointerInput, true)
    window.addEventListener("mousedown", onPointerInput, true)
    window.addEventListener("touchstart", onPointerInput, true)

    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("pointerdown", onPointerInput, true)
      window.removeEventListener("mousedown", onPointerInput, true)
      window.removeEventListener("touchstart", onPointerInput, true)
    }
  }, [])

  return isKeyboardModality
}
