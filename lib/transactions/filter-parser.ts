import type { TransactionFilter } from "@/lib/repositories/transactions";

export interface ParsedFilters extends Omit<TransactionFilter, "userId"> {
  page?: number;
}

/**
 * Decode URL search params into typed transaction filters. Invalid values
 * are silently dropped. The userId is added by the caller (server component).
 */
export function parseFiltersFromSearchParams(
  params: Record<string, string | string[] | undefined>
): ParsedFilters {
  const out: ParsedFilters = {};
  const get = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : undefined;
  };

  const from = get("from");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    out.from = new Date(`${from}T00:00:00.000Z`);
  }
  const to = get("to");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    out.to = new Date(`${to}T00:00:00.000Z`);
  }

  const category = get("category");
  if (category === "null") out.category = null;
  else if (category) out.category = category;

  const bankAccountId = get("account");
  if (bankAccountId) out.bankAccountId = bankAccountId;

  const source = get("source");
  if (source === "account" || source === "credit_card") out.source = source;

  const q = get("q");
  if (q && q.trim()) out.q = q.trim();

  const page = get("page");
  if (page) {
    const n = parseInt(page, 10);
    if (Number.isInteger(n) && n >= 1) out.page = n;
  }

  return out;
}
