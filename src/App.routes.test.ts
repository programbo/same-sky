import { describe, expect, test } from "bun:test"
import { resolveAppRoute } from "./App"

describe("resolveAppRoute", () => {
  test("routes root to tailwind page", () => {
    expect(resolveAppRoute("/")).toBe("home-tailwind")
  })

  test("always routes to tailwind page", () => {
    expect(resolveAppRoute("/legacy-home")).toBe("home-tailwind")
    expect(resolveAppRoute("/legacy-preview")).toBe("home-tailwind")
    expect(resolveAppRoute("/unknown")).toBe("home-tailwind")
    expect(resolveAppRoute("")).toBe("home-tailwind")
  })
})
