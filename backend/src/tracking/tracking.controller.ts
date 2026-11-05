import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { TrackingService } from './tracking.service';

/**
 * Customer tracking routes. Ownership is enforced inside the service — a customer
 * asking for somebody else's tracking gets a 404, not a look at the map.
 */
@Controller()
@RequireType('CUSTOMER')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('deliveries/:id/track')
  track(@CurrentUser('customerId') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.trackForCustomer(customerId, id);
  }

  @Post('deliveries/:id/share-link')
  createShareLink(@CurrentUser('customerId') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.createShareLink(customerId, id);
  }

  @Get('deliveries/:id/share-link')
  async getShareLink(@CurrentUser('customerId') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    const link = await this.tracking.createShareLink(customerId, id);
    return link;
  }

  @Post('deliveries/:id/share-link/revoke')
  revokeShareLink(@CurrentUser('customerId') customerId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.revokeShareLink(customerId, id);
  }
}

/**
 * PUBLIC tracking by token. No account, no session, no socket — the token *is* the
 * credential, it expires, and the customer can rotate it. It reveals the parcel's
 * position and the rider's first name, and nothing about the people involved.
 */
@Controller('track')
@Public()
export class PublicTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':token')
  track(@Param('token') token: string) {
    return this.tracking.trackByToken(token);
  }
}

/** The dispatcher's live map. Staff only, permission `tracking:read`. */
@Controller('admin/tracking')
export class AdminTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('live')
  @RequirePermissions('tracking:read')
  live(@Query('focus') focus?: string) {
    void focus; // reserved: filter by zone/branch once zones are drawn on the map
    return this.tracking.liveMap();
  }
}
