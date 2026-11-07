import { z } from 'zod';

/**
 * ENVIRONMENT VALIDATION — runs once at boot.
 *
 * If a variable is missing or malformed the API refuses to start, with a message
 * that names the exact variable. This is deliberate: a server that boots with a
 * missing payment secret and fails later, mid-transaction, is far more dangerous
 * than a server that refuses to boot.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  APP_NAME: z.string().default('Dispatch Platform'),
  APP_TIMEZONE: z.string().default('Africa/Lagos'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),
  TRACKING_LINK_SECRET: z.string().min(32, 'TRACKING_LINK_SECRET must be at least 32 characters'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  PAYMENTS_MODE: z.enum(['DEVELOPMENT', 'SANDBOX', 'LIVE']).default('DEVELOPMENT'),
  PAYSTACK_SECRET_KEY: z.string().optional().default(''),
  PAYSTACK_PUBLIC_KEY: z.string().optional().default(''),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional().default(''),
  FLUTTERWAVE_SECRET_KEY: z.string().optional().default(''),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional().default(''),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional().default(''),

  MAPS_PROVIDER: z.enum(['STUB', 'GOOGLE', 'MAPBOX']).default('STUB'),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(''),

  SMS_MODE: z.enum(['CONSOLE', 'TERMII']).default('CONSOLE'),
  TERMII_API_KEY: z.string().optional().default(''),
  TERMII_SENDER_ID: z.string().default('Dispatch'),

  EMAIL_MODE: z.enum(['CONSOLE', 'RESEND']).default('CONSOLE'),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('no-reply@example.com'),

  /**
   * How many reverse proxies sit in front of the API. Express needs this to read
   * `X-Forwarded-For` and report the real client IP; without it every request
   * appears to come from the proxy, which turns per-IP rate limiting into one
   * shared bucket and writes the proxy's address into the audit log.
   *   0 = exposed directly (development)
   *   1 = one proxy hop   (nginx in the compose network)
   *   2 = two hops        (Caddy/Cloudflare -> nginx -> API)
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),

  STORAGE_DRIVER: z.enum(['LOCAL', 'S3', 'CLOUDINARY']).default('LOCAL'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),

  DEFAULT_COMMISSION_PCT: z.coerce.number().min(0).max(100).default(20),
  DISPATCH_OFFER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(45),
  DISPATCH_MAX_ACTIVE_PER_RIDER: z.coerce.number().int().positive().default(2),
  /** How many riders receive the same offer at once. First to accept wins. */
  DISPATCH_OFFER_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(3),
  /** How often the dispatcher looks for work that needs a rider. */
  DISPATCH_TICK_MS: z.coerce.number().int().positive().default(5000),
  /** After this many rounds with nobody available, dispatch stops and raises an alert. */
  DISPATCH_MAX_ROUNDS: z.coerce.number().int().positive().max(20).default(4),
  TRACKING_PING_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  LOCATION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule.forRoot({ validate }). Throws on invalid config. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\n\nCheck backend/.env against .env.example.`);
  }
  return result.data;
}
