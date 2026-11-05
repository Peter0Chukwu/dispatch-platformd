import { useState } from "react";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  StatusPill,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { adminNav } from "./nav";
import {
  useAdminRider,
  useAdminRiders,
  useReviewDocument,
  useSetRiderApproval,
  type AdminRiderRow,
} from "../../hooks/useAdmin";

const AVAILABILITY_TONE: Record<
  string,
  "success" | "info" | "neutral" | "warning"
> = {
  ONLINE: "success",
  ON_DELIVERY: "info",
  OFFLINE: "neutral",
  BREAK: "neutral",
};

const APPROVAL_TONE: Record<
  string,
  "success" | "warning" | "danger" | "neutral"
> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "danger",
  SUSPENDED: "neutral",
};

type Tab = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "ALL";

export default function RidersPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>("PENDING");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const riders = useAdminRiders({
    status: tab === "ALL" ? undefined : tab,
    q: search.trim() || undefined,
    page,
    perPage: 20,
  });

  const columns: Column<AdminRiderRow>[] = [
    {
      key: "code",
      header: "Rider",
      render: (row) => (
        <span className="font-mono text-xs">{row.riderCode}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div>
          <p className="text-sm font-medium text-ink-900">{row.name}</p>
          <p className="text-xs text-ink-500">{row.phone}</p>
        </div>
      ),
    },
    {
      key: "zone",
      header: "Zone",
      hideOnMobile: true,
      render: (row) => row.zone ?? "—",
    },
    {
      key: "documents",
      header: "Documents",
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm">
          <span
            className={
              row.documents.approved === row.documents.required
                ? "text-accent-700"
                : "text-ink-800"
            }
          >
            {row.documents.approved}/{row.documents.required}
          </span>
          {row.documents.pending > 0 && (
            <span className="ml-1 text-xs text-warning-700">
              +{row.documents.pending} pending
            </span>
          )}
        </span>
      ),
    },
    {
      key: "jobs",
      header: "Completed",
      align: "right",
      hideOnMobile: true,
      render: (row) => row.completedCount,
    },
    {
      key: "availability",
      header: "Availability",
      render: (row) => (
        <StatusPill
          label={row.availability.replace(/_/g, " ").toLowerCase()}
          tone={AVAILABILITY_TONE[row.availability] ?? "neutral"}
        />
      ),
    },
    {
      key: "approval",
      header: "Approval",
      render: (row) => (
        <Badge tone={APPROVAL_TONE[row.approvalStatus] ?? "neutral"}>
          {row.approvalStatus.toLowerCase()}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(row.id)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Riders
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Onboarding queue and roster. A rider can only be approved once every
            required document is approved.
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs
            value={tab}
            onChange={(value) => {
              setTab(value);
              setPage(1);
            }}
            tabs={[
              { value: "PENDING", label: "Awaiting review" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
              { value: "SUSPENDED", label: "Suspended" },
              { value: "ALL", label: "Everyone" },
            ]}
          />
          <div className="w-64">
            <Field label="Search" htmlFor="rider-search">
              <Input
                id="rider-search"
                placeholder="name, email, phone or code"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </div>
        </div>

        {riders.isError ? (
          <ErrorState
            title="Could not load riders"
            message={(riders.error as Error)?.message}
            onRetry={() => void riders.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={riders.data?.data}
            isLoading={riders.isPending}
            emptyTitle={
              tab === "PENDING"
                ? "Nothing waiting for review"
                : "No riders in this list"
            }
            emptyDescription={
              tab === "PENDING"
                ? "New applications appear here the moment a rider signs up."
                : undefined
            }
            page={riders.data?.meta.page}
            pageSize={riders.data?.meta.pageSize}
            total={riders.data?.meta.total}
            onPageChange={setPage}
          />
        )}

        <RiderReview
          id={openId}
          onClose={() => {
            setOpenId(null);
            void riders.refetch();
          }}
        />
      </div>
    </PortalShell>
  );
}

/** One application: identity, vehicle, every document with its review buttons, and the decision. */
function RiderReview({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const detail = useAdminRider(id);
  const reviewDocument = useReviewDocument();
  const setApproval = useSetRiderApproval();

  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const rider = detail.data;

  const decideDocument = async (
    documentId: string,
    decision: "APPROVE" | "REJECT",
  ) => {
    if (!rider) return;
    if (decision === "REJECT" && note.trim().length < 3) {
      notify({
        tone: "warning",
        title: "Say why",
        description: "A rejection needs a note — the rider sees it.",
      });
      return;
    }
    try {
      await reviewDocument.mutateAsync({
        riderId: rider.id,
        documentId,
        decision,
        note: note.trim() || undefined,
      });
      notify({
        tone: "success",
        title:
          decision === "APPROVE" ? "Document approved" : "Document rejected",
      });
      setNote("");
      void detail.refetch();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not save the review",
        description: (error as Error).message,
      });
    }
  };

  const decideRider = async (decision: "APPROVE" | "REJECT" | "SUSPEND") => {
    if (!rider) return;
    try {
      await setApproval.mutateAsync({
        riderId: rider.id,
        decision,
        reason: note.trim() || undefined,
      });
      notify({
        tone: "success",
        title:
          decision === "APPROVE"
            ? "Rider approved"
            : decision === "REJECT"
              ? "Application rejected"
              : "Rider suspended",
      });
      setRejecting(false);
      setNote("");
      void detail.refetch();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not update the rider",
        description: (error as Error).message,
      });
    }
  };

  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      size="lg"
      title={
        rider
          ? `${rider.riderCode} · ${rider.user.firstName} ${rider.user.lastName}`
          : "Loading application…"
      }
      description={
        rider
          ? `${rider.user.email} · ${rider.user.phone} · ${rider.branch ?? "—"}`
          : undefined
      }
      footer={
        rider ? (
          <div className="flex flex-wrap justify-end gap-2">
            {hasPermission("rider:approve") && (
              <>
                {rider.approvalStatus !== "APPROVED" && (
                  <Button
                    variant="accent"
                    disabled={!rider.canApprove}
                    isLoading={setApproval.isPending}
                    onClick={() => void decideRider("APPROVE")}
                  >
                    Approve rider
                  </Button>
                )}
                {rider.approvalStatus === "APPROVED" && (
                  <Button
                    variant="danger"
                    isLoading={setApproval.isPending}
                    onClick={() => void decideRider("SUSPEND")}
                  >
                    Suspend
                  </Button>
                )}
                {rider.approvalStatus !== "APPROVED" && (
                  <Button
                    variant="secondary"
                    onClick={() => setRejecting((value) => !value)}
                  >
                    Reject…
                  </Button>
                )}
              </>
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
          title="Could not load this rider"
          message={(detail.error as Error)?.message}
          onRetry={() => void detail.refetch()}
        />
      ) : !rider ? (
        <p className="py-8 text-center text-sm text-ink-500">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Approval
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                {rider.approvalStatus}
              </p>
              {rider.approvedAt && (
                <p className="text-xs text-ink-500">
                  approved{" "}
                  {new Date(rider.approvedAt).toLocaleDateString("en-NG")}
                </p>
              )}
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Contact verified
              </p>
              <p className="mt-1 text-sm text-ink-900">
                email {rider.user.emailVerified ? "✓" : "✗"} · phone{" "}
                {rider.user.phoneVerified ? "✓" : "✗"}
              </p>
              <p className="text-xs text-ink-500">
                account {rider.user.status.toLowerCase()}
              </p>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Vehicle
              </p>
              <p className="mt-1 text-sm text-ink-900">
                {rider.vehicles[0]
                  ? `${rider.vehicles[0].type.replace(/_/g, " ").toLowerCase()}`
                  : "none on file"}
              </p>
              <p className="text-xs text-ink-500">
                {rider.vehicles[0]?.registrationNumber}
              </p>
            </div>
          </div>

          {!rider.canApprove && rider.missingDocuments.length > 0 && (
            <Alert tone="warning" title="Not ready to approve">
              These documents are still not approved:{" "}
              {rider.missingDocuments
                .join(", ")
                .replace(/_/g, " ")
                .toLowerCase()}
              . The API refuses approval until every one is in order.
            </Alert>
          )}

          <div>
            <h3 className="text-sm font-semibold text-ink-900">Documents</h3>
            <ul className="mt-2 space-y-2">
              {rider.documents.map((document) => (
                <li
                  key={document.id}
                  className="rounded-xl border border-ink-200 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-ink-900">
                        {document.type.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-ink-500">
                        {document.mimeType} ·{" "}
                        {(document.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                        {new Date(document.uploadedAt).toLocaleDateString(
                          "en-NG",
                        )}
                      </p>
                      {document.reviewNote && (
                        <p className="mt-1 text-xs text-danger-700">
                          “{document.reviewNote}”
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          document.status === "APPROVED"
                            ? "success"
                            : document.status === "REJECTED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {document.status.toLowerCase()}
                      </Badge>
                      {hasPermission("rider:approve") && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            isLoading={reviewDocument.isPending}
                            onClick={() =>
                              void decideDocument(document.id, "APPROVE")
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void decideDocument(document.id, "REJECT")
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {rider.documents.length === 0 && (
                <li className="text-sm text-ink-500">Nothing uploaded yet.</li>
              )}
            </ul>
          </div>

          {(rejecting || note.length > 0 || hasPermission("rider:approve")) && (
            <Field
              label="Review note"
              hint="Required when rejecting a document or a rider. The rider sees this text."
              htmlFor="review-note"
            >
              <Textarea
                id="review-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. the licence photo is unreadable — please re-upload"
              />
            </Field>
          )}

          {rejecting && (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRejecting(false)}
              >
                Never mind
              </Button>
              <Button
                size="sm"
                variant="danger"
                isLoading={setApproval.isPending}
                onClick={() => void decideRider("REJECT")}
              >
                Reject application
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
