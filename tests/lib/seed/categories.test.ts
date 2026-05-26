import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  seedCategories,
  findAllCategories,
} from "@/lib/repositories/categories";
import {
  CATEGORY_SEEDS,
  CATEGORY_SLUGS,
} from "@/lib/seed/categories";

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
  await db.collection("categories").deleteMany({});
});

describe("categories", () => {
  it("CATEGORY_SLUGS matches CATEGORY_SEEDS slugs", () => {
    expect(CATEGORY_SLUGS.size).toBe(CATEGORY_SEEDS.length);
    for (const c of CATEGORY_SEEDS) {
      expect(CATEGORY_SLUGS.has(c.slug)).toBe(true);
    }
  });

  it("seedCategories inserts all rows on a fresh DB", async () => {
    await seedCategories(db);
    const count = await db.collection("categories").countDocuments({});
    expect(count).toBe(CATEGORY_SEEDS.length);
  });

  it("seedCategories is idempotent", async () => {
    await seedCategories(db);
    await seedCategories(db);
    const count = await db.collection("categories").countDocuments({});
    expect(count).toBe(CATEGORY_SEEDS.length);
  });

  it("findAllCategories returns sorted by displayOrder asc", async () => {
    await seedCategories(db);
    const rows = await findAllCategories(db);
    expect(rows.length).toBe(CATEGORY_SEEDS.length);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].displayOrder).toBeGreaterThanOrEqual(rows[i - 1].displayOrder);
    }
    expect(rows[0]._id).toBe("groceries");
    expect(rows[rows.length - 1]._id).toBe("other");
  });
});
