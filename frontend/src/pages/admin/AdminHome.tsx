import { useQuery } from '@tanstack/react-query';
import { PortalShell } from '../../layouts/PortalShell';
import { Alert, Badge, Card, CardBody, CardHeader, DataTable, ErrorState, LoadingBlock, StatCard, type Column } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

interface WhoAmI {
  staff: {
    staffCode: string;
    isSuperAdmin: boolean;
    jobTitle: string | null;
    branch: { code: string; name: string; city: string };
    roles: Array<{ role: { key: string; name: string } }>;
    user: { firstName: string; lastName: string; email: string | null };
  };
  permissions: string[];
  isSuperAdmin: boolean;
}

interface StaffRow {
  id: string;
  staffCode: string;
  name: string;
  email: string | null;
  status: string;
  roles: Array<{ key: string; name: string }>;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
}

const NAV = [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/deliveries', label: 'Deliveries', soon: true },
  { to: '/admin/riders', label: 'Riders', soon: true },
  { to: '/admin/finance', label: 'Finance', soon: true },
  { to: '/admin/staff', label: 'Staff', soon: true },
];

export default function AdminHome() {
  const { user, profile, hasPermission } = useAuth();

  const whoami = useQuery({
    queryKey: ['admin', 'whoami'],
    queryFn: () => api.get<WhoAmI>('/admin/whoami'),
  });

  const staff = useQuery({
    queryKey: ['admin', 'staff'],
    queryFn: () => api.get<{ data: StaffRow[]; meta: { total: number } }>('/admin/staff?pageSize=10'),
    enabled: hasPermission('staff:read'),
    retry: false,
  });

  const staffColumns: Column<StaffRow>[] = [
    { key: 'code', header: 'Code', render: (row) => <span className="font-mono text-xs">{row.staffCode}</span> },
    { key: 'name', header: 'Name', render: (row) => <span className="font-medium text-ink-900">{row.name}</span> },
    {
      key: 'roles',
      header: 'Roles',
      hideOnMobile: true,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.isSuperAdmin && <Badge tone="brand">super admin</Badge>}
          {row.roles.map((role) => (
            <Badge key={role.key} tone="neutral">
              {role.key.replace(/_/g, ' ').toLowerCase()}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'ACTIVE' ? 'success' : 'warning'}>{row.status}</Badge> },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      hideOnMobile: true,
      render: (row) => (row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('en-NG') : 'never'),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={NAV}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Operations overview</h1>
            <p className="mt-1 text-sm text-ink-500">
              {whoami.data ? `${whoami.data.staff.branch.name} · ${whoami.data.staff.branch.code}` : 'Loading branch…'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(whoami.data?.staff.roles ?? []).map((role) => (
              <Badge key={role.role.key} tone="brand">
                {role.role.name}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Deliveries today" value="0" hint="no bookings yet — Phase 3" />
          <StatCard label="Online riders" value="0" hint="rider operations arrive in Phase 4" />
          <StatCard label="Revenue today" value="₦0.00" hint="computed from real payments" />
          <StatCard label="Pending withdrawals" value="0" hint="finance centre in Phase 5" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader
              title="Staff directory"
              subtitle={hasPermission('staff:read') ? 'Live from the database' : 'Requires the staff:read permission'}
            />
            {hasPermission('staff:read') ? (
              staff.isError ? (
                <ErrorState
                  message={(staff.error as ApiError)?.userMessage ?? 'Could not load staff'}
                  requestId={(staff.error as ApiError)?.requestId}
                  onRetry={() => void staff.refetch()}
                />
              ) : (
                <DataTable
                  columns={staffColumns}
                  rows={staff.data?.data}
                  isLoading={staff.isPending}
                  emptyTitle="No staff accounts yet"
                  emptyDescription="Create them from the Staff screen once Phase 5 lands."
                />
              )
            ) : (
              <CardBody>
                <Alert tone="warning" title="Restricted">
                  Your role does not include <code>staff:read</code>, so this panel is not even requested. The API
                  would reject it with 403 anyway — the check is enforced on the server.
                </Alert>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Your permissions" subtitle={`${whoami.data?.permissions.length ?? 0} granted`} />
            <CardBody>
              {whoami.isPending ? (
                <LoadingBlock rows={6} />
              ) : (
                <div className="flex max-h-80 flex-wrap gap-1.5 overflow-y-auto">
                  {(whoami.data?.permissions ?? []).map((permission) => (
                    <span
                      key={permission}
                      className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-700"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                Loaded from the database via <code>/admin/whoami</code>. A support agent sees a much shorter list and
                cannot reach finance or pricing at all.
              </p>
            </CardBody>
          </Card>
        </div>

        <Alert tone="info" title="Phase 5 builds the command centre">
          The overview cards above are honest zeros: they are wired to real queries that will populate the moment
          deliveries exist. This phase delivered the authentication and authorisation layer that every one of those
          screens depends on — sign-in, sessions, roles, permissions and the audit trail,
          {profile?.isSuperAdmin ? ' with full super-admin access.' : '.'}
        </Alert>

        <p className="text-xs text-ink-400">
          Signed in as {user?.firstName} {user?.lastName} · {user?.email}
        </p>
      </div>
    </PortalShell>
  );
}
