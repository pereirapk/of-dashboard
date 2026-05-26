import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MongoClient, type Db, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

vi.mock("@/lib/categorize/by-llm", () => ({
  categorizeByLlm: vi.fn(),
}));

import { dispatchCategorization } from "@/lib/categorize/dispatcher";
import { categorizeByLlm } from "@/lib/categorize/by-llm";
import type { TransactionDoc } from "@/lib/repositories/transactions";

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
  vi.mocked(categorizeByLlm).mockReset();
  await db.collection("transactions").deleteMany({});
});

async function seedTx(overrides: Partial<TransactionDoc> = {}): Promise<TransactionDoc> {
  const doc = {
    userId: "u1",
    bankAccountId: "a1",
    bankConnectionId: "c1",
    source: "credit_card",
    externalId: "ext-" + Math.random().toString(36).slice(2),
    amount: -1000,
    currency: "BRL",
    date: new Date(),
    postedDate: null,
    description: "TEST",
    counterpartyCnpjCpfHash: null,
    counterpartyCnpjCpfLast6: null,
    mcc: null,
    cardLast4: null,
    paymentType: null,
    chargeNumber: null,
    chargeIdentificator: null,
    billId: null,
    pixType: null,
    completedAuthorisedPaymentType: null,
    category: null,
    categorySource: null,
    categorizedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  const result = await db.collection("transactions").insertOne(doc as never);
  return { ...doc, _id: result.insertedId } as TransactionDoc;
}

describe("dispatchCategorization", () => {
  it("returns zeros when there are no uncategorized rows", async () => {
    const r = await dispatchCategorization(db, "u1");
    expect(r).toEqual({ mccCategorized: 0, llmCategorized: 0, remaining: 0 });
    expect(categorizeByLlm).not.toHaveBeenCalled();
  });

  it("Tier 1 (MCC) categorizes credit-card transactions with known MCCs", async () => {
    await seedTx({ mcc: 5411, source: "credit_card" });   // groceries
    await seedTx({ mcc: 5814, source: "credit_card" });   // restaurants
    await seedTx({ mcc: 9999, source: "credit_card" });   // unmapped → LLM tier

    vi.mocked(categorizeByLlm).mockResolvedValueOnce([]);  // LLM returns nothing
    const r = await dispatchCategorization(db, "u1");

    expect(r.mccCategorized).toBe(2);
    expect(r.llmCategorized).toBe(0);
    expect(r.remaining).toBe(1);

    const stored = await db.collection<TransactionDoc>("transactions")
      .find({ categorySource: "mcc" }).toArray();
    expect(stored).toHaveLength(2);
    for (const s of stored) {
      expect(["groceries", "restaurants"]).toContain(s.category);
      expect(s.categorizedAt).toBeInstanceOf(Date);
    }
  });

  it("Tier 2 (LLM) processes only transactions the MCC tier didn't cover", async () => {
    const groceriesTx = await seedTx({ mcc: 5411, source: "credit_card" });
    const accountTx = await seedTx({ mcc: null, source: "account", description: "PIX X" });

    vi.mocked(categorizeByLlm).mockImplementationOnce(async (uncat) => {
      // We expect ONLY the account tx (no MCC) to be passed to LLM.
      expect(uncat.map((t) => t._id.toString())).toEqual([accountTx._id.toString()]);
      return [
        {
          transactionId: accountTx._id.toString(),
          category: "transfers",
          source: "llm",
          confidence: 0.9,
        },
      ];
    });

    const r = await dispatchCategorization(db, "u1");
    expect(r.mccCategorized).toBe(1);
    expect(r.llmCategorized).toBe(1);
    expect(r.remaining).toBe(0);

    const updated = await db.collection<TransactionDoc>("transactions")
      .findOne({ _id: accountTx._id });
    expect(updated?.category).toBe("transfers");
    expect(updated?.categorySource).toBe("llm");

    // sanity: groceries tx still has mcc source
    const g = await db.collection<TransactionDoc>("transactions")
      .findOne({ _id: groceriesTx._id });
    expect(g?.categorySource).toBe("mcc");
  });

  it("skipLlm: true bypasses Tier 2 entirely", async () => {
    await seedTx({ mcc: 5411, source: "credit_card" });
    await seedTx({ mcc: null, source: "account", description: "PIX X" });

    const r = await dispatchCategorization(db, "u1", { skipLlm: true });
    expect(r.mccCategorized).toBe(1);
    expect(r.llmCategorized).toBe(0);
    expect(r.remaining).toBe(1);
    expect(categorizeByLlm).not.toHaveBeenCalled();
  });

  it("does not touch already-categorized transactions", async () => {
    const existing = await seedTx({
      mcc: 5411,
      source: "credit_card",
      category: "groceries",
      categorySource: "user",
      categorizedAt: new Date("2020-01-01"),
    });
    const r = await dispatchCategorization(db, "u1");
    expect(r.mccCategorized).toBe(0);

    const after = await db.collection<TransactionDoc>("transactions")
      .findOne({ _id: existing._id });
    expect(after?.categorySource).toBe("user");
    expect(after?.categorizedAt?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  it("fewShot is read from the user's recently categorized transactions", async () => {
    // Seed one already-categorized (gold data)
    const gold = await seedTx({
      category: "groceries",
      categorySource: "user",
      categorizedAt: new Date(),
      description: "OLD MERCADO",
    });
    // Seed one to categorize
    const newTx = await seedTx({ mcc: null, source: "account", description: "NEW PIX" });

    vi.mocked(categorizeByLlm).mockImplementationOnce(async (uncat, fewShot) => {
      expect(uncat).toHaveLength(1);
      expect(fewShot.some((t) => t._id.toString() === gold._id.toString())).toBe(true);
      return [{
        transactionId: newTx._id.toString(),
        category: "transfers",
        source: "llm",
        confidence: 0.9,
      }];
    });

    const r = await dispatchCategorization(db, "u1");
    expect(r.llmCategorized).toBe(1);
  });

  it("scopes by userId — does not touch other users' rows", async () => {
    await seedTx({ userId: "u2", mcc: 5411 });
    const r = await dispatchCategorization(db, "u1");
    expect(r).toEqual({ mccCategorized: 0, llmCategorized: 0, remaining: 0 });

    const u2 = await db.collection<TransactionDoc>("transactions")
      .findOne({ userId: "u2" });
    expect(u2?.category).toBeNull();
  });
});
