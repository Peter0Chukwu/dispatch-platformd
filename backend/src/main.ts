import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { registerIndexPage } from './common/api-index-page';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');

  // ── Security headers. CSP is disabled here because the API serves JSON only;
  //    the SPA gets its own CSP from the reverse proxy / hosting layer.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // ── CORS: explicit allowlist. A browser on any other origin cannot call us.
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

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
