import type { Db, ObjectId } from "mongodb";
import { parseMcpAmountToCents } from "@/lib/format/money";
import { hashWithPepper } from "@/lib/crypto";
import type {
  AccountTransaction,
  CreditCardTransaction,
} from "@/lib/mcp/types";

export interface TransactionDoc {
  _id: ObjectId;
  userId: string;
  bankAccountId: string;
  bankConnectionId: string;
  source: "account" | "credit_card";
  externalId: string;
  amount: number;                       // signed cents
  currency: "BRL";
  date: Date;
  postedDate: Date | null;
  description: string;
  counterpartyCnpjCpfHash: string | null;
  counterpartyCnpjCpfLast6: string | null;
  mcc: number | null;
  cardLast4: string | null;
  paymentType: "A_VISTA" | "A_PRAZO" | null;
  chargeNumber: number | null;
  chargeIdentificator: number | null;
  billId: string | null;
  pixType: string | null;
  completedAuthorisedPaymentType: string | null;
  category: string | null;
  categorySource: "mcc" | "llm" | "user" | null;
  categorizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION = "transactions";

export interface BulkUpsertResult {
  fetched: number;
  inserted: number;
  updated: number;
}

function signFromCreditDebit(type: "DEBITO" | "CREDITO", absCents: number): number {
  return type === "DEBITO" ? -absCents : absCents;
}

function buildAccountTxDoc(
  ctx: { userId: string; bankAccountId: string; bankConnectionId: string },
  tx: AccountTransaction,
  now: Date
): Omit<TransactionDoc, "_id"> {
  const abs = parseMcpAmountToCents(tx.transactionAmount.amount);
  const amount = signFromCreditDebit(tx.creditDebitType, abs);
  return {
    userId: ctx.userId,
    bankAccountId: ctx.bankAccountId,
    bankConnectionId: ctx.bankConnectionId,
    source: "account",
    externalId: tx.transactionId,
    amount,
    currency: "BRL",
    date: new Date(tx.transactionDateTime),
    postedDate: null,
    description: tx.transactionName,
    counterpartyCnpjCpfHash: tx.partieCnpjCpf
      ? hashWithPepper(tx.partieCnpjCpf, "COUNTERPARTY_HASH_PEPPER")
      : null,
    counterpartyCnpjCpfLast6: tx.partieCnpjCpf ? tx.partieCnpjCpf.slice(-6) : null,
    mcc: null,
    cardLast4: null,
    paymentType: null,
    chargeNumber: null,
    chargeIdentificator: null,
    billId: null,
    pixType: tx.type,
    completedAuthorisedPaymentType: tx.completedAuthorisedPaymentType,
    category: null,
    categorySource: null,
    categorizedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildCreditCardTxDoc(
  ctx: { userId: string; bankAccountId: string; bankConnectionId: string },
  tx: CreditCardTransaction,
  now: Date
): Omit<TransactionDoc, "_id"> {
  const abs = parseMcpAmountToCents(tx.amount.amount);
  const amount = signFromCreditDebit(tx.creditDebitType, abs);
  return {
    userId: ctx.userId,
    bankAccountId: ctx.bankAccountId,
    bankConnectionId: ctx.bankConnectionId,
    source: "credit_card",
    externalId: tx.transactionId,
    amount,
    currency: "BRL",
    date: new Date(tx.transactionDateTime),
    postedDate: new Date(tx.billPostDate),
    description: tx.transactionName,
    counterpartyCnpjCpfHash: null,
    counterpartyCnpjCpfLast6: null,
    mcc: tx.payeeMCC ?? null,
    cardLast4: tx.identificationNumber,
    paymentType: tx.paymentType as "A_VISTA" | "A_PRAZO" | null,
    chargeNumber: tx.chargeNumber ?? null,
    chargeIdentificator: tx.chargeIdentificator ?? null,
    billId: tx.billId,
    pixType: null,
    completedAuthorisedPaymentType: null,
    category: null,
    categorySource: null,
    categorizedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function bulkUpsert(
  db: Db,
  docs: Array<Omit<TransactionDoc, "_id">>
): Promise<BulkUpsertResult> {
  if (docs.length === 0) {
    return { fetched: 0, inserted: 0, updated: 0 };
  }
  const ops = docs.map((doc) => ({
    updateOne: {
      filter: { bankAccountId: doc.bankAccountId, externalId: doc.externalId },
      update: {
        $setOnInsert: { createdAt: doc.createdAt },
        $set: { ...doc, createdAt: undefined, updatedAt: doc.updatedAt },
      },
      upsert: true,
    },
  }));
  // Remove `createdAt: undefined` from $set (Mongo treats undefined as a value)
  for (const op of ops) {
    delete (op.updateOne.update.$set as Record<string, unknown>).createdAt;
  }
  const result = await db
    .collection<TransactionDoc>(COLLECTION)
    .bulkWrite(ops, { ordered: false });
  return {
    fetched: docs.length,
    inserted: result.upsertedCount ?? 0,
    updated: result.modifiedCount ?? 0,
  };
}

export async function bulkUpsertAccountTransactions(
  db: Db,
  ctx: { userId: string; bankAccountId: string; bankConnectionId: string },
  list: { transactions: AccountTransaction[] }
): Promise<BulkUpsertResult> {
  const now = new Date();
  const docs = list.transactions.map((t) => buildAccountTxDoc(ctx, t, now));
  return bulkUpsert(db, docs);
}

export async function bulkUpsertCreditCardTransactions(
  db: Db,
  ctx: { userId: string; bankAccountId: string; bankConnectionId: string },
  list: { transactions: CreditCardTransaction[] }
): Promise<BulkUpsertResult> {
  const now = new Date();
  const docs = list.transactions.map((t) => buildCreditCardTxDoc(ctx, t, now));
  return bulkUpsert(db, docs);
}

export async function findRecentTransactionsByUser(
  db: Db,
  userId: string,
  limit = 50
): Promise<TransactionDoc[]> {
  return db
    .collection<TransactionDoc>(COLLECTION)
    .find({ userId })
    .sort({ date: -1 })
    .limit(limit)
    .toArray();
}

export interface TransactionFilter {
  userId: string;
  from?: Date;           // inclusive
  to?: Date;             // exclusive
  category?: string | null;       // exact slug; null = uncategorized; undefined = no filter
  bankAccountId?: string;
  source?: "account" | "credit_card";
  q?: string;            // contains-match against description (case-insensitive)
}

export interface PaginatedTransactions {
  rows: TransactionDoc[];
  total: number;
  page: number;        // 1-based
  pageSize: number;
  totalPages: number;
}

function buildFilterQuery(filter: TransactionFilter): Record<string, unknown> {
  const q: Record<string, unknown> = { userId: filter.userId };
  if (filter.from || filter.to) {
    const range: Record<string, Date> = {};
    if (filter.from) range.$gte = filter.from;
    if (filter.to) range.$lt = filter.to;
    q.date = range;
  }
  if (filter.category !== undefined) {
    q.category = filter.category;
  }
  if (filter.bankAccountId) q.bankAccountId = filter.bankAccountId;
  if (filter.source) q.source = filter.source;
  if (filter.q && filter.q.trim()) {
    const escaped = filter.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q.description = { $regex: escaped, $options: "i" };
  }
  return q;
}

export async function findFilteredTransactionsByUser(
  db: Db,
  filter: TransactionFilter,
  page: number = 1,
  pageSize: number = 50
): Promise<PaginatedTransactions> {
  const query = buildFilterQuery(filter);
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(200, Math.floor(pageSize)));
  const [rows, total] = await Promise.all([
    db
      .collection<TransactionDoc>(COLLECTION)
      .find(query)
      .sort({ date: -1 })
      .skip((safePage - 1) * safeSize)
      .limit(safeSize)
      .toArray(),
    db.collection<TransactionDoc>(COLLECTION).countDocuments(query),
  ]);
  return {
    rows,
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export async function ensureTransactionIndexes(db: Db): Promise<void> {
  const col = db.collection(COLLECTION);
  await Promise.all([
    col.createIndex({ userId: 1, date: -1 }),
    col.createIndex({ userId: 1, category: 1, date: -1 }),
    col.createIndex({ userId: 1, bankAccountId: 1, date: -1 }),
    col.createIndex({ userId: 1, source: 1, date: -1 }),
    col.createIndex(
      { bankAccountId: 1, externalId: 1 },
      { unique: true }
    ),
  ]);
}
