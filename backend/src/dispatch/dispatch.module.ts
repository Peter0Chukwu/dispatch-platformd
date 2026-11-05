import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { DispatchScheduler } from './dispatch.scheduler';

@Module({
  controllers: [DispatchController],
  providers: [DispatchService, DispatchScheduler],
  exports: [DispatchService],
})
export class DispatchModule {}
