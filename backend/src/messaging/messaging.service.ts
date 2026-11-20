import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.config';

export interface OutboundMessage {
  to: string;
  subject?: string;
  body: string;
  /** Only used by the console driver to label the log line. */
  kind:
    | 'EMAIL_VERIFICATION'
    | 'PHONE_OTP'
    | 'PASSWORD_RESET'
    | 'WELCOME'
    | 'SECURITY_ALERT'
    /** A dispatch offer, sent because a rider may not have the app open. */
    | 'DISPATCH_OFFER'
    /** Sent from the admin console's messaging test. */
    | 'SMS_TEST'
    | 'EMAIL_TEST';
}

/**
 * What actually happened to a message.
 *
 * `delivered: false` is not an exception — it is a fact the caller has to be able
 * to show. "We sent you a code" when nothing left the building is the single most
 * confusing thing a sign-up flow can say, and it is exactly what a console-only
 * driver used to cause in production.
 */
export interface DeliveryResult {
  delivered: boolean;
  /** 'console' | 'termii' | 'resend' — what tried to deliver it. */
  driver: string;
  /** Safe to log, never contains a key. */
  reason?: string;
  /**
   * What the provider actually said, when it said anything. "Termii responded 400"
   * is not an explanation; "Sender ID not found" is, and it is the difference between
   * a five-minute fix and an evening of guessing. Truncated and never includes the
   * key, because the request body is never echoed back.
   */
  providerStatus?: number;
  providerMessage?: string;
}

/**
 * OUTBOUND COMMUNICATIONS
 *
 * Two drivers each, chosen by environment:
 *
 *   SMS_MODE   CONSOLE (print to the log) | TERMII  (Nigerian SMS, transactional route)
 *   EMAIL_MODE CONSOLE (print to the log) | RESEND  (transactional email)
 *
 * A delivery failure never throws. It returns `delivered: false` with a reason,
 * which the verification flows pass to the browser so the screen can say "we could
 * not send that code — try again" instead of pretending. A failing SMS gateway must
 * not turn a registration into a 500 either: the account exists either way, and the
 * customer can request another code.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get smsMode(): string {
    return this.config.get('SMS_MODE', { infer: true });
  }

  private get emailMode(): string {
    return this.config.get('EMAIL_MODE', { infer: true });
  }

  /** True when an SMS would actually leave the building. */
  get smsDelivers(): boolean {
    return this.smsMode === 'TERMII' && !!this.config.get('TERMII_API_KEY', { infer: true });
  }

  /** True when an email would actually leave the building. */
  get emailDelivers(): boolean {
    return this.emailMode === 'RESEND' && !!this.config.get('RESEND_API_KEY', { infer: true });
  }

  /** One line for the boot log, so the owner never has to guess. */
  describe(): string {
    const sms = this.smsDelivers ? `Termii (${this.config.get('TERMII_CHANNEL', { infer: true })})` : 'console only';
    const email = this.emailDelivers ? 'Resend' : 'console only';
    return `SMS: ${sms} · Email: ${email}`;
  }

  // ── SMS ──────────────────────────────────────────────────────────────────

  async sendSms(message: OutboundMessage): Promise<DeliveryResult> {
    if (this.smsMode === 'CONSOLE') {
      this.logger.log(`📱 SMS → ${message.to} [${message.kind}] :: ${message.body}`);
      return { delivered: false, driver: 'console', reason: 'SMS_MODE=CONSOLE — printed to the log, not sent' };
    }

    const apiKey = this.config.get('TERMII_API_KEY', { infer: true });
    if (!apiKey) {
      this.logger.error('SMS_MODE=TERMII but TERMII_API_KEY is empty — nothing was sent');
      return { delivered: false, driver: 'termii', reason: 'TERMII_API_KEY is not set' };
    }

    try {
      const response = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Termii wants international format without the plus.
          to: toTermiiNumber(message.to),
          from: this.config.get('TERMII_SENDER_ID', { infer: true }),
          sms: message.body,
          type: 'plain',
          // The DND route is the one Termii permits for OTP and transactional
          // traffic; the generic route is for promotional messages and does not
          // reach numbers with do-not-disturb active.
          channel: this.config.get('TERMII_CHANNEL', { infer: true }),
          api_key: apiKey,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const body = (await response.text()).slice(0, 500);
      if (!response.ok) {
        this.logger.error(`Termii refused an SMS (${response.status}): ${body}`);
        return {
          delivered: false,
          driver: 'termii',
          reason: `Termii responded ${response.status}`,
          providerStatus: response.status,
          providerMessage: summariseProviderReply(body),
        };
      }
      // Termii answers 200 with an error body for some failures, so the payload is
      // read rather than trusting the status code alone.
      if (/"code"\s*:\s*"?(4\d\d|5\d\d)/.test(body) || /invalid|not found|insufficient/i.test(body)) {
        this.logger.error(`Termii returned an error for an SMS: ${body}`);
        return {
          delivered: false,
          driver: 'termii',
          reason: 'Termii rejected the message',
          providerStatus: response.status,
          providerMessage: summariseProviderReply(body),
        };
      }
      this.logger.log(`📱 SMS sent to ${maskPhone(message.to)} [${message.kind}]`);
      return { delivered: true, driver: 'termii' };
    } catch (error) {
      this.logger.error(`Termii SMS failed: ${(error as Error).message}`);
      return { delivered: false, driver: 'termii', reason: (error as Error).message };
    }
  }

  // ── Email ────────────────────────────────────────────────────────────────

  async sendEmail(message: OutboundMessage): Promise<DeliveryResult> {
    if (this.emailMode === 'CONSOLE') {
      this.logger.log(
        `✉️  EMAIL → ${message.to} [${message.kind}] ${message.subject ?? ''} :: ${message.body}`,
      );
      return { delivered: false, driver: 'console', reason: 'EMAIL_MODE=CONSOLE — printed to the log, not sent' };
    }

    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });
    if (!apiKey) {
      this.logger.error('EMAIL_MODE=RESEND but RESEND_API_KEY is empty — nothing was sent');
      return { delivered: false, driver: 'resend', reason: 'RESEND_API_KEY is not set' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from: this.config.get('EMAIL_FROM', { infer: true }),
          to: [message.to],
          subject: message.subject ?? 'Traders Welfare Logistics',
          text: message.body,
          html: renderEmail(message),
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const body = (await response.text()).slice(0, 500);
      if (!response.ok) {
        this.logger.error(`Resend refused an email (${response.status}): ${body}`);
        return {
          delivered: false,
          driver: 'resend',
          reason: `Resend responded ${response.status}`,
          providerStatus: response.status,
          providerMessage: summariseProviderReply(body),
        };
      }
      this.logger.log(`✉️  Email sent to ${maskEmail(message.to)} [${message.kind}]`);
      return { delivered: true, driver: 'resend' };
    } catch (error) {
      this.logger.error(`Resend email failed: ${(error as Error).message}`);
      return { delivered: false, driver: 'resend', reason: (error as Error).message };
    }
  }

  /**
   * What the admin console needs to show: which driver is configured for each
   * channel, and — the honest part — whether it can actually deliver anything.
   *
   * No secret is ever returned. The API key is not read here at all: "configured"
   * means the key is present, not what it is.
   */
  status() {
    const smsMode = this.config.get('SMS_MODE', { infer: true });
    const emailMode = this.config.get('EMAIL_MODE', { infer: true });
    const termiiKey = !!this.config.get('TERMII_API_KEY', { infer: true })?.trim();
    const resendKey = !!this.config.get('RESEND_API_KEY', { infer: true })?.trim();

    return {
      sms: {
        mode: smsMode,
        ready: smsMode === 'TERMII' && termiiKey,
        senderId: this.config.get('TERMII_SENDER_ID', { infer: true }),
        /**
         * The route matters more than anything else on this screen: the generic route
         * does not reach numbers with do-not-disturb active, which in Nigeria is most
         * of them, so an OTP sent on `generic` looks delivered and is never seen.
         */
        route: this.config.get('TERMII_CHANNEL', { infer: true }),
        problem: !termiiKey
          ? 'TERMII_API_KEY is empty. SMS can only be printed to the server log until a key is added.'
          : smsMode !== 'TERMII'
            ? 'SMS_MODE is CONSOLE. Codes are printed to the server log, not sent.'
            : null,
      },
      email: {
        mode: emailMode,
        ready: emailMode === 'RESEND' && resendKey,
        from: this.config.get('EMAIL_FROM', { infer: true }),
        problem: !resendKey
          ? 'RESEND_API_KEY is empty. Email can only be printed to the server log.'
          : emailMode !== 'RESEND'
            ? 'EMAIL_MODE is CONSOLE. Emails are printed to the server log, not sent.'
            : null,
      },
    };
  }

  /**
   * Send one real message, on demand, and report exactly what happened.
   *
   * This is the answer to "is SMS working?" — a question that otherwise gets answered
   * by registering a test account and waiting, or by reading a server log. The message
   * says what it is, so a customer who receives it by mistake is not confused.
   */
  async sendTest(channel: 'SMS' | 'EMAIL', to: string): Promise<DeliveryResult & { to: string }> {
    const body =
      channel === 'SMS'
        ? 'Traders Welfare Logistics test message. If you received this, SMS is working. No action needed.'
        : 'This is a test message from Traders Welfare Logistics. If you received it, email is working. No action needed.';

    const result =
      channel === 'SMS'
        ? await this.sendSms({ to, body, kind: 'SMS_TEST' })
        : await this.sendEmail({ to, subject: 'TWL test message', body, kind: 'EMAIL_TEST' });

    this.logger.log(
      `Messaging test (${channel}) → ${channel === 'SMS' ? maskPhone(to) : maskEmail(to)}: ${
        result.delivered ? 'delivered' : `not delivered (${result.reason ?? 'unknown'})`
      }`,
    );
    return { ...result, to };
  }
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

/** `+2348031234567` → `2348031234567`. Termii's `to` field has no plus. */
export function toTermiiNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('234')) return digits;
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
}

/**
 * A provider's error body, cut down to something a person can act on.
 *
 * Termii answers with JSON like {"code":"400","message":"Sender ID not found"} and
 * Resend with {"message":"domain is not verified"}. The `message` field is the only
 * part worth showing; everything else is noise, and the request (which holds the key)
 * is never included.
 */
export function summariseProviderReply(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const field of ['message', 'error', 'detail', 'description']) {
      const value = parsed[field];
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 240);
    }
    return trimmed.slice(0, 240);
  } catch {
    return trimmed.replace(/\s+/g, ' ').slice(0, 240);
  }
}

/** Never log a whole phone number. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `${digits.slice(0, 5)}…${digits.slice(-2)}`;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name!.slice(0, 2)}***@${domain}`;
}

/**
 * A plain, readable email. No images, no tracking pixels, no 600 kb of HTML — a
 * verification link has to work in a phone's preview pane on a slow connection.
 */
function renderEmail(message: OutboundMessage): string {
  // Two details that cost real emails:
  //  · `.test()` on a /g regex advances lastIndex, so it answered differently for
  //    every other part — half the links in a message were left as raw text.
  //  · a full stop or bracket at the end of a sentence got swept into the href,
  //    which made the token it carried invalid.
  const isLink = /^https?:\/\//;
  const trailing = /[.,;:!?)\]]+$/;
  const linked = message.body
    .split(/(https?:\/\/\S+)/g)
    .map((part) => {
      if (!isLink.test(part)) return escapeHtml(part);
      const url = part.replace(trailing, '');
      const tail = part.slice(url.length);
      return `<a href="${escapeHtml(url)}" style="color:#047857">${escapeHtml(url)}</a>${escapeHtml(tail)}`;
    })
    .join('');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Traders Welfare Logistics</p>
    <h1 style="margin:0 0 16px;font-size:18px;color:#0f172a">${escapeHtml(message.subject ?? 'Notification')}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#334155">${linked.replace(/\n/g, '<br>')}</p>
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#94a3b8">If you did not expect this message you can ignore it.</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
