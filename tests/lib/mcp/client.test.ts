import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MongoClient, type Db, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { z } from "zod";

// Mock the transport module so no real network call happens.
vi.mock("@/lib/mcp/_transport", () => ({
  invokeTool: vi.fn(),
}));

import { invokeTool } from "@/lib/mcp/_transport";
import { callMcpTool, type CallMcpContext } from "@/lib/mcp/client";
import { QuotaExceededError, McpError } from "@/lib/mcp/errors";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let bankConnectionId: ObjectId;

const Schema = z.object({ accounts: z.array(z.object({ accountId: z.string() })) });

function mkCtx(overrides: Partial<CallMcpContext> = {}): CallMcpContext {
  return {
    db,
    userId: "user_test",
    bankConnectionId: bankConnectionId.toHexString(),
    syncRunId: null,
    triggeredBy: "manual",
    accessToken: "fake-token",
    quotaBucket: "list_accounts",
    ...overrides,
  };
}

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
  vi.mocked(invokeTool).mockReset();
  await db.collection("mcp_call_logs").deleteMany({});
  await db.collection("bank_connections").deleteMany({});
  const seeded = await db.collection("bank_connections").insertOne({
    userId: "user_test",
    institutionId: "itau",
    status: "active",
    quotaUsage: {},
  } as never);
  bankConnectionId = seeded.insertedId;
});

describe("callMcpTool", () => {
  it("happy path: parses response, logs ok, increments quota", async () => {
    vi.mocked(invokeTool).mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ accounts: [{ accountId: "a1" }] }) }],
    });

    const result = await callMcpTool(mkCtx(), "list_accounts", {}, Schema);

    expect(result.accounts[0].accountId).toBe("a1");

    const log = await db.collection("mcp_call_logs").findOne({ userId: "user_test" });
    expect(log?.status).toBe("ok");
    expect(log?.tool).toBe("list_accounts");
    expect(log?.durationMs).toBeTypeOf("number");

    const conn = await db.collection("bank_connections").findOne({ _id: bankConnectionId });
    expect((conn?.quotaUsage as Record<string, number>).list_accounts).toBe(1);
  });

  it("quota gate throws QuotaExceededError without calling MCP when at limit", async () => {
    // pre-fill quota to the limit (8 for list_accounts)
    await db.collection("bank_connections").updateOne(
      { _id: bankConnectionId },
      {
        $set: {
          quotaUsage: {
            month: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
            list_accounts: 8,
          },
        },
      }
    );

    await expect(callMcpTool(mkCtx(), "list_accounts", {}, Schema)).rejects.toBeInstanceOf(
      QuotaExceededError
    );
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it("bypassCache: true skips the quota gate", async () => {
    await db.collection("bank_connections").updateOne(
      { _id: bankConnectionId },
      {
        $set: {
          quotaUsage: {
            month: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
            list_accounts: 8,
          },
        },
      }
    );
    vi.mocked(invokeTool).mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ accounts: [] }) }],
    });

    const result = await callMcpTool(mkCtx({ bypassCache: true }), "list_accounts", {}, Schema);
    expect(result.accounts).toEqual([]);
    expect(invokeTool).toHaveBeenCalled();
  });

  it("schema mismatch throws McpError kind=schema_mismatch and logs", async () => {
    vi.mocked(invokeTool).mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ wrong: "shape" }) }],
    });

    await expect(callMcpTool(mkCtx(), "list_accounts", {}, Schema)).rejects.toMatchObject({
      kind: "schema_mismatch",
    });

    const log = await db.collection("mcp_call_logs").findOne({ userId: "user_test" });
    expect(log?.status).toBe("error");
    expect(log?.errorKind).toBe("schema_mismatch");
  });

  it("transport error becomes McpError kind=transport and is logged", async () => {
    vi.mocked(invokeTool).mockRejectedValueOnce(new Error("network kaboom"));

    await expect(callMcpTool(mkCtx(), "list_accounts", {}, Schema)).rejects.toMatchObject({
      kind: "transport",
    });

    const log = await db.collection("mcp_call_logs").findOne({ userId: "user_test" });
    expect(log?.status).toBe("error");
    expect(log?.errorKind).toBe("transport");
    expect(log?.errorMessage).toContain("network kaboom");
  });

  it("redacts secret-looking args", async () => {
    vi.mocked(invokeTool).mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ accounts: [] }) }],
    });

    await callMcpTool(
      mkCtx({ quotaBucket: null }),
      "some_tool",
      { accountId: "a1", accessToken: "shhh", cpf: "12345678901" },
      Schema
    );

    const log = await db.collection("mcp_call_logs").findOne({ userId: "user_test" });
    const args = log?.argsRedacted as Record<string, string>;
    expect(args.accountId).toBe("a1");
    expect(args.accessToken).toBe("***");
    expect(args.cpf).toBe("***");
  });

  it("non-text content from MCP throws mcp_tool_error", async () => {
    vi.mocked(invokeTool).mockResolvedValueOnce({ content: [] });

    await expect(callMcpTool(mkCtx(), "list_accounts", {}, Schema)).rejects.toMatchObject({
      kind: "mcp_tool_error",
    });
  });
});
