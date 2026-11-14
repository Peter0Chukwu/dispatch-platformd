import { useState } from "react";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
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
  useCreateStaffInvite,
  useRevokeStaffInvite,
  useSetStaffStatus,
  useStaffInvites,
  type AdminStaffRow,
} from "../../hooks/useAdmin";

export default function StaffPage() {
  const { hasPermission, profile } = useAuth();
  const { notify } = useToast();
  // Inviting an administrator is the super admin's own power; everybody else who
  // can touch staff uses the create-with-password path below.
  const isSuperAdmin = Boolean(profile?.isSuperAdmin);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
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
              Who works here, what each role may do, and who has been suspended.
            </p>
          </div>
          {hasPermission("staff:write") && (
            <div className="flex flex-wrap gap-2">
              {isSuperAdmin && (
                <Button onClick={() => setInviting(true)}>Invite an admin</Button>
              )}
              <Button variant="secondary" onClick={() => setCreating(true)}>
                Add a staff member
              </Button>
            </div>
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

        {isSuperAdmin && <InvitesCard />}

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

        <InviteStaffModal
          open={inviting}
          roles={roles.data ?? []}
          onClose={() => setInviting(false)}
        />

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

/* ───────────────────────────── invitations ──────────────────────────────── */

const INVITE_TONE = {
  PENDING: "warning",
  ACCEPTED: "success",
  EXPIRED: "neutral",
  REVOKED: "danger",
} as const;

/**
 * The outstanding invitations.
 *
 * Kept next to the team list on purpose: "who has not joined yet" is the same
 * question as "who works here", and seeing a PENDING row that should be ACCEPTED
 * is how an unexpected acceptance gets noticed.
 */
function InvitesCard() {
  const { notify } = useToast();
  const invites = useStaffInvites();
  const revoke = useRevokeStaffInvite();

  const onRevoke = async (id: string) => {
    try {
      await revoke.mutateAsync(id);
      notify({ tone: "success", title: "Invitation withdrawn" });
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not withdraw that invitation",
        description: (error as Error).message,
      });
    }
  };

  return (
    <Card>
      <CardHeader
        title="Invitations"
        subtitle="One-time links. The link is shown once, when it is created."
      />
      <CardBody>
        {invites.isPending ? (
          <p className="text-sm text-ink-500">Loading invitations…</p>
        ) : (invites.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-500">
            Nobody has been invited yet. Use <strong>Invite an admin</strong> to mint a link.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {(invites.data ?? []).map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {invite.email}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {invite.roleKeys.map((key) => key.replace(/_/g, " ").toLowerCase()).join(", ")}
                    {" · "}
                    {invite.status === "PENDING"
                      ? `expires ${new Date(invite.expiresAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}`
                      : invite.status === "ACCEPTED"
                        ? "accepted"
                        : invite.status === "REVOKED"
                          ? "withdrawn"
                          : "expired"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={INVITE_TONE[invite.status]}>
                    {invite.status.toLowerCase()}
                  </Badge>
                  {invite.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={revoke.isPending}
                      onClick={() => void onRevoke(invite.id)}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Two steps: choose who and what they may do, then hand over the link.
 *
 * The link is the only thing this modal will ever show that cannot be recovered,
 * so the success step is deliberately not a toast — a toast disappears, and this
 * string cannot be fetched again.
 */
function InviteStaffModal({
  open,
  roles,
  onClose,
}: {
  open: boolean;
  roles: Array<{ key: string; name: string }>;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const create = useCreateStaffInvite();
  const [form, setForm] = useState({
    email: "",
    jobTitle: "",
    expiresInHours: 72,
    roleKeys: [] as string[],
  });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setForm({ email: "", jobTitle: "", expiresInHours: 72, roleKeys: [] });
    setLink(null);
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        email: form.email.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
        roleKeys: form.roleKeys,
        expiresInHours: form.expiresInHours,
      });
      setLink(created.acceptUrl);
    } catch (error) {
      notify({
        tone: "error",
        title: "Could not create that invitation",
        description: (error as Error).message,
      });
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // The link is on screen and selectable either way.
      setCopied(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={link ? "Share this link" : "Invite an administrator"}
      description={
        link
          ? "Send it however you like — WhatsApp, email, in person. It works once."
          : "They choose their own password. You never see it, and you never need to."
      }
      size="lg"
      footer={
        link ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Done
            </Button>
            <Button variant="secondary" onClick={reset}>
              Invite someone else
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              isLoading={create.isPending}
              disabled={!form.email.trim() || form.roleKeys.length === 0}
              onClick={() => void submit()}
            >
              Create invitation
            </Button>
          </div>
        )
      }
    >
      {link ? (
        <div className="space-y-3">
          <Alert tone="warning" title="This is the only time you will see it">
            We store a hash of the link, not the link. If it is lost, withdraw this
            invitation and make another.
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={link} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-ink-500">
            It expires in {form.expiresInHours} hour(s) and can only be used once. Once they
            accept, they sign in at the admin portal with their own password.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email address" hint="The account is created for this address" htmlFor="invite-email">
              <Input
                id="invite-email"
                type="email"
                placeholder="name@company.com"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </Field>
            <Field label="Job title" hint="Optional — appears on their profile" htmlFor="invite-title">
              <Input
                id="invite-title"
                placeholder="Operations Manager"
                value={form.jobTitle}
                onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))}
              />
            </Field>
          </div>

          <div>
            <p className="field-label">Roles</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => {
                const checked = form.roleKeys.includes(role.key);
                return (
                  <label
                    key={role.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-ink-200 p-3 hover:bg-ink-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                      checked={checked}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          roleKeys: event.target.checked
                            ? [...current.roleKeys, role.key]
                            : current.roleKeys.filter((key) => key !== role.key),
                        }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink-900">{role.name}</span>
                      <span className="block font-mono text-[11px] text-ink-400">{role.key}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {form.roleKeys.includes("SUPER_ADMIN") && (
              <div className="mt-2">
                <Alert tone="warning" title="You are granting full control">
                  A super admin can invite others, change anyone's roles, and see every
                  part of the platform. Grant it only to someone who needs all of that.
                </Alert>
              </div>
            )}
          </div>

          <Field label="Link expires in" htmlFor="invite-expiry">
            <Select
              id="invite-expiry"
              options={[
                { value: "24", label: "24 hours" },
                { value: "72", label: "3 days" },
                { value: "168", label: "7 days" },
                { value: "336", label: "14 days" },
              ]}
              value={String(form.expiresInHours)}
              onChange={(event) =>
                setForm((current) => ({ ...current, expiresInHours: Number(event.target.value) }))
              }
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
