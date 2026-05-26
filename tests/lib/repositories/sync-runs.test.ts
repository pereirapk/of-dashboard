import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  createSyncRun,
  finishSyncRun,
  findRecentByUser,
  ensureSyncRunIndexes,
  EMPTY_STATS,
  type SyncRunDoc,
} from "@/lib/repositories/sync-runs";

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
  await db.collection("sync_runs").deleteMany({});
});

describe("sync_runs repository", () => {
  it("createSyncRun starts a row in 'running' with empty stats", async () => {
    const id = await createSyncRun(db, {
      userId: "u1",
      bankConnectionId: "c1",
      triggeredBy: "manual",
    });
    const doc = await db.collection<SyncRunDoc>("sync_runs").findOne({ _id: id });
    expect(doc?.status).toBe("running");
    expect(doc?.finishedAt).toBeNull();
    expect(doc?.errorMessage).toBeNull();
    expect(doc?.stats).toEqual(EMPTY_STATS);
    expect(doc?.startedAt).toBeInstanceOf(Date);
  });

  it("finishSyncRun sets status, stats, errorMessage, finishedAt", async () => {
    const id = await createSyncRun(db, {
      userId: "u1",
      bankConnectionId: "c1",
      triggeredBy: "manual",
    });
    const stats = {
      ...EMPTY_STATS,
      transactionsFetched: 17,
      transactionsNew: 12,
      accountsUpdated: 1,
    };
    await finishSyncRun(db, id, "success", stats, null);
    const doc = await db.collection<SyncRunDoc>("sync_runs").findOne({ _id: id });
    expect(doc?.status).toBe("success");
    expect(doc?.stats.transactionsNew).toBe(12);
    expect(doc?.finishedAt).toBeInstanceOf(Date);
    expect(doc?.errorMessage).toBeNull();
  });

  it("finishSyncRun records errorMessage when status is error", async () => {
    const id = await createSyncRun(db, {
      userId: "u1",
      bankConnectionId: "c1",
      triggeredBy: "cron",
    });
    await finishSyncRun(db, id, "error", { ...EMPTY_STATS, errors: [{ tool: "x", kind: "transport", message: "boom" }] }, "boom");
    const doc = await db.collection<SyncRunDoc>("sync_runs").findOne({ _id: id });
    expect(doc?.status).toBe("error");
    expect(doc?.errorMessage).toBe("boom");
    expect(doc?.stats.errors).toHaveLength(1);
  });

  it("findRecentByUser returns most recent first", async () => {
    const ids: Array<{ id: import("mongodb").ObjectId; startedAt: Date }> = [];
    for (let i = 0; i < 3; i++) {
      const id = await createSyncRun(db, {
        userId: "u1",
        bankConnectionId: "c1",
        triggeredBy: "manual",
      });
      // Force distinct timestamps
      await db.collection("sync_runs").updateOne(
        { _id: id },
        { $set: { startedAt: new Date(2026, 0, i + 1) } }
      );
      ids.push({ id, startedAt: new Date(2026, 0, i + 1) });
    }
    const rows = await findRecentByUser(db, "u1", 5);
    expect(rows).toHaveLength(3);
    expect(rows[0].startedAt.getTime()).toBeGreaterThan(rows[1].startedAt.getTime());
    expect(rows[1].startedAt.getTime()).toBeGreaterThan(rows[2].startedAt.getTime());
  });

  it("findRecentByUser scopes by userId", async () => {
    await createSyncRun(db, { userId: "u1", bankConnectionId: "c1", triggeredBy: "manual" });
    await createSyncRun(db, { userId: "u2", bankConnectionId: "c2", triggeredBy: "manual" });
    const u1 = await findRecentByUser(db, "u1");
    expect(u1).toHaveLength(1);
    expect(u1[0].userId).toBe("u1");
  });

  it("ensureSyncRunIndexes is idempotent", async () => {
    await ensureSyncRunIndexes(db);
    await ensureSyncRunIndexes(db);
    const indexes = await db.collection("sync_runs").indexes();
    // _id_ + our compound
    expect(indexes.length).toBeGreaterThanOrEqual(2);
  });
});
