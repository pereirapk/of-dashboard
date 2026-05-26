import { describe, it, expect } from "vitest";
import { parseFiltersFromSearchParams } from "@/lib/transactions/filter-parser";

describe("parseFiltersFromSearchParams", () => {
  it("returns empty object for empty params", () => {
    expect(parseFiltersFromSearchParams({})).toEqual({});
  });

  it("parses YYYY-MM-DD into UTC midnight Date", () => {
    const r = parseFiltersFromSearchParams({ from: "2026-05-01", to: "2026-06-01" });
    expect(r.from?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("ignores malformed dates", () => {
    const r = parseFiltersFromSearchParams({ from: "2026/05/01", to: "tomorrow" });
    expect(r.from).toBeUndefined();
    expect(r.to).toBeUndefined();
  });

  it("decodes category=null as JS null (uncategorized)", () => {
    const r = parseFiltersFromSearchParams({ category: "null" });
    expect(r.category).toBeNull();
  });

  it("category=groceries → string", () => {
    const r = parseFiltersFromSearchParams({ category: "groceries" });
    expect(r.category).toBe("groceries");
  });

  it("omits category when param absent (distinct from null)", () => {
    const r = parseFiltersFromSearchParams({});
    expect("category" in r).toBe(false);
  });

  it("accepts known sources, rejects unknown", () => {
    expect(parseFiltersFromSearchParams({ source: "account" }).source).toBe("account");
    expect(parseFiltersFromSearchParams({ source: "credit_card" }).source).toBe("credit_card");
    expect(parseFiltersFromSearchParams({ source: "bogus" }).source).toBeUndefined();
  });

  it("trims `q`; drops empty `q`", () => {
    expect(parseFiltersFromSearchParams({ q: "  amazon  " }).q).toBe("amazon");
    expect("q" in parseFiltersFromSearchParams({ q: "   " })).toBe(false);
  });

  it("decodes `account` param", () => {
    expect(parseFiltersFromSearchParams({ account: "abc" }).bankAccountId).toBe("abc");
  });

  it("decodes valid page; rejects invalid", () => {
    expect(parseFiltersFromSearchParams({ page: "3" }).page).toBe(3);
    expect(parseFiltersFromSearchParams({ page: "0" }).page).toBeUndefined();
    expect(parseFiltersFromSearchParams({ page: "-1" }).page).toBeUndefined();
    expect(parseFiltersFromSearchParams({ page: "abc" }).page).toBeUndefined();
  });

  it("handles array param values by ignoring them (uses only string)", () => {
    const r = parseFiltersFromSearchParams({ from: ["2026-05-01", "2026-05-02"] });
    expect(r.from).toBeUndefined();
  });
});
