import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingService, toTermiiNumber } from '../src/messaging/messaging.service';

/**
 * Outbound SMS and email.
 *
 * These drivers were the last thing standing between a customer and a working
 * sign-up: in production the console driver printed the code to a server log the
 * customer cannot read, and selecting a real provider threw "configured in Phase 7"
 * into a 500. Both of those failures looked identical from the browser — a
 * verification screen that never works.
 */

const configWith = (values: Record<string, unknown>) =>
  ({
    get: (key: string, _opts?: unknown) => values[key],
  }) as never;

const sms = {
  to: '+2348031234567',
  kind: 'PHONE_OTP' as const,
  body: '123456 is your Traders Welfare verification code.',
};

const email = {
  to: 'ada@example.com',
  kind: 'EMAIL_VERIFICATION' as const,
  subject: 'Verify your email address',
  body: 'Hello Ada, confirm your email: https://twl.example.com/verify?token=abc',
};

describe('phase 7 — outbound messages', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('SMS through Termii', () => {
    const termiiConfig = configWith({
      SMS_MODE: 'TERMII',
      EMAIL_MODE: 'CONSOLE',
      TERMII_API_KEY: 'tl-key',
      TERMII_SENDER_ID: 'TWL',
      TERMII_CHANNEL: 'dnd',
    });

    it('posts the message to the Nigerian endpoint with the transactional route', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"message_id":"m1","balance":12}' });

      const result = await new MessagingService(termiiConfig).sendSms(sms);

      expect(result).toMatchObject({ delivered: true, driver: 'termii' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.ng.termii.com/api/sms/send');
      const body = JSON.parse(init.body as string);
      // Termii wants international format without the plus.
      expect(body.to).toBe('2348031234567');
      expect(body.from).toBe('TWL');
      expect(body.channel).toBe('dnd');
      expect(body.type).toBe('plain');
      expect(body.sms).toContain('123456');
      expect(body.api_key).toBe('tl-key');
    });

    it('reports a refusal instead of throwing, so registration still completes', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 402, text: async () => 'Insufficient balance' });

      const result = await new MessagingService(termiiConfig).sendSms(sms);

      expect(result.delivered).toBe(false);
      expect(result.reason).toContain('402');
    });

    it('treats a 200 carrying an error body as a failure', async () => {
      // Termii answers 200 with an error object for some rejections; trusting the
      // status code alone would silently record a message nobody received.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"code":"400","message":"Invalid sender id"}',
      });

      const result = await new MessagingService(termiiConfig).sendSms(sms);
      expect(result.delivered).toBe(false);
    });

    it('says so plainly when the key is missing, and calls nobody', async () => {
      const noKey = configWith({ SMS_MODE: 'TERMII', EMAIL_MODE: 'CONSOLE', TERMII_API_KEY: '' });

      const result = await new MessagingService(noKey).sendSms(sms);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.delivered).toBe(false);
      expect(result.reason).toContain('TERMII_API_KEY');
    });

    it('normalises every shape of Nigerian number Termii will accept', () => {
      expect(toTermiiNumber('+2348031234567')).toBe('2348031234567');
      expect(toTermiiNumber('08031234567')).toBe('2348031234567');
      expect(toTermiiNumber('2348031234567')).toBe('2348031234567');
      expect(toTermiiNumber('0803 123 4567')).toBe('2348031234567');
    });
  });

  describe('email through Resend', () => {
    const resendConfig = configWith({
      SMS_MODE: 'CONSOLE',
      EMAIL_MODE: 'RESEND',
      RESEND_API_KEY: 're-key',
      EMAIL_FROM: 'Traders Welfare <no-reply@twl.example.com>',
    });

    it('posts a plain-text and html body with the bearer key', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"e1"}' });

      const result = await new MessagingService(resendConfig).sendEmail(email);

      expect(result).toMatchObject({ delivered: true, driver: 'resend' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re-key');
      const body = JSON.parse(init.body as string);
      expect(body.to).toEqual(['ada@example.com']);
      expect(body.from).toBe('Traders Welfare <no-reply@twl.example.com>');
      expect(body.text).toContain('/verify?token=abc');
      // The link has to be clickable in the HTML part, in a mail client that strips nothing.
      expect(body.html).toContain('href="https://twl.example.com/verify?token=abc"');
    });

    it('escapes the message so a name cannot inject markup', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

      await new MessagingService(resendConfig).sendEmail({
        ...email,
        body: 'Hello <script>alert(1)</script>',
      });

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.html).not.toContain('<script>');
      expect(body.html).toContain('&lt;script&gt;');
    });

    it('reports a Resend rejection without throwing', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"message":"The twl.example.com domain is not verified"}',
      });

      const result = await new MessagingService(resendConfig).sendEmail(email);
      expect(result.delivered).toBe(false);
      expect(result.reason).toContain('403');
    });
  });

  describe('console mode', () => {
    const consoleConfig = configWith({ SMS_MODE: 'CONSOLE', EMAIL_MODE: 'CONSOLE' });

    it('never claims to have delivered anything', async () => {
      const service = new MessagingService(consoleConfig);

      await expect(service.sendSms(sms)).resolves.toMatchObject({ delivered: false, driver: 'console' });
      await expect(service.sendEmail(email)).resolves.toMatchObject({ delivered: false, driver: 'console' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('describes itself in one line for the boot log', () => {
      expect(new MessagingService(consoleConfig).describe()).toBe('SMS: console only · Email: console only');
    });
  });
});
