import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest + NestJS note.
 * NestJS resolves dependencies from TypeScript decorator metadata, which esbuild
 * (Vitest's default transformer) does not emit. Compiling the tests through SWC
 * restores that metadata, so the test suite exercises the same dependency
 * injection graph as the production build. Without this, every service that
 * injects ConfigService appears to receive `undefined`.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    setupFiles: ['test/setup-env.ts'],
    globalSetup: ['test/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
