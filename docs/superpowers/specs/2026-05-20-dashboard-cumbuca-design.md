# Dashboard Cumbuca — Design

**Data:** 2026-05-20
**Stack base já instalada:** Next.js 16.2.6, React 19.2.4, Tailwind CSS v4, TypeScript 5, Bun

## Revisões

- **Rev 2 — 2026-05-20** (pós-Phase 0). Discovery do MCP revelou que (a) auth
  é OAuth 2.1 padrão contra Keycloak externo da Cumbuca, não tools internas
  do MCP; (b) MCP impõe **quotas mensais por endpoint**; (c) há 8 tools
  fixas com shapes específicos; (d) MCC codes em transações de cartão
  permitem categorização determinística antes do LLM. Identity provider
  trocado de Cognito para Keycloak da Cumbuca. Dados refletidos em
  Seções 1, 2, 3, 4, 5, 7, 8. Detalhes técnicos em `docs/mcp-discovery.md`.
- **Rev 1 — 2026-05-20** (inicial via brainstorming).

## Contexto

Construir um dashboard web multi-usuário que consome dados financeiros do
usuário via Open Finance, agregados pelo MCP da Cumbuca (`https://mcp.cumbuca.com/mcp`).
Cada usuário se autentica via Cumbuca (Keycloak, com consent Open Finance
em uma instituição financeira por conexão), e visualiza saldos, gastos e
transações em painéis estilo "personal finance dashboard".

Referência estética: layout estilo FinTrack (sidebar fixa, KPIs no topo,
gráfico de tendência mensal, donut por categoria, lista de transações
recentes), em PT-BR com valores em R$.

## Decisões-chave

| Decisão | Escolha |
|---|---|
| Escopo de uso | Multi-usuário (produto) |
| MVP de páginas | Overview + Transações + Contas conectadas |
| V2 (fora MVP) | Orçamentos, investimentos, faturas detalhadas, alertas |
| Arquitetura de integração MCP | Híbrida: cliente MCP direto + Anthropic Claude Haiku pra categorização (LLM só quando MCC não cobre) |
| **Identidade do app** | **AWS Cognito → Keycloak da Cumbuca** (Auth.js v5 + Keycloak provider). Usuário se autentica direto na Cumbuca; sessão do app reusa o access_token pra MCP. |
| Banco de dados | MongoDB (Atlas no MVP), driver nativo (não Mongoose) |
| Cadência de sync | **1× por dia**, quota-aware. Único cron diário (horário a definir, sugestão 05:00 BR). Manual "Sincronizar agora" disponível sob demanda — quota mensal sobra com folga. |
| Localização | PT-BR + R$ apenas, sem i18n |
| URLs | Em inglês (`/transactions`, `/accounts`, ...) |
| UI strings | Em português |

## 1. Arquitetura geral

Três processos lógicos no mesmo repositório/deploy:

```
┌────────────┐   HTTPS    ┌──────────────────────────────┐
│  Browser   │ ─────────► │   Next.js (App Router)       │
│  (React)   │            │  ┌─────────┐  ┌────────────┐ │
└────────────┘            │  │   UI    │  │ API routes │ │
                          │  │ (RSC +  │  │ (auth,     │ │
                          │  │  client)│  │  sync trig,│ │
                          │  │         │  │  revoke,   │ │
                          │  │         │  │  category) │ │
                          │  └────┬────┘  └─────┬──────┘ │
                          └───────┼─────────────┼────────┘
                                  │             │
                                  ▼             ▼
                          ┌──────────────────────────────┐
                          │       MongoDB (Atlas)        │
                          │  Auth.js: users · accounts · │
                          │   sessions · verif_tokens    │
                          │  App: user_profiles · bank_  │
                          │   connections · bank_accounts│
                          │   · transactions · balance_  │
                          │   snapshots · bill_summaries │
                          │   · categories · sync_runs · │
                          │   mcp_call_logs              │
                          └──────────────────────────────┘
                                  ▲             ▲
                                  │             │
                  ┌───────────────┴──┐  ┌───────┴──────────┐
                  │  Sync Worker     │  │ Categorizer      │
                  │  (Vercel Cron    │  │ Tier 1: MCC rules│
                  │   1×/dia)        │  │ Tier 2: Anthropic│
                  │   + botão manual │  │   Claude Haiku   │
                  │  ↓               │  │   (com caching)  │
                  │  Cumbuca MCP     │  │                  │
                  │  (mcp client SDK,│  │                  │
                  │   quota-aware)   │  │                  │
                  └──────────────────┘  └──────────────────┘
                                  ▲
                                  │ OAuth 2.1 (PKCE)
                                  │ via Auth.js
                          ┌───────┴───────────────────────┐
                          │  Keycloak da Cumbuca          │
                          │  idc.cumbuca.com/realms/      │
                          │  cumbuca-mcp                  │
                          │  (FAPI 2.0; DCR habilitado)   │
                          └───────────────────────────────┘
```

**Responsabilidades:**

- **UI/RSC** — renderiza dashboard lendo apenas do MongoDB. Zero chamada
  ao MCP em tempo de render.
- **API routes** — auth (callbacks Auth.js → Keycloak), trigger manual
  de sync, revogação de consent (LGPD delete), override de categoria.
- **Sync worker** — cron **1× por dia** por usuário ativo, **quota-aware**.
  Por conexão ativa: chama tools do MCP via SDK respeitando os limites
  mensais (balance: 14/dia disponível, usa 1; txns recentes: 8/dia disponível,
  usa 1; list_accounts: 1/mês). A folga restante (13/dia em balance,
  7/dia em txns recentes) absorve botões "Sincronizar agora" manuais
  durante o dia sem estourar quota.
- **Categorizer Tier 1 (MCC rules)** — mapa estático MCC → categoria
  (5411 → mercado, 5814 → fast food, 5912 → farmácia, etc). Cobre ~80%
  das transações de cartão sem chamada externa.
- **Categorizer Tier 2 (LLM)** — Claude Haiku 4.5 com prompt caching.
  Só para transações de conta (sem MCC) e MCCs não mapeados. Roda em
  batch ao final de cada sync.

**Decisões de arquitetura:**

1. UI nunca chama MCP em tempo de render. Sempre lê do Mongo.
2. Auth Open Finance é **OAuth 2.1 padrão via Auth.js + Keycloak provider**
   contra `idc.cumbuca.com`. Não há tools "start_consent"/"finish_consent"
   no MCP. Auth.js armazena access/refresh token na sessão; o MCP client
   wrapper lê esse token e injeta como `Authorization: Bearer` em cada
   chamada.
3. **Sync é quota-aware:** o wrapper rastreia consumo mensal por bucket
   (`list_accounts`, `account_balance`, `account_txn_recent`,
   `account_txn_historical`) e recusa chamadas que estourariam o limite,
   exceto quando o usuário explicitamente pede `bypass_cache`.
4. Botão "Sincronizar agora" no header chama `POST /api/sync` (mesmo path
   do cron, escopo do usuário logado, retorna stats). Útil pra teste local
   e refresh sob demanda. Toggle "Forçar atualização de saldos"
   (`bypass_cache=true`) mostra warning de quota antes de disparar.

## 2. Modelo de dados (MongoDB)

Coleções gerenciadas pelo Auth.js adapter: `users`, `accounts` (registros
do provider OAuth Keycloak, NÃO contas bancárias), `sessions`,
`verification_tokens`. Schema padrão do `@auth/mongodb-adapter`.

Coleções da aplicação (prefixo `bank_*` pra distinguir de Auth.js):

```
user_profiles                // PII estendida do user
  _id
  userId                     // ref users (unique)
  encryptedCpf               // AES-256-GCM (opcional — Keycloak pode já validar; ver fluxo)
  cpfHash                    // SHA-256(cpf + pepper) — só se coletado
  fullName                   // do userinfo do Keycloak (claim `name`) se disponível
  createdAt, updatedAt
  unique index: { userId: 1 }
  index: { cpfHash: 1 }

bank_connections             // 1 por institution × user
  _id
  userId
  institutionId              // slug ("itau", "nubank", ...) — do consent_status
  institutionDisplayName     // pra UI
  status                     // active | expired | revoked | error
  consentExpiresAt           // NULLABLE — Cumbuca pode emitir consent sem expiração
  encryptedAccessToken
  encryptedRefreshToken
  tokenExpiresAt
  lastSyncAt
  lastSyncStatus
  quotaUsage                 // contadores mensais por bucket, resetam por mês de calendário
    {                        //   { "list_accounts": 1, "account_balance": 12,
                             //     "account_txn_recent": 5, "account_txn_historical": 2,
                             //     "month": "2026-05" }
  createdAt, updatedAt
  index: { userId: 1 }
  index: { userId: 1, institutionId: 1 }

bank_accounts                // contas/cartões reveladas via consent
  _id
  userId                     // denormalizado
  bankConnectionId
  externalId                 // accountId OU creditCardAccountId do MCP — dedup
  kind                       // "account" | "credit_card"
  type                       // raw do MCP: CONTA_DEPOSITO_A_VISTA, CONTA_POUPANCA, BLACK, etc
  subtype                    // INDIVIDUAL | JOINT | null
  institutionName
  displayName                // editável pelo user (default = name/product name)
  branchCode                 // só pra accounts
  number                     // mascarado pra UI; bruto pra debug
  checkDigit
  compeCode                  // só pra accounts (341 = Itaú)
  companyCnpj                // CNPJ da instituição (não PII)
  creditCardNetwork          // só pra credit_cards (MASTERCARD, VISA, ELO, ...)
  productType                // só pra credit_cards (BLACK, GOLD, ...)
  balanceComponents          // só pra accounts — centavos
    { available, blocked, automaticallyInvested }
  currentBalance             // soma dos componentes, derivada — pra queries rápidas
  currency                   // "BRL"
  balanceUpdatedAt           // do balance.updateDateTime
  updatedAt
  index: { userId: 1 }
  index: { userId: 1, bankConnectionId: 1 }
  unique: { bankConnectionId: 1, externalId: 1 }

transactions                 // unificada: conta + cartão (com discriminador)
  _id
  userId                     // denormalizado
  bankAccountId              // FK pra bank_accounts._id
  bankConnectionId           // denormalizado pra queries por instituição
  source                     // "account" | "credit_card"
  externalId                 // transactionId do MCP — dedup
  amount                     // centavos, sinal embutido (negativo = saída)
  currency                   // "BRL"
  date                       // Date — transactionDateTime
  postedDate                 // Date | null — billPostDate (só cartão)
  description                // transactionName (texto livre — pode ter PII)
  counterpartyCnpjCpfHash    // SHA-256(partieCnpjCpf + pepper) — só account txns
  counterpartyCnpjCpfLast6   // últimos 6 dígitos pra exibição
  // ─── específicos de cartão ─────
  mcc                        // payeeMCC (number) — só credit_card
  cardLast4                  // identificationNumber — só credit_card
  paymentType                // "A_VISTA" | "A_PRAZO" — só credit_card
  chargeNumber               // installment N — só credit_card+A_PRAZO
  chargeIdentificator        // groupId de installments
  billId                     // YYYYMMDD — só credit_card
  // ─── específicos de conta ─────
  pixType                    // "PIX" | "OUTROS" | "OPERACAO_CREDITO" — só account
  completedAuthorisedPaymentType // raw status do MCP
  // ─── categorização ─────
  category                   // slug ("food", "transport"...) ou null
  categorySource             // "mcc" | "llm" | "user" | null
  categorizedAt
  mcpRaw                     // payload original — debug; remover quando estabilizar
  indexes:
    { userId: 1, date: -1 }
    { userId: 1, category: 1, date: -1 }
    { userId: 1, bankAccountId: 1, date: -1 }
    { userId: 1, source: 1, date: -1 }
    unique: { bankAccountId: 1, externalId: 1 }

balance_snapshots            // pra gráfico de tendência mensal
  _id
  userId
  bankAccountId
  date                       // YYYY-MM-DD
  balance                    // centavos (soma dos componentes)
  components                 // breakdown { available, blocked, automaticallyInvested }
  unique: { userId: 1, bankAccountId: 1, date: 1 }

bill_summaries               // OPCIONAL no MVP — só cria se tela de Faturas for prioridade
  _id
  userId
  bankConnectionId
  bankAccountId              // do cartão (kind=credit_card)
  externalBillId             // YYYYMMDD
  dueDate
  minimumAmount              // centavos
  totalAmount                // centavos
  isInstalment
  payments                   // [{ amount, paidAt, mode, valueType }]
  fetchedAt
  unique: { bankAccountId: 1, externalBillId: 1 }
  index: { userId: 1, dueDate: -1 }

categories                   // seed data
  _id                        // slug
  labelPt                    // "Alimentação"
  icon                       // emoji ou chave
  color                      // hex
  displayOrder

sync_runs                    // auditoria
  _id
  userId
  bankConnectionId
  triggeredBy                // "cron" | "manual"
  startedAt, finishedAt
  status                     // running | success | partial | error
  stats:
    {
      transactionsFetched,
      transactionsNew,
      accountsUpdated,
      categorized: { mcc, llm, skipped },
      quotaConsumed: { list_accounts, account_balance, ... },
      errors: []
    }
  errorMessage
  index: { userId: 1, startedAt: -1 }

mcp_call_logs                // logs detalhados de cada chamada ao MCP (Seção 4)
  _id
  requestId
  userId
  bankConnectionId
  syncRunId
  tool                       // nome da tool MCP chamada
  quotaBucket                // qual bucket de quota foi consumido (ou cache-hit)
  quotaConsumed              // boolean — true se chamou MCP real, false se cache
  triggeredBy
  startedAt, durationMs
  status                     // ok | error | retry
  errorKind                  // transport | auth | mcp_tool_error | schema_mismatch | timeout | quota_exceeded
  errorCode, errorMessage
  argsRedacted
  responseSnippet            // primeiros 2KB, truncado
  mcpRaw                     // só em erro
  createdAt
  indexes:
    { userId: 1, startedAt: -1 }
    { syncRunId: 1 }
    { status: 1, startedAt: -1 }
    { quotaBucket: 1, startedAt: -1 }
    TTL: 30 dias (auto-expire em createdAt)
```

**Decisões importantes:**

1. **Dinheiro em centavos inteiros**, sempre. Parsing do MCP usa string-decimal
   → integer cents (multiplicação + arredondamento explícito, nunca float).
2. **`transactions` é unificada com discriminador `source`.** Account
   transactions e credit-card transactions vivem na mesma coleção mas com
   campos diferentes opcionais. Justificativa: o dashboard mostra os dois
   numa lista única ordenada por data; consultas cross-source ficam triviais.
3. `userId` denormalizado em todas as coleções financeiras — todo index
   composto começa com `userId`.
4. **`counterpartyCnpjCpfHash`** em account transactions: SHA-256 com pepper
   pra matching same-counterparty sem armazenar CPF/CNPJ em claro. Pepper
   em env (`COUNTERPARTY_HASH_PEPPER`), fora do banco.
5. **`balance_snapshots` armazena breakdown também** pra detectar mudanças
   suspeitas em `blocked` (cobrança em disputa, etc.) sem refetch.
6. **`bill_summaries`** é opcional no MVP — modo simplificado pode derivar
   tudo de `transactions` filtradas por `billId`. Coleção dedicada vale
   quando tela de Faturas for feature priorizada (v2).
7. **`bank_connections.quotaUsage`** resetado no início de cada mês de
   calendário pelo sync worker quando detecta mudança no campo `month`.
8. Tokens OAuth criptografados em repouso com AES-256-GCM. CPF (se
   coletado) idem. Chaves em env, propósito-separado.

## 3. Fluxos críticos

### Fluxo 1 — Signup + onboarding

Não há signup separado. Auth.js + Keycloak provider faz tudo:

```
1. /login                "Entrar com Cumbuca" → Auth.js redirect
2. → Keycloak hosted     User entra credenciais Cumbuca (ou cria conta
                         lá; Cumbuca controla esse UX)
3. → /api/auth/callback  Auth.js troca code por tokens, popula `users`
                         e `accounts` (Auth.js collection), cria sessão.
4. /                     Se primeira vez: empty state com CTA
                         "Conectar Open Finance" → Fluxo 2.
                         Senão: dashboard.
```

Notas:
- Não pedimos CPF na nossa UI no MVP. A Cumbuca já valida CPF do usuário
  durante o cadastro deles. Se precisarmos, pegamos via userinfo (claim
  `preferred_username` ou claim custom).
- O Auth.js provider para Keycloak já é built-in (`@auth/keycloak-provider`).
  Config:
  ```ts
  KeycloakProvider({
    issuer: "https://idc.cumbuca.com/realms/cumbuca-mcp",
    clientId: env.KEYCLOAK_CLIENT_ID,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET,
    authorization: { params: { scope: "openid profile offline_access open-finance" } }
  })
  ```
- **Dynamic Client Registration:** registramos o app uma vez (manual ou
  script de bootstrap) e salvamos `clientId`/`clientSecret` em env. Em
  produção podemos automatizar se necessário.

### Fluxo 2 — Conectar instituição (link Open Finance)

Pra v1, **uma instituição por usuário** vinculada implicitamente pelo
consent que ele deu durante o cadastro Cumbuca. O fluxo é:

```
1. Usuário loga (Fluxo 1)
2. Token de sessão Auth.js já tem `open-finance` scope autorizado pelo user
3. Backend chama mcp:get_consent_status com o access_token
   → retorna { institution_name, status, expires_at }
4. Cria bank_connection { institutionId: status.institution_name,
                          status: status.status, ... }
5. Dispara sync inicial (Fluxo 3) com triggeredBy="onboarding"
```

Pra **adicionar outra instituição** depois (v1+, MVP só uma):
- Cumbuca expõe re-consent? **Aberto pra validar em Phase 2.** Se sim, é
  um redirect pra Keycloak com `prompt=login` + outro scope ou audience.
  Se não, user precisa criar outra conta Cumbuca → fora do MVP.

### Fluxo 3 — Sync (cron diário ou botão manual) — quota-aware

```
Trigger: cron 1×/dia por user OU POST /api/sync do usuário logado
   │
   ▼
Para cada bank_connection com status="active":
   ├─ verifica quotaUsage: se month != mês atual, zera
   ├─ refresh de token se tokenExpiresAt < now+5min (Auth.js refresh flow)
   ├─ cria sync_runs { status: "running", triggeredBy, bankConnectionId }
   │
   ├─ TIER 1 — sempre roda (baratas no MCP cache):
   │   ├─ mcp:get_consent_status → atualiza status se mudou
   │   ├─ mcp:list_accounts → upsert bank_accounts (sem balance)
   │   │     [quota: 1× list_accounts/mês — só na 1ª chamada do mês,
   │   │      depois cache do MCP devolve sem custo]
   │   ├─ mcp:list_credit_cards → upsert bank_accounts (kind=credit_card)
   │   │
   │   └─ Para cada bank_account (kind=account):
   │        └─ mcp:get_account(account_id) → atualiza balanceComponents,
   │            balanceUpdatedAt, snapshot do dia em balance_snapshots
   │            [quota: account_balance — 420/mês ≈ 14/dia; sync diário
   │             consome 1/dia, sobram 13 pra refresh manual]
   │
   ├─ TIER 2 — transações:
   │   └─ Para cada bank_account (kind=account):
   │        └─ mcp:list_account_transactions(account_id,
   │             from_date=hoje-7d, to_date=hoje)
   │             [quota: account_txn_recent — 240/mês ≈ 8/dia; sync diário
   │              consome 1/dia, sobram 7 pra manuais]
   │   └─ Para cada bank_account (kind=credit_card):
   │        ├─ mcp:list_credit_card_bills(card_id) — sem quota documentada
   │        └─ Para cada bill nova OU bill com dueDate > hoje-30d:
   │             └─ mcp:list_credit_card_bill_transactions(card_id, bill_id)
   │
   ├─ Upsert em transactions (dedup por { bankAccountId, externalId })
   │   Para credit_card, normaliza creditDebitType → sinal do amount
   │   Para account, normaliza creditDebitType → sinal do amount
   │
   ├─ Categorização (Fluxo 4)
   │   ├─ Marca transactions sem category e com mcc → Tier 1 (MCC rules)
   │   └─ Marca remanescentes → Tier 2 (LLM)
   │
   ├─ Atualiza bank_connection.lastSyncAt + lastSyncStatus + quotaUsage
   └─ Fecha sync_runs { status, stats }
```

**Backfill inicial (na 1ª conexão):**
- Chama `list_account_transactions(from_date=hoje-30d)` no endpoint
  histórico (1 quota de 8/mês — orçamento total). Recuperar 12 meses
  exigiria 4 chamadas históricas (cobertura por tranche de 30 dias);
  decidimos fazer **só 30 dias** no MVP pra preservar quota. Histórico
  de 12 meses fica como botão "Importar histórico" opcional em settings.

`POST /api/sync` devolve `stats` ao caller. UI mostra toast:
*"3 novas transações, 2 categorizadas via MCC, 1 via LLM"*. Se quota
estourar, retorna `429` com info do bucket.

### Fluxo 4 — Categorização (2 tiers)

```
Tier 1 — MCC rules (rodam primeiro):
   ├─ Para cada transaction com source=credit_card e mcc presente:
   │   ├─ Consulta mapa estático MCC_TO_CATEGORY (em lib/categorize/mcc-map.ts)
   │   └─ Se hit → salva category + categorySource="mcc"
   │
   └─ Cobre ~80% das transações de cartão sem chamada externa.

Tier 2 — LLM (só pra remanescentes):
   ├─ Lote de até 50 transactions sem categoria, mesmo user.
   ├─ Anthropic Claude Haiku 4.5:
   │   ├─ system prompt fixo (cached, 5min TTL): regras + lista de categorias
   │   ├─ context (cached por user, 5min TTL): últimas 50 transactions já
   │   │   categorizadas do user (few-shot do estilo dele)
   │   └─ user: lista das N novas transações
   ├─ Output: { transactionId, category, confidence }
   ├─ confidence >= 0.7 → salva category + categorySource="llm"
   └─ < 0.7 → deixa null, user categoriza manualmente
```

**Override manual:** dropdown na lista de transações grava `category` +
`categorySource="user"`. Override vira few-shot na próxima execução do LLM.

**MCC map inicial** (em código, expansível):
- `5411, 5422, 5462, 5499` → mercado
- `5811, 5812, 5813, 5814` → alimentação fora
- `5541` → combustível
- `5912, 5993` → farmácia
- `4814, 4899, 4900` → utilities (telecom, energia)
- `5311, 5651, 5712, 5722, 5942, 5968` → varejo
- `4814` → telecom
- ... (lista completa documentada em código + tests)

### Fluxo 5 — Reauth / consent expirado ou revogado

```
Trigger: sync recebe 401 do MCP OU get_consent_status retorna
         status != "active"
   │
   ▼
   ├─ Marca bank_connection.status = "expired" | "revoked"
   ├─ Atualiza UI: banner "Reconectar Cumbuca" no /
   ├─ Botão "Reconectar" → next-auth signIn com prompt=consent
   └─ Após re-consent → status volta a "active", sync normal
```

`consentExpiresAt` pode ser `null` (Cumbuca emite consents sem expiração
explícita). Trigger principal é o 401, não watch de expiração.

### Fluxo 6 — Revogação / LGPD delete

```
User em /settings → "Excluir conta e dados"
   │
   ▼ POST /api/profile/delete
   ├─ mcp:revoke_consent (irreversível pelo lado da Cumbuca)
   ├─ Deleta em ordem:
   │   ├─ transactions
   │   ├─ balance_snapshots
   │   ├─ bill_summaries
   │   ├─ bank_accounts
   │   ├─ bank_connections
   │   ├─ mcp_call_logs
   │   ├─ sync_runs
   │   ├─ user_profiles
   │   └─ users (Auth.js — Auth.js adapter cuida)
   ├─ Auth.js signOut
   └─ 302 → /
```

## 4. Observabilidade da conexão com o MCP

Dois canais em paralelo: **stdout JSON estruturado** (ingerido pelo
Vercel/console) e **coleção `mcp_call_logs`** no Mongo (consulta histórica
+ surfacing na UI).

### Wrapper único — `lib/mcp/client.ts`

Nenhuma chamada direta ao SDK do MCP fora desse módulo:

```ts
async function callMcpTool<T>(
  ctx: {
    userId,
    bankConnectionId,
    requestId,
    syncRunId?,
    quotaBucket  // "list_accounts" | "account_balance" | ...
  },
  tool: string,
  args: unknown,
  schema: ZodSchema<T>
): Promise<T>
```

Esse wrapper:

1. **Quota gate.** Lê `bank_connections.quotaUsage[quotaBucket]`; se
   estourar limite e `bypass_cache` não for explícito → throw
   `QuotaExceededError` antes da chamada de rede.
2. Gera `requestId` (ULID).
3. Loga `mcp.call.start` (stdout + Mongo insert com `status="running"`).
4. Lê access_token da sessão Auth.js do user (resolvido via `bankConnectionId`).
5. Chama com timeout 30s + 2 retries em erros de transporte.
6. **Valida resposta com Zod schemas de `lib/mcp/tools.ts`** (gerados
   na Phase 0). Schema mismatch = `errorKind="schema_mismatch"`.
7. Loga `mcp.call.end` com `durationMs`, `status`, `quotaConsumed`.
8. Incrementa `bank_connections.quotaUsage[quotaBucket]` se chamada real.
9. Em erro: re-throw com `McpError` tipado.

### Redaction

`redact()` centralizada:
- `accessToken`, `refreshToken` → `***`
- `cpf` → `***.***.***-XX`
- `accountNumber`, `cardLast4` → últimos 4
- `partieCnpjCpf` → últimos 6 + hash
- Em prod: redact agressivo. Em dev: payload quase completo.

### Surfacing em UI dev

`POST /api/sync` devolve, além de stats:

```json
{
  "ok": false,
  "stats": {...},
  "errors": [{
    "tool": "list_account_transactions",
    "errorKind": "quota_exceeded",
    "errorCode": "account_txn_historical",
    "errorMessage": "Used 8/8 monthly quota; next reset 2026-06-01",
    "requestId": "req_...",
    "detailUrl": "/dev/logs/req_..."
  }]
}
```

Toast com mensagem amigável + link "ver detalhes" → `/dev/logs/[requestId]`
gated por `NODE_ENV=development` ou env flag `ALLOW_DEV_DASHBOARD=true`.

### `/dev/logs`

Listagem paginada com filtros (user/tool/status/quotaBucket). Cards no topo
com métricas agregadas via Mongo aggregation:
- Taxa de erro 24h por tool
- P95 de duração de `list_account_transactions`
- **Quota usage corrente** por bucket (do `bank_connections.quotaUsage`)

## 5. Estrutura de páginas e rotas

```
app/
├── layout.tsx                        // root: fonts, providers
├── globals.css
│
├── (auth)/
│   └── login/page.tsx                // botão "Entrar com Cumbuca"
│
├── (app)/
│   ├── layout.tsx                    // session + bank_connection gate
│   ├── page.tsx                      // / — Overview
│   ├── transactions/page.tsx
│   ├── accounts/page.tsx
│   ├── settings/page.tsx
│   └── connect-bank/page.tsx         // futuro — re-consent / nova institution
│
├── (dev)/
│   └── logs/
│       ├── page.tsx
│       └── [requestId]/page.tsx
│
└── api/
    ├── auth/[...nextauth]/route.ts   // Auth.js + Keycloak provider
    ├── profile/route.ts              // DELETE (LGPD exclusão + revoke)
    ├── sync/route.ts                 // POST manual (quota-aware, body
    │                                  // opcional { bypassCache?: bool })
    ├── transactions/[id]/category/route.ts
    └── cron/sync/route.ts            // header X-Cron-Secret
```

**Removido vs Rev 1:**
- `/onboarding/identity` e `/onboarding/bank` → Keycloak cuida do user/CPF;
  bank_connection é criada implicitamente no callback de auth.
- `/api/open-finance/start` e `/api/open-finance/callback` → Auth.js
  callback é o callback único; consent foi durante o login.
- `/api/open-finance/institutions` → não temos seletor de instituição (uma
  por consent).

**Decisões:**

1. `(app)/layout.tsx` é o portão único: checa session server-side. Se
   sem session → redirect `/login`. Se com session mas sem
   `bank_connections` ativa → mostra empty state com botão de re-trigger
   do sync inicial.
2. Páginas de leitura são RSC + Mongo direto.
3. API routes só para mutations e callbacks externos.
4. `/api/cron/sync` autentica via header `X-Cron-Secret`.
5. `(dev)` group bloqueado por middleware em prod.

## 6. Componentes UI

Sem mudança vs Rev 1 (mockup estilo FinTrack), exceto:

- `accounts/BankAccountCard.tsx` — exibe `balanceComponents` (breakdown
  em tooltip), notação "R$ 27,57 (R$ 1,00 disponível • R$ 26,57 investido)"
- `transactions/TransactionRow.tsx` — distingue visualmente account vs
  credit_card (ícone diferente; cartão mostra `cardLast4`)
- `sync/SyncNowButton.tsx` — após sync, toast detalhado com
  "MCC: N • LLM: M • Sem categoria: K"

Demais primitivos (`<Money/>`, `KpiCard`, charts via Recharts, etc.)
permanecem como Rev 1.

## 7. Segurança e compliance

### Identity provider

**Cumbuca Keycloak (`https://idc.cumbuca.com/realms/cumbuca-mcp`)** via
Auth.js v5 com `@auth/keycloak-provider`. Não temos nem armazenamos senha.
Reset de senha é responsabilidade da Cumbuca.

- Auth.js MongoDB adapter persiste `users`, `accounts`, `sessions`.
- Session strategy: JWT (default Auth.js v5).
- Cookies: `httpOnly`, `secure`, `sameSite=lax`.
- Access/refresh tokens da Cumbuca ficam na sessão JWT do Auth.js. Pra
  uso em background (sync worker), token é puxado do `accounts`
  collection (Auth.js persiste o token aí também).

### Bootstrap do OAuth client

DCR contra `https://idc.cumbuca.com/realms/cumbuca-mcp/clients-registrations/openid-connect`
uma única vez (manual via script + commit do client_id no `.env.example`,
client_secret em env de produção). Permite `redirect_uri` = nosso domain.

### Criptografia em repouso

| Dado | Algoritmo | Chave (env) |
|---|---|---|
| `bank_connections.encryptedAccessToken` | AES-256-GCM | `OPENFINANCE_TOKEN_KEY` |
| `bank_connections.encryptedRefreshToken` | AES-256-GCM | mesmo |
| `user_profiles.encryptedCpf` (se coletado) | AES-256-GCM | `PII_KEY` |
| `user_profiles.cpfHash` | SHA-256(cpf + pepper) | `CPF_HASH_PEPPER` |
| `transactions.counterpartyCnpjCpfHash` | SHA-256(value + pepper) | `COUNTERPARTY_HASH_PEPPER` |

Chaves geradas com `openssl rand -base64 32`, nunca commitadas.
`lib/crypto.ts` expõe `encrypt`/`decrypt`/`hash`. Zero uso direto de
`crypto` fora desse módulo.

### Autorização por usuário

Helper `requireSession()` único. Toda query parte de
`{ userId: session.user.id, ... }`. Nunca `userId` de parâmetro de request.

### Validação de entrada (Zod em todo route handler)

- `/api/sync`: body opcional `{ bypassCache?: boolean }`. Rate-limited.
- `/api/transactions/[id]/category`: `{ category: string }` — slug em
  whitelist (`categories` collection).
- `/api/cron/sync`: header `X-Cron-Secret` igual a env.
- `/api/profile/delete`: requer confirmação explícita (body com flag
  `confirm: true`).

### Rate limiting

- `/api/sync` manual: 1 req / 60s por user (429 + `Retry-After`).
- Implementação MVP: Mongo collection `rate_limits` com TTL.

### Headers de segurança

`middleware.ts`:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- CSP: `default-src 'self'; img-src 'self' data:; connect-src 'self'
  https://mcp.cumbuca.com https://idc.cumbuca.com https://api.anthropic.com`

### LGPD

- **Exclusão** (Fluxo 6) entra no MVP em `/settings`.
- **Portabilidade** (`/api/profile/export`) fora do MVP — anotada.
- **Aviso de coleta** em `/login`: "Ao entrar, você autoriza o app a
  ler seus dados financeiros via Cumbuca (Open Finance). Detalhes em
  /privacy."

### Variáveis de ambiente

```
# Auth.js + Keycloak (Cumbuca)
AUTH_SECRET=
KEYCLOAK_ISSUER=https://idc.cumbuca.com/realms/cumbuca-mcp
KEYCLOAK_CLIENT_ID=                        # via DCR uma vez
KEYCLOAK_CLIENT_SECRET=

# Mongo
MONGODB_URI=

# Crypto
PII_KEY=                                   # base64, 32 bytes
OPENFINANCE_TOKEN_KEY=                     # base64, 32 bytes
CPF_HASH_PEPPER=                           # string aleatória 64+ chars
COUNTERPARTY_HASH_PEPPER=                  # mesma ideia

# MCP / Open Finance
CUMBUCA_MCP_URL=https://mcp.cumbuca.com/mcp

# LLM
ANTHROPIC_API_KEY=

# Cron
CRON_SECRET=                               # header X-Cron-Secret

# Dev
ALLOW_DEV_DASHBOARD=                       # "true" libera /dev/logs fora de dev
```

`.env.local` gitignored. `.env.example` commitado.

## 8. Stack final e estrutura interna

### Dependências (runtime)

```jsonc
"next-auth": "5.x",
"@auth/mongodb-adapter": "^3",
"@auth/keycloak-provider": "(via next-auth 5.x — built-in)",
"mongodb": "^6",
"@modelcontextprotocol/sdk": "^1.29",
"@anthropic-ai/sdk": "latest",
"zod": "^4",
"@tanstack/react-query": "^5",
"recharts": "^2",
"ulid": "^2",
"date-fns": "^3"
```

**Removido vs Rev 1:**
- `@aws-sdk/client-cognito-identity-provider` (sem Cognito).

### Hosting

- **App**: Vercel.
- **DB**: MongoDB Atlas (M0 no MVP; sa-east-1 ou us-east-1).
- **Identity**: Cumbuca-hosted Keycloak — não temos nada pra hospedar.

### Cron

`vercel.json`:

```jsonc
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "0 8 * * *" }
  ]
}
```

1× ao dia às 08:00 UTC (≈ 05:00 BRT — dados frescos antes do usuário
abrir o app de manhã). Endpoint enumera `bank_connections` ativas e
dispara sync de cada. Sem necessidade do guard `lastSyncAt < now - 90min`
da rev anterior — quota sobra com folga.

**MongoDB Atlas free tier (M0)** confirmado pra MVP: 512MB storage,
shared CPU, conexões compartilhadas. Suficiente pra dezenas de usuários
testando. Limite real: ~50k transações por user antes de apertar (12
meses de histórico de cartão pra usuário com ~150 transações/mês = ~1800
docs; sobra muito). Migrar pra M10+ quando ultrapassar ~100 usuários
ativos OU dataset > 300MB.

### Estrutura interna

```
lib/
├── mongo.ts                            // conexão singleton
├── auth.ts                             // config Auth.js + requireSession()
├── crypto.ts                           // encrypt/decrypt/hash centralizados
├── mcp/
│   ├── client.ts                       // wrapper callMcpTool (quota-aware)
│   ├── tools.ts                        // Zod schemas (já existe da Phase 0)
│   ├── types.ts                        // (já existe)
│   ├── quotas.ts                       // mapa tool → quotaBucket → limite
│   └── errors.ts                       // McpError, QuotaExceededError
├── sync/
│   ├── runner.ts                       // orquestra sync_run
│   ├── upserts.ts                      // accounts/transactions/snapshots
│   ├── categorizer.ts                  // dispatcher (chama MCC e LLM)
│   └── llm.ts                          // chamada Anthropic em batch
├── categorize/
│   └── mcc-map.ts                      // MCC → categoria, static
├── repositories/
│   ├── transactions.ts
│   ├── accounts.ts
│   ├── connections.ts
│   └── profile.ts
└── format/
    ├── money.ts                        // string MCP → centavos; centavos → "R$ ..."
    ├── date.ts
    └── cnpj.ts                         // mask + hash + last6
```

**Pattern:** route handlers finos. API routes só validam (Zod), chamam
módulo de `lib/`, e modelam resposta.

## Fora do escopo do MVP

V2+:

- Múltiplas instituições por usuário (re-consent via Cumbuca, se suportado)
- Orçamentos por categoria
- Investimentos detalhados (depende do que o MCP expor — não vimos tool)
- Tela dedicada de Faturas (`bill_summaries` ativo)
- Alertas (saldo baixo, gasto incomum)
- Modo escuro / toggle de tema
- i18n (sem `next-intl` por enquanto)
- Multi-currency
- Exportação CSV/PDF
- Compartilhamento de relatórios
- MFA Cognito-style (Cumbuca já controla MFA do user)
- Audit log de ações do usuário
- ESLint rule custom pra flagrar `userId` de request
- `/api/profile/export` (portabilidade LGPD)
- `/privacy` com texto completo

## Premissas a confirmar na Phase 2 (e além)

1. **Valores de `get_consent_status.status` além de `active`** —
   confirmar `expired`, `revoked` empíricos.
2. **Comportamento quando consent é revogado pelo lado do banco** —
   401? get_consent_status retorna outro status?
3. **Re-consent pra adicionar 2ª instituição via Cumbuca** — pra v2.
4. **Refresh token rotation no Auth.js + Keycloak** — confirmar que a
   integração nativa do Auth.js cuida disso.
5. **Quotas de credit-card endpoints** (não documentadas; assumimos
   similares ao histórico de conta — observar mcp_call_logs).
