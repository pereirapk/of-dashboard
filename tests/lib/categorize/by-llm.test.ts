import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks must be declared at the top so they apply to the imports below.
const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create }; },
}));

import { categorizeByLlm } from "@/lib/categorize/by-llm";
import type { TransactionDoc } from "@/lib/repositories/transactions";

function mkTx(id: string, description: string, amount = -1000, mcc?: number): TransactionDoc {
  return {
    _id: { toHexString: () => id } as unknown as TransactionDoc["_id"],
    userId: "u1",
    bankAccountId: "a1",
    bankConnectionId: "c1",
    source: mcc ? "credit_card" : "account",
    externalId: id,
    amount,
    currency: "BRL",
    date: new Date("2026-05-21T10:00:00Z"),
    postedDate: null,
    description,
    counterpartyCnpjCpfHash: null,
    counterpartyCnpjCpfLast6: null,
    mcc: mcc ?? null,
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
  } as TransactionDoc;
}

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("categorizeByLlm", () => {
  it("returns [] when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await categorizeByLlm([mkTx("t1", "TEST")], []);
    expect(r).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("happy path: parses Claude's JSON reply into CategorizationResult[]", async () => {
    create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            categorizations: [
              { transactionId: "t1", category: "restaurants", confidence: 0.9 },
              { transactionId: "t2", category: "groceries", confidence: 0.8 },
            ],
          }),
        },
      ],
    });
    const r = await categorizeByLlm([mkTx("t1", "BURGER"), mkTx("t2", "MERCADO")], []);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ transactionId: "t1", category: "restaurants", source: "llm" });
  });

  it("filters out rows with confidence < 0.7", async () => {
    create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            categorizations: [
              { transactionId: "t1", category: "restaurants", confidence: 0.5 },
              { transactionId: "t2", category: "groceries", confidence: 0.9 },
            ],
          }),
        },
      ],
    });
    const r = await categorizeByLlm([mkTx("t1", "x"), mkTx("t2", "y")], []);
    expect(r).toHaveLength(1);
    expect(r[0].transactionId).toBe("t2");
  });

  it("filters out rows with unknown category slug", async () => {
    create.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            categorizations: [
              { transactionId: "t1", category: "nonexistent_slug", confidence: 0.95 },
              { transactionId: "t2", category: "groceries", confidence: 0.95 },
            ],
          }),
        },
      ],
    });
    const r = await categorizeByLlm([mkTx("t1", "x"), mkTx("t2", "y")], []);
    expect(r).toHaveLength(1);
    expect(r[0].transactionId).toBe("t2");
  });

  it("returns [] when SDK throws", async () => {
    create.mockRejectedValueOnce(new Error("network down"));
    const r = await categorizeByLlm([mkTx("t1", "x")], []);
    expect(r).toEqual([]);
  });

  it("returns [] when reply is malformed JSON", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json {" }],
    });
    const r = await categorizeByLlm([mkTx("t1", "x")], []);
    expect(r).toEqual([]);
  });

  it("splits inputs larger than batchSize into multiple calls", async () => {
    create
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({
          categorizations: [{ transactionId: "t1", category: "restaurants", confidence: 0.9 }],
        }) }],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({
          categorizations: [{ transactionId: "t2", category: "groceries", confidence: 0.9 }],
        }) }],
      });

    const r = await categorizeByLlm(
      [mkTx("t1", "x"), mkTx("t2", "y")],
      [],
      { batchSize: 1 }
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(r).toHaveLength(2);
  });

  it("uses fewShot to populate the cached user-context block", async () => {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ categorizations: [] }) }],
    });
    await categorizeByLlm(
      [mkTx("new1", "NEW")],
      [{ ...mkTx("old1", "PRIOR", -500), category: "groceries", categorySource: "user" }]
    );
    // Inspect the prompt to confirm few-shot is included
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    // The prompt should reference the prior transaction's description ("PRIOR")
    const promptText = JSON.stringify(call);
    expect(promptText).toContain("PRIOR");
    expect(promptText).toContain("groceries");
  });
});
