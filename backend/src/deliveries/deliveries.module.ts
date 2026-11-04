import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesStaffController } from './deliveries.staff.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  imports: [PricingModule, DispatchModule],
  controllers: [DeliveriesController, DeliveriesStaffController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
