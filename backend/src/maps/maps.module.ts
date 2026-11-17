import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { MapsController } from './maps.controller';
import { AdminLocationsController } from './admin-locations.controller';

/**
 * Address lookup (public) and the saved places list (public to read, staff to
 * maintain). The provider logic itself stays in PricingModule.
 */
@Module({
  imports: [PricingModule],
  controllers: [MapsController, AdminLocationsController],
})
export class MapsModule {}
