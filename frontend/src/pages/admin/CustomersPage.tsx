import { useState } from "react";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Modal,
  DataTable,
  ErrorState,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
  type Column,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { adminNav } from "./nav";
import {
  useAdminCustomers,
  useSetCustomerStatus,
  type AdminCustomerRow,
} from "../../hooks/useAdmin";

export default function CustomersPage() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminCustomerRow | null>(null);
  const [reason, setReason] = useState("");

  const customers = useAdminCustomers({
    q: search.trim() || undefined,
    status: status || undefined,
    page,
    pageSize: 20,
  });

  const setCustomerStatus = useSetCustomerStatus();

  const confirm = async () => {
    if (!target) return;
    const next = target.accountStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      const result = await setCustomerStatus.mutateAsync({
        customerId: target.id,
        status: next,
        reason: reason.trim() || undefined,
      });
      notify({
        tone: "success",
        title:
          next === "SUSPENDED" ? "Customer suspended" : "Customer reactivated",
        description:
          next === "SUSPENDED"
            ? `${result.sessionsRevoked} live session(s) were revoked, so they are signed out immediately.`
            : "They can sign in again straight away.",
      });
      setTarget(null);
      setReason("");
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not update this customer",
        description: (error as Error).message,
      });
    }
  };

  const columns: Column<AdminCustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
      render: (row) => (
        <div>
          <p className="text-sm font-medium text-ink-900">{row.name}</p>
          <p className="text-xs text-ink-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      hideOnMobile: true,
      render: (row) => row.phone ?? "—",
    },
    {
      key: "deliveries",
      header: "Booked",
      align: "right",
      render: (row) => row.deliveries,
    },
    {
      key: "delivered",
      header: "Delivered",
      align: "right",
      hideOnMobile: true,
      render: (row) => row.delivered,
    },
    {
      key: "spend",
      header: "Lifetime spend",
      align: "right",
      render: (row) => row.spendFormatted,
    },
    {
      key: "joined",
      header: "Joined",
      hideOnMobile: true,
      render: (row) => new Date(row.joinedAt).toLocaleDateString("en-NG"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.accountStatus === "ACTIVE" ? "success" : "danger"}>
          {row.accountStatus.toLowerCase()}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        hasPaymentPermission(hasPermission) ? (
          <Button size="sm" variant="secondary" onClick={() => setTarget(row)}>
            {row.accountStatus === "ACTIVE" ? "Suspend" : "Reactivate"}
          </Button>
        ) : (
          <span className="text-xs text-ink-400">read only</span>
        ),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Customers
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Spend and delivery counts are summed from the delivery table, not
            stored counters.
          </p>
        </div>

        <Card>
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <Field label="Search" htmlFor="customer-search">
                <Input
                  id="customer-search"
                  placeholder="name, email or phone"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <Select
                label="Account"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "All accounts" },
                  { value: "ACTIVE", label: "Active" },
                  { value: "SUSPENDED", label: "Suspended" },
                ]}
              />
            </div>
          </CardBody>
        </Card>

        {customers.isError ? (
          <ErrorState
            title="Could not load customers"
            message={(customers.error as Error)?.message}
            onRetry={() => void customers.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={customers.data?.data}
            isLoading={customers.isPending}
            emptyTitle="No customers match"
            emptyDescription="Try clearing the filters."
            page={customers.data?.meta.page}
            pageSize={customers.data?.meta.pageSize}
            total={customers.data?.meta.total}
            onPageChange={setPage}
          />
        )}

        <Modal
          open={Boolean(target)}
          onClose={() => {
            setTarget(null);
            setReason("");
          }}
          title={
            target?.accountStatus === "ACTIVE"
              ? "Suspend this customer?"
              : "Reactivate this customer?"
          }
          description={
            target?.accountStatus === "ACTIVE"
              ? `${target?.name} will be signed out immediately and cannot sign in again until reactivated. Existing deliveries are unaffected.`
              : `${target?.name} will be able to sign in and book again immediately.`
          }
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTarget(null)}>
                Never mind
              </Button>
              <Button
                variant={
                  target?.accountStatus === "ACTIVE" ? "danger" : "accent"
                }
                isLoading={setCustomerStatus.isPending}
                onClick={() => void confirm()}
              >
                {target?.accountStatus === "ACTIVE"
                  ? "Suspend account"
                  : "Reactivate account"}
              </Button>
            </div>
          }
        >
          <Field
            label="Reason (recorded in the audit trail)"
            htmlFor="customer-reason"
          >
            <Textarea
              id="customer-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. repeated fraudulent chargebacks"
            />
          </Field>
        </Modal>
      </div>
    </PortalShell>
  );
}

const hasPaymentPermission = (hasPermission: (permission: string) => boolean) =>
  hasPermission("customer:suspend");
