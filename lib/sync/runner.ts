import type { Db, ObjectId } from "mongodb";
import { callMcpTool } from "@/lib/mcp/client";
import {
  ListAccountsResponse,
  GetAccountResponse,
  ListAccountTransactionsResponse,
  ListCreditCardsResponse,
  ListCreditCardBillsResponse,
  ListCreditCardBillTransactionsResponse,
} from "@/lib/mcp/tools";
import { McpError } from "@/lib/mcp/errors";
import { dispatchCategorization } from "@/lib/categorize/dispatcher";
import {
  createSyncRun,
  finishSyncRun,
  EMPTY_STATS,
  type SyncRunStats,
} from "@/lib/repositories/sync-runs";
import {
  upsertAccountFromMcp,
  updateAccountBalance,
  upsertCreditCardFromMcp,
  ensureBankAccountIndexes,
} from "@/lib/repositories/accounts";
import {
  bulkUpsertAccountTransactions,
  bulkUpsertCreditCardTransactions,
  ensureTransactionIndexes,
} from "@/lib/repositories/transactions";
import {
  upsertDailySnapshot,
  ensureSnapshotIndexes,
} from "@/lib/repositories/snapshots";
import { ensureMcpCallLogIndexes } from "@/lib/repositories/mcp-call-logs";
import type { BankConnectionDoc } from "@/lib/repositories/connections";

export interface RunSyncOptions {
  triggeredBy: "manual" | "cron";
  bypassCache?: boolean;
}

export interface RunSyncResult {
  syncRunId: string;
  status: "success" | "partial" | "error";
  stats: SyncRunStats;
}

let indexesEnsured = false;
async function ensureAllIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  await Promise.all([
    ensureMcpCallLogIndexes(db),
    ensureBankAccountIndexes(db),
    ensureTransactionIndexes(db),
    ensureSnapshotIndexes(db),
  ]);
  indexesEnsured = true;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runSync(
  db: Db,
  conn: BankConnectionDoc,
  accessToken: string,
  opts: RunSyncOptions
): Promise<RunSyncResult> {
  await ensureAllIndexes(db);

  const stats: SyncRunStats = {
    transactionsFetched: 0,
    transactionsNew: 0,
    accountsUpdated: 0,
    snapshotsWritten: 0,
    mccCategorized: 0,
    llmCategorized: 0,
    errors: [],
  };

  const bankConnectionId = conn._id.toString();
  const syncRunId = await createSyncRun(db, {
    userId: conn.userId,
    bankConnectionId,
    triggeredBy: opts.triggeredBy,
  });

  const ctxBase = {
    db,
    userId: conn.userId,
    bankConnectionId,
    syncRunId: syncRunId.toString(),
    triggeredBy: opts.triggeredBy,
    accessToken,
    bypassCache: opts.bypassCache,
  };

  // 1. List accounts
  const accountIds: Array<{ accountId: ObjectId; externalId: string }> = [];
  try {
    const result = await callMcpTool(
      { ...ctxBase, quotaBucket: "list_accounts" },
      "list_accounts",
      {},
      ListAccountsResponse
    );
    for (const account of result.accounts) {
      const id = await upsertAccountFromMcp(db, {
        userId: conn.userId,
        bankConnectionId,
        account,
      });
      accountIds.push({ accountId: id, externalId: account.accountId });
      stats.accountsUpdated++;
    }
  } catch (err) {
    recordError(stats, "list_accounts", err);
  }

  // 2. get_account + transactions per account
  for (const { accountId, externalId } of accountIds) {
    try {
      const detail = await callMcpTool(
        { ...ctxBase, quotaBucket: "account_balance" },
        "get_account",
        { account_id: externalId },
        GetAccountResponse
      );
      const balanceResult = await updateAccountBalance(db, accountId, detail);
      await upsertDailySnapshot(db, {
        userId: conn.userId,
        bankAccountId: accountId.toString(),
        date: new Date(),
        balance: balanceResult.total,
        components: {
          available: balanceResult.available,
          blocked: balanceResult.blocked,
          automaticallyInvested: balanceResult.automaticallyInvested,
        },
      });
      stats.snapshotsWritten++;
    } catch (err) {
      recordError(stats, "get_account", err);
    }

    try {
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setUTCDate(today.getUTCDate() - 7);
      const txs = await callMcpTool(
        { ...ctxBase, quotaBucket: "account_txn_recent" },
        "list_account_transactions",
        {
          account_id: externalId,
          from_date: isoDate(sevenDaysAgo),
          to_date: isoDate(today),
        },
        ListAccountTransactionsResponse
      );
      const upsertResult = await bulkUpsertAccountTransactions(
        db,
        {
          userId: conn.userId,
          bankAccountId: accountId.toString(),
          bankConnectionId,
        },
        txs
      );
      stats.transactionsFetched += upsertResult.fetched;
      stats.transactionsNew += upsertResult.inserted;
    } catch (err) {
      recordError(stats, "list_account_transactions", err);
    }
  }

  // 3. List credit cards
  const creditCardIds: Array<{ accountId: ObjectId; externalId: string }> = [];
  try {
    const result = await callMcpTool(
      { ...ctxBase, quotaBucket: "credit_cards" },
      "list_credit_cards",
      {},
      ListCreditCardsResponse
    );
    for (const card of result.credit_cards) {
      const id = await upsertCreditCardFromMcp(db, {
        userId: conn.userId,
        bankConnectionId,
        card,
      });
      creditCardIds.push({ accountId: id, externalId: card.creditCardAccountId });
      stats.accountsUpdated++;
    }
  } catch (err) {
    recordError(stats, "list_credit_cards", err);
  }

  // 4. Per credit card: list bills, and for each bill in last 30d: list transactions
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);

  for (const { accountId, externalId } of creditCardIds) {
    let bills: { billId: string; dueDate: string }[] = [];
    try {
      const result = await callMcpTool(
        { ...ctxBase, quotaBucket: "credit_card_bills" },
        "list_credit_card_bills",
        { credit_card_account_id: externalId },
        ListCreditCardBillsResponse
      );
      bills = result.bills.map((b) => ({ billId: b.billId, dueDate: b.dueDate }));
    } catch (err) {
      recordError(stats, "list_credit_card_bills", err);
      continue;
    }

    const recentBills = bills.filter(
      (b) => new Date(b.dueDate).getTime() >= cutoff.getTime()
    );
    for (const bill of recentBills) {
      try {
        const txs = await callMcpTool(
          { ...ctxBase, quotaBucket: "credit_card_bill_txns" },
          "list_credit_card_bill_transactions",
          {
            credit_card_account_id: externalId,
            bill_id: bill.billId,
          },
          ListCreditCardBillTransactionsResponse
        );
        const upsertResult = await bulkUpsertCreditCardTransactions(
          db,
          {
            userId: conn.userId,
            bankAccountId: accountId.toString(),
            bankConnectionId,
          },
          txs
        );
        stats.transactionsFetched += upsertResult.fetched;
        stats.transactionsNew += upsertResult.inserted;
      } catch (err) {
        recordError(stats, "list_credit_card_bill_transactions", err);
      }
    }
  }

  // 4b. Categorize transactions (MCC tier + LLM tier)
  try {
    const cat = await dispatchCategorization(db, conn.userId);
    stats.mccCategorized = cat.mccCategorized;
    stats.llmCategorized = cat.llmCategorized;
  } catch (err) {
    recordError(stats, "categorize", err);
  }

  // 5. Finalize sync_run
  const status: "success" | "partial" | "error" =
    stats.errors.length === 0
      ? "success"
      : stats.accountsUpdated + stats.transactionsFetched + stats.snapshotsWritten > 0
      ? "partial"
      : "error";

  const errorMessage =
    stats.errors.length > 0 ? stats.errors[0].message : null;

  await finishSyncRun(db, syncRunId, status, stats, errorMessage);

  // 6. Update bank_connection.lastSync*
  await db.collection("bank_connections").updateOne(
    { _id: conn._id },
    {
      $set: {
        lastSyncAt: new Date(),
        lastSyncStatus: status,
      },
    }
  );

  return {
    syncRunId: syncRunId.toString(),
    status,
    stats,
  };
}

function recordError(stats: SyncRunStats, tool: string, err: unknown): void {
  if (err instanceof McpError) {
    stats.errors.push({ tool, kind: err.kind, message: err.message });
  } else if (err instanceof Error) {
    stats.errors.push({ tool, kind: "transport", message: err.message });
  } else {
    stats.errors.push({ tool, kind: "transport", message: String(err) });
  }
}
