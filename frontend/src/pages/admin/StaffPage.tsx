import { useState } from "react";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
  type Column,
} from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { adminNav } from "./nav";
import {
  useAdminRoles,
  useAdminTeam,
  useCreateStaff,
  useSetStaffStatus,
  type AdminStaffRow,
} from "../../hooks/useAdmin";

export default function StaffPage() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<AdminStaffRow | null>(null);
  const [reason, setReason] = useState("");

  const team = useAdminTeam({
    q: search.trim() || undefined,
    page,
    pageSize: 20,
  });
  const roles = useAdminRoles();
  const setStatus = useSetStaffStatus();

  const toggle = async () => {
    if (!target) return;
    const next = target.accountStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      const result = await setStatus.mutateAsync({
        staffId: target.id,
        status: next,
        reason: reason.trim() || undefined,
      });
      notify({
        tone: "success",
        title:
          next === "SUSPENDED" ? "Account suspended" : "Account reactivated",
        description:
          next === "SUSPENDED"
            ? `${result.sessionsRevoked} session(s) revoked — they are signed out now.`
            : undefined,
      });
      setTarget(null);
      setReason("");
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not change this account",
        description: (error as Error).message,
      });
    }
  };

  const columns: Column<AdminStaffRow>[] = [
    {
      key: "code",
      header: "Code",
      render: (row) => (
        <span className="font-mono text-xs">{row.staffCode}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div>
          <p className="text-sm font-medium text-ink-900">{row.name}</p>
          <p className="text-xs text-ink-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      hideOnMobile: true,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.length === 0 && (
            <span className="text-xs text-ink-400">no role</span>
          )}
          {row.roles.map((role) => (
            <Badge
              key={role.key}
              tone={role.key === "SUPER_ADMIN" ? "brand" : "neutral"}
            >
              {role.name.toLowerCase()}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      hideOnMobile: true,
      render: (row) => row.branch,
    },
    {
      key: "lastLogin",
      header: "Last sign-in",
      hideOnMobile: true,
      render: (row) =>
        row.lastLoginAt
          ? new Date(row.lastLoginAt).toLocaleString("en-NG")
          : "never",
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
        hasPermission("staff:write") ? (
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">
              Staff &amp; roles
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Who works here, what they may do, and what each role grants.
              Permissions are enforced by the API on every request.
            </p>
          </div>
          {hasPermission("staff:write") && (
            <Button onClick={() => setCreating(true)}>
              Add a staff member
            </Button>
          )}
        </div>

        <Card>
          <CardBody>
            <Field label="Search" htmlFor="staff-search">
              <Input
                id="staff-search"
                placeholder="name, email or staff code"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </CardBody>
        </Card>

        {team.isError ? (
          <ErrorState
            title="Could not load the team"
            message={(team.error as Error)?.message}
            onRetry={() => void team.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={team.data?.data}
            isLoading={team.isPending}
            emptyTitle="No staff accounts match"
            page={team.data?.meta.page}
            pageSize={team.data?.meta.pageSize}
            total={team.data?.meta.total}
            onPageChange={setPage}
          />
        )}

        <Card>
          <CardHeader
            title="What each role can do"
            subtitle="The seeded permission matrix"
          />
          <CardBody>
            {roles.isPending ? (
              <p className="text-sm text-ink-500">Loading roles…</p>
            ) : (
              <div className="space-y-3">
                {(roles.data ?? []).map((role) => (
                  <div
                    key={role.key}
                    className="rounded-xl border border-ink-200 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink-900">
                        {role.name}{" "}
                        <span className="font-mono text-[11px] text-ink-400">
                          {role.key}
                        </span>
                      </p>
                      <span className="text-xs text-ink-500">
                        {role.staffCount}{" "}
                        {role.staffCount === 1 ? "person" : "people"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {role.permissions.map((permission) => (
                        <span
                          key={permission}
                          className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-700"
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <CreateStaffModal
          open={creating}
          roles={roles.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void team.refetch();
            void roles.refetch();
          }}
        />

        <Modal
          open={Boolean(target)}
          onClose={() => {
            setTarget(null);
            setReason("");
          }}
          title={
            target?.accountStatus === "ACTIVE"
              ? "Suspend this staff account?"
              : "Reactivate this account?"
          }
          description={
            target?.accountStatus === "ACTIVE"
              ? `${target?.name} will be signed out everywhere and cannot sign in until reactivated.`
              : `${target?.name} will be able to sign in again.`
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
                isLoading={setStatus.isPending}
                onClick={() => void toggle()}
              >
                {target?.accountStatus === "ACTIVE" ? "Suspend" : "Reactivate"}
              </Button>
            </div>
          }
        >
          <Field
            label="Reason"
            hint="Recorded in the audit trail"
            htmlFor="staff-reason"
          >
            <Textarea
              id="staff-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. left the company"
            />
          </Field>
        </Modal>
      </div>
    </PortalShell>
  );
}

function CreateStaffModal({
  open,
  roles,
  onClose,
  onCreated,
}: {
  open: boolean;
  roles: Array<{ key: string; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const create = useCreateStaff();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    jobTitle: "",
    roleKeys: [] as string[],
  });

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    try {
      const created = await create.mutateAsync(form);
      notify({
        tone: "success",
        title: `${created.staffCode} created`,
        description:
          "Share the password with them once — it is not shown again.",
      });
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        password: "",
        jobTitle: "",
        roleKeys: [],
      });
      onCreated();
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create this account",
        description: (error as Error).message,
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a staff member"
      description="They can sign in on the admin portal as soon as you save this."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={create.isPending}
            disabled={form.roleKeys.length === 0 || form.password.length < 8}
            onClick={() => void submit()}
          >
            Create account
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name" htmlFor="staff-first">
          <Input
            id="staff-first"
            value={form.firstName}
            onChange={(event) => update("firstName", event.target.value)}
          />
        </Field>
        <Field label="Last name" htmlFor="staff-last">
          <Input
            id="staff-last"
            value={form.lastName}
            onChange={(event) => update("lastName", event.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="staff-email">
          <Input
            id="staff-email"
            type="email"
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </Field>
        <Field
          label="Phone"
          hint="Nigerian mobile, e.g. 0803 123 4567"
          htmlFor="staff-phone"
        >
          <Input
            id="staff-phone"
            value={form.phone}
            onChange={(event) => update("phone", event.target.value)}
          />
        </Field>
        <Field
          label="Temporary password"
          hint="At least 8 characters, mixed case and a number"
          htmlFor="staff-password"
        >
          <Input
            id="staff-password"
            type="password"
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </Field>
        <Field label="Job title" htmlFor="staff-title">
          <Input
            id="staff-title"
            value={form.jobTitle}
            onChange={(event) => update("jobTitle", event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field
          label="Roles"
          hint="Everything this person may do comes from these roles"
          htmlFor="staff-roles"
        >
          <Select
            id="staff-roles"
            multiple
            className="h-40"
            value={form.roleKeys}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                roleKeys: Array.from(event.target.selectedOptions).map(
                  (option) => option.value,
                ),
              }))
            }
            options={roles.map((role) => ({
              value: role.key,
              label: role.name,
            }))}
          />
        </Field>
      </div>
    </Modal>
  );
}
