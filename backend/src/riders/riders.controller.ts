import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  locationPingSchema,
  riderAvailabilitySchema,
  uploadDocumentSchema,
  type LocationPingInput,
} from '@dispatch/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RidersService } from './riders.service';
import { AppConfig } from '../config/app.config';

/** Rider self-service. Every route is RIDER-only and scoped to the caller. */
@Controller('rider')
@RequireType('RIDER')
export class RidersController {
  constructor(
    private readonly riders: RidersService,
    private readonly config: AppConfig,
  ) {}

  /**
   * How often the app should report position, straight from configuration.
   * The rider app reads this instead of hardcoding an interval, so changing
   * TRACKING_PING_INTERVAL_SECONDS in `.env` changes every phone on next launch.
   */
  @Get('location/config')
  locationConfig() {
    return {
      pingIntervalSeconds: this.config.trackingPingIntervalSeconds,
      retentionDays: this.config.locationRetentionDays,
      staleAfterSeconds: 600,
    };
  }

  @Get('profile')
  profile(@CurrentUser('riderId') riderId: string) {
    return this.riders.profile(riderId);
  }

  @Post('availability')
  @RateLimit({ points: 30, windowSeconds: 60, keyBy: 'ip+route' })
  setAvailability(
    @CurrentUser('riderId') riderId: string,
    @Body(new ZodValidationPipe(riderAvailabilitySchema)) input: { availability: 'ONLINE' | 'OFFLINE' },
  ) {
    return this.riders.setAvailability(riderId, input.availability);
  }

  @Get('documents')
  async documents(@CurrentUser('riderId') riderId: string) {
    const profile = await this.riders.profile(riderId);
    return {
      documents: profile.documents,
      required: profile.requiredDocuments,
      missing: profile.missingDocuments,
      canGoOnline: profile.canGoOnline,
    };
  }

  @Post('documents')
  @RateLimit({ points: 10, windowSeconds: 300, keyBy: 'ip+route' })
  upload(
    @CurrentUser('riderId') riderId: string,
    @Body(new ZodValidationPipe(uploadDocumentSchema)) input: z.infer<typeof uploadDocumentSchema>,
  ) {
    return this.riders.uploadDocument(riderId, input);
  }

  /** Location ping — the rider app sends these every ~30 s while online. */
  @Post('location')
  @RateLimit({ points: 120, windowSeconds: 60, keyBy: 'ip+route' })
  ping(
    @CurrentUser('riderId') riderId: string,
    @Body(new ZodValidationPipe(locationPingSchema)) input: LocationPingInput,
  ) {
    return this.riders.ping(riderId, input);
  }

  @Get('earnings')
  earnings(@CurrentUser('riderId') riderId: string) {
    return this.riders.earningsSummary(riderId);
  }
}
