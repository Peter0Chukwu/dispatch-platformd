import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  StatusPill,
  Textarea,
  useToast,
  type Column,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { adminNav } from "./nav";
import {
  useAdminDeliveries,
  useAssignDelivery,
  useAssignableRiders,
  useCancelDelivery,
  useAdminDelivery,
  type AdminDeliveryRow,
} from "../../hooks/useAdmin";
import { downloadFile } from "../../lib/download";
import { LIVE_EVENTS, useLiveEvent } from "../../lib/live";

const STATUSES = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "ARRIVED_AT_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "ARRIVED_AT_DESTINATION",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;

const TONE: Record<
  string,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  PENDING: "warning",
  ASSIGNED: "info",
  ACCEPTED: "info",
  ARRIVED_AT_PICKUP: "info",
  PICKED_UP: "info",
  IN_TRANSIT: "info",
  ARRIVED_AT_DESTINATION: "info",
  DELIVERED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

const FINISHED = ["DELIVERED", "FAILED", "CANCELLED"];

export default function DeliveriesPage() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const queryClient = useQueryClient();

  /**
   * The dispatch board is the fallback for when automation cannot finish a job, so it
   * has to be current: every delivery event refreshes the list, and an exhausted
   * search raises a toast that points the dispatcher at the manual assignment flow.
   */
  useLiveEvent(
    LIVE_EVENTS.DELIVERY_NEW,
    useCallback(() => void queryClient.invalidateQueries({ queryKey: ["admin", "deliveries"] }), [queryClient]),
  );
  useLiveEvent(
    LIVE_EVENTS.DELIVERY_UPDATED,
    useCallback(() => void queryClient.invalidateQueries({ queryKey: ["admin", "deliveries"] }), [queryClient]),
  );
  useLiveEvent(
    LIVE_EVENTS.DISPATCH_EXHAUSTED,
    useCallback(
      (payload: unknown) => {
        const info = payload as { reference?: string; rounds?: number };
        void queryClient.invalidateQueries({ queryKey: ["admin", "deliveries"] });
        notify({
          tone: "warning",
          title: "No rider found automatically",
          description: `${info.reference ?? "A delivery"} went through ${info.rounds ?? "several"} rounds. Assign a rider by hand.`,
        });
      },
      [notify, queryClient],
    ),
  );

  const deliveries = useAdminDeliveries({
    status: status || undefined,
    q: search.trim() || undefined,
    page,
    pageSize: 20,
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search.trim()) params.set("q", search.trim());
      const rows = await downloadFile(
        `/admin/deliveries/export.csv${params.toString() ? `?${params.toString()}` : ""}`,
        "deliveries.csv",
      );
      notify({
        tone: "success",
        title: `Exported ${rows} row${rows === 1 ? "" : "s"}`,
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Export failed",
        description: (error as Error).message,
      });
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AdminDeliveryRow>[] = [
    {
      key: "reference",
      header: "Reference",
      render: (row) => (
        <span className="font-mono text-xs">{row.reference}</span>
      ),
    },
    {
      key: "route",
      header: "Route",
      render: (row) => (
        <div className="max-w-[280px]">
          <p className="truncate text-sm text-ink-800">{row.pickup}</p>
          <p className="truncate text-xs text-ink-500">→ {row.destination}</p>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      hideOnMobile: true,
      render: (row) => (
        <div>
          <p className="text-sm text-ink-800">{row.customer}</p>
          <p className="text-xs text-ink-500">{row.customerPhone}</p>
        </div>
      ),
    },
    {
      key: "rider",
      header: "Rider",
      hideOnMobile: true,
      render: (row) =>
        row.rider ? (
          <div>
            <span className="font-mono text-xs text-ink-800">
              {row.rider.code}
            </span>
            <p className="text-xs text-ink-500">{row.rider.name}</p>
          </div>
        ) : (
          <Badge tone="warning">unassigned</Badge>
        ),
    },
    {
      key: "charge",
      header: "Charge",
      align: "right",
      render: (row) => row.chargeFormatted,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusPill
          label={row.status.replace(/_/g, " ")}
          tone={TONE[row.status] ?? "neutral"}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">
              Deliveries
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Every job in the system. Search by reference, customer, address or
              rider code.
            </p>
          </div>
          {hasPermission("delivery:export") && (
            <Button
              variant="secondary"
              isLoading={exporting}
              onClick={() => void exportCsv()}
            >
              Export CSV
            </Button>
          )}
        </div>

        <Card>
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <Field label="Search" htmlFor="delivery-search">
                <Input
                  id="delivery-search"
                  placeholder="DSP-… / customer name / address"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <Select
                label="Status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "All statuses" },
                  ...STATUSES.map((value) => ({
                    value,
                    label: value.replace(/_/g, " "),
                  })),
                ]}
              />
            </div>
          </CardBody>
        </Card>

        {deliveries.isError ? (
          <ErrorState
            title="Could not load deliveries"
            message={(deliveries.error as Error)?.message}
            onRetry={() => void deliveries.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={deliveries.data?.data}
            isLoading={deliveries.isPending}
            emptyTitle="No deliveries match"
            emptyDescription="Try clearing the filters."
            page={deliveries.data?.meta.page}
            pageSize={deliveries.data?.meta.pageSize}
            total={deliveries.data?.meta.total}
            onPageChange={setPage}
          />
        )}

        <DeliveryDrawer id={openId} onClose={() => setOpenId(null)} />
      </div>
    </PortalShell>
  );
}

/**
 * One delivery in full, with the two overrides a dispatcher actually needs:
 * put a rider on it, or cancel it. Both require a reason and both are audited.
 */
function DeliveryDrawer({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const detail = useAdminDelivery(id);
  const riders = useAssignableRiders();
  const assign = useAssignDelivery();
  const cancel = useCancelDelivery();

  const [riderId, setRiderId] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"assign" | "cancel" | null>(null);

  const delivery = detail.data;
  const finished = delivery ? FINISHED.includes(delivery.status) : false;

  const reset = () => {
    setMode(null);
    setRiderId("");
    setReason("");
  };

  const submit = async () => {
    if (!delivery) return;
    try {
      if (mode === "assign") {
        await assign.mutateAsync({
          deliveryId: delivery.id,
          riderId,
          reason: reason.trim() || undefined,
        });
        notify({
          tone: "success",
          title: "Rider assigned",
          description: "The commission split is now frozen to that rider.",
        });
      } else if (mode === "cancel") {
        await cancel.mutateAsync({
          deliveryId: delivery.id,
          reason: reason.trim(),
        });
        notify({ tone: "success", title: "Delivery cancelled" });
      }
      reset();
      void detail.refetch();
    } catch (error) {
      notify({
        tone: "error",
        title: mode === "assign" ? "Could not assign" : "Could not cancel",
        description: (error as Error).message,
      });
    }
  };

  return (
    <Modal
      open={Boolean(id)}
      onClose={() => {
        reset();
        onClose();
      }}
      title={delivery ? `Delivery ${delivery.reference}` : "Loading delivery…"}
      description={
        delivery
          ? `${delivery.status.replace(/_/g, " ")} · ${delivery.chargeFormatted}`
          : undefined
      }
      size="lg"
      footer={
        delivery ? (
          <div className="flex flex-wrap justify-end gap-2">
            {hasPermission("delivery:assign") && !finished && (
              <Button
                variant={mode === "assign" ? "primary" : "secondary"}
                onClick={() => setMode("assign")}
              >
                {delivery.rider ? "Reassign rider" : "Assign a rider"}
              </Button>
            )}
            {hasPermission("delivery:cancel") && !finished && (
              <Button
                variant={mode === "cancel" ? "danger" : "secondary"}
                onClick={() => setMode("cancel")}
              >
                Cancel delivery
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null
      }
    >
      {detail.isError ? (
        <ErrorState
          title="Could not load this delivery"
          message={(detail.error as Error)?.message}
          onRetry={() => void detail.refetch()}
        />
      ) : !delivery ? (
        <p className="py-8 text-center text-sm text-ink-500">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Pickup
              </p>
              <p className="mt-1 text-sm text-ink-800">
                {delivery.pickup.address}
              </p>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Destination
              </p>
              <p className="mt-1 text-sm text-ink-800">
                {delivery.destination.address}
              </p>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Customer
              </p>
              <p className="mt-1 text-sm text-ink-800">
                {delivery.customer?.name ?? "—"}
              </p>
              <p className="text-xs text-ink-500">{delivery.customer?.phone}</p>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Recipient
              </p>
              <p className="mt-1 text-sm text-ink-800">
                {delivery.recipient.name}
              </p>
              <p className="text-xs text-ink-500">{delivery.recipient.phone}</p>
            </div>
          </div>

          {mode && (
            <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3.5">
              {mode === "assign" ? (
                <>
                  <Select
                    label="Rider"
                    value={riderId}
                    onChange={(event) => setRiderId(event.target.value)}
                    options={[
                      { value: "", label: "Choose an approved rider" },
                      ...(riders.data?.data ?? []).map((rider) => ({
                        value: rider.id,
                        label: `${rider.riderCode} · ${rider.name} (${rider.availability.replace(/_/g, " ").toLowerCase()})`,
                      })),
                    ]}
                    hint="Only approved riders are shown. A rider who is already carrying their maximum number of jobs cannot be assigned another."
                  />
                  <Field label="Why (optional)" htmlFor="assign-reason">
                    <Input
                      id="assign-reason"
                      placeholder="e.g. nobody accepted the offer in time"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <Field label="Reason (required)" htmlFor="cancel-reason">
                  <Textarea
                    id="cancel-reason"
                    rows={2}
                    placeholder="e.g. customer called to cancel"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset}>
                  Never mind
                </Button>
                <Button
                  size="sm"
                  variant={mode === "cancel" ? "danger" : "primary"}
                  isLoading={assign.isPending || cancel.isPending}
                  disabled={
                    mode === "assign" ? !riderId : reason.trim().length < 5
                  }
                  onClick={() => void submit()}
                >
                  {mode === "assign" ? "Assign" : "Cancel delivery"}
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Timeline</h3>
              <ol className="mt-2 space-y-2 border-l border-ink-200 pl-3">
                {delivery.timeline.length === 0 && (
                  <li className="text-sm text-ink-500">
                    No status changes yet.
                  </li>
                )}
                {delivery.timeline.map((entry, index) => (
                  <li key={`${entry.status}-${index}`} className="relative">
                    <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-brand-600" />
                    <p className="text-sm font-medium text-ink-800">
                      {entry.status.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-ink-500">
                      {new Date(entry.at).toLocaleString("en-NG")} ·{" "}
                      {entry.by.toLowerCase()}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-900">
                Assignment attempts
              </h3>
              <ul className="mt-2 space-y-2">
                {delivery.assignments.length === 0 && (
                  <li className="text-sm text-ink-500">
                    No rider has been offered this job.
                  </li>
                )}
                {delivery.assignments.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="rounded-lg border border-ink-200 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-ink-800">
                        {attempt.riderCode}
                      </span>
                      <Badge
                        tone={
                          attempt.status === "REJECTED"
                            ? "danger"
                            : attempt.status === "ACCEPTED"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {attempt.status.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {attempt.method.toLowerCase()} · offered{" "}
                      {attempt.offeredAt
                        ? new Date(attempt.offeredAt).toLocaleTimeString(
                            "en-NG",
                          )
                        : "—"}
                      {attempt.rejectionReason
                        ? ` · ${attempt.rejectionReason}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {delivery.proof && (
            <Alert tone="success" title="Proof of delivery captured">
              Signed for by {delivery.proof.recipientName ?? "the recipient"} at{" "}
              {delivery.proof.capturedAt
                ? new Date(delivery.proof.capturedAt).toLocaleString("en-NG")
                : "—"}
              .
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}
