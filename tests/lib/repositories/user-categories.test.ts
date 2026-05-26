import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  createUserCategory,
  findUserCategoriesByUser,
  isUserCategorySlug,
  ensureUserCategoryIndexes,
} from "@/lib/repositories/user-categories";

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
  await db.collection("user_categories").deleteMany({});
});

describe("createUserCategory", () => {
  it("creates a row with a generated u_ slug", async () => {
    const doc = await createUserCategory(db, {
      userId: "u1",
      labelPt: "Pet Shop",
      icon: "🐾",
      color: "#a855f7",
    });
    expect(doc.slug).toBe("u_pet-shop");
    expect(doc.labelPt).toBe("Pet Shop");
    expect(doc.icon).toBe("🐾");
    expect(doc.color).toBe("#a855f7");
    expect(doc.displayOrder).toBe(1000);
    expect(doc.userId).toBe("u1");
  });

  it("strips diacritics for slug derivation", async () => {
    const doc = await createUserCategory(db, {
      userId: "u1",
      labelPt: "Educação",
      icon: "📚",
      color: "#3b82f6",
    });
    expect(doc.slug).toBe("u_educacao");
  });

  it("dedups slug per user with -2, -3 suffix", async () => {
    const a = await createUserCategory(db, {
      userId: "u1", labelPt: "Pet Shop", icon: "🐾", color: "#a855f7",
    });
    const b = await createUserCategory(db, {
      userId: "u1", labelPt: "Pet Shop", icon: "🐾", color: "#a855f7",
    });
    expect(a.slug).toBe("u_pet-shop");
    expect(b.slug).toBe("u_pet-shop-2");
  });

  it("does NOT dedup across different users", async () => {
    const a = await createUserCategory(db, {
      userId: "u1", labelPt: "Pet Shop", icon: "🐾", color: "#a855f7",
    });
    const b = await createUserCategory(db, {
      userId: "u2", labelPt: "Pet Shop", icon: "🐾", color: "#a855f7",
    });
    expect(a.slug).toBe("u_pet-shop");
    expect(b.slug).toBe("u_pet-shop");
    expect(a.userId).toBe("u1");
    expect(b.userId).toBe("u2");
  });

  it("defaults icon to ❓ when empty", async () => {
    const doc = await createUserCategory(db, {
      userId: "u1", labelPt: "Sem ícone", icon: "", color: "#000000",
    });
    expect(doc.icon).toBe("❓");
  });

  it("rejects invalid color", async () => {
    await expect(
      createUserCategory(db, {
        userId: "u1", labelPt: "Bad color", icon: "x", color: "red",
      })
    ).rejects.toThrow(/color/);
  });

  it("rejects empty label", async () => {
    await expect(
      createUserCategory(db, {
        userId: "u1", labelPt: "   ", icon: "x", color: "#000000",
      })
    ).rejects.toThrow(/labelPt/);
  });
});

describe("findUserCategoriesByUser", () => {
  it("returns the user's own categories, sorted by createdAt", async () => {
    await createUserCategory(db, { userId: "u1", labelPt: "A", icon: "a", color: "#111111" });
    await createUserCategory(db, { userId: "u1", labelPt: "B", icon: "b", color: "#222222" });
    await createUserCategory(db, { userId: "u2", labelPt: "C", icon: "c", color: "#333333" });

    const rows = await findUserCategoriesByUser(db, "u1");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.labelPt)).toEqual(["A", "B"]);
  });
});

describe("isUserCategorySlug", () => {
  it("returns true for an existing user-scoped slug", async () => {
    const doc = await createUserCategory(db, {
      userId: "u1", labelPt: "Pet Shop", icon: "🐾", color: "#a855f7",
    });
    expect(await isUserCategorySlug(db, "u1", doc.slug)).toBe(true);
  });

  it("returns false for a slug owned by another user", async () => {
    const doc = await createUserCategory(db, {
      userId: "u1", labelPt: "Pet Shop", icon: "🐾", color: "#a855f7",
    });
    expect(await isUserCategorySlug(db, "u2", doc.slug)).toBe(false);
  });

  it("returns false for a non-existent slug", async () => {
    expect(await isUserCategorySlug(db, "u1", "u_nope")).toBe(false);
  });
});

describe("ensureUserCategoryIndexes", () => {
  it("creates a unique compound index on (userId, slug)", async () => {
    await ensureUserCategoryIndexes(db);
    const indexes = await db.collection("user_categories").indexes();
    const unique = indexes.find(
      (i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ userId: 1, slug: 1 })
    );
    expect(unique).toBeDefined();
  });
});
