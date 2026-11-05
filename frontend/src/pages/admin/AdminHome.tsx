import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  ErrorState,
  LoadingBlock,
  Select,
  StatCard,
  StatusPill,
  type Column,
} from "../../components/ui";
import { LIVE_EVENTS, useLiveEvent } from "../../lib/live";
import { useAuth } from "../../contexts/AuthContext";
import { adminNav } from "./nav";
import {
  useAdminDashboard,
  type DashboardOverview,
} from "../../hooks/useAdmin";

const STATUS_TONE: Record<
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

const PIE_COLOURS = [
  "#0f766e",
  "#0891b2",
  "#f59e0b",
  "#6366f1",
  "#dc2626",
  "#64748b",
];

/** Quick ranges. Values are ISO dates so the API receives exactly what it expects. */
const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

export default function AdminHome() {
  const { hasPermission, profile } = useAuth();
  const [days, setDays] = useState<string>("30");
  const queryClient = useQueryClient();

  // Bookings, assignments and completions arrive here as they happen, so the
  // operations dashboard stays a live picture of the floor rather than a snapshot.
  useLiveEvent(
    LIVE_EVENTS.DELIVERY_NEW,
    useCallback(() => void queryClient.invalidateQueries({ queryKey: ["admin"] }), [queryClient]),
  );
  useLiveEvent(
    LIVE_EVENTS.DELIVERY_UPDATED,
    useCallback(() => void queryClient.invalidateQueries({ queryKey: ["admin"] }), [queryClient]),
  );

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const dashboard = useAdminDashboard(range);
  const data = dashboard.data;

  const chartData = useMemo(
    () =>
      (data?.daily ?? []).map((row) => ({
        date: new Date(row.date).toLocaleDateString("en-NG", {
          day: "2-digit",
          month: "short",
        }),
        deliveries: row.deliveries,
        delivered: row.delivered,
        revenue: Number(row.revenueKobo) / 100,
      })),
    [data],
  );

  const statusData = useMemo(
    () =>
      Object.entries(data?.deliveries.byStatus ?? {})
        .map(([status, count]) => ({
          name: status.replace(/_/g, " ").toLowerCase(),
          count,
        }))
        .sort((a, b) => b.count - a.count),
    [data],
  );

  const recentColumns: Column<DashboardOverview["recent"][number]>[] = [
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
      hideOnMobile: true,
      render: (row) => (
        <div className="max-w-[260px]">
          <p className="truncate text-sm text-ink-800">{row.pickup}</p>
          <p className="truncate text-xs text-ink-500">→ {row.destination}</p>
        </div>
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
          tone={STATUS_TONE[row.status] ?? "neutral"}
        />
      ),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">
              Operations overview
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {data
                ? `${new Date(data.range.from).toLocaleDateString("en-NG")} → ${new Date(data.range.to).toLocaleDateString("en-NG")} · every figure below is a live SQL aggregate`
                : "Loading the live figures…"}
            </p>
          </div>
          <div className="w-44">
            <Select
              label="Range"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              options={RANGES.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </div>
        </div>

        {dashboard.isError ? (
          <ErrorState
            title="We could not load the dashboard"
            message={(dashboard.error as Error)?.message}
            onRetry={() => void dashboard.refetch()}
          />
        ) : dashboard.isPending || !data ? (
          <LoadingBlock rows={8} />
        ) : (
          <>
            {/* ── the numbers ── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Deliveries booked"
                value={data.deliveries.total.toLocaleString("en-NG")}
                hint={`${data.deliveries.delivered} delivered · ${data.deliveries.awaitingAssignment} waiting for a rider`}
              />
              <StatCard
                label="Gross charged"
                value={data.money.grossFormatted}
                hint={`average order ${data.money.averageOrderFormatted}`}
              />
              <StatCard
                label="Commission earned"
                value={data.money.commissionFormatted}
                hint={`riders keep ${data.money.riderNetFormatted}`}
              />
              <StatCard
                label="Success rate"
                value={
                  data.deliveries.successRate === null
                    ? "—"
                    : `${data.deliveries.successRate}%`
                }
                hint={
                  data.deliveries.avgDeliveryMinutes === null
                    ? "nothing has completed yet"
                    : `median trip ${data.deliveries.avgDeliveryMinutes} min`
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Riders online"
                value={`${data.riders.online + data.riders.onDelivery} / ${data.riders.total}`}
                hint={`${data.riders.onDelivery} carrying a job now`}
              />
              <StatCard
                label="Documents to review"
                value={data.riders.pendingDocuments}
                hint="rider onboarding queue"
              />
              <StatCard
                label="Live deliveries"
                value={data.deliveries.active}
                hint={`${data.deliveries.failed} failed · ${data.deliveries.cancelled} cancelled`}
              />
              <StatCard
                label="Customers"
                value={data.customers.total}
                hint={`${data.money.marginFormatted} margin in range`}
              />
            </div>

            {/* ── the chart ── */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Card>
                <CardHeader
                  title="Volume and revenue"
                  subtitle="Charged revenue counts delivered jobs only"
                />
                <CardBody>
                  {chartData.length === 0 ? (
                    <p className="py-12 text-center text-sm text-ink-500">
                      No deliveries in this range yet.
                    </p>
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={chartData}
                          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                        >
                          <defs>
                            <linearGradient
                              id="revenueFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="#0f766e"
                                stopOpacity={0.35}
                              />
                              <stop
                                offset="100%"
                                stopColor="#0f766e"
                                stopOpacity={0.02}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#e2e8f0"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11 }}
                            stroke="#94a3b8"
                          />
                          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <Tooltip
                            formatter={(value) => [
                              `₦${Number(value ?? 0).toLocaleString("en-NG")}`,
                              "Revenue",
                            ]}
                            contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#0f766e"
                            strokeWidth={2}
                            fill="url(#revenueFill)"
                            dot={{ r: 3, strokeWidth: 0, fill: "#0f766e" }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Where jobs stand"
                  subtitle="All deliveries in range, by status"
                />
                <CardBody>
                  {statusData.length === 0 ? (
                    <p className="py-10 text-center text-sm text-ink-500">
                      Nothing booked in this range.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {statusData.map((entry, index) => {
                        const share =
                          data.deliveries.total > 0
                            ? (entry.count / data.deliveries.total) * 100
                            : 0;
                        return (
                          <li key={entry.name}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="capitalize text-ink-700">
                                {entry.name}
                              </span>
                              <span className="font-semibold text-ink-900">
                                {entry.count}
                                <span className="ml-1 text-xs font-normal text-ink-400">
                                  {Math.round(share)}%
                                </span>
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${share}%`,
                                  background:
                                    PIE_COLOURS[index % PIE_COLOURS.length],
                                }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>

            {/* ── zones + recent ── */}
            <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <Card>
                <CardHeader
                  title="Zones"
                  subtitle="Delivered jobs and revenue per zone"
                />
                <CardBody>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                        <th className="pb-2">Zone</th>
                        <th className="pb-2 text-right">Done</th>
                        <th className="pb-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.zones.map((zone) => (
                        <tr key={zone.zone} className="border-t border-ink-100">
                          <td className="py-2 text-ink-800">{zone.zone}</td>
                          <td className="py-2 text-right text-ink-600">
                            {zone.delivered}
                          </td>
                          <td className="py-2 text-right font-medium text-ink-900">
                            {zone.revenueFormatted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Latest bookings"
                  subtitle="Newest six in the selected range"
                  action={
                    <Link
                      to="/admin/deliveries"
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      Open the delivery board →
                    </Link>
                  }
                />
                <DataTable
                  columns={recentColumns}
                  rows={data.recent}
                  emptyTitle="No bookings yet"
                  emptyDescription="Once customers book, the newest jobs appear here."
                />
              </Card>
            </div>

            <Alert tone="info" title="Where these numbers come from">
              Gross is the sum of <code>chargeKobo</code> on delivered jobs;
              commission comes from the rider earning rows written when each job
              is completed. The chart is a <code>date_trunc</code> query, and
              the range selector sends real dates — change the range and every
              card moves with it.
              {profile?.isSuperAdmin
                ? " You are a super admin, so nothing is hidden from you."
                : ""}
            </Alert>
          </>
        )}
      </div>
    </PortalShell>
  );
}
