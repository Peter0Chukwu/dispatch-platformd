import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReviewDocumentSchema, SetRiderApprovalSchema } from '@dispatch/shared';
import type { ReviewDocumentInput, SetRiderApprovalInput } from '@dispatch/shared';
import { AdminRidersService } from './admin-riders.service';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * ADMIN — RIDER ONBOARDING
 *
 * STAFF only, and each route needs its own permission: reading the queue is not
 * the same right as approving a rider, and reading a document's bytes is a third.
 */
@Controller('admin/riders')
@RequireType('STAFF')
export class AdminRidersController {
  constructor(private readonly riders: AdminRidersService) {}

  @Get()
  @RequirePermissions('rider:read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.riders.list(query);
  }

  @Get(':id')
  @RequirePermissions('rider:read')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.riders.detail(id);
  }

  /** The document bytes. Private storage, permission-checked, streamed — never a public URL. */
  @Get(':id/documents/:documentId/file')
  @RequirePermissions('rider:document:read')
  async file(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mimeType, fileName } = await this.riders.documentFile(id, documentId);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      // Personal identity documents must never be cached by a shared proxy.
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(buffer);
  }

  @Post(':id/documents/:documentId/review')
  @RequirePermissions('rider:approve')
  review(
    @CurrentUser('staffId') staffId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body(new ZodValidationPipe(ReviewDocumentSchema)) input: ReviewDocumentInput,
  ) {
    return this.riders.reviewDocument({ riderId: id, documentId, staffId, decision: input.decision, note: input.note });
  }

  @Post(':id/approval')
  @RequirePermissions('rider:approve')
  setApproval(
    @CurrentUser('staffId') staffId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetRiderApprovalSchema)) input: SetRiderApprovalInput,
  ) {
    return this.riders.setApproval({ riderId: id, staffId, decision: input.decision, reason: input.reason });
  }
}
