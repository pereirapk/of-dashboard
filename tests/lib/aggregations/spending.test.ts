import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  monthlyTotalsForUser,
  spendingByCategoryForUser,
  monthlyTrendForUser,
  utcMonthRange,
  currentMonthRange,
} from "@/lib/aggregations/spending";

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
  await db.collection("transactions").deleteMany({});
});

async function seedTx(input: Partial<{ userId: string; amount: number; date: Date; category: string | null }>) {
  await db.collection("transactions").insertOne({
    userId: input.userId ?? "u1",
    amount: input.amount ?? 0,
    date: input.date ?? new Date(),
    category: input.category ?? null,
  } as never);
}

describe("utcMonthRange / currentMonthRange", () => {
  it("returns [start, exclusiveEnd] for a UTC month", () => {
    const r = utcMonthRange(2026, 4); // May 2026 (0-indexed → 4)
    expect(r.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("currentMonthRange wraps utcMonthRange with now()", () => {
    const r = currentMonthRange(new Date("2026-05-22T10:00:00Z"));
    expect(r.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("monthlyTotalsForUser", () => {
  const may = utcMonthRange(2026, 4);

  it("splits amounts by sign into inflow vs outflow (abs)", async () => {
    await seedTx({ amount: 10000, date: new Date("2026-05-10") });
    await seedTx({ amount: -3000, date: new Date("2026-05-12") });
    await seedTx({ amount: -2000, date: new Date("2026-05-15") });

    const r = await monthlyTotalsForUser(db, "u1", may);
    expect(r.inflowCents).toBe(10000);
    expect(r.outflowCents).toBe(5000);
    expect(r.netCents).toBe(5000);
  });

  it("returns zeros when no transactions in range", async () => {
    await seedTx({ amount: -100, date: new Date("2026-04-30") }); // outside
    const r = await monthlyTotalsForUser(db, "u1", may);
    expect(r).toEqual({ inflowCents: 0, outflowCents: 0, netCents: 0 });
  });

  it("scopes by userId", async () => {
    await seedTx({ userId: "u2", amount: -99999, date: new Date("2026-05-15") });
    const r = await monthlyTotalsForUser(db, "u1", may);
    expect(r.outflowCents).toBe(0);
  });
});

describe("spendingByCategoryForUser", () => {
  const may = utcMonthRange(2026, 4);

  it("aggregates by category, returns absolute cents, only for negative amounts", async () => {
    await seedTx({ amount: -5000, date: new Date("2026-05-10"), category: "groceries" });
    await seedTx({ amount: -3000, date: new Date("2026-05-12"), category: "groceries" });
    await seedTx({ amount: -2000, date: new Date("2026-05-15"), category: "restaurants" });

    const r = await spendingByCategoryForUser(db, "u1", may);
    const map = new Map(r.map((b) => [b.categorySlug, b]));
    expect(map.get("groceries")?.cents).toBe(8000);
    expect(map.get("groceries")?.count).toBe(2);
    expect(map.get("restaurants")?.cents).toBe(2000);
  });

  it("excludes default categories (transfers, fees, income)", async () => {
    await seedTx({ amount: -10000, category: "transfers", date: new Date("2026-05-10") });
    await seedTx({ amount: -2000, category: "groceries", date: new Date("2026-05-10") });
    const r = await spendingByCategoryForUser(db, "u1", may);
    const slugs = r.map((b) => b.categorySlug);
    expect(slugs).not.toContain("transfers");
    expect(slugs).toContain("groceries");
  });

  it("ignores positive-amount transactions", async () => {
    await seedTx({ amount: 5000, category: "income", date: new Date("2026-05-10") });
    await seedTx({ amount: -1000, category: "groceries", date: new Date("2026-05-10") });
    const r = await spendingByCategoryForUser(db, "u1", may);
    expect(r).toHaveLength(1);
    expect(r[0].categorySlug).toBe("groceries");
  });

  it("returns empty array when no spending in range", async () => {
    const r = await spendingByCategoryForUser(db, "u1", may);
    expect(r).toEqual([]);
  });
});

describe("monthlyTrendForUser", () => {
  it("returns N+1 contiguous month buckets (last N months + current)", async () => {
    const now = new Date(Date.UTC(2026, 4, 22)); // 22 May 2026
    const r = await monthlyTrendForUser(db, "u1", 5, now);
    expect(r).toHaveLength(6);
    expect(r[0].monthKey).toBe("2025-12");
    expect(r[5].monthKey).toBe("2026-05");
  });

  it("populates inflow/outflow/net per month", async () => {
    const now = new Date(Date.UTC(2026, 4, 22));
    await seedTx({ amount: 10000, date: new Date(Date.UTC(2026, 3, 15)) }); // April: +100
    await seedTx({ amount: -4000, date: new Date(Date.UTC(2026, 3, 20)) }); // April: -40
    await seedTx({ amount: 20000, date: new Date(Date.UTC(2026, 4, 5)) });  // May: +200
    await seedTx({ amount: -5000, date: new Date(Date.UTC(2026, 4, 10)) }); // May: -50
    const r = await monthlyTrendForUser(db, "u1", 5, now);
    const apr = r.find((p) => p.monthKey === "2026-04")!;
    const may = r.find((p) => p.monthKey === "2026-05")!;
    expect(apr.inflowCents).toBe(10000);
    expect(apr.outflowCents).toBe(4000);
    expect(apr.netCents).toBe(6000);
    expect(may.netCents).toBe(15000);
  });

  it("scopes by userId", async () => {
    const now = new Date(Date.UTC(2026, 4, 22));
    await seedTx({ userId: "u2", amount: 99999, date: new Date(Date.UTC(2026, 4, 5)) });
    const r = await monthlyTrendForUser(db, "u1", 5, now);
    expect(r.every((p) => p.inflowCents === 0 && p.outflowCents === 0)).toBe(true);
  });
});
