import { expect, test, type Page } from "@playwright/test"

const FIXED_NOW_MS = Date.UTC(2025, 0, 1, 12, 0, 0)

const BASE_LOCATIONS = [
  {
    id: "loc-nyc",
    name: "New York, New York, United States",
    lat: 40.7128,
    long: -74.006,
    timezone: "America/New_York",
    kind: "location",
    createdAtMs: 1735689600000,
  },
  {
    id: "loc-lon",
    name: "London, England, United Kingdom",
    lat: 51.5072,
    long: -0.1276,
    timezone: "Europe/London",
    kind: "location",
    createdAtMs: 1735689601000,
  },
  {
    id: "loc-tok",
    name: "Tokyo, Tokyo, Japan",
    lat: 35.6762,
    long: 139.6503,
    timezone: "Asia/Tokyo",
    kind: "location",
    createdAtMs: 1735689602000,
  },
]

const BASE_SKY_RESULT = {
  timestampMs: FIXED_NOW_MS,
  timezone: "UTC",
  rotationDeg: 0,
  rotationRad: 0,
  stops: [
    { name: "local_midnight_start", timestampMs: FIXED_NOW_MS, minutesOfDay: 0, angleDeg: 0, colorHex: "#071322", shiftMinutes: 0 },
    { name: "astronomical_night", timestampMs: FIXED_NOW_MS, minutesOfDay: 120, angleDeg: 30, colorHex: "#081a32", shiftMinutes: 0 },
    { name: "nautical_dawn", timestampMs: FIXED_NOW_MS, minutesOfDay: 300, angleDeg: 75, colorHex: "#244a74", shiftMinutes: 0 },
    { name: "sunrise", timestampMs: FIXED_NOW_MS, minutesOfDay: 390, angleDeg: 97.5, colorHex: "#f0b26a", shiftMinutes: 0 },
    { name: "morning", timestampMs: FIXED_NOW_MS, minutesOfDay: 510, angleDeg: 127.5, colorHex: "#69b9f7", shiftMinutes: 0 },
    { name: "solar_noon", timestampMs: FIXED_NOW_MS, minutesOfDay: 720, angleDeg: 180, colorHex: "#8dd6ff", shiftMinutes: 0 },
    { name: "afternoon", timestampMs: FIXED_NOW_MS, minutesOfDay: 870, angleDeg: 217.5, colorHex: "#74b6e8", shiftMinutes: 0 },
    { name: "sunset", timestampMs: FIXED_NOW_MS, minutesOfDay: 1050, angleDeg: 262.5, colorHex: "#dd9264", shiftMinutes: 0 },
    { name: "nautical_dusk", timestampMs: FIXED_NOW_MS, minutesOfDay: 1140, angleDeg: 285, colorHex: "#2f4e7c", shiftMinutes: 0 },
    { name: "astronomical_dusk", timestampMs: FIXED_NOW_MS, minutesOfDay: 1260, angleDeg: 315, colorHex: "#182f52", shiftMinutes: 0 },
    { name: "late_night", timestampMs: FIXED_NOW_MS, minutesOfDay: 1350, angleDeg: 337.5, colorHex: "#0c1b34", shiftMinutes: 0 },
    { name: "local_midnight_end", timestampMs: FIXED_NOW_MS, minutesOfDay: 1439, angleDeg: 359.75, colorHex: "#071322", shiftMinutes: 0 },
  ],
}

interface MockApiOptions {
  locations?: unknown[]
  locationsError?: string
  skyError?: string
}

async function mockApi(page: Page, options: MockApiOptions = {}) {
  await page.route("**/api/locations/persisted", async (route) => {
    if (options.locationsError) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "mock_locations_error",
            message: options.locationsError,
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: options.locations ?? BASE_LOCATIONS,
      }),
    })
  })

  await page.route("**/api/location/sky-24h**", async (route) => {
    if (options.skyError) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "mock_sky_error",
            message: options.skyError,
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: BASE_SKY_RESULT }),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ nowMs }) => {
    const NativeDate = Date

    class FixedDate extends NativeDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(nowMs)
          return
        }
        super(...(args as ConstructorParameters<typeof Date>))
      }

      static override now() {
        return nowMs
      }
    }

    Object.defineProperty(FixedDate, "UTC", { value: NativeDate.UTC })
    Object.defineProperty(FixedDate, "parse", { value: NativeDate.parse })
    Object.defineProperty(FixedDate, Symbol.hasInstance, {
      value(instance: unknown) {
        return instance instanceof NativeDate
      },
    })

    ;(window as Window & { Date: DateConstructor }).Date = FixedDate as unknown as DateConstructor
  }, { nowMs: FIXED_NOW_MS })
})

test("desktop default state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await mockApi(page)

  await page.goto("/")
  await expect(page.getByLabel("Sky ring 24 hour view")).toBeVisible()

  await expect(page).toHaveScreenshot("home-clock-desktop-default.png", { fullPage: true })
})

test("mobile default state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)

  await page.goto("/")
  await expect(page.getByLabel("Sky ring 24 hour view")).toBeVisible()

  await expect(page).toHaveScreenshot("home-clock-mobile-default.png", { fullPage: true })
})

test("selection interaction state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await mockApi(page)

  await page.goto("/")
  await expect(page.getByRole("button", { name: "Tokyo" })).toBeVisible()

  await page.getByRole("button", { name: "Tokyo" }).click()
  await expect(page).toHaveScreenshot("home-clock-desktop-selection-change.png", { fullPage: true })
})

test("empty state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await mockApi(page, { locations: [] })

  await page.goto("/")
  await expect(page.getByText("No saved locations yet. The ring follows your current timezone.")).toBeVisible()

  await expect(page).toHaveScreenshot("home-clock-desktop-empty-state.png", { fullPage: true })
})

test("sky error state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await mockApi(page, { skyError: "Unable to render sky ring." })

  await page.goto("/")
  await expect(page.getByRole("alert")).toContainText("Unable to render sky ring.")

  await expect(page).toHaveScreenshot("home-clock-desktop-error-state.png", { fullPage: true })
})

test("command palette opens from trigger button", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await mockApi(page)

  await page.goto("/")
  await page.getByRole("button", { name: /Command/i }).click()
  await expect(page.getByRole("heading", { name: "react-mainline" })).toBeVisible()

  await expect(page).toHaveScreenshot("home-clock-desktop-command-palette-open.png", { fullPage: true })
})

test("command palette opens from keyboard shortcut", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await mockApi(page)

  await page.goto("/")
  await page.keyboard.press("Control+K")
  await expect(page.getByRole("heading", { name: "react-mainline" })).toBeVisible()

  await expect(page).toHaveScreenshot("home-clock-desktop-command-palette-hotkey-open.png", { fullPage: true })
})
