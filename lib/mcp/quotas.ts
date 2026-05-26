/**
 * Monthly per-user quotas observed during Phase 0 discovery.
 * See docs/mcp-discovery.md for source.
 */
export const QUOTA_LIMITS = {
  list_accounts: 8,
  account_detail: 8,
  account_balance: 420,
  account_txn_recent: 240,
  account_txn_historical: 8,
  // No documented quotas for the remaining tools — caller treats undefined
  // as "skip gate".
  credit_cards: undefined,
  credit_card_bills: undefined,
  credit_card_bill_txns: undefined,
  consent_status: undefined,
  revoke_consent: undefined,
} as const;

export type QuotaBucket = keyof typeof QUOTA_LIMITS;

/** Current month key "YYYY-MM" in UTC. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Map an MCP tool name to the quota bucket it consumes.
 * For `list_account_transactions`, the bucket depends on whether the date
 * range is within last 7 days (recent) or extends earlier (historical);
 * callers compute that and pass the bucket explicitly. Returns null for
 * tools the caller must classify.
 */
export function staticBucketForTool(tool: string): QuotaBucket | null {
  switch (tool) {
    case "list_accounts":
      return "list_accounts";
    case "get_account":
      return "account_detail";
    case "list_credit_cards":
      return "credit_cards";
    case "list_credit_card_bills":
      return "credit_card_bills";
    case "list_credit_card_bill_transactions":
      return "credit_card_bill_txns";
    case "get_consent_status":
      return "consent_status";
    case "revoke_consent":
      return "revoke_consent";
    case "list_account_transactions":
      return null;
    default:
      return null;
  }
}
