import type { Db, ObjectId } from "mongodb";

export interface SyncRunStats {
  transactionsFetched: number;
  transactionsNew: number;
  accountsUpdated: number;
  snapshotsWritten: number;
  mccCategorized: number;
  llmCategorized: number;
  errors: Array<{ tool: string; kind: string; message: string }>;
}

export interface SyncRunDoc {
  _id: ObjectId;
  userId: string;
  bankConnectionId: string;
  triggeredBy: "manual" | "cron";
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "success" | "partial" | "error";
  stats: SyncRunStats;
  errorMessage: string | null;
}

const COLLECTION = "sync_runs";

export const EMPTY_STATS: SyncRunStats = {
  transactionsFetched: 0,
  transactionsNew: 0,
  accountsUpdated: 0,
  snapshotsWritten: 0,
  mccCategorized: 0,
  llmCategorized: 0,
  errors: [],
};

export async function createSyncRun(
  db: Db,
  input: {
    userId: string;
    bankConnectionId: string;
    triggeredBy: "manual" | "cron";
  }
): Promise<ObjectId> {
  const doc = {
    userId: input.userId,
    bankConnectionId: input.bankConnectionId,
    triggeredBy: input.triggeredBy,
    startedAt: new Date(),
    finishedAt: null,
    status: "running" as const,
    stats: { ...EMPTY_STATS },
    errorMessage: null,
  };
  const result = await db
    .collection<SyncRunDoc>(COLLECTION)
    .insertOne(doc as unknown as SyncRunDoc);
  return result.insertedId;
}

export async function finishSyncRun(
  db: Db,
  id: ObjectId,
  status: SyncRunDoc["status"],
  stats: SyncRunStats,
  errorMessage: string | null
): Promise<void> {
  await db.collection<SyncRunDoc>(COLLECTION).updateOne(
    { _id: id },
    { $set: { finishedAt: new Date(), status, stats, errorMessage } }
  );
}

export async function findRecentByUser(
  db: Db,
  userId: string,
  limit = 10
): Promise<SyncRunDoc[]> {
  return db
    .collection<SyncRunDoc>(COLLECTION)
    .find({ userId })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function ensureSyncRunIndexes(db: Db): Promise<void> {
  await db
    .collection(COLLECTION)
    .createIndex({ userId: 1, startedAt: -1 });
}
