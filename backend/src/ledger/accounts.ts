/**
 * CHART OF ACCOUNTS — the codes the application posts against.
 *
 * These are seeded into `ledger_accounts` by `prisma/seed.ts` and must stay in
 * step with it. Codes are stable identifiers: renaming one would orphan every
 * historical line that references it, so the constant lives here and the seed
 * imports its own copy rather than the other way round (the seed runs with a
 * different compiler context).
 */
export const ACCOUNTS = {
  CASH_CLEARING: '1000_CASH_CLEARING',
  PAYSTACK_CLEARING: '1010_PAYSTACK_CLEARING',
  FLUTTERWAVE_CLEARING: '1020_FLUTTERWAVE_CLEARING',
  BANK_MAIN: '1030_BANK_MAIN',
  CUSTOMER_WALLET_LIABILITY: '2000_CUSTOMER_WALLET_LIABILITY',
  RIDER_EARNINGS_PAYABLE: '2100_RIDER_EARNINGS_PAYABLE',
  WITHDRAWALS_PAYABLE: '2200_WITHDRAWALS_PAYABLE',
  TAX_PAYABLE: '3000_TAX_PAYABLE',
  DELIVERY_REVENUE: '4000_DELIVERY_REVENUE',
  SURCHARGE_REVENUE: '4100_SURCHARGE_REVENUE',
  OTHER_INCOME: '4900_OTHER_INCOME',
  RIDER_COMMISSION_COST: '5000_RIDER_COMMISSION_COST',
  GATEWAY_FEES: '5100_GATEWAY_FEES',
  OPERATING_EXPENSE: '5200_OPERATING_EXPENSE',
  REFUNDS: '5300_REFUNDS',
} as const;

export type AccountCode = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];

/** Where money from a given provider lands before it reaches the bank. */
export const CLEARING_ACCOUNT_FOR: Record<string, AccountCode> = {
  PAYSTACK: ACCOUNTS.PAYSTACK_CLEARING,
  FLUTTERWAVE: ACCOUNTS.FLUTTERWAVE_CLEARING,
  BANK_TRANSFER: ACCOUNTS.BANK_MAIN,
  CASH: ACCOUNTS.CASH_CLEARING,
  WALLET: ACCOUNTS.CUSTOMER_WALLET_LIABILITY,
};
