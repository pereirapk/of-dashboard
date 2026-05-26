"use client";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";
import { centsToBrl } from "@/lib/format/money";
import { Icon } from "@/lib/icons";

const BY_SLUG = new Map(CATEGORY_SEEDS.map((c) => [c.slug, c]));

export interface DonutDatum {
  categorySlug: string | null;
  cents: number;
}

export function SpendingByCategoryDonut({ data }: { data: DonutDatum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm opacity-60 p-3">
        Sem gastos categorizados este mês.
      </p>
    );
  }
  const enriched = data.map((d) => {
    const c = d.categorySlug ? BY_SLUG.get(d.categorySlug) : undefined;
    return {
      name: c?.labelPt ?? "Sem categoria",
      icon: c?.icon ?? "help-circle",
      value: d.cents,
      color: c?.color ?? "#71717a",
      slug: d.categorySlug ?? "uncategorized",
    };
  });
  const total = enriched.reduce((n, e) => n + e.value, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm opacity-70">
        Total: <span className="font-medium">{centsToBrl(total)}</span>
      </p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={enriched}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              labelLine={false}
            >
              {enriched.map((e) => (
                <Cell key={e.slug} fill={e.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) =>
                typeof value === "number" ? centsToBrl(value) : String(value)
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {enriched
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((e) => {
            const pct = total > 0 ? (e.value / total) * 100 : 0;
            return (
              <li
                key={e.slug}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: e.color }}
                    aria-hidden
                  />
                  <span className="shrink-0">
                    <Icon name={e.icon} size={14} color={e.color} />
                  </span>
                  <span className="truncate">{e.name}</span>
                </span>
                <span className="tabular-nums opacity-70 shrink-0">
                  {centsToBrl(e.value)} ({pct.toFixed(0)}%)
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
