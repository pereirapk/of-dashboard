# Phase 0 — MCP Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect to the Cumbuca MCP from this repo, complete the Open Finance auth flow once with real credentials, enumerate every exposed tool, capture realistic responses, and produce typed Zod schemas + a written report that subsequent phases consume.

**Architecture:** A standalone TypeScript script under `scripts/mcp-discovery/` uses `@modelcontextprotocol/sdk` over Streamable HTTP transport. Auth follows whatever pattern the MCP advertises — we observe and document it. Outputs land in `lib/mcp/tools.ts` (Zod schemas), `tests/mcp/tools.test.ts` (schema validation against captured fixtures), and `docs/mcp-discovery.md` (human-readable catalog + auth flow). Vitest is added now because every later phase needs it.

**Tech Stack:** Next.js 16.2.6 (already installed), TypeScript 5, Bun, `@modelcontextprotocol/sdk`, Zod, Vitest, `tsx` for running scripts.

**User preference reminder:** No git commits until the end-to-end script run succeeds. Stage as you go, commit only at Task 13.

---

## Files this phase will create or touch

```
Create:
  scripts/mcp-discovery/probe-tools.ts         // step 1: connect + listTools
  scripts/mcp-discovery/auth-flow.ts           // step 2: walk through OF auth
  scripts/mcp-discovery/probe-data.ts          // step 3: call data tools post-auth
  scripts/mcp-discovery/lib/mcp-client.ts      // thin MCP client wrapper used by all probes
  scripts/mcp-discovery/lib/capture.ts         // helper to persist raw responses
  scripts/mcp-discovery/captures/.gitkeep      // captures live here; raw files gitignored
  lib/mcp/tools.ts                             // Zod schemas of observed tool I/O
  lib/mcp/types.ts                             // TypeScript types inferred from Zod
  tests/mcp/tools.test.ts                      // schemas parse sanitized fixtures
  tests/mcp/fixtures/                          // sanitized captures (committed)
  vitest.config.ts                             // Vitest config
  docs/mcp-discovery.md                        // final report

Modify:
  package.json                                 // add deps and scripts
  .gitignore                                   // ignore raw captures
  tsconfig.json                                // include scripts/ and tests/
```

---

## Task 1: Add dependencies and read MCP SDK docs

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
bun add @modelcontextprotocol/sdk zod ulid
bun add -d vitest @vitest/coverage-v8 tsx
```

Expected: `package.json` shows new deps; `bun.lock` updated; no install errors.

- [ ] **Step 2: Add `scripts` entries to `package.json`**

Open `package.json` and add to `scripts`:
```jsonc
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest",
  "discover:list": "tsx scripts/mcp-discovery/probe-tools.ts",
  "discover:auth": "tsx scripts/mcp-discovery/auth-flow.ts",
  "discover:data": "tsx scripts/mcp-discovery/probe-data.ts"
}
```

- [ ] **Step 3: Read `@modelcontextprotocol/sdk` README for HTTP transport**

Run:
```bash
find node_modules/@modelcontextprotocol/sdk -maxdepth 3 -name 'README*' -o -name 'package.json' | head -5
cat node_modules/@modelcontextprotocol/sdk/package.json
```

Expected: identify the entrypoints for `Client` and the HTTP/Streamable HTTP transport class. Note: the public API in recent versions is `Client` from `@modelcontextprotocol/sdk/client/index.js` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`. Confirm the exact import paths match what's installed; record them for use in Task 3.

- [ ] **Step 4: Stage (no commit yet)**

```bash
git add package.json bun.lock
```

---

## Task 2: Configure Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Write Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Add tests dir to tsconfig include**

Open `tsconfig.json`. Add `"tests/**/*"` and `"scripts/**/*"` to the `include` array. If they're already covered by a broad `**/*.ts`, skip.

- [ ] **Step 3: Smoke test — empty Vitest run**

Create `tests/.smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:
```bash
bun run test --run
```

Expected: `1 passed`. Delete `tests/.smoke.test.ts` after passing.

```bash
rm tests/.smoke.test.ts
```

- [ ] **Step 4: Stage**

```bash
git add vitest.config.ts tsconfig.json
```

---

## Task 3: Write the MCP client helper used by every probe

**Files:**
- Create: `scripts/mcp-discovery/lib/mcp-client.ts`

- [ ] **Step 1: Write the helper**

Create `scripts/mcp-discovery/lib/mcp-client.ts`:
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.CUMBUCA_MCP_URL ?? "https://mcp.cumbuca.com/mcp";

export interface ConnectOptions {
  /** Headers to inject on every request (e.g. Authorization once obtained) */
  headers?: Record<string, string>;
}

export async function connectMcp(opts: ConnectOptions = {}): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: opts.headers ?? {},
    },
  });

  const client = new Client(
    { name: "cumbuca-dashboard-discovery", version: "0.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

export async function safeClose(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // ignore — transport may already be closed
  }
}
```

Note: if the actual SDK exports/paths differ from what Task 1 Step 3 recorded, update the imports here.

- [ ] **Step 2: Stage**

```bash
git add scripts/mcp-discovery/lib/mcp-client.ts
```

---

## Task 4: Write the capture helper

**Files:**
- Create: `scripts/mcp-discovery/lib/capture.ts`
- Create: `scripts/mcp-discovery/captures/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Write capture helper**

Create `scripts/mcp-discovery/lib/capture.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CAPTURES_DIR = resolve(process.cwd(), "scripts/mcp-discovery/captures");

export async function capture(
  name: string,
  payload: unknown
): Promise<string> {
  await mkdir(CAPTURES_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}__${name}.json`;
  const fullPath = resolve(CAPTURES_DIR, filename);
  await writeFile(fullPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`captured → ${fullPath}`);
  return fullPath;
}
```

- [ ] **Step 2: Add `.gitkeep`**

Create `scripts/mcp-discovery/captures/.gitkeep` (empty file). The directory must exist in git; the JSON files inside it do not get committed (next step).

- [ ] **Step 3: Update `.gitignore`**

Append to `.gitignore`:
```
# MCP discovery raw captures contain real PII; never commit
scripts/mcp-discovery/captures/*.json
!scripts/mcp-discovery/captures/.gitkeep
```

- [ ] **Step 4: Stage**

```bash
git add scripts/mcp-discovery/lib/capture.ts scripts/mcp-discovery/captures/.gitkeep .gitignore
```

---

## Task 5: Write the `listTools` probe

**Files:**
- Create: `scripts/mcp-discovery/probe-tools.ts`

- [ ] **Step 1: Write the probe**

Create `scripts/mcp-discovery/probe-tools.ts`:
```ts
import { connectMcp, safeClose } from "./lib/mcp-client.js";
import { capture } from "./lib/capture.js";

async function main() {
  console.log("Connecting to MCP…");
  const client = await connectMcp();

  try {
    console.log("Listing tools…");
    const tools = await client.listTools();
    await capture("listTools", tools);

    console.log(`\nFound ${tools.tools.length} tool(s):\n`);
    for (const t of tools.tools) {
      console.log(`• ${t.name}`);
      console.log(`  ${t.description ?? "(no description)"}`);
      console.log(
        `  inputSchema keys: ${Object.keys(t.inputSchema?.properties ?? {}).join(", ") || "(none)"}`
      );
      console.log("");
    }
  } finally {
    await safeClose(client);
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the probe**

```bash
bun run discover:list
```

Expected: connects, prints a list of tool names + descriptions, writes a JSON file under `scripts/mcp-discovery/captures/`. If the MCP responds with an auth-required error before listing, **note the exact error shape in `docs/mcp-discovery.md`** (created in Task 11) — `listTools()` itself usually does not require auth, but Cumbuca may behave differently.

- [ ] **Step 3: Sanity-check the capture**

```bash
ls scripts/mcp-discovery/captures/
```

Expected: a file like `2026-05-20T13-22-04-123Z__listTools.json`. Open it; verify it contains a `tools` array.

- [ ] **Step 4: Stage**

```bash
git add scripts/mcp-discovery/probe-tools.ts
```

---

## Task 6: Document what `listTools` returned

**Files:**
- Create: `docs/mcp-discovery.md` (initial scaffold)

- [ ] **Step 1: Scaffold the report**

Create `docs/mcp-discovery.md`:
```markdown
# Cumbuca MCP — Discovery Report

**Run date:** <fill from probe>
**MCP URL:** https://mcp.cumbuca.com/mcp
**SDK version:** @modelcontextprotocol/sdk@<version from package.json>

## Tool catalog

<For each tool returned by listTools, fill a row below.
 Use the capture under scripts/mcp-discovery/captures/*__listTools.json as source.>

| Name | Description | Input keys | Auth required? |
|------|-------------|------------|----------------|
| TBD  | TBD         | TBD        | TBD            |

## Auth flow

(To fill after Task 7.)

## Per-tool details

(To fill after Task 9.)

## Spec deltas

Changes required in `docs/superpowers/specs/2026-05-20-dashboard-cumbuca-design.md`
based on what was actually observed.

(To fill after Task 11.)
```

- [ ] **Step 2: Populate the tool catalog table**

Open the JSON capture from Task 5. For every tool, add a row to the catalog table with name, description, and input keys.

For "Auth required?", make a best guess for now (e.g. tools named `list_institutions`, `start_consent` likely don't; `list_accounts`, `list_transactions` likely do). Validate in Task 7+.

- [ ] **Step 3: Stage**

```bash
git add docs/mcp-discovery.md
```

---

## Task 7: Walk the Open Finance auth flow once

This task is part-script, part-manual. The goal is to **observe** what the MCP requires, not to lock in a final design.

**Files:**
- Create: `scripts/mcp-discovery/auth-flow.ts`

- [ ] **Step 1: Write the auth-flow probe**

Create `scripts/mcp-discovery/auth-flow.ts`:
```ts
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { connectMcp, safeClose } from "./lib/mcp-client.js";
import { capture } from "./lib/capture.js";

const rl = createInterface({ input, output });
const ask = (q: string) => rl.question(q);

async function main() {
  const client = await connectMcp();

  try {
    // 1. Find a tool that initiates auth/consent.
    const tools = await client.listTools();
    const candidates = tools.tools.filter((t) =>
      /consent|auth|connect|start|link/i.test(t.name)
    );

    console.log("Auth-initiation candidates:");
    candidates.forEach((t, i) =>
      console.log(`  [${i}] ${t.name} — ${t.description ?? "(no description)"}`)
    );

    const idxStr = await ask(
      "\nWhich tool initiates the OF auth flow? Enter index: "
    );
    const tool = candidates[Number(idxStr)];
    if (!tool) {
      throw new Error(`No tool at index ${idxStr}`);
    }

    // 2. Collect inputs based on the tool's input schema.
    const args: Record<string, unknown> = {};
    const props = (tool.inputSchema?.properties ?? {}) as Record<
      string,
      { type?: string; description?: string }
    >;
    for (const [key, schema] of Object.entries(props)) {
      const ans = await ask(`  ${key} (${schema.type ?? "?"}): `);
      args[key] = schema.type === "number" ? Number(ans) : ans;
    }

    // 3. Call it. Capture EVERYTHING.
    console.log(`\nCalling ${tool.name} with`, args);
    let result;
    try {
      result = await client.callTool({ name: tool.name, arguments: args });
    } catch (err) {
      await capture(`auth.${tool.name}.error`, {
        args,
        error: serializeError(err),
      });
      console.error("Tool call failed — captured the error.");
      throw err;
    }
    await capture(`auth.${tool.name}.response`, { args, result });

    console.log("\nResult:");
    console.dir(result, { depth: null });

    // 4. If a consent URL came back, open it manually and finish in the browser.
    const consentUrl = findUrlInResult(result);
    if (consentUrl) {
      console.log(`\n→ Open this URL in your browser to consent:`);
      console.log(`  ${consentUrl}`);
      await ask(
        "Once you've completed the consent in the browser, press Enter to continue…"
      );
    } else {
      console.log(
        "\n(No URL found in result — record manually what the MCP expected the client to do.)"
      );
    }

    // 5. Try a follow-up "finish/callback" tool if one is obvious.
    const finishCandidates = tools.tools.filter((t) =>
      /finish|callback|complete|exchange/i.test(t.name)
    );
    if (finishCandidates.length > 0) {
      console.log("\nFinish-flow candidates:");
      finishCandidates.forEach((t, i) =>
        console.log(`  [${i}] ${t.name}`)
      );
      const finishIdx = await ask(
        "Index of finish tool (or blank to skip): "
      );
      if (finishIdx.trim()) {
        const finishTool = finishCandidates[Number(finishIdx)];
        const finishArgs: Record<string, unknown> = {};
        const finishProps = (finishTool.inputSchema?.properties ?? {}) as Record<
          string,
          { type?: string }
        >;
        for (const key of Object.keys(finishProps)) {
          finishArgs[key] = await ask(`  ${key}: `);
        }
        const finishResult = await client.callTool({
          name: finishTool.name,
          arguments: finishArgs,
        });
        await capture(`auth.${finishTool.name}.response`, {
          args: finishArgs,
          result: finishResult,
        });
        console.log("Finish result:");
        console.dir(finishResult, { depth: null });
      }
    }
  } finally {
    await safeClose(client);
    rl.close();
  }
}

function findUrlInResult(result: unknown): string | undefined {
  const s = JSON.stringify(result);
  const match = s.match(/https?:\/\/[^\s"'<>]+/);
  return match?.[0];
}

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { raw: String(err) };
}

main().catch((err) => {
  console.error("Auth flow failed:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the auth flow with real credentials**

```bash
bun run discover:auth
```

You will be prompted for:
- The auth-initiation tool index
- The arguments it requests (likely CPF + institution id; possibly more)
- After it returns a URL, open it in your browser, complete the OF consent for one institution (a small bank is fine for testing), come back to terminal and press Enter.
- The finish-flow tool index (if any) and its arguments (often `code`, `state` from the browser callback URL — you may need to paste those manually).

Expected: at least one capture file in `scripts/mcp-discovery/captures/` containing the response of the start tool, and (ideally) another containing access tokens / account list from the finish tool.

If the MCP server-side auth is single-shot and binds to a process (e.g. it expects the same MCP session for both calls), document that in `docs/mcp-discovery.md` — it changes the design for Phase 2.

- [ ] **Step 3: Fill in the "Auth flow" section in `docs/mcp-discovery.md`**

In `docs/mcp-discovery.md`, replace the `## Auth flow` section with the actual observed flow. Capture:
- Which tool initiates the flow
- Exact input fields (names, types)
- Exact output shape (consent URL? token? polling endpoint?)
- Which tool finishes the flow (if any), and its inputs/outputs
- Token shape (opaque string? JWT? expiration field?)
- Whether the access token must be passed as a header on subsequent MCP calls, an argument, or is stored server-side bound to a session

This is the most important deliverable of Phase 0.

- [ ] **Step 4: Stage**

```bash
git add scripts/mcp-discovery/auth-flow.ts docs/mcp-discovery.md
```

---

## Task 8: Probe data tools after auth

**Files:**
- Create: `scripts/mcp-discovery/probe-data.ts`

- [ ] **Step 1: Write the data probe**

Create `scripts/mcp-discovery/probe-data.ts`:
```ts
import { connectMcp, safeClose } from "./lib/mcp-client.js";
import { capture } from "./lib/capture.js";

// Paste the access token from the auth flow capture into the env before running:
//   CUMBUCA_ACCESS_TOKEN=... bun run discover:data
const TOKEN = process.env.CUMBUCA_ACCESS_TOKEN;
if (!TOKEN) {
  console.error(
    "Set CUMBUCA_ACCESS_TOKEN env var (paste from auth-flow capture)"
  );
  process.exit(1);
}

// Update these names to match what Task 7's catalog actually shows.
const DATA_TOOLS: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "list_accounts", args: {} },
  {
    name: "list_transactions",
    args: { since: lastNDaysISO(30) },
  },
  // Add more after Task 6's catalog is known.
];

async function main() {
  const client = await connectMcp({
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  try {
    for (const { name, args } of DATA_TOOLS) {
      try {
        console.log(`\nCalling ${name}…`);
        const result = await client.callTool({ name, arguments: args });
        await capture(`data.${name}.response`, { args, result });
        console.log("  ok");
      } catch (err) {
        await capture(`data.${name}.error`, {
          args,
          error: err instanceof Error ? err.message : String(err),
        });
        console.error(`  failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await safeClose(client);
  }
}

function lastNDaysISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error("Data probe failed:", err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Tune `DATA_TOOLS` to match the actual catalog**

Edit the array based on tool names observed in Task 5. Use the tool catalog table in `docs/mcp-discovery.md` as the source. If `Authorization: Bearer …` is not the right header (e.g. token is passed as an argument), update the call site here and in `lib/mcp-client.ts`.

- [ ] **Step 3: Run the data probe**

```bash
CUMBUCA_ACCESS_TOKEN="<paste from capture>" bun run discover:data
```

Expected: one capture file per data tool, containing realistic payload (accounts list, transactions list, etc.). Errors are captured too — they're equally useful for design.

- [ ] **Step 4: Stage**

```bash
git add scripts/mcp-discovery/probe-data.ts
```

---

## Task 9: Sanitize captures into committable fixtures

Raw captures contain real CPFs, account numbers, transaction descriptions. They are gitignored. To unit-test Zod schemas, we need sanitized fixtures that **preserve structure** but redact values.

**Files:**
- Create: `tests/mcp/fixtures/list-tools.json`
- Create: `tests/mcp/fixtures/auth-start.json`
- Create: `tests/mcp/fixtures/list-accounts.json`
- Create: `tests/mcp/fixtures/list-transactions.json`
- (Create more fixtures matching whichever data tools were probed in Task 8.)

- [ ] **Step 1: Build fixtures manually**

For each raw capture in `scripts/mcp-discovery/captures/`, open it and copy the structure into the corresponding fixture file under `tests/mcp/fixtures/`, **replacing real values**:

| Real value | Replace with |
|---|---|
| CPF (`12345678901`) | `00000000000` |
| Account number / agency | `0000` / `00000` |
| Real names | `"Test User"` |
| Real merchant names | `"Test Merchant"` |
| Real amounts | round numbers (`1000`, `2500`) |
| Real dates | dates in 2024 (any) |
| Tokens | omit or set to `"FIXTURE_TOKEN"` |
| Internal IDs | `"fixture-id-1"`, `"fixture-id-2"` |

Keep array lengths small (2-3 items per list). Preserve every key the real payload had — that's what the schema needs to validate.

- [ ] **Step 2: Stage fixtures**

```bash
git add tests/mcp/fixtures/
```

---

## Task 10: Write Zod schemas — test first

For each fixture, write a failing test that asserts the schema parses it, then write the schema.

**Files:**
- Create: `lib/mcp/tools.ts`
- Create: `lib/mcp/types.ts`
- Create: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing test for `listTools`**

Create `tests/mcp/tools.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ListToolsResponse,
  AuthStartResponse,
  ListAccountsResponse,
  ListTransactionsResponse,
} from "@/lib/mcp/tools";

async function loadFixture(name: string): Promise<unknown> {
  const path = resolve(
    process.cwd(),
    "tests/mcp/fixtures",
    `${name}.json`
  );
  return JSON.parse(await readFile(path, "utf8"));
}

describe("MCP schemas parse captured fixtures", () => {
  it("listTools", async () => {
    const raw = await loadFixture("list-tools");
    const parsed = ListToolsResponse.parse(raw);
    expect(parsed.tools.length).toBeGreaterThan(0);
  });

  it("auth start", async () => {
    const raw = await loadFixture("auth-start");
    const parsed = AuthStartResponse.parse(raw);
    expect(parsed).toBeDefined();
  });

  it("list accounts", async () => {
    const raw = await loadFixture("list-accounts");
    const parsed = ListAccountsResponse.parse(raw);
    expect(parsed.accounts.length).toBeGreaterThan(0);
  });

  it("list transactions", async () => {
    const raw = await loadFixture("list-transactions");
    const parsed = ListTransactionsResponse.parse(raw);
    expect(parsed.transactions.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bun run test --run tests/mcp/tools.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/mcp/tools'` or equivalent.

- [ ] **Step 3: Write the schemas**

Create `lib/mcp/tools.ts`. Write each schema by **looking at the corresponding fixture** and mirroring its shape with Zod. Example skeleton (adjust to fixtures):
```ts
import { z } from "zod";

export const McpToolDescriptor = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z
    .object({
      type: z.string().optional(),
      properties: z.record(z.unknown()).optional(),
      required: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export const ListToolsResponse = z.object({
  tools: z.array(McpToolDescriptor),
});

// The shape below is a placeholder until Task 7's auth-start fixture exists.
// Update each field to match the actual fixture.
export const AuthStartResponse = z.object({
  consentUrl: z.string().url().optional(),
  state: z.string().optional(),
  // …add whatever the real payload contains
}).passthrough();

export const AccountSchema = z.object({
  id: z.string(),
  type: z.string(),
  institutionName: z.string(),
  balance: z.number(),       // in MCP's own unit — convert to cents in Phase 3
  currency: z.string(),
}).passthrough();

export const ListAccountsResponse = z.object({
  accounts: z.array(AccountSchema),
});

export const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amount: z.number(),
  currency: z.string(),
  date: z.string(),          // ISO; tighten in Phase 3 if needed
  description: z.string().optional(),
}).passthrough();

export const ListTransactionsResponse = z.object({
  transactions: z.array(TransactionSchema),
});
```

**Important:** every schema uses `.passthrough()` for now so unknown fields don't fail validation. Phase 3 will tighten where appropriate.

- [ ] **Step 4: Write type re-exports**

Create `lib/mcp/types.ts`:
```ts
import { z } from "zod";
import {
  ListToolsResponse,
  AuthStartResponse,
  ListAccountsResponse,
  ListTransactionsResponse,
  AccountSchema,
  TransactionSchema,
} from "./tools";

export type ListToolsResponse = z.infer<typeof ListToolsResponse>;
export type AuthStartResponse = z.infer<typeof AuthStartResponse>;
export type ListAccountsResponse = z.infer<typeof ListAccountsResponse>;
export type ListTransactionsResponse = z.infer<typeof ListTransactionsResponse>;
export type Account = z.infer<typeof AccountSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
```

- [ ] **Step 5: Run the test until it passes**

```bash
bun run test --run tests/mcp/tools.test.ts
```

Expected: PASS. If it fails, the fixture and the schema disagree — adjust the schema (not the fixture) until structural validation passes. The fixture is the ground truth; the schema is what we tell TypeScript and downstream phases.

- [ ] **Step 6: Stage**

```bash
git add lib/mcp/tools.ts lib/mcp/types.ts tests/mcp/tools.test.ts
```

---

## Task 11: Finalize `docs/mcp-discovery.md`

**Files:**
- Modify: `docs/mcp-discovery.md`

- [ ] **Step 1: Fill the "Per-tool details" section**

For each tool actually probed, add a subsection like:
```markdown
### `list_transactions`

**Auth required?** Yes (Authorization: Bearer header)

**Input:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| since | string (ISO date) | yes | inclusive |
| accountId | string | no | filter to one account |

**Output:**
- `transactions: Transaction[]`
- See `lib/mcp/tools.ts` → `TransactionSchema` for the field-level Zod schema.

**Observed limits:**
- Max window: <fill in>
- Max items per call: <fill in>
- Rate limit: <fill in if you saw 429>

**Errors observed:**
- `<errorCode>`: <when it happens>
```

- [ ] **Step 2: Fill the "Spec deltas" section**

Re-read `docs/superpowers/specs/2026-05-20-dashboard-cumbuca-design.md`. For each premise that does **not** match reality, add a delta:
```markdown
### Section 3, Flow 2 — corrections

- The auth tool is actually named `<real name>`, not `start_consent`.
- It accepts `<field>`, not `cpf`.
- It returns `<shape>` instead of `{ consentUrl, opaqueState }`.

(Action for Phase 2 plan: update the design before implementing.)
```

If reality matches the spec, write "No deltas" — that's also a valid outcome.

- [ ] **Step 3: Stage**

```bash
git add docs/mcp-discovery.md
```

---

## Task 12: End-to-end reproduction

The whole point of Phase 0 is reproducibility. Run every probe from scratch and confirm the artifacts hold.

- [ ] **Step 1: Wipe captures**

```bash
rm -f scripts/mcp-discovery/captures/*.json
```

- [ ] **Step 2: Re-run all probes in order**

```bash
bun run discover:list
bun run discover:auth     # follow prompts again with real OF consent
CUMBUCA_ACCESS_TOKEN="<from auth capture>" bun run discover:data
```

Expected: all three complete without unhandled errors. Each writes one or more captures.

- [ ] **Step 3: Run tests**

```bash
bun run test --run
```

Expected: all green (the only suite right now is `tests/mcp/tools.test.ts`).

- [ ] **Step 4: Lint + typecheck**

```bash
bun run lint
bunx tsc --noEmit
```

Expected: no errors. If `tsc` is missing as a script entry, the bare command above still works.

---

## Task 13: Commit (only now — E2E green)

Per user preference, no commits until Task 12 passes E2E. If anything in Task 12 failed, fix it and re-run; do not commit a broken phase.

- [ ] **Step 1: Review what's staged**

```bash
git status
git diff --cached --stat
```

Expected: changes across `package.json`, `bun.lock`, `vitest.config.ts`, `tsconfig.json`, `scripts/mcp-discovery/**`, `lib/mcp/**`, `tests/mcp/**`, `docs/mcp-discovery.md`, `.gitignore`. No JSON files under `scripts/mcp-discovery/captures/` (gitignored).

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(phase-0): MCP discovery — probe scripts, Zod schemas, report

Probes Cumbuca MCP, captures real responses (gitignored), builds typed
schemas from sanitized fixtures, documents tool catalog + auth flow.
Subsequent phases consume lib/mcp/tools.ts and docs/mcp-discovery.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Confirm**

```bash
git log --oneline -3
git status
```

Expected: new commit appears; working tree clean except for the captures dir.

---

## What this phase produces (handoff to Phase 1+ planning)

| Artifact | Used by |
|---|---|
| `lib/mcp/tools.ts` (Zod schemas) | Phase 3 sync engine, Phase 2 OF flow |
| `lib/mcp/types.ts` (TS types) | Everywhere downstream |
| `tests/mcp/fixtures/*.json` | Regression tests in later phases |
| `docs/mcp-discovery.md` — Tool catalog | Phase 2, 3 implementation reference |
| `docs/mcp-discovery.md` — Auth flow section | Phase 2 OF flow design corrections |
| `docs/mcp-discovery.md` — Spec deltas | **Re-open `2026-05-20-dashboard-cumbuca-design.md` before writing Phase 2 plan** |
| `scripts/mcp-discovery/probe-*.ts` | Smoke probes when the MCP changes |

After this phase: re-evaluate the spec against the deltas section, then write the Phase 2 (Onboarding + Open Finance flow) plan.
