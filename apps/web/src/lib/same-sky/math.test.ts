import { describe, expect, test } from "bun:test";
import { angleForTimeOffset, normalizeDegrees, normalizeRadians } from "./math";

describe("angleForTimeOffset", () => {
  test("returns zero for zero offset", () => {
    expect(angleForTimeOffset(0, "deg")).toBe(0);
    expect(angleForTimeOffset(0, "rad")).toBe(0);
  });

  test("converts positive and negative offsets", () => {
    expect(angleForTimeOffset(6 * 60 * 60, "deg")).toBe(90);
    expect(angleForTimeOffset(-6 * 60 * 60, "deg")).toBe(-90);
  });

  test("normalizes wraparound", () => {
    expect(angleForTimeOffset(15 * 60 * 60, "deg")).toBe(-135);
    expect(angleForTimeOffset(-15 * 60 * 60, "deg")).toBe(135);
  });

  test("returns radians in normalized range", () => {
    const radians = angleForTimeOffset(6 * 60 * 60, "rad");
    expect(radians).toBeCloseTo(Math.PI / 2, 10);
    expect(radians).toBeGreaterThanOrEqual(-Math.PI);
    expect(radians).toBeLessThan(Math.PI);
  });
});

describe("normalizers", () => {
  test("normalizes degree boundaries", () => {
    expect(normalizeDegrees(180)).toBe(-180);
    expect(normalizeDegrees(-180)).toBe(-180);
    expect(normalizeDegrees(540)).toBe(-180);
  });

  test("normalizes radian boundaries", () => {
    expect(normalizeRadians(Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(normalizeRadians(-Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(normalizeRadians(3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
  });
});
