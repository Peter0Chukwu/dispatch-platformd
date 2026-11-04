import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Allowed requests inside the window. */
  points: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * What the bucket is keyed on:
   *  - 'ip'        : per client address (login, OTP)
   *  - 'ip+route'  : per address per route (general API abuse)
   *  - 'body'      : per identifier in the body (email/phone) — stops one attacker
   *                  hammering many accounts from many IPs
   */
  keyBy?: 'ip' | 'ip+route' | 'body';
  bodyField?: string;
  message?: string;
}

/** @RateLimit({ points: 5, windowSeconds: 300 }) */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
