import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Coordinates } from "./types";

export interface PersistedLocation {
  id: string;
  name: string;
  coords: Coordinates;
  nickname?: string;
  createdAtMs: number;
}

export interface PersistLocationInput {
  name: string;
  coords: Coordinates;
  nickname?: string;
}

export interface PersistedLocationStoreLike {
  list(): Promise<PersistedLocation[]>;
  add(input: PersistLocationInput): Promise<PersistedLocation>;
  remove(id: string): Promise<PersistedLocation | null>;
}

interface PersistedStoreFile {
  version: 1;
  locations: PersistedLocation[];
}

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

function isPersistedLocation(value: unknown): value is PersistedLocation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedLocation>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    !!candidate.coords &&
    typeof candidate.coords.lat === "number" &&
    typeof candidate.coords.long === "number" &&
    typeof candidate.createdAtMs === "number"
  );
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

  private async readAll(): Promise<PersistedLocation[]> {
    if (!(await fileExists(this.filePath))) {
      return [];
    }

    const raw = await readFile(this.filePath, "utf8");
    if (!raw.trim()) {
      return [];
    }

    const parsed = JSON.parse(raw) as Partial<PersistedStoreFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.locations)) {
      return [];
    }

    return parsed.locations.filter(isPersistedLocation);
  }

  private async writeAll(locations: PersistedLocation[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });

    const payload: PersistedStoreFile = {
      version: 1,
      locations,
    };

    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  async list(): Promise<PersistedLocation[]> {
    const locations = await this.readAll();
    return [...locations].sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  async add(input: PersistLocationInput): Promise<PersistedLocation> {
    const name = normalizeName(input.name);
    const nickname = normalizeNickname(input.nickname);

    if (!Number.isFinite(input.coords.lat) || !Number.isFinite(input.coords.long)) {
      throw new Error("Coordinates must be finite numbers.");
    }

    const locations = await this.readAll();

    const entry: PersistedLocation = {
      id: crypto.randomUUID(),
      name,
      coords: {
        lat: input.coords.lat,
        long: input.coords.long,
      },
      nickname,
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

    const locations = await this.readAll();
    const index = locations.findIndex(location => location.id === targetId);
    if (index < 0) {
      return null;
    }

    const [removed] = locations.splice(index, 1);
    await this.writeAll(locations);
    return removed ?? null;
  }
}
