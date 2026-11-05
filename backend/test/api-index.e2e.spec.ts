import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service';
import type { RedisService } from '../src/infra/redis/redis.service';
import { createTestApp } from './helpers/app';

/**
 * The API root is the first thing a human opens — in a browser, or in a preview
 * panel. It must explain itself instead of answering a bare 404, and it must be
 * honest: the dependency checks run on every request, and the route table is read
 * from the router the application actually built.
 */
describe('API root index page', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    ({ app, prisma, redis } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves HTML instead of a 404', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<title>Dispatch Platform API</title>');
    // Personal or environment data must never leak onto a public page.
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports the dependencies it actually checked', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.text).toContain('PostgreSQL');
    expect(res.text).toContain('Redis');
    // Both services are up in the test environment, so both pills must be green.
    expect((res.text.match(/class="pill ok"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(res.text).toContain('All dependencies healthy');
  });

  it('lists the routes the application really registered', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.text).toContain('/api/v1/health');
    expect(res.text).toContain('/api/v1/rider/offers/:id/accept');
    expect(res.text).toContain('/api/v1/admin/riders/:id/approval');
    expect(res.text).toContain('/api/v1/deliveries/quote');
  });

  it('still answers health as JSON for machines', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
  });

  it('never publishes credentials, hashes or connection strings', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    // Route names such as /auth/password/reset are public knowledge; values are not.
    expect(res.text).not.toContain('Admin@12345');
    expect(res.text).not.toContain('dispatch_dev_password');
    expect(res.text).not.toContain('postgresql://');
    expect(res.text).not.toMatch(/\$argon2/);
    expect(res.text).not.toMatch(/jwt[_-]?secret/i);
  });
});
