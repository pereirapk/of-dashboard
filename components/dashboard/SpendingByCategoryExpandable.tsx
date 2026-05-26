"use client";
import { useState } from "react";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";
import { centsToBrl } from "@/lib/format/money";
import type { CategoryMeta } from "@/components/transactions/CategoryBadge";
import { Icon } from "@/lib/icons";

const SEED_BY_SLUG = new Map(CATEGORY_SEEDS.map((c) => [c.slug, c]));

export interface ExpandableSpendingDatum {
  categorySlug: string | null;
  cents: number;
  count: number;
}

export interface SpendingByCategoryExpandableProps {
  data: ExpandableSpendingDatum[];
  outflowCents: number;
  inflowCents: number;
  netCents: number;
  txCount: number;
  /** e.g. "Mês atual", "Histórico completo" */
  rangeLabel?: string;
  userCategories?: CategoryMeta[];
}

export function SpendingByCategoryExpandable({
  data,
  outflowCents,
  inflowCents,
  netCents,
  txCount,
  rangeLabel,
  userCategories,
}: SpendingByCategoryExpandableProps) {
  const userBySlug = new Map(
    (userCategories ?? []).map((c) => [c.slug, c])
  );
  const resolveMeta = (slug: string | null) => {
    if (!slug) return undefined;
    return userBySlug.get(slug) ?? SEED_BY_SLUG.get(slug);
  };
  const [open, setOpen] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.cents));
  const netTone = netCents >= 0 ? "text-emerald-500" : "text-red-500";

  return (
    <section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 hover:bg-foreground/5 transition-colors text-left"
        aria-expanded={open}
        aria-controls="spending-by-category-list"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon name="layout-dashboard" size={14} aria-hidden />
          <span className="font-medium">Gastos por categoria</span>
          {rangeLabel && (
            <span className="text-xs opacity-60 hidden sm:inline">
              · {rangeLabel}
            </span>
          )}
          <span
            aria-hidden
            className={`inline-block text-xs opacity-60 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </span>
        <span className="flex items-center gap-4 text-xs tabular-nums whitespace-nowrap">
          <span className="opacity-60" title="Transações no mês">
            {txCount}
          </span>
          <span className="text-red-500" title="Saídas no mês">
            ↓ {centsToBrl(outflowCents)}
          </span>
          <span className="text-emerald-500" title="Entradas no mês">
            ↑ {centsToBrl(inflowCents)}
          </span>
          <span className={netTone} title="Líquido (entradas − saídas)">
            ↕ {centsToBrl(Math.abs(netCents))}
          </span>
        </span>
      </button>

      {open && (
        <ul
          id="spending-by-category-list"
          className="divide-y divide-foreground/10 border-t border-foreground/10"
        >
          {data.length === 0 ? (
            <li className="p-6 text-center text-sm opacity-60">
              Sem gastos categorizados este mês.
            </li>
          ) : (
            data.map((d) => {
              const c = resolveMeta(d.categorySlug);
              const widthPct = (d.cents / max) * 100;
              const color = c?.color ?? "#71717a";
              const label = c?.labelPt ?? "Sem categoria";
              const iconName = c?.icon ?? "help-circle";
              return (
                <li
                  key={d.categorySlug ?? "uncategorized"}
                  className="relative"
                >
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 z-0 rounded-r-sm"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: `${color}33`,
                    }}
                  />
                  <div className="relative z-10 flex items-center justify-between gap-3 px-4 py-2">
                    <span className="flex items-center gap-2 text-sm min-w-0">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <Icon name={iconName} size={14} color={color} />
                      <span className="truncate">{label}</span>
                      <span className="text-xs opacity-50 shrink-0">
                        · {d.count}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums shrink-0">
                      {centsToBrl(d.cents)}
                    </span>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </section>
  );
}
