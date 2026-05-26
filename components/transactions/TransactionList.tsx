import Link from "next/link";
import type { TransactionDoc } from "@/lib/repositories/transactions";
import { Money } from "@/components/Money";
import { CategoryEditor } from "./CategoryEditor";
import type { CategoryMeta } from "./CategoryBadge";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function TransactionList({
  rows,
  total,
  page,
  totalPages,
  searchParams,
  userCategories,
}: {
  rows: TransactionDoc[];
  total: number;
  page: number;
  totalPages: number;
  searchParams: Record<string, string>;
  userCategories: CategoryMeta[];
}) {
  if (rows.length === 0) {
    return (
      <p className="opacity-70 text-sm p-6 text-center">
        Nenhuma transação encontrada para esses filtros.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10 bg-foreground/[0.02]">
        {rows.map((t) => (
          <li
            key={t._id.toHexString()}
            className="flex items-center justify-between py-3 px-4 gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{t.description}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <CategoryEditor
                  transactionId={t._id.toHexString()}
                  current={t.category}
                  source={t.categorySource}
                  userCategories={userCategories}
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
      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={total}
        searchParams={searchParams}
      />
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  searchParams,
}: {
  page: number;
  totalPages: number;
  total: number;
  searchParams: Record<string, string>;
}) {
  const buildLink = (p: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(p));
    return `/transactions?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-xs opacity-70">
      <span>
        Página {page} de {totalPages} · {total}{" "}
        {total === 1 ? "transação" : "transações"}
      </span>
      <div className="flex gap-3">
        {page > 1 && (
          <Link href={buildLink(page - 1)} className="underline">
            ← Anterior
          </Link>
        )}
        {page < totalPages && (
          <Link href={buildLink(page + 1)} className="underline">
            Próxima →
          </Link>
        )}
      </div>
    </div>
  );
}
