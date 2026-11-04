import { Module } from '@nestjs/common';
import { RiderJobsController } from './rider-jobs.controller';
import { RiderJobsService } from './rider-jobs.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  // Storage is what turns the rider's proof-of-delivery photo into a private key.
  imports: [StorageModule],
  controllers: [RiderJobsController],
  providers: [RiderJobsService],
})
export class RiderJobsModule {}
