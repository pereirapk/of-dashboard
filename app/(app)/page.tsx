import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import { findAccountsByUser } from "@/lib/repositories/accounts";
import { findRecentTransactionsByUser } from "@/lib/repositories/transactions";
import { ensureBankConnection } from "@/lib/sync/ensure-connection";
import { AutoSync } from "@/components/sync/AutoSync";
import { Money } from "@/components/Money";
import { CategoryBadge } from "@/components/transactions/CategoryBadge";
import {
  currentMonthRange,
  monthlyTotalsForUser,
  monthlyTrendForUser,
  spendingByCategoryForUser,
} from "@/lib/aggregations/spending";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { SpendingByCategoryDonut } from "@/components/dashboard/SpendingByCategoryDonut";
import { SpendingByCategoryExpandable } from "@/components/dashboard/SpendingByCategoryExpandable";
import { TrendChart } from "@/components/dashboard/TrendChart";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  let ensureError: string | null = null;
  if (session?.accessToken && session.tokenExpiresAt) {
    try {
      await ensureBankConnection({
        userId,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken ?? null,
        tokenExpiresAt: new Date(session.tokenExpiresAt * 1000),
      });
    } catch (err) {
      ensureError = err instanceof Error ? err.message : String(err);
      console.error("[ensureBankConnection]", err);
    }
  }

  const db = await getDb();
  const connections = await findActiveConnectionsByUser(db, userId);
  if (connections.length === 0) {
    redirect(
      ensureError ? "/connect-bank?reason=ensure_failed" : "/connect-bank"
    );
  }

  const monthRange = currentMonthRange();
  const [accounts, transactions, spending, trend, monthTotals, monthTxCount] =
    await Promise.all([
      findAccountsByUser(db, userId),
      findRecentTransactionsByUser(db, userId, 10),
      spendingByCategoryForUser(db, userId, monthRange),
      monthlyTrendForUser(db, userId, 5),
      monthlyTotalsForUser(db, userId, monthRange),
      db.collection("transactions").countDocuments({
        userId,
        date: { $gte: monthRange.start, $lt: monthRange.end },
      }),
    ]);

  const STALE_THRESHOLD_MS = 23 * 60 * 60 * 1000;
  // eslint-disable-next-line react-hooks/purity -- server component
  const now = Date.now();
  const needsAutoSync = connections.some(
    (c) => !c.lastSyncAt || now - c.lastSyncAt.getTime() > STALE_THRESHOLD_MS
  );

  const accountsByKind = {
    account: accounts.filter((a) => a.kind === "account"),
    credit_card: accounts.filter((a) => a.kind === "credit_card"),
  };

  return (
    <main className="p-6 space-y-6">
      {needsAutoSync && <AutoSync />}

      <KpiRow db={db} userId={userId} />

      <section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-5 space-y-3">
        <header className="flex items-baseline justify-between">
          <div>
            <h2 className="text-base font-medium">Tendência — últimos 6 meses</h2>
            <p className="text-xs opacity-60">
              Receita, gastos e líquido por mês
            </p>
          </div>
        </header>
        <TrendChart data={trend} />
      </section>

      <SpendingByCategoryExpandable
        data={spending.map((b) => ({
          categorySlug: b.categorySlug,
          cents: b.cents,
          count: b.count,
        }))}
        outflowCents={monthTotals.outflowCents}
        inflowCents={monthTotals.inflowCents}
        netCents={monthTotals.netCents}
        txCount={monthTxCount}
        rangeLabel="Mês atual"
      />

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-5 space-y-3">
          <header>
            <h2 className="text-base font-medium">Gastos por categoria</h2>
            <p className="text-xs opacity-60">Mês atual</p>
          </header>
          <SpendingByCategoryDonut
            data={spending.map((b) => ({
              categorySlug: b.categorySlug,
              cents: b.cents,
            }))}
          />
        </div>

        <div className="lg:col-span-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-5 space-y-3">
          <header className="flex items-baseline justify-between">
            <div>
              <h2 className="text-base font-medium">Transações recentes</h2>
              <p className="text-xs opacity-60">10 mais novas</p>
            </div>
          </header>
          {transactions.length === 0 ? (
            <p className="opacity-70 text-sm py-6 text-center">
              Nenhuma transação ainda.
            </p>
          ) : (
            <ul className="divide-y divide-foreground/10">
              {transactions.map((t) => (
                <li
                  key={t._id.toHexString()}
                  className="flex items-center justify-between py-3 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{t.description}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <CategoryBadge
                        slug={t.category}
                        source={t.categorySource}
                      />
                      <span className="text-xs opacity-70">
                        {dateFmt.format(t.date)} ·{" "}
                        {t.source === "account" ? "Conta" : "Cartão"}
                        {t.cardLast4 ? ` ····${t.cardLast4}` : ""}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm tabular-nums shrink-0">
                    <Money cents={t.amount} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-5 space-y-3">
          <header>
            <h2 className="text-base font-medium">Contas</h2>
            <p className="text-xs opacity-60">
              {accountsByKind.account.length}{" "}
              {accountsByKind.account.length === 1 ? "conta" : "contas"}
            </p>
          </header>
          {accountsByKind.account.length === 0 ? (
            <p className="opacity-70 text-sm py-4">
              Nenhuma conta sincronizada ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {accountsByKind.account.map((a) => (
                <li
                  key={a._id.toHexString()}
                  className="rounded-md border border-foreground/10 p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{a.displayName}</p>
                    <p className="text-xs opacity-70 truncate">
                      {a.institutionName.toUpperCase()} · Ag. {a.branchCode}
                      {a.balanceUpdatedAt
                        ? ` · ${dateFmt.format(a.balanceUpdatedAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-medium tabular-nums">
                      <Money cents={a.currentBalance ?? 0} />
                    </p>
                    {a.balanceComponents && (
                      <p className="text-[10px] opacity-60 tabular-nums">
                        Disp. <Money cents={a.balanceComponents.available} />
                        {" · "}
                        Invest.{" "}
                        <Money
                          cents={a.balanceComponents.automaticallyInvested}
                        />
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-5 space-y-3">
          <header>
            <h2 className="text-base font-medium">Cartões</h2>
            <p className="text-xs opacity-60">
              {accountsByKind.credit_card.length}{" "}
              {accountsByKind.credit_card.length === 1 ? "cartão" : "cartões"}
            </p>
          </header>
          {accountsByKind.credit_card.length === 0 ? (
            <p className="opacity-70 text-sm py-4">Nenhum cartão.</p>
          ) : (
            <ul className="space-y-2">
              {accountsByKind.credit_card.map((c) => (
                <li
                  key={c._id.toHexString()}
                  className="rounded-md border border-foreground/10 p-3"
                >
                  <p className="font-medium">{c.displayName}</p>
                  <p className="text-xs opacity-70">
                    {c.creditCardNetwork} · {c.productType}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="text-xs opacity-50 text-center pt-4">
        Última conexão sincronizada:{" "}
        {connections[0]?.lastSyncAt
          ? dateFmt.format(connections[0].lastSyncAt)
          : "nunca"}
      </footer>
    </main>
  );
}
