import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MongoClient, type Db, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

vi.mock("@/lib/mcp/client", () => ({
  callMcpTool: vi.fn(),
}));

vi.mock("@/lib/categorize/dispatcher", () => ({
  dispatchCategorization: vi.fn(),
}));

import { callMcpTool } from "@/lib/mcp/client";
import { dispatchCategorization } from "@/lib/categorize/dispatcher";
import { McpError } from "@/lib/mcp/errors";
import { runSync } from "@/lib/sync/runner";
import type { BankConnectionDoc } from "@/lib/repositories/connections";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let conn: BankConnectionDoc;

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
  vi.mocked(callMcpTool).mockReset();
  vi.mocked(dispatchCategorization).mockReset();
  vi.mocked(dispatchCategorization).mockResolvedValue({
    mccCategorized: 0,
    llmCategorized: 0,
    remaining: 0,
  });
  for (const c of [
    "bank_connections", "bank_accounts", "transactions",
    "balance_snapshots", "sync_runs", "mcp_call_logs",
  ]) {
    await db.collection(c).deleteMany({});
  }
  const inserted = await db.collection("bank_connections").insertOne({
    userId: "u1",
    institutionId: "itau",
    institutionDisplayName: "Itaú",
    status: "active",
    quotaUsage: {},
    consentExpiresAt: null,
    encryptedAccessToken: "x",
    encryptedRefreshToken: null,
    tokenExpiresAt: new Date(),
    lastSyncAt: null,
    lastSyncStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  conn = {
    _id: inserted.insertedId,
    userId: "u1",
    institutionId: "itau",
    institutionDisplayName: "Itaú",
    status: "active",
    consentExpiresAt: null,
    encryptedAccessToken: "x",
    encryptedRefreshToken: null,
    tokenExpiresAt: new Date(),
    lastSyncAt: null,
    lastSyncStatus: null,
    quotaUsage: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});

// Helper to setup mock responses keyed by tool name.
function mockTools(responses: Record<string, unknown | ((args: unknown) => unknown)>) {
  vi.mocked(callMcpTool).mockImplementation(async (_ctx, tool, args) => {
    const r = responses[tool];
    if (r === undefined) {
      throw new McpError(`No mock for tool ${tool}`, "mcp_tool_error");
    }
    if (typeof r === "function") {
      return (r as (a: unknown) => unknown)(args) as never;
    }
    return r as never;
  });
}

describe("runSync — happy path", () => {
  it("upserts accounts, snapshots, and transactions; closes sync_run as success", async () => {
    mockTools({
      list_accounts: {
        accounts: [
          {
            accountId: "ext-acc-1",
            branchCode: "0001",
            brandName: "itau",
            checkDigit: "0",
            companyCnpj: "60701190000104",
            compeCode: "341",
            number: "00000000",
            type: "CONTA_DEPOSITO_A_VISTA",
          },
        ],
      },
      get_account: {
        account: {
          branchCode: "0001",
          checkDigit: "0",
          compeCode: "341",
          currency: "BRL",
          number: "00000000",
          subtype: "INDIVIDUAL",
          type: "CONTA_DEPOSITO_A_VISTA",
        },
        balance: {
          automaticallyInvestedAmount: { amount: "100.00", currency: "BRL" },
          availableAmount: { amount: "200.00", currency: "BRL" },
          blockedAmount: { amount: "0.00", currency: "BRL" },
          updateDateTime: "2026-05-21T12:00:00Z",
        },
      },
      list_account_transactions: {
        transactions: [
          {
            completedAuthorisedPaymentType: "TRANSACAO_EFETIVADA",
            creditDebitType: "DEBITO",
            transactionAmount: { amount: "50.00", currency: "BRL" },
            transactionDateTime: "2026-05-20T10:00:00.000Z",
            transactionId: "tx-1",
            transactionName: "PIX TEST",
            type: "PIX",
          },
        ],
      },
      list_credit_cards: { credit_cards: [] },
    });

    const result = await runSync(db, conn, "fake-token", { triggeredBy: "manual" });

    expect(result.status).toBe("success");
    expect(result.stats.accountsUpdated).toBe(1);
    expect(result.stats.snapshotsWritten).toBe(1);
    expect(result.stats.transactionsFetched).toBe(1);
    expect(result.stats.transactionsNew).toBe(1);

    const accCount = await db.collection("bank_accounts").countDocuments({});
    expect(accCount).toBe(1);

    const snapCount = await db.collection("balance_snapshots").countDocuments({});
    expect(snapCount).toBe(1);

    const txCount = await db.collection("transactions").countDocuments({});
    expect(txCount).toBe(1);

    const updatedConn = await db.collection("bank_connections").findOne({ _id: conn._id });
    expect(updatedConn?.lastSyncAt).toBeInstanceOf(Date);
    expect(updatedConn?.lastSyncStatus).toBe("success");
  });
});

describe("runSync — partial failure", () => {
  it("continues after a tool error and reports status=partial", async () => {
    mockTools({
      list_accounts: {
        accounts: [
          {
            accountId: "ext-acc-1",
            branchCode: "0001",
            brandName: "itau",
            checkDigit: "0",
            companyCnpj: "60701190000104",
            compeCode: "341",
            number: "00000000",
            type: "CONTA_DEPOSITO_A_VISTA",
          },
        ],
      },
      get_account: () => {
        throw new McpError("balance lookup failed", "mcp_tool_error");
      },
      list_account_transactions: { transactions: [] },
      list_credit_cards: { credit_cards: [] },
    });

    const result = await runSync(db, conn, "fake-token", { triggeredBy: "manual" });
    expect(result.status).toBe("partial");
    expect(result.stats.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.accountsUpdated).toBe(1);
  });
});

describe("runSync — complete failure", () => {
  it("returns status=error when nothing succeeds", async () => {
    vi.mocked(callMcpTool).mockImplementation(async () => {
      throw new McpError("everything broke", "transport");
    });
    const result = await runSync(db, conn, "fake-token", { triggeredBy: "manual" });
    expect(result.status).toBe("error");
    expect(result.stats.errors.length).toBeGreaterThan(0);
  });
});

describe("runSync — categorization", () => {
  it("calls dispatchCategorization and populates mccCategorized/llmCategorized stats", async () => {
    mockTools({
      list_accounts: { accounts: [] },
      list_credit_cards: { credit_cards: [] },
    });
    vi.mocked(dispatchCategorization).mockResolvedValueOnce({
      mccCategorized: 5,
      llmCategorized: 2,
      remaining: 1,
    });

    const result = await runSync(db, conn, "fake-token", { triggeredBy: "manual" });

    expect(dispatchCategorization).toHaveBeenCalledWith(db, "u1");
    expect(result.stats.mccCategorized).toBe(5);
    expect(result.stats.llmCategorized).toBe(2);
  });

  it("catches dispatcher errors as a 'categorize' tool error in stats", async () => {
    mockTools({
      list_accounts: { accounts: [] },
      list_credit_cards: { credit_cards: [] },
    });
    vi.mocked(dispatchCategorization).mockRejectedValueOnce(
      new Error("LLM bombed")
    );

    const result = await runSync(db, conn, "fake-token", { triggeredBy: "manual" });
    expect(result.stats.errors.some((e) => e.tool === "categorize")).toBe(true);
  });
});
