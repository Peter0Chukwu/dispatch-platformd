import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { MapsController } from './maps.controller';

/** Public address lookup. The provider logic itself stays in PricingModule. */
@Module({
  imports: [PricingModule],
  controllers: [MapsController],
})
export class MapsModule {}
