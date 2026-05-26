import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  upsertAccountFromMcp,
  updateAccountBalance,
  upsertCreditCardFromMcp,
  findAccountsByUser,
  findAccountByExternalId,
  ensureBankAccountIndexes,
  type BankAccountDoc,
} from "@/lib/repositories/accounts";
import {
  ListAccountsResponse,
  GetAccountResponse,
  ListCreditCardsResponse,
} from "@/lib/mcp/tools";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("test");
}, 120000);

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("bank_accounts").deleteMany({});
});

async function loadFixture(name: string): Promise<unknown> {
  const path = resolve(process.cwd(), "tests/mcp/fixtures", `${name}.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

describe("bank_accounts repository", () => {
  it("upsertAccountFromMcp inserts and re-runs idempotently", async () => {
    const data = ListAccountsResponse.parse(await loadFixture("list-accounts"));
    const account = data.accounts[0];

    const id1 = await upsertAccountFromMcp(db, {
      userId: "u1",
      bankConnectionId: "conn1",
      account,
    });
    const id2 = await upsertAccountFromMcp(db, {
      userId: "u1",
      bankConnectionId: "conn1",
      account,
    });
    expect(id1.toHexString()).toBe(id2.toHexString());

    const count = await db.collection("bank_accounts").countDocuments({});
    expect(count).toBe(1);

    const stored = await db
      .collection<BankAccountDoc>("bank_accounts")
      .findOne({ _id: id1 });
    expect(stored?.kind).toBe("account");
    expect(stored?.externalId).toBe(account.accountId);
    expect(stored?.compeCode).toBe("341");
    expect(stored?.currency).toBe("BRL");
    expect(stored?.currentBalance).toBeNull(); // no balance yet
  });

  it("updateAccountBalance computes total = available + blocked + autoInvested", async () => {
    const list = ListAccountsResponse.parse(await loadFixture("list-accounts"));
    const accountId = await upsertAccountFromMcp(db, {
      userId: "u1",
      bankConnectionId: "conn1",
      account: list.accounts[0],
    });

    const detail = GetAccountResponse.parse(await loadFixture("get-account"));
    // fixture has available=2500.00, blocked=50.00, autoInvested=100.00 → total 2650.00 = 265000 cents
    const result = await updateAccountBalance(db, accountId, detail);

    expect(result.available).toBe(250000);
    expect(result.blocked).toBe(5000);
    expect(result.automaticallyInvested).toBe(10000);
    expect(result.total).toBe(265000);

    const stored = await db
      .collection<BankAccountDoc>("bank_accounts")
      .findOne({ _id: accountId });
    expect(stored?.currentBalance).toBe(265000);
    expect(stored?.balanceComponents?.available).toBe(250000);
    expect(stored?.balanceUpdatedAt).toBeInstanceOf(Date);
    expect(stored?.subtype).toBe("INDIVIDUAL");
  });

  it("upsertCreditCardFromMcp inserts with kind='credit_card' and network/productType", async () => {
    const data = ListCreditCardsResponse.parse(await loadFixture("list-credit-cards"));
    const card = data.credit_cards[0];

    const id = await upsertCreditCardFromMcp(db, {
      userId: "u1",
      bankConnectionId: "conn1",
      card,
    });

    const stored = await db
      .collection<BankAccountDoc>("bank_accounts")
      .findOne({ _id: id });
    expect(stored?.kind).toBe("credit_card");
    expect(stored?.creditCardNetwork).toBe("MASTERCARD");
    expect(stored?.productType).toBe("BLACK");
    expect(stored?.branchCode).toBeNull();
  });

  it("findAccountsByUser returns both kinds", async () => {
    const list = ListAccountsResponse.parse(await loadFixture("list-accounts"));
    const cards = ListCreditCardsResponse.parse(await loadFixture("list-credit-cards"));

    for (const a of list.accounts) {
      await upsertAccountFromMcp(db, { userId: "u1", bankConnectionId: "conn1", account: a });
    }
    for (const c of cards.credit_cards) {
      await upsertCreditCardFromMcp(db, { userId: "u1", bankConnectionId: "conn1", card: c });
    }

    const rows = await findAccountsByUser(db, "u1");
    expect(rows.length).toBe(list.accounts.length + cards.credit_cards.length);
    expect(rows.some((r) => r.kind === "account")).toBe(true);
    expect(rows.some((r) => r.kind === "credit_card")).toBe(true);
  });

  it("findAccountByExternalId scopes by bankConnectionId", async () => {
    const list = ListAccountsResponse.parse(await loadFixture("list-accounts"));
    const a = list.accounts[0];
    await upsertAccountFromMcp(db, { userId: "u1", bankConnectionId: "connA", account: a });

    const hit = await findAccountByExternalId(db, "connA", a.accountId);
    expect(hit).not.toBeNull();

    const miss = await findAccountByExternalId(db, "connB", a.accountId);
    expect(miss).toBeNull();
  });

  it("ensureBankAccountIndexes creates the unique compound index", async () => {
    await ensureBankAccountIndexes(db);
    const indexes = await db.collection("bank_accounts").indexes();
    const unique = indexes.find(
      (i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ bankConnectionId: 1, externalId: 1 })
    );
    expect(unique).toBeDefined();
  });
});
