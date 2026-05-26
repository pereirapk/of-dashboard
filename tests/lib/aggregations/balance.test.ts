import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { totalBalanceForUser } from "@/lib/aggregations/balance";

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
  await db.collection("bank_accounts").deleteMany({});
});

describe("totalBalanceForUser", () => {
  it("returns 0 when there are no accounts", async () => {
    expect(await totalBalanceForUser(db, "u1")).toBe(0);
  });

  it("sums currentBalance across the user's accounts", async () => {
    await db.collection("bank_accounts").insertMany([
      { userId: "u1", currentBalance: 10000 } as never,
      { userId: "u1", currentBalance: 5000 } as never,
    ]);
    expect(await totalBalanceForUser(db, "u1")).toBe(15000);
  });

  it("ignores rows with null currentBalance", async () => {
    await db.collection("bank_accounts").insertMany([
      { userId: "u1", currentBalance: 10000 } as never,
      { userId: "u1", currentBalance: null } as never,
    ]);
    expect(await totalBalanceForUser(db, "u1")).toBe(10000);
  });

  it("scopes by userId", async () => {
    await db.collection("bank_accounts").insertMany([
      { userId: "u1", currentBalance: 10000 } as never,
      { userId: "u2", currentBalance: 99999 } as never,
    ]);
    expect(await totalBalanceForUser(db, "u1")).toBe(10000);
  });
});
