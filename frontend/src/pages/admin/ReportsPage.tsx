import { useMemo, useState } from "react";
import { PortalShell } from "../../layouts/PortalShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  Spinner,
  StatCard,
  useToast,
  type Column,
} from "../../components/ui";
import { adminNav } from "./nav";
import { useAuth, useApiError } from "../../contexts/AuthContext";
import {
  downloadReport,
  useReportCatalogue,
  useReportJobs,
  useReportPreview,
  useRequestReport,
  type ReportCatalogueEntry,
  type ReportFormat,
  type ReportJob,
} from "../../hooks/useReports";
import { cn } from "../../lib/cn";

/**
 * REPORTS & ANALYTICS
 *
 * Two halves, on purpose:
 *
 *   · **Preview** runs the report immediately and shows its totals. It writes no
 *     file, so an operator can check they are about to ask for the right thing —
 *     and every number shown is the same number the live file will carry, because
 *     both come from one dataset builder.
 *   · **Generate** queues the real file. The queue is visible, the failures keep
 *     their error text, and the download link is signed and expires.
 */
export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();

  const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [selected, setSelected] = useState<string | null>("FINANCIAL_SUMMARY");
  const [busy, setBusy] = useState<string | null>(null);

  const catalogue = useReportCatalogue();
  const jobs = useReportJobs();
  const preview = useReportPreview(selected, from, to);
  const request = useRequestReport();

  const selectedEntry: ReportCatalogueEntry | undefined = catalogue.data?.find((entry) => entry.type === selected);

  const queue = async (type: string, format: ReportFormat) => {
    setBusy(`${type}-${format}`);
    try {
      await request.mutateAsync({
        type,
        format,
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
      });
      notify({
        tone: "success",
        title: "Report queued",
        description: `The ${format} file is being generated. It will appear below in a moment.`,
      });
    } catch (error) {
      notify({ tone: "error", title: "Could not queue the report", description: useApiError(error) ?? "Please try again." });
    } finally {
      setBusy(null);
    }
  };

  const save = async (job: ReportJob) => {
    setBusy(job.id);
    try {
      await downloadReport(job.id);
      notify({ tone: "success", title: "Download started", description: `Your ${job.format} file is saving.` });
    } catch (error) {
      notify({
        tone: "error",
        title: "Download failed",
        description: useApiError(error) ?? "The link may have expired — generate a fresh one.",
      });
    } finally {
      setBusy(null);
    }
  };

  const statusTone = (status: ReportJob["status"]) =>
    status === "READY" ? "success" : status === "FAILED" ? "danger" : status === "PROCESSING" ? "info" : "warning";

  const columns = useMemo<Column<ReportJob>[]>(
    () => [
      {
        key: "type",
        header: "Report",
        render: (job) => (
          <div>
            <p className="font-medium text-ink-900">
              {catalogue.data?.find((entry) => entry.type === job.type)?.title ?? job.type.replace(/_/g, " ")}
            </p>
            <p className="text-xs text-ink-500">{job.format}</p>
          </div>
        ),
      },
      {
        key: "period",
        header: "Period",
        render: (job) => (
          <span className="text-xs text-ink-600">
            {job.period.from ? new Date(job.period.from).toLocaleDateString("en-NG") : "—"} →{" "}
            {job.period.to ? new Date(job.period.to).toLocaleDateString("en-NG") : "—"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (job) => (
          <div className="space-y-1">
            <Badge tone={statusTone(job.status)}>{job.status.toLowerCase()}</Badge>
            {job.status === "FAILED" && job.error && (
              <p className="max-w-[220px] text-[11px] leading-snug text-danger-700">{job.error}</p>
            )}
          </div>
        ),
      },
      {
        key: "requestedAt",
        header: "Requested",
        render: (job) => <span className="text-xs text-ink-500">{new Date(job.requestedAt).toLocaleString("en-NG")}</span>,
      },
      {
        key: "actions",
        header: "",
        align: "right",
        render: (job) => (
          <div className="flex justify-end gap-2">
            {job.downloadable ? (
              <Button size="sm" onClick={() => void save(job)} isLoading={busy === job.id}>
                Download
              </Button>
            ) : job.status === "FAILED" ? (
              <Button size="sm" variant="secondary" onClick={() => void queue(job.type, job.format)}>
                Retry
              </Button>
            ) : (
              <span className="flex items-center gap-1 text-xs text-ink-500">
                <Spinner size="sm" /> working
              </span>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogue.data, busy],
  );

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900">Reports &amp; analytics</h1>
            <p className="text-sm text-ink-500">
              Every figure is computed from the database when the file is generated — never copied from a dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-[150px]"
            />
            <Input
              label="To"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-[150px]"
            />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Catalogue" subtitle="Nine reports, each available as CSV and PDF" />
            <CardBody className="space-y-2">
              {(catalogue.data ?? []).map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  onClick={() => setSelected(entry.type)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition",
                    selected === entry.type
                      ? "border-brand-400 bg-brand-50 ring-1 ring-brand-400/30"
                      : "border-ink-200 hover:border-ink-300 hover:bg-ink-50",
                  )}
                >
                  <p className="text-sm font-semibold text-ink-900">{entry.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{entry.description}</p>
                </button>
              ))}
              {catalogue.isLoading && <p className="text-sm text-ink-500">Loading catalogue…</p>}
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader
                title={selectedEntry?.title ?? "Preview"}
                subtitle={selectedEntry?.description ?? "Pick a report on the left"}
                action={
                  selectedEntry && (
                    <div className="flex gap-2">
                      {selectedEntry.formats.map((format) => (
                        <Button
                          key={format}
                          size="sm"
                          variant={format === "CSV" ? "primary" : "secondary"}
                          onClick={() => void queue(selectedEntry.type, format)}
                          isLoading={busy === `${selectedEntry.type}-${format}`}
                        >
                          Generate {format}
                        </Button>
                      ))}
                    </div>
                  )
                }
              />
              <CardBody className="space-y-3">
                {preview.isFetching && (
                  <div className="flex items-center gap-2 text-sm text-ink-500">
                    <Spinner /> Running the report…
                  </div>
                )}
                {preview.isError && (
                  <Alert tone="danger" title="The preview could not be generated">
                    {useApiError(preview.error) ?? "Check the period and try again."}
                  </Alert>
                )}

                {preview.data && (
                  <>
                    <p className="text-sm text-ink-600">{preview.data.subtitle}</p>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {preview.data.totalsFormatted.slice(0, 6).map((total) => (
                        <StatCard key={total.label} label={total.label} value={total.display} />
                      ))}
                    </div>

                    {preview.data.truncated && (
                      <Alert tone="warning" title="This is a sample">
                        Showing {preview.data.truncated.shown} of {preview.data.truncated.total} rows in the preview;
                        the generated file contains them all.
                      </Alert>
                    )}

                    <div className="overflow-x-auto rounded-xl border border-ink-200">
                      <table className="w-full text-sm">
                        <thead className="bg-ink-50">
                          <tr>
                            {preview.data.columns.map((column) => (
                              <th
                                key={column.key}
                                className={cn(
                                  "whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500",
                                  column.align === "right" ? "text-right" : "text-left",
                                )}
                              >
                                {column.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.data.rows.map((row, index) => (
                            <tr key={index} className={index % 2 === 1 ? "bg-ink-50/50" : undefined}>
                              {preview.data!.columns.map((column) => {
                                const raw = row[column.key];
                                const value =
                                  raw === null || raw === undefined
                                    ? "—"
                                    : column.money
                                      ? formatKobo(Number(raw))
                                      : String(raw);
                                return (
                                  <td
                                    key={column.key}
                                    className={cn(
                                      "max-w-[280px] truncate px-3 py-1.5 text-ink-700",
                                      column.align === "right" && "text-right tabular-nums",
                                    )}
                                    title={value}
                                  >
                                    {value}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                          {preview.data.rows.length === 0 && (
                            <tr>
                              <td colSpan={preview.data.columns.length} className="px-3 py-6 text-center text-sm text-ink-500">
                                No rows matched this period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-ink-400">
                      Preview only — nothing has been written to disk. Generating a file queues the same dataset and
                      stores it privately behind a signed, expiring link.
                    </p>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Generated files" subtitle="Newest first · download links expire after 15 minutes" />
              <CardBody>
                {jobs.data && jobs.data.length === 0 ? (
                  <EmptyState
                    title="No reports generated yet"
                    description="Pick a report and a format above. The worker renders it in a couple of seconds and it will appear here."
                  />
                ) : (
                  <DataTable columns={columns} rows={jobs.data} isLoading={jobs.isLoading} emptyTitle="No reports yet" />
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}

/** Kobo → "₦4,894.50" for the preview table (the CSV deliberately uses plain decimals). */
function formatKobo(kobo: number): string {
  const negative = kobo < 0;
  const absolute = Math.abs(kobo);
  const naira = Math.floor(absolute / 100).toLocaleString("en-NG");
  const koboPart = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}₦${naira}.${koboPart}`;
}
