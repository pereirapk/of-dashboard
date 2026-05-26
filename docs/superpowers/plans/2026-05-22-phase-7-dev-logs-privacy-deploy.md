# Phase 7 — Dev logs, privacy, sign out, deploy guide

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Close out the project. Add the sign-out flow, an admin debug page for `mcp_call_logs`, the privacy policy stub, and a written deploy guide for taking the app to production.

**Out of scope:** any new feature work. This is finishing-touches phase.

---

## Pre-flight — what already exists

```
lib/repositories/mcp-call-logs.ts            (insertRunningLog, finishLogOk/Error, indexes)
lib/auth.ts                                  (signOut)
proxy.ts                                     (middleware blocks /dev/* unless ALLOW_DEV_DASHBOARD=true or NODE_ENV=development)
app/(app)/{layout,page,transactions,accounts,settings,connect-bank}.tsx
app/(auth)/login/page.tsx
```

---

## Task 1 — Sign-out button in /settings

**Files:**
- Modify: `app/(app)/settings/page.tsx`
- Create: `components/settings/SignOutButton.tsx`

### SignOutButton.tsx (client)

```tsx
"use client";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => signOut({ redirectTo: "/login" })}
    >
      Sair
    </Button>
  );
}
```

### settings/page.tsx — append a "Sessão" section

Add a new section between "Sua conta" and "Zona de perigo":

```tsx
<section className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 space-y-2 flex items-center justify-between">
  <div>
    <h3 className="text-sm font-medium">Sessão</h3>
    <p className="text-xs opacity-70">
      Sair desconecta este navegador. O consentimento Open Finance fica
      intacto.
    </p>
  </div>
  <SignOutButton />
</section>
```

Import `SignOutButton` at the top.

## Task 2 — Privacy policy page + /login footer link

**Files:**
- Create: `app/privacy/page.tsx`
- Modify: `app/(auth)/login/page.tsx` (add link)

### app/privacy/page.tsx

Static markdown-ish content for now. Real text TBD by counsel; this is a placeholder.

```tsx
export const metadata = {
  title: "Privacidade — Cumbuca Dashboard",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Política de Privacidade</h1>
        <p className="text-xs opacity-60">
          Versão preliminar — atualizada em 22/05/2026
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <p>
          Este app (&ldquo;Cumbuca Dashboard&rdquo;) acessa seus dados
          financeiros via Open Finance regulado pelo Banco Central do
          Brasil, intermediado pela Cumbuca. Acesso requer seu
          consentimento explícito durante o login.
        </p>

        <h2 className="text-base font-medium mt-6">Dados coletados</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Identificadores da sua conta Cumbuca (e-mail, ID interno)</li>
          <li>
            Saldos e transações das contas e cartões autorizados via Open
            Finance
          </li>
          <li>
            CNPJ/CPF de contrapartes de Pix (armazenado apenas como hash
            irreversível)
          </li>
        </ul>

        <h2 className="text-base font-medium mt-6">Como usamos</h2>
        <p>
          Os dados são usados exclusivamente para exibir seu dashboard
          financeiro pessoal. Não compartilhamos com terceiros. Não
          vendemos. Não treinamos modelos com seus dados.
        </p>

        <h2 className="text-base font-medium mt-6">Categorização</h2>
        <p>
          Transações são categorizadas em duas etapas: (1) regras
          determinísticas baseadas em códigos MCC (categorias de
          estabelecimento padrão da indústria) e (2) classificação por
          modelo de linguagem (Claude da Anthropic). A chamada ao modelo
          inclui as descrições das transações; nada é retido pela Anthropic
          após a resposta.
        </p>

        <h2 className="text-base font-medium mt-6">Armazenamento</h2>
        <p>
          Dados ficam em MongoDB Atlas. Tokens OAuth e PII são
          criptografados em repouso (AES-256-GCM). Logs de chamadas ao MCP
          expiram automaticamente após 30 dias (TTL).
        </p>

        <h2 className="text-base font-medium mt-6">
          Seus direitos (LGPD Art. 18)
        </h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Acesso</strong>: você vê todos os seus dados na própria
            interface do app.
          </li>
          <li>
            <strong>Exclusão</strong>: vá em Configurações → Zona de
            perigo → Excluir minha conta. A exclusão é imediata e
            irreversível.
          </li>
          <li>
            <strong>Revogação de consentimento</strong>: junto com a
            exclusão, revogamos automaticamente o consent Open Finance na
            Cumbuca.
          </li>
        </ul>

        <h2 className="text-base font-medium mt-6">Contato</h2>
        <p>
          Para qualquer questão sobre privacidade, entre em contato com o
          responsável pelo app.
        </p>
      </section>

      <footer className="text-xs opacity-50 border-t border-foreground/10 pt-4">
        Documento sujeito a revisão jurídica antes de uso comercial. Esta
        versão é placeholder para o MVP.
      </footer>
    </main>
  );
}
```

### Modify app/(auth)/login/page.tsx

Add a small footer link to `/privacy` below the existing "Ao entrar, você autoriza…" sentence.

```tsx
<p className="text-xs opacity-50">
  Ao entrar, você autoriza este app a ler seus dados financeiros via
  Cumbuca (Open Finance). Você pode revogar a qualquer momento.{" "}
  <Link href="/privacy" className="underline">
    Política de Privacidade
  </Link>
</p>
```

Don't forget the `import Link from "next/link";`.

## Task 3 — /dev/logs page

**Files:**
- Create: `app/(dev)/logs/page.tsx`
- Create: `lib/repositories/mcp-call-logs.ts` — add `findRecentLogs` query helper

The `proxy.ts` already blocks `/dev/*` unless `NODE_ENV=development` or `ALLOW_DEV_DASHBOARD=true`. So no additional auth gate needed.

### Add to lib/repositories/mcp-call-logs.ts

```ts
export interface LogFilter {
  userId?: string;
  tool?: string;
  status?: "running" | "ok" | "error" | "retry";
  errorKind?: string;
  limit?: number;
}

export async function findRecentLogs(
  db: Db,
  filter: LogFilter = {}
): Promise<McpCallLogDoc[]> {
  const q: Record<string, unknown> = {};
  if (filter.userId) q.userId = filter.userId;
  if (filter.tool) q.tool = filter.tool;
  if (filter.status) q.status = filter.status;
  if (filter.errorKind) q.errorKind = filter.errorKind;
  return db
    .collection<McpCallLogDoc>(COLLECTION)
    .find(q)
    .sort({ startedAt: -1 })
    .limit(filter.limit ?? 100)
    .toArray();
}
```

### app/(dev)/logs/page.tsx

```tsx
import { getDb } from "@/lib/mongo";
import { findRecentLogs } from "@/lib/repositories/mcp-call-logs";

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

export const dynamic = "force-dynamic";

export default async function DevLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const logs = await findRecentLogs(db, {
    userId: params.user,
    tool: params.tool,
    status: params.status as "ok" | "error" | "running" | "retry" | undefined,
    errorKind: params.kind,
    limit: 100,
  });

  return (
    <main className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">/dev/logs — MCP call logs</h1>
        <p className="text-xs opacity-60">
          Últimas 100 chamadas, mais novas primeiro. Filtros via URL:
          <code className="font-mono text-[10px] bg-foreground/10 px-1 ml-1">
            ?tool=list_accounts&amp;status=error&amp;user=...
          </code>
        </p>
      </header>

      {logs.length === 0 ? (
        <p className="opacity-60 text-sm">Sem logs.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left opacity-70 border-b border-foreground/10">
            <tr>
              <th className="py-2 px-2 font-medium">Quando</th>
              <th className="py-2 px-2 font-medium">Tool</th>
              <th className="py-2 px-2 font-medium">Bucket</th>
              <th className="py-2 px-2 font-medium">Status</th>
              <th className="py-2 px-2 font-medium">Dur.</th>
              <th className="py-2 px-2 font-medium">User</th>
              <th className="py-2 px-2 font-medium">Erro</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr
                key={l._id.toHexString()}
                className="border-b border-foreground/5 hover:bg-foreground/[0.02]"
              >
                <td className="py-2 px-2 tabular-nums opacity-70 whitespace-nowrap">
                  {dateFmt.format(l.startedAt)}
                </td>
                <td className="py-2 px-2 font-mono">{l.tool}</td>
                <td className="py-2 px-2 font-mono opacity-70">
                  {l.quotaBucket ?? "—"}
                </td>
                <td className="py-2 px-2">
                  <span
                    className={
                      l.status === "ok"
                        ? "text-emerald-500"
                        : l.status === "error"
                        ? "text-red-500"
                        : "opacity-70"
                    }
                  >
                    {l.status}
                  </span>
                </td>
                <td className="py-2 px-2 tabular-nums opacity-70">
                  {l.durationMs ?? "—"}ms
                </td>
                <td className="py-2 px-2 font-mono opacity-50 truncate max-w-[12ch]">
                  {l.userId}
                </td>
                <td className="py-2 px-2 text-red-400 max-w-md truncate">
                  {l.errorKind ? (
                    <>
                      <span className="font-mono">{l.errorKind}</span>:{" "}
                      {l.errorMessage}
                    </>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="text-xs opacity-50 pt-4">
        Para detalhes de uma chamada, consulte o doc{" "}
        <code className="font-mono">mcp_call_logs</code> no Mongo Atlas pelo{" "}
        <code className="font-mono">requestId</code>.
      </footer>
    </main>
  );
}
```

## Task 4 — Production deploy guide

**Files:**
- Create: `docs/deploy-production.md`

The guide is a long markdown doc. Write it with:

1. **Pre-requisites checklist**: Vercel account, Atlas cluster (M0 free is fine for MVP), the Cumbuca Keycloak DCR registration (one client per environment — dev + prod separately).

2. **Atlas setup**: create M0 cluster, add IP allow-list `0.0.0.0/0` (Vercel uses dynamic IPs), create database user, copy connection URI.

3. **Keycloak prod registration**:
   ```bash
   APP_BASE_URL=https://your-prod-domain.com bun run keycloak:register
   ```
   Save the client_id and client_secret separately from dev.

4. **Vercel env vars** (paste into the project settings):
   - `AUTH_SECRET` — `openssl rand -base64 32` (fresh value for prod)
   - `AUTH_URL` — `https://your-prod-domain.com`
   - `KEYCLOAK_ISSUER` — same
   - `KEYCLOAK_CLIENT_ID` — from DCR
   - `KEYCLOAK_CLIENT_SECRET` — from DCR
   - `MONGODB_URI` — Atlas URI
   - `PII_KEY`, `OPENFINANCE_TOKEN_KEY` — fresh `openssl rand -base64 32` each
   - `CPF_HASH_PEPPER`, `COUNTERPARTY_HASH_PEPPER` — fresh `openssl rand -hex 32` each
   - `CUMBUCA_MCP_URL` — `https://mcp.cumbuca.com/mcp`
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `ALLOW_DEV_DASHBOARD` — leave empty (defaults to false)

5. **Deploy**: `git push` (or `vercel deploy`); Vercel auto-builds.

6. **Post-deploy verification**: sign in, run /api/sync, verify Atlas collections populate.

7. **Sync strategy in prod**: we use AutoSync client component (no cron). If you want a cron later, set up a Vercel Cron Job hitting `/api/cron/sync` and add `CRON_SECRET`. See `lib/auth/access-token.ts` for the session-less token refresh path (kept ready for cron).

8. **Costs**:
   - Vercel: Hobby tier free for low traffic
   - Atlas M0: free, 512MB storage
   - Cumbuca/Keycloak: no app-side cost
   - Anthropic: ~R$0.50/mês with prompt caching for a single user typical usage

Write this doc in full prose, Brazilian Portuguese where it talks to the user, English for code/config terms.

## Task 5 — Verification

- [ ] `bun run test --run` — green
- [ ] `bunx tsc --noEmit && bun run lint && bun run build` — clean
- [ ] USER-IN-LOOP:
  1. `/settings` shows new "Sessão" card with "Sair" button → clicking signs out
  2. `/login` has clickable "Política de Privacidade" → opens `/privacy` (works without login)
  3. `/privacy` renders the placeholder text
  4. `http://localhost:3001/dev/logs` shows the table of recent MCP calls (works in dev because `NODE_ENV=development`)
  5. Try with filters: `/dev/logs?status=error` → only error rows
  6. Read `docs/deploy-production.md` and confirm the steps make sense

---

## After Phase 7

App is shippable. Open items going forward (not blocking):
- Real privacy policy text from counsel
- `/dev/logs` requestId detail page (one click → full payload)
- `/accounts/[id]` drill-down with balance history chart
- i18n if you ever want EN support
- MFA via Cognito/Keycloak (already supported by Keycloak; just enable in realm)
