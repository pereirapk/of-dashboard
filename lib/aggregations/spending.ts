import type { Db } from "mongodb";

export interface MonthRange {
  start: Date;
  end: Date;
}

export function utcMonthRange(year: number, monthIndex0: number): MonthRange {
  return {
    start: new Date(Date.UTC(year, monthIndex0, 1)),
    end: new Date(Date.UTC(year, monthIndex0 + 1, 1)),
  };
}

export function currentMonthRange(now: Date = new Date()): MonthRange {
  return utcMonthRange(now.getUTCFullYear(), now.getUTCMonth());
}

export interface MonthlyTotals {
  outflowCents: number;
  inflowCents: number;
  netCents: number;
}

export async function monthlyTotalsForUser(
  db: Db,
  userId: string,
  range: MonthRange = currentMonthRange()
): Promise<MonthlyTotals> {
  const rows = await db
    .collection("transactions")
    .aggregate<{ _id: "in" | "out"; total: number }>([
      { $match: { userId, date: { $gte: range.start, $lt: range.end } } },
      {
        $group: {
          _id: { $cond: [{ $lt: ["$amount", 0] }, "out", "in"] },
          total: { $sum: "$amount" },
        },
      },
    ])
    .toArray();
  let inflow = 0;
  let outflow = 0;
  for (const r of rows) {
    if (r._id === "in") inflow = r.total;
    else if (r._id === "out") outflow = Math.abs(r.total);
  }
  return { inflowCents: inflow, outflowCents: outflow, netCents: inflow - outflow };
}

export interface CategoryBucket {
  categorySlug: string | null;
  cents: number;
  count: number;
}

export async function spendingByCategoryForUser(
  db: Db,
  userId: string,
  range: MonthRange = currentMonthRange(),
  excludeCategories: string[] = ["transfers", "fees", "income"]
): Promise<CategoryBucket[]> {
  const rows = await db
    .collection("transactions")
    .aggregate<{ _id: string | null; total: number; count: number }>([
      {
        $match: {
          userId,
          amount: { $lt: 0 },
          date: { $gte: range.start, $lt: range.end },
          category: { $nin: excludeCategories },
        },
      },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: 1 } },
    ])
    .toArray();
  return rows.map((r) => ({
    categorySlug: r._id,
    cents: Math.abs(r.total),
    count: r.count,
  }));
}

export interface MonthlyTrendPoint {
  monthKey: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
}

export async function monthlyTrendForUser(
  db: Db,
  userId: string,
  monthsBack: number = 5,
  now: Date = new Date()
): Promise<MonthlyTrendPoint[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await db
    .collection("transactions")
    .aggregate<{
      _id: { year: number; month: number; direction: "in" | "out" };
      total: number;
    }>([
      { $match: { userId, date: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            direction: { $cond: [{ $lt: ["$amount", 0] }, "out", "in"] },
          },
          total: { $sum: "$amount" },
        },
      },
    ])
    .toArray();

  const points: MonthlyTrendPoint[] = [];
  for (let i = 0; i <= monthsBack; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsBack - i), 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    points.push({ monthKey: key, inflowCents: 0, outflowCents: 0, netCents: 0 });
  }
  for (const r of rows) {
    const key = `${r._id.year}-${String(r._id.month).padStart(2, "0")}`;
    const p = points.find((x) => x.monthKey === key);
    if (!p) continue;
    if (r._id.direction === "in") p.inflowCents = r.total;
    else p.outflowCents = Math.abs(r.total);
    p.netCents = p.inflowCents - p.outflowCents;
  }
  return points;
}
