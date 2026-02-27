const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;

export function normalizeCacheToken(token: string): string {
  return token
    .normalize("NFD")
    .replace(COMBINING_MARKS_REGEX, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUnknownPart(part: unknown): string {
  if (typeof part === "string") {
    return normalizeCacheToken(part);
  }

  if (typeof part === "number" || typeof part === "boolean") {
    return String(part);
  }

  if (part === null || part === undefined) {
    return "";
  }

  if (Array.isArray(part)) {
    return part.map(normalizeUnknownPart).join("|");
  }

  if (typeof part === "object") {
    const entries = Object.entries(part as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return entries.map(([key, value]) => `${normalizeCacheToken(key)}:${normalizeUnknownPart(value)}`).join("|");
  }

  return String(part);
}

export function createCacheKey(parts: unknown[]): string {
  return parts.map(normalizeUnknownPart).join("::");
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: this.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
