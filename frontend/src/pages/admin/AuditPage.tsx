import { useState } from "react";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  type Column,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { adminNav } from "./nav";
import { useAuditLog, type AuditRow } from "../../hooks/useAdmin";

const TONE = (action: string) => {
  if (
    action.includes("suspend") ||
    action.includes("cancel") ||
    action.includes("reject")
  )
    return "danger" as const;
  if (action.includes("approve") || action.includes("create"))
    return "success" as const;
  if (action.includes("update") || action.includes("assign"))
    return "info" as const;
  return "neutral" as const;
};

export default function AuditPage() {
  const { hasPermission } = useAuth();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditRow | null>(null);

  const log = useAuditLog({
    action: action.trim() || undefined,
    page,
    pageSize: 25,
  });

  const columns: Column<AuditRow>[] = [
    {
      key: "when",
      header: "When",
      render: (row) => (
        <span className="text-xs text-ink-600">
          {new Date(row.createdAt).toLocaleString("en-NG", {
            dateStyle: "medium",
            timeStyle: "medium",
          })}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => <Badge tone={TONE(row.action)}>{row.action}</Badge>,
    },
    {
      key: "entity",
      header: "Entity",
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-ink-800">
          {row.entityType}
          {row.entityId && (
            <span className="ml-1 font-mono text-[11px] text-ink-400">
              {row.entityId.slice(0, 8)}…
            </span>
          )}
        </span>
      ),
    },
    {
      key: "actor",
      header: "By",
      render: (row) => (
        <div>
          <p className="text-sm text-ink-800">{row.actor}</p>
          <p className="text-xs text-ink-500">
            {row.actorEmail ?? row.actorRole ?? ""}
          </p>
        </div>
      ),
    },
    {
      key: "ip",
      header: "IP",
      hideOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs">{row.ip ?? "—"}</span>
      ),
    },
    {
      key: "detail",
      header: "",
      align: "right",
      render: (row) => (
        <button
          type="button"
          className="text-xs font-semibold text-brand-700 hover:underline"
          onClick={() => setOpen(row)}
          disabled={!row.before && !row.after}
        >
          {row.before || row.after ? "before / after" : "—"}
        </button>
      ),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Audit trail
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Append-only. Every sensitive action writes one row — who, what,
            before, after, when, from where — and there is no code path that
            edits or deletes one.
          </p>
        </div>

        <Card>
          <CardBody>
            <Field
              label="Filter by action"
              hint="e.g. delivery, pricing, suspend, approve"
              htmlFor="audit-action"
            >
              <Input
                id="audit-action"
                placeholder="delivery.assign"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </CardBody>
        </Card>

        {log.isError ? (
          <ErrorState
            title="Could not load the audit trail"
            message={(log.error as Error)?.message}
            onRetry={() => void log.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={log.data?.data}
            isLoading={log.isPending}
            emptyTitle="No audit entries match"
            emptyDescription="Actions performed by staff appear here as they happen."
            page={log.data?.meta.page}
            pageSize={log.data?.meta.pageSize}
            total={log.data?.meta.total}
            onPageChange={setPage}
          />
        )}

        <Alert tone="info" title="Why this matters">
          When somebody asks “who cancelled that delivery?” or “who changed the
          price?”, the answer is here — not in somebody's memory.
        </Alert>

        <Modal
          open={Boolean(open)}
          onClose={() => setOpen(null)}
          size="lg"
          title={open?.action ?? ""}
          description={
            open
              ? `${open.entityType} · ${new Date(open.createdAt).toLocaleString("en-NG")} · ${open.actor}`
              : ""
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Before
              </p>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-ink-950 p-3 text-[11px] leading-relaxed text-ink-100">
                {open?.before ? JSON.stringify(open.before, null, 2) : "—"}
              </pre>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                After
              </p>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-ink-950 p-3 text-[11px] leading-relaxed text-ink-100">
                {open?.after ? JSON.stringify(open.after, null, 2) : "—"}
              </pre>
            </div>
          </div>
        </Modal>
      </div>
    </PortalShell>
  );
}
