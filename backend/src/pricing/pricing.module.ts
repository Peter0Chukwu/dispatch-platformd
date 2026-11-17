import { Module } from '@nestjs/common';
import { MapsService } from './maps.service';
import { PricingService } from './pricing.service';
import { PromotionsService } from './promotions.service';
import { SavedLocationsService } from './saved-locations.service';

@Module({
  providers: [MapsService, PromotionsService, PricingService, SavedLocationsService],
  exports: [MapsService, PromotionsService, PricingService, SavedLocationsService],
})
export class PricingModule {}
