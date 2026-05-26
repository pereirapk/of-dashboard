import type { Db } from "mongodb";
import { totalBalanceForUser } from "@/lib/aggregations/balance";
import { monthlyTotalsForUser } from "@/lib/aggregations/spending";
import { KpiCard } from "./KpiCard";

export async function KpiRow({ db, userId }: { db: Db; userId: string }) {
  const [total, monthly] = await Promise.all([
    totalBalanceForUser(db, userId),
    monthlyTotalsForUser(db, userId),
  ]);
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <KpiCard title="Saldo total" cents={total} />
      <KpiCard
        title="Gastos do mês"
        cents={-monthly.outflowCents}
        tone="negative"
      />
      <KpiCard
        title="Receita do mês"
        cents={monthly.inflowCents}
        tone="positive"
      />
    </section>
  );
}
