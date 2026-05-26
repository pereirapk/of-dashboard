import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  enforceRateLimit,
  ensureRateLimitIndexes,
  RateLimitedError,
} from "@/lib/repositories/rate-limits";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("test");
}, 120000);

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("rate_limits").deleteMany({});
});

describe("rate_limits", () => {
  it("first call inserts a token and returns", async () => {
    await expect(enforceRateLimit(db, "sync:u1", 60)).resolves.toBeUndefined();
    const stored = await db.collection("rate_limits").findOne({ _id: "sync:u1" as unknown as never });
    expect(stored).not.toBeNull();
  });

  it("second call within window throws RateLimitedError with retry-after seconds", async () => {
    await enforceRateLimit(db, "sync:u2", 60);
    try {
      await enforceRateLimit(db, "sync:u2", 60);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedError);
      const e = err as RateLimitedError;
      expect(e.retryAfterSeconds).toBeGreaterThan(0);
      expect(e.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("different keys do not interfere", async () => {
    await enforceRateLimit(db, "sync:u3", 60);
    await expect(enforceRateLimit(db, "sync:u4", 60)).resolves.toBeUndefined();
  });

  it("ensureRateLimitIndexes creates a TTL index on expiresAt with expireAfterSeconds=0", async () => {
    await ensureRateLimitIndexes(db);
    const indexes = await db.collection("rate_limits").indexes();
    const ttl = indexes.find(
      (i) =>
        JSON.stringify(i.key) === JSON.stringify({ expiresAt: 1 }) &&
        i.expireAfterSeconds === 0
    );
    expect(ttl).toBeDefined();
  });
});
