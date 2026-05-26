// lib/repositories/connections.ts
import { type Db, type ObjectId } from "mongodb";
import { encrypt } from "@/lib/crypto";

export interface UpsertConnectionInput {
  userId: string;
  institutionId: string;
  institutionDisplayName: string;
  status: "active" | "expired" | "revoked" | "error";
  consentExpiresAt: Date | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date;
}

export interface BankConnectionDoc {
  _id: ObjectId;
  userId: string;
  institutionId: string;
  institutionDisplayName: string;
  status: "active" | "expired" | "revoked" | "error";
  consentExpiresAt: Date | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  quotaUsage: Record<string, number | string>;
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION = "bank_connections";

export async function upsertBankConnection(
  db: Db,
  input: UpsertConnectionInput
): Promise<ObjectId> {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const setOnInsert: Partial<BankConnectionDoc> = {
    userId: input.userId,
    institutionId: input.institutionId,
    lastSyncAt: null,
    lastSyncStatus: null,
    quotaUsage: { month: monthKey },
    createdAt: now,
  };

  const set: Partial<BankConnectionDoc> = {
    institutionDisplayName: input.institutionDisplayName,
    status: input.status,
    consentExpiresAt: input.consentExpiresAt,
    encryptedAccessToken: encrypt(input.accessToken, "OPENFINANCE_TOKEN_KEY"),
    encryptedRefreshToken: input.refreshToken
      ? encrypt(input.refreshToken, "OPENFINANCE_TOKEN_KEY")
      : null,
    tokenExpiresAt: input.tokenExpiresAt,
    updatedAt: now,
  };

  const result = await db.collection<BankConnectionDoc>(COLLECTION).findOneAndUpdate(
    { userId: input.userId, institutionId: input.institutionId },
    { $set: set, $setOnInsert: setOnInsert },
    { upsert: true, returnDocument: "after" }
  );

  if (!result) {
    throw new Error("Upsert returned no document");
  }
  return result._id;
}

export async function findActiveConnectionsByUser(
  db: Db,
  userId: string
): Promise<BankConnectionDoc[]> {
  return db
    .collection<BankConnectionDoc>(COLLECTION)
    .find({ userId, status: "active" })
    .toArray();
}
