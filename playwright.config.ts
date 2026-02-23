import { defineConfig } from "@playwright/test"

const port = 4173
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.visual.ts",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    reducedMotion: "reduce",
    timezoneId: "UTC",
    colorScheme: "dark",
  },
  webServer: {
    command: `PORT=${port} bun run scripts/playwright-server.ts`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
