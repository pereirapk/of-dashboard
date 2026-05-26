// tests/lib/repositories/connections.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  upsertBankConnection,
  findActiveConnectionsByUser,
  type UpsertConnectionInput,
} from "@/lib/repositories/connections";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.OPENFINANCE_TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("test");
}, 120000);

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("bank_connections").deleteMany({});
});

describe("upsertBankConnection", () => {
  it("creates a new connection on first call", async () => {
    const input: UpsertConnectionInput = {
      userId: "user-1",
      institutionId: "itau",
      institutionDisplayName: "Itaú",
      status: "active",
      consentExpiresAt: null,
      accessToken: "tok-A",
      refreshToken: "ref-A",
      tokenExpiresAt: new Date("2026-12-31T00:00:00Z"),
    };
    const id = await upsertBankConnection(db, input);
    expect(id).toBeDefined();

    const stored = await db.collection("bank_connections").findOne({ _id: id });
    expect(stored?.userId).toBe("user-1");
    expect(stored?.institutionId).toBe("itau");
    expect(stored?.status).toBe("active");
    expect(stored?.encryptedAccessToken).toBeDefined();
    expect(stored?.encryptedAccessToken).not.toBe("tok-A");
  });

  it("updates existing connection for same user+institution", async () => {
    const base: UpsertConnectionInput = {
      userId: "user-1",
      institutionId: "itau",
      institutionDisplayName: "Itaú",
      status: "active",
      consentExpiresAt: null,
      accessToken: "tok-A",
      refreshToken: "ref-A",
      tokenExpiresAt: new Date("2026-12-31T00:00:00Z"),
    };
    const id1 = await upsertBankConnection(db, base);
    const id2 = await upsertBankConnection(db, { ...base, accessToken: "tok-B" });
    expect(id1.toHexString()).toBe(id2.toHexString());

    const count = await db.collection("bank_connections").countDocuments({});
    expect(count).toBe(1);
  });

  it("findActiveConnectionsByUser returns only active rows", async () => {
    const base: UpsertConnectionInput = {
      userId: "user-1",
      institutionId: "itau",
      institutionDisplayName: "Itaú",
      status: "active",
      consentExpiresAt: null,
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiresAt: new Date(),
    };
    await upsertBankConnection(db, base);
    await upsertBankConnection(db, {
      ...base,
      institutionId: "nubank",
      institutionDisplayName: "Nubank",
      status: "expired",
    });
    const active = await findActiveConnectionsByUser(db, "user-1");
    expect(active).toHaveLength(1);
    expect(active[0].institutionId).toBe("itau");
  });
});
