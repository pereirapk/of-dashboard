# Phase 2 — Sync Engine (real data flowing to Mongo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/api/sync` stub with a real, quota-aware sync runner that calls the Cumbuca MCP, persists accounts/transactions/snapshots in MongoDB, and surfaces stats to the UI. After this phase, clicking "Sincronizar agora" produces actual rows in `bank_accounts`, `transactions`, `balance_snapshots`, `sync_runs`, and `mcp_call_logs`. Dashboard reads from the populated DB.

**Out of scope** (deferred to later phases):
- Categorization (MCC rules + LLM) → **Phase 3**
- Cron + auto-sync → **Phase 4**
- Polished dashboard UI (charts, donut, KPI cards) → **Phase 4**
- LGPD delete + dev logs page + deploy → **Phase 5**

**Architecture:**

```
Browser → POST /api/sync
  → rateLimit(userId, 1/60s)
  → for each bank_connection with status="active":
      → runSync({ userId, bankConnectionId, triggeredBy: "manual" })
          → opens sync_runs row (status="running")
          → callMcpTool wrapper handles each tool:
              ├─ quota gate (bank_connections.quotaUsage)
              ├─ HTTP call with Bearer token
              ├─ Zod-validate response
              ├─ log to mcp_call_logs
              └─ throw McpError on failure
          → upsert into bank_accounts, transactions, balance_snapshots
          → close sync_runs (status, stats)
  → return JSON { ok, stats[], errors[] }
```

**Tech stack:** Already installed in Phase 1 — no new runtime deps. Dev: `vitest` continues. No Anthropic SDK yet (Phase 3).

**User preferences (memory):**
- No `git` commands during execution. User manages git state.
- Mongo Atlas free tier (M0). Connection in `.env.local`.

---

## Pre-flight — what already exists

```
lib/mongo.ts                                  // lazy singleton getDb()
lib/auth.ts                                   // Auth.js v5 + Keycloak; session.user.id mapped
lib/crypto.ts                                 // encrypt/decrypt/hashWithPepper
lib/format/money.ts                           // parseMcpAmountToCents, centsToBrl
lib/repositories/connections.ts               // upsertBankConnection, findActiveConnectionsByUser
lib/sync/ensure-connection.ts                 // creates bank_connection on first session — to be REFACTORED to use new wrapper
lib/mcp/tools.ts                              // Zod schemas for 7 read tools
lib/mcp/types.ts                              // inferred TS types
tests/lib/{crypto,format/money,repositories/connections}.test.ts
tests/mcp/{fixtures/*.json,tools.test.ts}
app/(app)/{layout,page,connect-bank/page}.tsx
app/api/{auth/[...nextauth],sync}/route.ts
proxy.ts                                      // security headers
.env.local with all secrets configured
```

The TEMP `console.log("[(app)/page] state: ...")` in `(app)/page.tsx` should be removed in Task 0 below.

---

## Files this phase will create or touch

```
Create:
  lib/mcp/errors.ts                           // McpError, QuotaExceededError, SchemaMismatchError
  lib/mcp/quotas.ts                           // bucket → monthly limit; helper to compute current month key
  lib/mcp/client.ts                           // callMcpTool wrapper
  lib/repositories/mcp-call-logs.ts           // insert + TTL setup
  lib/repositories/sync-runs.ts               // create/finish/find
  lib/repositories/accounts.ts                // upsertAccount, updateBalance, upsertCreditCard, find by user
  lib/repositories/transactions.ts            // bulkUpsert (with sign normalization + Pix-reversal filter)
  lib/repositories/snapshots.ts               // upsertDailySnapshot
  lib/repositories/rate-limits.ts             // enforceRateLimit (Mongo+TTL based)
  lib/sync/runner.ts                          // runSync orchestrator
  lib/sync/normalize.ts                       // shape converters: MCP → Mongo
  tests/lib/mcp/client.test.ts                // wrapper unit tests (mocked transport)
  tests/lib/mcp/quotas.test.ts
  tests/lib/repositories/{accounts,transactions,snapshots,sync-runs,rate-limits}.test.ts
  tests/lib/sync/{normalize,runner}.test.ts

Modify:
  lib/sync/ensure-connection.ts               // use callMcpTool wrapper instead of raw Client
  lib/repositories/connections.ts             // add findByIdForSync, incrementQuotaUsage helpers
  app/api/sync/route.ts                       // wire to runSync with rate limit
  app/(app)/page.tsx                          // remove TEMP debug log; query real accounts/transactions; render
  components/sync/SyncNowButton.tsx           // show structured stats from response
```

---

## Task 0 — Clean up Phase 1 debug + verify baseline

**Files:**
- Modify: `app/(app)/page.tsx` (remove TEMP console.log block)

- [ ] **Step 1:** Read `app/(app)/page.tsx`, find the block starting with `// TEMP — remove once Phase 1 E2E is confirmed end-to-end` and delete the whole `console.log("[(app)/page] state:", ...)` block.

- [ ] **Step 2:** Verify with `bunx tsc --noEmit && bun run test --run && bun run lint`. All green.

---

## Task 1 — MCP errors + quotas

**Files:**
- Create: `lib/mcp/errors.ts`, `lib/mcp/quotas.ts`
- Create: `tests/lib/mcp/quotas.test.ts`

- [ ] **Step 1: `lib/mcp/errors.ts`**

```ts
export type McpErrorKind =
  | "transport"
  | "auth"
  | "mcp_tool_error"
  | "schema_mismatch"
  | "timeout"
  | "quota_exceeded";

export class McpError extends Error {
  constructor(
    message: string,
    public kind: McpErrorKind,
    public details?: { code?: string | number; raw?: unknown }
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class QuotaExceededError extends McpError {
  constructor(public quotaBucket: string, public limit: number, public used: number) {
    super(
      `Quota exceeded for "${quotaBucket}": used ${used}/${limit} this month`,
      "quota_exceeded",
      { code: quotaBucket }
    );
    this.name = "QuotaExceededError";
  }
}
```

- [ ] **Step 2: `lib/mcp/quotas.ts`**

```ts
/**
 * Monthly per-user quotas observed during Phase 0 discovery.
 * See docs/mcp-discovery.md for source.
 */
export const QUOTA_LIMITS = {
  list_accounts: 8,
  account_detail: 8,
  account_balance: 420,
  account_txn_recent: 240,
  account_txn_historical: 8,
  // No documented quotas for credit-card tools — leave undefined; treat as
  // "unlimited" by skipping the gate.
  credit_cards: undefined,
  credit_card_bills: undefined,
  credit_card_bill_txns: undefined,
  consent_status: undefined,
  revoke_consent: undefined,
} as const;

export type QuotaBucket = keyof typeof QUOTA_LIMITS;

/** Current month key "YYYY-MM" in UTC, used to roll quotaUsage. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Map an MCP tool name to the quota bucket it consumes.
 * For `list_account_transactions`, the bucket depends on whether the date
 * range is fully within the last 7 days (recent endpoint) or extends
 * earlier (historical endpoint). Callers must compute this and pass the
 * right bucket explicitly.
 */
export function staticBucketForTool(tool: string): QuotaBucket | null {
  switch (tool) {
    case "list_accounts": return "list_accounts";
    case "get_account": return "account_detail"; // also "account_balance" in same call; caller may report both
    case "list_credit_cards": return "credit_cards";
    case "list_credit_card_bills": return "credit_card_bills";
    case "list_credit_card_bill_transactions": return "credit_card_bill_txns";
    case "get_consent_status": return "consent_status";
    case "revoke_consent": return "revoke_consent";
    case "list_account_transactions": return null; // caller decides
    default: return null;
  }
}
```

- [ ] **Step 3: TDD tests** for `staticBucketForTool` and `currentMonthKey`. Expect a small `tests/lib/mcp/quotas.test.ts` with ~5 cases. Verify date rollover at month boundary works in UTC.

---

## Task 2 — `mcp_call_logs` repository + TTL index

**Files:**
- Create: `lib/repositories/mcp-call-logs.ts`
- Create: `tests/lib/repositories/mcp-call-logs.test.ts`

- [ ] **Step 1: Define document shape and insert helper**

```ts
import type { Db, ObjectId } from "mongodb";

export interface McpCallLogDoc {
  _id: ObjectId;
  requestId: string;
  userId: string;
  bankConnectionId: string | null;
  syncRunId: string | null;
  tool: string;
  quotaBucket: string | null;
  quotaConsumed: boolean;        // false if cache-hit on MCP side (best-effort heuristic)
  triggeredBy: "manual" | "cron" | "callback";
  startedAt: Date;
  durationMs: number | null;     // null while running
  status: "running" | "ok" | "error" | "retry";
  errorKind: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  argsRedacted: unknown;
  responseSnippet: string | null;
  mcpRaw: unknown;
  createdAt: Date;
}

const COLLECTION = "mcp_call_logs";

export async function insertRunningLog(db: Db, input: Omit<McpCallLogDoc, "_id" | "durationMs" | "status" | "errorKind" | "errorCode" | "errorMessage" | "responseSnippet" | "mcpRaw" | "createdAt">): Promise<ObjectId> {
  const now = new Date();
  const doc: Omit<McpCallLogDoc, "_id"> = {
    ...input,
    durationMs: null,
    status: "running",
    errorKind: null,
    errorCode: null,
    errorMessage: null,
    responseSnippet: null,
    mcpRaw: null,
    createdAt: now,
  };
  const result = await db.collection<McpCallLogDoc>(COLLECTION).insertOne(doc as McpCallLogDoc);
  return result.insertedId;
}

export async function finishLogOk(db: Db, id: ObjectId, durationMs: number, responseSnippet: string): Promise<void> {
  await db.collection<McpCallLogDoc>(COLLECTION).updateOne(
    { _id: id },
    { $set: { durationMs, status: "ok", responseSnippet } }
  );
}

export async function finishLogError(db: Db, id: ObjectId, durationMs: number, errorKind: string, errorMessage: string, errorCode: string | null, mcpRaw: unknown): Promise<void> {
  await db.collection<McpCallLogDoc>(COLLECTION).updateOne(
    { _id: id },
    { $set: { durationMs, status: "error", errorKind, errorMessage, errorCode, mcpRaw } }
  );
}

/** Idempotent index creation, called once per process. */
export async function ensureMcpCallLogIndexes(db: Db): Promise<void> {
  const col = db.collection(COLLECTION);
  await Promise.all([
    col.createIndex({ userId: 1, startedAt: -1 }),
    col.createIndex({ syncRunId: 1 }),
    col.createIndex({ status: 1, startedAt: -1 }),
    col.createIndex({ quotaBucket: 1, startedAt: -1 }),
    // TTL — drop after 30 days
    col.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }),
  ]);
}
```

- [ ] **Step 2: Integration test** with `mongodb-memory-server`. Insert running → finishOk; insert running → finishError; verify indexes after `ensureMcpCallLogIndexes`.

---

## Task 3 — MCP client wrapper

**Files:**
- Create: `lib/mcp/client.ts`
- Create: `tests/lib/mcp/client.test.ts`

- [ ] **Step 1: Wrapper signature and behavior**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ulid } from "ulid";
import { z, type ZodTypeAny } from "zod";
import type { Db } from "mongodb";
import { McpError } from "./errors";
import { QUOTA_LIMITS, currentMonthKey, type QuotaBucket } from "./quotas";
import { insertRunningLog, finishLogOk, finishLogError } from "@/lib/repositories/mcp-call-logs";

const MCP_URL = process.env.CUMBUCA_MCP_URL ?? "https://mcp.cumbuca.com/mcp";

export interface CallMcpContext {
  db: Db;
  userId: string;
  bankConnectionId: string | null;
  syncRunId: string | null;
  triggeredBy: "manual" | "cron" | "callback";
  accessToken: string;
  quotaBucket: QuotaBucket | null;
  bypassCache?: boolean;
}

export async function callMcpTool<S extends ZodTypeAny>(
  ctx: CallMcpContext,
  tool: string,
  args: Record<string, unknown>,
  schema: S
): Promise<z.infer<S>> {
  const requestId = ulid();
  const startedAt = new Date();

  // 1. Quota gate (skipped if bucket has no documented limit, or bypass requested)
  if (ctx.quotaBucket && !ctx.bypassCache) {
    const limit = QUOTA_LIMITS[ctx.quotaBucket];
    if (typeof limit === "number") {
      const used = await readQuotaUsage(ctx.db, ctx.bankConnectionId, ctx.quotaBucket);
      if (used >= limit) {
        throw new McpError(
          `Quota exceeded for "${ctx.quotaBucket}": used ${used}/${limit}`,
          "quota_exceeded",
          { code: ctx.quotaBucket }
        );
      }
    }
  }

  // 2. Open transport + connect
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
  });
  const client = new Client(
    { name: "cumbuca-dashboard", version: "0.2.0" },
    { capabilities: {} }
  );

  // 3. Insert running log
  const logId = await insertRunningLog(ctx.db, {
    requestId,
    userId: ctx.userId,
    bankConnectionId: ctx.bankConnectionId,
    syncRunId: ctx.syncRunId,
    tool,
    quotaBucket: ctx.quotaBucket,
    quotaConsumed: !ctx.bypassCache, // best-effort; cache hits look identical from our side
    triggeredBy: ctx.triggeredBy,
    startedAt,
    argsRedacted: redactArgs(args),
  });

  try {
    await client.connect(transport);
    const raw = await client.callTool({ name: tool, arguments: args });

    // The SDK wraps tool output as { content: [{ type: "text", text: "..." }, ...] }
    const textContent = (raw.content as Array<{ type: string; text?: string }>)?.find(
      (c) => c.type === "text"
    )?.text;
    if (!textContent) {
      throw new McpError(`Tool "${tool}" returned no text content`, "mcp_tool_error", { raw });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      throw new McpError(`Tool "${tool}" returned non-JSON text`, "mcp_tool_error", { raw: textContent });
    }

    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new McpError(
        `Tool "${tool}" response did not match expected schema: ${validation.error.message}`,
        "schema_mismatch",
        { raw: parsed }
      );
    }

    const durationMs = Date.now() - startedAt.getTime();
    await finishLogOk(ctx.db, logId, durationMs, JSON.stringify(parsed).slice(0, 2048));

    // 4. Increment quota usage
    if (ctx.quotaBucket && !ctx.bypassCache && ctx.bankConnectionId) {
      await incrementQuotaUsage(ctx.db, ctx.bankConnectionId, ctx.quotaBucket);
    }

    return validation.data;
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    const mcpErr = err instanceof McpError ? err : new McpError(
      err instanceof Error ? err.message : String(err),
      "transport"
    );
    await finishLogError(
      ctx.db,
      logId,
      durationMs,
      mcpErr.kind,
      mcpErr.message,
      mcpErr.details?.code ? String(mcpErr.details.code) : null,
      mcpErr.details?.raw ?? null
    );
    throw mcpErr;
  } finally {
    try { await client.close(); } catch { /* swallow */ }
  }
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && /token|secret|password|cpf/i.test(k)) {
      out[k] = "***";
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function readQuotaUsage(db: Db, bankConnectionId: string | null, bucket: QuotaBucket): Promise<number> {
  if (!bankConnectionId) return 0;
  const conn = await db.collection("bank_connections").findOne(
    { _id: bankConnectionId },
    { projection: { quotaUsage: 1 } }
  );
  const usage = (conn?.quotaUsage ?? {}) as Record<string, number | string>;
  const month = currentMonthKey();
  if (usage.month !== month) return 0; // stale or unset → counts roll over
  return (usage[bucket] as number) ?? 0;
}

async function incrementQuotaUsage(db: Db, bankConnectionId: string, bucket: QuotaBucket): Promise<void> {
  const month = currentMonthKey();
  // Roll the month if needed and increment in one update.
  const existing = await db.collection("bank_connections").findOne(
    { _id: bankConnectionId },
    { projection: { quotaUsage: 1 } }
  );
  const current = (existing?.quotaUsage ?? {}) as Record<string, number | string>;
  if (current.month !== month) {
    await db.collection("bank_connections").updateOne(
      { _id: bankConnectionId },
      { $set: { quotaUsage: { month, [bucket]: 1 } } }
    );
  } else {
    await db.collection("bank_connections").updateOne(
      { _id: bankConnectionId },
      { $inc: { [`quotaUsage.${bucket}`]: 1 } }
    );
  }
}
```

- [ ] **Step 2: Tests** with `mongodb-memory-server`:
  - Quota gate throws `QuotaExceededError` when at limit
  - Quota gate bypassed when `bypassCache: true`
  - Successful call inserts running log + finishes ok + increments quota
  - Schema mismatch throws `McpError` with kind `"schema_mismatch"` and logs error
  - Transport error throws `McpError` with kind `"transport"` and logs error
  - Mock the SDK transport via `vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js")` or by injecting a fake client. The cleanest is to wrap the SDK call behind an internal `_invokeTool(client, tool, args)` helper that tests can stub via `vi.spyOn`.

⚠️ **Adapt:** If injecting via spy is awkward, factor the SDK glue into a small helper file (`lib/mcp/_transport.ts`) with `invokeTool(token, tool, args): Promise<rawResult>` so tests can mock that instead of the SDK.

---

## Task 4 — Refactor `ensure-connection.ts` to use the wrapper

**Files:**
- Modify: `lib/sync/ensure-connection.ts`

- [ ] **Step 1:** Replace the raw `Client.callTool` block in `ensureBankConnection` with a `callMcpTool(ctx, "get_consent_status", {}, ConsentStatusResponse)` call. Pass `quotaBucket: "consent_status"` (which has no limit, so gate is a no-op but the log gets a bucket label). Pass `triggeredBy: "callback"`.

- [ ] **Step 2: Ensure indexes** by calling `ensureMcpCallLogIndexes(db)` lazily — wrap in a once-only guard:

```ts
let indexesEnsured = false;
async function ensureIndexes(db: Db) {
  if (indexesEnsured) return;
  await ensureMcpCallLogIndexes(db);
  indexesEnsured = true;
}
```

Call this at the top of `ensureBankConnection`. (We'll move this to a single `bootstrap()` later — fine for now.)

- [ ] **Step 3:** Existing flow (`/login → callback → /`) must still create the bank_connection. Re-run the manual smoke from Phase 1 Task 14 to verify (manual step at end of Phase 2 E2E).

---

## Task 5 — `sync_runs` repository

**Files:**
- Create: `lib/repositories/sync-runs.ts`
- Create: `tests/lib/repositories/sync-runs.test.ts`

- [ ] **Step 1: Doc shape and helpers**

```ts
import type { Db, ObjectId } from "mongodb";

export interface SyncRunStats {
  transactionsFetched: number;
  transactionsNew: number;
  accountsUpdated: number;
  snapshotsWritten: number;
  errors: Array<{ tool: string; kind: string; message: string }>;
}

export interface SyncRunDoc {
  _id: ObjectId;
  userId: string;
  bankConnectionId: string;
  triggeredBy: "manual" | "cron";
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "success" | "partial" | "error";
  stats: SyncRunStats;
  errorMessage: string | null;
}

const COLLECTION = "sync_runs";

export async function createSyncRun(db: Db, input: {
  userId: string;
  bankConnectionId: string;
  triggeredBy: "manual" | "cron";
}): Promise<ObjectId> { /* insertOne */ }

export async function finishSyncRun(db: Db, id: ObjectId, status: SyncRunDoc["status"], stats: SyncRunStats, errorMessage: string | null): Promise<void> { /* updateOne with finishedAt: now */ }

export async function findRecentByUser(db: Db, userId: string, limit = 10): Promise<SyncRunDoc[]> { /* find sorted by startedAt desc, limit */ }
```

Implement the bodies. Tests verify create+finish+find shape.

---

## Task 6 — `bank_accounts` repository

**Files:**
- Create: `lib/repositories/accounts.ts`
- Create: `tests/lib/repositories/accounts.test.ts`

- [ ] **Step 1: Doc shape** matches the spec Rev 2:

```ts
export interface BankAccountDoc {
  _id: ObjectId;
  userId: string;
  bankConnectionId: string;
  externalId: string;
  kind: "account" | "credit_card";
  type: string;                    // raw MCP, e.g. "CONTA_DEPOSITO_A_VISTA" or "BLACK"
  subtype: string | null;          // "INDIVIDUAL" | "JOINT" | null
  institutionName: string;
  displayName: string;
  branchCode: string | null;
  number: string | null;
  checkDigit: string | null;
  compeCode: string | null;
  companyCnpj: string;
  creditCardNetwork: string | null;
  productType: string | null;
  balanceComponents: { available: number; blocked: number; automaticallyInvested: number } | null;
  currentBalance: number | null;   // sum of components (cents)
  currency: "BRL";
  balanceUpdatedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}
```

- [ ] **Step 2: Functions to implement**

```ts
upsertAccountFromMcp(db, { userId, bankConnectionId, account: AccountSummary }): Promise<ObjectId>
updateAccountBalance(db, accountId, { balance: AccountBalance }): Promise<void>
upsertCreditCardFromMcp(db, { userId, bankConnectionId, card: CreditCard }): Promise<ObjectId>
findAccountsByUser(db, userId): Promise<BankAccountDoc[]>
findAccountByExternalId(db, bankConnectionId, externalId): Promise<BankAccountDoc | null>
```

Use `parseMcpAmountToCents` from `lib/format/money.ts`. Sum the three balance components.

- [ ] **Step 3: Tests** with fixture data from `tests/mcp/fixtures/`. Verify centavos math: `availableAmount="1.00"` + `blocked="0.00"` + `auto="26.57"` → `currentBalance=2757`.

- [ ] **Step 4: Indexes** (idempotent ensure function called from runner):
```
{ userId: 1 }
{ userId: 1, bankConnectionId: 1 }
unique { bankConnectionId: 1, externalId: 1 }
```

---

## Task 7 — `transactions` repository

**Files:**
- Create: `lib/repositories/transactions.ts`
- Create: `tests/lib/repositories/transactions.test.ts`

This is the most complex repo. Two shapes (account vs credit_card) into one collection with `source` discriminator.

- [ ] **Step 1: Doc shape** per spec Rev 2 (unified, with optional fields per source).

- [ ] **Step 2: Function `bulkUpsertAccountTransactions`**

Takes the `ListAccountTransactionsResponse`. For each tx:
- `source = "account"`
- `amount = parseMcpAmountToCents(transactionAmount.amount)` * (creditDebitType === "DEBITO" ? -1 : 1)
- `externalId = transactionId`
- `date = new Date(transactionDateTime)`
- `description = transactionName`
- `counterpartyCnpjCpfHash = partieCnpjCpf ? hashWithPepper(partieCnpjCpf, "COUNTERPARTY_HASH_PEPPER") : null`
- `counterpartyCnpjCpfLast6 = partieCnpjCpf ? partieCnpjCpf.slice(-6) : null`
- `pixType = type`
- `completedAuthorisedPaymentType = completedAuthorisedPaymentType`
- `category = null`, `categorySource = null`

Bulk operation: `db.collection("transactions").bulkWrite(ops, { ordered: false })` with `updateOne({ bankAccountId, externalId }, { $setOnInsert, $set }, { upsert: true })`.

Return `{ fetched, new, updated }` counts.

- [ ] **Step 3: Function `bulkUpsertCreditCardTransactions`**

For each tx in `ListCreditCardBillTransactionsResponse`:
- `source = "credit_card"`
- `amount = parseMcpAmountToCents(amount.amount)` * sign from `creditDebitType`
- `externalId = transactionId`
- `date = new Date(transactionDateTime)`
- `postedDate = new Date(billPostDate)`
- `description = transactionName`
- `mcc = payeeMCC ?? null`
- `cardLast4 = identificationNumber`
- `paymentType = paymentType ?? null`
- `chargeNumber/chargeIdentificator` as-is
- `billId = billId`

- [ ] **Step 4: Pix self-reversal filter**

During Phase 0 we observed pairs:
- `Pix enviado` (DEBITO, partieCnpjCpf=<recipient>)
- `Crédito liberado para Pix` (CREDITO, partieCnpjCpf=Cumbuca's CNPJ "72504000123")

with identical amounts and timestamps within seconds.

**MVP approach:** keep both rows but add a `reversal: { groupId: string, role: "sent" | "credit" } | null` field. Pair by hash of `(bankAccountId, amount, date-rounded-to-1min)`. UI can collapse the pair if both are present.

For Phase 2: just store both transactions as-is. Don't filter or pair. UI shows both, user sees the cancellation as a +/- pair. Phase 4 (UI polish) can add the pairing display.

Strike out the `reversal` field complexity above and keep it simple. Add a TODO note in code.

- [ ] **Step 5: Tests**

Use the Phase 0 fixtures. Verify:
- Bulk upsert is idempotent (run twice → same row count)
- DEBITO maps to negative amount in cents
- CREDITO maps to positive amount in cents
- partieCnpjCpf is hashed (no raw CPF/CNPJ in document)
- Last 6 digits preserved for display

- [ ] **Step 6: Indexes** (idempotent):
```
{ userId: 1, date: -1 }
{ userId: 1, category: 1, date: -1 }
{ userId: 1, bankAccountId: 1, date: -1 }
{ userId: 1, source: 1, date: -1 }
unique { bankAccountId: 1, externalId: 1 }
```

---

## Task 8 — `balance_snapshots` repository

**Files:**
- Create: `lib/repositories/snapshots.ts`
- Create: `tests/lib/repositories/snapshots.test.ts`

```ts
upsertDailySnapshot(db, {
  userId, bankAccountId, date: YYYYMMDD (Date),
  balance: number,
  components: { available, blocked, automaticallyInvested }
}): Promise<void>
```

Unique index `{ userId: 1, bankAccountId: 1, date: 1 }`. Upsert idempotent — multiple syncs in the same day overwrite.

Tests: run upsert twice with different balances → final doc has the second balance.

---

## Task 9 — Rate limiter

**Files:**
- Create: `lib/repositories/rate-limits.ts`
- Create: `tests/lib/repositories/rate-limits.test.ts`

```ts
/**
 * Returns null if the request is allowed; throws a RateLimitedError with
 * retryAfterSeconds otherwise. The collection uses a TTL index so we don't
 * need cleanup.
 */
export async function enforceRateLimit(
  db: Db,
  key: string,
  windowSeconds: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
  try {
    await db.collection("rate_limits").insertOne(
      { _id: key as unknown as ObjectId, createdAt: now, expiresAt }
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      // duplicate — find existing to compute retry-after
      const existing = await db.collection("rate_limits").findOne({ _id: key as unknown as ObjectId });
      const retryAfterMs = existing ? existing.expiresAt.getTime() - now.getTime() : windowSeconds * 1000;
      throw new RateLimitedError(Math.ceil(retryAfterMs / 1000));
    }
    throw err;
  }
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited, retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
  }
}

export async function ensureRateLimitIndexes(db: Db): Promise<void> {
  await db.collection("rate_limits").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );
}
```

Tests: first call allowed, second call within window throws with positive retryAfter, after TTL another call allowed (test uses small window like 1 second).

---

## Task 10 — Sync runner

**Files:**
- Create: `lib/sync/runner.ts`
- Create: `lib/sync/normalize.ts` (small pure-function helpers if needed)
- Create: `tests/lib/sync/runner.test.ts`

- [ ] **Step 1: Signature**

```ts
export interface RunSyncOptions {
  triggeredBy: "manual" | "cron";
  bypassCache?: boolean;
}

export interface RunSyncResult {
  syncRunId: string;
  stats: SyncRunStats;
  status: "success" | "partial" | "error";
}

export async function runSync(
  db: Db,
  conn: BankConnectionDoc,
  accessToken: string,
  opts: RunSyncOptions
): Promise<RunSyncResult>
```

- [ ] **Step 2: Orchestration (per spec Section 3 Flow 3)**

```
1. createSyncRun → syncRunId
2. Try:
   2a. list_accounts → upsertAccountFromMcp per account
   2b. For each account: get_account → updateAccountBalance + upsertDailySnapshot
   2c. For each account: list_account_transactions (last 7 days, recent endpoint)
                       → bulkUpsertAccountTransactions
   2d. list_credit_cards → upsertCreditCardFromMcp per card
   2e. For each card: list_credit_card_bills
                    → for each bill within last 30 days: list_credit_card_bill_transactions
                                                       → bulkUpsertCreditCardTransactions
   2f. Update bank_connections.lastSyncAt + lastSyncStatus
3. Catch tool-level errors:
   - Continue with remaining tools if possible (status="partial")
   - Track each error in stats.errors
4. finishSyncRun with final status + stats
```

- [ ] **Step 3: Quota-aware date selection for `list_account_transactions`**

```
const today = new Date();
const sevenDaysAgo = ...;
// Default sync window: last 7 days → uses account_txn_recent (240/month)
const fromDate = sevenDaysAgo.toISOString().slice(0, 10);
const toDate = today.toISOString().slice(0, 10);
const bucket = "account_txn_recent";
```

- [ ] **Step 4: Tests** with mocked `callMcpTool`. Use `vi.mock("@/lib/mcp/client")` to return canned responses from the Phase 0 fixtures. Verify:
  - Happy path → status="success", correct counts
  - One tool fails (transactions) → status="partial", error in stats
  - Quota exceeded → that tool's error logged, runner continues

---

## Task 11 — `/api/sync` real implementation

**Files:**
- Modify: `app/api/sync/route.ts`

- [ ] **Step 1: Replace stub**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import { runSync, type RunSyncResult } from "@/lib/sync/runner";
import { enforceRateLimit, RateLimitedError, ensureRateLimitIndexes } from "@/lib/repositories/rate-limits";
import { ensureMcpCallLogIndexes } from "@/lib/repositories/mcp-call-logs";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!session.accessToken) {
    return NextResponse.json({ ok: false, error: "no_access_token" }, { status: 400 });
  }

  const db = await getDb();

  // bootstrap indexes (cheap, idempotent)
  await Promise.all([ensureRateLimitIndexes(db), ensureMcpCallLogIndexes(db)]);

  // 1 request / 60s per user
  try {
    await enforceRateLimit(db, `sync:${session.user.id}`, 60);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", retryAfterSeconds: err.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    throw err;
  }

  const connections = await findActiveConnectionsByUser(db, session.user.id);
  if (connections.length === 0) {
    return NextResponse.json({ ok: false, error: "no_active_connection" }, { status: 412 });
  }

  const results: Array<RunSyncResult & { bankConnectionId: string }> = [];
  for (const conn of connections) {
    try {
      const r = await runSync(db, conn, session.accessToken, { triggeredBy: "manual" });
      results.push({ ...r, bankConnectionId: String(conn._id) });
    } catch (err) {
      results.push({
        bankConnectionId: String(conn._id),
        syncRunId: "(crashed)",
        status: "error",
        stats: { transactionsFetched: 0, transactionsNew: 0, accountsUpdated: 0, snapshotsWritten: 0, errors: [{ tool: "(runner)", kind: "transport", message: err instanceof Error ? err.message : String(err) }] },
      });
    }
  }

  const ok = results.every((r) => r.status !== "error");
  return NextResponse.json({ ok, results });
}
```

- [ ] **Step 2: Smoke** — `bun run build` clean.

---

## Task 12 — UI: dashboard reads real data + better SyncNowButton

**Files:**
- Modify: `app/(app)/page.tsx`
- Modify: `components/sync/SyncNowButton.tsx`
- Optional: create `components/Money.tsx`

- [ ] **Step 1: Money component** (single source of truth for formatting)

```tsx
import { centsToBrl } from "@/lib/format/money";
export function Money({ cents }: { cents: number }) {
  const negative = cents < 0;
  return <span className={negative ? "text-red-500" : "text-foreground"}>{centsToBrl(cents)}</span>;
}
```

- [ ] **Step 2: Dashboard renders**

For each active connection, display:
- Institution name + status + lastSyncAt
- All accounts under it (kind=account first, then credit_card)
  - Account balance via `<Money cents={currentBalance ?? 0} />`
  - If `kind === "account"`, also show breakdown
- Last 10 transactions across all accounts of this user, newest first
  - Date, description, `<Money cents={amount} />`, source badge

Use `findAccountsByUser`, `findRecentTransactionsByUser(db, userId, 10)` (add this query to `lib/repositories/transactions.ts`).

- [ ] **Step 3: SyncNowButton stats**

After POST `/api/sync`, parse the structured response and display a brief summary:
- "X novas transações em N contas" or
- "Erro: <first error message>" with link to details

Keep the JSON as a tooltip / collapsible for debugging.

- [ ] **Step 4: Smoke** — `bun run build`, lint, tests.

---

## Task 13 — Verification + manual E2E

- [ ] **Step 1: Unit + integration**

```
bun run test --run
bunx tsc --noEmit
bun run lint
bun run build
```

All green.

- [ ] **Step 2: USER-IN-LOOP smoke test**

Start dev:
```
bun run dev
```

In browser at `http://localhost:3001`:

1. Sign in (Phase 1 flow already works).
2. Land on `/`. If no active connection → goes to `/connect-bank` (Phase 1 logic). Resolve by re-signing if needed.
3. With a connection, see the dashboard.
4. Click **"Sincronizar agora"**.
5. Expect:
   - Toast / status changes to "X novas transações…"
   - Account card now shows real balance (e.g. **R$ 27,57** for Itaú)
   - Transactions list populates with last 7 days

6. Verify in Mongo:
```
db.bank_accounts.find({ userId: "<your-user-id>" })       // ≥ 1 row, with balanceComponents
db.transactions.find({ userId: "<your-user-id>" }).count()
db.sync_runs.find({ userId: "<your-user-id>" }).sort({startedAt:-1}).limit(1)
db.mcp_call_logs.find({ userId: "<your-user-id>" }).count()  // > 0
db.bank_connections.findOne()                              // quotaUsage populated for current month
```

7. Click "Sincronizar agora" again within 60s. Expect a 429 with a friendly toast.

8. Wait 60s+. Click again. Expect success but most counts unchanged (idempotency).

If any of the steps 4–8 produce a server error, capture the `mcp_call_logs` row for that request (use `requestId` from the error response) and bring it back for diagnosis. **Do not patch over errors without root-causing them per superpowers:systematic-debugging.**

---

## What this phase produces (handoff to Phase 3)

| Artifact | Used by |
|---|---|
| `lib/mcp/client.ts` (callMcpTool wrapper) | Phase 3 categorizer indirectly (no new MCP calls in categorizer; uses stored data) |
| `lib/sync/runner.ts` | Phase 4 cron endpoint |
| `lib/repositories/transactions.ts` | Phase 3 categorizer reads/writes `category` field |
| `lib/repositories/accounts.ts`, `snapshots.ts` | Phase 4 dashboard charts |
| `mcp_call_logs` collection | Phase 5 `/dev/logs` page |

**Open items for Phase 3:**
1. Phase 3 builds the **MCC categorizer + LLM categorizer** that runs at the end of each sync. It writes to the `category` and `categorySource` fields on `transactions`. The sync runner will be extended in Phase 3 to call the categorizer dispatcher after upserts.
2. Phase 3 also adds a `categories` seed collection (slug + label + icon + color).
3. Refresh token logic — Phase 2 reuses the session.accessToken which may expire. If sync fails with 401, surface as "reconnect needed" → existing `/connect-bank` route. Proper refresh-token handling is **deferred to Phase 4** along with cron.
4. The `(app)/page.tsx` will be enhanced in Phase 4 with proper KPI cards, charts (Recharts), donut by category.

**User preference reminder for whoever executes this:** do not run any `git` command. Stage / commit is the user's job.
