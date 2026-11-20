import { Body, Controller, Get, Post } from '@nestjs/common';
import { testMessageSchema, type TestMessageInput } from '@dispatch/shared';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { MessagingService } from '../messaging/messaging.service';

/**
 * IS MESSAGING ACTUALLY WORKING?
 *
 * The question comes up every time a customer says "I never got the code", and the
 * honest answer is usually one of: no API key, a sender ID the provider has not
 * approved, the wrong route, or an empty wallet. None of those are visible from the
 * app, all of them are visible from here.
 *
 * STAFF only, and no extra permission is required on purpose: sending one test
 * message to your own phone is not a privileged act, and gating it behind a
 * fine-grained right would mean the one person who needs it (the owner) cannot use it.
 */
@Controller('admin/messaging')
@RequireType('STAFF')
export class AdminMessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** Which driver is configured for each channel, and whether it can deliver. */
  @Get('status')
  status() {
    return this.messaging.status();
  }

  /**
   * Send one real message and report the provider's own answer.
   *
   * Rate-limited hard: this costs money per send when SMS is live, and the button is
   * in a browser that someone might lean on.
   */
  @Post('test')
  @RateLimit({ points: 5, windowSeconds: 60, keyBy: 'ip+route' })
  test(@Body(new ZodValidationPipe(testMessageSchema)) input: TestMessageInput) {
    return this.messaging.sendTest(input.channel, input.to);
  }
}
