# Phase 6 — /accounts, /settings, LGPD delete

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the two remaining sidebar entries and finalize LGPD compliance:
- `/accounts` — drill-down page showing each linked account/card with its transactions
- `/settings` — minimal settings page with the LGPD "Excluir tudo" flow
- `/api/profile/delete` — revokes the Cumbuca consent and wipes the user's data
- Enable both sidebar items

**Out of scope** (Phase 7):
- `/dev/logs` admin page (`mcp_call_logs` browser, gated by env flag)
- Production deploy guide (Vercel + Atlas + Keycloak DCR migration)
- Privacy policy text

**User preferences (memory):**
- No `git` commands.
- Mongo Atlas free tier.

---

## Pre-flight — what already exists

```
lib/repositories/{accounts,connections,transactions,user-categories,...}.ts
lib/sync/ensure-connection.ts
lib/mcp/client.ts                            (callMcpTool wrapper)
lib/auth.ts                                  (signOut available)
components/layout/Sidebar.tsx                ("Contas" + "Configurações" still disabled)
components/transactions/{CategoryBadge,CategoryEditor,TransactionList,TransactionFilters}.tsx
app/(app)/{layout,page,connect-bank/page,transactions/page}.tsx
app/api/{auth/[...nextauth],sync,transactions/[id]/category,categories}/route.ts
```

---

## Files this phase will create or touch

```
Create:
  lib/mcp/revoke-consent.ts                  // wraps callMcpTool("revoke_consent")
  app/(app)/accounts/page.tsx
  app/(app)/accounts/[id]/page.tsx           // drill-down per account
  app/(app)/settings/page.tsx
  app/api/profile/delete/route.ts            // POST → revoke + wipe + sign out
  components/settings/DeleteAccountSection.tsx  // client confirmation flow
  tests/lib/mcp/revoke-consent.test.ts

Modify:
  components/layout/Sidebar.tsx              // enable both items
```

---

## Task 1 — MCP revoke_consent wrapper

**Files:**
- Create: `lib/mcp/revoke-consent.ts`
- Create: `tests/lib/mcp/revoke-consent.test.ts`

```ts
import { z } from "zod";
import type { Db } from "mongodb";
import { callMcpTool } from "./client";

const RevokeConsentResponse = z.looseObject({}); // empty body acceptable

export async function revokeConsentForConnection(opts: {
  db: Db;
  userId: string;
  bankConnectionId: string;
  accessToken: string;
}): Promise<void> {
  await callMcpTool(
    {
      db: opts.db,
      userId: opts.userId,
      bankConnectionId: opts.bankConnectionId,
      syncRunId: null,
      triggeredBy: "manual",
      accessToken: opts.accessToken,
      quotaBucket: "revoke_consent",
    },
    "revoke_consent",
    {},
    RevokeConsentResponse
  );
}
```

Test: mock `callMcpTool` to verify it's called with the right `tool` name and that errors propagate.

---

## Task 2 — `/api/profile/delete` endpoint

**Files:**
- Create: `app/api/profile/delete/route.ts`

Behavior:
1. Auth-guard (require session).
2. Read body for `{ confirm: true }` — refuse otherwise.
3. For each `bank_connection` of the user with status `"active"`:
   - Decrypt access token
   - Call `revoke_consent` via the wrapper (swallow errors — user wants out either way; surface in response)
4. Delete in order: `transactions`, `balance_snapshots`, `mcp_call_logs`, `sync_runs`, `bank_accounts`, `bank_connections`, `user_categories`, `user_profiles`.
5. Delete Auth.js rows: `accounts`, `sessions` for this user (the `users` row goes last).
6. Return `{ ok: true, revoked: <list> }`. Client signs out after.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, signOut } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { decrypt } from "@/lib/crypto";
import { revokeConsentForConnection } from "@/lib/mcp/revoke-consent";

const BodySchema = z.object({ confirm: z.literal(true) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "confirm flag required" },
      { status: 400 }
    );
  }
  const userId = session.user.id;
  const db = await getDb();

  // 1. Revoke each connection's consent
  const connections = await db
    .collection("bank_connections")
    .find({ userId, status: "active" })
    .toArray();
  const revoked: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const conn of connections) {
    try {
      const at = decrypt(conn.encryptedAccessToken as string, "OPENFINANCE_TOKEN_KEY");
      await revokeConsentForConnection({
        db,
        userId,
        bankConnectionId: String(conn._id),
        accessToken: at,
      });
      revoked.push({ id: String(conn._id), ok: true });
    } catch (err) {
      revoked.push({
        id: String(conn._id),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Wipe collections (app data)
  const wipeOrder = [
    "transactions",
    "balance_snapshots",
    "mcp_call_logs",
    "sync_runs",
    "bank_accounts",
    "bank_connections",
    "user_categories",
    "user_profiles",
  ];
  for (const c of wipeOrder) {
    await db.collection(c).deleteMany({ userId });
  }

  // 3. Wipe Auth.js rows for this user
  await db.collection("sessions").deleteMany({ userId });
  await db.collection("accounts").deleteMany({ userId });
  await db.collection("users").deleteOne({ _id: session.user.id as never });

  // 4. Sign out
  await signOut({ redirect: false });

  return NextResponse.json({ ok: true, revoked });
}
```

⚠️ Verify `signOut({ redirect: false })` works in route handlers in Auth.js v5. If not, omit; the client will navigate to `/login` after this returns.

---

## Task 3 — `/settings` page with delete section

**Files:**
- Create: `app/(app)/settings/page.tsx`
- Create: `components/settings/DeleteAccountSection.tsx`

### settings/page.tsx (server)

```tsx
import { auth } from "@/lib/auth";
import { DeleteAccountSection } from "@/components/settings/DeleteAccountSection";

export default async function SettingsPage() {
  const session = await auth();
  return (
    <main className="p-6 space-y-6 max-w-2xl">
      <header>
        <h2 className="text-xl font-semibold">Configurações</h2>
        <p className="text-xs opacity-60">Conta e dados</p>
      </header>

      <section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 space-y-2">
        <h3 className="text-sm font-medium">Sua conta</h3>
        <p className="text-xs opacity-70">
          E-mail: <span className="font-mono">{session?.user?.email}</span>
        </p>
        <p className="text-xs opacity-70">
          ID: <span className="font-mono">{session?.user?.id}</span>
        </p>
      </section>

      <DeleteAccountSection />
    </main>
  );
}
```

### DeleteAccountSection.tsx (client)

Two-step confirmation: button → input "EXCLUIR" → final delete.

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function DeleteAccountSection() {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "confirm" | "done">("idle");
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setPending(true);
    setError(null);
    try {
      const r = await fetch("/api/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error ?? "Falha ao excluir.");
        return;
      }
      setStage("done");
      // Hard navigation forces session cookie clear via Auth.js.
      window.location.href = "/login";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
      <h3 className="text-sm font-medium text-red-500">Zona de perigo</h3>
      <p className="text-xs opacity-80">
        Excluir sua conta vai revogar o consentimento Open Finance na Cumbuca
        (irreversível pelo lado deles) e apagar permanentemente os seus dados
        deste app: transações, contas conectadas, categorias, perfil. Não tem
        como reverter.
      </p>

      {stage === "idle" && (
        <Button
          variant="secondary"
          onClick={() => setStage("confirm")}
          className="border-red-500/40 text-red-500 hover:bg-red-500/10"
        >
          Excluir minha conta
        </Button>
      )}

      {stage === "confirm" && (
        <div className="space-y-2">
          <p className="text-xs">
            Digite <code className="font-mono bg-red-500/20 px-1 py-0.5 rounded">EXCLUIR</code>{" "}
            para confirmar:
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-sm w-full"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              disabled={typed !== "EXCLUIR" || pending}
              onClick={doDelete}
              className="bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
            >
              {pending ? "Excluindo…" : "Confirmar exclusão"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStage("idle");
                setTyped("");
                setError(null);
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </section>
  );
}
```

Touch-up: `Button` accepts extra `className` already.

---

## Task 4 — `/accounts` page

**Files:**
- Create: `app/(app)/accounts/page.tsx`
- Optional (deferred to Phase 7): `app/(app)/accounts/[id]/page.tsx` — full drill-down with transaction list filtered.

For Phase 6, only build the index `/accounts` page that lists ALL accounts + cards with rich detail and click-through links to `/transactions?account=<id>` (reuses existing filter).

```tsx
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findAccountsByUser } from "@/lib/repositories/accounts";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import Link from "next/link";
import { Money } from "@/components/Money";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

export default async function AccountsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const db = await getDb();
  const [accounts, connections] = await Promise.all([
    findAccountsByUser(db, userId),
    findActiveConnectionsByUser(db, userId),
  ]);

  return (
    <main className="p-6 space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Contas</h2>
        <p className="text-xs opacity-60">
          Conexões Open Finance e suas contas / cartões
        </p>
      </header>

      <section className="space-y-2">
        <h3 className="text-sm font-medium opacity-80">Conexões</h3>
        <ul className="space-y-2">
          {connections.map((c) => (
            <li
              key={c._id.toHexString()}
              className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-3 flex items-center justify-between"
            >
              <div>
                <p className="font-medium">{c.institutionDisplayName}</p>
                <p className="text-xs opacity-70">
                  Status: <span className="font-mono">{c.status}</span>
                  {c.lastSyncAt
                    ? ` · Última sync: ${dateFmt.format(c.lastSyncAt)}`
                    : " · Nunca sincronizado"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium opacity-80">
          Contas correntes / poupança
        </h3>
        {accounts.filter((a) => a.kind === "account").length === 0 ? (
          <p className="text-xs opacity-60">Nenhuma conta.</p>
        ) : (
          <ul className="space-y-2">
            {accounts
              .filter((a) => a.kind === "account")
              .map((a) => (
                <li
                  key={a._id.toHexString()}
                  className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{a.displayName}</p>
                      <p className="text-xs opacity-70">
                        {a.institutionName.toUpperCase()} · Ag. {a.branchCode} ·
                        Conta {a.number}-{a.checkDigit}
                      </p>
                    </div>
                    <Link
                      href={`/transactions?account=${a._id.toHexString()}`}
                      className="text-xs underline opacity-70 hover:opacity-100 shrink-0"
                    >
                      Ver transações →
                    </Link>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="opacity-60">Disponível</p>
                      <p className="tabular-nums">
                        <Money cents={a.balanceComponents?.available ?? 0} />
                      </p>
                    </div>
                    <div>
                      <p className="opacity-60">Bloqueado</p>
                      <p className="tabular-nums">
                        <Money cents={a.balanceComponents?.blocked ?? 0} />
                      </p>
                    </div>
                    <div>
                      <p className="opacity-60">Investido</p>
                      <p className="tabular-nums">
                        <Money
                          cents={
                            a.balanceComponents?.automaticallyInvested ?? 0
                          }
                        />
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-medium">
                    Total:{" "}
                    <Money cents={a.currentBalance ?? 0} />
                  </p>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium opacity-80">Cartões de crédito</h3>
        {accounts.filter((a) => a.kind === "credit_card").length === 0 ? (
          <p className="text-xs opacity-60">Nenhum cartão.</p>
        ) : (
          <ul className="space-y-2">
            {accounts
              .filter((a) => a.kind === "credit_card")
              .map((a) => (
                <li
                  key={a._id.toHexString()}
                  className="rounded-md border border-foreground/10 bg-foreground/[0.02] p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">{a.displayName}</p>
                    <p className="text-xs opacity-70">
                      {a.institutionName.toUpperCase()} ·{" "}
                      {a.creditCardNetwork} · {a.productType}
                    </p>
                  </div>
                  <Link
                    href={`/transactions?account=${a._id.toHexString()}`}
                    className="text-xs underline opacity-70 hover:opacity-100"
                  >
                    Ver transações →
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

---

## Task 5 — Enable both sidebar items

**File:** `components/layout/Sidebar.tsx`

Remove `disabled: true` from `/accounts` and `/settings` entries.

---

## Task 6 — Verification + E2E

- [ ] `bun run test --run` — green
- [ ] `bunx tsc --noEmit && bun run lint && bun run build` — clean
- [ ] USER-IN-LOOP:
  1. Click "Contas" in sidebar — see connections + accounts + cards with full balance breakdown
  2. Click "Ver transações" on an account → goes to `/transactions?account=...` filtered to that account
  3. Click "Configurações" — see settings page with delete section
  4. Click "Excluir minha conta" → confirmation field appears → type "EXCLUIR" → "Confirmar exclusão"
  5. Expect: revokeConsent called on Cumbuca, all Mongo collections wiped for this user, redirected to /login
  6. Try to log in again — Cumbuca will require a fresh OAuth consent (because we revoked)

⚠️ **Test the delete on a DEMO user, not your main test user.** Once revoked, you can't undo the Cumbuca side. You'll need to redo the full OAuth flow.

---

## What this phase produces (handoff to Phase 7)

| Artifact | Used by |
|---|---|
| `/accounts` page | Sidebar entry |
| `/settings` page | Sidebar entry; future profile editing |
| `/api/profile/delete` | LGPD compliance gate |
| `revokeConsentForConnection` | Cron job (future: detect expired connections) |

**Open items for Phase 7:**
1. `/dev/logs` admin page (env-gated)
2. Production deploy guide (Vercel + Atlas + Keycloak DCR)
3. Privacy policy (`/privacy`)
4. Optional: `/accounts/[id]` drill-down with charts per-account

**User preference reminder:** do not run any `git` command.
