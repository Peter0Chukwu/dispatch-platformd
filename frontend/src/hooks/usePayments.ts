import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/* ─────────────────────────────── types ─────────────────────────────────── */

export type PayProvider = 'PAYSTACK' | 'FLUTTERWAVE';

export interface PaymentConfig {
  mode: 'DEVELOPMENT' | 'SANDBOX' | 'LIVE';
  simulated: boolean;
  providers: Array<{ key: PayProvider; label: string; enabled: boolean; publicKey: string | null }>;
  walletEnabled: boolean;
}

export interface PaymentRecord {
  id: string;
  deliveryId: string | null;
  provider: string;
  reference: string;
  providerTransactionId: string | null;
  amountKobo: string;
  amountFormatted: string;
  feeKobo: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'REFUNDED';
  channel: string | null;
  authorizationUrl: string | null;
  paidAt: string | null;
  createdAt: string | null;
  simulated: boolean;
}

export interface WalletView {
  id: string;
  type: string;
  currency: string;
  balanceKobo: string;
  balanceFormatted: string;
  isActive: boolean;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  direction: 'CREDIT' | 'DEBIT';
  category: string;
  amountKobo: string;
  amountFormatted: string;
  balanceAfterKobo: string;
  balanceAfterFormatted: string;
  reference: string;
  description: string | null;
  deliveryId: string | null;
  createdAt: string;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface WithdrawalRecord {
  id: string;
  riderId: string;
  amountKobo: string;
  amountFormatted: string;
  netFormatted: string;
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'FAILED';
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  providerTransferRef: string | null;
  decisionNote: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  rider?: { id: string; riderCode: string; name: string; phone: string };
}

export interface RiderWithdrawalList extends Paged<WithdrawalRecord> {
  withdrawable: {
    availableKobo: string;
    adjustmentsKobo: string;
    inFlightKobo: string;
    withdrawableKobo: string;
  };
}

export interface FinanceSummary {
  period: { from: string | null; to: string | null };
  collected: {
    payments: number;
    amountKobo: string;
    amountFormatted: string;
    gatewayFeesKobo: string;
    gatewayFeesFormatted: string;
  };
  revenue: { deliveryKobo: string; surchargeKobo: string; totalFormatted: string };
  refunds: { count: number; amountKobo: string; amountFormatted: string };
  riders: {
    grossKobo: string;
    commissionKobo: string;
    netKobo: string;
    netFormatted: string;
    paidOutKobo: string;
    paidOutFormatted: string;
    pendingWithdrawals: number;
    pendingValueKobo: string;
    pendingValueFormatted: string;
  };
  walletLiability: { balanceKobo: string; balanceFormatted: string };
  net: { kobo: string; formatted: string; margin: number };
  byProvider: Array<{ provider: string; count: number; amountKobo: string; amountFormatted: string }>;
}

export interface AdminPayment {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amountKobo: string;
  amountFormatted: string;
  feeKobo: string;
  purpose: 'DELIVERY' | 'WALLET_TOPUP';
  delivery: { id: string; reference: string } | null;
  customer: string;
  customerEmail: string;
  paidAt: string | null;
  createdAt: string;
}

export interface ReconciliationCheck {
  name: string;
  ok: boolean;
  detail: string;
  offenders?: string[];
}

export interface Reconciliation {
  trialBalanceBalanced: boolean;
  totals: { debitsKobo: string; creditsKobo: string };
  checks: ReconciliationCheck[];
  accounts: Array<{
    code: string;
    name: string;
    type: string;
    normalBalance: string;
    debitKobo: string;
    creditKobo: string;
    balanceKobo: string;
  }>;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  paymentReference: string;
  amountKobo: string;
  amountFormatted: string;
  reason: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  note: string | null;
  providerRefundId: string | null;
  createdAt: string;
  completedAt: string | null;
  payment?: {
    provider: string;
    amountKobo: string;
    amountFormatted: string;
    delivery: { id: string; reference: string } | null;
  };
}

export interface AdminWithdrawalList extends Paged<WithdrawalRecord> {
  summary: {
    requested: number;
    approved: number;
    processing: number;
    paid: number;
    rejected: number;
    pendingValueKobo: string;
  };
}

/* ───────────────────────────── customer hooks ──────────────────────────── */

export function usePaymentConfig() {
  return useQuery({
    queryKey: ['payments', 'config'],
    queryFn: () => api.get<PaymentConfig>('/payments/config'),
    staleTime: 5 * 60_000,
  });
}

export function useWallet() {
  return useQuery({ queryKey: ['wallet'], queryFn: () => api.get<WalletView>('/wallet') });
}

export function useWalletTransactions(page = 1) {
  return useQuery({
    queryKey: ['wallet', 'transactions', page],
    queryFn: () => api.get<Paged<WalletTransaction>>(`/wallet/transactions?page=${page}`),
    placeholderData: keepPreviousData,
  });
}

export function useMyPayments(page = 1) {
  return useQuery({
    queryKey: ['payments', 'mine', page],
    queryFn: () => api.get<Paged<PaymentRecord & { purpose: string }>>(`/payments?page=${page}`),
    placeholderData: keepPreviousData,
  });
}

/**
 * After any money movement the cached wallet, delivery, payments list and finance
 * numbers are all stale. Invalidating them together is what keeps the app from
 * showing a balance that the ledger has already moved past.
 */
function invalidateMoney(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of [['wallet'], ['payments'], ['delivery'], ['deliveries'], ['finance'], ['rider', 'withdrawals']]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export function useInitializeDeliveryPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deliveryId, provider }: { deliveryId: string; provider: PayProvider }) =>
      api.post<PaymentRecord>(`/payments/deliveries/${deliveryId}/initialize`, { provider }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

export function usePayDeliveryWithWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api.post<{ payment: PaymentRecord; walletBalanceFormatted: string }>(
        `/payments/deliveries/${deliveryId}/pay-with-wallet`,
      ),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

/** DEVELOPMENT mode only: stands in for the gateway's confirmation. */
export function useSimulatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) =>
      api.post<{ alreadySettled: boolean; payment: PaymentRecord }>(`/payments/${reference}/simulate`),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

export function useVerifyPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) => api.post<PaymentRecord>(`/payments/${reference}/verify`),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

export function useTopUpWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ amountKobo, provider }: { amountKobo: string; provider: PayProvider }) =>
      api.post<PaymentRecord>('/payments/wallet/topups', { amountKobo, provider }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

/* ───────────────────────────── rider hooks ─────────────────────────────── */

export function useMyWithdrawals(page = 1) {
  return useQuery({
    queryKey: ['rider', 'withdrawals', page],
    queryFn: () => api.get<RiderWithdrawalList>(`/rider/withdrawals?page=${page}`),
    placeholderData: keepPreviousData,
  });
}

export interface WithdrawalInput {
  amountKobo: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  idempotencyKey: string;
}

export function useRequestWithdrawal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WithdrawalInput) => api.post<WithdrawalRecord>('/rider/withdrawals', input),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

/* ───────────────────────────── admin hooks ─────────────────────────────── */

export function useFinanceSummary(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => api.get<FinanceSummary>('/admin/finance/summary'),
    enabled,
  });
}

export function useAdminPayments(page = 1, status?: string) {
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  return useQuery({
    queryKey: ['finance', 'payments', page, status ?? 'all'],
    queryFn: () => api.get<Paged<AdminPayment>>(`/admin/finance/payments?${query.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useReconciliation(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'reconciliation'],
    queryFn: () => api.get<Reconciliation>('/admin/finance/reconciliation'),
    enabled,
  });
}

export function useAdminRefunds(page = 1) {
  return useQuery({
    queryKey: ['finance', 'refunds', page],
    queryFn: () => api.get<Paged<RefundRecord>>(`/admin/finance/refunds?page=${page}`),
    placeholderData: keepPreviousData,
  });
}

export function useCreateRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, amountKobo, reason }: { paymentId: string; amountKobo: string; reason: string }) =>
      api.post<RefundRecord>(`/admin/finance/payments/${paymentId}/refunds`, { amountKobo, reason }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

export function useAdminWithdrawals(status: string | undefined, page = 1) {
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set('status', status);
  return useQuery({
    queryKey: ['finance', 'withdrawals', status ?? 'all', page],
    queryFn: () => api.get<AdminWithdrawalList>(`/admin/finance/withdrawals?${query.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useWithdrawalDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note?: string }) =>
      api.post<WithdrawalRecord>(`/admin/finance/withdrawals/${id}/${action}`, { note }),
    onSuccess: () => invalidateMoney(queryClient),
  });
}

export function usePayWithdrawal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<WithdrawalRecord>(`/admin/finance/withdrawals/${id}/payout`),
    onSuccess: () => invalidateMoney(queryClient),
  });
}
