import type { Db, ObjectId } from "mongodb";

export interface UserCategoryDoc {
  _id: ObjectId;
  userId: string;
  slug: string;         // unique per user, e.g. "u_pet-shop"
  labelPt: string;
  icon: string;
  color: string;        // hex like "#a855f7"
  displayOrder: number; // we use 1000+ to sort after seeded
  createdAt: Date;
}

const COLLECTION = "user_categories";

function slugifyAscii(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")    // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "categoria";
}

/**
 * Compute a unique user-scoped slug derived from `label`. Adds `-2`, `-3`,
 * etc. if a collision exists for this user.
 */
async function computeSlug(db: Db, userId: string, label: string): Promise<string> {
  const base = `u_${slugifyAscii(label)}`;
  let candidate = base;
  let n = 1;
  // Try candidate; if taken by SAME user, append -2, -3, ...
  while (true) {
    const exists = await db
      .collection<UserCategoryDoc>(COLLECTION)
      .findOne({ userId, slug: candidate }, { projection: { _id: 1 } });
    if (!exists) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
    if (n > 100) throw new Error("Could not produce a unique slug after 100 attempts");
  }
}

export interface CreateUserCategoryInput {
  userId: string;
  labelPt: string;
  icon: string;     // emoji or single character; defaults to ❓ if empty
  color: string;    // "#RRGGBB"
}

export async function createUserCategory(
  db: Db,
  input: CreateUserCategoryInput
): Promise<UserCategoryDoc> {
  const labelPt = input.labelPt.trim();
  if (!labelPt) throw new Error("labelPt is required");
  const icon = input.icon.trim() || "❓";
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
    throw new Error("color must be a hex string like #RRGGBB");
  }
  const slug = await computeSlug(db, input.userId, labelPt);
  const now = new Date();
  const doc = {
    userId: input.userId,
    slug,
    labelPt: labelPt.slice(0, 60),
    icon: icon.slice(0, 8),
    color: input.color,
    displayOrder: 1000,
    createdAt: now,
  };
  const result = await db
    .collection<UserCategoryDoc>(COLLECTION)
    .insertOne(doc as unknown as UserCategoryDoc);
  return { _id: result.insertedId, ...doc };
}

export async function findUserCategoriesByUser(
  db: Db,
  userId: string
): Promise<UserCategoryDoc[]> {
  return db
    .collection<UserCategoryDoc>(COLLECTION)
    .find({ userId })
    .sort({ displayOrder: 1, createdAt: 1 })
    .toArray();
}

export async function isUserCategorySlug(
  db: Db,
  userId: string,
  slug: string
): Promise<boolean> {
  const doc = await db
    .collection<UserCategoryDoc>(COLLECTION)
    .findOne({ userId, slug }, { projection: { _id: 1 } });
  return !!doc;
}

export async function ensureUserCategoryIndexes(db: Db): Promise<void> {
  await db
    .collection(COLLECTION)
    .createIndex({ userId: 1, slug: 1 }, { unique: true });
}
