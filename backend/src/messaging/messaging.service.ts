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
    | 'DISPATCH_OFFER';
}

/**
 * OUTBOUND COMMUNICATIONS
 *
 * In development everything is printed to the API console and nothing leaves the
 * machine — no SMS credit is spent, no email is delivered. This is deliberate:
 * SMS costs money per message and testing must be free.
 *
 * In Phase 7 this becomes a queue-backed dispatcher with Termii (SMS) and Resend
 * (email) drivers plus retry/backoff. The interface stays the same, so callers
 * never change.
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

  async sendSms(message: OutboundMessage): Promise<void> {
    if (this.smsMode === 'CONSOLE') {
      this.logger.log(`📱 SMS → ${message.to} [${message.kind}] :: ${message.body}`);
      return;
    }
    throw new Error('Termii SMS driver is configured in Phase 7');
  }

  async sendEmail(message: OutboundMessage): Promise<void> {
    if (this.emailMode === 'CONSOLE') {
      this.logger.log(`✉️  EMAIL → ${message.to} [${message.kind}] ${message.subject ?? ''} :: ${message.body}`);
      return;
    }
    throw new Error('Resend email driver is configured in Phase 7');
  }
}
