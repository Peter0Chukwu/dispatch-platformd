import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, Body } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';
import { REPORT_CATALOGUE } from './report-types';

const requestSchema = z.object({
  type: z.enum(REPORT_CATALOGUE.map((entry) => entry.type) as [string, ...string[]]),
  format: z.enum(['CSV', 'PDF']).default('CSV'),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

const periodSchema = z.object({
  type: z.enum(REPORT_CATALOGUE.map((entry) => entry.type) as [string, ...string[]]),
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * REPORTS & ANALYTICS (Phase 9)
 *
 * Requesting a report is a two-step dance on purpose: queue it, then collect it.
 * The API never renders a file inside the request — the worker does that — so a
 * slow report cannot hold a connection open, and a failed one leaves a record with
 * its error instead of a broken download.
 */
@Controller('admin/reports')
@RequireType('STAFF')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('catalogue')
  @RequirePermissions('report:generate')
  catalogue() {
    return { data: this.reports.catalogue() };
  }

  /** Queue a report. Returns immediately: 201 with a job in QUEUED. */
  @Post()
  @RequirePermissions('report:generate')
  @RateLimit({ points: 20, windowSeconds: 60, keyBy: 'ip+route' })
  request(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(requestSchema)) input: { type: string; format: 'CSV' | 'PDF'; from?: string; to?: string },
  ) {
    return this.reports.request({
      userId,
      type: input.type as never,
      format: input.format,
      from: input.from,
      to: input.to,
    });
  }

  @Get()
  @RequirePermissions('report:generate')
  async list(@Query('limit') limit?: string) {
    return this.reports.list(limit ? Number(limit) : 25);
  }

  /**
   * Generate a report inline, without storing a file.
   * Powers the preview panel — and the totals it returns are the numbers the tests
   * check against the dashboard and the ledger.
   */
  @Get('preview')
  @RequirePermissions('report:generate')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  preview(@Query(new ZodValidationPipe(periodSchema)) query: { type: string; from?: string; to?: string }) {
    return this.reports.preview(query.type as never, query.from, query.to);
  }

  @Get(':id')
  @RequirePermissions('report:generate')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.reports.get(id);
    return { ...job, download: job.downloadable ? await this.reports.downloadLink(id) : null };
  }

  /** Mint a fresh signed link (links expire in 15 minutes). */
  @Post(':id/download-link')
  @RequirePermissions('report:generate')
  async link(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.downloadLink(id);
  }
}

/**
 * The download itself. Public, because the token in the URL *is* the credential:
 * signed, expiring, and tied to one report id. It is the only way a browser can
 * save a file with a plain link, and it reveals nothing without a valid signature.
 */
@Controller('reports/download')
@Public()
export class ReportDownloadController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const file = await this.reports.readDownload(token);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': String(file.buffer.length),
      // Signed and short-lived: never cached by a proxy or a shared browser.
      'Cache-Control': 'no-store, private',
    });
    res.end(file.buffer);
  }
}
