import type { Db } from "mongodb";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";

export interface CategoryDoc {
  _id: string;
  labelPt: string;
  icon: string;
  color: string;
  displayOrder: number;
}

const COLLECTION = "categories";

export async function seedCategories(db: Db): Promise<void> {
  for (const c of CATEGORY_SEEDS) {
    await db.collection<CategoryDoc>(COLLECTION).updateOne(
      { _id: c.slug },
      {
        $set: {
          labelPt: c.labelPt,
          icon: c.icon,
          color: c.color,
          displayOrder: c.displayOrder,
        },
      },
      { upsert: true }
    );
  }
}

export async function findAllCategories(db: Db): Promise<CategoryDoc[]> {
  return db
    .collection<CategoryDoc>(COLLECTION)
    .find()
    .sort({ displayOrder: 1 })
    .toArray();
}
