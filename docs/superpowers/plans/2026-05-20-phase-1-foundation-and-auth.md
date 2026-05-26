# Phase 1 — Foundation + Auth + First Connection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimum stack that lets a user (a) sign in to the app via Cumbuca Keycloak, (b) automatically create a `bank_connection` record using the consent already granted at login, (c) land on a stub dashboard with a "Sincronizar agora" button that proves end-to-end authentication and database wiring (sync itself lands in Phase 2).

**Architecture:** Next.js App Router with Auth.js v5 + Keycloak provider (`@auth/mongodb-adapter` for persistence). One MongoDB Atlas database. No public signup — the only login button federates to `https://idc.cumbuca.com/realms/cumbuca-mcp`. On callback we create the user record (Auth.js does this), then a route hook calls `mcp:get_consent_status` once and seeds `bank_connections`. The dashboard reads from Mongo only.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, Tailwind v4, TypeScript 5, Bun, MongoDB driver 6, Auth.js (next-auth 5), `@modelcontextprotocol/sdk` (already installed), Zod 4.

**User preferences (memory):**
- No `git` commands at any point — neither commit nor add nor status. The user manages git state.
- Commit only happens via the user after the phase E2E goes green.

---

## Pre-flight — what already exists from Phase 0

These files exist and Phase 1 builds on them; do NOT recreate or rewrite them:

```
package.json                                  // deps: mcp-sdk, zod, ulid, vitest, tsx
vitest.config.ts
lib/mcp/tools.ts                              // Zod schemas of all 7 read tools
lib/mcp/types.ts                              // TS types from Zod
tests/mcp/fixtures/*.json                     // 7 sanitized fixtures
tests/mcp/tools.test.ts                       // 7 passing schema tests
scripts/mcp-discovery/lib/file-oauth-provider.ts
scripts/mcp-discovery/lib/callback-server.ts
scripts/mcp-discovery/lib/mcp-client.ts       // legacy discovery client — we will NOT use this in the app
scripts/mcp-discovery/auth-bootstrap.ts       // CLI for one-off OAuth — kept for Phase 2 fallback
scripts/mcp-discovery/probe-tools.ts          // CLI probe — kept for ops
docs/mcp-discovery.md                         // catalogue + spec deltas
docs/superpowers/specs/2026-05-20-dashboard-cumbuca-design.md  // updated Rev 2
```

The `scripts/mcp-discovery/lib/mcp-client.ts` helper is intentionally bypassed in Phase 1 — we will build the production wrapper at `lib/mcp/client.ts` in Phase 2. Phase 1 only needs the SDK to call `get_consent_status` once during onboarding, which we do inline in the auth callback.

---

## Files this phase will create or touch

```
Create:
  lib/mongo.ts                                  // MongoDB driver singleton
  lib/auth.ts                                   // Auth.js config + requireSession
  lib/crypto.ts                                 // encrypt/decrypt/hash primitives
  lib/repositories/connections.ts               // bank_connections CRUD
  lib/format/money.ts                           // MCP string → cents, cents → "R$ X,XX"
  app/layout.tsx                                // (already exists; will modify)
  app/(auth)/login/page.tsx                     // login screen
  app/(app)/layout.tsx                          // session gate + connection check
  app/(app)/page.tsx                            // / dashboard stub (replaces default)
  app/api/auth/[...nextauth]/route.ts           // Auth.js handler
  app/api/sync/route.ts                         // stub: 200 + { ok: true, todo: "phase-2" }
  middleware.ts                                 // dev-route gate + security headers
  components/ui/Button.tsx                      // primitive
  components/sync/SyncNowButton.tsx             // client component → POST /api/sync
  components/auth/SignInWithCumbuca.tsx         // client → next-auth signIn
  scripts/keycloak-register.ts                  // one-time DCR registration CLI
  .env.example                                  // documents required env vars
  tests/lib/format/money.test.ts                // unit tests for money parsing
  tests/lib/crypto.test.ts                      // unit tests for crypto round-trip
  tests/lib/repositories/connections.test.ts    // integration with mongodb-memory-server

Modify:
  app/layout.tsx                                // wrap with SessionProvider
  app/globals.css                               // minor — ensure tokens for the auth page
  app/page.tsx                                  // remove default Next.js content (replaced by (app)/page.tsx via route group)
  package.json                                  // add next-auth, @auth/mongodb-adapter, mongodb, mongodb-memory-server (dev)
  .gitignore                                    // add .env.local explicitly (already covered, verify)
```

---

## Task 1 — Add dependencies

**Files:**
- Modify: `package.json`, `bun.lock`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
bun add next-auth@beta @auth/mongodb-adapter mongodb
```

(`next-auth@beta` is the v5 line; v5 stable as of this writing is published on the `beta` tag.)

Expected: `package.json` shows the three new entries. No install errors.

- [ ] **Step 2: Install dev deps for integration tests**

```bash
bun add -d mongodb-memory-server
```

Expected: `mongodb-memory-server` appears in `devDependencies`.

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors (only types installed; no code yet uses them).

---

## Task 2 — `.env.example` and env loading

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Write `.env.example` verbatim**

```dotenv
# Auth.js
AUTH_SECRET=                              # openssl rand -base64 32

# Cumbuca Keycloak
KEYCLOAK_ISSUER=https://idc.cumbuca.com/realms/cumbuca-mcp
KEYCLOAK_CLIENT_ID=                       # filled by scripts/keycloak-register.ts
KEYCLOAK_CLIENT_SECRET=                   # filled by scripts/keycloak-register.ts

# MongoDB
MONGODB_URI=mongodb://localhost:27017/cumbuca-dashboard

# Encryption
PII_KEY=                                  # openssl rand -base64 32
OPENFINANCE_TOKEN_KEY=                    # openssl rand -base64 32
CPF_HASH_PEPPER=                          # openssl rand -hex 32
COUNTERPARTY_HASH_PEPPER=                 # openssl rand -hex 32

# MCP
CUMBUCA_MCP_URL=https://mcp.cumbuca.com/mcp

# Anthropic (for Phase 2 categorizer; not used in Phase 1)
ANTHROPIC_API_KEY=

# Cron (Phase 2)
CRON_SECRET=

# Dev
ALLOW_DEV_DASHBOARD=false                 # set "true" to enable /dev/logs in non-dev envs
```

- [ ] **Step 2: Confirm `.env.local` is gitignored**

The current `.gitignore` contains `.env*` — confirm by reading; no change needed.

---

## Task 3 — Mongo client singleton

**Files:**
- Create: `lib/mongo.ts`

- [ ] **Step 1: Write the singleton**

```ts
import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI env var is required");
}

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

const clientPromise: Promise<MongoClient> =
  globalThis.__mongoClientPromise ??
  (globalThis.__mongoClientPromise = new MongoClient(uri).connect());

export async function getMongo(): Promise<MongoClient> {
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db();
}
```

The global-singleton dance avoids opening a new pool on every hot reload in dev. In production it acts as a normal module-level singleton.

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
```

Expected: clean.

---

## Task 4 — Crypto primitives (TDD)

**Files:**
- Create: `lib/crypto.ts`
- Create: `tests/lib/crypto.test.ts`

- [ ] **Step 1: Write the failing test first**

```ts
// tests/lib/crypto.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, hashWithPepper } from "@/lib/crypto";

beforeAll(() => {
  // base64 of 32 zero bytes
  process.env.OPENFINANCE_TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.PII_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
  process.env.CPF_HASH_PEPPER = "test-pepper-1234567890abcdef";
});

describe("crypto", () => {
  it("encrypts and decrypts a token round-trip", () => {
    const plain = "an-access-token-xyz";
    const sealed = encrypt(plain, "OPENFINANCE_TOKEN_KEY");
    expect(sealed).not.toBe(plain);
    expect(decrypt(sealed, "OPENFINANCE_TOKEN_KEY")).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plain = "secret";
    const a = encrypt(plain, "PII_KEY");
    const b = encrypt(plain, "PII_KEY");
    expect(a).not.toBe(b);
    expect(decrypt(a, "PII_KEY")).toBe(plain);
    expect(decrypt(b, "PII_KEY")).toBe(plain);
  });

  it("rejects tampered ciphertext", () => {
    const sealed = encrypt("data", "PII_KEY");
    const tampered = sealed.slice(0, -2) + "AA";
    expect(() => decrypt(tampered, "PII_KEY")).toThrow();
  });

  it("hashWithPepper is deterministic and unique per pepper", () => {
    const a = hashWithPepper("12345678901", "CPF_HASH_PEPPER");
    const b = hashWithPepper("12345678901", "CPF_HASH_PEPPER");
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // hex-encoded SHA-256
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
bun run test --run tests/lib/crypto.test.ts
```

Expected: fails with `Cannot find module '@/lib/crypto'`.

- [ ] **Step 3: Implement `lib/crypto.ts`**

```ts
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

type KeyName = "OPENFINANCE_TOKEN_KEY" | "PII_KEY";

function loadKey(name: KeyName): Buffer {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} env var is required`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must decode to 32 bytes`);
  }
  return key;
}

/**
 * Encrypts a string. Output format (base64-encoded): IV || TAG || CIPHERTEXT.
 */
export function encrypt(plaintext: string, keyName: KeyName): string {
  const key = loadKey(keyName);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(sealedB64: string, keyName: KeyName): string {
  const key = loadKey(keyName);
  const buf = Buffer.from(sealedB64, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

type PepperName = "CPF_HASH_PEPPER" | "COUNTERPARTY_HASH_PEPPER";

export function hashWithPepper(value: string, pepperName: PepperName): string {
  const pepper = process.env[pepperName];
  if (!pepper) {
    throw new Error(`${pepperName} env var is required`);
  }
  return createHash("sha256").update(value).update(pepper).digest("hex");
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun run test --run tests/lib/crypto.test.ts
```

Expected: 4 passed.

---

## Task 5 — Money parsing (TDD)

**Files:**
- Create: `lib/format/money.ts`
- Create: `tests/lib/format/money.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/lib/format/money.test.ts
import { describe, it, expect } from "vitest";
import { parseMcpAmountToCents, centsToBrl } from "@/lib/format/money";

describe("parseMcpAmountToCents", () => {
  it("parses 2-decimal strings (account balance shape)", () => {
    expect(parseMcpAmountToCents("100.00")).toBe(10000);
    expect(parseMcpAmountToCents("1.00")).toBe(100);
    expect(parseMcpAmountToCents("0.00")).toBe(0);
  });

  it("parses 4-decimal strings (credit card bill shape) with rounding", () => {
    expect(parseMcpAmountToCents("100.0000")).toBe(10000);
    expect(parseMcpAmountToCents("1007.1500")).toBe(100715);
    expect(parseMcpAmountToCents("9944.1099")).toBe(994411);  // rounds half-up
  });

  it("rejects negatives (MCP always positive; sign is in creditDebitType)", () => {
    expect(() => parseMcpAmountToCents("-1.00")).toThrow();
  });

  it("rejects non-numeric strings", () => {
    expect(() => parseMcpAmountToCents("BRL 100")).toThrow();
    expect(() => parseMcpAmountToCents("")).toThrow();
  });
});

describe("centsToBrl", () => {
  it("formats positive cents as BRL", () => {
    expect(centsToBrl(123456)).toBe("R$ 1.234,56");
    expect(centsToBrl(0)).toBe("R$ 0,00");
    expect(centsToBrl(100)).toBe("R$ 1,00");
  });

  it("formats negative cents", () => {
    expect(centsToBrl(-123456)).toBe("-R$ 1.234,56");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/format/money.ts

/**
 * Convert an MCP decimal string ("100.00", "1007.1500") to integer cents.
 * Throws on negative or non-numeric inputs.
 */
export function parseMcpAmountToCents(amount: string): number {
  if (typeof amount !== "string" || amount.length === 0) {
    throw new TypeError(`Invalid money string: ${JSON.stringify(amount)}`);
  }
  if (!/^\d+\.\d{2,4}$/.test(amount)) {
    throw new TypeError(`Invalid money string: ${amount}`);
  }
  const [intPart, fracPart] = amount.split(".");
  // pad/truncate fractional to 2 places with half-up rounding
  let cents: number;
  if (fracPart.length === 2) {
    cents = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
  } else if (fracPart.length === 4) {
    const fracInt = parseInt(fracPart, 10);
    // round half-up at 2 decimal places (e.g. 1099 → 11, 1150 → 12)
    const rounded = Math.round(fracInt / 100);
    cents = parseInt(intPart, 10) * 100 + rounded;
  } else if (fracPart.length === 3) {
    const fracInt = parseInt(fracPart, 10);
    const rounded = Math.round(fracInt / 10);
    cents = parseInt(intPart, 10) * 100 + rounded;
  } else {
    throw new TypeError(`Unexpected fractional length in ${amount}`);
  }
  return cents;
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function centsToBrl(cents: number): string {
  return BRL_FORMATTER.format(cents / 100);
}
```

- [ ] **Step 3: Run tests**

```bash
bun run test --run tests/lib/format/money.test.ts
```

Expected: 6 passed.

⚠️ **Edge case to verify in test output:** Brazilian `Intl.NumberFormat` uses non-breaking space (`\xa0`) between `R$` and the number on some Node versions. If tests fail on the exact string match, log the actual output and update the test expectation to match what `Intl` produces in the Bun runtime. Do NOT fudge the implementation — the format is correct; the test string is the candidate for fixing.

---

## Task 6 — Bank connections repository (TDD with mongodb-memory-server)

**Files:**
- Create: `lib/repositories/connections.ts`
- Create: `tests/lib/repositories/connections.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/lib/repositories/connections.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  upsertBankConnection,
  findActiveConnectionsByUser,
  type UpsertConnectionInput,
} from "@/lib/repositories/connections";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.OPENFINANCE_TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("bank_connections").deleteMany({});
});

describe("upsertBankConnection", () => {
  it("creates a new connection on first call", async () => {
    const input: UpsertConnectionInput = {
      userId: "user-1",
      institutionId: "itau",
      institutionDisplayName: "Itaú",
      status: "active",
      consentExpiresAt: null,
      accessToken: "tok-A",
      refreshToken: "ref-A",
      tokenExpiresAt: new Date("2026-12-31T00:00:00Z"),
    };
    const id = await upsertBankConnection(db, input);
    expect(id).toBeDefined();

    const stored = await db.collection("bank_connections").findOne({ _id: id });
    expect(stored?.userId).toBe("user-1");
    expect(stored?.institutionId).toBe("itau");
    expect(stored?.status).toBe("active");
    expect(stored?.encryptedAccessToken).toBeDefined();
    expect(stored?.encryptedAccessToken).not.toBe("tok-A");
  });

  it("updates existing connection for same user+institution", async () => {
    const base: UpsertConnectionInput = {
      userId: "user-1",
      institutionId: "itau",
      institutionDisplayName: "Itaú",
      status: "active",
      consentExpiresAt: null,
      accessToken: "tok-A",
      refreshToken: "ref-A",
      tokenExpiresAt: new Date("2026-12-31T00:00:00Z"),
    };
    const id1 = await upsertBankConnection(db, base);
    const id2 = await upsertBankConnection(db, { ...base, accessToken: "tok-B" });
    expect(id1.toHexString()).toBe(id2.toHexString());

    const count = await db.collection("bank_connections").countDocuments({});
    expect(count).toBe(1);
  });

  it("findActiveConnectionsByUser returns only active rows", async () => {
    const base: UpsertConnectionInput = {
      userId: "user-1",
      institutionId: "itau",
      institutionDisplayName: "Itaú",
      status: "active",
      consentExpiresAt: null,
      accessToken: "tok",
      refreshToken: "ref",
      tokenExpiresAt: new Date(),
    };
    await upsertBankConnection(db, base);
    await upsertBankConnection(db, {
      ...base,
      institutionId: "nubank",
      institutionDisplayName: "Nubank",
      status: "expired",
    });
    const active = await findActiveConnectionsByUser(db, "user-1");
    expect(active).toHaveLength(1);
    expect(active[0].institutionId).toBe("itau");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/repositories/connections.ts
import { type Db, type ObjectId } from "mongodb";
import { encrypt } from "@/lib/crypto";

export interface UpsertConnectionInput {
  userId: string;
  institutionId: string;
  institutionDisplayName: string;
  status: "active" | "expired" | "revoked" | "error";
  consentExpiresAt: Date | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date;
}

export interface BankConnectionDoc {
  _id: ObjectId;
  userId: string;
  institutionId: string;
  institutionDisplayName: string;
  status: "active" | "expired" | "revoked" | "error";
  consentExpiresAt: Date | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  quotaUsage: Record<string, number | string>;
  createdAt: Date;
  updatedAt: Date;
}

const COLLECTION = "bank_connections";

export async function upsertBankConnection(
  db: Db,
  input: UpsertConnectionInput
): Promise<ObjectId> {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const setOnInsert: Partial<BankConnectionDoc> = {
    userId: input.userId,
    institutionId: input.institutionId,
    lastSyncAt: null,
    lastSyncStatus: null,
    quotaUsage: { month: monthKey },
    createdAt: now,
  };

  const set: Partial<BankConnectionDoc> = {
    institutionDisplayName: input.institutionDisplayName,
    status: input.status,
    consentExpiresAt: input.consentExpiresAt,
    encryptedAccessToken: encrypt(input.accessToken, "OPENFINANCE_TOKEN_KEY"),
    encryptedRefreshToken: input.refreshToken
      ? encrypt(input.refreshToken, "OPENFINANCE_TOKEN_KEY")
      : null,
    tokenExpiresAt: input.tokenExpiresAt,
    updatedAt: now,
  };

  const result = await db.collection<BankConnectionDoc>(COLLECTION).findOneAndUpdate(
    { userId: input.userId, institutionId: input.institutionId },
    { $set: set, $setOnInsert: setOnInsert },
    { upsert: true, returnDocument: "after" }
  );

  if (!result) {
    throw new Error("Upsert returned no document");
  }
  return result._id;
}

export async function findActiveConnectionsByUser(
  db: Db,
  userId: string
): Promise<BankConnectionDoc[]> {
  return db
    .collection<BankConnectionDoc>(COLLECTION)
    .find({ userId, status: "active" })
    .toArray();
}
```

- [ ] **Step 3: Run tests**

```bash
bun run test --run tests/lib/repositories/connections.test.ts
```

Expected: 3 passed.

⚠️ `mongodb-memory-server` downloads a Mongo binary on first run (~50MB). The first run may take 60+ seconds. Subsequent runs are fast.

---

## Task 7 — Keycloak DCR script

**Files:**
- Create: `scripts/keycloak-register.ts`

- [ ] **Step 1: Write the script**

```ts
/**
 * One-time Dynamic Client Registration against Cumbuca Keycloak.
 * Run: bun run keycloak:register
 *
 * Prints client_id and client_secret. Paste them into .env.local manually.
 */
const ISSUER = process.env.KEYCLOAK_ISSUER ?? "https://idc.cumbuca.com/realms/cumbuca-mcp";
const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

async function main() {
  const registrationUrl = `${ISSUER}/clients-registrations/openid-connect`;

  const body = {
    client_name: "Cumbuca Dashboard (local dev)",
    redirect_uris: [
      `${APP_BASE}/api/auth/callback/keycloak`,
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile offline_access open-finance",
    token_endpoint_auth_method: "client_secret_basic",
  };

  console.log("→ POST", registrationUrl);
  const res = await fetch(registrationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("DCR failed:", res.status, await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as {
    client_id: string;
    client_secret?: string;
  };

  console.log("\n✓ Registered. Paste these into .env.local:\n");
  console.log(`KEYCLOAK_CLIENT_ID=${data.client_id}`);
  if (data.client_secret) {
    console.log(`KEYCLOAK_CLIENT_SECRET=${data.client_secret}`);
  } else {
    console.log("(No client_secret returned — client is public; will need PKCE-only flow.)");
  }
}

main().catch((err) => {
  console.error("Registration failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add script entry**

In `package.json` scripts:
```jsonc
"keycloak:register": "tsx scripts/keycloak-register.ts"
```

- [ ] **Step 3: Verify it compiles**

```bash
bunx tsc --noEmit
```

Expected: clean. **Do not run** the script during automated execution — that's a manual step performed by the user once.

---

## Task 8 — Auth.js config

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Write Auth.js config**

```ts
// lib/auth.ts
import NextAuth, { type DefaultSession } from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { getMongo } from "@/lib/mongo";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
};

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: number;
    user: DefaultSession["user"] & { id: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: number;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(getMongo()),
  providers: [
    Keycloak({
      issuer: requireEnv("KEYCLOAK_ISSUER"),
      clientId: requireEnv("KEYCLOAK_CLIENT_ID"),
      clientSecret: requireEnv("KEYCLOAK_CLIENT_SECRET"),
      authorization: {
        params: { scope: "openid profile offline_access open-finance" },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.tokenExpiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.tokenExpiresAt = token.tokenExpiresAt;
      return session;
    },
  },
});

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session;
}
```

- [ ] **Step 2: Wire route handler**

```ts
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "@/lib/auth";
```

Wait — Auth.js v5 exposes handlers as `handlers.GET` and `handlers.POST`. Verify by reading the installed `next-auth` package's exported types before finalizing the route file.

If the actual shape is `handlers: { GET, POST }`, the route file becomes:
```ts
export const { GET, POST } = (await import("@/lib/auth")).handlers;
```

This is awkward in a route file. The cleaner pattern Auth.js v5 documents is:
```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

Use this pattern.

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
```

Expected: clean. If there's an error about the `accessToken` augmentation, the module declaration may need to live in a separate `.d.ts` file. Adjust and re-run.

---

## Task 9 — `app/layout.tsx` adjustments

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Read current contents**

The current root layout loads Geist fonts and basic HTML structure. Auth.js v5 with JWT strategy does **not** require a SessionProvider in the tree — `auth()` is called server-side. So the layout can stay essentially as-is.

However, do add a `lang="pt-BR"` to the root `<html>` element if it's not already there (per spec — PT-BR only).

- [ ] **Step 2: Apply the minimal modification**

If `<html>` currently has no `lang` attribute, change it to `<html lang="pt-BR">`. If it already has a different lang, change it to `"pt-BR"`. If it already says `"pt-BR"`, skip.

- [ ] **Step 3: Verify**

```bash
bun run build
```

Expected: build succeeds.

---

## Task 10 — Login page and SignIn button

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `components/auth/SignInWithCumbuca.tsx`
- Create: `components/ui/Button.tsx`

- [ ] **Step 1: Button primitive**

```tsx
// components/ui/Button.tsx
import { forwardRef } from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", ...rest }, ref) => {
    const base =
      "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50";
    const styles =
      variant === "primary"
        ? "bg-foreground text-background hover:opacity-90"
        : "border border-foreground/20 bg-transparent hover:bg-foreground/5";
    return <button ref={ref} className={`${base} ${styles} ${className}`} {...rest} />;
  }
);
Button.displayName = "Button";
```

- [ ] **Step 2: Client SignIn component**

```tsx
// components/auth/SignInWithCumbuca.tsx
"use client";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function SignInWithCumbuca() {
  return (
    <Button onClick={() => signIn("keycloak", { redirectTo: "/" })}>
      Entrar com Cumbuca
    </Button>
  );
}
```

- [ ] **Step 3: Login page**

```tsx
// app/(auth)/login/page.tsx
import { SignInWithCumbuca } from "@/components/auth/SignInWithCumbuca";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Cumbuca Dashboard</h1>
        <p className="text-sm opacity-70">
          Entre com sua conta Cumbuca para autorizar o acesso aos seus dados
          do Open Finance.
        </p>
        <SignInWithCumbuca />
        <p className="text-xs opacity-50">
          Ao entrar, você autoriza este app a ler seus dados financeiros via
          Cumbuca (Open Finance). Você pode revogar a qualquer momento.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Build**

```bash
bun run build
```

Expected: build succeeds.

---

## Task 11 — `(app)/layout.tsx` + dashboard stub + ensure-connection helper

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/page.tsx`
- Modify: `app/page.tsx` (delete or trim — replaced by `(app)/page.tsx`)
- Create: `lib/sync/ensure-connection.ts` (helper called by layout)

- [ ] **Step 1: Delete the default `app/page.tsx`**

The default Next.js CRA-style page must go. Read it first to confirm it's the default boilerplate, then replace its contents with:

```tsx
// app/page.tsx (kept as a passthrough so the route group composes; delete if route group resolves correctly without it)
import { redirect } from "next/navigation";
export default function RootPage() {
  redirect("/");
}
```

Actually, route groups in App Router (`(app)`) don't create URL segments, so `app/(app)/page.tsx` IS the route for `/`. Having both `app/page.tsx` and `app/(app)/page.tsx` will conflict.

The right answer: **delete `app/page.tsx`** (or rather, replace its export with an empty re-export from the new location). Since deletion is simpler, do that — but verify with `bun run build` immediately afterwards to make sure routing still resolves `/`.

- [ ] **Step 2: Create `ensure-connection.ts` helper**

```ts
// lib/sync/ensure-connection.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDb } from "@/lib/mongo";
import { upsertBankConnection, findActiveConnectionsByUser } from "@/lib/repositories/connections";
import { ConsentStatusResponse } from "@/lib/mcp/tools";

const MCP_URL = process.env.CUMBUCA_MCP_URL ?? "https://mcp.cumbuca.com/mcp";

/**
 * Called once per user, on first authenticated page load. Reads the
 * user's consent status from the MCP using their session access token,
 * and upserts the bank_connection record. Idempotent — safe to call
 * on every page load (it short-circuits if a connection already exists
 * and the token hasn't expired).
 *
 * Returns the number of active connections after the call.
 */
export async function ensureBankConnection(opts: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date;
}): Promise<{ active: number; created: boolean }> {
  const db = await getDb();

  const existing = await findActiveConnectionsByUser(db, opts.userId);
  if (existing.length > 0) {
    return { active: existing.length, created: false };
  }

  // No active connection — query consent status via MCP.
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  });
  const client = new Client(
    { name: "cumbuca-dashboard", version: "0.1.0" },
    { capabilities: {} }
  );
  try {
    await client.connect(transport);
    const raw = await client.callTool({
      name: "mcp__cumbuca__get_consent_status",
      arguments: {},
    });
    // Tool results from the SDK come wrapped — extract the content.
    const text = (raw.content as Array<{ type: string; text?: string }>)?.find(
      (c) => c.type === "text"
    )?.text;
    if (!text) throw new Error("get_consent_status returned no text content");

    const parsed = ConsentStatusResponse.parse(JSON.parse(text));

    await upsertBankConnection(db, {
      userId: opts.userId,
      institutionId: parsed.institution_name,
      institutionDisplayName: parsed.institution_name.toUpperCase(),
      status: parsed.status === "active" ? "active" : (parsed.status as "active" | "expired" | "revoked" | "error"),
      consentExpiresAt: parsed.expires_at ? new Date(parsed.expires_at) : null,
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken,
      tokenExpiresAt: opts.tokenExpiresAt,
    });
    return { active: 1, created: true };
  } finally {
    try {
      await client.close();
    } catch {
      /* swallow */
    }
  }
}
```

⚠️ **Two things to verify against the installed MCP SDK when implementing:**
1. The exact tool name. In this codebase we previously called these via `mcp__cumbuca__get_consent_status` (the Claude Code prefix). When calling the raw MCP via `Client.callTool({ name })`, the name is just `get_consent_status` (no prefix). Use the unprefixed name. If the call returns "tool not found", the prefix may actually be needed — try both during the first integration test.
2. The shape of `client.callTool()` return. In SDK 1.29 it returns `{ content: [{ type, text }, ...] }` for tool responses. We parse `JSON.parse(text)`. If the shape differs (e.g. structured result without text), adapt.

- [ ] **Step 3: Build `(app)/layout.tsx`**

```tsx
// app/(app)/layout.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensureBankConnection } from "@/lib/sync/ensure-connection";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  if (session.accessToken && session.tokenExpiresAt) {
    await ensureBankConnection({
      userId: session.user.id,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
      tokenExpiresAt: new Date(session.tokenExpiresAt * 1000),
    });
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Dashboard stub**

```tsx
// app/(app)/page.tsx
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/mongo";
import { findActiveConnectionsByUser } from "@/lib/repositories/connections";
import { SyncNowButton } from "@/components/sync/SyncNowButton";

export default async function DashboardPage() {
  const session = await auth();
  const db = await getDb();
  const connections = await findActiveConnectionsByUser(db, session!.user.id);

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cumbuca Dashboard</h1>
        <SyncNowButton />
      </header>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Conexões ativas</h2>
        {connections.length === 0 ? (
          <p className="opacity-70 text-sm">Nenhuma conexão ativa ainda.</p>
        ) : (
          <ul className="space-y-2">
            {connections.map((c) => (
              <li key={c._id.toHexString()} className="rounded-md border border-foreground/10 p-3">
                <p className="font-medium">{c.institutionDisplayName}</p>
                <p className="text-xs opacity-70">
                  Status: {c.status} · Última sync: {c.lastSyncAt?.toISOString() ?? "nunca"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs opacity-50">
        (Phase 1) Sincronização real chega na Phase 2. O botão acima dispara
        um endpoint stub.
      </p>
    </main>
  );
}
```

- [ ] **Step 5: SyncNow client component**

```tsx
// components/sync/SyncNowButton.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function SyncNowButton() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {last && <span className="text-xs opacity-70">{last}</span>}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch("/api/sync", { method: "POST" });
            const data = await r.json();
            setLast(JSON.stringify(data));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sincronizando…" : "Sincronizar agora"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Build**

```bash
bun run build
```

Expected: build succeeds. Type errors must be fixed before moving on.

---

## Task 12 — `/api/sync` stub

**Files:**
- Create: `app/api/sync/route.ts`

- [ ] **Step 1: Write the stub**

```ts
// app/api/sync/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    todo: "phase-2: real sync runner lands here",
    userId: session.user.id,
  });
}
```

- [ ] **Step 2: Build**

```bash
bun run build
```

Expected: clean.

---

## Task 13 — Security middleware

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Write**

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

const DEV_ALLOWED =
  process.env.NODE_ENV === "development" ||
  process.env.ALLOW_DEV_DASHBOARD === "true";

export function middleware(req: NextRequest) {
  // Block /dev/* unless dev or explicit env opt-in
  if (req.nextUrl.pathname.startsWith("/dev") && !DEV_ALLOWED) {
    return new NextResponse(null, { status: 404 });
  }

  const res = NextResponse.next();
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; connect-src 'self' https://mcp.cumbuca.com https://idc.cumbuca.com https://api.anthropic.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://fonts.gstatic.com;"
  );
  return res;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
```

⚠️ **Verify before finalizing:** the CSP `script-src 'self' 'unsafe-inline'` is permissive because Next.js's hydration scripts use inline. Tightening to nonces is post-MVP work. Note as a v2 hardening.

- [ ] **Step 2: Build**

```bash
bun run build
```

Expected: clean.

---

## Task 14 — End-to-end smoke test (manual + automated)

This is the gate before Phase 1 is "done."

- [ ] **Step 1: Unit tests pass**

```bash
bun run test --run
```

Expected: all (crypto, money, connections, mcp-tools) green.

- [ ] **Step 2: Typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: clean.

- [ ] **Step 3: Manual smoke (USER-IN-LOOP)**

The remaining steps require a real Keycloak client and a real Cumbuca login. They cannot be automated by a subagent.

Sub-steps the user must perform:

1. Generate dev secrets:
   ```bash
   openssl rand -base64 32   # AUTH_SECRET
   openssl rand -base64 32   # OPENFINANCE_TOKEN_KEY
   openssl rand -base64 32   # PII_KEY
   openssl rand -hex 32      # CPF_HASH_PEPPER
   openssl rand -hex 32      # COUNTERPARTY_HASH_PEPPER
   ```
   Copy into `.env.local`.

2. Ensure local Mongo is running (Docker or local install) and `MONGODB_URI` in `.env.local` points to it.

3. Register the Auth.js Keycloak client (one time):
   ```bash
   bun run keycloak:register
   ```
   Paste the printed `KEYCLOAK_CLIENT_ID` and `KEYCLOAK_CLIENT_SECRET` into `.env.local`.

4. Start the dev server:
   ```bash
   bun run dev
   ```

5. Open http://localhost:3000 in a browser. Expect a redirect to `/login` since there's no session.

6. Click "Entrar com Cumbuca". Expect a redirect to `idc.cumbuca.com` for login. Authenticate.

7. Expect a redirect back to `/`. Expect the page to show:
   - "Conexões ativas" header
   - One card with the institution name (likely "ITAU")
   - "Sincronizar agora" button

8. Click "Sincronizar agora". Expect a toast/text response with `{ ok: true, todo: "phase-2: ..." }`.

9. Verify in Mongo:
   ```bash
   # mongosh:
   use cumbuca-dashboard
   db.users.find()                       // should have 1 user
   db.accounts.find()                    // should have 1 account row (Auth.js OAuth)
   db.sessions.find()                    // depends on adapter
   db.bank_connections.find()            // should have 1 row, status=active
   ```

10. Sign out (no UI for this in Phase 1; clear cookies manually or delete the session row).

11. Sign back in. Expect the existing `bank_connection` to NOT be duplicated.

- [ ] **Step 4: Report results**

When this gate passes, Phase 1 is considered E2E green. The user (not a subagent) commits at this point.

---

## What this phase produces (handoff to Phase 2)

| Artifact | Used by |
|---|---|
| `lib/mongo.ts`, `lib/auth.ts` | Everything downstream |
| `lib/crypto.ts` | Token + PII storage in Phase 2+ |
| `lib/format/money.ts` | Sync upserts, UI rendering |
| `lib/repositories/connections.ts` | Sync worker reads/updates these |
| `lib/sync/ensure-connection.ts` | Pattern reused for richer Phase 2 sync runner |
| `/api/sync` stub | Replaced by real implementation in Phase 2 |
| `(app)/layout.tsx` session gate | Inherited by every authed page |

**Open items for Phase 2 plan:**
1. The `Client.callTool({ name })` real tool name prefix — verify and document.
2. Quota tracking: implement `bank_connections.quotaUsage` updates from sync runs.
3. Build `lib/mcp/client.ts` (the production wrapper from spec Section 4).
4. Build the actual sync runner replacing the `/api/sync` stub.
5. Build MCC categorizer + Anthropic categorizer.

**User preference reminder for whoever executes this:** do not run any `git` command. Stage / commit is the user's job.
