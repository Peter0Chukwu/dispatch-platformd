import { Module } from '@nestjs/common';
import { MapsService } from './maps.service';
import { PricingService } from './pricing.service';
import { PromotionsService } from './promotions.service';

@Module({
  providers: [MapsService, PromotionsService, PricingService],
  exports: [MapsService, PromotionsService, PricingService],
})
export class PricingModule {}
