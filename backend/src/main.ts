import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { registerIndexPage } from './common/api-index-page';
import { decideCorsOrigin } from './common/cors';

async function bootstrap(): Promise<void> {
  // `rawBody` is what makes payment webhook signature verification possible: the
  // HMAC is computed over the exact bytes the provider sent, so the body must be
  // kept before JSON parsing reorders or re-spaces it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');

  // ── Security headers. CSP is disabled here because the API serves JSON only;
  //    the SPA gets its own CSP from the reverse proxy / hosting layer.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // ── Real client IPs behind the proxy. nginx (and optionally Caddy/Cloudflare)
  //    append the caller to X-Forwarded-For; without this Express reports the
  //    proxy's own address, which silently merges every user into a single
  //    rate-limit bucket and fills the audit log with one IP. The hop count is
  //    configuration (TRUST_PROXY) because it depends on the deployment shape.
  app.set('trust proxy', config.trustProxy);

  // ── CORS: explicit allowlist, plus the deployment's own origin.
  //    A refused origin must never become a 500 — see common/cors.ts for why
  //    that matters. The browser still blocks the call; the server just refuses
  //    quietly, logs the origin once, and keeps working for everyone else.
  const refusedOrigins = new Set<string>();
  app.enableCors((request: Request, callback: (error: Error | null, options: CorsOptions) => void) => {
    const decision = decideCorsOrigin(
      request.headers.origin,
      request.headers.host,
      request.headers['x-forwarded-host'],
      config.corsOrigins,
    );

    if (!decision.allowed) {
      const origin = String(request.headers.origin);
      if (!refusedOrigins.has(origin)) {
        refusedOrigins.add(origin);
        logger.warn(
          `Blocked a browser request from ${origin}. If that is your own site, add it to CORS_ORIGINS.`,
        );
      }
    }

    callback(null, {
      // `true` reflects the caller's origin, which is only reached once allowed.
      origin: decision.allowed,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    });
  });

  // ── Body size. Riders upload proof-of-delivery photos as base64 inside JSON, so
  //    the express default (100 kB) would reject a real phone photo with a 413 the
  //    app cannot explain. 8 MB covers a 5 MB image after base64 expansion (×4/3)
  //    plus JSON overhead, and every upload route is authenticated and rate limited.
  //    `useBodyParser` keeps the raw-body capture that webhook signatures depend on.
  app.useBodyParser('json', { limit: '8mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  app.setGlobalPrefix(config.apiPrefix);

  // NOTE: no global class-validator ValidationPipe here on purpose.
  // All request bodies/queries are validated by Zod schemas shared with the
  // frontend (see common/decorators/zod.decorators.ts). Zod strips unknown keys
  // by default, which gives us the same whitelist behaviour.

  app.enableShutdownHooks();

  // ── The API root gets a real page: the API is JSON-only, and opening the host
  //    in a browser used to return a bare 404 that reads like a broken deployment.
  registerIndexPage(app, {
    appName: config.appName,
    apiPrefix: config.apiPrefix,
    nodeEnv: config.nodeEnv,
    apiPort: config.port,
  });

  await app.listen(config.port, '0.0.0.0');
  logger.log(`${config.appName} API listening on http://0.0.0.0:${config.port}/${config.apiPrefix}`);
  logger.log(`Environment: ${config.nodeEnv} · Payments: ${config.paymentsMode}`);
  if (config.paymentsMode === 'DEVELOPMENT') {
    logger.warn('PAYMENTS ARE SIMULATED (PAYMENTS_MODE=DEVELOPMENT). No real money can move.');
  }
}

void bootstrap();
