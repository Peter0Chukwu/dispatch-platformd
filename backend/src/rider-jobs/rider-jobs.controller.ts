import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  advanceJobSchema,
  completeJobSchema,
  failJobSchema,
  proofPhotoSchema,
  type CompleteJobInput,
} from '@dispatch/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RiderJobsService } from './rider-jobs.service';

/** The rider's working day: the current job, its steps, and the history. */
@Controller('rider/jobs')
@RequireType('RIDER')
export class RiderJobsController {
  constructor(private readonly jobs: RiderJobsService) {}

  @Get('active')
  active(@CurrentUser('riderId') riderId: string) {
    return this.jobs.activeJob(riderId);
  }

  @Get()
  history(
    @CurrentUser('riderId') riderId: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.jobs.history(riderId, page ? Number(page) : 1, perPage ? Number(perPage) : 20);
  }

  @Get(':id')
  one(@CurrentUser('riderId') riderId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.jobs.getJob(riderId, id);
  }

  @Post(':id/arrive-pickup')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  arrive(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(advanceJobSchema)) input: z.infer<typeof advanceJobSchema>,
  ) {
    return this.jobs.advance(riderId, id, 'ARRIVE_AT_PICKUP', input);
  }

  @Post(':id/pickup')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  pickUp(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(advanceJobSchema)) input: z.infer<typeof advanceJobSchema>,
  ) {
    return this.jobs.advance(riderId, id, 'PICK_UP', input);
  }

  @Post(':id/start-transit')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  transit(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(advanceJobSchema)) input: z.infer<typeof advanceJobSchema>,
  ) {
    return this.jobs.advance(riderId, id, 'START_TRANSIT', input);
  }

  @Post(':id/arrive-destination')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  arrived(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(advanceJobSchema)) input: z.infer<typeof advanceJobSchema>,
  ) {
    return this.jobs.advance(riderId, id, 'ARRIVE_AT_DESTINATION', input);
  }

  @Post(':id/proof-photo')
  @RateLimit({ points: 20, windowSeconds: 60, keyBy: 'ip+route' })
  uploadProof(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(proofPhotoSchema)) input: z.infer<typeof proofPhotoSchema>,
  ) {
    return this.jobs.uploadProofPhoto(riderId, id, input);
  }

  @Post(':id/complete')
  @RateLimit({ points: 20, windowSeconds: 60, keyBy: 'ip+route' })
  complete(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(completeJobSchema)) input: CompleteJobInput,
  ) {
    return this.jobs.complete(riderId, id, input);
  }

  @Post(':id/fail')
  @RateLimit({ points: 10, windowSeconds: 60, keyBy: 'ip+route' })
  fail(
    @CurrentUser('riderId') riderId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(failJobSchema)) input: { reason: string },
  ) {
    return this.jobs.fail(riderId, id, input.reason);
  }
}
