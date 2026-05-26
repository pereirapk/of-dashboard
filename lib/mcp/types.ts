import type { z } from "zod";
import type {
  Money,
  ConsentStatusResponse,
  AccountSummary,
  ListAccountsResponse,
  AccountDetail,
  AccountBalance,
  GetAccountResponse,
  AccountTransaction,
  ListAccountTransactionsResponse,
  CreditCard,
  ListCreditCardsResponse,
  BillPayment,
  Bill,
  ListCreditCardBillsResponse,
  CreditCardTransaction,
  ListCreditCardBillTransactionsResponse,
} from "./tools";

export type Money = z.infer<typeof Money>;
export type ConsentStatusResponse = z.infer<typeof ConsentStatusResponse>;
export type AccountSummary = z.infer<typeof AccountSummary>;
export type ListAccountsResponse = z.infer<typeof ListAccountsResponse>;
export type AccountDetail = z.infer<typeof AccountDetail>;
export type AccountBalance = z.infer<typeof AccountBalance>;
export type GetAccountResponse = z.infer<typeof GetAccountResponse>;
export type AccountTransaction = z.infer<typeof AccountTransaction>;
export type ListAccountTransactionsResponse = z.infer<typeof ListAccountTransactionsResponse>;
export type CreditCard = z.infer<typeof CreditCard>;
export type ListCreditCardsResponse = z.infer<typeof ListCreditCardsResponse>;
export type BillPayment = z.infer<typeof BillPayment>;
export type Bill = z.infer<typeof Bill>;
export type ListCreditCardBillsResponse = z.infer<typeof ListCreditCardBillsResponse>;
export type CreditCardTransaction = z.infer<typeof CreditCardTransaction>;
export type ListCreditCardBillTransactionsResponse = z.infer<typeof ListCreditCardBillTransactionsResponse>;
