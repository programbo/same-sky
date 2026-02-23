import { describe, expect, test } from "bun:test"
import { resolveAppRoute } from "./App"

describe("resolveAppRoute", () => {
  test("routes root to tailwind page", () => {
    expect(resolveAppRoute("/")).toBe("home-tailwind")
  })

  test("routes with-css path", () => {
    expect(resolveAppRoute("/with-css")).toBe("home-css")
    expect(resolveAppRoute("/with-css/")).toBe("home-css")
  })

  test("routes ring-renderer path", () => {
    expect(resolveAppRoute("/ring-renderer")).toBe("ring-renderer")
    expect(resolveAppRoute("/ring-renderer/")).toBe("ring-renderer")
  })

  test("falls back unknown paths to tailwind page", () => {
    expect(resolveAppRoute("/unknown")).toBe("home-tailwind")
    expect(resolveAppRoute("")).toBe("home-tailwind")
  })
})
