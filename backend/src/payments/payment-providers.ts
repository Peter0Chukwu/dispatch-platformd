import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';

/**
 * PAYMENT PROVIDERS
 * ─────────────────────────────────────────────────────────────────────────────
 * One interface, two real gateways, and an honest development mode.
 *
 * In DEVELOPMENT the gateway is never called: `initialize` returns no
 * authorisation URL and the platform exposes a simulator endpoint that settles the
 * payment through *exactly* the same code path a real webhook uses. That is the
 * only way simulated money can exist — and the API refuses to serve that endpoint
 * when NODE_ENV is production.
 *
 * In SANDBOX/LIVE the calls below are the real ones. Nothing is faked: if the key
 * is wrong the provider answers with an error and the customer is told.
 */
export interface InitializeInput {
  reference: string;
  amountKobo: bigint;
  email: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeResult {
  authorizationUrl: string | null;
  /** Development only: the amount the simulator will charge. */
  simulated: boolean;
}

export interface VerifyResult {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  providerTransactionId: string | null;
  amountKobo: bigint | null;
  feeKobo: bigint;
  channel: string | null;
  raw: unknown;
}

export interface PaymentProviderAdapter {
  readonly key: 'PAYSTACK' | 'FLUTTERWAVE';
  initialize(input: InitializeInput): Promise<InitializeResult>;
  verify(reference: string): Promise<VerifyResult>;
  /** Constant-time comparison of the provider's signature over the raw body. */
  verifySignature(rawBody: string, headers: Record<string, string | undefined>): boolean;
  /** Which header carries the provider event id (dedupe key). */
  eventIdFrom(rawBody: string, headers: Record<string, string | undefined>): string | null;
  eventTypeFrom(rawBody: string): string | null;
  /** The provider's own reference for the transaction described by a webhook. */
  referenceFrom(rawBody: string): string | null;
}

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

@Injectable()
export class PaystackProvider implements PaymentProviderAdapter {
  readonly key = 'PAYSTACK' as const;
  private readonly logger = new Logger('Paystack');

  constructor(private readonly config: AppConfig) {}

  private get secret(): string {
    return this.config.paystackSecretKey;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    if (this.config.paymentsMode === 'DEVELOPMENT' || !this.secret) {
      return { authorizationUrl: null, simulated: true };
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: input.reference,
        amount: Number(input.amountKobo),
        currency: 'NGN',
        email: input.email,
        callback_url: input.callbackUrl,
        metadata: input.metadata ?? {},
      }),
    });

    const body = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string };
    };
    if (!response.ok || !body.status || !body.data?.authorization_url) {
      this.logger.error(`Paystack initialize failed: ${body.message ?? response.status}`);
      throw AppError.conflict(
        body.message ?? 'Paystack could not start this payment. Please try again.',
        'PAYMENT_PROVIDER_ERROR',
      );
    }
    return { authorizationUrl: body.data.authorization_url, simulated: false };
  }

  async verify(reference: string): Promise<VerifyResult> {
    if (this.config.paymentsMode === 'DEVELOPMENT' || !this.secret) {
      throw AppError.conflict(
        'Paystack verification is unavailable in DEVELOPMENT mode. Use the simulator.',
        'PAYMENT_SIMULATED',
      );
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.secret}` } },
    );
    const body = (await response.json()) as {
      status?: boolean;
      data?: {
        status?: string;
        id?: number;
        amount?: number;
        fees?: number;
        channel?: string;
      };
    };
    const data = body.data ?? {};
    return {
      status:
        data.status === 'success' ? 'SUCCESS' : data.status === 'failed' ? 'FAILED' : 'PENDING',
      providerTransactionId: data.id ? String(data.id) : null,
      amountKobo: typeof data.amount === 'number' ? BigInt(data.amount) : null,
      feeKobo: BigInt(data.fees ?? 0),
      channel: data.channel ?? null,
      raw: body,
    };
  }

  /** Paystack signs the raw body with HMAC-SHA512 using the secret key. */
  verifySignature(rawBody: string, headers: Record<string, string | undefined>): boolean {
    const signature = headers['x-paystack-signature'];
    if (!signature || !this.secret) return false;
    const expected = createHmac('sha512', this.secret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }

  eventIdFrom(rawBody: string): string | null {
    const parsed = this.parse(rawBody);
    const data = parsed?.data as { id?: number | string } | undefined;
    const event = parsed?.event as string | undefined;
    if (!data?.id || !event) return null;
    return `${event}:${data.id}`;
  }

  eventTypeFrom(rawBody: string): string | null {
    return (this.parse(rawBody)?.event as string | undefined) ?? null;
  }

  referenceFrom(rawBody: string): string | null {
    const data = this.parse(rawBody)?.data as { reference?: string } | undefined;
    return data?.reference ?? null;
  }

  private parse(rawBody: string): Record<string, unknown> | null {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

@Injectable()
export class FlutterwaveProvider implements PaymentProviderAdapter {
  readonly key = 'FLUTTERWAVE' as const;
  private readonly logger = new Logger('Flutterwave');

  constructor(private readonly config: AppConfig) {}

  private get secret(): string {
    return this.config.flutterwaveSecretKey;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    if (this.config.paymentsMode === 'DEVELOPMENT' || !this.secret) {
      return { authorizationUrl: null, simulated: true };
    }

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: Number(input.amountKobo) / 100,
        currency: 'NGN',
        redirect_url: input.callbackUrl,
        customer: { email: input.email },
        meta: input.metadata ?? {},
      }),
    });
    const body = (await response.json()) as {
      status?: string;
      message?: string;
      data?: { link?: string };
    };
    if (body.status !== 'success' || !body.data?.link) {
      this.logger.error(`Flutterwave initialize failed: ${body.message ?? response.status}`);
      throw AppError.conflict(
        body.message ?? 'Flutterwave could not start this payment. Please try again.',
        'PAYMENT_PROVIDER_ERROR',
      );
    }
    return { authorizationUrl: body.data.link, simulated: false };
  }

  async verify(reference: string): Promise<VerifyResult> {
    if (this.config.paymentsMode === 'DEVELOPMENT' || !this.secret) {
      throw AppError.conflict(
        'Flutterwave verification is unavailable in DEVELOPMENT mode. Use the simulator.',
        'PAYMENT_SIMULATED',
      );
    }

    // Flutterwave verifies by transaction id; we look the transaction up by our
    // own tx_ref, which their search endpoint accepts.
    const response = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.secret}` } },
    );
    const body = (await response.json()) as {
      status?: string;
      data?: { status?: string; id?: number; amount?: number; app_fee?: number; payment_type?: string };
    };
    const data = body.data ?? {};
    const paid = data.status === 'successful';
    return {
      status: paid ? 'SUCCESS' : data.status === 'failed' ? 'FAILED' : 'PENDING',
      providerTransactionId: data.id ? String(data.id) : null,
      amountKobo: typeof data.amount === 'number' ? BigInt(Math.round(data.amount * 100)) : null,
      feeKobo: data.app_fee ? BigInt(Math.round(data.app_fee * 100)) : 0n,
      channel: data.payment_type ?? null,
      raw: body,
    };
  }

  /** Flutterwave sends the configured secret hash in `verif-hash`. */
  verifySignature(rawBody: string, headers: Record<string, string | undefined>): boolean {
    void rawBody;
    const hash = headers['verif-hash'];
    const expected = this.config.flutterwaveWebhookHash;
    if (!hash || !expected) return false;
    return safeEqual(expected, hash);
  }

  eventIdFrom(rawBody: string, headers: Record<string, string | undefined>): string | null {
    // Flutterwave does not send a stable event id; their transaction id plus the
    // status is the closest thing, and it is unique per transaction event.
    const parsed = this.parse(rawBody);
    const data = parsed?.data as { id?: number | string; status?: string } | undefined;
    if (!data?.id) return headers['flutterwave-signature'] ?? null;
    return `${data.id}:${data.status ?? 'unknown'}`;
  }

  eventTypeFrom(rawBody: string): string | null {
    const parsed = this.parse(rawBody);
    return (
      (parsed?.['event.type'] as string | undefined) ??
      (parsed?.event as string | undefined) ??
      'charge.completed'
    );
  }

  referenceFrom(rawBody: string): string | null {
    const data = this.parse(rawBody)?.data as { tx_ref?: string } | undefined;
    return data?.tx_ref ?? null;
  }

  private parse(rawBody: string): Record<string, unknown> | null {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
