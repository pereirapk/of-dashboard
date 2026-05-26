import { z } from "zod";

/**
 * Open Finance monetary amount. Always a string decimal with 2-4 places.
 * Convert to integer cents at the boundary; never parse as float.
 */
export const Money = z.looseObject({
  amount: z.string(),
  currency: z.string(),
});

export const CreditDebitType = z.enum(["DEBITO", "CREDITO"]);

// ─── get_consent_status ─────────────────────────────────────────────────────
export const ConsentStatusResponse = z.looseObject({
  expires_at: z.string().nullable(),
  institution_name: z.string(),
  status: z.string(),
});

// ─── list_accounts ──────────────────────────────────────────────────────────
export const AccountSummary = z.looseObject({
  accountId: z.string(),
  branchCode: z.string(),
  brandName: z.string(),
  checkDigit: z.string(),
  companyCnpj: z.string(),
  compeCode: z.string(),
  number: z.string(),
  type: z.string(),
});

export const ListAccountsResponse = z.looseObject({
  accounts: z.array(AccountSummary),
});

// ─── get_account ────────────────────────────────────────────────────────────
export const AccountDetail = z.looseObject({
  branchCode: z.string(),
  checkDigit: z.string(),
  compeCode: z.string(),
  currency: z.string(),
  number: z.string(),
  subtype: z.string().optional(),
  type: z.string(),
});

export const AccountBalance = z.looseObject({
  automaticallyInvestedAmount: Money,
  availableAmount: Money,
  blockedAmount: Money,
  updateDateTime: z.string(),
});

export const GetAccountResponse = z.looseObject({
  account: AccountDetail,
  balance: AccountBalance,
});

// ─── list_account_transactions ──────────────────────────────────────────────
export const AccountTransaction = z.looseObject({
  completedAuthorisedPaymentType: z.string(),
  creditDebitType: CreditDebitType,
  partieCnpjCpf: z.string().optional(),
  transactionAmount: Money,
  transactionDateTime: z.string(),
  transactionId: z.string(),
  transactionName: z.string(),
  type: z.string(),
});

export const ListAccountTransactionsResponse = z.looseObject({
  transactions: z.array(AccountTransaction),
});

// ─── list_credit_cards ──────────────────────────────────────────────────────
export const CreditCard = z.looseObject({
  brandName: z.string(),
  companyCnpj: z.string(),
  creditCardAccountId: z.string(),
  creditCardNetwork: z.string(),
  name: z.string(),
  productType: z.string(),
});

export const ListCreditCardsResponse = z.looseObject({
  credit_cards: z.array(CreditCard),
});

// ─── list_credit_card_bills ─────────────────────────────────────────────────
export const BillPayment = z.looseObject({
  amount: z.string(),
  currency: z.string(),
  paymentDate: z.string(),
  paymentMode: z.string(),
  valueType: z.string(),
});

export const Bill = z.looseObject({
  billId: z.string(),
  billMinimumAmount: Money,
  billTotalAmount: Money,
  dueDate: z.string(),
  isInstalment: z.boolean(),
  payments: z.array(BillPayment),
});

export const ListCreditCardBillsResponse = z.looseObject({
  bills: z.array(Bill),
});

// ─── list_credit_card_bill_transactions ─────────────────────────────────────
export const CreditCardTransaction = z.looseObject({
  amount: Money,
  billId: z.string(),
  billPostDate: z.string(),
  brazilianAmount: Money,
  chargeIdentificator: z.number().int().optional(),
  chargeNumber: z.number().int().optional(),
  creditDebitType: CreditDebitType,
  identificationNumber: z.string(),
  otherCreditsType: z.string().optional(),
  payeeMCC: z.number().int().optional(),
  paymentType: z.string().optional(),
  transactionDateTime: z.string(),
  transactionId: z.string(),
  transactionName: z.string(),
  transactionType: z.string(),
  transactionalAdditionalInfo: z.string().optional(),
});

export const ListCreditCardBillTransactionsResponse = z.looseObject({
  transactions: z.array(CreditCardTransaction),
});
