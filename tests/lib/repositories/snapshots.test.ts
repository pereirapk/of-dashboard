import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  upsertDailySnapshot,
  ensureSnapshotIndexes,
  toUtcMidnight,
  type BalanceSnapshotDoc,
} from "@/lib/repositories/snapshots";

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
  await db.collection("balance_snapshots").deleteMany({});
});

describe("balance_snapshots", () => {
  it("toUtcMidnight zeroes the time portion in UTC", () => {
    const d = new Date("2026-05-21T14:32:01.234Z");
    const m = toUtcMidnight(d);
    expect(m.toISOString()).toBe("2026-05-21T00:00:00.000Z");
  });

  it("upsertDailySnapshot inserts a row", async () => {
    await upsertDailySnapshot(db, {
      userId: "u1",
      bankAccountId: "a1",
      date: new Date("2026-05-21T14:00:00Z"),
      balance: 2757,
      components: { available: 100, blocked: 0, automaticallyInvested: 2657 },
    });
    const docs = await db.collection<BalanceSnapshotDoc>("balance_snapshots").find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].balance).toBe(2757);
    expect(docs[0].components.automaticallyInvested).toBe(2657);
    expect(docs[0].date.toISOString()).toBe("2026-05-21T00:00:00.000Z");
  });

  it("upsertDailySnapshot is idempotent and overwrites balance within the same UTC day", async () => {
    const ctx = {
      userId: "u1",
      bankAccountId: "a1",
      date: new Date("2026-05-21T09:00:00Z"),
      balance: 1000,
      components: { available: 1000, blocked: 0, automaticallyInvested: 0 },
    };
    await upsertDailySnapshot(db, ctx);
    await upsertDailySnapshot(db, {
      ...ctx,
      date: new Date("2026-05-21T18:00:00Z"),
      balance: 1500,
      components: { available: 1500, blocked: 0, automaticallyInvested: 0 },
    });
    const docs = await db.collection<BalanceSnapshotDoc>("balance_snapshots").find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].balance).toBe(1500);
  });

  it("different days produce different rows", async () => {
    await upsertDailySnapshot(db, {
      userId: "u1", bankAccountId: "a1",
      date: new Date("2026-05-20T12:00:00Z"),
      balance: 100, components: { available: 100, blocked: 0, automaticallyInvested: 0 },
    });
    await upsertDailySnapshot(db, {
      userId: "u1", bankAccountId: "a1",
      date: new Date("2026-05-21T12:00:00Z"),
      balance: 200, components: { available: 200, blocked: 0, automaticallyInvested: 0 },
    });
    const count = await db.collection("balance_snapshots").countDocuments({});
    expect(count).toBe(2);
  });

  it("ensureSnapshotIndexes creates the unique compound index", async () => {
    await ensureSnapshotIndexes(db);
    const indexes = await db.collection("balance_snapshots").indexes();
    const unique = indexes.find(
      (i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ userId: 1, bankAccountId: 1, date: 1 })
    );
    expect(unique).toBeDefined();
  });
});
