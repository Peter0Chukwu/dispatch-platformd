import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationService } from '../src/auth/verification.service';
import { MessagingService } from '../src/messaging/messaging.service';

/**
 * PHONE CONFIRMATION WITH NO SMS PROVIDER
 *
 * Phone confirmation is optional: booking needs an email address, not a handset. The
 * failure this guards against is a screen that says "we sent you a 6-digit code" when
 * no code was sent and none can be — in production the API does not hand the code back
 * either, so the customer types nothing at a dead end and concludes the product is
 * broken. Refusing out loud is the honest behaviour.
 */

const configWith = (values: Record<string, unknown>) =>
  ({
    get: (key: string, _opts?: unknown) => values[key],
  }) as never;

const user = { id: 'user-1', phone: '+2348031234567', firstName: 'Ada' };

describe('phone confirmation when texting is switched off', () => {
  let messaging: MessagingService;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says so in production instead of pretending a code went out', async () => {
    messaging = new MessagingService(configWith({ SMS_MODE: 'CONSOLE' }) as never);
    const prisma = { verificationToken: { updateMany: vi.fn(), create: vi.fn() } };
    const service = new VerificationService(
      prisma as never,
      messaging,
      {} as never,
      configWith({ NODE_ENV: 'production' }) as never,
    );

    await expect(service.sendPhoneOtp(user)).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE' });
    // Nothing was written and nothing was attempted: there is no code to leak.
    expect(prisma.verificationToken.create).not.toHaveBeenCalled();
  });

  it('still completes outside production, where the code is shown on screen', async () => {
    messaging = new MessagingService(configWith({ SMS_MODE: 'CONSOLE' }) as never);
    const prisma = {
      verificationToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'tok-1' }),
      },
    };
    const service = new VerificationService(
      prisma as never,
      messaging,
      {} as never,
      configWith({ NODE_ENV: 'development' }) as never,
    );

    const result = await service.sendPhoneOtp(user);
    expect(result.devCode).toMatch(/^\d{6}$/);
    // CONSOLE mode is honest about not delivering.
    expect(result.delivered).toBe(false);
  });
});
