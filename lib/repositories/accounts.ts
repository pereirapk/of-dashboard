import type { Db, ObjectId } from "mongodb";
import { parseMcpAmountToCents } from "@/lib/format/money";
import type {
  AccountSummary,
  AccountDetail,
  AccountBalance,
  CreditCard,
} from "@/lib/mcp/types";

export interface BankAccountDoc {
  _id: ObjectId;
  userId: string;
  bankConnectionId: string;
  externalId: string; // accountId OR creditCardAccountId
  kind: "account" | "credit_card";
  type: string; // raw MCP type field
  subtype: string | null; // INDIVIDUAL | JOINT | null
  institutionName: string;
  displayName: string;
  branchCode: string | null;
  number: string | null;
  checkDigit: string | null;
  compeCode: string | null;
  companyCnpj: string;
  creditCardNetwork: string | null;
  productType: string | null;
  balanceComponents: {
    available: number;
    blocked: number;
    automaticallyInvested: number;
  } | null;
  currentBalance: number | null; // cents — sum of components
  currency: "BRL";
  balanceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION = "bank_accounts";

export async function upsertAccountFromMcp(
  db: Db,
  input: { userId: string; bankConnectionId: string; account: AccountSummary }
): Promise<ObjectId> {
  const now = new Date();
  const a = input.account;

  const setOnInsert = {
    userId: input.userId,
    bankConnectionId: input.bankConnectionId,
    externalId: a.accountId,
    kind: "account" as const,
    createdAt: now,
    balanceComponents: null,
    currentBalance: null,
    balanceUpdatedAt: null,
    creditCardNetwork: null,
    productType: null,
  };

  const set = {
    type: a.type,
    institutionName: a.brandName,
    displayName: `${a.brandName.toUpperCase()} ${a.number}`,
    branchCode: a.branchCode,
    number: a.number,
    checkDigit: a.checkDigit,
    compeCode: a.compeCode,
    companyCnpj: a.companyCnpj,
    subtype: null,
    currency: "BRL" as const,
    updatedAt: now,
  };

  const result = await db.collection<BankAccountDoc>(COLLECTION).findOneAndUpdate(
    { bankConnectionId: input.bankConnectionId, externalId: a.accountId },
    { $set: set, $setOnInsert: setOnInsert },
    { upsert: true, returnDocument: "after" }
  );
  if (!result) throw new Error("upsertAccountFromMcp: upsert returned no document");
  return result._id;
}

export async function updateAccountBalance(
  db: Db,
  accountId: ObjectId,
  detail: { account: AccountDetail; balance: AccountBalance }
): Promise<{ available: number; blocked: number; automaticallyInvested: number; total: number }> {
  const available = parseMcpAmountToCents(detail.balance.availableAmount.amount);
  const blocked = parseMcpAmountToCents(detail.balance.blockedAmount.amount);
  const automaticallyInvested = parseMcpAmountToCents(
    detail.balance.automaticallyInvestedAmount.amount
  );
  const total = available + blocked + automaticallyInvested;

  await db.collection<BankAccountDoc>(COLLECTION).updateOne(
    { _id: accountId },
    {
      $set: {
        balanceComponents: { available, blocked, automaticallyInvested },
        currentBalance: total,
        balanceUpdatedAt: new Date(detail.balance.updateDateTime),
        subtype: detail.account.subtype ?? null,
        updatedAt: new Date(),
      },
    }
  );

  return { available, blocked, automaticallyInvested, total };
}

export async function upsertCreditCardFromMcp(
  db: Db,
  input: { userId: string; bankConnectionId: string; card: CreditCard }
): Promise<ObjectId> {
  const now = new Date();
  const c = input.card;

  const setOnInsert = {
    userId: input.userId,
    bankConnectionId: input.bankConnectionId,
    externalId: c.creditCardAccountId,
    kind: "credit_card" as const,
    createdAt: now,
    balanceComponents: null,
    currentBalance: null,
    balanceUpdatedAt: null,
    branchCode: null,
    number: null,
    checkDigit: null,
    compeCode: null,
    subtype: null,
  };

  const set = {
    type: c.productType,
    institutionName: c.brandName,
    displayName: c.name,
    companyCnpj: c.companyCnpj,
    creditCardNetwork: c.creditCardNetwork,
    productType: c.productType,
    currency: "BRL" as const,
    updatedAt: now,
  };

  const result = await db.collection<BankAccountDoc>(COLLECTION).findOneAndUpdate(
    { bankConnectionId: input.bankConnectionId, externalId: c.creditCardAccountId },
    { $set: set, $setOnInsert: setOnInsert },
    { upsert: true, returnDocument: "after" }
  );
  if (!result) throw new Error("upsertCreditCardFromMcp: upsert returned no document");
  return result._id;
}

export async function findAccountsByUser(db: Db, userId: string): Promise<BankAccountDoc[]> {
  return db.collection<BankAccountDoc>(COLLECTION).find({ userId }).toArray();
}

export async function findAccountByExternalId(
  db: Db,
  bankConnectionId: string,
  externalId: string
): Promise<BankAccountDoc | null> {
  return db
    .collection<BankAccountDoc>(COLLECTION)
    .findOne({ bankConnectionId, externalId });
}

export async function ensureBankAccountIndexes(db: Db): Promise<void> {
  const col = db.collection(COLLECTION);
  await Promise.all([
    col.createIndex({ userId: 1 }),
    col.createIndex({ userId: 1, bankConnectionId: 1 }),
    col.createIndex({ bankConnectionId: 1, externalId: 1 }, { unique: true }),
  ]);
}
