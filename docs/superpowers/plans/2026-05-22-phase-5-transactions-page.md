# Phase 5 — `/transactions` page with filters + inline category editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Transações" sidebar link real — a dedicated page that lists ALL of the user's transactions with date/account/category/source/search filters, pagination, and an inline dropdown to override category on any row. After this phase the user has full visibility and control over their transaction stream.

**Out of scope** (Phase 6):
- `/accounts` drill-down page
- `/settings` page + LGPD delete
- `/dev/logs` admin page
- Production deploy guide

**Architecture:**

```
GET /transactions[?from=YYYY-MM-DD&to=YYYY-MM-DD&category=slug&account=id&source=account|credit_card&q=text&page=N]
  → server component
  → builds Mongo query from URL params (Zod-validated)
  → paginates (50/page, page=N)
  → renders <TransactionFilters /> (client) + <TransactionList /> (server)
  → each row has <CategoryEditor /> (client) which PATCHes /api/transactions/[id]/category

Sidebar "Transações" item → enabled, navigates to /transactions
```

**Tech additions:** none — uses existing stack. URL search params drive state (no client-side state library).

**User preferences (memory):**
- No `git` commands.
- Mongo Atlas free tier.

---

## Pre-flight — what already exists

```
lib/repositories/transactions.ts            (findRecentTransactionsByUser, TransactionDoc)
lib/seed/categories.ts                      (CATEGORY_SEEDS, CATEGORY_SLUGS)
lib/repositories/accounts.ts                (findAccountsByUser)
app/api/transactions/[id]/category/route.ts (PATCH user override — already built Phase 3)
components/transactions/CategoryBadge.tsx
components/layout/{Sidebar,Topbar}.tsx      (sidebar has "Transações" disabled — to enable)
app/(app)/{layout,page}.tsx                 (shell wraps all (app)/* routes)
```

---

## Files this phase will create or touch

```
Create:
  lib/repositories/transactions.ts                          // extend with paginated query
  app/(app)/transactions/page.tsx                           // /transactions server component
  components/transactions/TransactionFilters.tsx            // client — date/category/account/source/search via URL params
  components/transactions/TransactionList.tsx               // server — renders rows + pagination
  components/transactions/CategoryEditor.tsx                // client — dropdown + PATCH call
  components/ui/Select.tsx                                  // small native-styled <select>
  tests/lib/repositories/transactions-find.test.ts          // findFiltered tests

Modify:
  lib/repositories/transactions.ts                          // add findFilteredTransactionsByUser + countFilteredTransactionsByUser
  components/layout/Sidebar.tsx                             // remove disabled flag on /transactions
```

---

## Task 1 — Extend `transactions.ts` repository with filtered query + count (TDD)

**Files:**
- Modify: `lib/repositories/transactions.ts`
- Create: `tests/lib/repositories/transactions-find.test.ts`

Add two functions:

```ts
export interface TransactionFilter {
  userId: string;
  from?: Date;           // inclusive
  to?: Date;             // exclusive
  category?: string | null;       // exact match; null = uncategorized
  bankAccountId?: string;
  source?: "account" | "credit_card";
  q?: string;            // matches `description` (case-insensitive contains)
}

export interface PaginatedTransactions {
  rows: TransactionDoc[];
  total: number;
  page: number;        // 1-based
  pageSize: number;
  totalPages: number;
}

export async function findFilteredTransactionsByUser(
  db: Db,
  filter: TransactionFilter,
  page: number = 1,
  pageSize: number = 50
): Promise<PaginatedTransactions>;
```

Implementation: build a Mongo `find` query from filter, with `regex` for `q` (escape special chars). Sort by `date` desc. Count + page in parallel.

```ts
function buildQuery(filter: TransactionFilter): Filter<TransactionDoc> {
  const q: Filter<TransactionDoc> = { userId: filter.userId };
  if (filter.from || filter.to) {
    q.date = {};
    if (filter.from) q.date.$gte = filter.from;
    if (filter.to) q.date.$lt = filter.to;
  }
  if (filter.category !== undefined) {
    // null means "uncategorized" — distinct from "not provided"
    q.category = filter.category;
  }
  if (filter.bankAccountId) q.bankAccountId = filter.bankAccountId;
  if (filter.source) q.source = filter.source;
  if (filter.q) {
    const escaped = filter.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q.description = { $regex: escaped, $options: "i" };
  }
  return q;
}
```

### Tests (TDD)

Seed ~30 mixed transactions across 2 users, 2 accounts, multiple months, multiple categories. Verify:

- No filter: returns all of user's txns, paginated.
- Date range narrows to that month.
- Category filter (slug + `null` for uncategorized) — both work.
- Account scope.
- Source filter (account vs credit_card).
- Search `q` matches description case-insensitively.
- Combined filters compose correctly.
- Pagination: `page=2, pageSize=10` skips 10, returns 10. `totalPages` correct.
- Scopes by userId — never leaks other user's rows.

Expected: ~10 tests.

⚠️ **Use Phase 0 fixtures** if helpful (e.g., already-shaped transactions in `tests/mcp/fixtures/`), but most tests will manually seed via `db.collection("transactions").insertMany([...])`.

---

## Task 2 — `/transactions` page (server) — basic, no filters yet

**Files:**
- Create: `app/(app)/transactions/page.tsx`
- Create: `components/transactions/TransactionList.tsx`

### TransactionList.tsx (server component)

Renders the table-like list and pagination links.

```tsx
import Link from "next/link";
import type { TransactionDoc } from "@/lib/repositories/transactions";
import { Money } from "@/components/Money";
import { CategoryBadge } from "@/components/transactions/CategoryBadge";
import { CategoryEditor } from "./CategoryEditor";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

export function TransactionList({
  rows,
  total,
  page,
  totalPages,
  searchParams,
}: {
  rows: TransactionDoc[];
  total: number;
  page: number;
  totalPages: number;
  searchParams: Record<string, string>;
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
      <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
        {rows.map((t) => (
          <li
            key={t._id.toHexString()}
            className="flex items-center justify-between py-3 px-3 gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{t.description}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <CategoryEditor
                  transactionId={t._id.toHexString()}
                  current={t.category}
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
      <PaginationBar page={page} totalPages={totalPages} total={total} searchParams={searchParams} />
    </div>
  );
}

function PaginationBar({
  page, totalPages, total, searchParams,
}: { page: number; totalPages: number; total: number; searchParams: Record<string, string> }) {
  const buildLink = (p: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(p));
    return `/transactions?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-xs opacity-70">
      <span>
        Página {page} de {totalPages} · {total} transações
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={buildLink(page - 1)} className="underline">
            Anterior
          </Link>
        )}
        {page < totalPages && (
          <Link href={buildLink(page + 1)} className="underline">
            Próxima
          </Link>
        )}
      </div>
    </div>
  );
}
```

### app/(app)/transactions/page.tsx

```tsx
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findFilteredTransactionsByUser } from "@/lib/repositories/transactions";
import { findAccountsByUser } from "@/lib/repositories/accounts";
import { TransactionList } from "@/components/transactions/TransactionList";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { parseFiltersFromSearchParams } from "@/lib/transactions/filter-parser";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

  const db = await getDb();
  const accounts = await findAccountsByUser(db, userId);

  const result = await findFilteredTransactionsByUser(
    db,
    { userId, ...filters },
    filters.page ?? 1,
    50
  );

  return (
    <main className="p-6 space-y-4">
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
        searchParams={params}
      />
    </main>
  );
}
```

---

## Task 3 — Filter parser + helper module

**Files:**
- Create: `lib/transactions/filter-parser.ts`
- Create: `tests/lib/transactions/filter-parser.test.ts`

```ts
import type { TransactionFilter } from "@/lib/repositories/transactions";

export interface ParsedFilters extends Omit<TransactionFilter, "userId"> {
  page?: number;
}

/**
 * Decode URL search params into typed filters. Invalid values are silently
 * dropped. The userId is added by the caller (server component).
 */
export function parseFiltersFromSearchParams(
  params: Record<string, string | string[] | undefined>
): ParsedFilters {
  const out: ParsedFilters = {};
  const get = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : undefined;
  };

  const from = get("from");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    out.from = new Date(`${from}T00:00:00.000Z`);
  }
  const to = get("to");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    out.to = new Date(`${to}T00:00:00.000Z`);
  }

  const category = get("category");
  if (category === "null") out.category = null;
  else if (category) out.category = category;

  const bankAccountId = get("account");
  if (bankAccountId) out.bankAccountId = bankAccountId;

  const source = get("source");
  if (source === "account" || source === "credit_card") out.source = source;

  const q = get("q");
  if (q && q.trim()) out.q = q.trim();

  const page = get("page");
  if (page) {
    const n = parseInt(page, 10);
    if (Number.isInteger(n) && n >= 1) out.page = n;
  }

  return out;
}
```

### Tests

- Empty params → empty object
- Valid YYYY-MM-DD strings → Date instances at UTC midnight
- Invalid date → skipped
- `category=null` → `null` (vs. `category=undefined` → omitted)
- Unknown `source` value → skipped
- `q` is trimmed
- `page` < 1 → skipped

---

## Task 4 — TransactionFilters (client component)

**Files:**
- Create: `components/transactions/TransactionFilters.tsx`
- Create: `components/ui/Select.tsx`

### Select.tsx (primitive)

```tsx
import { forwardRef } from "react";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", ...rest }, ref) => (
    <select
      ref={ref}
      className={`rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${className}`}
      {...rest}
    />
  )
);
Select.displayName = "Select";
```

### TransactionFilters.tsx

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";

export interface AccountOption {
  id: string;
  label: string;
}

export function TransactionFilters({
  accounts,
}: {
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  function applyFilter(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") params.delete(key);
    else params.set(key, value);
    params.delete("page"); // reset pagination on filter change
    router.push(`/transactions?${params.toString()}`);
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    applyFilter("q", q.trim() || null);
  }

  function clearAll() {
    router.push("/transactions");
    setQ("");
  }

  return (
    <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 flex flex-wrap items-center gap-2">
      <form onSubmit={applySearch} className="flex-1 min-w-[180px]">
        <input
          type="search"
          placeholder="Buscar descrição…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
        />
      </form>

      <Select
        value={searchParams.get("category") ?? ""}
        onChange={(e) => applyFilter("category", e.target.value || null)}
      >
        <option value="">Todas as categorias</option>
        <option value="null">Sem categoria</option>
        {CATEGORY_SEEDS.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.icon} {c.labelPt}
          </option>
        ))}
      </Select>

      <Select
        value={searchParams.get("source") ?? ""}
        onChange={(e) => applyFilter("source", e.target.value || null)}
      >
        <option value="">Todas as origens</option>
        <option value="account">Conta</option>
        <option value="credit_card">Cartão</option>
      </Select>

      <Select
        value={searchParams.get("account") ?? ""}
        onChange={(e) => applyFilter("account", e.target.value || null)}
      >
        <option value="">Todas as contas</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </Select>

      <input
        type="date"
        value={searchParams.get("from") ?? ""}
        onChange={(e) => applyFilter("from", e.target.value || null)}
        className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
      />
      <span className="text-xs opacity-60">→</span>
      <input
        type="date"
        value={searchParams.get("to") ?? ""}
        onChange={(e) => applyFilter("to", e.target.value || null)}
        className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm"
      />

      {Array.from(searchParams.keys()).filter((k) => k !== "page").length > 0 && (
        <Button variant="secondary" onClick={clearAll}>
          Limpar
        </Button>
      )}
    </div>
  );
}
```

---

## Task 5 — Inline category editor

**Files:**
- Create: `components/transactions/CategoryEditor.tsx`

Replaces `<CategoryBadge>` in the transactions list with an inline editable variant. Clicking the badge reveals a dropdown of categories; selecting one PATCHes `/api/transactions/[id]/category`. Uses optimistic UI + `router.refresh()` on success.

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_SEEDS } from "@/lib/seed/categories";
import { CategoryBadge } from "./CategoryBadge";

export function CategoryEditor({
  transactionId,
  current,
  source,
}: {
  transactionId: string;
  current: string | null;
  source: "mcc" | "llm" | "user" | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<string | null | undefined>(
    undefined
  );
  const [pending, setPending] = useState(false);

  async function patch(slug: string | null) {
    setOptimistic(slug);
    setPending(true);
    setOpen(false);
    try {
      const r = await fetch(`/api/transactions/${transactionId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: slug }),
      });
      if (!r.ok) {
        setOptimistic(undefined); // rollback
        return;
      }
      router.refresh();
    } catch {
      setOptimistic(undefined);
    } finally {
      setPending(false);
    }
  }

  const visibleSlug = optimistic !== undefined ? optimistic : current;
  const visibleSource: "mcc" | "llm" | "user" | null =
    optimistic !== undefined && optimistic !== null
      ? "user"
      : optimistic === null
      ? null
      : source;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="cursor-pointer disabled:opacity-50"
        aria-label="Mudar categoria"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CategoryBadge slug={visibleSlug} source={visibleSource} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-20 left-0 top-full mt-1 w-56 max-h-80 overflow-auto rounded-md border border-foreground/15 bg-background shadow-lg p-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={visibleSlug === null}
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-foreground/10"
            onClick={() => patch(null)}
          >
            — Sem categoria
          </button>
          {CATEGORY_SEEDS.map((c) => (
            <button
              key={c.slug}
              type="button"
              role="option"
              aria-selected={visibleSlug === c.slug}
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-foreground/10 flex items-center gap-2"
              onClick={() => patch(c.slug)}
            >
              <span>{c.icon}</span>
              <span>{c.labelPt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note: when the user opens the dropdown, clicking outside should close it. For MVP we skip click-outside — the dropdown closes when an option is picked. Phase 6 polish can add it.

Also: the `(app)/page.tsx` recent-transactions list keeps using the read-only `<CategoryBadge>` — only `/transactions` uses the editable variant.

---

## Task 6 — Enable Transações in the sidebar

**File:** `components/layout/Sidebar.tsx`

Remove `disabled: true` from the `/transactions` nav item. That's the only change.

---

## Task 7 — Final verification + USER-IN-LOOP

- [ ] `bun run test --run` — all green (new tests for find + parser)
- [ ] `bunx tsc --noEmit && bun run lint && bun run build` — clean
- [ ] USER-IN-LOOP:
  1. Restart `bun run dev`
  2. Navigate to dashboard, click "Transações" in the sidebar.
  3. See full list of 76+ transactions, paginated (50/page → ≥ 2 pages).
  4. Test filters:
     - Category dropdown → only that category shows
     - Account dropdown → only that account shows
     - Source dropdown → conta/cartão filter
     - Date range → narrows
     - Search by description → e.g. "AMAZON" finds Amazon rows
     - "Limpar" resets URL
  5. Click a category badge on a row → dropdown opens → pick a different category → row updates optimistically → server confirms → `categorySource` becomes "user" (✱ marker)
  6. Verify in Mongo:
     ```
     db.transactions.find({ categorySource: "user" }).count()
     // → matches the number of categories you changed
     ```

---

## What this phase produces (handoff to Phase 6)

| Artifact | Used by |
|---|---|
| `/transactions` page | User daily workflow |
| `CategoryEditor` | Reusable on `/accounts` detail (Phase 6 future) |
| `findFilteredTransactionsByUser` + `parseFiltersFromSearchParams` | Future export CSV, search APIs |

**Open items for Phase 6:**
1. `/accounts` drill-down page (balance history per account, transactions filtered to that account)
2. `/settings` page with profile + LGPD delete button
3. `/api/profile/delete` endpoint (calls `mcp:revoke_consent` then wipes user data)
4. `/dev/logs` admin page (`mcp_call_logs` browser, gated by env flag)
5. Production deploy guide

**User preference reminder:** do not run any `git` command.
