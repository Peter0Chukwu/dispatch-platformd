import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.config';

/**
 * Typed accessors over validated environment config.
 * No `process.env` reads anywhere else in the codebase.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv() { return this.config.get('NODE_ENV', { infer: true }); }
  get isProduction() { return this.nodeEnv === 'production'; }
  get isDevelopment() { return this.nodeEnv === 'development'; }
  get port() { return this.config.get('PORT', { infer: true }); }
  get apiPrefix() { return this.config.get('API_PREFIX', { infer: true }); }
  get appName() { return this.config.get('APP_NAME', { infer: true }); }
  get timezone() { return this.config.get('APP_TIMEZONE', { infer: true }); }
  get corsOrigins(): string[] {
    return this.config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim()).filter(Boolean);
  }
  get databaseUrl() { return this.config.get('DATABASE_URL', { infer: true }); }
  get redisUrl() { return this.config.get('REDIS_URL', { infer: true }); }
  get paymentsMode() { return this.config.get('PAYMENTS_MODE', { infer: true }); }
  get paystackSecretKey(): string { return this.config.get('PAYSTACK_SECRET_KEY', { infer: true }); }
  get paystackPublicKey(): string { return this.config.get('PAYSTACK_PUBLIC_KEY', { infer: true }); }
  get flutterwaveSecretKey(): string { return this.config.get('FLUTTERWAVE_SECRET_KEY', { infer: true }); }
  get flutterwavePublicKey(): string { return this.config.get('FLUTTERWAVE_PUBLIC_KEY', { infer: true }); }
  get flutterwaveWebhookHash(): string { return this.config.get('FLUTTERWAVE_WEBHOOK_HASH', { infer: true }); }
  /** Where a gateway returns the customer after paying. */
  get frontendUrl(): string { return this.config.get('FRONTEND_URL', { infer: true }); }
  get mapsProvider() { return this.config.get('MAPS_PROVIDER', { infer: true }); }
  /** Lower-cased provider for comparisons: 'stub' | 'google' | 'mapbox'. */
  get mapsProviderKey(): 'stub' | 'google' | 'mapbox' {
    return this.config.get('MAPS_PROVIDER', { infer: true }).toLowerCase() as 'stub' | 'google' | 'mapbox';
  }
  get storageDriver() { return this.config.get('STORAGE_DRIVER', { infer: true }); }
  get storageLocalDir() { return this.config.get('STORAGE_LOCAL_DIR', { infer: true }); }
  get googleMapsApiKey(): string | undefined {
    const key = this.config.get('GOOGLE_MAPS_API_KEY', { infer: true });
    return key && key.trim().length > 0 ? key.trim() : undefined;
  }
  get smsMode() { return this.config.get('SMS_MODE', { infer: true }); }
  get emailMode() { return this.config.get('EMAIL_MODE', { infer: true }); }
  get commissionPercent() { return this.config.get('DEFAULT_COMMISSION_PCT', { infer: true }); }
  get offerTimeoutSeconds() { return this.config.get('DISPATCH_OFFER_TIMEOUT_SECONDS', { infer: true }); }
  get maxActivePerRider() { return this.config.get('DISPATCH_MAX_ACTIVE_PER_RIDER', { infer: true }); }
  get offerBatchSize() { return this.config.get('DISPATCH_OFFER_BATCH_SIZE', { infer: true }); }
  get dispatchTickMs() { return this.config.get('DISPATCH_TICK_MS', { infer: true }); }
  get dispatchMaxRounds() { return this.config.get('DISPATCH_MAX_ROUNDS', { infer: true }); }
  /** How often the rider app should report its position (Phase 8). Advisory: the API serves it. */
  get trackingPingIntervalSeconds() { return this.config.get('TRACKING_PING_INTERVAL_SECONDS', { infer: true }); }
  /** Positions older than this are swept out of `rider_locations`. */
  get locationRetentionDays() { return this.config.get('LOCATION_RETENTION_DAYS', { infer: true }); }
  /** Secret behind signed report download tokens (derived, never used raw). */
  get trackingLinkSecret(): string { return this.config.get('TRACKING_LINK_SECRET', { infer: true }); }
  /** Hours a share link stays alive before it must be re-issued. */
  get shareLinkTtlHours() { return Number(process.env.TRACKING_SHARE_LINK_TTL_HOURS ?? 72); }
}
