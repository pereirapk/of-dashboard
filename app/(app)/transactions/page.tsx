import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findFilteredTransactionsByUser } from "@/lib/repositories/transactions";
import { findAccountsByUser } from "@/lib/repositories/accounts";
import { findUserCategoriesByUser } from "@/lib/repositories/user-categories";
import { parseFiltersFromSearchParams } from "@/lib/transactions/filter-parser";
import {
  monthlyTotalsForUser,
  spendingByCategoryForUser,
} from "@/lib/aggregations/spending";
import { TransactionList } from "@/components/transactions/TransactionList";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { SpendingByCategoryExpandable } from "@/components/dashboard/SpendingByCategoryExpandable";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const params = await searchParams;
  const parsed = parseFiltersFromSearchParams(params);

  const db = await getDb();
  const { page, ...rest } = parsed;

  // Spending summary covers ALL transactions (matches the unfiltered list
  // shown below). When the user applies date filters to the list, the summary
  // does not currently follow them — that's a deliberate trade-off for now.
  const allTimeRange = {
    start: new Date("1900-01-01T00:00:00Z"),
    end: new Date("2100-01-01T00:00:00Z"),
  };

  const [accounts, result, spending, totals, totalTxCount, userCategoryDocs] =
    await Promise.all([
      findAccountsByUser(db, userId),
      findFilteredTransactionsByUser(db, { userId, ...rest }, page ?? 1, 50),
      spendingByCategoryForUser(db, userId, allTimeRange),
      monthlyTotalsForUser(db, userId, allTimeRange),
      db.collection("transactions").countDocuments({ userId }),
      findUserCategoriesByUser(db, userId),
    ]);

  // Pass the string-valued subset of params to the list for pagination links.
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") stringParams[k] = v;
  }

  return (
    <main className="p-6 space-y-4">
      <SpendingByCategoryExpandable
        data={spending.map((b) => ({
          categorySlug: b.categorySlug,
          cents: b.cents,
          count: b.count,
        }))}
        outflowCents={totals.outflowCents}
        inflowCents={totals.inflowCents}
        netCents={totals.netCents}
        txCount={totalTxCount}
        rangeLabel="Histórico completo"
        userCategories={userCategoryDocs.map((c) => ({
          slug: c.slug,
          labelPt: c.labelPt,
          icon: c.icon,
          color: c.color,
        }))}
      />

      <header>
        <h2 className="text-xl font-semibold">Transações</h2>
        <p className="text-xs opacity-60">
          Todas as suas transações sincronizadas
        </p>
      </header>
      <TransactionFilters
        accounts={accounts.map((a) => ({
          id: a._id.toHexString(),
          label: a.displayName,
        }))}
      />
      <TransactionList
        rows={result.rows}
        total={result.total}
        page={result.page}
        totalPages={result.totalPages}
        searchParams={stringParams}
        userCategories={userCategoryDocs.map((c) => ({
          slug: c.slug,
          labelPt: c.labelPt,
          icon: c.icon,
          color: c.color,
        }))}
      />
    </main>
  );
}
