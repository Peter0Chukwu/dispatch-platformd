import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { rejectOfferSchema } from '@dispatch/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { DispatchService } from './dispatch.service';

/**
 * Offers. The list is polled by the rider app while online; Socket.IO push
 * arrives in Phase 6 and this endpoint stays as the fallback.
 */
@Controller('rider/offers')
@RequireType('RIDER')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  list(@CurrentUser('riderId') riderId: string) {
    return this.dispatch.offersForRider(riderId);
  }

  @Post(':id/accept')
  @RateLimit({ points: 30, windowSeconds: 60, keyBy: 'ip+route' })
  accept(@CurrentUser('riderId') riderId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.dispatch.accept(riderId, id);
  }

  @Post(':id/reject')
  @RateLimit({ points: 30, windowSeconds: 60, keyBy: 'ip+route' })
  reject(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(rejectOfferSchema)) input: { reason?: string },
  ) {
    return this.dispatch.reject(riderId, id, input.reason);
  }
}
