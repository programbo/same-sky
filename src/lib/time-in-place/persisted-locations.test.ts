import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PersistedLocationStore } from "./persisted-locations";

const TEST_DIR = path.join(process.cwd(), "tmp", "persisted-location-tests");

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("PersistedLocationStore", () => {
  test("adds and lists saved locations", async () => {
    let now = 1_700_000_000_000;
    const store = new PersistedLocationStore(path.join(TEST_DIR, "locations.json"), () => now);

    const first = await store.add({
      name: "Paris, Ile-de-France, France",
      coords: { lat: 48.8566, long: 2.3522 },
      nickname: "Home base",
    });

    now += 10;

    const second = await store.add({
      name: "Tokyo, Tokyo, Japan",
      coords: { lat: 35.6762, long: 139.6503 },
    });

    const listed = await store.list();

    expect(listed).toHaveLength(2);
    expect(listed[0]?.id).toBe(second.id);
    expect(listed[1]?.id).toBe(first.id);
    expect(listed[1]?.nickname).toBe("Home base");
  });

  test("removes a saved location", async () => {
    const store = new PersistedLocationStore(path.join(TEST_DIR, "locations.json"));
    const saved = await store.add({
      name: "New York, New York, United States",
      coords: { lat: 40.7128, long: -74.0060 },
    });

    const removed = await store.remove(saved.id);
    const listed = await store.list();

    expect(removed?.id).toBe(saved.id);
    expect(listed).toHaveLength(0);
  });

  test("returns null when removing unknown id", async () => {
    const store = new PersistedLocationStore(path.join(TEST_DIR, "locations.json"));

    expect(await store.remove("missing-id")).toBeNull();
  });
});
