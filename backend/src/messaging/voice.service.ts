import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.config';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { AuthPrincipal } from '../auth/auth.types';

export interface MaskedCall {
  /** The number both parties dial. */
  proxyNumber: string;
  expiresAt: Date;
  provider: string;
}

/**
 * MASKED VOICE CALLING
 *
 * The customer and the rider each dial a proxy number and the provider bridges
 * them, so neither ever learns the other's number. That is the only honest way to
 * keep the "numbers are never revealed" promise *and* let them talk.
 *
 * It is NOT connected yet: it needs a Nigerian provider account with number
 * masking (Termii or Africa's Talking), which requires KYC, a rented number pool
 * and per-minute billing. Until those keys exist this service refuses — loudly
 * and specifically — rather than handing out a number that will not ring. A fake
 * number would be worse than no feature: the customer would tap Call, hear
 * nothing, and stop trusting the button.
 *
 * The chat thread is unaffected and is the working way to talk today.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger('Voice');

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  get mode(): string {
    return this.config.get('VOICE_MODE', { infer: true });
  }

  get connected(): boolean {
    return this.mode !== 'CONSOLE';
  }

  /** What the two screens show before anyone taps anything. */
  status() {
    return {
      connected: this.connected,
      provider: this.mode,
      reason: this.connected
        ? null
        : 'Masked calling is not connected yet. Message the other person in the app — it is free and instant.',
    };
  }

  /**
   * Ask the provider for a masked pairing for this delivery.
   *
   * The session row is created even when the provider is absent only once a real
   * proxy number exists — so no row ever claims a call that cannot happen.
   */
  async requestCall(user: AuthPrincipal, deliveryId: string): Promise<MaskedCall> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, customerId: true, riderId: true },
    });
    if (!delivery) throw AppError.notFound('Delivery not found');

    const isCustomer = user.type === 'CUSTOMER' && delivery.customerId === user.customerId;
    const isRider = user.type === 'RIDER' && !!user.riderId && delivery.riderId === user.riderId;
    if (!isCustomer && !isRider) throw AppError.notFound('Delivery not found');

    if (!this.connected) {
      throw AppError.conflict(this.status().reason!);
    }
    if (!delivery.riderId) {
      throw AppError.conflict('Nobody is carrying this delivery yet.');
    }

    // A live session from the last few hours is reused so a second tap does not
    // rent a second proxy number.
    const live = await this.prisma.callSession.findFirst({
      where: { deliveryId, releasedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (live) {
      return { proxyNumber: live.proxyNumber, expiresAt: live.expiresAt, provider: live.provider };
    }

    // The provider call lives here, behind this method, once VOICE_MODE=TERMII.
    // Deliberately unimplemented rather than guessed: inventing an API shape
    // would produce code that looks finished and fails on first contact.
    throw AppError.conflict(
      `The ${this.mode} voice provider is selected but its adapter is not implemented yet. ` +
        'Send the provider documentation and this is a one-method change.',
    );
  }

  /** Released when the delivery ends, so the proxy number returns to the pool. */
  async releaseFor(deliveryId: string): Promise<void> {
    await this.prisma.callSession.updateMany({
      where: { deliveryId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    this.logger.log(`Released masked-call session(s) for delivery ${deliveryId.slice(0, 8)}`);
  }
}
