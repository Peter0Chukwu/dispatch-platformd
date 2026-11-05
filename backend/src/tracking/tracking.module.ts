import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { TrackingService } from './tracking.service';
import { LocationRetentionScheduler } from './location-retention.scheduler';
import { AdminTrackingController, PublicTrackingController, TrackingController } from './tracking.controller';

/**
 * Phase 8: live tracking.
 *
 * Reads positions the rider app already wrote, measures ETA with MapsService, and
 * pushes updates over the socket. Holds no state of its own — every answer is
 * computed from the database on demand, so a restarted API shows the same map.
 */
@Module({
  imports: [PricingModule],
  controllers: [TrackingController, PublicTrackingController, AdminTrackingController],
  providers: [TrackingService, LocationRetentionScheduler],
  exports: [TrackingService],
})
export class TrackingModule {}
