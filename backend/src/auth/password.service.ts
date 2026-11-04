import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * PASSWORD HASHING — Argon2id.
 *
 * Argon2id is the OWASP-recommended default: memory-hard (resists GPU cracking),
 * with the hybrid "id" variant resisting both side-channel and time-memory attacks.
 * Parameters are tuned to roughly 50–100 ms per hash on modest hardware — slow
 * enough to make offline cracking expensive, fast enough for logins.
 *
 * Passwords are NEVER logged, never returned, never stored in plain text, and the
 * hash is never included in any API response (see UserMapper).
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB — OWASP baseline
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, this.options);
  }

  /**
   * Constant-time verification. `argon2.verify` returns false rather than throwing
   * on a malformed hash, but we still guard defensively so a corrupt row can never
   * turn into a 500 that leaks internal detail.
   */
  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      this.logger.warn('Password verification failed unexpectedly (malformed hash?)');
      return false;
    }
  }

  /** Re-hash transparently when parameters change, without forcing a reset. */
  async needsRehash(hash: string): Promise<boolean> {
    try {
      return argon2.needsRehash(hash, this.options);
    } catch {
      return true;
    }
  }
}
