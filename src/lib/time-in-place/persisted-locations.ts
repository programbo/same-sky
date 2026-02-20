import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseLocationGranularity, type Coordinates, type LocationGranularity } from "./types";

export interface PersistedLocation {
  id: string;
  name: string;
  coords: Coordinates;
  nickname?: string;
  timezone?: string;
  granularity?: LocationGranularity;
  createdAtMs: number;
}

export interface PersistLocationInput {
  name: string;
  coords: Coordinates;
  nickname?: string;
  timezone?: string;
  granularity?: LocationGranularity;
}

export interface PersistLocationPatch {
  timezone?: string;
  granularity?: LocationGranularity;
}

export interface PersistedLocationStoreLike {
  list(): Promise<PersistedLocation[]>;
  add(input: PersistLocationInput): Promise<PersistedLocation>;
  remove(id: string): Promise<PersistedLocation | null>;
  update(id: string, patch: PersistLocationPatch): Promise<PersistedLocation | null>;
}

interface LegacyPersistedLocation {
  id: string;
  name: string;
  coords: Coordinates;
  nickname?: string;
  createdAtMs: number;
}

interface PersistedStoreFileV1 {
  version: 1;
  locations: LegacyPersistedLocation[];
}

interface PersistedStoreFileV2 {
  version: 2;
  locations: PersistedLocation[];
}

type PersistedStoreFile = PersistedStoreFileV1 | PersistedStoreFileV2;

function normalizeNickname(nickname?: string): string | undefined {
  if (nickname === undefined) {
    return undefined;
  }

  const trimmed = nickname.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Location name cannot be empty.");
  }

  return trimmed;
}

function normalizeTimezone(timezone?: string): string | undefined {
  if (timezone === undefined) {
    return undefined;
  }

  const trimmed = timezone.trim();
  if (!trimmed) {
    throw new Error("Timezone must be a non-empty string when provided.");
  }

  return trimmed;
}

function normalizeGranularity(granularity?: string): LocationGranularity | undefined {
  if (granularity === undefined) {
    return undefined;
  }

  return parseLocationGranularity(granularity);
}

function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") {
    return false;
  }

  const coords = value as Partial<Coordinates>;
  return typeof coords.lat === "number" && typeof coords.long === "number";
}

function isLegacyPersistedLocation(value: unknown): value is LegacyPersistedLocation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LegacyPersistedLocation>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    isCoordinates(candidate.coords) &&
    typeof candidate.createdAtMs === "number"
  );
}

function toPersistedLocation(value: LegacyPersistedLocation | PersistedLocation): PersistedLocation {
  const persistedLike = value as Partial<PersistedLocation>;

  return {
    id: value.id,
    name: value.name,
    coords: {
      lat: value.coords.lat,
      long: value.coords.long,
    },
    nickname: normalizeNickname(value.nickname),
    timezone: normalizeTimezone(persistedLike.timezone),
    granularity: normalizeGranularity(persistedLike.granularity),
    createdAtMs: value.createdAtMs,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export class PersistedLocationStore implements PersistedLocationStoreLike {
  constructor(
    private readonly filePath = path.join(process.cwd(), "data", "persisted-locations.json"),
    private readonly now: () => number = Date.now,
  ) {}

  private async readAll(): Promise<{ locations: PersistedLocation[]; migratedFromLegacy: boolean }> {
    if (!(await fileExists(this.filePath))) {
      return { locations: [], migratedFromLegacy: false };
    }

    const raw = await readFile(this.filePath, "utf8");
    if (!raw.trim()) {
      return { locations: [], migratedFromLegacy: false };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedStoreFile>;
    if (!parsed || !Array.isArray(parsed.locations)) {
      return { locations: [], migratedFromLegacy: false };
    }

    if (parsed.version === 1) {
      const locations = parsed.locations.filter(isLegacyPersistedLocation).map(toPersistedLocation);
      return { locations, migratedFromLegacy: true };
    }

    if (parsed.version === 2) {
      const locations = parsed.locations.filter(isLegacyPersistedLocation).map(toPersistedLocation);
      return { locations, migratedFromLegacy: false };
    }

    return { locations: [], migratedFromLegacy: false };
  }

  private async writeAll(locations: PersistedLocation[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });

    const payload: PersistedStoreFileV2 = {
      version: 2,
      locations,
    };

    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  async list(): Promise<PersistedLocation[]> {
    const { locations, migratedFromLegacy } = await this.readAll();
    if (migratedFromLegacy) {
      await this.writeAll(locations);
    }

    return [...locations].sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  async add(input: PersistLocationInput): Promise<PersistedLocation> {
    const name = normalizeName(input.name);
    const nickname = normalizeNickname(input.nickname);
    const timezone = normalizeTimezone(input.timezone);
    const granularity = normalizeGranularity(input.granularity);

    if (!Number.isFinite(input.coords.lat) || !Number.isFinite(input.coords.long)) {
      throw new Error("Coordinates must be finite numbers.");
    }

    const { locations, migratedFromLegacy } = await this.readAll();
    if (migratedFromLegacy) {
      await this.writeAll(locations);
    }

    const entry: PersistedLocation = {
      id: crypto.randomUUID(),
      name,
      coords: {
        lat: input.coords.lat,
        long: input.coords.long,
      },
      nickname,
      timezone,
      granularity,
      createdAtMs: this.now(),
    };

    locations.push(entry);
    await this.writeAll(locations);

    return entry;
  }

  async remove(id: string): Promise<PersistedLocation | null> {
    const targetId = id.trim();
    if (!targetId) {
      return null;
    }

    const { locations, migratedFromLegacy } = await this.readAll();
    if (migratedFromLegacy) {
      await this.writeAll(locations);
    }

    const index = locations.findIndex(location => location.id === targetId);
    if (index < 0) {
      return null;
    }

    const [removed] = locations.splice(index, 1);
    await this.writeAll(locations);
    return removed ?? null;
  }

  async update(id: string, patch: PersistLocationPatch): Promise<PersistedLocation | null> {
    const targetId = id.trim();
    if (!targetId) {
      return null;
    }

    const { locations, migratedFromLegacy } = await this.readAll();
    if (migratedFromLegacy) {
      await this.writeAll(locations);
    }

    const index = locations.findIndex(location => location.id === targetId);
    if (index < 0) {
      return null;
    }

    const existing = locations[index];
    if (!existing) {
      return null;
    }

    const timezone = patch.timezone === undefined ? existing.timezone : normalizeTimezone(patch.timezone);
    const granularity =
      patch.granularity === undefined ? existing.granularity : normalizeGranularity(patch.granularity);

    const updated: PersistedLocation = {
      ...existing,
      timezone,
      granularity,
    };

    locations[index] = updated;
    await this.writeAll(locations);
    return updated;
  }
}
