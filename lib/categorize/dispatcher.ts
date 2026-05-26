import type { Db } from "mongodb";
import type { TransactionDoc } from "@/lib/repositories/transactions";
import { categoryForMcc } from "./by-mcc";
import { categorizeByLlm } from "./by-llm";

export interface DispatchOptions {
  skipLlm?: boolean;
  /** Maximum number of uncategorized transactions to look at per run. */
  maxToConsider?: number; // default 200
  /** Maximum number of categorized transactions to include in LLM few-shot. */
  fewShotSize?: number;   // default 50
}

export interface DispatchCategorizationResult {
  mccCategorized: number;
  llmCategorized: number;
  remaining: number;       // still null after both tiers
}

const TX_COLLECTION = "transactions";

export async function dispatchCategorization(
  db: Db,
  userId: string,
  opts: DispatchOptions = {}
): Promise<DispatchCategorizationResult> {
  const maxToConsider = opts.maxToConsider ?? 200;
  const fewShotSize = opts.fewShotSize ?? 50;

  // 1. Fetch uncategorized transactions for this user (newest first).
  const uncategorized = await db
    .collection<TransactionDoc>(TX_COLLECTION)
    .find({ userId, category: null })
    .sort({ date: -1 })
    .limit(maxToConsider)
    .toArray();

  if (uncategorized.length === 0) {
    return { mccCategorized: 0, llmCategorized: 0, remaining: 0 };
  }

  // 2. Tier 1: MCC rules.
  const now = new Date();
  const mccUpdates: Array<{ id: TransactionDoc["_id"]; category: string }> = [];
  const remainingForLlm: TransactionDoc[] = [];

  for (const tx of uncategorized) {
    const slug = categoryForMcc(tx.mcc);
    if (slug) {
      mccUpdates.push({ id: tx._id, category: slug });
    } else {
      remainingForLlm.push(tx);
    }
  }

  if (mccUpdates.length > 0) {
    await db.collection<TransactionDoc>(TX_COLLECTION).bulkWrite(
      mccUpdates.map((u) => ({
        updateOne: {
          filter: { _id: u.id },
          update: {
            $set: {
              category: u.category,
              categorySource: "mcc",
              categorizedAt: now,
              updatedAt: now,
            },
          },
        },
      })),
      { ordered: false }
    );
  }

  // 3. Tier 2: LLM (skipped on opts.skipLlm)
  let llmCategorized = 0;
  if (!opts.skipLlm && remainingForLlm.length > 0) {
    const fewShot = await db
      .collection<TransactionDoc>(TX_COLLECTION)
      .find({ userId, category: { $ne: null } })
      .sort({ categorizedAt: -1 })
      .limit(fewShotSize)
      .toArray();

    const llmResults = await categorizeByLlm(remainingForLlm, fewShot);
    if (llmResults.length > 0) {
      // Map results by transactionId (hex). The result transactionId comes
      // from the prompt — we'll have populated it as tx._id.toHexString().
      // So we look back at remainingForLlm to find the right _id.
      const idByHex = new Map(
        remainingForLlm.map((tx) => [tx._id.toString(), tx._id])
      );
      const llmOps = llmResults
        .map((r) => {
          const id = idByHex.get(r.transactionId);
          if (!id) return null;
          return {
            updateOne: {
              filter: { _id: id },
              update: {
                $set: {
                  category: r.category,
                  categorySource: "llm" as const,
                  categorizedAt: now,
                  updatedAt: now,
                },
              },
            },
          };
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);
      if (llmOps.length > 0) {
        await db
          .collection<TransactionDoc>(TX_COLLECTION)
          .bulkWrite(llmOps, { ordered: false });
        llmCategorized = llmOps.length;
      }
    }
  }

  const remaining = remainingForLlm.length - llmCategorized;

  return {
    mccCategorized: mccUpdates.length,
    llmCategorized,
    remaining,
  };
}
