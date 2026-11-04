import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/infra/redis/redis.service';

/**
 * Boots the REAL application (real Postgres, real Redis) and calls it over HTTP.
 * Nothing is mocked: if the wiring is broken, this fails.
 */
describe('GET /health (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    app.get(RedisService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('reports database and redis as healthy', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
    expect(res.body.integrations).toMatchObject({ payments: 'DEVELOPMENT' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('responds to the liveness probe without touching dependencies', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns 404 in the standard error shape for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('has the seeded reference data in the database (proves migrations + seed ran)', async () => {
    const [roles, permissions, accounts, zones, pricing] = await Promise.all([
      prisma.role.count(),
      prisma.permission.count(),
      prisma.ledgerAccount.count(),
      prisma.serviceZone.count(),
      prisma.pricingRule.count({ where: { isActive: true } }),
    ]);
    expect(roles).toBe(5);
    expect(permissions).toBeGreaterThanOrEqual(30);
    expect(accounts).toBe(16);
    expect(zones).toBeGreaterThanOrEqual(3);
    expect(pricing).toBeGreaterThanOrEqual(1);
  });

  it('enforces the money constraint at database level', async () => {
    await expect(
      prisma.wallet.create({
        data: {
          userId: '00000000-0000-0000-0000-000000000000',
          type: 'CUSTOMER',
          balanceKobo: -1n,
        },
      }),
    ).rejects.toThrow();
  });
});
