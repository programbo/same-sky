import { describe, expect, test } from "bun:test";
import { TTLCache, createCacheKey, normalizeCacheToken } from "./cache";

describe("cache helpers", () => {
  test("normalizes cache tokens for case, whitespace, and diacritics", () => {
    expect(normalizeCacheToken("  S\u00E3o   PAULO ")).toBe("sao paulo");
  });

  test("creates stable normalized keys", () => {
    const keyA = createCacheKey(["lookup", "  S\u00E3o   PAULO ", { limit: 5 }]);
    const keyB = createCacheKey(["lookup", "sao paulo", { limit: 5 }]);

    expect(keyA).toBe(keyB);
  });
});

describe("TTLCache", () => {
  test("returns cached entries before expiration", () => {
    let now = 1_000;
    const cache = new TTLCache<string>(() => now);

    cache.set("answer", "42", 200);
    expect(cache.get("answer")).toBe("42");

    now += 199;
    expect(cache.get("answer")).toBe("42");
  });

  test("expires entries once ttl has passed", () => {
    let now = 10_000;
    const cache = new TTLCache<string>(() => now);

    cache.set("value", "cached", 100);
    now += 101;

    expect(cache.get("value")).toBeUndefined();
  });
});
