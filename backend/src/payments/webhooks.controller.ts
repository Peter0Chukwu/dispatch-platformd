import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AppError } from '../common/errors/app-error';
import { PaymentsService } from './payments.service';

/**
 * PAYMENT WEBHOOKS
 * ─────────────────────────────────────────────────────────────────────────────
 * These two routes are public by necessity — Paystack and Flutterwave have no
 * session. That is why nothing here trusts the body: the signature is checked
 * against the *raw* bytes (which is why `rawBody` is enabled on the app), and the
 * payload is then re-verified with the provider's own API before a kobo moves.
 *
 * Both routes always answer 200 when the delivery was genuine, even if we chose to
 * ignore it. A non-2xx makes the provider retry for hours, which turns one odd
 * event into an outage of noise.
 */
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('paystack')
  @HttpCode(200)
  paystack(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    return this.handle('PAYSTACK', request, headers);
  }

  @Public()
  @Post('flutterwave')
  @HttpCode(200)
  flutterwave(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    return this.handle('FLUTTERWAVE', request, headers);
  }

  private handle(
    provider: 'PAYSTACK' | 'FLUTTERWAVE',
    request: RawBodyRequest<Request>,
    headers: Record<string, string | undefined>,
  ) {
    // The raw bytes are what the signature covers; a re-serialised JSON body would
    // not match byte for byte. If the runtime did not keep them, we refuse rather
    // than verify something weaker.
    const raw = request.rawBody?.toString('utf8');
    if (!raw) throw AppError.unauthorized('Webhook body could not be read for verification');
    void headers['content-type'];
    return this.payments.handleWebhook(provider, raw, headers);
  }
}
