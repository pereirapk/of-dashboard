import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ConsentStatusResponse,
  ListAccountsResponse,
  GetAccountResponse,
  ListAccountTransactionsResponse,
  ListCreditCardsResponse,
  ListCreditCardBillsResponse,
  ListCreditCardBillTransactionsResponse,
} from "@/lib/mcp/tools";

async function loadFixture(name: string): Promise<unknown> {
  const path = resolve(process.cwd(), "tests/mcp/fixtures", `${name}.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Cumbuca MCP schemas parse captured fixtures", () => {
  it("get_consent_status", async () => {
    const raw = await loadFixture("consent-status");
    const parsed = ConsentStatusResponse.parse(raw);
    expect(parsed.status).toBe("active");
    expect(parsed.expires_at).toBeNull();
  });

  it("list_accounts", async () => {
    const raw = await loadFixture("list-accounts");
    const parsed = ListAccountsResponse.parse(raw);
    expect(parsed.accounts.length).toBe(2);
    expect(parsed.accounts[0].accountId).toBeTypeOf("string");
  });

  it("get_account", async () => {
    const raw = await loadFixture("get-account");
    const parsed = GetAccountResponse.parse(raw);
    expect(parsed.balance.availableAmount.amount).toBe("2500.00");
    expect(parsed.balance.availableAmount.currency).toBe("BRL");
  });

  it("list_account_transactions (includes a txn without partieCnpjCpf)", async () => {
    const raw = await loadFixture("list-account-transactions");
    const parsed = ListAccountTransactionsResponse.parse(raw);
    expect(parsed.transactions.length).toBe(3);
    const noCnpj = parsed.transactions.find(
      (t) => t.partieCnpjCpf === undefined
    );
    expect(noCnpj).toBeDefined();
  });

  it("list_credit_cards", async () => {
    const raw = await loadFixture("list-credit-cards");
    const parsed = ListCreditCardsResponse.parse(raw);
    expect(parsed.credit_cards[0].creditCardNetwork).toBe("MASTERCARD");
  });

  it("list_credit_card_bills (mixed instalment + non-instalment)", async () => {
    const raw = await loadFixture("list-credit-card-bills");
    const parsed = ListCreditCardBillsResponse.parse(raw);
    expect(parsed.bills.length).toBe(2);
    expect(parsed.bills[0].isInstalment).toBe(true);
    expect(parsed.bills[1].isInstalment).toBe(false);
    expect(parsed.bills[0].payments.length).toBe(2);
    expect(parsed.bills[1].payments.length).toBe(0);
  });

  it("list_credit_card_bill_transactions (a_vista, a_prazo, refund)", async () => {
    const raw = await loadFixture("list-credit-card-bill-transactions");
    const parsed = ListCreditCardBillTransactionsResponse.parse(raw);
    expect(parsed.transactions.length).toBe(3);

    const aVista = parsed.transactions.find((t) => t.paymentType === "A_VISTA");
    expect(aVista?.payeeMCC).toBe(5411);

    const installment = parsed.transactions.find(
      (t) => t.paymentType === "A_PRAZO"
    );
    expect(installment?.chargeNumber).toBe(3);
    expect(installment?.chargeIdentificator).toBe(2);

    const refund = parsed.transactions.find(
      (t) => t.creditDebitType === "CREDITO"
    );
    expect(refund?.otherCreditsType).toBe("CREDITO_ROTATIVO");
  });
});
