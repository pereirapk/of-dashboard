# Phase 3 — Categorization (MCC rules + LLM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every transaction useful by classifying it into a category. Tier 1 is a deterministic MCC → category map (free, fast, covers ~80% of credit-card transactions). Tier 2 is Claude Haiku via the Anthropic SDK with prompt caching (handles account transactions without MCC, and unmapped MCCs). User override always wins. After this phase, the dashboard shows a category badge on every recognized transaction, and total spending can be sliced by category.

**Out of scope** (deferred):
- Cron + daily auto-sync → **Phase 4**
- Dashboard polish (KPI cards, donut, line chart) → **Phase 4**
- `/transactions` dedicated page with filters → **Phase 4**
- LGPD delete + dev logs + deploy → **Phase 5**

**Architecture:**

```
Sync runner finishes upserts
  → dispatchCategorization(db, userId)
      → Tier 1 (MCC rules) — fast, in-memory
          ├─ For each tx where category=null and source=credit_card and mcc != null:
          │    map MCC → category slug (or null if not in map)
          └─ Bulk-update category + categorySource="mcc"
      → Tier 2 (LLM) — only for remaining null txs
          ├─ Build prompt:
          │    system (cached): rules + category slug list
          │    user context (cached per user, 5min): 50 most recent categorized txs
          │    user current: batch of up to 50 uncategorized txs
          ├─ Anthropic SDK → claude-haiku-4-5
          ├─ Parse { transactionId, category, confidence } per row
          └─ Bulk-update category + categorySource="llm" for confidence ≥ 0.7
```

If `ANTHROPIC_API_KEY` is missing, Tier 2 silently no-ops (transactions stay null). MCC tier always runs.

**User override:** PATCH `/api/transactions/[id]/category` sets `category` + `categorySource="user"`. Override wins; subsequent LLM runs use it as few-shot context.

**Tech additions:**
- `@anthropic-ai/sdk` (new dep)
- `categories` MongoDB collection (seeded once)
- `lib/categorize/*` module

**User preferences (memory):**
- No `git` commands. User manages git state.
- Mongo Atlas free tier confirmed.

---

## Pre-flight — what already exists

```
lib/mcp/{client,errors,quotas,tools,types,_transport}.ts
lib/repositories/{accounts,connections,mcp-call-logs,rate-limits,snapshots,sync-runs,transactions}.ts
lib/sync/{runner,ensure-connection}.ts
lib/format/money.ts
lib/crypto.ts
lib/mongo.ts
lib/auth.ts                                   (refresh-token aware)
app/(app)/{layout,page,connect-bank/page}.tsx
app/api/{auth/[...nextauth],sync}/route.ts
components/{Money,sync/SyncNowButton,auth/SignInWithCumbuca,auth/ConnectCumbucaButton,ui/Button}.tsx
proxy.ts
.env.local                                    (ANTHROPIC_API_KEY may still be empty)
```

`transactions` collection already has `category: string | null` and `categorySource: "mcc"|"llm"|"user"|null` fields per the schema in `lib/repositories/transactions.ts`.

---

## Files this phase will create or touch

```
Create:
  lib/categorize/mcc-map.ts                   // static MCC → category slug map
  lib/categorize/by-mcc.ts                    // function: tx → category slug | null
  lib/categorize/by-llm.ts                    // Anthropic call with prompt caching
  lib/categorize/dispatcher.ts                // orchestrates both tiers
  lib/categorize/types.ts                     // CategorizationResult shape
  lib/repositories/categories.ts              // CRUD for `categories` collection + seed
  lib/seed/categories.ts                      // seed data (categories list)
  app/api/categorize/route.ts                 // optional debug endpoint to re-categorize (manual trigger)
  app/api/transactions/[id]/category/route.ts // PATCH: user override
  tests/lib/categorize/by-mcc.test.ts
  tests/lib/categorize/dispatcher.test.ts
  tests/lib/categorize/by-llm.test.ts         // mocks Anthropic SDK
  tests/lib/seed/categories.test.ts

Modify:
  package.json                                // add @anthropic-ai/sdk
  lib/sync/runner.ts                          // call dispatcher at end of run
  app/(app)/page.tsx                          // show category badge on each transaction
  components/Money.tsx                        // (no change; reference)
```

---

## Task 0 — Add Anthropic SDK + verify

- [ ] **Step 1:**
  ```bash
  bun add @anthropic-ai/sdk
  ```
- [ ] **Step 2:** `bunx tsc --noEmit` clean.

---

## Task 1 — Categories seed + repository

**Files:**
- Create: `lib/seed/categories.ts`, `lib/repositories/categories.ts`, `tests/lib/seed/categories.test.ts`

### lib/seed/categories.ts

```ts
export interface CategorySeed {
  slug: string;          // canonical id, used in transactions.category
  labelPt: string;       // pt-BR display label
  icon: string;          // emoji or named key
  color: string;         // hex
  displayOrder: number;  // for sorted UI lists
}

export const CATEGORY_SEEDS: CategorySeed[] = [
  { slug: "groceries",     labelPt: "Mercado",         icon: "🛒", color: "#22c55e", displayOrder: 10 },
  { slug: "restaurants",   labelPt: "Alimentação",      icon: "🍽️", color: "#f97316", displayOrder: 20 },
  { slug: "transport",     labelPt: "Transporte",       icon: "🚗", color: "#0ea5e9", displayOrder: 30 },
  { slug: "gas",           labelPt: "Combustível",     icon: "⛽", color: "#eab308", displayOrder: 40 },
  { slug: "health",        labelPt: "Saúde",            icon: "💊", color: "#ef4444", displayOrder: 50 },
  { slug: "utilities",     labelPt: "Contas/Utilidades", icon: "💡", color: "#a855f7", displayOrder: 60 },
  { slug: "telecom",       labelPt: "Telecom",          icon: "📱", color: "#8b5cf6", displayOrder: 70 },
  { slug: "shopping",      labelPt: "Compras",          icon: "🛍️", color: "#ec4899", displayOrder: 80 },
  { slug: "entertainment", labelPt: "Entretenimento",    icon: "🎬", color: "#f59e0b", displayOrder: 90 },
  { slug: "subscriptions", labelPt: "Assinaturas",       icon: "🔁", color: "#14b8a6", displayOrder: 100 },
  { slug: "education",     labelPt: "Educação",         icon: "📚", color: "#3b82f6", displayOrder: 110 },
  { slug: "services",      labelPt: "Serviços",         icon: "🔧", color: "#64748b", displayOrder: 120 },
  { slug: "transfers",     labelPt: "Transferências",    icon: "↔️", color: "#94a3b8", displayOrder: 130 },
  { slug: "fees",          labelPt: "Taxas/Encargos",    icon: "⚖️", color: "#dc2626", displayOrder: 140 },
  { slug: "income",        labelPt: "Receita",          icon: "💰", color: "#16a34a", displayOrder: 150 },
  { slug: "other",         labelPt: "Outros",           icon: "❓", color: "#71717a", displayOrder: 999 },
];

/** All valid category slugs (used for input validation). */
export const CATEGORY_SLUGS = new Set(CATEGORY_SEEDS.map((c) => c.slug));
```

### lib/repositories/categories.ts

```ts
import type { Db } from "mongodb";
import { CATEGORY_SEEDS, type CategorySeed } from "@/lib/seed/categories";

export interface CategoryDoc {
  _id: string;          // = slug
  labelPt: string;
  icon: string;
  color: string;
  displayOrder: number;
}

const COLLECTION = "categories";

export async function seedCategories(db: Db): Promise<void> {
  for (const c of CATEGORY_SEEDS) {
    await db.collection<CategoryDoc>(COLLECTION).updateOne(
      { _id: c.slug },
      { $set: { labelPt: c.labelPt, icon: c.icon, color: c.color, displayOrder: c.displayOrder } },
      { upsert: true }
    );
  }
}

export async function findAllCategories(db: Db): Promise<CategoryDoc[]> {
  return db
    .collection<CategoryDoc>(COLLECTION)
    .find()
    .sort({ displayOrder: 1 })
    .toArray();
}
```

### Test (TDD)

Cover: seed inserts all, second seed is idempotent (no duplicates), `findAllCategories` returns sorted, slugs match seed list.

- [ ] Standard TDD: tests first → FAIL → impl → PASS.

---

## Task 2 — MCC map + by-mcc categorizer

**Files:**
- Create: `lib/categorize/mcc-map.ts`, `lib/categorize/by-mcc.ts`, `lib/categorize/types.ts`
- Create: `tests/lib/categorize/by-mcc.test.ts`

### lib/categorize/types.ts

```ts
export interface CategorizationResult {
  transactionId: string;        // mongo _id as hex
  category: string;             // category slug
  source: "mcc" | "llm";
  confidence?: number;          // 0-1, only for LLM
}
```

### lib/categorize/mcc-map.ts

Curated subset of ISO 18245 MCCs mapped to our category slugs. Coverage: ~80% of typical BR consumer credit-card transactions.

```ts
/** ISO 18245 Merchant Category Code → our category slug. */
export const MCC_TO_CATEGORY: Record<number, string> = {
  // Groceries
  5411: "groceries",  // Grocery stores, supermarkets
  5422: "groceries",  // Freezer and locker meat
  5462: "groceries",  // Bakeries
  5499: "groceries",  // Misc food stores

  // Restaurants & food
  5811: "restaurants",  // Caterers
  5812: "restaurants",  // Eating places, restaurants
  5813: "restaurants",  // Drinking places, bars
  5814: "restaurants",  // Fast food

  // Transport
  4111: "transport",
  4112: "transport",   // Passenger railways
  4121: "transport",   // Taxis, limos
  4131: "transport",   // Bus lines
  4784: "transport",   // Tolls
  4789: "transport",

  // Gas
  5541: "gas",
  5542: "gas",         // Automated fuel
  5172: "gas",         // Petroleum

  // Health
  5912: "health",      // Drug stores, pharmacies
  5975: "health",
  8011: "health",      // Doctors
  8021: "health",      // Dentists
  8050: "health",
  8062: "health",      // Hospitals
  8099: "health",

  // Utilities
  4900: "utilities",   // Electric, gas, water

  // Telecom
  4812: "telecom",
  4814: "telecom",
  4899: "telecom",     // Cable, satellite (could be entertainment but most subs are pay-TV)

  // Shopping
  5200: "shopping", 5310: "shopping", 5311: "shopping", 5331: "shopping",
  5621: "shopping", 5651: "shopping", 5661: "shopping", 5691: "shopping",
  5712: "shopping",     // Furniture
  5722: "shopping",     // Household appliances
  5732: "shopping",     // Electronics
  5942: "shopping",     // Book stores
  5944: "shopping",     // Jewelry
  5945: "shopping",     // Hobby, toy
  5947: "shopping",     // Gift, novelty
  5999: "shopping",

  // Subscriptions / digital goods
  5818: "subscriptions",
  5968: "subscriptions",
  5969: "subscriptions",

  // Entertainment
  7832: "entertainment",
  7841: "entertainment",
  7922: "entertainment",
  7929: "entertainment",
  7991: "entertainment",
  7994: "entertainment",
  7997: "entertainment",
  7999: "entertainment",

  // Education
  8211: "education",
  8220: "education",     // Colleges, universities
  8241: "education",
  8244: "education",
  8249: "education",
  8299: "education",

  // Services
  7230: "services",      // Hairdressers
  7311: "services",
  7321: "services",
  7349: "services",
  7392: "services",
  7399: "services",
  8999: "services",      // Misc professional services

  // Transfers
  4829: "transfers",
  6010: "transfers",
  6011: "transfers",
  6051: "transfers",

  // Fees
  6300: "fees",          // Insurance
  6211: "fees",          // Securities
  9311: "fees",          // Tax
  9399: "fees",
};
```

### lib/categorize/by-mcc.ts

```ts
import { MCC_TO_CATEGORY } from "./mcc-map";

/** Returns category slug for an MCC, or null if not mapped. */
export function categoryForMcc(mcc: number | null | undefined): string | null {
  if (mcc == null) return null;
  return MCC_TO_CATEGORY[mcc] ?? null;
}
```

### Tests

```ts
import { describe, it, expect } from "vitest";
import { categoryForMcc } from "@/lib/categorize/by-mcc";
import { CATEGORY_SLUGS } from "@/lib/seed/categories";

describe("categoryForMcc", () => {
  it.each([
    [5411, "groceries"],
    [5814, "restaurants"],
    [5541, "gas"],
    [5912, "health"],
    [4814, "telecom"],
    [4900, "utilities"],
    [8220, "education"],
    [7230, "services"],
    [5942, "shopping"],
    [5818, "subscriptions"],
  ])("maps MCC %i → %s", (mcc, expected) => {
    expect(categoryForMcc(mcc)).toBe(expected);
  });

  it("returns null for unmapped MCC", () => {
    expect(categoryForMcc(1234)).toBeNull();
    expect(categoryForMcc(9999)).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(categoryForMcc(null)).toBeNull();
    expect(categoryForMcc(undefined)).toBeNull();
  });

  it("every mapped category is in the seed slug list", async () => {
    const { MCC_TO_CATEGORY } = await import("@/lib/categorize/mcc-map");
    for (const slug of Object.values(MCC_TO_CATEGORY)) {
      expect(CATEGORY_SLUGS.has(slug)).toBe(true);
    }
  });
});
```

- [ ] Standard TDD.

---

## Task 3 — LLM categorizer (Anthropic + prompt caching)

**Files:**
- Create: `lib/categorize/by-llm.ts`
- Create: `tests/lib/categorize/by-llm.test.ts`

⚠️ **REQUIRED SKILL FOR IMPLEMENTER:** invoke the `claude-api` skill before writing this file. It contains the canonical prompt-caching pattern for Claude Haiku, the latest model id, and the streaming/blocking modes.

### Public API

```ts
import type { TransactionDoc } from "@/lib/repositories/transactions";
import type { CategorizationResult } from "./types";

export interface LlmCategorizerOptions {
  /** Maximum batch size sent to Claude in a single call. */
  batchSize?: number;             // default 50
}

/**
 * Categorize a batch of uncategorized transactions via Claude Haiku.
 * Returns an array of results — one per input transaction. Confidence < 0.7
 * is signalled by omitting the row (caller leaves them uncategorized).
 *
 * If `ANTHROPIC_API_KEY` is missing, returns an empty array (no-op) so the
 * caller can proceed without a hard dependency on the API key in dev.
 */
export async function categorizeByLlm(
  uncategorized: TransactionDoc[],
  fewShot: TransactionDoc[],          // user's recently categorized txs
  opts: LlmCategorizerOptions = {}
): Promise<CategorizationResult[]>;
```

### Implementation specifics (key points — implementer reads claude-api skill for full pattern)

- Model: `claude-haiku-4-5` (latest Haiku at time of writing)
- System prompt: fixed string explaining categories + format. Mark as `cache_control: { type: "ephemeral" }`.
- User context: few-shot of `fewShot` JSON lines. Mark as `cache_control` separately (per-user cache).
- User content: the uncategorized batch as JSON lines with `transactionId, description, amount, source, mcc?`.
- Response format: explicit instruction to reply ONLY with valid JSON `{ "categorizations": [{ "transactionId", "category", "confidence" }] }`.
- Validate response with Zod; drop rows with `category` not in `CATEGORY_SLUGS` or `confidence < 0.7`.
- Wrap call in try/catch — on any failure return `[]`. Log error to stderr.

### Tests

Mock `@anthropic-ai/sdk` so no network call happens.

Cover:
- happy path: 5 txs in, 5 results out
- API key missing → empty array
- Anthropic returns malformed JSON → empty array, logs error
- Low-confidence row is filtered out
- Invalid category slug is filtered out
- Batches larger than `batchSize` are split into multiple calls

- [ ] Standard TDD.

---

## Task 4 — Dispatcher

**Files:**
- Create: `lib/categorize/dispatcher.ts`
- Create: `tests/lib/categorize/dispatcher.test.ts`

### API

```ts
export interface DispatchCategorizationResult {
  mccCategorized: number;
  llmCategorized: number;
  remaining: number;
}

export async function dispatchCategorization(
  db: Db,
  userId: string,
  opts: { skipLlm?: boolean } = {}
): Promise<DispatchCategorizationResult>;
```

### Behavior

1. Read up to N (default 200) most recent transactions for `userId` with `category=null`.
2. **Tier 1 — MCC:** for each transaction with `source="credit_card"` and `mcc != null`, call `categoryForMcc`. If result not null, queue for bulk-update (`category=<slug>`, `categorySource="mcc"`, `categorizedAt=now`). Apply updates.
3. **Tier 2 — LLM:** for remaining `category=null` transactions, fetch `fewShot` (the user's 50 most recently categorized transactions — `category != null`, source order desc). Call `categorizeByLlm`. Bulk-update returned rows (`category=<slug>`, `categorySource="llm"`, `categorizedAt=now`). Skip if `opts.skipLlm`.
4. Return counts.

### Tests

- Mock `categorizeByLlm` to return canned results.
- Verify MCC tier applies before LLM tier.
- Verify LLM is only called for transactions the MCC tier didn't cover.
- Verify `skipLlm: true` bypasses Tier 2.
- Verify bulk updates write `categorizedAt` and `categorySource`.
- Verify already-categorized transactions are NOT touched.

- [ ] Standard TDD.

---

## Task 5 — Integrate dispatcher into sync runner

**Files:**
- Modify: `lib/sync/runner.ts`
- Update: `lib/repositories/sync-runs.ts` (extend `SyncRunStats` with `mccCategorized`, `llmCategorized`)
- Update: `tests/lib/sync/runner.test.ts`

### Changes

- After all upserts (right before computing final status), call:
  ```ts
  try {
    const cat = await dispatchCategorization(db, conn.userId);
    stats.mccCategorized = cat.mccCategorized;
    stats.llmCategorized = cat.llmCategorized;
  } catch (err) {
    recordError(stats, "categorize", err);
  }
  ```
- Update `SyncRunStats`:
  ```ts
  export interface SyncRunStats {
    transactionsFetched: number;
    transactionsNew: number;
    accountsUpdated: number;
    snapshotsWritten: number;
    mccCategorized: number;
    llmCategorized: number;
    errors: Array<{ tool: string; kind: string; message: string }>;
  }
  ```
- Update `EMPTY_STATS` accordingly.
- Update runner unit tests to mock `dispatchCategorization` and expect the new stat fields.

⚠️ Adjust `app/api/sync/route.ts` if it constructs `EMPTY_STATS`-shape stats anywhere (it does for the crashed-runner fallback) — add the new fields with `0`.

---

## Task 6 — User-override endpoint

**Files:**
- Create: `app/api/transactions/[id]/category/route.ts`
- Create: `tests/api/transactions-category.test.ts` (optional; can defer to Phase 4)

### Behavior

`PATCH /api/transactions/:id/category` body `{ category: string | null }`. Validate:
- session.user.id matches transaction's userId
- category is in CATEGORY_SLUGS or null
- transaction `_id` parses as ObjectId

Action:
- Update `category`, set `categorySource="user"`, `categorizedAt=now`.
- Return `{ ok: true }` or appropriate error.

```ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { CATEGORY_SLUGS } from "@/lib/seed/categories";

const BodySchema = z.object({
  category: z.union([
    z.string().refine((s) => CATEGORY_SLUGS.has(s), "unknown category"),
    z.null(),
  ]),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ ok: false, error: body.error.message }, { status: 400 });
  }
  const db = await getDb();
  const result = await db.collection("transactions").updateOne(
    { _id: objectId, userId: session.user.id },
    {
      $set: {
        category: body.data.category,
        categorySource: body.data.category ? "user" : null,
        categorizedAt: body.data.category ? new Date() : null,
        updatedAt: new Date(),
      },
    }
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

---

## Task 7 — Dashboard shows category badges

**Files:**
- Modify: `app/(app)/page.tsx`
- Create: `components/transactions/CategoryBadge.tsx`

### CategoryBadge

```tsx
import { CATEGORY_SEEDS } from "@/lib/seed/categories";

const BY_SLUG = new Map(CATEGORY_SEEDS.map((c) => [c.slug, c]));

export function CategoryBadge({
  slug,
  source,
}: {
  slug: string | null;
  source: "mcc" | "llm" | "user" | null;
}) {
  if (!slug) return <span className="text-xs opacity-50">—</span>;
  const c = BY_SLUG.get(slug);
  if (!c) return <span className="text-xs opacity-50">{slug}</span>;
  const sourceMark =
    source === "user" ? "✱" : source === "mcc" ? "" : source === "llm" ? "·" : "";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: `${c.color}22`, color: c.color }}
      title={`${c.labelPt} · ${source ?? "n/a"}`}
    >
      <span>{c.icon}</span>
      <span>{c.labelPt}</span>
      {sourceMark && <span className="opacity-60">{sourceMark}</span>}
    </span>
  );
}
```

### Dashboard transaction row update

In `app/(app)/page.tsx`, in the transactions section, add a third column (or inline element) showing `<CategoryBadge slug={t.category} source={t.categorySource} />` next to the description.

---

## Task 8 — Optional: re-categorize endpoint (debug)

**Files:**
- Create: `app/api/categorize/route.ts`

Simple POST that calls `dispatchCategorization(db, session.user.id)` and returns the result. Useful for testing without re-running a full sync. Rate-limited like `/api/sync` (1/60s).

If time-constrained, skip this and rely on running a full sync to trigger categorization. Keep as a stretch goal.

---

## Task 9 — End-to-end verification + USER-IN-LOOP

- [ ] `bun run test --run` — all green
- [ ] `bunx tsc --noEmit && bun run lint && bun run build` — clean
- [ ] USER-IN-LOOP:
  1. Restart `bun run dev`
  2. Hard refresh `http://localhost:3001`
  3. Click "Sincronizar agora" — expect `XX novas / 76 fetched · mcc:N · llm:M` style feedback (after Task 5 we surface counts)
  4. Dashboard transactions now show category badges (mercado, alimentação, transporte, etc.)
  5. Click a category badge / dropdown (if you add a quick dropdown) → category override → row updates with ✱ marker

  Verify in Mongo:
  ```
  db.transactions.find({ userId: "<your-id>", categorySource: "mcc" }).count()
  db.transactions.find({ userId: "<your-id>", categorySource: "llm" }).count()
  db.transactions.find({ userId: "<your-id>", category: null }).count()
  db.categories.find()
  ```

  Expected (rough): MCC tier catches most credit-card transactions; LLM picks up account transactions (Pix, transfers, fees). A handful may remain null (truly ambiguous).

---

## What this phase produces (handoff to Phase 4)

| Artifact | Used by |
|---|---|
| `categories` collection (seeded) | Phase 4 donut chart, filters |
| `lib/categorize/*` | Phase 4 backfill scripts if MCC map changes |
| `transactions.category` populated | Phase 4 KPI cards, /transactions filters |
| `/api/transactions/[id]/category` | Phase 4 inline edit on the transactions list |

**Open items for Phase 4:**
1. Cron + daily auto-sync
2. KPI cards (total balance, monthly spending, savings goal placeholder)
3. Spending donut by category (Recharts)
4. Trend line chart
5. `/transactions` dedicated page with filters
6. Inline category editor on transactions

**Phase 5:** LGPD delete + dev logs + production deploy.

**User preference reminder:** do not run any `git` command.
