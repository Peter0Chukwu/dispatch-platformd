import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env.config';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { LedgerModule } from './ledger/ledger.module';
import { WalletModule } from './wallet/wallet.module';
import { PaymentsModule } from './payments/payments.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { PricingModule } from './pricing/pricing.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { StorageModule } from './storage/storage.module';
import { RidersModule } from './riders/riders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { RiderJobsModule } from './rider-jobs/rider-jobs.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { MessagingModule } from './messaging/messaging.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../.env'],
      validate: validateEnv,
    }),
    AppConfigModule,
    PrismaModule,
    RedisModule,
    MessagingModule,
    AuditModule,
    UsersModule,
    AuthModule,
    StorageModule,
    PricingModule,
    RealtimeModule,
    DispatchModule,
    RidersModule,
    RiderJobsModule,
    LedgerModule,
    WalletModule,
    PaymentsModule,
    WithdrawalsModule,
    DeliveriesModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    // ── Global guard order matters ──────────────────────────────────────────
    // 1. rate limiting runs FIRST, so brute-force traffic is rejected before any
    //    database or password work happens
    // 2. authentication resolves the principal (or rejects)
    // 3. authorisation checks permissions
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // cookie-parser lives here (not in main.ts) so that EVERY entry point —
    // the HTTP server, the test harness, any future lambda/worker bootstrap —
    // parses the refresh cookie identically.
    consumer.apply(cookieParser(), RequestIdMiddleware).forRoutes('*');
  }
}
