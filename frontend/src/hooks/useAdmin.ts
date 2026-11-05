import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../lib/api";

/* ─────────────────────────── response shapes ─────────────────────────── */

export interface AdminMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paged<T> {
  data: T[];
  meta: AdminMeta;
}

export interface DashboardOverview {
  range: { from: string; to: string };
  deliveries: {
    total: number;
    delivered: number;
    failed: number;
    cancelled: number;
    active: number;
    awaitingAssignment: number;
    successRate: number | null;
    avgDeliveryMinutes: number | null;
    byStatus: Record<string, number>;
  };
  money: {
    grossKobo: string;
    grossFormatted: string;
    discountKobo: string;
    commissionKobo: string;
    commissionFormatted: string;
    riderNetKobo: string;
    riderNetFormatted: string;
    averageOrderFormatted: string;
    marginKobo: string;
    marginFormatted: string;
    earningRows: number;
  };
  riders: {
    total: number;
    online: number;
    onDelivery: number;
    offline: number;
    pendingDocuments: number;
  };
  customers: { total: number };
  fleet: { avgDistanceKm: number | null; openAlerts: number };
  zones: Array<{
    zone: string;
    delivered: number;
    revenueKobo: string;
    revenueFormatted: string;
  }>;
  daily: Array<{
    date: string;
    deliveries: number;
    delivered: number;
    revenueKobo: string;
  }>;
  recent: Array<{
    id: string;
    reference: string;
    status: string;
    chargeKobo: string;
    chargeFormatted: string;
    customer: string;
    riderCode: string | null;
    pickup: string;
    destination: string;
    createdAt: string;
  }>;
}

export interface AdminDeliveryRow {
  id: string;
  reference: string;
  status: string;
  deliveryType: string;
  chargeKobo: string;
  chargeFormatted: string;
  customer: string;
  customerPhone: string | null;
  rider: { id: string; code: string; name: string } | null;
  pickup: string;
  destination: string;
  recipientName: string;
  zone: string | null;
  distanceKm: number | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface AdminDeliveryDetail {
  id: string;
  reference: string;
  status: string;
  deliveryType: string;
  paymentStatus: string;
  chargeKobo: string;
  chargeFormatted: string;
  pickup: {
    address: string;
    landmark: string | null;
    lat: number;
    lng: number;
  };
  destination: {
    address: string;
    landmark: string | null;
    lat: number;
    lng: number;
  };
  recipient: { name: string; phone: string };
  package: {
    category: string;
    description: string;
    weightKg: number | null;
    isFragile: boolean;
    instructions: string | null;
  };
  zone: string | null;
  distanceKm: number | null;
  priceSnapshot: unknown;
  commissionSnapshot: unknown;
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    accountStatus: string;
  } | null;
  rider: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    availability: string;
  } | null;
  assignments: Array<{
    id: string;
    riderCode: string;
    riderName: string;
    status: string;
    method: string;
    rank: number | null;
    offeredAt: string | null;
    expiresAt: string | null;
    respondedAt: string | null;
    rejectionReason: string | null;
  }>;
  timeline: Array<{
    status: string;
    from: string | null;
    at: string;
    reason: string | null;
    by: string;
  }>;
  proof: {
    type: string;
    fileKey: string;
    recipientName: string | null;
    otpVerifiedAt: string | null;
    capturedAt: string | null;
  } | null;
  createdAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface AdminCustomerRow {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountStatus: string;
  deliveries: number;
  delivered: number;
  spendKobo: string;
  spendFormatted: string;
  joinedAt: string;
}

export interface AdminStaffRow {
  id: string;
  staffCode: string;
  name: string;
  email: string | null;
  accountStatus: string;
  isSuperAdmin: boolean;
  branch: string;
  roles: Array<{ key: string; name: string }>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminRole {
  key: string;
  name: string;
  description: string | null;
  staffCount: number;
  permissions: string[];
}

export interface AdminRiderRow {
  id: string;
  riderCode: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountStatus: string;
  approvalStatus: string;
  availability: string;
  branch: string | null;
  zone: string | null;
  vehicle: {
    type: string;
    registrationNumber: string;
    isVerified: boolean;
  } | null;
  completedCount: number;
  rating: { average: number | null; count: number };
  documents: {
    approved: number;
    pending: number;
    rejected: number;
    required: number;
  };
  createdAt: string;
}

export interface AdminRiderDetail {
  id: string;
  riderCode: string;
  approvalStatus: string;
  availability: string;
  rejectionReason: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  reviewer: { name: string } | null;
  user: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  branch: string | null;
  zone: string | null;
  vehicles: Array<{
    type: string;
    registrationNumber: string;
    isVerified: boolean;
  }>;
  documents: Array<{
    id: string;
    type: string;
    status: string;
    mimeType: string;
    sizeBytes: number;
    fileKey: string;
    reviewNote: string | null;
    reviewedAt: string | null;
    uploadedAt: string;
    expiresAt: string | null;
  }>;
  requiredDocuments: string[];
  missingDocuments: string[];
  canApprove: boolean;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  actor: string;
  actorEmail: string | null;
  ip: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface PricingOverview {
  rules: Array<{
    id: string;
    name: string;
    version: number;
    isActive: boolean;
    scopeOf: string;
    effectiveFrom: string;
    baseFeeKobo: string;
    baseFeeFormatted: string;
    perKmFeeKobo: string;
    perKmFeeFormatted: string;
    minFeeKobo: string;
    minFeeFormatted: string;
    freeKmIncluded: number;
    expressSurchargeKobo: string;
    scheduledSurchargeKobo: string;
    sameDaySurchargeKobo: string;
    additionalStopFeeKobo: string;
    defaultCommissionPct: number;
    roundToKobo: number;
    createdBy: string | null;
    updatedAt: string;
  }>;
  zones: Array<{
    id: string;
    name: string;
    code: string;
    centerLat: number | null;
    centerLng: number | null;
    radiusKm: number | null;
    isActive: boolean;
    deliveries: number;
  }>;
}

/* ───────────────────────────── queries ───────────────────────────── */

const asRange = (range?: { from?: string; to?: string }) => {
  const params = new URLSearchParams();
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  const query = params.toString();
  return query ? `?${query}` : "";
};

export function useAdminDashboard(range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["admin", "dashboard", range?.from ?? null, range?.to ?? null],
    queryFn: () =>
      api.get<DashboardOverview>(`/admin/dashboard${asRange(range)}`),
  });
}

export function useAdminDeliveries(filters: {
  status?: string;
  q?: string;
  riderId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.riderId) params.set("riderId", filters.riderId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  return useQuery({
    queryKey: ["admin", "deliveries", params.toString()],
    queryFn: () =>
      api.get<Paged<AdminDeliveryRow>>(
        `/admin/deliveries?${params.toString()}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAdminDelivery(id: string | null) {
  return useQuery({
    queryKey: ["admin", "delivery", id],
    queryFn: () => api.get<AdminDeliveryDetail>(`/admin/deliveries/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminRiders(filters: {
  status?: string;
  q?: string;
  page: number;
  perPage: number;
}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  params.set("page", String(filters.page));
  params.set("perPage", String(filters.perPage));

  return useQuery({
    queryKey: ["admin", "riders", params.toString()],
    queryFn: () =>
      api.get<Paged<AdminRiderRow>>(`/admin/riders?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdminRider(id: string | null) {
  return useQuery({
    queryKey: ["admin", "rider", id],
    queryFn: () => api.get<AdminRiderDetail>(`/admin/riders/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminCustomers(filters: {
  q?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  return useQuery({
    queryKey: ["admin", "customers", params.toString()],
    queryFn: () =>
      api.get<Paged<AdminCustomerRow>>(`/admin/customers?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdminTeam(filters: {
  q?: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  return useQuery({
    queryKey: ["admin", "team", params.toString()],
    queryFn: () =>
      api.get<Paged<AdminStaffRow>>(`/admin/team?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => api.get<AdminRole[]>("/admin/roles"),
  });
}

export function usePricing() {
  return useQuery({
    queryKey: ["admin", "pricing"],
    queryFn: () => api.get<PricingOverview>("/admin/pricing"),
  });
}

export function useAuditLog(filters: {
  action?: string;
  entityType?: string;
  page: number;
  pageSize: number;
}) {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  return useQuery({
    queryKey: ["admin", "audit", params.toString()],
    queryFn: () =>
      api.get<Paged<AuditRow>>(`/admin/audit-logs?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

/** Riders available to take a manual assignment. */
export function useAssignableRiders() {
  return useQuery({
    queryKey: ["admin", "riders", "assignable"],
    queryFn: () =>
      api.get<Paged<AdminRiderRow>>(
        "/admin/riders?status=APPROVED&perPage=100",
      ),
  });
}

/* ───────────────────────────── mutations ───────────────────────────── */

/**
 * Every write invalidates the queries it can affect — the dashboard especially,
 * since a single assignment changes five cards on it.
 */
function useAdminMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

export function useAssignDelivery() {
  return useAdminMutation(
    (input: { deliveryId: string; riderId: string; reason?: string }) =>
      api.post<{ status: string }>(
        `/admin/deliveries/${input.deliveryId}/assign`,
        {
          riderId: input.riderId,
          reason: input.reason,
        },
      ),
  );
}

export function useCancelDelivery() {
  return useAdminMutation((input: { deliveryId: string; reason: string }) =>
    api.post<{ status: string }>(
      `/admin/deliveries/${input.deliveryId}/cancel`,
      { reason: input.reason },
    ),
  );
}

export function useSetCustomerStatus() {
  return useAdminMutation(
    (input: {
      customerId: string;
      status: "ACTIVE" | "SUSPENDED";
      reason?: string;
    }) =>
      api.post<{ accountStatus: string; sessionsRevoked: number }>(
        `/admin/customers/${input.customerId}/status`,
        {
          status: input.status,
          reason: input.reason,
        },
      ),
  );
}

export function useCreateStaff() {
  return useAdminMutation(
    (input: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      password: string;
      roleKeys: string[];
      jobTitle?: string;
    }) =>
      api.post<{ id: string; staffCode: string; email: string }>(
        "/admin/team",
        input,
      ),
  );
}

export function useSetStaffStatus() {
  return useAdminMutation(
    (input: {
      staffId: string;
      status: "ACTIVE" | "SUSPENDED";
      reason?: string;
    }) =>
      api.post<{ accountStatus: string; sessionsRevoked: number }>(
        `/admin/team/${input.staffId}/status`,
        {
          status: input.status,
          reason: input.reason,
        },
      ),
  );
}

export function useUpdatePricingRule() {
  return useAdminMutation(
    (input: { ruleId: string; changes: Record<string, number | boolean> }) =>
      api.post<{ baseFeeFormatted: string; note: string }>(
        `/admin/pricing/rules/${input.ruleId}`,
        input.changes,
      ),
  );
}

export function useReviewDocument() {
  return useAdminMutation(
    (input: {
      riderId: string;
      documentId: string;
      decision: "APPROVE" | "REJECT";
      note?: string;
    }) =>
      api.post(
        `/admin/riders/${input.riderId}/documents/${input.documentId}/review`,
        {
          decision: input.decision,
          note: input.note,
        },
      ),
  );
}

export function useSetRiderApproval() {
  return useAdminMutation(
    (input: {
      riderId: string;
      decision: "APPROVE" | "REJECT" | "SUSPEND";
      reason?: string;
    }) =>
      api.post(`/admin/riders/${input.riderId}/approval`, {
        decision: input.decision,
        reason: input.reason,
      }),
  );
}
