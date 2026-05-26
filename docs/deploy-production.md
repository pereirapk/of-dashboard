# Deploy em produção — Cumbuca Dashboard

Guia para colocar o app no ar usando **Vercel + MongoDB Atlas + Keycloak da Cumbuca**. Stack inteira fica no plano gratuito pra dezenas de usuários — você só paga quando crescer.

---

## Pré-requisitos

- [ ] Conta na [Vercel](https://vercel.com)
- [ ] Conta na [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- [ ] Conta na [Anthropic Console](https://console.anthropic.com) (opcional — sem isso, transações de conta ficam sem categoria via LLM, mas MCC ainda funciona)
- [ ] Um domínio (Vercel oferece subdomínio `*.vercel.app` grátis se você quiser pular essa parte)
- [ ] Repositório do projeto no GitHub/GitLab/Bitbucket conectável à Vercel

---

## 1 — MongoDB Atlas

1. Cria um **cluster M0** (free tier, 512MB). Região sugerida: `sa-east-1` (São Paulo).
2. **Database Access** → cria um usuário com password forte. Marca "Read and write to any database".
3. **Network Access** → adiciona `0.0.0.0/0` (Vercel não publica IPs estáticos pros functions; restringir por IP não funciona). Se isso te incomoda, considera Atlas com PrivateLink (pago).
4. **Connect → Drivers → Node.js** → copia a URI. Formato:
   ```
   mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/cumbuca?retryWrites=true&w=majority
   ```
   Guarda — vai virar o `MONGODB_URI` na Vercel.

> ⚠️ M0 tem 100 conexões simultâneas. Pra MVP é mais que suficiente.

---

## 2 — Registrar o cliente OAuth no Keycloak da Cumbuca

Você já fez isso no dev. Pra prod, **registra OUTRO cliente** apontando pro domínio de produção:

```bash
APP_BASE_URL=https://seu-dominio-prod.com bun run keycloak:register
```

Saída esperada:
```
✓ Registered. Paste these into .env.local:

KEYCLOAK_CLIENT_ID=cumbuca-dashboard-prod-xxxxx
KEYCLOAK_CLIENT_SECRET=yyyyyy
```

Guarda os 2 valores separadamente do dev. Eles entram em variáveis Vercel.

---

## 3 — Variáveis de ambiente na Vercel

No projeto Vercel → **Settings → Environment Variables**. Adiciona pra **Production** (e opcionalmente pra **Preview**, com valores separados de teste):

| Variável | Como gerar / obter | Notas |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` | Valor FRESCO pra prod (diferente do dev). Auth.js usa pra assinar JWT. |
| `AUTH_URL` | `https://seu-dominio-prod.com` | URL canônica. Sem isso Auth.js pode chutar URL errado nos callbacks. |
| `KEYCLOAK_ISSUER` | `https://idc.cumbuca.com/realms/cumbuca-mcp` | Mesmo do dev. |
| `KEYCLOAK_CLIENT_ID` | output do passo 2 | Cliente de PROD, não o de dev. |
| `KEYCLOAK_CLIENT_SECRET` | output do passo 2 | Idem. |
| `MONGODB_URI` | URI do passo 1 | Inclui usuário e senha. |
| `PII_KEY` | `openssl rand -base64 32` | AES-256-GCM key. |
| `OPENFINANCE_TOKEN_KEY` | `openssl rand -base64 32` | Idem. |
| `CPF_HASH_PEPPER` | `openssl rand -hex 32` | Pepper SHA-256. |
| `COUNTERPARTY_HASH_PEPPER` | `openssl rand -hex 32` | Idem. |
| `CUMBUCA_MCP_URL` | `https://mcp.cumbuca.com/mcp` | Constante. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Opcional. Sem → LLM categorizer não roda. |
| `ALLOW_DEV_DASHBOARD` | `false` (ou deixar vazio) | Em prod isso bloqueia `/logs`. |

> ⚠️ **NÃO** reutilize as keys do `.env.local` em prod. Gera valores frescos. Se você perder/expor as keys de prod, todos os tokens cifrados ficam ilegíveis e users precisam refazer login.

---

## 4 — Connectar o projeto à Vercel + deploy

Opção CLI (recomendado pra primeira vez):

```bash
npx vercel link        # liga o diretório local ao projeto
npx vercel pull        # baixa env vars de prod (verifica que tá tudo)
npx vercel deploy --prod
```

Opção Git (depois do primeiro deploy):

- Vercel já fica conectada ao seu repo. Cada `git push` na branch principal vira deploy de prod.

---

## 5 — Pós-deploy: seed das categorias

A collection `categories` precisa estar populada antes do primeiro user logar (senão `CategoryBadge` mostra slug bruto). Roda **uma vez** apontando pro Atlas de prod:

```bash
MONGODB_URI="mongodb+srv://...prod..." bun run seed:categories
```

Saída esperada: 16 categorias listadas com ícones lucide.

---

## 6 — Verificação E2E em prod

1. Abre `https://seu-dominio-prod.com` → redireciona pra `/login`.
2. Clica **"Entrar com Cumbuca"** → fluxo OAuth na Keycloak da Cumbuca.
3. Volta pra `/` → vê dashboard com KPIs e charts (ainda vazios na primeira vez).
4. Clica **"Sincronizar agora"** → sync popula contas + transações.
5. Atlas → confere collections: `users`, `accounts`, `bank_connections`, `bank_accounts`, `transactions`, `sync_runs`, `mcp_call_logs`, `categories` (16 rows).

---

## 7 — Estratégia de sync

Hoje usamos **AutoSync no cliente**: quando o usuário abre o dashboard e a última sync foi > 23h atrás, dispara `/api/sync` em background. Sem cron externo.

**Vantagens:**
- Sem dependência de Vercel Cron
- Sem `CRON_SECRET` pra gerenciar
- Sem traffic fantasma — só sincroniza quando o user usa
- Quota MCP da Cumbuca preservada (1× por dia por usuário)

Se quiser **cron de verdade no futuro** (ex: pra alertas push, atualizações garantidas mesmo sem login):

1. Cria `app/api/cron/sync/route.ts` (modelo no plano da Phase 4, removido depois)
2. Adiciona `CRON_SECRET` nas env Vercel
3. Cria `vercel.json` com schedule
4. `lib/auth/access-token.ts` (`ensureFreshAccessToken`) já existe — refresha tokens sem precisar de sessão de usuário. É a peça que falta pra cron funcionar.

---

## 8 — Custos estimados

| Serviço | Plano | Custo |
|---|---|---|
| Vercel | Hobby | Grátis (até 100GB bandwidth/mês) |
| MongoDB Atlas | M0 free | Grátis (512MB storage) |
| Cumbuca Keycloak / MCP | — | Grátis (você é o user; o regulado é a Cumbuca) |
| Anthropic API | pay-as-you-go | ~R$ 0,50/mês com prompt caching pra 1 usuário ativo |

**Total real esperado**: ~R$ 0,50 a R$ 5 / mês pra MVP single-user. Escala quando virar produto: M0 → M10 (~US$57/mês), Vercel Pro (~US$20/mês).

---

## 9 — Monitoramento

- **`/logs`** em prod fica bloqueado pelo proxy (middleware). Pra debugar problema isolado em prod sem habilitar `/logs`:
  - Set `ALLOW_DEV_DASHBOARD=true` temporariamente nas env vars Vercel
  - Faz o redeploy
  - Acessa `/logs?status=error&tool=...`
  - Desset depois
- **Vercel logs** (Functions tab) mostram stdout das routes, incluindo o JSON dos `mcp_call_logs` (canal 1 — stdout).
- **Atlas Charts** (opcional, gratuito) pra criar dashboards sobre as collections sem código.

---

## 10 — Rollback

Se algo der errado depois de um deploy:

1. Vercel → Deployments → encontra o último deploy bom → **Promote to Production**.
2. Se o problema é de schema do Mongo: tem que reverter à mão. Atlas tem snapshot **só na M10+** (M0 não tem backup automatizado). Pra MVP, considera:
   - Backup manual: `mongodump` periódico via script local
   - Ou paciência: re-sincroniza tudo da Cumbuca (idempotente — dedup por `bankAccountId + externalId` garante).

---

## 11 — Itens pós-launch (não bloqueante)

- Política de privacidade real (revisão jurídica em cima do placeholder em `/privacy`)
- MFA no Keycloak — a Cumbuca controla; só ligar no realm deles
- Sentry (ou similar) pra error tracking em prod
- Mais MCC codes no `lib/categorize/mcc-map.ts` conforme você ver transações sem categoria
- `/accounts/[id]` drill-down com histórico de saldo

---

## Checklist final pra ir ao ar

- [ ] Atlas M0 criado, IP allowlist `0.0.0.0/0`, user criado
- [ ] `MONGODB_URI` copiado
- [ ] `bun run keycloak:register` rodou com APP_BASE_URL de prod
- [ ] Todas 13 env vars setadas na Vercel (Production)
- [ ] `bun run seed:categories` rodou contra Atlas de prod
- [ ] Deploy feito (`vercel deploy --prod`)
- [ ] Login E2E funcionando em prod
- [ ] Sync rodou e populou collections
- [ ] `/privacy` carrega
- [ ] `/logs` retorna 404 (bom — `ALLOW_DEV_DASHBOARD` não setado)
- [ ] `/settings → Sair` funciona

Quando tudo isso bate, o app está em produção. 🚀
