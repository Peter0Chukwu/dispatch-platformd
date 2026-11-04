import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesStaffController } from './deliveries.staff.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  imports: [PricingModule],
  controllers: [DeliveriesController, DeliveriesStaffController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
