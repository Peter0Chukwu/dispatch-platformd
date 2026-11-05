import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { RedisService } from '../../src/infra/redis/redis.service';
import { PasswordService } from '../../src/auth/password.service';
import { registerIndexPage } from '../../src/common/api-index-page';

/** Boots the real application against the real test database and Redis. */
/**
 * The dispatch heartbeat is a wall-clock timer; in the suite it is switched off and
 * the tests call `DispatchService.tick()` themselves, so a background sweep can
 * never change the world halfway through an assertion.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisService;
  passwords: PasswordService;
}> {
  process.env.DISPATCH_SCHEDULER = 'off';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api/v1');
  // Same root page as main.ts, so the suite exercises what production serves.
  registerIndexPage(app, { appName: 'Dispatch Platform', apiPrefix: 'api/v1', nodeEnv: 'test', apiPort: 0 });
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    passwords: app.get(PasswordService),
  };
}
