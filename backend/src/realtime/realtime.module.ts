import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Live channel, available everywhere.
 *
 * Global on purpose: dispatch, deliveries, admin and rider jobs all need to push
 * an event, and threading an import through five modules would only add places to
 * get it wrong. The gateway is stateless — it only forwards — so sharing it is safe.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
