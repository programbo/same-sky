import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseLocationGranularity, type Coordinates, type LocationGranularity } from "./types";

export const PERSISTED_LOCATION_KINDS = ["location", "entity"] as const;
export type PersistedLocationKind = (typeof PERSISTED_LOCATION_KINDS)[number];

export const PERSISTED_AVATAR_SOURCES = ["none", "upload", "gravatar"] as const;
export type PersistedAvatarSource = (typeof PERSISTED_AVATAR_SOURCES)[number];

export interface PersistedLocation {
  id: string;
  name: string;
  coords: Coordinates;
  nickname?: string;
  timezone?: string;
  granularity?: LocationGranularity;
  kind?: PersistedLocationKind;
  entityName?: string;
  countryCode?: string;
  adminState?: string;
  adminCity?: string;
  adminSuburb?: string;
  avatarSource?: PersistedAvatarSource;
  avatarImageUrl?: string;
  gravatarHash?: string;
  createdAtMs: number;
}

export interface PersistLocationInput {
  name: string;
  coords: Coordinates;
  nickname?: string;
  timezone?: string;
  granularity?: LocationGranularity;
  kind?: PersistedLocationKind;
  entityName?: string;
  countryCode?: string;
  adminState?: string;
  adminCity?: string;
  adminSuburb?: string;
  avatarSource?: PersistedAvatarSource;
  avatarImageUrl?: string;
  gravatarHash?: string;
}

export interface PersistLocationPatch {
  nickname?: string;
  timezone?: string;
  granularity?: LocationGranularity;
  kind?: PersistedLocationKind;
  entityName?: string;
  countryCode?: string;
  adminState?: string;
  adminCity?: string;
  adminSuburb?: string;
  avatarSource?: PersistedAvatarSource;
  avatarImageUrl?: string;
  gravatarHash?: string;
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

function normalizeOptionalText(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
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

function normalizeKind(kind?: string): PersistedLocationKind {
  if (kind === undefined) {
    return "location";
  }

  const normalized = kind.trim().toLowerCase();
  if (normalized === "entity" || normalized === "location") {
    return normalized;
  }

  throw new Error("kind must be one of: location, entity.");
}

function normalizeAvatarSource(value?: string): PersistedAvatarSource | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "upload" || normalized === "gravatar") {
    return normalized;
  }

  throw new Error("avatarSource must be one of: none, upload, gravatar.");
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
    kind: normalizeKind(persistedLike.kind),
    entityName: normalizeOptionalText(persistedLike.entityName),
    countryCode: normalizeOptionalText(persistedLike.countryCode)?.toUpperCase(),
    adminState: normalizeOptionalText(persistedLike.adminState),
    adminCity: normalizeOptionalText(persistedLike.adminCity),
    adminSuburb: normalizeOptionalText(persistedLike.adminSuburb),
    avatarSource: normalizeAvatarSource(persistedLike.avatarSource),
    avatarImageUrl: normalizeOptionalText(persistedLike.avatarImageUrl),
    gravatarHash: normalizeOptionalText(persistedLike.gravatarHash)?.toLowerCase(),
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
  kind: string | null;
  entity_name: string | null;
  country_code: string | null;
  admin_state: string | null;
  admin_city: string | null;
  admin_suburb: string | null;
  avatar_source: string | null;
  avatar_image_url: string | null;
  gravatar_hash: string | null;
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
    kind: normalizeKind(row.kind ?? undefined),
    entityName: normalizeOptionalText(row.entity_name ?? undefined),
    countryCode: normalizeOptionalText(row.country_code ?? undefined)?.toUpperCase(),
    adminState: normalizeOptionalText(row.admin_state ?? undefined),
    adminCity: normalizeOptionalText(row.admin_city ?? undefined),
    adminSuburb: normalizeOptionalText(row.admin_suburb ?? undefined),
    avatarSource: normalizeAvatarSource(row.avatar_source ?? undefined),
    avatarImageUrl: normalizeOptionalText(row.avatar_image_url ?? undefined),
    gravatarHash: normalizeOptionalText(row.gravatar_hash ?? undefined)?.toLowerCase(),
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
        kind TEXT,
        entity_name TEXT,
        country_code TEXT,
        admin_state TEXT,
        admin_city TEXT,
        admin_suburb TEXT,
        avatar_source TEXT,
        avatar_image_url TEXT,
        gravatar_hash TEXT,
        created_at_ms INTEGER NOT NULL
      );
    `);
    this.ensureSchemaColumns();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_persisted_locations_created_at
      ON persisted_locations(created_at_ms DESC);
    `);

    this.migrateFromLegacyJson();
  }

  private ensureSchemaColumns(): void {
    const columnRows = this.db.query("PRAGMA table_info(persisted_locations)").all() as Array<{ name: string }>;
    const names = new Set(columnRows.map(row => row.name));
    const requiredColumns: Array<{ name: string; sqlType: string }> = [
      { name: "kind", sqlType: "TEXT" },
      { name: "entity_name", sqlType: "TEXT" },
      { name: "country_code", sqlType: "TEXT" },
      { name: "admin_state", sqlType: "TEXT" },
      { name: "admin_city", sqlType: "TEXT" },
      { name: "admin_suburb", sqlType: "TEXT" },
      { name: "avatar_source", sqlType: "TEXT" },
      { name: "avatar_image_url", sqlType: "TEXT" },
      { name: "gravatar_hash", sqlType: "TEXT" },
    ];

    for (const column of requiredColumns) {
      if (names.has(column.name)) {
        continue;
      }

      this.db.exec(`ALTER TABLE persisted_locations ADD COLUMN ${column.name} ${column.sqlType};`);
    }
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
        kind,
        entity_name,
        country_code,
        admin_state,
        admin_city,
        admin_suburb,
        avatar_source,
        avatar_image_url,
        gravatar_hash,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          location.kind ?? "location",
          location.entityName ?? null,
          location.countryCode ?? null,
          location.adminState ?? null,
          location.adminCity ?? null,
          location.adminSuburb ?? null,
          location.avatarSource ?? null,
          location.avatarImageUrl ?? null,
          location.gravatarHash ?? null,
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
            kind,
            entity_name,
            country_code,
            admin_state,
            admin_city,
            admin_suburb,
            avatar_source,
            avatar_image_url,
            gravatar_hash,
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
    const kind = normalizeKind(input.kind);
    const entityName = normalizeOptionalText(input.entityName);
    const countryCode = normalizeOptionalText(input.countryCode)?.toUpperCase();
    const adminState = normalizeOptionalText(input.adminState);
    const adminCity = normalizeOptionalText(input.adminCity);
    const adminSuburb = normalizeOptionalText(input.adminSuburb);
    const avatarSource = normalizeAvatarSource(input.avatarSource);
    const avatarImageUrl = normalizeOptionalText(input.avatarImageUrl);
    const gravatarHash = normalizeOptionalText(input.gravatarHash)?.toLowerCase();

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
      kind,
      entityName,
      countryCode,
      adminState,
      adminCity,
      adminSuburb,
      avatarSource,
      avatarImageUrl,
      gravatarHash,
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
            kind,
            entity_name,
            country_code,
            admin_state,
            admin_city,
            admin_suburb,
            avatar_source,
            avatar_image_url,
            gravatar_hash,
            created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        entry.kind ?? "location",
        entry.entityName ?? null,
        entry.countryCode ?? null,
        entry.adminState ?? null,
        entry.adminCity ?? null,
        entry.adminSuburb ?? null,
        entry.avatarSource ?? null,
        entry.avatarImageUrl ?? null,
        entry.gravatarHash ?? null,
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
            kind,
            entity_name,
            country_code,
            admin_state,
            admin_city,
            admin_suburb,
            avatar_source,
            avatar_image_url,
            gravatar_hash,
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
            kind,
            entity_name,
            country_code,
            admin_state,
            admin_city,
            admin_suburb,
            avatar_source,
            avatar_image_url,
            gravatar_hash,
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
    const next: PersistedLocation = {
      ...existing,
      nickname: patch.nickname === undefined ? existing.nickname : normalizeNickname(patch.nickname),
      timezone: patch.timezone === undefined ? existing.timezone : normalizeTimezone(patch.timezone),
      granularity: patch.granularity === undefined ? existing.granularity : normalizeGranularity(patch.granularity),
      kind: patch.kind === undefined ? existing.kind : normalizeKind(patch.kind),
      entityName: patch.entityName === undefined ? existing.entityName : normalizeOptionalText(patch.entityName),
      countryCode:
        patch.countryCode === undefined
          ? existing.countryCode
          : normalizeOptionalText(patch.countryCode)?.toUpperCase(),
      adminState: patch.adminState === undefined ? existing.adminState : normalizeOptionalText(patch.adminState),
      adminCity: patch.adminCity === undefined ? existing.adminCity : normalizeOptionalText(patch.adminCity),
      adminSuburb: patch.adminSuburb === undefined ? existing.adminSuburb : normalizeOptionalText(patch.adminSuburb),
      avatarSource:
        patch.avatarSource === undefined ? existing.avatarSource : normalizeAvatarSource(patch.avatarSource),
      avatarImageUrl:
        patch.avatarImageUrl === undefined ? existing.avatarImageUrl : normalizeOptionalText(patch.avatarImageUrl),
      gravatarHash:
        patch.gravatarHash === undefined
          ? existing.gravatarHash
          : normalizeOptionalText(patch.gravatarHash)?.toLowerCase(),
    };

    const updateSetters: string[] = [];
    const updateValues: Array<string | null> = [];
    const maybeSet = (column: string, patchValue: unknown, value: string | null) => {
      if (patchValue === undefined) {
        return;
      }

      updateSetters.push(`${column} = ?`);
      updateValues.push(value);
    };

    maybeSet("nickname", patch.nickname, next.nickname ?? null);
    maybeSet("timezone", patch.timezone, next.timezone ?? null);
    maybeSet("granularity", patch.granularity, next.granularity ?? null);
    maybeSet("kind", patch.kind, next.kind ?? null);
    maybeSet("entity_name", patch.entityName, next.entityName ?? null);
    maybeSet("country_code", patch.countryCode, next.countryCode ?? null);
    maybeSet("admin_state", patch.adminState, next.adminState ?? null);
    maybeSet("admin_city", patch.adminCity, next.adminCity ?? null);
    maybeSet("admin_suburb", patch.adminSuburb, next.adminSuburb ?? null);
    maybeSet("avatar_source", patch.avatarSource, next.avatarSource ?? null);
    maybeSet("avatar_image_url", patch.avatarImageUrl, next.avatarImageUrl ?? null);
    maybeSet("gravatar_hash", patch.gravatarHash, next.gravatarHash ?? null);

    if (updateSetters.length > 0) {
      this.db
        .prepare(`UPDATE persisted_locations SET ${updateSetters.join(", ")} WHERE id = ?`)
        .run(...updateValues, targetId);
    }

    return {
      ...next,
    };
  }
}
