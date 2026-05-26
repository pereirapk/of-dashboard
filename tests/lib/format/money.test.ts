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
    expect(parseMcpAmountToCents("9944.1099")).toBe(994411);
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
  // NOTE: Intl.NumberFormat("pt-BR") emits U+00A0 (NBSP, char code 160) between
  // "R$" and the number, not a regular space (U+0020). Test expectations use
  // the actual NBSP character ( ) to match runtime output.
  it("formats positive cents as BRL", () => {
    expect(centsToBrl(123456)).toBe("R$ 1.234,56");
    expect(centsToBrl(0)).toBe("R$ 0,00");
    expect(centsToBrl(100)).toBe("R$ 1,00");
  });

  it("formats negative cents", () => {
    expect(centsToBrl(-123456)).toBe("-R$ 1.234,56");
  });
});
