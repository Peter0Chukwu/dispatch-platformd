/**
 * Runs ONCE before the whole test suite.
 *
 * Creates/migrates/seeds a SEPARATE database (dispatch_dev_test) so integration
 * tests can create users, trigger lockouts and revoke sessions without touching
 * development data.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '../.env');
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

export default function setup(): void {
  const fileEnv = loadEnv();
  const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is not set — add it to backend/.env (see .env.example)');
  }

  const env = { ...process.env, ...fileEnv, DATABASE_URL: testDatabaseUrl, NODE_ENV: 'test' };

  console.log('\n🧪 Preparing test database…');
  execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '..'), env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { cwd: resolve(__dirname, '..'), env, stdio: 'pipe' });
  // One extra zone covering the old Lagos fixture coordinates, so the integration
  // suites keep testing the same geometry. Test-only — see the file's own note.
  execSync('npx tsx test/setup-test-zone.ts', { cwd: resolve(__dirname, '..'), env, stdio: 'pipe' });
  console.log('🧪 Test database ready\n');
}
