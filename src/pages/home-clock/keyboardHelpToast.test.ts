import { describe, expect, test } from "bun:test"
import {
  hasSeenKeyboardHelpToast,
  isKeyboardNavigationTriggerKey,
  KEYBOARD_HELP_TOAST_SESSION_KEY,
  markKeyboardHelpToastSeen,
} from "./keyboardHelpToast"

function createMemoryStorage(initialValue: string | null = null): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
} {
  const storage = new Map<string, string>()
  if (initialValue !== null) {
    storage.set(KEYBOARD_HELP_TOAST_SESSION_KEY, initialValue)
  }

  return {
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string) {
      storage.set(key, value)
    },
  }
}

describe("keyboardHelpToast helpers", () => {
  test("identifies keys that trigger keyboard modality tracking", () => {
    expect(isKeyboardNavigationTriggerKey("Tab")).toBe(true)
    expect(isKeyboardNavigationTriggerKey("ArrowRight")).toBe(true)
    expect(isKeyboardNavigationTriggerKey("Enter")).toBe(true)
    expect(isKeyboardNavigationTriggerKey(" ")).toBe(true)
    expect(isKeyboardNavigationTriggerKey("a")).toBe(false)
  })

  test("marks keyboard help toast as seen", () => {
    const storage = createMemoryStorage()
    expect(hasSeenKeyboardHelpToast(storage)).toBe(false)
    markKeyboardHelpToastSeen(storage)
    expect(hasSeenKeyboardHelpToast(storage)).toBe(true)
  })

  test("reads existing seen marker", () => {
    const storage = createMemoryStorage("1")
    expect(hasSeenKeyboardHelpToast(storage)).toBe(true)
  })
})
