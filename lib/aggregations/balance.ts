import type { Db } from "mongodb";
import type { BankAccountDoc } from "@/lib/repositories/accounts";

/** Sum of currentBalance across all of the user's accounts. Returns cents. */
export async function totalBalanceForUser(db: Db, userId: string): Promise<number> {
  const result = await db
    .collection<BankAccountDoc>("bank_accounts")
    .aggregate<{ _id: null; total: number }>([
      { $match: { userId, currentBalance: { $ne: null } } },
      { $group: { _id: null, total: { $sum: "$currentBalance" } } },
    ])
    .toArray();
  return result[0]?.total ?? 0;
}
