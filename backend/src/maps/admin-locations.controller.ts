import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { AuditService } from '../audit/audit.service';
import {
  SavedLocationsService,
  createSavedLocationSchema,
  updateSavedLocationSchema,
  type CreateSavedLocationInput,
  type UpdateSavedLocationInput,
} from '../pricing/saved-locations.service';
import type { AuthPrincipal } from '../auth/auth.types';

/**
 * ADMIN — the saved places list.
 *
 * `settings:read` and `settings:write`: these are settings, not money and not
 * people, and every number that comes out of them (a fare, a dispatch radius) is
 * recomputed server-side from the coordinates. Getting them wrong changes a
 * suggestion, never a balance.
 *
 * Every change is audited, because "why did the fare for Ikpoba Hill change?"
 * needs an answer that is not a guess.
 */
@Controller('admin/locations')
@RequireType('STAFF')
export class AdminLocationsController {
  constructor(
    private readonly locations: SavedLocationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('settings:read')
  list() {
    return this.locations.list();
  }

  @Post()
  @RequirePermissions('settings:write')
  @RateLimit({ points: 60, windowSeconds: 3600, keyBy: 'ip+route' })
  async create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createSavedLocationSchema)) body: CreateSavedLocationInput,
  ) {
    const row = await this.locations.create(body, user.userId);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'SAVED_LOCATION_CREATED',
      entityType: 'SavedLocation',
      entityId: row.id,
      after: row,
    });
    return row;
  }

  @Patch(':id')
  @RequirePermissions('settings:write')
  @RateLimit({ points: 120, windowSeconds: 3600, keyBy: 'ip+route' })
  async update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSavedLocationSchema)) body: UpdateSavedLocationInput,
  ) {
    const row = await this.locations.update(id, body, user.userId);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'SAVED_LOCATION_UPDATED',
      entityType: 'SavedLocation',
      entityId: id,
      after: { changes: body, row },
    });
    return row;
  }

  /**
   * Hides a place rather than deleting the record — see SavedLocationsService.
   * The response says which happened so the screen can word it honestly.
   */
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('settings:write')
  async hide(@CurrentUser() user: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.locations.deactivate(id, user.userId);
    await this.audit.record({
      actorUserId: user.userId,
      action: 'SAVED_LOCATION_HIDDEN',
      entityType: 'SavedLocation',
      entityId: id,
      after: row,
    });
    return { message: `${row.name} is hidden from the booking form.`, data: row };
  }
}
