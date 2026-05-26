import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bulkUpsertAccountTransactions,
  bulkUpsertCreditCardTransactions,
  findRecentTransactionsByUser,
  ensureTransactionIndexes,
  type TransactionDoc,
} from "@/lib/repositories/transactions";
import {
  ListAccountTransactionsResponse,
  ListCreditCardBillTransactionsResponse,
} from "@/lib/mcp/tools";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  process.env.COUNTERPARTY_HASH_PEPPER = "test-pepper-counterparty";
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
  await db.collection("transactions").deleteMany({});
});

async function loadFixture(name: string): Promise<unknown> {
  const path = resolve(process.cwd(), "tests/mcp/fixtures", `${name}.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

describe("transactions repository — account", () => {
  it("bulk upsert applies sign normalization (DEBITO→negative, CREDITO→positive)", async () => {
    const data = ListAccountTransactionsResponse.parse(
      await loadFixture("list-account-transactions")
    );
    const r = await bulkUpsertAccountTransactions(
      db,
      { userId: "u1", bankAccountId: "a1", bankConnectionId: "c1" },
      data
    );
    expect(r.fetched).toBe(3);
    expect(r.inserted).toBe(3);
    expect(r.updated).toBe(0);

    const debito = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-txn-uuid-1" });
    expect(debito?.amount).toBe(-10000);          // 100.00 DEBITO
    expect(debito?.source).toBe("account");
    expect(debito?.pixType).toBe("PIX");

    const credito = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-txn-uuid-2" });
    expect(credito?.amount).toBe(250000);         // 2500.00 CREDITO
  });

  it("hashes the counterparty CNPJ/CPF and stores last 6", async () => {
    const data = ListAccountTransactionsResponse.parse(
      await loadFixture("list-account-transactions")
    );
    await bulkUpsertAccountTransactions(
      db,
      { userId: "u1", bankAccountId: "a1", bankConnectionId: "c1" },
      data
    );
    const tx = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-txn-uuid-1" });
    expect(tx?.counterpartyCnpjCpfHash).toHaveLength(64);          // SHA-256 hex
    expect(tx?.counterpartyCnpjCpfHash).not.toContain("0000");     // no raw CNPJ
    expect(tx?.counterpartyCnpjCpfLast6).toBe("000000");           // last 6 of "00000000000000"
  });

  it("preserves null counterparty when transaction has no partieCnpjCpf", async () => {
    const data = ListAccountTransactionsResponse.parse(
      await loadFixture("list-account-transactions")
    );
    await bulkUpsertAccountTransactions(
      db,
      { userId: "u1", bankAccountId: "a1", bankConnectionId: "c1" },
      data
    );
    // Third fixture txn has no partieCnpjCpf
    const tx = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-txn-uuid-3" });
    expect(tx?.counterpartyCnpjCpfHash).toBeNull();
    expect(tx?.counterpartyCnpjCpfLast6).toBeNull();
  });

  it("idempotent — running twice keeps count the same", async () => {
    const data = ListAccountTransactionsResponse.parse(
      await loadFixture("list-account-transactions")
    );
    await bulkUpsertAccountTransactions(db, { userId: "u1", bankAccountId: "a1", bankConnectionId: "c1" }, data);
    await bulkUpsertAccountTransactions(db, { userId: "u1", bankAccountId: "a1", bankConnectionId: "c1" }, data);
    const count = await db.collection("transactions").countDocuments({});
    expect(count).toBe(3);
  });
});

describe("transactions repository — credit_card", () => {
  it("preserves mcc, cardLast4, paymentType, chargeNumber, chargeIdentificator, billId", async () => {
    const data = ListCreditCardBillTransactionsResponse.parse(
      await loadFixture("list-credit-card-bill-transactions")
    );
    await ensureTransactionIndexes(db);
    const r = await bulkUpsertCreditCardTransactions(
      db,
      { userId: "u1", bankAccountId: "cc1", bankConnectionId: "c1" },
      data
    );
    expect(r.fetched).toBe(3);

    const aVista = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-cc-txn-1" });
    expect(aVista?.source).toBe("credit_card");
    expect(aVista?.mcc).toBe(5411);
    expect(aVista?.paymentType).toBe("A_VISTA");
    expect(aVista?.cardLast4).toBe("1234");
    expect(aVista?.chargeNumber).toBeNull();
    expect(aVista?.billId).toBe("20240115");

    const installment = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-cc-txn-2" });
    expect(installment?.paymentType).toBe("A_PRAZO");
    expect(installment?.chargeNumber).toBe(3);
    expect(installment?.chargeIdentificator).toBe(2);

    const refund = await db
      .collection<TransactionDoc>("transactions")
      .findOne({ externalId: "fixture-cc-txn-3" });
    expect(refund?.amount).toBeGreaterThan(0);   // CREDITO → positive
  });
});

describe("findRecentTransactionsByUser", () => {
  it("orders by date desc and scopes by userId", async () => {
    const data = ListAccountTransactionsResponse.parse(
      await loadFixture("list-account-transactions")
    );
    await bulkUpsertAccountTransactions(db, { userId: "u1", bankAccountId: "a1", bankConnectionId: "c1" }, data);
    await bulkUpsertAccountTransactions(db, { userId: "u2", bankAccountId: "a2", bankConnectionId: "c2" }, data);

    const u1 = await findRecentTransactionsByUser(db, "u1", 10);
    expect(u1).toHaveLength(3);
    expect(u1[0].date.getTime()).toBeGreaterThanOrEqual(u1[1].date.getTime());
    expect(u1[1].date.getTime()).toBeGreaterThanOrEqual(u1[2].date.getTime());
    expect(u1.every((t) => t.userId === "u1")).toBe(true);
  });
});

describe("ensureTransactionIndexes", () => {
  it("creates unique compound + query indexes", async () => {
    await ensureTransactionIndexes(db);
    const indexes = await db.collection("transactions").indexes();
    const unique = indexes.find(
      (i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ bankAccountId: 1, externalId: 1 })
    );
    expect(unique).toBeDefined();
  });
});
