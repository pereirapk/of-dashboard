import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  insertRunningLog,
  finishLogOk,
  finishLogError,
  ensureMcpCallLogIndexes,
  type McpCallLogDoc,
  type InsertRunningInput,
} from "@/lib/repositories/mcp-call-logs";

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
  await db.collection("mcp_call_logs").deleteMany({});
});

const baseInput: InsertRunningInput = {
  requestId: "req_test_1",
  userId: "user_1",
  bankConnectionId: "conn_1",
  syncRunId: null,
  tool: "list_accounts",
  quotaBucket: "list_accounts",
  quotaConsumed: true,
  triggeredBy: "manual",
  startedAt: new Date("2026-05-21T12:00:00Z"),
  argsRedacted: {},
};

describe("mcp_call_logs repository", () => {
  it("insertRunningLog creates a row in 'running' state", async () => {
    const id = await insertRunningLog(db, baseInput);
    expect(id).toBeDefined();
    const doc = await db.collection<McpCallLogDoc>("mcp_call_logs").findOne({ _id: id });
    expect(doc?.status).toBe("running");
    expect(doc?.durationMs).toBeNull();
    expect(doc?.responseSnippet).toBeNull();
    expect(doc?.tool).toBe("list_accounts");
  });

  it("finishLogOk updates status, durationMs, responseSnippet", async () => {
    const id = await insertRunningLog(db, baseInput);
    await finishLogOk(db, id, 412, "{\"count\":1}");
    const doc = await db.collection<McpCallLogDoc>("mcp_call_logs").findOne({ _id: id });
    expect(doc?.status).toBe("ok");
    expect(doc?.durationMs).toBe(412);
    expect(doc?.responseSnippet).toBe("{\"count\":1}");
    expect(doc?.errorKind).toBeNull();
  });

  it("finishLogError records error fields", async () => {
    const id = await insertRunningLog(db, baseInput);
    await finishLogError(db, id, 1208, "auth", "Missing token", "401", { raw: "details" });
    const doc = await db.collection<McpCallLogDoc>("mcp_call_logs").findOne({ _id: id });
    expect(doc?.status).toBe("error");
    expect(doc?.durationMs).toBe(1208);
    expect(doc?.errorKind).toBe("auth");
    expect(doc?.errorMessage).toBe("Missing token");
    expect(doc?.errorCode).toBe("401");
    expect(doc?.mcpRaw).toEqual({ raw: "details" });
  });

  it("ensureMcpCallLogIndexes creates 5 indexes (4 query + 1 TTL) plus _id", async () => {
    await ensureMcpCallLogIndexes(db);
    const indexes = await db.collection("mcp_call_logs").indexes();
    // _id_ + our 5
    expect(indexes.length).toBeGreaterThanOrEqual(6);
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
    expect(ttl).toBeDefined();
    expect(ttl!.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });

  it("ensureMcpCallLogIndexes is idempotent", async () => {
    await ensureMcpCallLogIndexes(db);
    await ensureMcpCallLogIndexes(db);
    const indexes = await db.collection("mcp_call_logs").indexes();
    expect(indexes.length).toBeGreaterThanOrEqual(6);
  });
});
