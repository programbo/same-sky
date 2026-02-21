import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

function parseLegacyJsonStore(filePath: string): PersistedLocation[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as Partial<PersistedStoreFile>;
  if (!parsed || !Array.isArray(parsed.locations)) {
    return [];
  }

  if (parsed.version !== 1 && parsed.version !== 2) {
    return [];
  }

  return parsed.locations.filter(isLegacyPersistedLocation).map(toPersistedLocation);
}

interface PersistedLocationRow {
  id: string;
  name: string;
  lat: number;
  long: number;
  nickname: string | null;
  timezone: string | null;
  granularity: string | null;
  created_at_ms: number;
}

function rowToPersistedLocation(row: PersistedLocationRow): PersistedLocation {
  return {
    id: row.id,
    name: row.name,
    coords: {
      lat: row.lat,
      long: row.long,
    },
    nickname: normalizeNickname(row.nickname ?? undefined),
    timezone: normalizeTimezone(row.timezone ?? undefined),
    granularity: normalizeGranularity(row.granularity ?? undefined),
    createdAtMs: row.created_at_ms,
  };
}

export class PersistedLocationStore implements PersistedLocationStoreLike {
  private readonly db: Database;

  constructor(
    private readonly dbPath = path.join(process.cwd(), "data", "persisted-locations.db"),
    private readonly now: () => number = Date.now,
    private readonly legacyJsonPath = path.join(path.dirname(dbPath), "persisted-locations.json"),
  ) {
    if (this.dbPath !== ":memory:") {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persisted_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        long REAL NOT NULL,
        nickname TEXT,
        timezone TEXT,
        granularity TEXT,
        created_at_ms INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_persisted_locations_created_at
      ON persisted_locations(created_at_ms DESC);
    `);

    this.migrateFromLegacyJson();
  }

  private migrateFromLegacyJson(): void {
    const row = this.db.query("SELECT COUNT(*) AS count FROM persisted_locations").get() as { count: number } | null;
    const existingCount = row?.count ?? 0;
    if (existingCount > 0) {
      return;
    }

    const legacyLocations = parseLegacyJsonStore(this.legacyJsonPath);
    if (legacyLocations.length === 0) {
      return;
    }

    const insertStatement = this.db.prepare(`
      INSERT OR IGNORE INTO persisted_locations (
        id,
        name,
        lat,
        long,
        nickname,
        timezone,
        granularity,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((locations: PersistedLocation[]) => {
      for (const location of locations) {
        insertStatement.run(
          location.id,
          location.name,
          location.coords.lat,
          location.coords.long,
          location.nickname ?? null,
          location.timezone ?? null,
          location.granularity ?? null,
          location.createdAtMs,
        );
      }
    });

    transaction(legacyLocations);
  }

  async list(): Promise<PersistedLocation[]> {
    const rows = this.db
      .query(
        `
          SELECT
            id,
            name,
            lat,
            long,
            nickname,
            timezone,
            granularity,
            created_at_ms
          FROM persisted_locations
          ORDER BY created_at_ms DESC
        `,
      )
      .all() as PersistedLocationRow[];

    return rows.map(rowToPersistedLocation);
  }

  async add(input: PersistLocationInput): Promise<PersistedLocation> {
    const name = normalizeName(input.name);
    const nickname = normalizeNickname(input.nickname);
    const timezone = normalizeTimezone(input.timezone);
    const granularity = normalizeGranularity(input.granularity);

    if (!Number.isFinite(input.coords.lat) || !Number.isFinite(input.coords.long)) {
      throw new Error("Coordinates must be finite numbers.");
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

    this.db
      .prepare(
        `
          INSERT INTO persisted_locations (
            id,
            name,
            lat,
            long,
            nickname,
            timezone,
            granularity,
            created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        entry.id,
        entry.name,
        entry.coords.lat,
        entry.coords.long,
        entry.nickname ?? null,
        entry.timezone ?? null,
        entry.granularity ?? null,
        entry.createdAtMs,
      );

    return entry;
  }

  async remove(id: string): Promise<PersistedLocation | null> {
    const targetId = id.trim();
    if (!targetId) {
      return null;
    }

    const row = this.db
      .query(
        `
          SELECT
            id,
            name,
            lat,
            long,
            nickname,
            timezone,
            granularity,
            created_at_ms
          FROM persisted_locations
          WHERE id = ?
        `,
      )
      .get(targetId) as PersistedLocationRow | null;

    if (!row) {
      return null;
    }

    this.db.prepare("DELETE FROM persisted_locations WHERE id = ?").run(targetId);
    return rowToPersistedLocation(row);
  }

  async update(id: string, patch: PersistLocationPatch): Promise<PersistedLocation | null> {
    const targetId = id.trim();
    if (!targetId) {
      return null;
    }

    const row = this.db
      .query(
        `
          SELECT
            id,
            name,
            lat,
            long,
            nickname,
            timezone,
            granularity,
            created_at_ms
          FROM persisted_locations
          WHERE id = ?
        `,
      )
      .get(targetId) as PersistedLocationRow | null;

    if (!row) {
      return null;
    }

    const existing = rowToPersistedLocation(row);
    const timezone = patch.timezone === undefined ? existing.timezone : normalizeTimezone(patch.timezone);
    const granularity =
      patch.granularity === undefined ? existing.granularity : normalizeGranularity(patch.granularity);

    this.db
      .prepare("UPDATE persisted_locations SET timezone = ?, granularity = ? WHERE id = ?")
      .run(timezone ?? null, granularity ?? null, targetId);

    return {
      ...existing,
      timezone,
      granularity,
    };
  }
}
