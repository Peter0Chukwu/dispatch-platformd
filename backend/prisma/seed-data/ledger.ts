/**
 * CHART OF ACCOUNTS — the skeleton of the double-entry ledger.
 * Every kobo that moves is posted as a balanced journal entry across these
 * accounts (Phase 7). Codes are stable and must not be renamed casually.
 */
export const LEDGER_ACCOUNTS = [
  { code: '1000_CASH_CLEARING',            name: 'Cash clearing',                    type: 'ASSET',     normalBalance: 'DEBIT'  },
  { code: '1010_PAYSTACK_CLEARING',        name: 'Paystack clearing account',        type: 'ASSET',     normalBalance: 'DEBIT'  },
  { code: '1020_FLUTTERWAVE_CLEARING',     name: 'Flutterwave clearing account',     type: 'ASSET',     normalBalance: 'DEBIT'  },
  { code: '1030_BANK_MAIN',                name: 'Main bank account',                type: 'ASSET',     normalBalance: 'DEBIT'  },
  { code: '2000_CUSTOMER_WALLET_LIABILITY', name: 'Customer wallet liability',       type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '2100_RIDER_EARNINGS_PAYABLE',   name: 'Rider earnings payable',           type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '2200_WITHDRAWALS_PAYABLE',      name: 'Withdrawals in transit',           type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '3000_TAX_PAYABLE',              name: 'Tax / VAT payable',                type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '3900_OPENING_BALANCE',          name: 'Opening balance / retained',       type: 'EQUITY',    normalBalance: 'CREDIT' },
  { code: '4000_DELIVERY_REVENUE',         name: 'Delivery revenue',                 type: 'REVENUE',   normalBalance: 'CREDIT' },
  { code: '4100_SURCHARGE_REVENUE',        name: 'Express & scheduled surcharges',   type: 'REVENUE',   normalBalance: 'CREDIT' },
  { code: '4900_OTHER_INCOME',             name: 'Other income (bonuses recovered)', type: 'REVENUE',   normalBalance: 'CREDIT' },
  { code: '5000_RIDER_COMMISSION_COST',    name: 'Rider commission cost',            type: 'EXPENSE',   normalBalance: 'DEBIT'  },
  { code: '5100_GATEWAY_FEES',             name: 'Payment gateway fees',             type: 'EXPENSE',   normalBalance: 'DEBIT'  },
  { code: '5200_OPERATING_EXPENSE',        name: 'Operating expenses',               type: 'EXPENSE',   normalBalance: 'DEBIT'  },
  { code: '5300_REFUNDS',                  name: 'Refunds issued',                   type: 'EXPENSE',   normalBalance: 'DEBIT'  },
] as const;

/** Default runtime settings, editable later from the admin Settings screen. */
export const SYSTEM_SETTINGS = [
  { key: 'dispatch.offerTimeoutSeconds',        value: 45,   type: 'NUMBER',  group: 'dispatch', description: 'How long a rider has to accept an offered delivery' },
  { key: 'dispatch.maxActiveDeliveriesPerRider', value: 2,   type: 'NUMBER',  group: 'dispatch', description: 'Concurrent active deliveries a rider may hold' },
  { key: 'dispatch.maxOfferRounds',             value: 4,    type: 'NUMBER',  group: 'dispatch', description: 'How many riders are tried before a delivery is escalated to operations' },
  { key: 'dispatch.allowCrossZone',             value: false,type: 'BOOLEAN', group: 'dispatch', description: 'Allow riders to accept deliveries outside their service zone' },
  { key: 'tracking.pingIntervalSeconds',        value: 15,   type: 'NUMBER',  group: 'tracking', description: 'How often the rider app sends a GPS ping during an active delivery' },
  { key: 'tracking.customerLiveTracking',       value: true, type: 'BOOLEAN', group: 'tracking', description: 'Allow customers to see the rider’s live location' },
  { key: 'tracking.shareLinkTtlHours',          value: 72,   type: 'NUMBER',  group: 'tracking', description: 'Lifetime of a customer tracking share link' },
  { key: 'location.retentionDays',              value: 30,   type: 'NUMBER',  group: 'privacy',  description: 'Days raw GPS pings are retained before purge' },
  { key: 'delivery.requirePodOtp',              value: true, type: 'BOOLEAN', group: 'delivery', description: 'Require recipient OTP for proof of delivery' },
  { key: 'delivery.requirePickupPhoto',         value: true, type: 'BOOLEAN', group: 'delivery', description: 'Require a package photo when marking PICKED_UP' },
  { key: 'delivery.customerCancelWindowMinutes', value: 5,   type: 'NUMBER',  group: 'delivery', description: 'Free cancellation window after booking' },
  { key: 'finance.earningsHoldHours',           value: 24,   type: 'NUMBER',  group: 'finance',  description: 'Hold before a rider earning becomes withdrawable' },
  { key: 'finance.minWithdrawalKobo',           value: 200000, type: 'NUMBER', group: 'finance', description: 'Minimum rider withdrawal (kobo) — ₦2,000' },
  { key: 'finance.maxWithdrawalPerDayKobo',     value: 5000000, type: 'NUMBER', group: 'finance', description: 'Daily rider withdrawal cap (kobo) — ₦50,000' },
  { key: 'payments.mode',                       value: 'DEVELOPMENT', type: 'STRING', group: 'payments', description: 'DEVELOPMENT | SANDBOX | LIVE' },
  { key: 'pricing.allowPromoStacking',          value: false, type: 'BOOLEAN', group: 'pricing', description: 'Whether promotions may be combined' },
] as const;

export const FAQS = [
  { question: 'How is my delivery fee calculated?', answer: 'Your fee is a base fee plus a per-kilometre charge for the distance between pickup and destination, with surcharges for express or scheduled delivery. You always see the exact breakdown before you pay.', category: 'Pricing', sortOrder: 1 },
  { question: 'How long does delivery take?', answer: 'Standard deliveries in Lagos typically complete within 90 minutes; express deliveries are prioritised. You can track your rider live once one is assigned.', category: 'Delivery', sortOrder: 2 },
  { question: 'What happens if nobody is available to receive my package?', answer: 'The rider will call the recipient. If delivery cannot be completed, the delivery is marked failed and our support team contacts you to arrange a re-delivery or return.', category: 'Delivery', sortOrder: 3 },
  { question: 'How do I get a refund?', answer: 'Open the delivery in your dashboard and report the issue, or contact support. Approved refunds are returned to your original payment method or your wallet.', category: 'Payments', sortOrder: 4 },
  { question: 'Is my package insured?', answer: 'Declare a value when booking to be eligible for our limited liability cover. Items prohibited by law cannot be carried.', category: 'Delivery', sortOrder: 5 },
] as const;
