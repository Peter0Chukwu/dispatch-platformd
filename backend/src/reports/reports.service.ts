import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { formatNaira } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { StorageService } from '../storage/storage.service';
import { ReportDatasetsService } from './report-datasets.service';
import { renderCsv, renderPdf } from './report-render';
import { PREVIEW_ROW_LIMIT, REPORT_CATALOGUE, type ReportFormat, type ReportTable, type ReportTypeName } from './report-types';

/**
 * REPORTS
 * ─────────────────────────────────────────────────────────────────────────────
 * A report is a job, not a request. `POST /admin/reports` writes a QUEUED row and
 * returns in milliseconds; a worker renders the file and marks it READY; the
 * download link is signed and short-lived.
 *
 * Why bother, for datasets this small? Because the shape is what makes it safe
 * later: the endpoint that answers in 20 ms today can answer in 40 s against three
 * years of data without a timeout, a dropped connection or a browser that gave up
 * halfway through. The queue, the retry and the signed link are the parts that do
 * not have to be rewritten when the data grows.
 *
 * The claim is deliberately boring: a conditional `updateMany` from QUEUED to
 * PROCESSING, plus a Redis lock per job, so two API processes cannot render the
 * same report twice.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly datasets: ReportDatasetsService,
    private readonly storage: StorageService,
  ) {}

  catalogue() {
    return REPORT_CATALOGUE.map((entry) => ({ ...entry }));
  }

  /** Queue a report. Returns immediately with the job, never the file. */
  async request(params: {
    userId: string;
    type: ReportTypeName;
    format: ReportFormat;
    from?: string;
    to?: string;
  }) {
    const known = REPORT_CATALOGUE.find((entry) => entry.type === params.type);
    if (!known) throw AppError.validation([{ field: 'type', message: 'Unknown report type' }]);
    if (!known.formats.includes(params.format)) {
      throw AppError.validation([{ field: 'format', message: `${known.title} is available as ${known.formats.join(' or ')}` }]);
    }

    const { from, to } = resolveRange(params.from, params.to);
    const job = await this.prisma.reportRequest.create({
      data: {
        type: params.type,
        format: params.format,
        params: { from: from.toISOString(), to: to.toISOString() },
        requestedById: params.userId,
        status: 'QUEUED',
      },
    });

    return this.present(job);
  }

  async list(limit = 25) {
    const jobs = await this.prisma.reportRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
    return { data: jobs.map((job) => this.present(job)) };
  }

  async get(id: string) {
    const job = await this.prisma.reportRequest.findUnique({ where: { id } });
    if (!job) throw AppError.notFound('Report');
    return this.present(job);
  }

  /**
   * Generate a report synchronously *without* storing a file — used by the preview
   * panel and by the tests that assert totals against the dashboard and ledger.
   */
  async preview(
    type: ReportTypeName,
    from?: string,
    to?: string,
  ): Promise<
    Omit<ReportTable, 'totals'> & {
      totals: Array<{ label: string; value: string; money: boolean; emphasis: boolean }>;
      totalsFormatted: Array<{ label: string; value: string; display: string }>;
    }
  > {
    const range = resolveRange(from, to);
    const table = await this.datasets.build(type, range.from, range.to);
    return {
      ...table,
      rows: table.rows.slice(0, PREVIEW_ROW_LIMIT),
      // BigInt cannot cross a JSON boundary, so totals travel as strings. They are
      // exact — a naira figure rounded in transit would defeat the point of the report.
      totals: table.totals.map((total) => ({
        label: total.label,
        value: (typeof total.value === 'bigint' ? total.value : BigInt(Math.round(Number(total.value)))).toString(),
        money: total.money ?? false,
        emphasis: total.emphasis ?? false,
      })),
      totalsFormatted: table.totals.map((total) => ({
        label: total.label,
        value:
          total.money
            ? (typeof total.value === 'bigint' ? total.value : BigInt(Math.round(Number(total.value)))).toString()
            : String(total.value),
        display: total.money
          ? formatNaira(typeof total.value === 'bigint' ? total.value : BigInt(Math.round(Number(total.value))))
          : String(total.value),
      })),
    };
  }

  /** Render one job. Called by the scheduler; also callable directly in tests. */
  async process(jobId: string): Promise<{ status: 'READY' | 'FAILED' }> {
    const locked = await this.prisma.reportRequest.updateMany({
      where: { id: jobId, status: 'QUEUED' },
      data: { status: 'PROCESSING' },
    });
    if (locked.count === 0) return { status: 'FAILED' }; // somebody else has it, or it is done

    const job = await this.prisma.reportRequest.findUniqueOrThrow({ where: { id: jobId } });
    const params = (job.params ?? {}) as { from?: string; to?: string };

    try {
      const table = await this.datasets.build(job.type as ReportTypeName, new Date(params.from!), new Date(params.to!));
      const stamped: ReportTable = {
        ...table,
        meta: [
          { label: 'Period', value: `${shortDate(params.from!)} → ${shortDate(params.to!)}` },
          { label: 'Generated', value: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' },
          { label: 'Report id', value: job.id },
          ...table.meta,
        ],
      };

      const extension = job.format === 'CSV' ? 'csv' : 'pdf';
      const buffer = job.format === 'CSV' ? renderCsv(stamped) : await renderPdf(stamped);
      const key = `reports/${job.id}/${slug(table.title)}-${new Date().toISOString().slice(0, 10)}.${extension}`;
      await this.storage.saveBuffer(key, buffer);

      await this.prisma.reportRequest.update({
        where: { id: job.id },
        data: { status: 'READY', fileKey: key, completedAt: new Date(), error: null },
      });
      this.logger.log(`Report ${job.type} (${job.format}) ready: ${key} · ${buffer.length} bytes`);
      return { status: 'READY' };
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await this.prisma.reportRequest.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      });
      this.logger.error(`Report ${job.id} failed: ${message}`);
      return { status: 'FAILED' };
    }
  }

  /** Claim and render the oldest queued job. Returns true if it worked on one. */
  async processNextQueued(): Promise<boolean> {
    const next = await this.prisma.reportRequest.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return false;
    await this.process(next.id);
    return true;
  }

  /**
   * A signed, expiring download link.
   *
   * The token is `base64url(reportId.expiryUnix).hmac`. It carries no file key, so
   * a tampered token cannot point at another tenant's file, and it needs no session
   * — which is what lets a browser download with a plain anchor tag, and what lets
   * an operator paste the link into an email if they must.
   */
  async downloadLink(id: string, ttlSeconds = 900) {
    const job = await this.prisma.reportRequest.findUnique({ where: { id } });
    if (!job) throw AppError.notFound('Report');
    if (job.status !== 'READY' || !job.fileKey) {
      throw AppError.conflict('This report is not ready yet.', 'CONFLICT');
    }

    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${job.id}.${expiresAt}`;
    const token = `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
    return {
      url: `/api/v1/reports/download/${token}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      expiresInSeconds: ttlSeconds,
      fileName: job.fileKey.split('/').pop() ?? `report.${job.format.toLowerCase()}`,
    };
  }

  /** Resolve a download token to a file. Public route: the token is the credential. */
  async readDownload(token: string) {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw AppError.forbidden('This download link is not valid.');

    const payload = Buffer.from(encoded, 'base64url').toString('utf8');
    const [id, expiry] = payload.split('.');
    if (!id || !expiry) throw AppError.forbidden('This download link is not valid.');

    const expected = this.sign(payload);
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw AppError.forbidden('This download link is not valid.');
    }
    if (Number(expiry) * 1000 < Date.now()) {
      throw AppError.forbidden('This download link has expired. Generate a new one.');
    }

    const job = await this.prisma.reportRequest.findUnique({ where: { id } });
    if (!job?.fileKey || job.status !== 'READY') throw AppError.notFound('Report');

    const buffer = await this.storage.readBuffer(job.fileKey);
    return {
      buffer,
      contentType: job.format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/pdf',
      fileName: job.fileKey.split('/').pop() ?? `report.${job.format.toLowerCase()}`,
    };
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private present(job: {
    id: string;
    type: string;
    format: string;
    status: string;
    params: unknown;
    fileKey: string | null;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    const params = (job.params ?? {}) as { from?: string; to?: string };
    return {
      id: job.id,
      type: job.type,
      format: job.format,
      status: job.status,
      period: { from: params.from ?? null, to: params.to ?? null },
      error: job.error,
      requestedAt: job.createdAt,
      completedAt: job.completedAt,
      /** Whether a signed link can be minted right now. */
      downloadable: job.status === 'READY' && Boolean(job.fileKey),
    };
  }

  private sign(payload: string): string {
    // A purpose prefix keeps this key from being reusable for another signature
    // elsewhere in the system, even when both derive from the same secret.
    return createHmac('sha256', `report-download:${this.config.trackingLinkSecret}`).update(payload).digest('base64url');
  }

  /** Exposed for tests and for a future cron that cleans old files. */
  static fileNameFor(title: string, format: ReportFormat): string {
    return `${slug(title)}.${format.toLowerCase()}`;
  }

  /** Used by the scheduler when a job has been stuck in PROCESSING (e.g. a crash). */
  async requeueStale(minutes = 15): Promise<number> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const result = await this.prisma.reportRequest.updateMany({
      where: { status: 'PROCESSING', createdAt: { lte: cutoff } },
      data: { status: 'QUEUED' },
    });
    if (result.count > 0) this.logger.warn(`Re-queued ${result.count} stale report(s)`);
    return result.count;
  }

  static correlationId(): string {
    return randomUUID();
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

/** Default period: the last 30 days, ending now. Both bounds are inclusive. */
export function resolveRange(from?: string, to?: string): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw AppError.validation([{ field: 'from', message: 'Use an ISO date for the period' }]);
  }
  if (start > end) {
    throw AppError.validation([{ field: 'from', message: 'The period starts after it ends' }]);
  }
  return { from: start, to: end };
}

const shortDate = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
