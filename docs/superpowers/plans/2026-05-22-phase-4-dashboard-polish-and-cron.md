# Phase 4 — Dashboard polish (KPIs + charts) + daily cron

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard *look* and *feel* like the FinTrack reference (KPIs on top, spending donut, 6-month trend). Add a daily cron that auto-syncs without the user clicking. After this phase, the app delivers most of the user-facing value of the MVP.

**Out of scope** (Phase 5):
- `/transactions` dedicated page with filters
- Inline category editor on transactions
- LGPD delete
- `/dev/logs` admin page
- Production deploy guide

**Architecture additions:**

```
Browser → SSR /
  ┌─ KPI row (3 cards)
  │   ├─ Saldo total (sum of bank_accounts.currentBalance)
  │   ├─ Gastos do mês (sum of negative txns this month)
  │   └─ Receita do mês (sum of positive txns this month)
  ├─ Chart: gastos por categoria — donut (Recharts)
  ├─ Chart: tendência 6 meses — line (Recharts) reads balance_snapshots
  ├─ Contas / Cartões (existing)
  └─ Transações recentes (existing)

Vercel Cron (daily) → POST /api/cron/sync
  ├─ Auth via X-Cron-Secret header
  ├─ Enumerate active bank_connections
  ├─ For each: ensureFreshAccessToken (refresh if needed) → runSync
  └─ Return summary
```

**Tech additions:**
- `recharts` (already mentioned in spec; new dep)
- `vercel.json` with daily cron schedule
- Token refresh helper that works WITHOUT a session (for cron)

**User preferences (memory):**
- No `git` commands.
- Mongo Atlas free tier.
- Daily cron (not hourly) — already in spec rev 2.

---

## Pre-flight — what already exists

```
lib/categorize/{by-mcc,by-llm,dispatcher,mcc-map,types}.ts
lib/repositories/{accounts,categories,connections,mcp-call-logs,rate-limits,snapshots,sync-runs,transactions}.ts
lib/sync/{runner,ensure-connection}.ts
lib/mcp/{client,errors,quotas,tools,types,_transport}.ts
lib/auth.ts                                   (refresh-aware, session-bound)
lib/crypto.ts                                 (encrypt/decrypt/hashWithPepper)
lib/format/money.ts
app/(app)/{layout,page,connect-bank/page}.tsx (dashboard renders categories)
app/api/{auth/[...nextauth],sync,transactions/[id]/category}/route.ts
components/{Money,sync/SyncNowButton,transactions/CategoryBadge,...}.tsx
scripts/seed-categories.ts
```

`transactions.category`, `transactions.amount` (signed cents), `balance_snapshots` all populated. Phase 3 ran end-to-end.

---

## Files this phase will create or touch

```
Create:
  lib/aggregations/spending.ts                  // server queries: KPI sums, donut, trend
  lib/aggregations/balance.ts                   // total balance helpers
  lib/auth/access-token.ts                      // ensureFreshAccessToken (no session)
  components/dashboard/KpiRow.tsx
  components/dashboard/KpiCard.tsx
  components/dashboard/SpendingByCategoryDonut.tsx   // client component (Recharts)
  components/dashboard/TrendChart.tsx                // client component (Recharts)
  app/api/cron/sync/route.ts                    // GET (Vercel cron uses GET by default)
  vercel.json                                   // daily cron schedule
  tests/lib/aggregations/spending.test.ts
  tests/lib/aggregations/balance.test.ts
  tests/lib/auth/access-token.test.ts

Modify:
  package.json                                  // add recharts
  lib/sync/runner.ts                            // export a small "sync this connection by id" helper used by cron (or call runSync directly from cron)
  app/(app)/page.tsx                            // wire KPI row + charts above existing sections
```

---

## Task 0 — Add Recharts

- [ ] `bun add recharts`
- [ ] `bunx tsc --noEmit` clean.

---

## Task 1 — Aggregation queries (TDD)

**Files:**
- Create: `lib/aggregations/spending.ts`, `lib/aggregations/balance.ts`
- Create: `tests/lib/aggregations/{spending,balance}.test.ts`

### lib/aggregations/balance.ts

```ts
import type { Db } from "mongodb";
import type { BankAccountDoc } from "@/lib/repositories/accounts";

/** Sum of currentBalance across all of the user's accounts. Returns cents. */
export async function totalBalanceForUser(db: Db, userId: string): Promise<number> {
  const result = await db.collection<BankAccountDoc>("bank_accounts").aggregate([
    { $match: { userId, currentBalance: { $ne: null } } },
    { $group: { _id: null, total: { $sum: "$currentBalance" } } },
  ]).toArray();
  return (result[0]?.total ?? 0) as number;
}
```

### lib/aggregations/spending.ts

```ts
import type { Db } from "mongodb";

export interface MonthRange {
  start: Date;   // inclusive (UTC)
  end: Date;     // exclusive (UTC)
}

/** Returns the UTC start (inclusive) and end (exclusive) of the given month. */
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
  outflowCents: number;   // sum of |negative amounts|
  inflowCents: number;    // sum of positive amounts
  netCents: number;       // inflow - outflow
}

export async function monthlyTotalsForUser(
  db: Db,
  userId: string,
  range: MonthRange = currentMonthRange()
): Promise<MonthlyTotals> {
  const rows = await db.collection("transactions").aggregate([
    { $match: { userId, date: { $gte: range.start, $lt: range.end } } },
    {
      $group: {
        _id: { $cond: [{ $lt: ["$amount", 0] }, "out", "in"] },
        total: { $sum: "$amount" },
      },
    },
  ]).toArray();
  let inflow = 0;
  let outflow = 0;
  for (const r of rows) {
    if (r._id === "in") inflow = r.total;
    else if (r._id === "out") outflow = Math.abs(r.total);
  }
  return { inflowCents: inflow, outflowCents: outflow, netCents: inflow - outflow };
}

export interface CategoryBucket {
  categorySlug: string | null;     // null = uncategorized
  cents: number;                    // absolute cents (positive)
  count: number;
}

/**
 * Spending grouped by category for the given month. Only negative-amount
 * transactions are included. Excludes transfers and fees by default.
 */
export async function spendingByCategoryForUser(
  db: Db,
  userId: string,
  range: MonthRange = currentMonthRange(),
  excludeCategories: string[] = ["transfers", "fees", "income"]
): Promise<CategoryBucket[]> {
  const rows = await db.collection("transactions").aggregate([
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
    { $sort: { total: 1 } },   // most negative first = largest spend
  ]).toArray();
  return rows.map((r) => ({
    categorySlug: (r._id as string | null),
    cents: Math.abs(r.total as number),
    count: r.count as number,
  }));
}

export interface MonthlyTrendPoint {
  monthKey: string;        // "YYYY-MM"
  inflowCents: number;
  outflowCents: number;
  netCents: number;
}

/**
 * Returns net flow per month for the last N months, inclusive of current.
 * monthsBack=5 → 6 buckets including current.
 */
export async function monthlyTrendForUser(
  db: Db,
  userId: string,
  monthsBack: number = 5,
  now: Date = new Date()
): Promise<MonthlyTrendPoint[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await db.collection("transactions").aggregate([
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
  ]).toArray();

  // Build a contiguous list of months from start..now
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
```

### Tests

Use `mongodb-memory-server` + seeded transactions across multiple months. Verify:

- `totalBalanceForUser` sums across accounts correctly; ignores null balances; scopes by userId.
- `monthlyTotalsForUser` separates in/out correctly using sign of `amount`.
- `spendingByCategoryForUser` excludes "transfers" / "fees" / "income" by default.
- `spendingByCategoryForUser` aggregates by `category`, returning null bucket for uncategorized.
- `monthlyTrendForUser` returns 6 contiguous month buckets even if some are empty.

Standard TDD: tests → FAIL → impl → PASS.

---

## Task 2 — KPI row + cards

**Files:**
- Create: `components/dashboard/KpiCard.tsx`, `components/dashboard/KpiRow.tsx`
- Modify: `app/(app)/page.tsx`

### KpiCard.tsx

```tsx
import { Money } from "@/components/Money";

export interface KpiCardProps {
  title: string;
  cents: number;
  helper?: string;
  tone?: "neutral" | "positive" | "negative";
}

export function KpiCard({ title, cents, helper, tone = "neutral" }: KpiCardProps) {
  const toneClass =
    tone === "positive" ? "text-emerald-500" :
    tone === "negative" ? "text-red-500" :
    "";
  return (
    <div className="rounded-md border border-foreground/10 p-4 space-y-1 flex flex-col">
      <p className="text-xs uppercase tracking-wide opacity-60">{title}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        <Money cents={cents} />
      </p>
      {helper && <p className="text-xs opacity-60">{helper}</p>}
    </div>
  );
}
```

### KpiRow.tsx (server component)

```tsx
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
      <KpiCard title="Gastos do mês" cents={-monthly.outflowCents} tone="negative" />
      <KpiCard title="Receita do mês" cents={monthly.inflowCents} tone="positive" />
    </section>
  );
}
```

### page.tsx update

Insert `<KpiRow db={db} userId={userId} />` between the `<header>` block and the `Contas` section.

---

## Task 3 — Spending by category donut (client component, Recharts)

**Files:**
- Create: `components/dashboard/SpendingByCategoryDonut.tsx`

⚠️ **REQUIRED:** Recharts components run in the browser. Mark the file `"use client"`. The PAGE that uses it stays server-side; it passes pre-aggregated data as props.

```tsx
"use client";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";
import { centsToBrl } from "@/lib/format/money";

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
      value: d.cents,
      color: c?.color ?? "#71717a",
      slug: d.categorySlug ?? "uncategorized",
    };
  });
  const total = enriched.reduce((n, e) => n + e.value, 0);
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={enriched}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={90}
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
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            formatter={(value) => <span className="text-xs">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-center text-xs opacity-70 -mt-4">
        Total: {centsToBrl(total)}
      </p>
    </div>
  );
}
```

Add usage in `page.tsx` (server-side):

```tsx
import { SpendingByCategoryDonut } from "@/components/dashboard/SpendingByCategoryDonut";
import { spendingByCategoryForUser } from "@/lib/aggregations/spending";
...
const spendingData = await spendingByCategoryForUser(db, userId);
...
<section className="space-y-3">
  <h2 className="text-lg font-medium">Gastos por categoria — mês atual</h2>
  <div className="rounded-md border border-foreground/10 p-3">
    <SpendingByCategoryDonut data={spendingData.map(b => ({ categorySlug: b.categorySlug, cents: b.cents }))} />
  </div>
</section>
```

---

## Task 4 — Trend line chart

**Files:**
- Create: `components/dashboard/TrendChart.tsx`

```tsx
"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { centsToBrl } from "@/lib/format/money";

export interface TrendPoint {
  monthKey: string;   // "YYYY-MM"
  inflowCents: number;
  outflowCents: number;
  netCents: number;
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm opacity-60 p-3">Sem dados suficientes.</p>;
  }
  const chartData = data.map((d) => ({
    month: d.monthKey.slice(5), // "MM" only for X axis
    Receita: d.inflowCents / 100,
    Gastos: d.outflowCents / 100,
    Líquido: d.netCents / 100,
  }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => centsToBrl(v * 100)} />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? centsToBrl(value * 100) : String(value)
            }
          />
          <Line type="monotone" dataKey="Receita" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Gastos" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="Líquido" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Add to `page.tsx` after the donut section:

```tsx
const trendData = await monthlyTrendForUser(db, userId, 5);
...
<section className="space-y-3">
  <h2 className="text-lg font-medium">Tendência — últimos 6 meses</h2>
  <div className="rounded-md border border-foreground/10 p-3">
    <TrendChart data={trendData} />
  </div>
</section>
```

---

## Task 5 — Access token helper (no session, used by cron)

**Files:**
- Create: `lib/auth/access-token.ts`
- Create: `tests/lib/auth/access-token.test.ts`

This helper lets non-session contexts (cron, future workers) fetch a valid access token for a `bank_connection`. It:
1. Reads `encryptedAccessToken` + `encryptedRefreshToken` + `tokenExpiresAt` from the connection.
2. If `tokenExpiresAt - 30s > now`, returns the decrypted access token.
3. Otherwise, refreshes via Keycloak (POST to token endpoint), encrypts and writes back to the connection, returns the new token.
4. If refresh fails, throws `AccessTokenError`.

```ts
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { decrypt, encrypt } from "@/lib/crypto";

export class AccessTokenError extends Error {
  constructor(message: string, public reason: "missing" | "refresh_failed") {
    super(message);
    this.name = "AccessTokenError";
  }
}

const SAFETY_MARGIN_SECONDS = 30;

async function refreshTokenAtKeycloak(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const issuer = process.env.KEYCLOAK_ISSUER;
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    throw new AccessTokenError("Keycloak env vars missing", "missing");
  }
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new AccessTokenError(
      `Refresh failed: ${response.status} ${JSON.stringify(data)}`,
      "refresh_failed"
    );
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number),
  };
}

export async function ensureFreshAccessToken(
  db: Db,
  bankConnectionId: ObjectId
): Promise<string> {
  const conn = await db.collection("bank_connections").findOne({ _id: bankConnectionId });
  if (!conn) throw new AccessTokenError("Connection not found", "missing");

  const tokenExpiresAt = conn.tokenExpiresAt as Date | undefined;
  const tokenExpiresAtUnix = tokenExpiresAt ? Math.floor(tokenExpiresAt.getTime() / 1000) : 0;
  const now = Math.floor(Date.now() / 1000);

  if (tokenExpiresAtUnix - SAFETY_MARGIN_SECONDS > now) {
    return decrypt(conn.encryptedAccessToken as string, "OPENFINANCE_TOKEN_KEY");
  }

  if (!conn.encryptedRefreshToken) {
    throw new AccessTokenError(
      "Access token expired and no refresh token available",
      "missing"
    );
  }
  const refreshPlain = decrypt(
    conn.encryptedRefreshToken as string,
    "OPENFINANCE_TOKEN_KEY"
  );
  const refreshed = await refreshTokenAtKeycloak(refreshPlain);
  await db.collection("bank_connections").updateOne(
    { _id: bankConnectionId },
    {
      $set: {
        encryptedAccessToken: encrypt(refreshed.accessToken, "OPENFINANCE_TOKEN_KEY"),
        encryptedRefreshToken: encrypt(refreshed.refreshToken, "OPENFINANCE_TOKEN_KEY"),
        tokenExpiresAt: new Date(refreshed.expiresAt * 1000),
        updatedAt: new Date(),
      },
    }
  );
  return refreshed.accessToken;
}
```

### Tests

Mock `global.fetch` to simulate Keycloak responses. Cover:
- Token still valid → returns decrypted current token; no fetch
- Token expired + refresh succeeds → calls fetch, writes back, returns new token
- Token expired + no refresh token → throws AccessTokenError("missing")
- Token expired + refresh fails → throws AccessTokenError("refresh_failed")
- Connection not found → throws AccessTokenError("missing")

Use `mongodb-memory-server`. Set env vars `OPENFINANCE_TOKEN_KEY`, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` in `beforeAll`.

---

## Task 6 — Cron endpoint + vercel.json

**Files:**
- Create: `app/api/cron/sync/route.ts`
- Create: `vercel.json`

### route.ts

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/mongo";
import { runSync, type RunSyncResult } from "@/lib/sync/runner";
import {
  ensureFreshAccessToken,
  AccessTokenError,
} from "@/lib/auth/access-token";
import type { BankConnectionDoc } from "@/lib/repositories/connections";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const cutoff = new Date(Date.now() - ONE_DAY_MS + 60 * 60 * 1000); // synced within last 23h → skip

  const conns = (await db
    .collection<BankConnectionDoc>("bank_connections")
    .find({
      status: "active",
      $or: [{ lastSyncAt: null }, { lastSyncAt: { $lt: cutoff } }],
    })
    .toArray()) as BankConnectionDoc[];

  const results: Array<{ bankConnectionId: string; status: string; error?: string; result?: RunSyncResult }> = [];

  for (const conn of conns) {
    try {
      const accessToken = await ensureFreshAccessToken(db, conn._id);
      const r = await runSync(db, conn, accessToken, { triggeredBy: "cron" });
      results.push({ bankConnectionId: conn._id.toString(), status: r.status, result: r });
    } catch (err) {
      results.push({
        bankConnectionId: conn._id.toString(),
        status: "error",
        error:
          err instanceof AccessTokenError
            ? `access_token:${err.reason}:${err.message}`
            : err instanceof Error
            ? err.message
            : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
```

### vercel.json

```jsonc
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "0 8 * * *" }
  ]
}
```

`0 8 * * *` = 08:00 UTC = ≈05:00 BRT (data fresh when the user wakes up).

Vercel sends a GET with header `Authorization: Bearer <CRON_SECRET>` automatically when `CRON_SECRET` is set in the project's env. Our handler also accepts `X-Cron-Secret` for local curl testing.

### Note about Cron + connect status

If a connection has `status="expired"` (e.g., user revoked consent), the query above skips it. No error is logged for that case — it shows up in the UI when the user logs in next.

### Smoke (optional)

Add a quick curl test instruction to the report — not part of automated tests since it needs env.

---

## Task 7 — Wire it all into page.tsx

**File:** `app/(app)/page.tsx`

Final structure of the file:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import { findAccountsByUser } from "@/lib/repositories/accounts";
import { findRecentTransactionsByUser } from "@/lib/repositories/transactions";
import { ensureBankConnection } from "@/lib/sync/ensure-connection";
import {
  monthlyTrendForUser,
  spendingByCategoryForUser,
} from "@/lib/aggregations/spending";
import { SyncNowButton } from "@/components/sync/SyncNowButton";
import { Money } from "@/components/Money";
import { CategoryBadge } from "@/components/transactions/CategoryBadge";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { SpendingByCategoryDonut } from "@/components/dashboard/SpendingByCategoryDonut";
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
    redirect(ensureError ? "/connect-bank?reason=ensure_failed" : "/connect-bank");
  }

  const [accounts, transactions, spending, trend] = await Promise.all([
    findAccountsByUser(db, userId),
    findRecentTransactionsByUser(db, userId, 10),
    spendingByCategoryForUser(db, userId),
    monthlyTrendForUser(db, userId, 5),
  ]);

  const accountsByKind = {
    account: accounts.filter((a) => a.kind === "account"),
    credit_card: accounts.filter((a) => a.kind === "credit_card"),
  };

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto space-y-8 relative">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Cumbuca Dashboard</h1>
        <SyncNowButton />
      </header>

      <KpiRow db={db} userId={userId} />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border border-foreground/10 p-3 space-y-2">
          <h2 className="text-lg font-medium">Gastos por categoria</h2>
          <SpendingByCategoryDonut
            data={spending.map((b) => ({ categorySlug: b.categorySlug, cents: b.cents }))}
          />
        </div>
        <div className="rounded-md border border-foreground/10 p-3 space-y-2">
          <h2 className="text-lg font-medium">Tendência — 6 meses</h2>
          <TrendChart data={trend} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Contas</h2>
        {/* … existing Contas block (Phase 3 layout) … */}
      </section>

      {accountsByKind.credit_card.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Cartões</h2>
          {/* … existing Cartões block … */}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Transações recentes</h2>
        {/* … existing transactions list with CategoryBadge … */}
      </section>

      <footer className="text-xs opacity-50">
        Última conexão sincronizada:{" "}
        {connections[0]?.lastSyncAt ? dateFmt.format(connections[0].lastSyncAt) : "nunca"}
      </footer>
    </main>
  );
}
```

When integrating, **read the current `page.tsx`** and only INSERT the new sections (KPI row + charts grid) without breaking the existing Contas/Cartões/Transações blocks.

---

## Task 8 — Verification + E2E (USER-IN-LOOP)

- [ ] `bun run test --run` — all green (new tests include aggregations + access-token, expect ~125+ total)
- [ ] `bunx tsc --noEmit && bun run lint && bun run build` — clean
- [ ] USER-IN-LOOP:

  1. Restart `bun run dev`
  2. Hard refresh `http://localhost:3001`
  3. Expect:
     - KPI row at top: Saldo total, Gastos do mês, Receita do mês
     - Two charts side-by-side: donut (gastos por categoria) + line (6 meses)
     - Existing Contas / Cartões / Transações sections below
  4. Test cron locally:
     ```bash
     curl -s "http://localhost:3001/api/cron/sync" \
       -H "x-cron-secret: $CRON_SECRET" | jq
     ```
     Expected: `{ "ok": true, "processed": 1, "results": [...] }`
     If `CRON_SECRET` is not set in `.env.local`, **add it**:
     ```
     CRON_SECRET=<openssl rand -hex 32>
     ```
     Restart dev after editing `.env.local`.
  5. Verify in Mongo: `sync_runs` shows a fresh row with `triggeredBy: "cron"`.

---

## What this phase produces

| Artifact | Used by |
|---|---|
| `lib/aggregations/*` | Phase 5 /transactions page filters use similar patterns |
| `lib/auth/access-token.ts` | Phase 5 backfill scripts, other background workers |
| `vercel.json` | Production cron job in Vercel |
| `components/dashboard/*` | Future polish: KPI variants, more charts |

**Open items for Phase 5:**
1. `/transactions` page with date/category/account filters
2. Inline category editor on transactions list (dropdown + PATCH call)
3. `/api/profile/delete` (LGPD)
4. `/dev/logs` page (server admin)
5. Production deploy guide (Vercel + Atlas + Cognito DCR migration)

**User preference reminder:** do not run any `git` command.
