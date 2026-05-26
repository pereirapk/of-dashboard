# Dashboard Cumbuca (of-dashboard)

Dashboard web **multi-usuário** de finanças pessoais que consome dados de
Open Finance agregados pelo **MCP da Cumbuca** (`https://mcp.cumbuca.com/mcp`).
Cada usuário se autentica via Cumbuca (Keycloak, com consent Open Finance) e
visualiza saldos, gastos e transações em painéis estilo *personal finance
dashboard* — em PT-BR, valores em R$.

> A UI nunca chama o MCP em tempo de render: um sync worker grava tudo no
> MongoDB e as páginas leem apenas do banco.

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js **16.2.6** (App Router) + React **19.2.4** |
| Linguagem | TypeScript 5 |
| Estilo | Tailwind CSS v4 (via PostCSS, sem `tailwind.config.*`) |
| Auth | Auth.js v5 (`next-auth`) + Keycloak provider da Cumbuca |
| Banco | MongoDB (driver nativo `mongodb`, não Mongoose) + `@auth/mongodb-adapter` |
| Open Finance | `@modelcontextprotocol/sdk` (cliente MCP, quota-aware) |
| Categorização | Regras MCC (determinístico) + Anthropic Claude Haiku (`@anthropic-ai/sdk`) |
| Gráficos | Recharts |
| Validação | Zod |
| Testes | Vitest + `mongodb-memory-server` |
| Gerenciador | **Bun** (`bun.lock`) |

> ⚠️ Esta versão do Next.js/React tem breaking changes em relação a versões
> anteriores. Antes de escrever código, consulte os docs em
> `node_modules/next/dist/docs/`. Veja `CLAUDE.md` e `AGENTS.md`.

## Pré-requisitos

- [Bun](https://bun.sh)
- MongoDB (local em `mongodb://localhost:27017` ou Atlas M0)
- Um OAuth client registrado no Keycloak da Cumbuca (via DCR — ver abaixo)
- (Opcional) `ANTHROPIC_API_KEY` para categorização via LLM

## Setup

```bash
# 1. Instalar dependências
bun install

# 2. Configurar variáveis de ambiente
cp .env.example .env.local
# preencha os valores (ver seção "Variáveis de ambiente")

# 3. Registrar o OAuth client no Keycloak da Cumbuca (uma vez)
bun run keycloak:register   # preenche KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET

# 4. Popular as categorias (seed)
bun run seed:categories

# 5. Subir o dev server
bun run dev                 # http://localhost:3000
```

### Gerando os segredos

```bash
openssl rand -base64 32     # AUTH_SECRET, PII_KEY, OPENFINANCE_TOKEN_KEY
openssl rand -hex 32        # CPF_HASH_PEPPER, COUNTERPARTY_HASH_PEPPER
```

## Scripts

| Comando | Descrição |
|---|---|
| `bun run dev` | Dev server em http://localhost:3000 |
| `bun run build` | Build de produção |
| `bun run start` | Roda o build de produção |
| `bun run lint` | ESLint (flat config) |
| `bun run test` | Testes com Vitest |
| `bun run seed:categories` | Popula a coleção `categories` |
| `bun run keycloak:register` | Registra o OAuth client (DCR) |
| `bun run discover:list` | Lista as tools expostas pelo MCP da Cumbuca |
| `bun run discover:auth` | Bootstrap de OAuth para discovery do MCP |

## Variáveis de ambiente

Veja `.env.example` para a lista completa. Resumo:

| Variável | Uso |
|---|---|
| `AUTH_SECRET` | Segredo do Auth.js |
| `KEYCLOAK_ISSUER` | `https://idc.cumbuca.com/realms/cumbuca-mcp` |
| `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` | Preenchidos pelo `keycloak:register` |
| `MONGODB_URI` | Conexão MongoDB (local ou Atlas) |
| `PII_KEY` | AES-256-GCM para PII (ex.: CPF) |
| `OPENFINANCE_TOKEN_KEY` | AES-256-GCM para tokens OAuth em repouso |
| `CPF_HASH_PEPPER` | Pepper para hash de CPF |
| `COUNTERPARTY_HASH_PEPPER` | Pepper para hash de contraparte (CNPJ/CPF) |
| `CUMBUCA_MCP_URL` | `https://mcp.cumbuca.com/mcp` |
| `ANTHROPIC_API_KEY` | Categorizador LLM (opcional) |
| `ALLOW_DEV_DASHBOARD` | `"true"` libera `/dev/logs` fora de dev |

`.env.local` é gitignored; só `.env.example` vai para o repositório.

## Arquitetura

Três processos lógicos no mesmo deploy:

- **UI / RSC** — renderiza o dashboard lendo apenas do MongoDB. Zero chamada
  ao MCP em tempo de render.
- **API routes** — callbacks do Auth.js (Keycloak), trigger manual de sync,
  override de categoria, exclusão LGPD.
- **Sync worker** — cron 1×/dia por usuário ativo, **quota-aware**. Chama as
  tools do MCP respeitando os limites mensais por endpoint.

```
Browser ──► Next.js (App Router) ──► MongoDB ◄── Sync worker ──► Cumbuca MCP
                  │                                                    ▲
                  └── API routes ── OAuth 2.1 (PKCE) ──► Keycloak da Cumbuca
```

### Categorização (2 tiers)

1. **Tier 1 — regras MCC** (`lib/categorize/`): mapa estático MCC → categoria.
   Cobre ~80% das transações de cartão, sem chamada externa.
2. **Tier 2 — LLM** (Claude Haiku, com prompt caching): só para transações de
   conta e MCCs não mapeados. Roda em batch ao final de cada sync.

Override manual na lista de transações grava `categorySource="user"` e vira
few-shot na próxima execução do LLM.

### Estrutura de pastas

```
app/
├── (auth)/login            # "Entrar com Cumbuca"
├── (app)/                  # dashboard (gate de sessão + conexão)
│   ├── page.tsx            # Overview
│   ├── transactions/       # lista + filtros + edição de categoria
│   ├── accounts/           # contas e cartões conectados
│   ├── settings/           # exclusão LGPD, sign out
│   └── connect-bank/
├── (dev)/logs              # observabilidade do MCP (gated)
├── privacy/                # aviso de coleta (LGPD)
└── api/
    ├── auth/[...nextauth]  # Auth.js + Keycloak
    ├── sync/               # POST sync manual (quota-aware)
    ├── categories/
    ├── transactions/[id]/category
    └── profile/delete      # exclusão LGPD + revoke_consent

lib/
├── mongo.ts                # conexão singleton
├── auth.ts                 # config Auth.js + requireSession()
├── crypto.ts               # encrypt/decrypt/hash centralizados
├── mcp/                    # cliente MCP (wrapper único, quota-aware), schemas Zod
├── sync/                   # runner + ensure-connection
├── categorize/             # MCC map + LLM dispatcher
├── repositories/           # acesso a cada coleção do Mongo
├── aggregations/           # saldos e gastos para os painéis
└── format/                 # dinheiro em centavos → "R$ ..."

scripts/mcp-discovery/      # ferramentas de discovery do MCP da Cumbuca
docs/                       # design spec, planos, guia de deploy e MCP discovery
tests/                      # suíte Vitest (lib + MCP fixtures)
```

## Segurança & LGPD

- **Identidade**: Keycloak da Cumbuca via OAuth 2.1 (PKCE). O app não armazena
  senhas.
- **Criptografia em repouso**: tokens OAuth e PII com AES-256-GCM; CPF/CNPJ de
  contraparte via SHA-256 com pepper. Toda crypto passa por `lib/crypto.ts`.
- **Autorização**: `requireSession()` único; toda query parte de
  `{ userId: session.user.id }`, nunca de `userId` vindo da request.
- **Validação**: Zod em todo route handler.
- **Exclusão de dados** (`/settings` → `POST /api/profile/delete`): revoga o
  consent no MCP e apaga todas as coleções do usuário.

## Testes

```bash
bun run test
```

A suíte usa `mongodb-memory-server` para os repositories e fixtures de
respostas reais do MCP em `tests/mcp/fixtures/`.

## Deploy

App pensado para **Vercel** + **MongoDB Atlas**, com cron diário de sync.
Veja `docs/deploy-production.md` para o passo a passo completo.

## Documentação adicional

- `docs/superpowers/specs/2026-05-20-dashboard-cumbuca-design.md` — design completo
- `docs/superpowers/plans/` — planos de implementação por fase
- `docs/mcp-discovery.md` — detalhes técnicos das tools do MCP da Cumbuca
- `docs/deploy-production.md` — guia de deploy
- `CLAUDE.md` / `AGENTS.md` — instruções para agentes de código
