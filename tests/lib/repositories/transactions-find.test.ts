import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  findFilteredTransactionsByUser,
  type TransactionDoc,
} from "@/lib/repositories/transactions";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  process.env.COUNTERPARTY_HASH_PEPPER = "test-pepper";
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

async function seedTx(input: Partial<TransactionDoc>) {
  await db.collection("transactions").insertOne({
    userId: input.userId ?? "u1",
    bankAccountId: input.bankAccountId ?? "acc-1",
    bankConnectionId: input.bankConnectionId ?? "conn-1",
    source: input.source ?? "account",
    externalId: input.externalId ?? "ext-" + Math.random(),
    amount: input.amount ?? -1000,
    currency: "BRL",
    date: input.date ?? new Date(),
    postedDate: input.postedDate ?? null,
    description: input.description ?? "TEST",
    counterpartyCnpjCpfHash: null,
    counterpartyCnpjCpfLast6: null,
    mcc: input.mcc ?? null,
    cardLast4: input.cardLast4 ?? null,
    paymentType: input.paymentType ?? null,
    chargeNumber: null,
    chargeIdentificator: null,
    billId: input.billId ?? null,
    pixType: input.pixType ?? null,
    completedAuthorisedPaymentType: null,
    category: input.category ?? null,
    categorySource: input.categorySource ?? null,
    categorizedAt: input.categorizedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

describe("findFilteredTransactionsByUser", () => {
  it("returns paginated results, newest first, scoped by userId", async () => {
    for (let i = 0; i < 30; i++) {
      await seedTx({
        userId: "u1",
        date: new Date(2026, 4, i + 1),
        description: `tx${i}`,
      });
    }
    await seedTx({ userId: "u2", description: "OTHER" });

    const page1 = await findFilteredTransactionsByUser(db, { userId: "u1" }, 1, 10);
    expect(page1.rows).toHaveLength(10);
    expect(page1.total).toBe(30);
    expect(page1.totalPages).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.rows[0].description).toBe("tx29"); // newest first

    const page2 = await findFilteredTransactionsByUser(db, { userId: "u1" }, 2, 10);
    expect(page2.rows).toHaveLength(10);
    expect(page2.rows[0].description).toBe("tx19");

    // u2's rows never appear
    expect(page1.rows.every((r) => r.userId === "u1")).toBe(true);
  });

  it("filters by date range (from inclusive, to exclusive)", async () => {
    await seedTx({ date: new Date("2026-04-30"), description: "before" });
    await seedTx({ date: new Date("2026-05-01"), description: "first-of-may" });
    await seedTx({ date: new Date("2026-05-31"), description: "last-of-may" });
    await seedTx({ date: new Date("2026-06-01"), description: "after" });

    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      from: new Date("2026-05-01"),
      to: new Date("2026-06-01"),
    });
    expect(r.total).toBe(2);
    const descs = r.rows.map((r) => r.description).sort();
    expect(descs).toEqual(["first-of-may", "last-of-may"]);
  });

  it("filters by category slug", async () => {
    await seedTx({ category: "groceries" });
    await seedTx({ category: "restaurants" });
    await seedTx({ category: null });

    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      category: "groceries",
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].category).toBe("groceries");
  });

  it("filters by category=null (uncategorized) distinct from omitting category", async () => {
    await seedTx({ category: "groceries" });
    await seedTx({ category: null });

    const onlyNull = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      category: null,
    });
    expect(onlyNull.total).toBe(1);
    expect(onlyNull.rows[0].category).toBeNull();

    const all = await findFilteredTransactionsByUser(db, { userId: "u1" });
    expect(all.total).toBe(2);
  });

  it("filters by bankAccountId", async () => {
    await seedTx({ bankAccountId: "acc-a" });
    await seedTx({ bankAccountId: "acc-b" });
    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      bankAccountId: "acc-a",
    });
    expect(r.total).toBe(1);
  });

  it("filters by source", async () => {
    await seedTx({ source: "account" });
    await seedTx({ source: "credit_card" });
    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      source: "credit_card",
    });
    expect(r.total).toBe(1);
  });

  it("filters by `q` (case-insensitive contains match on description)", async () => {
    await seedTx({ description: "AMAZON BR" });
    await seedTx({ description: "amazonprimebr" });
    await seedTx({ description: "SUPERMERC BOTELHO" });
    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      q: "amazon",
    });
    expect(r.total).toBe(2);
  });

  it("escapes regex special characters in `q`", async () => {
    await seedTx({ description: "FOO.BAR" });
    await seedTx({ description: "FOOXBAR" });
    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      q: "foo.bar",
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].description).toBe("FOO.BAR");
  });

  it("composes multiple filters with AND semantics", async () => {
    await seedTx({
      source: "credit_card",
      category: "groceries",
      date: new Date("2026-05-15"),
      description: "MERCADO",
    });
    await seedTx({
      source: "account",
      category: "groceries",
      date: new Date("2026-05-15"),
      description: "MERCADO PIX",
    });
    await seedTx({
      source: "credit_card",
      category: "restaurants",
      date: new Date("2026-05-15"),
      description: "MERCADO BURGER",
    });

    const r = await findFilteredTransactionsByUser(db, {
      userId: "u1",
      source: "credit_card",
      category: "groceries",
      from: new Date("2026-05-01"),
      to: new Date("2026-06-01"),
      q: "mercado",
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].description).toBe("MERCADO");
  });

  it("pageSize is clamped (>=1, <=200)", async () => {
    for (let i = 0; i < 5; i++) await seedTx({ description: `t${i}` });
    const tooBig = await findFilteredTransactionsByUser(db, { userId: "u1" }, 1, 9999);
    expect(tooBig.pageSize).toBe(200);
    const tooSmall = await findFilteredTransactionsByUser(db, { userId: "u1" }, 1, 0);
    expect(tooSmall.pageSize).toBe(1);
  });
});
