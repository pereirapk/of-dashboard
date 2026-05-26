import { describe, it, expect } from "vitest";
import { currentMonthKey, staticBucketForTool, QUOTA_LIMITS } from "@/lib/mcp/quotas";

describe("currentMonthKey", () => {
  it("formats as YYYY-MM in UTC", () => {
    expect(currentMonthKey(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
    expect(currentMonthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("respects UTC even when input is parsed in a non-UTC tz", () => {
    // 2026-05-31T23:00:00 in -05:00 is 2026-06-01 UTC
    const d = new Date("2026-05-31T23:00:00-05:00");
    expect(currentMonthKey(d)).toBe("2026-06");
  });
});

describe("staticBucketForTool", () => {
  it.each([
    ["list_accounts", "list_accounts"],
    ["get_account", "account_detail"],
    ["list_credit_cards", "credit_cards"],
    ["list_credit_card_bills", "credit_card_bills"],
    ["list_credit_card_bill_transactions", "credit_card_bill_txns"],
    ["get_consent_status", "consent_status"],
    ["revoke_consent", "revoke_consent"],
  ])("maps %s → %s", (tool, expected) => {
    expect(staticBucketForTool(tool)).toBe(expected);
  });

  it("returns null for list_account_transactions (caller decides)", () => {
    expect(staticBucketForTool("list_account_transactions")).toBeNull();
  });

  it("returns null for unknown tools", () => {
    expect(staticBucketForTool("nonexistent_tool")).toBeNull();
  });
});

describe("QUOTA_LIMITS", () => {
  it("documents the discovered limits", () => {
    expect(QUOTA_LIMITS.list_accounts).toBe(8);
    expect(QUOTA_LIMITS.account_balance).toBe(420);
    expect(QUOTA_LIMITS.account_txn_recent).toBe(240);
    expect(QUOTA_LIMITS.account_txn_historical).toBe(8);
  });

  it("leaves undocumented buckets as undefined (callers skip gate)", () => {
    expect(QUOTA_LIMITS.credit_cards).toBeUndefined();
    expect(QUOTA_LIMITS.consent_status).toBeUndefined();
  });
});
