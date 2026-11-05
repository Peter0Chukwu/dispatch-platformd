/**
 * Per-test-process environment.
 *  · loads backend/.env
 *  · points DATABASE_URL at the TEST database (never at development data)
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

process.env.NODE_ENV = 'test';

// ── Payment credentials in tests are always fake ───────────────────────────────
// The env file may carry real sandbox keys; the suite must never use them, and the
// webhook tests need a known secret to sign with. These values are deterministic on
// purpose so a signature can be reproduced.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_webhook_signature_key';
process.env.PAYSTACK_PUBLIC_KEY = 'pk_test_webhook_signature_key';
process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-fake';
process.env.FLUTTERWAVE_WEBHOOK_HASH = 'test_flutterwave_verif_hash';
process.env.PAYMENTS_MODE = 'DEVELOPMENT';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  throw new Error('TEST_DATABASE_URL missing — refusing to run tests against the development database');
}
