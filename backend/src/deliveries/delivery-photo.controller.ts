import { Controller, Get, Param, ParseUUIDPipe, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { DeliveriesService } from './deliveries.service';

/**
 * Serving the parcel photo.
 *
 * It lives in its own controller because the customer-facing one is
 * `@RequireType('CUSTOMER')` at class level, and this single route has to answer
 * for three portals: the customer who booked, the rider carrying (or being
 * offered) the parcel, and staff with delivery:read.
 *
 * The image is NOT public. There is no share token, no unguessable-only URL:
 * every request is authenticated and ownership is decided in the service, which
 * returns NOT FOUND for anyone else so the route cannot be used to probe which
 * delivery ids exist.
 */
@Controller('deliveries')
@RequireType('CUSTOMER', 'RIDER', 'STAFF')
export class DeliveryPhotoController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get(':id/package-photo')
  @RateLimit({ points: 120, windowSeconds: 60, keyBy: 'ip+route' })
  async packagePhoto(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, mimeType } = await this.deliveries.readPackagePhoto(user, id);
    res.set({
      'Content-Type': mimeType,
      // private: a shared cache must never keep one customer's parcel photo.
      'Cache-Control': 'private, max-age=300',
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
}
