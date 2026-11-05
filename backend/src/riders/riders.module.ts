import { Module } from '@nestjs/common';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { AdminRidersController } from './admin-riders.controller';
import { AdminRidersService } from './admin-riders.service';
import { StorageModule } from '../storage/storage.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  // Riders upload documents, staff read them back: both need the private store.
  imports: [StorageModule, DispatchModule, TrackingModule],
  controllers: [RidersController, AdminRidersController],
  providers: [RidersService, AdminRidersService],
  exports: [RidersService],
})
export class RidersModule {}
