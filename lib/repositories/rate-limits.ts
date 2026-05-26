import type { Db } from "mongodb";

export class RateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited; retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
  }
}

interface RateLimitDoc {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
}

const COLLECTION = "rate_limits";

/**
 * Atomic single-token bucket. Throws RateLimitedError if a token already
 * exists for `key`. The token expires via TTL after `windowSeconds`.
 */
export async function enforceRateLimit(
  db: Db,
  key: string,
  windowSeconds: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
  try {
    await db.collection<RateLimitDoc>(COLLECTION).insertOne({
      _id: key,
      createdAt: now,
      expiresAt,
    } as RateLimitDoc);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await db
        .collection<RateLimitDoc>(COLLECTION)
        .findOne({ _id: key });
      const retryAfterMs = existing
        ? Math.max(0, existing.expiresAt.getTime() - now.getTime())
        : windowSeconds * 1000;
      throw new RateLimitedError(Math.ceil(retryAfterMs / 1000) || 1);
    }
    throw err;
  }
}

export async function ensureRateLimitIndexes(db: Db): Promise<void> {
  await db
    .collection(COLLECTION)
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
