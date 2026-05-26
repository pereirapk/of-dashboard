/**
 * Seed the `categories` collection with the canonical list of slugs.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   bun run seed:categories
 */
import { MongoClient } from "mongodb";
import { seedCategories, findAllCategories } from "@/lib/repositories/categories";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI env var is required");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    await seedCategories(db);
    const rows = await findAllCategories(db);
    console.log(`✓ Seeded ${rows.length} categories:`);
    for (const r of rows) {
      console.log(`  ${r.icon} ${r._id.padEnd(15)} ${r.labelPt}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
