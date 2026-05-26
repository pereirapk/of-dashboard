import type { Db } from "mongodb";

export interface BalanceSnapshotDoc {
  userId: string;
  bankAccountId: string;
  date: Date;                                  // truncated to UTC midnight
  balance: number;                              // cents (sum of components)
  components: {
    available: number;
    blocked: number;
    automaticallyInvested: number;
  };
}

const COLLECTION = "balance_snapshots";

/** Truncate a Date to UTC midnight. */
export function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function upsertDailySnapshot(
  db: Db,
  input: {
    userId: string;
    bankAccountId: string;
    date: Date;
    balance: number;
    components: {
      available: number;
      blocked: number;
      automaticallyInvested: number;
    };
  }
): Promise<void> {
  const date = toUtcMidnight(input.date);
  await db.collection<BalanceSnapshotDoc>(COLLECTION).updateOne(
    { userId: input.userId, bankAccountId: input.bankAccountId, date },
    {
      $set: {
        balance: input.balance,
        components: input.components,
      },
      $setOnInsert: {
        userId: input.userId,
        bankAccountId: input.bankAccountId,
        date,
      },
    },
    { upsert: true }
  );
}

export async function ensureSnapshotIndexes(db: Db): Promise<void> {
  await db
    .collection(COLLECTION)
    .createIndex(
      { userId: 1, bankAccountId: 1, date: 1 },
      { unique: true }
    );
}
