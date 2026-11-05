import { Module } from '@nestjs/common';
import { RiderJobsController } from './rider-jobs.controller';
import { RiderJobsService } from './rider-jobs.service';
import { StorageModule } from '../storage/storage.module';
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  // Storage turns the rider's proof-of-delivery photo into a private key; dispatch
  // is what re-offers waiting work the moment a rider finishes (or fails) a job.
  imports: [StorageModule, DispatchModule],
  controllers: [RiderJobsController],
  providers: [RiderJobsService],
})
export class RiderJobsModule {}
