# Cumbuca MCP — Discovery Report

**Run date:** 2026-05-20
**MCP URL:** https://mcp.cumbuca.com/mcp
**SDK version:** @modelcontextprotocol/sdk@1.29.0
**Authenticated institution observed:** Itaú (Itaú Unibanco S.A.)

## How Phase 0 actually played out

The original Phase 0 plan assumed Cumbuca exposed MCP-internal `start_consent`
tools and that an unauthenticated `listTools()` would surface a tool catalog.
**Both assumptions were wrong.**

The MCP follows the standard MCP Authorization spec (OAuth 2.1 against an
external Keycloak), rejects even the protocol `initialize` handshake without
a valid bearer token, and exposes a small fixed set of read tools focused on
Itaú Open Finance data.

To get past the auth wall without building our own OAuth client first, we
took a shortcut: the user added the MCP to a Claude Code session
(`claude mcp add --transport http cumbuca https://mcp.cumbuca.com/mcp`) and
authenticated through Claude Code's built-in OAuth handler. The same Claude
Code session was then used to call each tool once, capturing real responses.

The OAuth client code we built (`scripts/mcp-discovery/auth-bootstrap.ts`,
`FileOAuthProvider`, `callback-server.ts`) remains useful for Phase 1+ when
the Next.js app itself must authenticate.

## OAuth metadata (still accurate)

`GET https://mcp.cumbuca.com/.well-known/oauth-protected-resource`

```json
{
  "authorization_servers": ["https://idc.cumbuca.com/realms/cumbuca-mcp"],
  "resource": "https://mcp.cumbuca.com",
  "resource_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid", "profile", "offline_access", "open-finance"],
  "tls_client_certificate_bound_access_tokens": true
}
```

The authorization server is a Keycloak realm configured for FAPI 2.0
(`x-fapi-interaction-id` header observed). Dynamic Client Registration is
open; PKCE S256 supported; mTLS- and DPoP-bound tokens supported by the AS
but **not enforced at the MCP resource** (Claude Code obtains a plain
bearer token via DCR + auth code + PKCE and it works — confirmed empirically).

## Tool catalog

8 tools, all read-only except `revoke_consent`.

| Name | Args | Returns | Quota (per user/month) | Notes |
|---|---|---|---|---|
| `get_consent_status` | none | `{ expires_at, institution_name, status }` | (none documented) | use as health check |
| `list_accounts` | `{ bypass_cache? }` | `{ accounts: Account[] }` | **8/month** | cache-heavy |
| `get_account` | `{ account_id, bypass_cache? }` | `{ account, balance }` | **8/month** (details) + **420/month** (balance) | separate caches |
| `list_account_transactions` | `{ account_id, from_date?, to_date?, bypass_cache? }` | `{ transactions: AccountTransaction[] }` | **240/month** if range ⊆ last 7d, else **8/month** | per-day cache reused across overlapping queries |
| `list_credit_cards` | none | `{ credit_cards: CreditCard[] }` | (none documented) |  |
| `list_credit_card_bills` | `{ credit_card_account_id }` | `{ bills: Bill[] }` | (none documented) | newest first; `billId` = `YYYYMMDD` |
| `list_credit_card_bill_transactions` | `{ credit_card_account_id, bill_id }` | `{ transactions: CreditCardTransaction[] }` | (none documented) | very different shape from account transactions |
| `revoke_consent` | none | `{}` | **irreversible** | use only with explicit user confirmation |

## Per-tool details (observed shapes)

### `get_consent_status`

**Observed response:**
```json
{
  "expires_at": null,
  "institution_name": "itau",
  "status": "active"
}
```

- `expires_at` can be `null`. Possibly Cumbuca consents are non-expiring while
  active. Validate in Phase 1+ by checking a longer-lived consent or by
  letting one age. **Spec delta:** `bank_connections.consentExpiresAt` must
  be nullable.
- `status` observed: `active`. Unknown values: `expired`, `revoked` —
  inferred but not seen. Treat unknown as error.

### `list_accounts`

**Observed:**
```json
{
  "accounts": [
    {
      "accountId": "908cea12-72dd-3654-9b30-18c98e292b09",
      "branchCode": "0095",
      "brandName": "itau",
      "checkDigit": "4",
      "companyCnpj": "60701190000104",
      "compeCode": "341",
      "number": "00021126",
      "type": "CONTA_DEPOSITO_A_VISTA"
    }
  ]
}
```

- `accountId` is a UUID; this is the foreign key used by `get_account` and
  `list_account_transactions`.
- `type` values are Brazilian Open Finance canonical strings (e.g.
  `CONTA_DEPOSITO_A_VISTA` = checking, `CONTA_POUPANCA` = savings,
  `CONTA_PAGAMENTO_PRE_PAGA` = prepaid). Treat the field as an open string
  in our schema; map known values in the UI layer.
- `compeCode` `341` = Itaú. `companyCnpj` is the bank's CNPJ, not the
  account holder's.
- **No balance here.** Must call `get_account` per account for balance.

### `get_account`

**Observed:**
```json
{
  "account": {
    "branchCode": "0095",
    "checkDigit": "4",
    "compeCode": "341",
    "currency": "BRL",
    "number": "00021126",
    "subtype": "INDIVIDUAL",
    "type": "CONTA_DEPOSITO_A_VISTA"
  },
  "balance": {
    "automaticallyInvestedAmount": { "amount": "26.57", "currency": "BRL" },
    "availableAmount":               { "amount": "1.00",  "currency": "BRL" },
    "blockedAmount":                 { "amount": "0.00",  "currency": "BRL" },
    "updateDateTime": "2026-05-13T06:02:54Z"
  }
}
```

- `account` block here does **not** include `accountId` (you queried by it).
- **Balance is split into three components.** The "real" balance for the user
  is the sum: `available + blocked + automaticallyInvested`. The example
  account has only R$ 1,00 in `available` because R$ 26,57 is auto-invested
  by Itaú (Investe Fácil pattern). Our UI must show the sum, and ideally
  show the breakdown on hover.
- `Money` shape is `{ amount: string, currency: string }`. Amount is a
  decimal string with **2 to 4 decimal places** depending on context.
  Never parse as float — convert via integer cents (`Math.round(parseFloat * 100)`
  is acceptable for 2dp; for 4dp use string parsing).
- `subtype` observed: `INDIVIDUAL`. Joint accounts likely `JOINT`.

### `list_account_transactions`

**Observed (sample, sanitized):**
```json
{
  "transactions": [
    {
      "completedAuthorisedPaymentType": "TRANSACAO_EFETIVADA",
      "creditDebitType": "DEBITO",
      "partieCnpjCpf": "53859112000169",
      "transactionAmount": { "amount": "82.02", "currency": "BRL" },
      "transactionDateTime": "2026-05-12T19:15:08.048Z",
      "transactionId": "42169fe6-7b58-428d-b6c6-d8ad382f6666",
      "transactionName": "Pagamento de Pix QR Code CPFL SANTA CRUZ",
      "type": "PIX"
    }
  ]
}
```

- Amounts are **always positive numbers**. Direction comes from
  `creditDebitType` (`DEBITO` = outflow, `CREDITO` = inflow). Our Mongo
  `transactions.amount` should be **signed cents** (`-8202` here). Compute
  sign at upsert time.
- `partieCnpjCpf` is the counterparty's tax id (CNPJ or CPF). **PII** —
  must be encrypted at rest or hashed if we keep it. **Recommendation:**
  store only the last 6 digits + a SHA-256(full + pepper) hash; useful for
  same-counterparty matching without storing the raw value.
- `transactionName` is free text — descriptive, contains merchant names,
  Pix recipient names, etc. Real PII risk. Keep it; encrypt-at-rest is fine.
- `transactionId` is a UUID — primary dedup key.
- `type` values observed: `PIX`, `OUTROS`, `OPERACAO_CREDITO`. Treat as
  open string.
- `completedAuthorisedPaymentType` observed: `TRANSACAO_EFETIVADA`. Likely
  also `TRANSACAO_PENDENTE`. Open string.
- Default window when no `from_date`/`to_date` is **last 7 days**. Empty
  array is a valid response.

### `list_credit_cards`

**Observed:**
```json
{
  "credit_cards": [
    {
      "brandName": "ITAU",
      "companyCnpj": "60872504000123",
      "creditCardAccountId": "88ab7cc3-b2d8-5e2c-be91-8a5adf889217",
      "creditCardNetwork": "MASTERCARD",
      "name": "UNICLASS BLACK PONTOS",
      "productType": "BLACK"
    }
  ]
}
```

- `name` is the product display name. Useful as label in UI.
- `creditCardNetwork` known values: `MASTERCARD`, `VISA`, `ELO`, `AMEX`,
  `HIPERCARD`. Open string in schema.
- `productType` known: `BLACK`, `PLATINUM`, `GOLD`, `STANDARD`. Open string.
- No balance/limit field. **Spec delta:** credit-card "balance" in our UI
  must be derived from the latest bill's `billTotalAmount` minus payments.

### `list_credit_card_bills`

**Observed (one bill):**
```json
{
  "billId": "20260509",
  "billMinimumAmount": { "amount": "1007.1500", "currency": "BRL" },
  "billTotalAmount":   { "amount": "9944.1000", "currency": "BRL" },
  "dueDate": "2026-05-09",
  "isInstalment": true,
  "payments": [
    {
      "amount": "3089.1000",
      "currency": "BRL",
      "paymentDate": "2026-05-11",
      "paymentMode": "BOLETO_BANCARIO",
      "valueType": "VALOR_PAGAMENTO_FATURA_REALIZADO"
    }
  ]
}
```

- `billId` format is `YYYYMMDD` of the due date — **not opaque**. Sortable
  and predictable.
- `dueDate` repeats the date.
- `billMinimumAmount` / `billTotalAmount` use **4 decimal places**
  (different from account balance's 2 decimals).
- `payments[]` lists actual payments against the bill. A bill can have
  multiple partial payments. `paymentMode` observed: `BOLETO_BANCARIO`.
  Likely also `PIX`, `DEBITO_AUTOMATICO`.
- `isInstalment` true means the bill is paid in installments. Did not
  observe `false` cases — confirm in Phase 1.
- 13 historical bills returned in one response, newest first. **No
  pagination** — Cumbuca returns the full history available (Open Finance
  spec limit is 12 months for credit cards).

### `list_credit_card_bill_transactions`

**Observed (sample, sanitized):**
```json
{
  "amount":           { "amount": "70.0000", "currency": "BRL" },
  "billId":           "20260509",
  "billPostDate":     "2026-05-02",
  "brazilianAmount":  { "amount": "70.0000", "currency": "BRL" },
  "creditDebitType":  "DEBITO",
  "identificationNumber": "8708",
  "payeeMCC":         5814,
  "paymentType":      "A_VISTA",
  "transactionDateTime": "2026-05-01T23:39:04.000Z",
  "transactionId":    "02F004000541555200037507801052026MT261220166000010371168001443274",
  "transactionName":  "RANCHO DO ESPETINHO AN",
  "transactionType":  "PAGAMENTO"
}
```

Installment transactions add fields:
```json
{
  "chargeIdentificator": 2,
  "chargeNumber":        5,
  "paymentType":         "A_PRAZO",
  "transactionName":     "AMAZONMKTPLC*FIDCO02/05"
}
```

- **`payeeMCC` is gold.** This is the standard Merchant Category Code
  (ISO 18245). 5411 = grocery, 5814 = fast food, 5912 = drug store,
  5541 = gas, 4814 = telecom, 5311 = department store, etc. We can build
  a **rule-based categorizer** using a static MCC→category map that
  handles ~80% of credit-card transactions without an LLM call. The LLM
  fills in account transactions (no MCC) and unmapped MCCs. **Spec
  delta:** add `categorySource = "mcc"` to the enum.
- `brazilianAmount` and `amount` are identical for BRL transactions.
  Likely diverge for international purchases (FX conversion).
- `identificationNumber` is the last 4 of the physical card used. With
  multiple cards on one bill (we saw `8708`, `2437`, `7952`, `0250`,
  `0932`, `5078`), we can split spending by card. **Spec delta:** add
  optional `cardLast4` to credit-card transactions.
- `transactionId` is a long opaque string (not UUID like account txns).
  Different format → fine as primary key, but our schema must accept both.
- `paymentType`: `A_VISTA` (lump sum) or `A_PRAZO` (installment).
- `chargeNumber` / `chargeIdentificator` only present on installments:
  `chargeNumber` = "current installment of total" (e.g., 5 of 10),
  `chargeIdentificator` likely groups installments of the same purchase.
- `transactionType` values observed: `PAGAMENTO`,
  `OPERACOES_CREDITO_CONTRATADAS_CARTAO`, `OUTROS`.
- `otherCreditsType` appears on credit transactions (e.g. annual fee
  encargos): `CREDITO_ROTATIVO`.
- `transactionalAdditionalInfo` is a free-text hint: `OUTROS`, `ENCARGOS`.
- `creditDebitType: CREDITO` appears for refunds/cashback.

### `revoke_consent`

Not called during discovery (irreversible). The MCP description warns the
caller must explicitly confirm. Useful for the LGPD-delete flow:
`/api/profile/delete` should call this after wiping local data.

## Quota / cache architecture (CRITICAL spec delta)

The MCP itself enforces monthly per-user request quotas, separately for
each endpoint:

| Endpoint | Quota / user / month | Cache reuse |
|---|---|---|
| `list_accounts` | 8 | 1 call returns full list |
| `get_account` account-detail | 8 | metadata changes rarely |
| `get_account` balance | 420 (~14/day) | refreshed independently |
| `list_account_transactions` recent (≤7d) | 240 (~8/day) | per-day cache |
| `list_account_transactions` historical (>7d) | 8 | days reused once fetched |
| Credit-card endpoints | not documented; assume similar |  |

The original spec assumed an **hourly cron** for sync. That would burn the
8/month limits in less than a day. Architecture must change.

**Revised sync cadence:**

1. **On first connection** (single batch):
   - 1× `list_accounts`
   - 1× `get_account` per account (details + balance)
   - 1× `list_credit_cards`
   - 1× `list_credit_card_bills` per card
   - 1× `list_credit_card_bill_transactions` per bill (last 12 months,
     but cached server-side once fetched)
   - 1× `list_account_transactions` per account with a 30-day window
     (uses the historical endpoint — 1 quota per account)

2. **Periodic refresh (cron every 2-4 hours)** — only what doesn't burn
   precious quota:
   - 1× balance refresh per account (240×2-4h=8-16 daily, well under 14/day)
   - 1× `list_account_transactions` per account, window = last 7 days (uses
     the 240/month endpoint; ~6/day per account is well under 8/day budget)
   - 1× `list_credit_card_bills` per card (no quota mentioned; safe)

3. **Manual "Sync now" button**:
   - Same path as periodic refresh by default.
   - "Force refresh balances" toggle exposes `bypass_cache: true` and warns:
     "this will consume one of your 8 monthly account-details quota."
   - "Refresh historical" toggle warns about the 8/month account-transactions
     historical quota.

**`mcp_call_logs` additions:**
- `quotaBucket` field: e.g. `"list_accounts"`, `"account_balance"`,
  `"account_txn_recent"`, `"account_txn_historical"`.
- `quotaConsumed` boolean: false if cache hit, true if MCP made a real call.
  Cumbuca doesn't tell us directly — we infer from duration (>500ms is
  probably a real call) or from `bypass_cache` we passed.
- Display per-bucket quota usage in `/dev/logs` so we can monitor.

## Data model deltas

The MongoDB schemas in the original spec need adjustments based on
observed shapes. Key changes summarized; full revision will land in the
Phase 1 plan or as an amendment to the spec.

### `bank_accounts` — current spec was incomplete

Add:
- `compeCode: string` (e.g. "341")
- `companyCnpj: string` (bank's CNPJ; not PII per se)
- `branchCode: string`
- `checkDigit: string`
- `subtype: string` (`INDIVIDUAL` / `JOINT`)
- `balanceComponents: { available: number, blocked: number, automaticallyInvested: number }` (cents). The single `currentBalance` field is the sum.
- `balanceUpdatedAt: Date` (from `balance.updateDateTime`)

### Distinguish account vs credit-card transactions

The original spec had one `transactions` collection. Reality has two distinct
shapes. Options:

**Option A (recommended): single collection with discriminator.**
- Add `source: "account" | "credit_card"`.
- Add optional credit-card-only fields: `mcc?`, `cardLast4?`, `paymentType?` (`A_VISTA`|`A_PRAZO`), `chargeNumber?`, `chargeIdentificator?`, `billId?`.
- Account-only field: `counterpartyCnpjCpfHash?` (hashed for PII).

**Option B: two collections (`bank_transactions`, `credit_card_transactions`).**
- More work, but each schema stays tighter. Future tooling on either side
  doesn't pay tax for the other.

Recommendation: **Option A**, because the dashboard surfaces them in a
unified list and consistent sorting/filtering is easier with one collection.

### `bank_connections` updates

- `consentExpiresAt` must be **nullable** (Cumbuca's `expires_at: null`).
- Add `institutionId: string` (the slug, e.g. `"itau"`) and
  `institutionDisplayName: string`. Even though Cumbuca returns just one
  institution per consent, we already plan multiple connections per user,
  so this field is per-connection.

### New collection: `bill_summaries`

Cards have bills; bills have transactions. The `list_credit_card_bills`
output is rich (minimum amount, total, payments). Worth a dedicated
collection because we'll want a "Faturas" page in v2.

```
bill_summaries
  _id
  userId
  bankConnectionId
  bankAccountId             // links to the credit_card account row
  externalBillId            // YYYYMMDD
  dueDate
  minimumAmount             // cents
  totalAmount               // cents
  isInstalment
  payments: [{ amount, paidAt, mode, valueType }]
  fetchedAt
  unique: { bankAccountId: 1, externalBillId: 1 }
  index:  { userId: 1, dueDate: -1 }
```

In MVP we can defer this and just keep transactions linked back via
`billId`. Decide in Phase 1.

## Categorizer strategy delta

Original spec: LLM categorizer for all transactions. With MCC available on
credit-card transactions, we have a **two-tier strategy**:

1. **Rule layer (deterministic, free, fast):** static MCC → category map
   covering the common codes (grocery 5411, fast food 5811-5814, gas 5541,
   pharmacy 5912, etc.). Sets `categorySource: "mcc"`. Covers the bulk of
   credit-card spending instantly with no LLM cost.

2. **LLM layer (Anthropic Claude Haiku):** only for transactions the MCC
   map doesn't cover (account transactions, missing MCC, unrecognized MCC).
   Sets `categorySource: "llm"`.

3. **User override layer:** always wins. Sets `categorySource: "user"`.

This drops LLM cost by an order of magnitude in real usage.

`categorySource` enum becomes: `"mcc" | "llm" | "user" | null`.

## Spec deltas — summarized for Phase 1 planning

When writing the Phase 1 plan, the spec needs updating in these places:

### Section 1 (Architecture)
- Remove the diagram block that says `oauth_tokens (enc)` — tokens live in
  `bank_connections`. Already partially fixed.
- Sync cadence in the diagram should say "every 2-4h", not implied hourly.

### Section 2 (Data model)
- `bank_accounts`: add fields above. Replace `currentBalance` semantics with
  `balanceComponents` + derived sum.
- `bank_connections.consentExpiresAt`: nullable. Add `institutionId`,
  `institutionDisplayName`.
- `transactions`: add `source`, `mcc?`, `cardLast4?`, `paymentType?`,
  `chargeNumber?`, `chargeIdentificator?`, `billId?`,
  `counterpartyCnpjCpfHash?`. Update `categorySource` enum to include `"mcc"`.
- Add `bill_summaries` collection (or note as v2).

### Section 3 (Flows)
- **Flow 2 (Connect bank)** — most rewrites:
  - Replace the "MCP returns consentUrl" steps with **standard OAuth 2.1**
    against `https://idc.cumbuca.com/realms/cumbuca-mcp`. Use Auth.js's
    Keycloak provider (built-in).
  - The user's CPF is **not** an input to any MCP tool. CPF collection
    (planned in `/onboarding/identity`) is for our own KYC use, not for
    the consent flow. **Verify in Phase 1** whether Keycloak prompts the
    user for CPF on its side — likely yes, but it's Keycloak's UI, not
    ours.
  - There is no `start_consent` / `finish_consent` MCP tool. Drop those
    names from the spec.
- **Flow 3 (Sync)** — rewrite cadence + quota awareness as detailed above.
- **Flow 4 (Categorization)** — add the MCC rule layer as Tier 0 before
  the LLM tier.
- **Flow 5 (Reauth)** — `consentExpiresAt` may be null. The reauth trigger
  is then a 401 from the MCP (token expired) or `get_consent_status`
  returning a non-active status.

### Section 5 (Routes)
- Drop `/api/open-finance/start` and `/api/open-finance/callback` in favor
  of the Auth.js Keycloak provider's `/api/auth/callback/cumbuca` (or
  similar — the framework owns this URL).
- Add `/api/open-finance/revoke` that calls `revoke_consent` from a user's
  /settings page.

### Section 7 (Security / Identity)
- Identity provider strategy decision needed. The spec said Cognito; reality
  says we **must** OAuth against Cumbuca's Keycloak to access data anyway.
  Options:
  - **(a) Cumbuca Keycloak only.** Drop Cognito. Login to app = login at
    Keycloak. The Auth.js Keycloak provider does the whole flow. Simplest.
  - **(b) Cognito for app login, Keycloak as "linked account".** Two
    identities per user. More flexible but more code; needed only if we
    expect users without Cumbuca consent to use the app for something else.
  - **Recommendation:** (a) for MVP. The product is *defined* by Cumbuca
    OF data; no value without it.
- mTLS-bound tokens: confirmed **not required** for normal MCP access
  (Claude Code uses plain bearer successfully).

### Section 8 (Stack)
- `next-auth` providers: `@auth/keycloak-provider` (built-in), replacing
  Cognito provider.
- Drop `@aws-sdk/client-cognito-identity-provider`.
- Keep `@modelcontextprotocol/sdk`. The transport's `authProvider` will
  read the access token from the user's Auth.js session (an adapter we'll
  write that bridges Auth.js sessions to MCP's OAuthClientProvider).

## What we don't yet know

To validate in Phase 1+:

1. **What `get_consent_status.status` values exist** beyond `active`.
2. **What happens when a consent expires.** Does the token still work?
   Does `list_accounts` return 401? Does it return empty?
3. **`isInstalment: false` bills.** Confirm they exist and same shape.
4. **Currency field outside BRL.** Open Finance allows multi-currency;
   our spec is BRL-only for MVP, but the data model must accept multi.
5. **Refresh-token rotation cadence.** Keycloak typically rotates;
   confirm Auth.js handles it transparently with the Keycloak provider.
6. **The `JOINT` account subtype.** Does it surface as one row or as
   multiple? Out of scope for MVP but worth a doc note.

## Files produced

- `lib/mcp/tools.ts` — Zod schemas for all 8 tools (Task 10)
- `lib/mcp/types.ts` — TypeScript types inferred from Zod
- `tests/mcp/fixtures/*.json` — sanitized fixtures (Task 9)
- `tests/mcp/tools.test.ts` — schema validation tests (Task 10)
- `scripts/mcp-discovery/auth-bootstrap.ts` + `lib/file-oauth-provider.ts` +
  `lib/callback-server.ts` — OAuth client retained for Phase 1+

## Phase 0 verdict

Discovery complete enough to plan Phase 1. Spec deltas captured here are
the input for the Phase 1 plan, which must:

1. Update the canonical spec document with the deltas above.
2. Decide Cognito-vs-Keycloak (recommendation: Keycloak-only).
3. Build the Next.js auth flow using Auth.js + Keycloak provider.
4. Build the MCP client wrapper (`lib/mcp/client.ts`) using the OAuth code
   we already wrote, adapted to read tokens from Auth.js sessions.
5. Implement the quota-aware sync runner with the cadence above.
