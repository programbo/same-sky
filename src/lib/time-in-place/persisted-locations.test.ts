import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
      timezone: "Europe/Paris",
      granularity: "city",
    });

    now += 10;

    const second = await store.add({
      name: "Tokyo, Tokyo, Japan",
      coords: { lat: 35.6762, long: 139.6503 },
      timezone: "Asia/Tokyo",
      granularity: "city",
    });

    const listed = await store.list();

    expect(listed).toHaveLength(2);
    expect(listed[0]?.id).toBe(second.id);
    expect(listed[1]?.id).toBe(first.id);
    expect(listed[1]?.nickname).toBe("Home base");
    expect(listed[1]?.timezone).toBe("Europe/Paris");
  });

  test("removes a saved location", async () => {
    const store = new PersistedLocationStore(path.join(TEST_DIR, "locations.json"));
    const saved = await store.add({
      name: "New York, New York, United States",
      coords: { lat: 40.7128, long: -74.0060 },
      timezone: "America/New_York",
      granularity: "city",
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

  test("updates timezone metadata for an existing location", async () => {
    const store = new PersistedLocationStore(path.join(TEST_DIR, "locations.json"));
    const saved = await store.add({
      name: "Legacy",
      coords: { lat: 10, long: 11 },
    });

    const updated = await store.update(saved.id, { timezone: "Asia/Tokyo", granularity: "city" });
    expect(updated?.timezone).toBe("Asia/Tokyo");
    expect(updated?.granularity).toBe("city");
  });

  test("reads v1 files and rewrites them as v2 on list", async () => {
    const filePath = path.join(TEST_DIR, "locations.json");
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify(
        {
          version: 1,
          locations: [
            {
              id: "legacy-1",
              name: "Legacy Place",
              coords: { lat: 1, long: 2 },
              createdAtMs: 1000,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new PersistedLocationStore(filePath);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.timezone).toBeUndefined();

    const raw = await Bun.file(filePath).text();
    const parsed = JSON.parse(raw) as { version: number };
    expect(parsed.version).toBe(2);
  });
});
